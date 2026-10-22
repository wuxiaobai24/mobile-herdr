import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { appendFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { api, panePath } from '../shared/client';
import type { Conversation, Machine, Snapshot } from '../shared/protocol';
import { createFixture } from './fixture';

describe('bridge over a real Unix socket', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let machine: Machine;
  beforeAll(async () => { fixture = await createFixture(); machine = { id: 'test', name: 'test', url: fixture.url, token: fixture.config.token }; });
  afterAll(async () => { await fixture.close(); });
  test('requires auth and rejects an unrelated browser origin', async () => {
    expect((await fetch(fixture.url + '/api/info')).status).toBe(401);
    expect((await fetch(fixture.url + '/api/info', { headers: { Origin: 'https://untrusted.invalid', Authorization: 'Bearer ' + machine.token } })).status).toBe(403);
    expect((await api<{ name: string }>(machine, '/api/info')).name).toBe('MacBook Pro');
  });
  test('resolves existing sessions, never accepts arbitrary socket paths', async () => {
    const snapshot = await api<Snapshot>(machine, '/api/snapshot');
    expect(snapshot.panes[0].pane_id).toBe('w1:p1');
    expect((await fetch(fixture.url + '/api/snapshot?session=../../other', { headers: { Authorization: 'Bearer ' + machine.token } })).status).toBe(404);
  });
  test('loads the exact reported transcript and follows append-only updates', async () => {
    const path = panePath('default', 'w1:p1', 'chat');
    const first = await api<Conversation>(machine, path);
    expect(first.source).toBe('pi'); expect(first.binding).toBe('reported'); expect(first.messages).toHaveLength(3);
    await appendFile(fixture.transcript, JSON.stringify({ type: 'message', id: 'new', message: { role: 'assistant', content: '新增回复' } }) + '\n');
    expect((await api<Conversation>(machine, path)).messages.at(-1)?.text).toBe('新增回复');
  });
  test('prompt reaches the original pane once when the same request is retried', async () => {
    const path = panePath('default', 'w1:p1', 'prompt');
    const before = fixture.calls.filter(call => call.method === 'agent.prompt').length;
    await Promise.all([api(machine, path, { body: { text: '原会话测试' }, id: 'same-request-id' }), api(machine, path, { body: { text: '原会话测试' }, id: 'same-request-id' })]);
    const calls = fixture.calls.filter(call => call.method === 'agent.prompt');
    expect(calls.length - before).toBe(1); expect(calls.at(-1)?.params).toEqual({ target: 'w1:p1', text: '原会话测试' });
  });
  test('working / blocked panes reject chat submission and raw shortcuts are validated', async () => {
    await expect(api(machine, panePath('default', 'w2:p1', 'prompt'), { body: { text: 'no' } })).rejects.toMatchObject({ code: 'agent_working' });
    await expect(api(machine, panePath('default', 'w3:p1', 'prompt'), { body: { text: 'yes' } })).rejects.toMatchObject({ code: 'agent_blocked' });
    await expect(api(machine, panePath('default', 'w1:p1', 'keys'), { body: { keys: ['invalid'] } })).rejects.toMatchObject({ code: 'invalid_keys' });
  });
  test('rejects transcript symlinks escaping the allowed store', async () => {
    const outside = join(fixture.directory, 'private.jsonl'); await Bun.write(outside, '{"message":{"role":"assistant","content":"secret"}}\n');
    const link = join(fixture.config.piHome, 'sessions/project/link.jsonl'); await symlink(outside, link);
    fixture.snapshot.panes[0].agent_session!.value = link;
    const result = await api<Conversation>(machine, panePath('default', 'w1:p1', 'chat'));
    expect(result.source).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('secret');
    fixture.snapshot.panes[0].agent_session!.value = fixture.transcript;
  });
  test('missing session IDs require an explicit choice; replacing the process invalidates it', async () => {
    const reference = fixture.snapshot.panes[0].agent_session;
    delete fixture.snapshot.panes[0].agent_session;
    const path = panePath('default', 'w1:p1', 'chat');
    const first = await api<Conversation>(machine, path);
    expect(first.source).toBe('unavailable'); expect(first.candidates).toHaveLength(1);
    await api(machine, panePath('default', 'w1:p1', 'bind'), { body: { candidateId: first.candidates[0].id } });
    expect((await api<Conversation>(machine, path)).binding).toBe('selected');
    fixture.setForegroundPid(200);
    expect((await api<Conversation>(machine, path)).source).toBe('unavailable');
    fixture.setForegroundPid(100);
    fixture.snapshot.panes[0].agent_session = reference;
  });
  test('WebSocket authenticates in its first frame and streams exact pane state', async () => {
    const frame = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(fixture.url.replace('http', 'ws') + '/api/watch');
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: machine.token, session: 'default', pane: 'w1:p1' }));
      ws.onmessage = event => { const frame = JSON.parse(String(event.data)); ws.close(); resolve(frame); };
      ws.onerror = reject;
    });
    expect(frame.type).toBe('state'); expect(frame.chat.source).toBe('pi'); expect(frame.snapshot.panes).toHaveLength(3);
  });
});

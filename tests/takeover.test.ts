import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { createFixture } from './fixture';
import { NativeController } from '../server/native/controller';
import { api, panePath } from '../shared/client';
import type { Machine } from '../shared/protocol';
import type { TakeoverState } from '../shared/takeover';
import { createNativeFixture } from './native-fixture';
import { piRestartArgs } from '../server/native/restart';

test('explicit restart waits for idle, is cancellable, and does not accept another runtime or owner', async () => {
  const f = await createNativeFixture();
  const pane = f.snapshot.panes[0];
  const machine = { id: 'test', name: 'test', url: f.url, token: f.config.token };
  const path = panePath('default', pane.pane_id, 'takeover');
  const body = { restart: true, runtimeId: f.control.state.runtimeId, clientId: 'restart-test-phone', agent: pane.agent, terminalId: pane.terminal_id, conversation: pane.agent_session?.value };
  try {
    f.control.state.status = 'working';
    await api(machine, path, { body });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'waiting');
    await api(machine, path, { body: { ...body, cancel: true } });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'cancelled');
    expect(f.control.state.connected).toBe(true);
    expect(f.calls.every(row => ['session.snapshot', 'pane.process_info'].includes(row.method))).toBe(true);
    await api(machine, path, { body: { ...body, runtimeId: 'stale-runtime' } });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'failed');
    expect(f.control.state.connected).toBe(true);
  } finally { await f.close(); }
});

test('Pi restart keeps supported flags and never replays a positional prompt', () => {
  expect(piRestartArgs(['--model', 'fixture/model', '--session', 'old', '--offline', '--extension', '/old/mobile-herdr.ts'], 'exact-id')).toEqual(['--session', 'exact-id', '--model', 'fixture/model', '--offline']);
  expect(() => piRestartArgs(['do the old task again'], 'exact-id')).toThrow('无法安全恢复');
  expect(() => piRestartArgs(['--no-extensions'], 'exact-id')).toThrow('无法安全恢复');
});

async function until(check: () => Promise<boolean>): Promise<void> { for (let i = 0; i < 40; i++) { if (await check()) return; await Bun.sleep(30); } throw new Error('Takeover did not settle.'); }
test('setup claims an existing exact native session once; another phone cannot steal it', async () => {
  const fixture = await createFixture();
  const pane = fixture.snapshot.panes[0];
  pane.agent_session = { agent: 'pi', kind: 'id', value: 'original-pi', source: 'test' };
  const control = new NativeController(join(fixture.directory, 'native'), { herdrSocket: fixture.config.socket!, paneId: pane.pane_id, terminalId: pane.terminal_id }, 'pi');
  control.state.conversationId = 'original-pi'; await control.listen();
  const machine: Machine = { id: 'test', name: 'test', url: fixture.url, token: fixture.config.token };
  const path = panePath('default', pane.pane_id, 'takeover');
  const body = { terminalId: pane.terminal_id, agent: 'pi', conversation: 'original-pi', clientId: 'phone-one' };
  try {
    await Promise.all([api(machine, path, { body, id: 'setup-identical-request' }), api(machine, path, { body, id: 'setup-identical-request' })]);
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'ready');
    expect(control.state.owner).toBe('phone-one'); expect(control.state.epoch).toBe(1);
    expect(fixture.calls.some(row => ['agent.prompt', 'pane.send_text', 'pane.send_keys'].includes(row.method))).toBeFalse();
    await api(machine, path, { body: { ...body, clientId: 'phone-two' } });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'failed');
    expect(control.state.owner).toBe('phone-one'); expect(control.state.epoch).toBe(1);
  } finally { await control.close(); await fixture.close(); }
});
test('first-time setup waits without interrupting work, can be cancelled, and rejects stale pane identity', async () => {
  const fixture = await createFixture(); const pane = fixture.snapshot.panes[0]; pane.agent_status = 'working';
  const machine: Machine = { id: 'test', name: 'test', url: fixture.url, token: fixture.config.token };
  const path = panePath('default', pane.pane_id, 'takeover');
  const body = { terminalId: pane.terminal_id, agent: pane.agent, conversation: pane.agent_session?.value, clientId: 'phone-one' };
  try {
    await expect(api(machine, path, { body: { ...body, terminalId: 'stale-terminal' } })).rejects.toMatchObject({ code: 'agent_changed' });
    await api(machine, path, { body });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'waiting');
    await expect(api(machine, path, { body: { ...body, clientId: 'phone-two' } })).rejects.toMatchObject({ code: 'takeover_busy' });
    await api(machine, path, { body: { ...body, cancel: true } });
    await until(async () => (await api<TakeoverState>(machine, path)).phase === 'cancelled');
    expect(fixture.calls.every(row => ['session.snapshot', 'pane.process_info'].includes(row.method))).toBeTrue();
    expect(pane.agent_status).toBe('working');
  } finally { await fixture.close(); }
});

test('Codex identity comes from the selected process open rollout file, including large metadata; ambiguous IDs are rejected', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { codexSessionForProcess } = await import('../server/native/takeover');
  const fixture = await createFixture(); const home = fixture.config.codexHome;
  await mkdir(join(home, 'sessions'), { recursive: true });
  const files = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map(id => join(home, 'sessions', 'rollout-' + id + '.jsonl'));
  for (let i = 0; i < files.length; i++) await writeFile(files[i], JSON.stringify({ type: 'session_meta', payload: { id: files[i].match(/rollout-(.*)\.jsonl/)![1], instructions: 'x'.repeat(256000) } }) + '\n');
  const children: Bun.Subprocess[] = [];
  try {
    for (let count = 1; count <= 2; count++) {
      const child = Bun.spawn([process.execPath, '-e', `const fs=require('node:fs'); for(const path of process.argv.slice(1)) fs.openSync(path,'a'); process.stdout.write('ready'); await Bun.sleep(60000);`, ...files.slice(0, count)], { stdout: 'pipe', stderr: 'ignore' }); children.push(child);
      const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
      if (count === 1) expect(await codexSessionForProcess(child.pid, home)).toBe('11111111-1111-4111-8111-111111111111');
      else await expect(codexSessionForProcess(child.pid, home)).rejects.toThrow('唯一会话');
    }
  } finally { for (const child of children) { child.kill(); await child.exited; } await fixture.close(); }
});

import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createNativeFixture } from './native-fixture';
import { nativeCall } from '../server/native/registry';
import { api, panePath } from '../shared/client';
import type { NativeState, NativeAction } from '../shared/native';
import { createBridge } from '../server/server';

test('same live Codex: takeover fences desktop, streams, steers, routes approvals, deduplicates across bridge reads, returns to desktop', async () => {
  const f = await createNativeFixture();
  const machine = { id: 'test', name: 'test', url: f.url, token: f.config.token };
  const path = panePath('default', 'w1:p1', 'native');
  let restarted: ReturnType<typeof createBridge> | undefined;
  let sequence = 0;
  function input(action: NativeAction['action'], values = {}): NativeAction { return { action, runtimeId: f.control.state.runtimeId, clientId: 'phone-test-1', epoch: f.control.state.epoch, requestId: 'native-test-' + ++sequence, ...values }; }
  async function act(action: NativeAction['action'], values = {}) { const body = input(action, values); return api(machine, path, { id: body.requestId, body }); }
  try {
    const before = await api<NativeState>(machine, path);
    expect(before.owner).toBe('desktop'); expect(before.conversationId).toBe('test-thread-original');
    await nativeCall(f.control.record.endpoint, { method: 'attach' });
    await expect(act('claim')).rejects.toThrow('正在准备');
    await f.desktopCall('thread/resume', { threadId: before.conversationId });
    await f.desktopCall('thread/start', { ephemeral: true });
    expect(f.control.state.conversationId).toBe(before.conversationId);
    await act('claim');
    expect((await f.desktopCall('turn/start', { input: [{ type: 'text', text: 'must not write' }] })).error.message).toContain('手机正在控制');
    const body = input('prompt', { text: '手机原生消息' });
    await api(machine, path, { id: body.requestId, body });
    await api(machine, path, { id: body.requestId, body });
    // Retry directly at the long-lived provider, bypassing the HTTP bridge's dedup cache.
    await nativeCall(f.control.record.endpoint, { method: 'action', input: body });
    f.bridge.stop(true);
    restarted = createBridge(f.config); machine.url = `http://127.0.0.1:${restarted.port}`;
    await api(machine, path, { id: body.requestId, body });
    expect(f.control.state.messages.filter(row => row.role === 'user' && row.text === '手机原生消息')).toHaveLength(1);
    expect(f.control.state.status).toBe('working');
    await act('prompt', { text: '补充当前任务' });
    expect(f.control.state.messages.some(row => row.text.includes('补充当前任务'))).toBe(true);
    await act('prompt', { text: '需要审批' });
    expect(f.control.state.requests[0].kind).toBe('approval');
    const request = f.control.state.requests[0].id;
    await act('reply', { request, decision: 'accept' });
    expect(f.control.state.requests).toHaveLength(0);
    await act('prompt', { text: '需要问题' });
    await act('reply', { request: f.control.state.requests[0].id, answers: { theme: ['深色'] } });
    expect(f.control.state.requests).toHaveLength(0);
    const stale = input('prompt', { text: '过期手机不能写' });
    await nativeCall(f.control.record.endpoint, { method: 'desktop' });
    await expect(nativeCall(f.control.record.endpoint, { method: 'action', input: stale })).rejects.toThrow('控制权已变化');
    await f.desktopCall('turn/steer', { input: [{ type: 'text', text: '电脑接回' }] });
    const after = await nativeCall<NativeState>(f.control.record.endpoint, { method: 'state' });
    expect(after.runtimeId).toBe(before.runtimeId); expect(after.conversationId).toBe(before.conversationId);
    expect(after.messages.some(row => row.text.includes('电脑接回'))).toBe(true);
    f.snapshot.panes[0].agent_session = { agent: 'codex', kind: 'id', value: 'other-conversation', source: 'herdr' };
    expect((await api<NativeState>(machine, path)).connected).toBe(false);
    const conflict = input('claim');
    await expect(api(machine, path, { id: conflict.requestId, body: conflict })).rejects.toThrow('其他 agent 或对话');
    // A terminal ID change must never inherit the old runtime.
    f.snapshot.panes[0].terminal_id = 'replacement-terminal';
    expect(await api(machine, path)).toBe(null);
  } finally { restarted?.stop(true); await f.close(); }
}, 15000);

test('native ownership rejects a second phone and conflicting receipt contents', async () => {
  const f = await createNativeFixture();
  const base: NativeAction = { action: 'claim', runtimeId: f.control.state.runtimeId, clientId: 'phone-first', epoch: 0, requestId: 'claim-first' };
  try {
    await f.control.dispatch(base);
    await expect(f.control.dispatch({ ...base, clientId: 'phone-second', epoch: 1, requestId: 'claim-second' })).rejects.toThrow('另一台设备');
    await expect(f.control.dispatch({ ...base, action: 'release', epoch: 1 })).rejects.toThrow('请求 ID');
    expect((await nativeCall<NativeState>(join(f.directory, 'native', base.runtimeId + '.sock'), { method: 'state' })).owner).toBe('phone-first');
  } finally { await f.close(); }
});

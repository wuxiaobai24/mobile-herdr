import { expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageQueue } from '../server/message-queue';
import { NativeController } from '../server/native/controller';
import { BridgeError } from '../server/rpc';
import type { NativeAction, NativeState } from '../shared/native';
import { createNativeFixture } from './native-fixture';

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-queue-test-'));
  const clientId = 'phone_queue_test', socket = '/test.sock';
  const pane = { pane_id: 'w1:p1', terminal_id: 'terminal-one' } as any;
  const state: NativeState = { runtimeId: 'runtime-one', provider: 'codex', connected: true, owner: clientId, epoch: 1, revision: 1, status: 'working', conversationId: 'conversation-one', capabilities: { steer: true, idlePrompt: true, approvals: true, models: false }, messages: [], requests: [], truncated: false };
  const sent: NativeAction[] = [];
  let send = async (input: NativeAction) => { sent.push(input); state.status = 'working'; return { ok: true }; };
  const target = async () => ({ pane, state, send: (input: NativeAction) => send(input) });
  const queue = new MessageQueue(directory, target);
  const leaseId = queue.lease(socket, clientId);
  const input = { leaseId, paneId: pane.pane_id, terminalId: pane.terminal_id, runtimeId: state.runtimeId, conversationId: state.conversationId!, clientId, epoch: state.epoch, text: '下一轮处理中文', skills: ['/skills/review/SKILL.md'], attachments: ['attachment-id'] };
  return { directory, clientId, socket, pane, state, sent, target, queue, leaseId, input, setSend(value: typeof send) { send = value; },
    list: () => queue.list(socket, clientId), async close() { await queue.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('queue waits for idle, preserves attachments/skills, sends FIFO once and deduplicates accepted retries', async () => {
  const f = await harness();
  try {
    await f.queue.enqueue(f.socket, 'message_one', f.input);
    await f.queue.enqueue(f.socket, 'message_two', { ...f.input, text: '第二条' });
    await f.queue.tick(); expect(f.sent).toHaveLength(0);
    expect((await f.list())[0].status).toBe('queued');
    f.state.status = 'idle'; await f.queue.tick();
    expect(f.sent).toHaveLength(1); expect(f.sent[0].action).toBe('prompt_idle');
    expect(f.sent[0].skills).toEqual(f.input.skills); expect(f.sent[0].attachments).toEqual(f.input.attachments);
    expect((await f.list()).map(row => row.status)).toEqual(['sent', 'queued']);
    expect((await f.queue.enqueue(f.socket, 'message_one', { ...f.input, leaseId: 'reconnected' })).status).toBe('sent');
    await expect(f.queue.enqueue(f.socket, 'message_one', { ...f.input, text: '其他' })).rejects.toHaveProperty('code', 'request_conflict');
    await f.queue.change(f.socket, f.clientId, 'message_two', 'send'); await f.queue.tick();
    expect(f.sent).toHaveLength(2); expect(f.sent[1].action).toBe('prompt');
    expect((await stat(join(f.directory, 'messages.json'))).mode & 0o077).toBe(0);
    expect(await readFile(join(f.directory, 'messages.json'), 'utf8')).not.toContain('token');
  } finally { await f.close(); }
});
test('disconnect, process restart and expired leases never replay waiting messages', async () => {
  const f = await harness(); let recovered: MessageQueue | undefined;
  try {
    await f.queue.enqueue(f.socket, 'message_one', f.input);
    await f.queue.disconnect(f.leaseId); f.state.status = 'idle';
    f.queue.lease(f.socket, f.clientId); await f.queue.tick();
    expect((await f.list())[0].status).toBe('held'); expect(f.sent).toHaveLength(0);
    const leaseId = f.queue.lease(f.socket, f.clientId);
    await f.queue.enqueue(f.socket, 'message_two', { ...f.input, leaseId });
    // Simulate a crash by opening the durable snapshot without a live lease.
    recovered = new MessageQueue(f.directory, f.target);
    recovered.lease(f.socket, f.clientId); await recovered.tick();
    expect((await recovered.list(f.socket, f.clientId)).every(row => row.status === 'held')).toBe(true);
    expect(f.sent).toHaveLength(0);
  } finally { await recovered?.close(); await f.close(); }
});
test('provider idle race is retryable; ambiguous outcomes and changed identities pause delivery', async () => {
  const f = await harness();
  try {
    await f.queue.enqueue(f.socket, 'message_one', f.input); f.state.status = 'idle';
    f.setSend(async () => { throw new BridgeError('queue_not_idle', 'busy', 409); });
    await f.queue.tick(); expect((await f.list())[0].status).toBe('queued');
    f.setSend(async () => { throw new BridgeError('native_timeout', 'unknown delivery', 409); });
    await f.queue.tick(); expect((await f.list())[0].status).toBe('uncertain');
    await expect(f.queue.change(f.socket, f.clientId, 'message_one', 'send')).rejects.toHaveProperty('code', 'queue_uncertain');
    await f.queue.enqueue(f.socket, 'message_two', f.input); f.state.epoch++;
    await f.queue.tick(); expect((await f.list())[1].status).toBe('held');
    f.state.epoch--; await f.queue.enqueue(f.socket, 'message_three', f.input); f.pane.terminal_id = 'replacement';
    await f.queue.tick(); expect((await f.list())[2].status).toBe('held');
    expect(f.sent).toHaveLength(0);
  } finally { await f.close(); }
});
test('manual and automatic sends cannot race a row, and disconnect during state read prevents dispatch', async () => {
  const f = await harness();
  try {
    await f.queue.enqueue(f.socket, 'message_one', f.input); f.state.status = 'idle';
    let release!: () => void;
    f.setSend(async input => { f.sent.push(input); await new Promise<void>(resolve => { release = resolve; }); return { ok: true }; });
    const ticking = f.queue.tick();
    while (!release) await Bun.sleep(1);
    await expect(f.queue.change(f.socket, f.clientId, 'message_one', 'send')).rejects.toHaveProperty('code', 'queue_delivering');
    release(); await ticking; expect(f.sent).toHaveLength(1);
    await f.queue.enqueue(f.socket, 'message_two', f.input);
    const waiting = f.queue.tick(); await f.queue.disconnect(f.leaseId); await waiting;
    expect(f.sent).toHaveLength(1); expect((await f.list())[1].status).toBe('held');
  } finally { await f.close(); }
});
test('controller forgets only explicit idle rejections, preserves ambiguous receipts and fences concurrent starts', async () => {
  const f = await harness();
  const control = new NativeController(f.directory, { herdrSocket: f.socket, paneId: f.pane.pane_id, terminalId: f.pane.terminal_id }, 'codex');
  Object.assign(control.state, f.state, { runtimeId: control.state.runtimeId, status: 'idle' });
  const action: NativeAction = { action: 'prompt_idle', requestId: 'request_idle', runtimeId: control.state.runtimeId, clientId: f.clientId, epoch: 1, conversationId: f.state.conversationId, text: 'next' };
  try {
    let calls = 0;
    control.perform = async () => { calls++; if (calls === 1) throw new BridgeError('queue_not_idle', 'busy', 409); return { ok: true }; };
    await expect(control.dispatch(action)).rejects.toHaveProperty('code', 'queue_not_idle');
    await control.dispatch(action); await control.dispatch(action); expect(calls).toBe(2);
    control.perform = async () => { calls++; throw new BridgeError('native_timeout', 'unknown', 409); };
    const unknown = { ...action, requestId: 'request_unknown' };
    await expect(control.dispatch(unknown)).rejects.toThrow(); await expect(control.dispatch(unknown)).rejects.toThrow(); expect(calls).toBe(3);
  } finally { await f.close(); }
});
test('authenticated queue websocket scopes the lease to the selected session and idle delivery reaches the same live Codex', async () => {
  const f = await createNativeFixture();
  const clientId = 'phone_queue_http';
  const headers = { authorization: `Bearer ${f.config.token}`, 'content-type': 'application/json' };
  let ws: WebSocket | undefined;
  try {
    const pane = f.snapshot.panes[0];
    const claimed = await f.control.dispatch({ action: 'claim', runtimeId: f.control.state.runtimeId, conversationId: f.control.state.conversationId, clientId, epoch: 0, requestId: 'claim_queue_http' });
    const leaseId = await new Promise<string>((resolve, reject) => {
      ws = new WebSocket(f.url.replace('http', 'ws') + '/api/queue/watch');
      ws.onopen = () => ws!.send(JSON.stringify({ type: 'auth', token: f.config.token, clientId, session: 'default' }));
      ws.onmessage = event => { const frame = JSON.parse(String(event.data)); if (frame.type === 'queue-ready') resolve(frame.leaseId); }; ws.onerror = reject;
    });
    f.control.state.status = 'working';
    const response = await fetch(f.url + '/api/queue?session=default', { method: 'POST', headers: { ...headers, 'x-request-id': 'enqueue_http_one' }, body: JSON.stringify({ action: 'enqueue', leaseId, clientId, paneId: pane.pane_id, terminalId: pane.terminal_id, runtimeId: f.control.state.runtimeId, conversationId: f.control.state.conversationId, epoch: (claimed as any).epoch, text: 'from queue' }) });
    expect(response.status).toBe(200); expect((await response.json()).status).toBe('queued');
    f.control.state.status = 'idle';
    let rows: any[] = [];
    for (let i = 0; i < 100; i++) {
      rows = await fetch(f.url + '/api/queue?session=default&clientId=' + clientId, { headers }).then(value => value.json());
      if (rows[0]?.status === 'sent') break; await Bun.sleep(20);
    }
    expect(rows[0]?.status).toBe('sent');
    expect(f.control.state.messages.some(row => row.text === 'from queue')).toBe(true);
    expect(f.calls.filter(row => row.method === 'agent.prompt')).toHaveLength(0);
    expect(rows[0].socket).toBeUndefined(); expect(rows[0].leaseId).toBeUndefined();
  } finally { ws?.close(); await f.close(); }
});

test('idle-only provider action refuses to steer a busy turn even when the displayed status is stale', async () => {
  const f = await createNativeFixture();
  const input = { runtimeId: f.control.state.runtimeId, conversationId: f.control.state.conversationId, clientId: 'phone_idle_fence', epoch: 0 };
  try {
    await f.control.dispatch({ ...input, action: 'claim', requestId: 'claim_idle_fence' }); input.epoch = f.control.state.epoch;
    await f.control.dispatch({ ...input, action: 'prompt', requestId: 'start_idle_fence', text: 'Existing turn' });
    f.control.state.status = 'idle'; // Simulates a stale status frame; the runtime still knows the active turn.
    await expect(f.control.dispatch({ ...input, action: 'prompt_idle', requestId: 'queue_idle_fence', text: 'Must never steer' })).rejects.toHaveProperty('code', 'queue_not_idle');
    expect(f.control.state.messages.filter(row => row.role === 'user')).toHaveLength(1);
    await f.control.dispatch({ ...input, action: 'stop', requestId: 'stop_idle_fence' });
    await f.control.dispatch({ ...input, action: 'prompt_idle', requestId: 'queue_idle_fence', text: 'Must never steer' });
    expect(f.control.state.messages.filter(row => row.role === 'user')).toHaveLength(2);
    const report = await fetch(f.url + '/api/attention?session=default', { headers: { authorization: `Bearer ${f.config.token}` } }).then(response => response.json());
    expect(report.panes.find((row: any) => row.pane_id === 'w1:p1').agent_status).toBe('working');
    expect(f.snapshot.panes[0].agent_status).toBe('idle');
  } finally { await f.close(); }
});

import { expect, test } from 'bun:test';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFixture } from './fixture';
import { api, panePath, watch } from '../shared/client';
import type { HistoryPage, Conversation, Machine } from '../shared/protocol';
import { parseDiff, suppliedChanges } from '../shared/diff';
import { exportDiagnostics } from '../shared/diagnostics';
import { nativeCall } from '../server/native/registry';
import { createNativeFixture } from './native-fixture';

const patch = 'diff --git a/app/a.ts b/app/a.ts\n--- a/app/a.ts\n+++ b/app/a.ts\n@@ -3,2 +3,2 @@\n context\n-old\n+new\n';
test('diff supports hunk coordinates, multiple files, add/delete, tool edits and literal HTML', () => {
  const files = parseDiff(patch + '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+<script>literal</script>\n');
  expect(files).toHaveLength(2); expect(files[0]).toMatchObject({ path: 'app/a.ts', added: 1, removed: 1 });
  expect(files[0].lines.find(row => row.type === 'remove')).toMatchObject({ old: 4, text: 'old' });
  expect(files[0].lines.find(row => row.type === 'add')).toMatchObject({ next: 4, text: 'new' });
  expect(files[1]).toMatchObject({ path: 'new.txt', status: 'add' });
  expect(suppliedChanges({ path: '中文.ts', oldText: '旧', newText: '新' })[0]).toMatchObject({ added: 1, removed: 1 });
  expect(parseDiff('ordinary text\n+not a patch')).toEqual([]);
  expect(parseDiff('*** Begin Patch\n*** Update File: x.ts\n@@\n-old\n+new\n*** End Patch')[0].added).toBe(1);
});
test('history pages are complete, Unicode-safe, stable on append and fenced to exact transcript', async () => {
  const f = await createFixture(); const machine: Machine = { id: 'history', name: '', url: f.url, token: f.config.token };
  try {
    const records = Array.from({ length: 207 }, (_, i) => JSON.stringify({ message: { role: i % 2 ? 'assistant' : 'user', content: `history-${i} 中文` } }));
    await writeFile(f.transcript, records.join('\n') + '\n');
    const latest = await api<Conversation>(machine, panePath('default', 'w1:p1', 'chat'));
    expect(latest.messages).toHaveLength(60); expect(latest.history?.hasMore).toBe(true);
    const all = [...latest.messages]; let cursor = latest.history?.cursor;
    const path = panePath('default', 'w1:p1', 'history');
    const saved = await api<HistoryPage>(machine, path + '&cursor=' + cursor);
    await appendFile(f.transcript, JSON.stringify({ id: 'later', message: { role: 'user', content: 'new append' } }) + '\n');
    expect((await api<HistoryPage>(machine, path + '&cursor=' + cursor)).messages).toEqual(saved.messages);
    while (cursor) { const page = await api<HistoryPage>(machine, path + '&cursor=' + cursor); all.unshift(...page.messages); cursor = page.cursor; }
    expect(all).toHaveLength(207); expect(new Set(all.map(row => row.id)).size).toBe(207); expect(all[0].text).toBe('history-0 中文');
    const other = join(f.config.piHome, 'sessions/project/other.jsonl'); await writeFile(other, records.join('\n') + '\n');
    f.snapshot.panes[0].agent_session!.value = other;
    await expect(api(machine, path + '&cursor=' + latest.history!.cursor)).rejects.toMatchObject({ code: 'history_changed' });
    await expect(api(machine, path + '&cursor=invalid')).rejects.toMatchObject({ code: 'history_changed' });
  } finally { await f.close(); }
});
test('native retained history is read-only and rejects a changed conversation', async () => {
  const f = await createNativeFixture();
  try {
    f.control.readHistory = undefined;
    for (let i = 0; i < 240; i++) f.control.message({ id: `archived-${i}`, role: i % 2 ? 'assistant' : 'user', text: `entry ${i}` });
    const owner = f.control.state.owner, epoch = f.control.state.epoch;
    const query = { runtimeId: f.control.state.runtimeId, conversationId: f.control.state.conversationId! };
    let page = await nativeCall<HistoryPage>(f.control.record.endpoint, { method: 'history', history: query });
    const messages = [...page.messages];
    while (page.cursor) { page = await nativeCall(f.control.record.endpoint, { method: 'history', history: { ...query, cursor: page.cursor } }); messages.unshift(...page.messages); }
    expect(messages).toHaveLength(240); expect(f.control.state.owner).toBe(owner); expect(f.control.state.epoch).toBe(epoch);
    f.control.state.conversationId = 'other-exact-thread';
    await expect(nativeCall(f.control.record.endpoint, { method: 'history', history: query })).rejects.toMatchObject({ code: 'history_changed' });
    const empty = await nativeCall<HistoryPage>(f.control.record.endpoint, { method: 'history', history: { ...query, conversationId: 'other-exact-thread' } }); expect(empty.messages).toEqual([]);
  } finally { await f.close(); }
});
test('watch reconnects a silent socket, refreshes ownership and sends only auth/heartbeat', async () => {
  let connections = 0, silent = false; const frames: any[] = [], states: any[] = [];
  const server = Bun.serve<{ id: number }>({ port: 0, hostname: '127.0.0.1', fetch(req, s) { s.upgrade(req, { data: { id: ++connections } }); }, websocket: {
    message(ws, data) { const frame = JSON.parse(String(data)); frames.push(frame); if (frame.type === 'auth') ws.send(JSON.stringify({ type: 'state', native: { owner: ws.data.id === 1 ? 'phone-first' : 'desktop' } })); else if (!silent) ws.send('{"type":"pong"}'); },
  } });
  let stop: (() => void) | undefined;
  try {
    stop = watch({ id: 'test', name: '', url: `http://127.0.0.1:${server.port}`, token: 'fixture-only' }, 'default', 'w1:p1', state => states.push(state), () => {}, { heartbeatMs: 15, timeoutMs: 70, retryMs: 10 });
    for (let i = 0; i < 50 && !states.length; i++) await Bun.sleep(10);
    silent = true;
    for (let i = 0; i < 100 && connections < 2; i++) await Bun.sleep(10);
    expect(connections).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 50 && states.at(-1)?.native?.owner !== 'desktop'; i++) await Bun.sleep(10);
    expect(states.at(-1)?.native?.owner).toBe('desktop'); expect(frames.every(row => ['auth', 'ping'].includes(row.type))).toBe(true);
  } finally { stop?.(); server.stop(true); }
});
test('diagnostic exports contain only allowlisted versions and status', async () => {
  const f = await createFixture();
  try {
    const machine: Machine = { id: 'test', name: 'secret-host', url: f.url, token: f.config.token };
    const report = await api<any>(machine, '/api/diagnostics?session=default&pane=w1%3Ap1');
    report.token = machine.token; report.path = f.directory; report.hostname = machine.name; report.transcript = 'private message';
    report.bunVersion = machine.token;
    const text = exportDiagnostics(report, '0.2.2-beta.test');
    expect(text).not.toContain(machine.token); expect(text).not.toContain(f.directory); expect(text).not.toContain('private message'); expect(text).not.toContain('secret-host');
    expect(JSON.parse(text).herdr).toMatchObject({ connected: true, protocol: 22 });
  } finally { await f.close(); }
});

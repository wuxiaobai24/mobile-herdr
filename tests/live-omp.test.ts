import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { nativeCall } from '../server/native/registry';
import { rpc } from '../server/rpc';
import type { NativeAction, NativeState } from '../shared/native';
import { localModel } from './local-model';

test.skipIf(process.env.MOBILE_HERDR_OMP_LIVE !== '1')('installed OMP extension keeps the same provider and conversation across phone control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-omp-'));
  const home = join(directory, 'home'), native = join(directory, 'native'), model = localModel();
  await mkdir(home);
  await writeFile(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: model.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-model', reasoning: true, contextWindow: 32000, maxTokens: 1024 }] } } }));
  const questions = join(directory, 'questions.ts');
  await writeFile(questions, `export default function(pi) { pi.on('before_agent_start', async (_event, ctx) => { if (!await ctx.ui.confirm('隔离确认', '测试手机审批')) throw Error('declined'); }); }`);
  const child = Bun.spawn([process.env.MOBILE_HERDR_OMP_BINARY ?? 'omp', '--mode', 'rpc', '--no-extensions', '--no-skills', '--extension', resolve('plugins/pi/mobile-herdr.ts'), '--extension', questions, '--model', 'fixture/fixture-model', '--session-dir', join(directory, 'sessions')], {
    cwd: directory, env: { ...process.env, HERDR_SOCKET: join(directory, 'herdr.sock'), HERDR_SOCKET_PATH: join(directory, 'herdr.sock'), HERDR_PANE_ID: 'test:p1', HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined, PI_CODING_AGENT_DIR: home, MOBILE_HERDR_PROVIDER: 'omp', MOBILE_HERDR_NATIVE_DIRECTORY: native, MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify({ herdrSocket: join(directory, 'herdr.sock'), paneId: 'test:p1', terminalId: 'owned-test' }) }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  let output = ''; void (async () => { for await (const bytes of child.stdout) output += new TextDecoder().decode(bytes); })();
  void (async () => { for await (const bytes of child.stderr) output += new TextDecoder().decode(bytes); })();
  async function until(check: () => Promise<boolean>) { for (let i = 0; i < 150; i++) { if (await check()) return; if (child.exitCode !== null) break; await Bun.sleep(100); } throw new Error(`OMP fixture did not reach expected state: ${output.slice(-3000)}`); }
  try {
    let record: any;
    await until(async () => { const name = (await readdir(native).catch(() => [])).find(row => row.endsWith('.json')); if (name) record = JSON.parse(await readFile(join(native, name), 'utf8')); return !!record; });
    async function state(): Promise<NativeState> { return nativeCall(record.endpoint, { method: 'state' }); }
    let sequence = 0;
    async function act(action: NativeAction['action'], values = {}) { const current = await state(); return nativeCall(record.endpoint, { method: 'action', input: { action, runtimeId: current.runtimeId, clientId: 'test-phone', conversationId: current.conversationId, epoch: current.epoch, requestId: 'real-omp-' + ++sequence, ...values } }); }
    const before = await state(); expect(before.provider).toBe('omp'); expect(before.conversationId).toBeTruthy();
    await act('claim'); await act('prompt_idle', { text: 'Return the confirmation text only.' });
    await until(async () => (await state()).requests.some(row => row.kind === 'approval'));
    await act('reply', { request: (await state()).requests[0].id, decision: 'accept' });
    await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.some(row => row.text === '本地隔离验证成功'); });
    await act('release'); const after = await state();
    expect(after.owner).toBe('desktop'); expect(after.runtimeId).toBe(before.runtimeId); expect(after.conversationId).toBe(before.conversationId); expect(model.requests).toBe(1);
  } finally { child.kill(); await child.exited; model.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

test.skipIf(process.env.MOBILE_HERDR_OMP_LIVE !== '1')('isolated Herdr accepts OMP provider reports without changing another session', async () => {
  const name = `mobile-herdr-omp-test-${Date.now()}`;
  const socket = join(homedir(), '.config/herdr/sessions', name, 'herdr.sock');
  const directory = await mkdtemp(join(tmpdir(), 'mh-omp-herdr-'));
  const child = Bun.spawn(['herdr', '--session', name, 'server'], { stdout: 'ignore', stderr: 'ignore', env: { ...process.env, HERDR_SOCKET: undefined, HERDR_SOCKET_PATH: undefined, HERDR_PANE_ID: undefined, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined } });
  let launcher: Bun.Subprocess | undefined, terminal: Bun.Terminal | undefined;
  try {
    let ready = false; for (let i = 0; i < 100; i++) { try { await rpc(socket, 'ping'); ready = true; break; } catch { await Bun.sleep(50); } }
    expect(ready).toBe(true);
    const created = await rpc<any>(socket, 'workspace.create', { cwd: directory, label: 'omp-fixture', focus: false });
    const home = join(directory, 'home'); await mkdir(home);
    terminal = new Bun.Terminal({ cols: 100, rows: 30, data(pty, bytes) { const output = new TextDecoder().decode(bytes); if (output.includes('\u001b[6n')) pty.write('\u001b[1;1R'); if (output.includes('\u001b[c')) pty.write('\u001b[?1;2c'); } });
    launcher = Bun.spawn([process.execPath, 'run', resolve('scripts/agent.ts'), 'omp'], { cwd: directory, terminal, env: { ...process.env, TERM: 'xterm-256color', HERDR_SOCKET: socket, HERDR_SOCKET_PATH: socket, HERDR_PANE_ID: created.root_pane.pane_id, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined, PI_CODING_AGENT_DIR: home, MOBILE_HERDR_STATE: directory } });
    let snapshot: any;
    for (let i = 0; i < 150; i++) { ({ snapshot } = await rpc<any>(socket, 'session.snapshot')); if (snapshot.panes.find((row: any) => row.pane_id === created.root_pane.pane_id)?.agent === 'omp') break; if (launcher.exitCode !== null) break; await Bun.sleep(100); }
    expect(snapshot.panes.find((row: any) => row.pane_id === created.root_pane.pane_id)?.agent).toBe('omp');
    const names = await readdir(join(directory, 'native')); expect(names.some(row => row.endsWith('.json'))).toBe(true);
  } finally { launcher?.kill(); if (launcher) await launcher.exited; terminal?.close(); await rpc(socket, 'server.stop').catch(() => child.kill()); await child.exited; await rm(directory, { recursive: true, force: true }); await rm(join(homedir(), '.config/herdr/sessions', name), { recursive: true, force: true }); }
}, 20000);

test.skipIf(process.env.MOBILE_HERDR_OMP_LIVE !== '1')('installed OMP TUI fences keyboard input while phone owns the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-omp-tui-'));
  const home = join(directory, 'home'), native = join(directory, 'native'), model = localModel();
  await mkdir(home);
  await writeFile(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: model.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-model', contextWindow: 32000, maxTokens: 1024 }] } } }));
  const terminal = new Bun.Terminal({ cols: 100, rows: 30, data(pty, bytes) { const output = new TextDecoder().decode(bytes); if (output.includes('\u001b[6n')) pty.write('\u001b[1;1R'); if (output.includes('\u001b[c')) pty.write('\u001b[?1;2c'); } });
  const child = Bun.spawn([process.env.MOBILE_HERDR_OMP_BINARY ?? 'omp', '--no-extensions', '--no-skills', '--extension', resolve('plugins/pi/mobile-herdr.ts'), '--model', 'fixture/fixture-model', '--session-dir', join(directory, 'sessions')], {
    cwd: directory, terminal, env: { ...process.env, TERM: 'xterm-256color', HERDR_SOCKET: join(directory, 'herdr.sock'), HERDR_SOCKET_PATH: join(directory, 'herdr.sock'), HERDR_PANE_ID: 'test:p1', HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined, PI_CODING_AGENT_DIR: home, MOBILE_HERDR_PROVIDER: 'omp', MOBILE_HERDR_NATIVE_DIRECTORY: native, MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify({ herdrSocket: join(directory, 'herdr.sock'), paneId: 'test:p1', terminalId: 'owned-test' }) },
  });
  try {
    let record: any;
    for (let i = 0; i < 150 && !record; i++) { const name = (await readdir(native).catch(() => [])).find(row => row.endsWith('.json')); if (name) record = JSON.parse(await readFile(join(native, name), 'utf8')); else await Bun.sleep(100); }
    expect(record).toBeTruthy();
    const state = () => nativeCall<NativeState>(record.endpoint, { method: 'state' });
    const before = await state();
    await nativeCall(record.endpoint, { method: 'action', input: { action: 'claim', runtimeId: before.runtimeId, clientId: 'test-phone', conversationId: before.conversationId, epoch: before.epoch, requestId: 'omp-tui-claim' } });
    terminal.write('must not reach provider\r'); await Bun.sleep(500);
    expect(model.requests).toBe(0); expect((await state()).messages.some(row => row.role === 'user')).toBe(false);
    terminal.write('\u001d');
    for (let i = 0; i < 30 && (await state()).owner !== 'desktop'; i++) await Bun.sleep(100);
    expect((await state()).owner).toBe('desktop');
  } finally { child.kill(); await child.exited; terminal.close(); model.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

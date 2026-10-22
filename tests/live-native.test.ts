import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeController } from '../server/native/controller';
import { CodexRuntime } from '../server/native/codex';
import { nativeCall } from '../server/native/registry';
import type { HistoryPage } from '../shared/protocol';
import type { NativeAction, NativeState } from '../shared/native';
import { localModel } from './local-model';

const live = test.skipIf(process.env.MOBILE_HERDR_NATIVE_LIVE !== '1');
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 150; i++) { if (await check()) return; await Bun.sleep(100); }
  throw new Error('Native provider did not reach the expected state.');
}
live('installed Codex: native phone turn and official TUI share the same app-server and thread', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-codex-'));
  const model = localModel(); const home = join(directory, 'home');
  await mkdir(home);
  await writeFile(join(home, 'config.toml'), `model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="${model.url}"\nwire_api="responses"\nrequires_openai_auth=false\n`);
  const env = { ...process.env, CODEX_HOME: home, TERM: 'xterm-256color' };
  const control = new NativeController(directory, { herdrSocket: join(directory, 'herdr.sock'), paneId: 'test:p1', terminalId: 'owned-test' }, 'codex');
  const runtime = new CodexRuntime(control, process.env.MOBILE_HERDR_CODEX_BINARY ?? 'codex', [], env);
  let tui: Bun.Subprocess | undefined; let terminal: Bun.Terminal | undefined;
  try {
    await runtime.listen(join(directory, 'desktop.sock')); await control.listen();
    terminal = new Bun.Terminal({ cols: 100, rows: 30, data(terminal, bytes) {
      const output = new TextDecoder().decode(bytes);
      if (output.includes('\u001b[6n')) terminal.write('\u001b[1;1R');
      if (output.includes('\u001b[c')) terminal.write('\u001b[?1;2c');
    } });
    tui = Bun.spawn([process.env.MOBILE_HERDR_CODEX_BINARY ?? 'codex', '--remote', `unix://${join(directory, 'desktop.sock')}`, '--no-alt-screen', '-C', directory], { env, terminal });
    // Trust is granted only for this test-created directory and temporary configuration.
    const trust = setInterval(() => { if (!control.state.conversationId) terminal?.write('\r'); }, 500);
    try { await until(() => !!control.state.conversationId && control.state.ready !== false); } finally { clearInterval(trust); }
    const thread = control.state.conversationId;
    expect(thread).toBeTruthy();
    let sequence = 0;
    async function act(action: NativeAction['action'], values = {}) { return control.dispatch({ action, runtimeId: control.state.runtimeId, clientId: 'test-phone', epoch: control.state.epoch, requestId: 'real-codex-' + ++sequence, ...values }); }
    await act('claim'); await act('prompt', { text: 'Return the confirmation text only.' });
    await until(() => control.state.status === 'idle' && control.state.messages.some(row => row.text === '本地隔离验证成功'));
    expect(model.requests).toBeGreaterThan(0);
    await act('release');
    terminal.write('\u001b[200~Continue with the same confirmation.\u001b[201~');
    await Bun.sleep(150); terminal.write('\r');
    await until(() => control.state.messages.filter(row => row.role === 'user').length === 2 && control.state.status === 'idle');
    expect(control.state.conversationId).toBe(thread);
    expect(control.state.messages.filter(row => row.role === 'user')).toHaveLength(2);
    const epoch = control.state.epoch;
    const history = await nativeCall<HistoryPage>(control.record.endpoint, { method: 'history', history: { runtimeId: control.state.runtimeId, conversationId: thread! } });
    expect(history.messages.filter(row => row.role === 'user')).toHaveLength(2); expect(control.state.epoch).toBe(epoch);
  } finally { tui?.kill(); if (tui) await tui.exited; terminal?.close(); await runtime.close(); await control.close(); model.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

live('installed Pi: same process forwards extension approvals and questions, then resumes the desktop owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-pi-'));
  const home = join(directory, 'home'); const native = join(directory, 'native'); const model = localModel();
  await mkdir(home);
  await writeFile(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: model.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-model', contextWindow: 32000, maxTokens: 1024 }] } } }));
  const questions = join(directory, 'questions.ts');
  await writeFile(questions, `export default function(pi) { pi.on('before_agent_start', async (_event, ctx) => { if (!await ctx.ui.confirm('本次工具确认', '这是隔离测试')) throw Error('declined'); const answer=await ctx.ui.select('选择主题', ['深色','浅色']); if(answer!=='深色') throw Error('unexpected answer'); }); }`);
  const child = Bun.spawn([process.env.MOBILE_HERDR_PI_BINARY ?? 'pi', '--mode', 'rpc', '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes', '--extension', resolve('plugins/pi/mobile-herdr.ts'), '--extension', questions, '--model', 'fixture/fixture-model', '--session-dir', join(directory, 'sessions')], {
    cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: home, MOBILE_HERDR_NATIVE_DIRECTORY: native, MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify({ herdrSocket: join(directory, 'herdr.sock'), paneId: 'test:p1', terminalId: 'owned-test' }) }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  void (async () => { for await (const _ of child.stdout) {} })();
  void (async () => { for await (const _ of child.stderr) {} })();
  try {
    let record: any;
    await until(async () => { const name = (await readdir(native).catch(() => [])).find(name => name.endsWith('.json')); if (name) record = JSON.parse(await readFile(join(native, name), 'utf8')); return !!record; });
    async function state(): Promise<NativeState> { return nativeCall(record.endpoint, { method: 'state' }); }
    let sequence = 0;
    async function act(action: NativeAction['action'], values = {}) { const current = await state(); return nativeCall(record.endpoint, { method: 'action', input: { action, runtimeId: current.runtimeId, clientId: 'test-phone', epoch: current.epoch, requestId: 'real-pi-' + ++sequence, ...values } }); }
    const before = await state(); await act('claim'); await act('prompt', { text: 'Return the confirmation text only.' });
    await until(async () => (await state()).requests[0]?.kind === 'approval');
    await act('reply', { request: (await state()).requests[0].id, decision: 'accept' });
    await until(async () => (await state()).requests[0]?.kind === 'question');
    await act('reply', { request: (await state()).requests[0].id, answers: { answer: ['深色'] } });
    await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.some(row => row.text === '本地隔离验证成功'); });
    await act('release'); const after = await state();
    expect(after.owner).toBe('desktop'); expect(after.runtimeId).toBe(before.runtimeId); expect(after.conversationId).toBe(before.conversationId);
    expect(after.requests).toHaveLength(0); expect(model.requests).toBe(1);
  } finally { child.kill(); await child.exited; model.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

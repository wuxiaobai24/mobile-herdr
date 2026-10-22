import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { rpc } from '../server/rpc';
import { nativeCall } from '../server/native/registry';
import type { NativeRecord } from '../server/native/controller';
import type { NativeAction, NativeState } from '../shared/native';
import type { Pane, Snapshot } from '../shared/protocol';
import { localModel } from '../tests/local-model';

const directory = await mkdtemp(join(tmpdir(), 'mhh-'));
const name = `mobile-native-test-${Date.now()}`;
const sessionDirectory = join(homedir(), '.config/herdr/sessions', name);
const socket = join(sessionDirectory, 'herdr.sock');
const model = localModel();
const home = join(directory, 'home');
const nativeDirectory = join(directory, 'state/native');
await mkdir(home);
// Fail closed on loopback if the launcher's config forwarding regresses.
await writeFile(join(home, 'config.toml'), `model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
const server = Bun.spawn(['herdr', '--session', name, 'server'], { stdout: 'ignore', stderr: 'ignore' });
let record: NativeRecord | undefined;
const ownedHosts = new Map<number, NativeRecord>();
let stage = 'startup';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
async function until(check: () => Promise<boolean>, attempts = 100): Promise<void> {
  for (let index = 0; index < attempts; index++) { if (await check()) return; await Bun.sleep(100); }
  throw new Error(`Isolated Herdr handoff did not reach its expected state: ${stage}.`);
}
async function state(): Promise<NativeState> {
  if (!record) throw new Error('Native registration missing.');
  return nativeCall(record.endpoint, { method: 'state' });
}

try {
  await until(async () => { try { await rpc(socket, 'ping'); return true; } catch { return false; } });
  const created = await rpc<{ root_pane: Pane }>(socket, 'workspace.create', { cwd: directory, label: 'native-test', focus: false });
  const pane = created.root_pane;
  const prefix = `env CODEX_HOME=${quote(home)} MOBILE_HERDR_STATE=${quote(join(directory, 'state'))} ${quote(process.execPath)} run ${quote(resolve(import.meta.dir, 'agent.ts'))}`;
  const command = `${prefix} codex -c ${quote('model_providers.fixture.base_url=' + JSON.stringify(model.url))}`;
  await rpc(socket, 'pane.send_text', { pane_id: pane.pane_id, text: command });
  await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['enter'] });
  let polls = 0;
  await until(async () => {
    const file = (await readdir(nativeDirectory).catch(() => [])).find(file => /^[a-f0-9-]{36}\.json$/.test(file));
    if (file) { record = JSON.parse(await readFile(join(nativeDirectory, file), 'utf8')); ownedHosts.set(record!.pid, record!); }
    if (record) { const current = await state(); if (current.conversationId && current.ready !== false) return true; }
    // Grant trust only in this test-created directory, in this test's owned pane.
    if ([25, 50, 75].includes(++polls)) await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['enter'] });
    return false;
  }, 120);
  let sequence = 0;
  async function act(action: NativeAction['action'], values: Partial<NativeAction> = {}): Promise<unknown> {
    const current = await state();
    return nativeCall(record!.endpoint, { method: 'action', input: { action, runtimeId: current.runtimeId, clientId: 'test-phone', epoch: current.epoch, requestId: 'herdr-test-' + ++sequence, ...values } });
  }
  const before = await state();
  stage = 'mobile turn with launch config';
  await act('claim');
  await act('prompt', { text: 'Return the confirmation text only.' });
  await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.some(row => row.role === 'assistant'); });
  await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['ctrl+]'] });
  stage = 'desktop reclaim';
  await until(async () => (await state()).owner === 'desktop');
  await rpc(socket, 'agent.prompt', { target: pane.pane_id, text: 'Continue with the same confirmation.' });
  stage = 'desktop turn';
  await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.filter(row => row.role === 'user').length === 2; });
  const current = await state();
  // Exit only this test's TUI, keeping its detached agent. Reattach through the launcher.
  await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['ctrl+c'] });
  stage = 'exit desktop TUI';
  await Bun.sleep(150);
  await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['ctrl+c'] });
  await until(async () => {
    const files = await readdir(nativeDirectory);
    return !files.some(file => file.startsWith('launch-') && file.endsWith('.lock'));
  });
  const reopenEpoch = (await state()).epoch;
  await rpc(socket, 'pane.send_text', { pane_id: pane.pane_id, text: `${prefix} codex` });
  await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['enter'] });
  stage = 'reopen desktop TUI';
  await until(async () => {
    const files = await readdir(nativeDirectory);
    const current = await state();
    return files.some(file => file.startsWith('launch-') && file.endsWith('.lock')) && current.epoch > reopenEpoch && current.ready !== false;
  });
  await act('claim');
  stage = 'mobile turn after reopen';
  await act('prompt', { text: 'Continue after reopening the desktop TUI.' });
  await until(async () => (await state()).status === 'idle' && (await state()).messages.filter(row => row.role === 'user').length === 3);
  await act('release');
  const reopened = await state();
  const snapshot = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
  const after = snapshot.snapshot.panes.find(row => row.pane_id === pane.pane_id);
  const checks = {
    conversation: !!current.conversationId,
    reply: current.messages.some(row => row.text === '本地隔离验证成功'),
    desktopReclaimed: current.owner === 'desktop',
    sameTerminal: after?.terminal_id === pane.terminal_id,
    sameRuntime: current.runtimeId === before.runtimeId,
    sameConversation: current.conversationId === before.conversationId,
    desktopReply: current.messages.filter(row => row.role === 'user').length === 2,
    herdrAgent: after?.agent === 'codex',
    sameRuntimeAfterReopen: reopened.runtimeId === before.runtimeId,
    sameConversationAfterReopen: reopened.conversationId === before.conversationId,
    mobileAfterReopen: reopened.messages.filter(row => row.role === 'user').length === 3,
    launchConfig: model.requests >= 3,
  };
  if (Object.values(checks).some(value => !value)) throw new Error('Herdr native handoff failed.');
  const piHome = join(directory, 'pi-home');
  await mkdir(piHome);
  await writeFile(join(piHome, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: model.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-model', contextWindow: 32000, maxTokens: 1024 }] } } }));
  const piWorkspace = await rpc<{ root_pane: Pane }>(socket, 'workspace.create', { cwd: directory, label: 'pi-native-test', focus: false });
  const piPane = piWorkspace.root_pane;
  const piCommand = `env PI_CODING_AGENT_DIR=${quote(piHome)} MOBILE_HERDR_STATE=${quote(join(directory, 'state'))} ${quote(process.execPath)} run ${quote(resolve(import.meta.dir, 'agent.ts'))} pi --no-extensions --no-mcp --no-context-files --no-skills --no-prompt-templates --no-themes --no-approve --offline --model fixture/fixture-model`;
  stage = 'Pi TUI startup';
  await rpc(socket, 'pane.send_text', { pane_id: piPane.pane_id, text: piCommand });
  await rpc(socket, 'pane.send_keys', { pane_id: piPane.pane_id, keys: ['enter'] });
  await until(async () => {
    for (const file of (await readdir(nativeDirectory)).filter(file => /^[a-f0-9-]{36}\.json$/.test(file))) {
      const candidate = JSON.parse(await readFile(join(nativeDirectory, file), 'utf8')) as NativeRecord;
      if (candidate.provider === 'pi' && candidate.terminalId === piPane.terminal_id) { record = candidate; ownedHosts.set(record.pid, record); return !!(await state()).conversationId; }
    }
    return false;
  });
  const piBefore = await state();
  await act('claim');
  stage = 'Pi phone turn';
  await act('prompt', { text: 'Return the confirmation text only.' });
  await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.some(row => row.text === '本地隔离验证成功'); });
  await rpc(socket, 'pane.send_keys', { pane_id: piPane.pane_id, keys: ['ctrl+]'] });
  stage = 'Pi desktop reclaim';
  await until(async () => (await state()).owner === 'desktop');
  await rpc(socket, 'agent.prompt', { target: piPane.pane_id, text: 'Continue with the same confirmation.' });
  stage = 'Pi desktop turn';
  await until(async () => { const current = await state(); return current.status === 'idle' && current.messages.filter(row => row.role === 'user').length === 2; });
  const piAfter = await state();
  const piSnapshot = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
  const piChecks = {
    piSameRuntime: piBefore.runtimeId === piAfter.runtimeId,
    piSameConversation: piBefore.conversationId === piAfter.conversationId,
    piSameTerminal: piSnapshot.snapshot.panes.find(row => row.pane_id === piPane.pane_id)?.terminal_id === piPane.terminal_id,
    piDesktopReclaimed: piAfter.owner === 'desktop',
    piBothTurns: piAfter.messages.filter(row => row.role === 'user').length === 2,
  };
  console.log(JSON.stringify({ ...checks, ...piChecks }));
  if (Object.values(piChecks).some(value => !value)) throw new Error('Herdr Pi native handoff failed.');
} catch (error) {
  const current = record ? await state().catch(() => undefined) : undefined;
  console.error(JSON.stringify({ stage, status: current?.status, ready: current?.ready, owner: current?.owner, requests: model.requests,
    messages: current?.messages.map(row => ({ id: row.id, role: row.role })), error: current?.error }));
  throw error;
} finally {
  for (const owned of ownedHosts.values()) {
    try { process.kill(owned.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  await Bun.sleep(500);
  await rpc(socket, 'server.stop').catch(() => server.kill());
  await server.exited;
  model.close();
  await rm(directory, { recursive: true, force: true });
  await rm(sessionDirectory, { recursive: true, force: true });
}

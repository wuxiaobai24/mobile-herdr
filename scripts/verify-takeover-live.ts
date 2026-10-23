import { codexStatusConversation, daemonHasThread } from '../server/native/codex-daemon';
import { codexSessionForProcess } from '../server/native/takeover';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBridge } from '../server/server';
import { loadConfig } from '../server/config';
import { rpc } from '../server/rpc';
import { api, panePath } from '../shared/client';
import type { Machine, Pane, Snapshot } from '../shared/protocol';
import type { NativeState } from '../shared/native';
import type { TakeoverState } from '../shared/takeover';
import { localModel } from '../tests/local-model';

const directory = await mkdtemp(join(tmpdir(), 'mh-takeover-'));
const name = 'mobile-takeover-test-' + Date.now();
const sessionDirectory = join(homedir(), '.config/herdr/sessions', name), socket = join(sessionDirectory, 'herdr.sock');
const stateDir = join(directory, 'state'), piHome = join(directory, 'pi'), codexHome = join(directory, 'codex');
await mkdir(piHome); await mkdir(codexHome);
const model = localModel();
await writeFile(join(piHome, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: model.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-model', contextWindow: 32000, maxTokens: 1024 }] } } }));
await writeFile(join(codexHome, 'config.toml'), `model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="${model.url}"\nwire_api="responses"\nrequires_openai_auth=false\n[projects.${JSON.stringify(directory)}]\ntrust_level="trusted"\n`);
const herdr = Bun.spawn(['herdr', '--session', name, 'server'], { stdout: 'ignore', stderr: 'ignore' });
const config = { ...await loadConfig({ token: 'isolated-takeover-test-key-12345678' }), socket, port: 0, stateDir, piHome, codexHome };
let packaged: Bun.Subprocess | undefined;
const releaseRoot = process.env.MOBILE_HERDR_TEST_RELEASE_ROOT;
const bridge = releaseRoot ? undefined : createBridge(config, {runtimeRoot:process.env.MOBILE_HERDR_TEST_RUNTIME_ROOT});
let url = `http://127.0.0.1:${bridge?.port}`;
if (releaseRoot) {
  const started = Bun.spawn([process.execPath, 'run', join(releaseRoot, 'server/index.ts')], { env: { ...process.env, MOBILE_HERDR_HOST: '127.0.0.1', MOBILE_HERDR_PORT: '0', MOBILE_HERDR_STATE: stateDir, MOBILE_HERDR_SOCKET: socket, MOBILE_HERDR_TOKEN: config.token, PI_CODING_AGENT_DIR: piHome, CODEX_HOME: codexHome, MOBILE_HERDR_SSH_DISCOVERY: '0' }, stdout: 'pipe', stderr: 'ignore' });
  packaged = started;
  const reader = started.stdout.getReader(); let output = '';
  while (!output.includes('\n')) { const { value, done } = await reader.read(); if (done) throw new Error('Packaged bridge failed.'); output += new TextDecoder().decode(value); }
  reader.releaseLock(); url = output.split('\n')[0].split(' · ')[1];
}
const machine: Machine = { id: 'test', name: 'test', url, token: config.token };
let stage = 'startup';
const ownedHosts = new Set<number>();
function quote(text: string): string { return "'" + text.replaceAll("'", "'\\''") + "'"; }
async function until(check: () => Promise<boolean>, count = 150): Promise<void> { for (let i = 0; i < count; i++) { if (await check()) return; await Bun.sleep(200); } throw new Error('Timed out: ' + stage); }
async function snapshot(): Promise<Snapshot> { return (await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot')).snapshot; }
async function input(pane: Pane, command: string): Promise<void> { await rpc(socket, 'pane.send_text', { pane_id: pane.pane_id, text: command }); await rpc(socket, 'pane.send_keys', { pane_id: pane.pane_id, keys: ['enter'] }); }
async function ownedDaemonPids(): Promise<number[]> {
  const ids: number[] = [];
  for (const pid of (await readdir('/proc')).filter(row => /^\d+$/.test(row))) {
    const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
    if (!args.includes('app-server') || args.includes('proxy')) continue;
    const env = (await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')).split('\0');
    if (env.includes('CODEX_HOME=' + codexHome)) ids.push(Number(pid));
  }
  return ids.sort((a,b)=>a-b);
}
async function takeover(pane: Pane): Promise<NativeState> {
  const path = panePath('default', pane.pane_id, 'takeover');
  const current = (await snapshot()).panes.find(row => row.pane_id === pane.pane_id)!;
  await api(machine, path, { body: { clientId: 'live-test-phone', agent: current.agent, terminalId: current.terminal_id, conversation: current.agent_session?.value } });
  let status: TakeoverState | null;
  await until(async () => { status = await api(machine, path); if (status?.phase === 'failed') throw new Error(status.message); return status?.phase === 'ready'; }, 300);
  return api<NativeState>(machine, panePath('default', pane.pane_id, 'native'));
}
try {
  await until(async () => { try { await snapshot(); return true; } catch { return false; } });
  for (const provider of (process.argv.includes('--codex-only') ? ['codex'] : ['pi', 'codex']) as ('pi' | 'codex')[]) {
    stage = provider + ' startup';
    const { root_pane: pane } = await rpc<{ root_pane: Pane }>(socket, 'workspace.create', { cwd: directory, label: 'takeover-' + provider, focus: false });
    const flags = provider === 'pi' ? '--no-mcp --no-context-files --no-skills --no-prompt-templates --no-themes --no-approve --offline --model fixture/fixture-model' : '--no-alt-screen';
    await input(pane, `env PI_CODING_AGENT_DIR=${quote(piHome)} CODEX_HOME=${quote(codexHome)} ${provider} ${flags}`);
    await until(async () => (await snapshot()).panes.find(row => row.pane_id === pane.pane_id)?.agent === provider);
    // Only this test-owned pane is used for the initial turn.
    await Bun.sleep(3500);
    await rpc(socket, 'agent.prompt', { target: pane.pane_id, text: 'Return the confirmation text only.' });
    stage = provider + ' initial turn';
    let current: Pane | undefined;
    if (provider === 'pi') {
      await until(async () => model.requests > 0);
      await Bun.sleep(500);
      const files = await Array.fromAsync(new Bun.Glob('sessions/**/*.jsonl').scan({ cwd: piHome, absolute: true }));
      if (files.length !== 1) throw new Error('Test session missing.');

    }
    await until(async () => { current = (await snapshot()).panes.find(row => row.pane_id === pane.pane_id); return current?.agent_status === 'idle' && true; });
    const before = await rpc<{ process_info: { foreground_processes: { pid: number }[] } }>(socket, 'pane.process_info', { pane_id: pane.pane_id });
    if (provider === 'codex') { await rpc(socket,'agent.prompt',{target:pane.pane_id,text:'/status'}); await Bun.sleep(500); }
    const originalConversation = provider === 'codex' ? codexStatusConversation((await rpc<{read:{text:string}}>(socket,'pane.read',{pane_id:pane.pane_id,source:'recent_unwrapped',lines:120,strip_ansi:true})).read.text) : JSON.parse((await readFile((await Array.fromAsync(new Bun.Glob('sessions/**/*.jsonl').scan({cwd:piHome,absolute:true})))[0], 'utf8')).split('\n')[0]).id;

    const daemonPids = provider === 'codex' ? await ownedDaemonPids() : [];
    const requestsBeforeSetup = model.requests;
    stage = provider + ' automatic setup';
    const native = await takeover(current!);
    if (model.requests !== requestsBeforeSetup) throw new Error('Setup replayed a model prompt.');
    if (provider === 'codex' && (!daemonPids.length || JSON.stringify(daemonPids) !== JSON.stringify(await ownedDaemonPids()))) throw new Error('Existing daemon was replaced or duplicated.');
    if (native.owner !== 'live-test-phone' || !native.conversationId) throw new Error('One-click claim failed.');
    if (native.conversationId !== originalConversation) throw new Error('Conversation changed.');
    const entries = (await readdir(join(stateDir, 'native'))).filter(row => /^[a-f\d-]{36}\.json$/.test(row));
    const record = (await Promise.all(entries.map(async row => JSON.parse(await readFile(join(stateDir, 'native', row), 'utf8'))))).find(row => row.runtimeId === native.runtimeId);
    ownedHosts.add(record.pid);
    if (provider === 'pi' && !before.process_info.foreground_processes.some(row => row.pid === record.pid)) throw new Error('Pi process changed.');
    if (provider === 'codex') for (const old of before.process_info.foreground_processes.slice(0, 1)) { let alive = true; try { process.kill(old.pid, 0); } catch { alive = false; } if (alive) throw new Error('Original Codex still running.'); }
    stage = provider + ' phone turn';
    await api(machine, panePath('default', pane.pane_id, 'native'), { body: { action: 'prompt', runtimeId: native.runtimeId, conversationId: native.conversationId, clientId: 'live-test-phone', epoch: native.epoch, text: 'Continue with the same confirmation.' } });
    await until(async () => { const state = await api<NativeState>(machine, panePath('default', pane.pane_id, 'native')); return state.status === 'idle' && state.messages.filter(row => row.role === 'user').length >= 2; });
    const currentState = await api<NativeState>(machine, panePath('default', pane.pane_id, 'native'));
    await api(machine, panePath('default', pane.pane_id, 'native'), {body:{action:'release', runtimeId:currentState.runtimeId, conversationId:currentState.conversationId, clientId:'live-test-phone', epoch:currentState.epoch}});
    await rpc(socket, 'agent.prompt', {target:pane.pane_id,text:'Continue on the original desktop.'});
    await until(async()=> {const state=await api<NativeState>(machine,panePath('default',pane.pane_id,'native')); return state.status==='idle' && state.messages.filter(row=>row.role==='user').length>=3 && state.conversationId===originalConversation;});
    console.log(JSON.stringify({ provider, desktopAfterReturn: true, oneClick: true, sameConversation: true, sameProcess: provider === 'pi', sameDaemon: provider === 'codex', sameTerminal: true, phoneTurn: true }));
  }
} catch (error) {
  console.error('Failed isolated takeover at stage: ' + stage);
  const state = await snapshot().catch(() => undefined);
  console.error(JSON.stringify(state?.panes.map(row => ({ agent: row.agent, status: row.agent_status, reference: !!row.agent_session }))));
  for (const pane of state?.panes ?? []) console.error((await rpc<{read:{text:string}}>(socket,'pane.read',{pane_id:pane.pane_id,source:'recent_unwrapped',lines:14,strip_ansi:true})).read.text);
  throw error;
} finally {
  for (const file of await readdir(join(stateDir, 'native')).catch(() => [])) { if (!/^[a-f\d-]{36}\.json$/.test(file)) continue; const record = JSON.parse(await readFile(join(stateDir, 'native', file), 'utf8')); if (record.herdrSocket === socket) ownedHosts.add(record.pid); }
  for (const pid of ownedHosts) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  bridge?.stop(true); packaged?.kill(); if (packaged) await packaged.exited;
  await rpc(socket, 'server.stop').catch(() => herdr.kill()); await herdr.exited;
  for (const pid of (await readdir('/proc')).filter(row => /^\d+$/.test(row))) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    if (!command.split('\0').includes('app-server')) continue;
    const env = (await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')).split('\0');
    if (env.includes('CODEX_HOME=' + codexHome)) { try { process.kill(Number(pid), 'SIGTERM'); } catch {} }
  }
  model.close(); await rm(directory, { recursive: true, force: true }); await rm(sessionDirectory, { recursive: true, force: true });
}

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRelease } from './release';
import { verifyInstall } from './verify-install';
import { createNativeFixture } from '../tests/native-fixture';
import { nativeCall } from '../server/native/registry';
import { api, panePath } from '../shared/client';
import { version } from '../package.json';
import type { NativeRecord } from '../server/native/controller';
import type { NativeState } from '../shared/native';
import type { Machine, Snapshot } from '../shared/protocol';

const checks: string[] = [];
function check(name: string, condition: unknown): void { assert(condition, name); checks.push(name); }
async function run(args: string[], env: NodeJS.ProcessEnv, cwd: string, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(args, { cwd, env, stdin: input === undefined ? 'ignore' : new Blob([input]), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}
async function until<T>(stage: string, read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await read(); if (value) return value; await Bun.sleep(50); }
  throw new Error(`Packaged runtime did not become ready: ${stage}.`);
}

const archive = await createRelease();
const directory = await mkdtemp(join(tmpdir(), 'mhr-'));
const fixture = await createNativeFixture();
let bridge: Bun.Subprocess | undefined;
let host: Bun.Subprocess | undefined;
let managed: { wrapper: string; env: NodeJS.ProcessEnv } | undefined;
try {
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  check('archive matches its SHA-256 sidecar', (await readFile(archive + '.sha256', 'utf8')).startsWith(digest + '  ' + basename(archive)));
  const extracted = await run(['tar', '-xzf', archive, '-C', directory], process.env, directory);
  check('runtime archive extracts successfully', extracted.code === 0);
  const installation = join(directory, `mobile-herdr-${version}`);
  const wrapper = join(installation, 'bin/mobile-herdr');
  const listing = await run(['tar', '-tzf', archive], process.env, directory);
  const entries = listing.stdout.split('\n').filter(Boolean).map(path => path.split('/').slice(1).join('/'));
  check('archive has no credentials, transcripts, source workspace or installed dependencies', entries.every(path =>
    !/(^|\/)(\.git|\.env[^/]*|token|artifacts)(\/|$)|\.jsonl$|\.sock$/.test(path) && !path.startsWith('node_modules/')));
  check('runtime needs no dependency installation', !JSON.parse(await readFile(join(installation, 'package.json'), 'utf8')).dependencies);
  check('third-party notices accompany bundled dependencies', entries.some(path => path.startsWith('licenses/react/')) && entries.some(path => path.startsWith('licenses/qrcode-terminal/')));
  check('theme attribution and MIT licenses accompany the runtime', entries.includes('licenses/themes/catppuccin.txt') && entries.includes('licenses/themes/flexoki.txt') && (await readFile(join(installation, 'THEME_CREDITS.md'), 'utf8')).includes('licenses/themes/'));
  const manifest = JSON.parse(await readFile(join(installation, 'release.json'), 'utf8'));
  check('manifest identifies the beta version and source snapshot', manifest.version === version && manifest.channel === 'beta' && typeof manifest.sourceDirty === 'boolean');
  const env: NodeJS.ProcessEnv = { ...process.env, MOBILE_HERDR_BUN: process.execPath, MOBILE_HERDR_STATE: join(directory, 'bridge-state'),
    MOBILE_HERDR_HOST: '127.0.0.1', MOBILE_HERDR_PORT: '0', MOBILE_HERDR_SOCKET: fixture.config.socket,
    HERDR_SOCKET: fixture.config.socket, HERDR_SOCKET_PATH: fixture.config.socket, HERDR_PANE_ID: fixture.snapshot.panes[0].pane_id,
    MOBILE_HERDR_ORIGINS: '', MOBILE_HERDR_HERDR_HOME: join(directory, 'empty-herdr'), MOBILE_HERDR_SSH_DISCOVERY: '0',
  };
  delete env.MOBILE_HERDR_TOKEN;
  const help = await run([wrapper, '--help'], env, directory);
  const reported = await run([wrapper, '--version'], env, directory);
  check('packaged command runs from outside its directory', help.code === 0 && reported.stdout.trim() === version);
  check('runtime includes the bundled SSH worker without build dependencies', entries.includes('server/ssh-worker.bundle.js'));
  const binDirectory = join(directory, 'custom bin');
  const install = await run([wrapper, 'install-agent', '--bin-dir', binDirectory], env, directory);
  const installed = await run([join(binDirectory, 'mherdr'), '--version'], env, directory);
  check('launcher installs into a chosen path with spaces', install.code === 0 && installed.code === 0 && installed.stdout.trim() === version);
  const protectedDirectory = join(directory, 'protected-bin');
  await mkdir(protectedDirectory);
  await writeFile(join(protectedDirectory, 'mherdr'), 'unrelated user command\n');
  const refused = await run([wrapper, 'install-agent', '--bin-dir', protectedDirectory], env, directory);
  check('installation preserves an unrelated existing command', refused.code !== 0 && await readFile(join(protectedDirectory, 'mherdr'), 'utf8') === 'unrelated user command\n');
  const customToken = createHash('sha256').update(directory).digest('hex');
  const configured = await run([wrapper, 'token', 'set', '--stdin'], env, directory, customToken + '\n');
  check('packaged token command saves a custom credential without printing it', configured.code === 0 && !configured.stdout.includes(customToken) && (await readFile(join(env.MOBILE_HERDR_STATE!, 'token'), 'utf8')).trim() === customToken);
  await verifyInstall(archive, directory, check);

  let output = '';
  bridge = Bun.spawn([wrapper, 'start'], { env, cwd: directory, stdout: 'pipe', stderr: 'ignore' });
  void (async () => { for await (const chunk of bridge!.stdout as ReadableStream<Uint8Array>) output += new TextDecoder().decode(chunk); })();
  const url = await until('bridge HTTP listener', async () => {
    if (bridge?.exitCode !== null) throw new Error('Packaged bridge exited before opening its HTTP listener.');
    return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  });
  const token = (await readFile(join(env.MOBILE_HERDR_STATE!, 'token'), 'utf8')).trim();
  const machine: Machine = { id: 'release-test', name: 'release-test', url, token };
  managed = { wrapper, env: { ...env, MOBILE_HERDR_STATE: join(directory, 'managed-state') } };
  const started = await run([wrapper, 'background', '--json'], managed.env, directory);
  const managedStatus = JSON.parse(started.stdout);
  check('packaged background command starts its own bridge', started.code === 0 && managedStatus.running && !started.stdout.includes('nonce'));
  const running = await run([wrapper, 'status', '--json'], managed.env, directory);
  check('packaged status resolves the same background process', running.code === 0 && JSON.parse(running.stdout).pid === managedStatus.pid);
  const stopped = await run([wrapper, 'stop', '--json'], managed.env, directory);
  check('packaged stop only stops its own managed bridge', stopped.code === 0 && (await fetch(url + '/api/info', { headers: { Authorization: `Bearer ${token}` } })).ok);
  const page = await fetch(url);
  const html = await page.text();
  check('packaged bridge serves the prebuilt app', page.ok && html.includes('id="root"'));
  for (const path of [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1])) {
    const response = await fetch(new URL(path, url));
    assert(response.ok && !(response.headers.get('content-type') ?? '').includes('text/html'), 'Missing built asset: ' + path);
  }
  check('packaged JavaScript, CSS and xterm assets resolve', (await fetch(url + '/terminal.js')).ok && (await fetch(url + '/terminal.css')).ok);
  const anonymous = await fetch(url + '/api/info');
  const info = await api<{ version: string }>(machine, '/api/info');
  check('packaged API requires the saved custom token and reports the release version', anonymous.status === 401 && info.version === version && token === customToken);
  const snapshot = await api<Snapshot>(machine, '/api/snapshot');
  check('packaged bridge reads only the isolated fixture session', snapshot.panes[0].terminal_id === fixture.snapshot.panes[0].terminal_id);
  const paired = await run([wrapper, 'pair', '--url', url], env, directory);
  const fragment = paired.stdout.match(/#connect=([A-Za-z0-9_-]+)/)?.[1];
  const pairing = fragment ? JSON.parse(Buffer.from(fragment, 'base64url').toString()) : undefined;
  check('packaged pairing uses a fragment and the same isolated credential', paired.code === 0 && pairing?.token === token && pairing.url === url);
  const statusEnv = { ...env, MOBILE_HERDR_STATE: fixture.directory };
  const status = await run([join(binDirectory, 'mherdr'), 'status', '--json'], statusEnv, directory);
  check('installed launcher resolves the same native runtime', status.code === 0 && JSON.parse(status.stdout).runtime === fixture.control.state.runtimeId);
  const state = await api<NativeState>(machine, panePath('default', snapshot.panes[0].pane_id, 'native'));
  // This bridge has its own state directory, so the fixture registration is deliberately absent.
  check('separate state directories cannot inherit a native registration', state === null);

  const hostDirectory = join(directory, 'host');
  await mkdir(hostDirectory, { mode: 0o700 });
  let hostError = '';
  host = Bun.spawn([process.execPath, 'run', join(installation, 'scripts/native-host.ts')], { cwd: directory, stdout: 'ignore', stderr: 'pipe', env: {
    ...env, MOBILE_HERDR_NATIVE_DIRECTORY: hostDirectory, MOBILE_HERDR_CODEX_BINARY: process.execPath,
    MOBILE_HERDR_CODEX_SERVER_ARGS: JSON.stringify([resolve(import.meta.dir, '../tests/fake-codex.ts')]),
    MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify({ herdrSocket: fixture.config.socket, paneId: 'owned-package-test', terminalId: 'owned-package-terminal' }),
  } });
  void (async () => { for await (const chunk of host!.stderr as ReadableStream<Uint8Array>) hostError += new TextDecoder().decode(chunk); })();
  const record = await until<NativeRecord>('native host registration', async () => {
    if (host?.exitCode !== null) throw new Error(`Packaged test host exited: ${hostError}`);
    const name = (await readdir(hostDirectory).catch(() => [])).find(name => /^[a-f0-9-]{36}\.json$/.test(name));
    return name ? JSON.parse(await readFile(join(hostDirectory, name), 'utf8')) : undefined;
  });
  const hostState = await until('native host model catalog', async () => { const value = await nativeCall<NativeState>(record.endpoint, { method: 'state' }); return value.models?.some(model => model.id === 'fixture-model') ? value : undefined; });
  check('packaged native host starts its isolated protocol peer', hostState.connected && hostState.provider === 'codex');
  await nativeCall(record.endpoint, { method: 'shutdown' });
  check('packaged native host shuts down its own test process', await host.exited === 0);
  host = undefined;
  const node = Bun.which('node');
  assert(node, 'Node is required to verify the Pi bundle in its host runtime.');
  const pi = await run([node, '--input-type=module', '-e', `const {default: register} = await import(process.argv[1]); const handlers=[]; register({on:(name)=>handlers.push(name),registerShortcut(){},registerCommand(){}}); if(!handlers.includes('session_start')) process.exit(1);`, pathToFileURL(join(installation, 'plugins/pi/mobile-herdr.ts')).href], env, directory);
  check('bundled Pi extension loads and registers inside Node without node_modules', pi.code === 0);
  const report = { version, archive: basename(archive), sha256: digest, platform: `${process.platform}-${process.arch}`, checks };
  await writeFile(archive + '.verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Release verification: ${checks.length} checks passed on ${report.platform}.\n${archive}`);
} finally {
  if (managed) await run([managed.wrapper, 'stop', '--json'], managed.env, directory).catch(() => {});
  if (host) { host.kill(); await host.exited; }
  if (bridge) { bridge.kill(); await bridge.exited; }
  await fixture.close();
  await rm(directory, { recursive: true, force: true });
}

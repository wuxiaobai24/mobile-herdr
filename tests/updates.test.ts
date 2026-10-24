import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareVersions, performUpdate, selectRelease } from '../server/updates';
import type { ManagedRecord } from '../server/management';
import { version } from '../package.json';
function release(value: string, prerelease = value.includes('-')) {
  const tag = 'v' + value, name = 'mobile-herdr-' + value + '.tar.gz';
  return { tag_name: tag, prerelease, assets: [name, name + '.sha256'].map(name => ({ name, browser_download_url: `https://github.com/wuxiaobai24/mobile-herdr/releases/download/${tag}/${name}` })) };
}
test('update selection compares semver, follows the installed channel, and requires both official assets', () => {
  expect(compareVersions('0.2.2-beta.10', '0.2.2-beta.9')).toBeGreaterThan(0);
  expect(compareVersions('0.2.2', '0.2.2-beta.99')).toBeGreaterThan(0);
  expect(compareVersions('0.2.2-beta', '0.2.2-beta')).toBe(0);
  const invalid = release('99.0.0'); invalid.assets[1].browser_download_url = 'https://attacker.invalid/checksum';
  const incomplete = release('98.0.0'); incomplete.assets.pop();
  const rows = [release('0.3.0-beta.1'), release('0.2.3'), { ...release('5.0.0'), draft: true }, invalid, incomplete];
  expect(selectRelease(rows, '0.2.2')?.version).toBe('0.2.3');
  expect(selectRelease(rows, '0.2.2-beta.6')?.version).toBe('0.3.0-beta.1');
});
test('failed new bridge rolls back the selected version and commands while leaving agents outside service control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-update-')), root = join(directory, 'old'), next = join(directory, 'new'), prefix = join(directory, 'runtime'), binDir = join(directory, 'bin'), stateDir = join(directory, 'state');
  for (const path of [root, next, prefix, binDir, stateDir]) await mkdir(path);
  await symlink(root, join(prefix, 'current'));
  await writeFile(join(root, '.installation.json'), JSON.stringify({ prefix, binDir }));
  await writeFile(join(binDir, 'mherdr'), 'original agent command'); await writeFile(join(binDir, 'mobile-herdr'), 'original web command');
  const record: ManagedRecord = { nonce: 'test-only-nonce', socket: join(directory, 'control.sock'), directory, pid: process.pid, url: 'http://127.0.0.1:1', startedAt: '', restart: { MOBILE_HERDR_STATE: stateDir, MOBILE_HERDR_TOKEN: 'fixture-token' } };
  await writeFile(join(stateDir, 'bridge.json'), JSON.stringify(record), { mode: 0o600 });
  await writeFile(join(stateDir, 'update.json'), JSON.stringify({ id: 'fixture-update', phase: 'installing', message: '', current: version, latest: '99.0.0', available: true, supported: true }));
  let running = true, stops = 0;
  const server = createServer(socket => { socket.once('data', data => { const input = JSON.parse(data.toString()); if (input.action === 'stop') { running = false; stops++; } socket.end(JSON.stringify({ running, version }) + '\n'); }); });
  await new Promise<void>(resolve => server.listen(record.socket, resolve));
  await mkdir(join(stateDir, 'update.lock'));
  await writeFile(join(stateDir, 'update.lock/owner.json'), JSON.stringify({pid:2147483647}));
  const commands: string[][] = [];
  try {
    await performUpdate(root, stateDir, 'fixture-update', process.pid, { latest: async () => ({ version: '99.0.0', tag: 'v99.0.0' }), run: async args => {
      commands.push(args);
      if (args[0] === 'bash') {
        await rm(join(prefix, 'current')); await symlink(next, join(prefix, 'current'));
        await writeFile(join(binDir, 'mherdr'), 'new agent command');
      } else if (args.includes(join(next, 'scripts/bridge.ts'))) throw new Error('Fixture startup failed.');
      else if (args.includes(join(root, 'scripts/bridge.ts'))) running = true;
      else throw new Error('Unexpected command.');
    } });
    expect(await readlink(join(prefix, 'current'))).toBe(root);
    expect(await readFile(join(binDir, 'mherdr'), 'utf8')).toBe('original agent command');
    expect(await readFile(join(binDir, 'mobile-herdr'), 'utf8')).toBe('original web command');
    expect(stops).toBe(1); expect(running).toBeTrue();
    expect(commands).toHaveLength(3);
    expect(JSON.parse(await readFile(join(stateDir, 'update.json'), 'utf8'))).toMatchObject({ phase: 'failed', message: 'Fixture startup failed. 已回滚到原版本。' });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('updater follows the actual managed runtime even when worker source already matches the target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-version-update-')), root = join(directory, 'source'), next = join(directory, 'new'), prefix = join(directory, 'install'), binDir = join(directory, 'bin'), stateDir = join(directory, 'state');
  for (const path of [root, next, prefix, binDir, stateDir]) await mkdir(path);
  await symlink(root, join(prefix, 'current'));
  await writeFile(join(root, '.installation.json'), JSON.stringify({ prefix, binDir }));
  const old = '0.2.2-beta.6';
  let runningVersion = old, stops = 0, installed = false;
  const health = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.json({ version: runningVersion }); } });
  const record: ManagedRecord = { nonce: 'fixture-old', socket: join(directory, 'control.sock'), directory, pid: process.pid, url: `http://127.0.0.1:${health.port}`, startedAt: '', restart: { MOBILE_HERDR_STATE: stateDir, MOBILE_HERDR_TOKEN: 'fixture-token' } };
  const server = createServer(socket => socket.once('data', data => { const input = JSON.parse(data.toString()); if (input.action === 'stop') stops++; socket.end(JSON.stringify({ running: input.action !== 'stop' && stops === 0 || runningVersion === version, version: runningVersion }) + '\n'); }));
  await new Promise<void>(resolve => server.listen(record.socket, resolve));
  await writeFile(join(stateDir, 'bridge.json'), JSON.stringify(record), { mode: 0o600 });
  await writeFile(join(stateDir, 'update.json'), JSON.stringify({ id: 'runtime-version', phase: 'installing', current: old, latest: version, available: true, supported: true }));
  try {
    await performUpdate(root, stateDir, 'runtime-version', process.pid, { latest: async () => ({ version, tag: 'v' + version }), run: async (args, env) => {
      if (args[0] === 'bash') { installed = true; await rm(join(prefix, 'current')); await symlink(next, join(prefix, 'current')); }
      else { runningVersion = version; record.nonce = env.MOBILE_HERDR_NEXT_NONCE!; await writeFile(join(stateDir, 'bridge.json'), JSON.stringify(record), { mode: 0o600 }); }
    } });
    expect(installed).toBeTrue(); expect(stops).toBe(1);
    expect(JSON.parse(await readFile(join(stateDir, 'update.json'), 'utf8'))).toMatchObject({ phase: 'ready', current: version, available: false });
    expect(await readlink(join(prefix, 'current'))).toBe(next);
  } finally { health.stop(true); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('update status recovers stale ready/failed states and detects missing or interrupted workers', async () => {
  const { updateStatus } = await import('../server/updates');
  const directory = await mkdtemp(join(tmpdir(), 'mh-update-status-'));
  const latest = async () => ({ version: '99.0.0', tag: 'v99.0.0' });
  async function saved(phase: string, extra = {}) { await writeFile(join(directory, 'update.json'), JSON.stringify({ id: 'status-fixture', phase, current: version, latest: version, ...extra })); }
  try {
    await saved('ready');
    expect(await updateStatus(directory, { latest })).toMatchObject({ phase: 'idle', available: true, latest: '99.0.0' });
    await saved('failed');
    expect(await updateStatus(directory, { latest })).toMatchObject({ phase: 'idle', available: true });
    expect(await updateStatus(directory, { latest: async () => ({ version, tag: 'v' + version }) })).toMatchObject({ phase: 'idle', available: false });
    await saved('installing');
    expect(await updateStatus(directory, { latest })).toMatchObject({ phase: 'failed', available: true });
    await saved('installing', { startedAt: Date.now() });
    expect(await updateStatus(directory, { latest })).toMatchObject({ phase: 'installing' });
    await writeFile(join(directory, 'update-worker.json'), JSON.stringify({ id: 'status-fixture', pid: 2147483647 }));
    expect(await updateStatus(directory, { latest })).toMatchObject({ phase: 'failed' });
    await writeFile(join(directory, 'update-worker.json'), JSON.stringify({ id: 'status-fixture', pid: process.pid }));
    expect(await updateStatus(directory, { latest: async () => { throw new Error('fixture network down'); } })).toMatchObject({ phase: 'installing' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { version } from '../package.json';
const directory = await mkdtemp(join(tmpdir(), 'mh-pack-takeover-'));
try {
  const archive = resolve('artifacts/releases', `mobile-herdr-${version}.tar.gz`);
  const unpack = Bun.spawn(['tar', '-xzf', archive, '-C', directory], { stdout: 'ignore', stderr: 'inherit' });
  if (await unpack.exited !== 0) throw new Error('Run bun run test:release before testing the package.');
  const child = Bun.spawn([process.execPath, 'run', resolve(import.meta.dir, 'verify-takeover-live.ts')], { env: { ...process.env, MOBILE_HERDR_TEST_RELEASE_ROOT: join(directory, `mobile-herdr-${version}`) }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Packaged native takeover failed.');
} finally { await rm(directory, { recursive: true, force: true }); }

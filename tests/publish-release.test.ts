import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { version } from '../package.json';
import app from '../app.json';
import { checkRemoteAssets, selectRelease, verifyAssets, type LocalAsset } from '../scripts/publish-release';

const asset: LocalAsset = { name: 'app.apk', path: '/tmp/app.apk', digest: 'sha256:verified' };
const uploaded = { name: asset.name, state: 'uploaded', digest: asset.digest };

test('publishing rejects duplicate drafts and a draft alongside an already public release', () => {
  const release = { id: 1, tag_name: 'v1', draft: true, prerelease: true, assets: [] };
  expect(selectRelease([], 'v1')).toBeUndefined();
  expect(selectRelease([release], 'v1')?.id).toBe(1);
  expect(() => selectRelease([release, { ...release, id: 2 }], 'v1')).toThrow('Duplicate');
  expect(() => selectRelease([release, { ...release, id: 2, draft: false }], 'v1')).toThrow('Duplicate');
});

test('resuming uploads accepts only exact server digests and never overwrites ambiguous assets', () => {
  expect(() => checkRemoteAssets([], [asset], false)).not.toThrow();
  expect(() => checkRemoteAssets([uploaded], [asset], true)).not.toThrow();
  expect(() => checkRemoteAssets([], [asset], true)).toThrow('missing');
  expect(() => checkRemoteAssets([{ ...uploaded, digest: 'sha256:other' }], [asset], false)).toThrow('differs');
  expect(() => checkRemoteAssets([{ ...uploaded, state: 'new' }], [asset], false)).toThrow('differs');
  expect(() => checkRemoteAssets([{ ...uploaded, name: 'unknown' }], [asset], false)).toThrow('differs');
});

test('local publication gates reject modified bytes, stale reports and dirty source manifests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mhr-publish-test-'));
  const name = `mobile-herdr-${version}`;
  const source = join(directory, 'source', name);
  const commit = 'test-commit';
  try {
    await mkdir(source, { recursive: true });
    await copyFile('install.sh', join(directory, 'install.sh'));
    const apk = join(directory, name + '.apk');
    const archive = join(directory, name + '.tar.gz');
    await writeFile(apk, 'fixture APK bytes');
    async function sidecars(path: string): Promise<void> {
      const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
      const file = path.split('/').at(-1)!;
      await writeFile(path + '.sha256', `${sha256}  ${file}\n`);
      await writeFile(path + '.verification.json', JSON.stringify({ version, archive: file, sha256, sourceCommit: commit, androidVersionCode: app.expo.android.versionCode, checks: ['fixture check'], count: 1 }));
    }
    async function pack(dirty: boolean): Promise<void> {
      await writeFile(join(source, 'release.json'), JSON.stringify({ version, sourceCommit: commit, sourceDirty: dirty }));
      const tar = Bun.spawn(['tar', '-czf', archive, '-C', join(directory, 'source'), name]);
      expect(await tar.exited).toBe(0);
      await sidecars(archive);
    }
    await pack(false);
    await sidecars(apk);
    expect((await verifyAssets(directory, commit)).length).toBe(7);
    await writeFile(apk, 'altered APK');
    await expect(verifyAssets(directory, commit)).rejects.toThrow('Checksum');
    await sidecars(apk);
    await expect(verifyAssets(directory, 'another-commit')).rejects.toThrow('APK verification');
    await pack(true);
    await expect(verifyAssets(directory, commit)).rejects.toThrow('clean source');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

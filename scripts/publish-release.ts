import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { version } from '../package.json';
import app from '../app.json';

const root = resolve(import.meta.dir, '..');
const repository = 'wuxiaobai24/mobile-herdr';
const endpoint = `repos/${repository}/releases`;
const output = join(root, 'artifacts/releases');
const tag = `v${version}`;
type Asset = { name: string; state: string; digest: string };
type Release = { id: number; tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] };
export type LocalAsset = { name: string; path: string; digest: string };

export async function command(args: string[], inherit = false): Promise<string> {
  const child = Bun.spawn(args, { cwd: root, stdout: inherit ? 'inherit' : 'pipe', stderr: 'inherit' });
  const result = inherit ? '' : await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Command failed: ${args[0]} ${args[1] ?? ''}`);
  return result.trim();
}

export function selectRelease(releases: Release[], releaseTag: string): Release | undefined {
  const matching = releases.filter(release => release.tag_name === releaseTag);
  if (matching.length > 1) throw new Error(`Duplicate releases for ${releaseTag}: ${matching.map(release => release.id).join(', ')}. Resolve them explicitly before publishing.`);
  return matching[0];
}

export function checkRemoteAssets(remote: Asset[], local: LocalAsset[], complete: boolean): void {
  for (const asset of remote) {
    const expected = local.find(entry => entry.name === asset.name);
    if (!expected || asset.state !== 'uploaded' || asset.digest !== expected.digest) throw new Error(`Remote asset differs from verified bytes: ${asset.name}. It will not be overwritten.`);
  }
  if (complete && remote.length !== local.length) throw new Error('Release is missing verified assets.');
}

export async function verifyAssets(directory: string, commit: string): Promise<LocalAsset[]> {
  const assets: LocalAsset[] = [];
  for (const extension of ['tar.gz', 'apk']) {
    const name = `mobile-herdr-${version}.${extension}`;
    const path = join(directory, name);
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    if ((await readFile(path + '.sha256', 'utf8')).trim() !== `${sha256}  ${name}`) throw new Error(`Checksum mismatch: ${name}`);
    const report = JSON.parse(await readFile(path + '.verification.json', 'utf8'));
    if (report.version !== version || report.archive !== name || report.sha256 !== sha256 || !report.checks?.length) throw new Error(`Verification report mismatch: ${name}`);
    if (extension === 'apk' && (report.sourceCommit !== commit || report.androidVersionCode !== app.expo.android.versionCode || report.count !== report.checks.length)) throw new Error('APK verification does not identify this source commit/versionCode.');
    for (const suffix of ['', '.sha256', '.verification.json']) {
      const file = path + suffix;
      assets.push({ name: basename(file), path: file, digest: 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex') });
    }
  }
  const manifest = JSON.parse(await command(['tar', '-xOf', join(directory, `mobile-herdr-${version}.tar.gz`), `mobile-herdr-${version}/release.json`]));
  if (manifest.version !== version || manifest.sourceCommit !== commit || manifest.sourceDirty !== false) throw new Error('Runtime archive is not from the clean source commit.');
  const installer = join(directory, 'install.sh');
  const bytes = await readFile(installer);
  if (!bytes.equals(await readFile(join(root, 'install.sh'))) || !bytes.toString().includes(`\nVERSION=${version}\n`)) throw new Error('Installer must match this source and version.');
  assets.push({ name: 'install.sh', path: installer, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') });
  return assets;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const args = ['gh', 'api', path];
  if (body === undefined) return JSON.parse(await command(args));
  const directory = await mkdtemp(join(tmpdir(), 'mhr-publish-'));
  try {
    const file = join(directory, 'body.json');
    await writeFile(file, JSON.stringify(body));
    return JSON.parse(await command([...args, '--method', path === endpoint ? 'POST' : 'PATCH', '--input', file]));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function releases(): Promise<Release[]> {
  return (JSON.parse(await command(['gh', 'api', '--paginate', '--slurp', `${endpoint}?per_page=100`])) as Release[][]).flat();
}

export async function cleanCommit(): Promise<string> {
  if (await command(['git', 'status', '--porcelain'])) throw new Error('Commit changes before preparing/publishing a release.');
  return command(['git', 'rev-parse', 'HEAD']);
}

async function publish(checkOnly: boolean): Promise<void> {
  const commit = await cleanCommit();
  const assets = await verifyAssets(output, commit);
  if (checkOnly) { console.log(`Verified ${assets.length} local assets for ${tag} (${commit}).`); return; }
  if (await command(['git', 'rev-parse', `${tag}^{commit}`]) !== commit) throw new Error('Release tag must point at the current clean HEAD.');
  const remote = await command(['git', 'ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (!(remote.split('\n').some(line => line.startsWith(commit + '\t')))) throw new Error('Push the matching release tag before publishing.');
  const notes = await readFile(join(root, `docs/release-notes-${version.split('-')[1]}.md`), 'utf8');
  const known = await releases();
  let release = selectRelease(known, tag);
  if (release && !release.prerelease) throw new Error('This publisher only manages beta prereleases.');
  for (const previous of known.filter(entry => !entry.draft && entry.tag_name !== tag && entry.assets.some(asset => asset.name.endsWith('.apk')))) {
    const config = JSON.parse(await command(['git', 'show', `${previous.tag_name}:app.json`]));
    if (app.expo.android.versionCode <= config.expo.android.versionCode) throw new Error(`Android versionCode must exceed ${previous.tag_name} (${config.expo.android.versionCode}).`);
  }
  if (!release) release = await api<Release>(endpoint, { tag_name: tag, target_commitish: commit, name: `Mobile Herdr ${version}`, body: notes, draft: true, prerelease: true });
  checkRemoteAssets(release.assets, assets, !release.draft);
  if (release.draft) {
    // Pin the ID: searching by tag during each upload can select a competing draft.
    for (const asset of assets) {
      if (release.assets.some(existing => existing.name === asset.name)) continue;
      await command(['gh', 'api', `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, '--method', 'POST', '-H', 'Content-Type: application/octet-stream', '--input', asset.path]);
    }
    release = await api<Release>(`${endpoint}/${release.id}`);
    checkRemoteAssets(release.assets, assets, true);
    if (selectRelease(await releases(), tag)?.id !== release.id) throw new Error('Release identity changed before publication.');
    await api(`${endpoint}/${release.id}`, { draft: false, prerelease: true });
  }
  await command(['python', 'scripts/verify-public-release.py'], true);
}

if (import.meta.main) {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--check', '--publish'].includes(mode[0])) throw new Error('Usage: bun run release:publish --check | --publish');
  await mkdir(output, { recursive: true });
  const lock = join(output, '.publish.lock');
  await mkdir(lock); // An existing lock requires explicit recovery, never takeover.
  try { await publish(mode[0] === '--check'); }
  finally { await rm(lock, { recursive: true }); }
}

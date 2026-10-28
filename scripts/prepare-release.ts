import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { version } from '../package.json';
import app from '../app.json';
import { cleanCommit, command, verifyAssets } from './publish-release';

// Run only against a disposable emulator and credentials already used by releases.
if (!process.env.MOBILE_HERDR_ANDROID_SERIAL?.startsWith('emulator-')) throw new Error('Set MOBILE_HERDR_ANDROID_SERIAL to a dedicated emulator.');
if (['MOBILE_HERDR_ANDROID_FILES_ONLY', 'MOBILE_HERDR_ANDROID_INBOX_ONLY', 'MOBILE_HERDR_ANDROID_DOWNLOAD_ONLY'].some(key => process.env[key] === '1')) throw new Error('A release requires the full Android suite.');
if (process.env.MOBILE_HERDR_ANDROID_APK || process.env.MOBILE_HERDR_ANDROID_OUTPUT) throw new Error('Release verification must use the freshly built APK and default report directory.');
if (process.env.MOBILE_HERDR_ANDROID_ABIS && process.env.MOBILE_HERDR_ANDROID_ABIS !== 'arm64-v8a,x86_64') throw new Error('Release APKs must include both arm64-v8a and x86_64.');
const commit = await cleanCommit();
const signing = process.env.MOBILE_HERDR_ANDROID_SIGNING_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'mobile-herdr/android-signing');
for (const file of ['release.p12', 'password']) await stat(join(signing, file));
for (const script of ['typecheck', 'test', 'test:release', 'test:ui', 'build:android', 'test:android']) {
  await command(['bun', 'run', script], true);
  if (script === 'build:android') {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Android/Sdk');
    const tools = (await readdir(join(sdk, 'build-tools'))).filter(name => !name.includes('rc')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const certificate = await command([join(sdk, 'build-tools', tools[0], 'apksigner'), 'verify', '--print-certs', 'artifacts/android/mobile-herdr.apk']);
    if (!certificate.includes('Signer #1 certificate SHA-256 digest: ef972b660280d042d3a46929ea58636527a6bb2cb8a17ae9d7fd89109c533334')) throw new Error('APK does not use the original release signing certificate.');
  }
}
if (await cleanCommit() !== commit) throw new Error('Source changed during release preparation.');
const directory = 'artifacts/releases';
const name = `mobile-herdr-${version}.apk`;
const apk = await readFile('artifacts/android/mobile-herdr.apk');
const sha256 = createHash('sha256').update(apk).digest('hex');
const report = JSON.parse(await readFile('artifacts/android/ui/verification.json', 'utf8'));
await writeFile(join(directory, name), apk);
await writeFile(join(directory, name + '.sha256'), `${sha256}  ${name}\n`);
await writeFile(join(directory, name + '.verification.json'), JSON.stringify({ ...report, version, archive: name, sha256, sourceCommit: commit, androidVersionCode: app.expo.android.versionCode }, null, 2) + '\n');
await copyFile('install.sh', join(directory, 'install.sh'));
await verifyAssets(directory, commit);
console.log(`Prepared seven verified assets for v${version}; publish with bun run release:publish --publish.`);

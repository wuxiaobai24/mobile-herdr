import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const root = resolve(import.meta.dir, '..');
const signing = process.env.MOBILE_HERDR_ANDROID_SIGNING_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'mobile-herdr', 'android-signing');
await mkdir(signing, { recursive: true, mode: 0o700 });
const keystore = join(signing, 'release.p12'), passwordFile = join(signing, 'password');
const exists = (path: string) => stat(path).then(() => true, () => false);
if (await exists(keystore) && !await exists(passwordFile)) throw new Error('Signing key exists but its password file is missing. Restore the password; do not replace the key.');
if (!await exists(passwordFile)) await writeFile(passwordFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
const password = (await readFile(passwordFile, 'utf8')).trim();
const env = { ...process.env, MOBILE_HERDR_ANDROID_KEYSTORE: keystore, MOBILE_HERDR_ANDROID_STORE_PASSWORD: password };
async function run(command: string[], options: { cwd?: string; quiet?: boolean } = {}): Promise<void> {
  const child = Bun.spawn(command, { cwd: options.cwd ?? root, env, stdout: options.quiet ? 'ignore' : 'inherit', stderr: options.quiet ? 'pipe' : 'inherit' });
  const error = options.quiet ? await new Response(child.stderr).text() : '';
  if (await child.exited !== 0) throw new Error(`Android build step failed: ${command[0]}${error ? '\n' + error : ''}`);
}
if (!await exists(keystore)) {
  await run(['keytool', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass:env', 'MOBILE_HERDR_ANDROID_STORE_PASSWORD', '-keypass:env', 'MOBILE_HERDR_ANDROID_STORE_PASSWORD', '-alias', 'mobile-herdr', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Mobile Herdr local release'], { quiet: true });
}
await chmod(keystore, 0o600);
await run(['bunx', '--no-install', 'expo', 'prebuild', '--platform', 'android', '--no-install', '--no-clean']);
await run(['./gradlew', ':app:assembleRelease', `-PreactNativeArchitectures=${process.env.MOBILE_HERDR_ANDROID_ABIS ?? 'arm64-v8a,x86_64'}`, '--max-workers=4', '--console=plain',
  ...(process.env.MOBILE_HERDR_ANDROID_OFFLINE === '1' ? ['--offline'] : []),
  ...(process.env.MOBILE_HERDR_ANDROID_VERBOSE === '1' ? ['--info'] : []),
], { cwd: join(root, 'android') });
const apk = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!await exists(apk)) throw new Error('Signed APK missing. Check the Android signing plugin.');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Android/Sdk');
const versions = (await readdir(join(sdk, 'build-tools'))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const buildTools = versions.find(version => !version.includes('rc'));
if (!buildTools) throw new Error('Android SDK build-tools missing: cannot verify the release signature.');
await run([join(sdk, 'build-tools', buildTools, 'apksigner'), 'verify', apk], { quiet: true });
const destination = join(root, 'artifacts/android/mobile-herdr.apk');
await mkdir(join(root, 'artifacts/android'), { recursive: true });
await copyFile(apk, destination);
const digest = createHash('sha256').update(await readFile(destination)).digest('hex');
await writeFile(destination + '.sha256', `${digest}  mobile-herdr.apk\n`);
console.log(`Android APK: ${destination}\nSigning key: ${keystore}\nKeep this key and its password to install future updates over this APK.`);

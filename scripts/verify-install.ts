import { mkdir, readFile, writeFile, readlink, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { version } from '../package.json';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
/** Test the real shell installer against local release bytes, with download transport replaced. */
export async function verifyInstall(archive: string, directory: string, check: (name: string, condition: unknown) => void): Promise<void> {
  const root = join(directory, "installer user's space"), tools = join(root, 'tools'), prefix = join(root, 'runtime'), bin = join(root, 'bin');
  await mkdir(tools, { recursive: true });
  const curlPeer = join(tools, 'curl-peer.ts');
  const bunInstaller = 'mkdir -p "$BUN_INSTALL/bin"\nln -s ' + quote(process.execPath) + ' "$BUN_INSTALL/bin/bun"\n';
  await writeFile(curlPeer, `import {copyFile,writeFile} from 'node:fs/promises';
const args=process.argv.slice(2),url=args.find(x=>x.startsWith('https://')),out=args[args.indexOf('-o')+1];
if(url==='https://bun.sh/install') { await writeFile(out, ${JSON.stringify(bunInstaller)}); }
else if(url==='https://github.com/wuxiaobai24/mobile-herdr/releases/download/v${version}/mobile-herdr-${version}.tar.gz') await copyFile(process.env.TEST_ARCHIVE!,out);
else if(url==='https://github.com/wuxiaobai24/mobile-herdr/releases/download/v${version}/mobile-herdr-${version}.tar.gz.sha256') await copyFile(process.env.TEST_CHECKSUM!,out);
else process.exit(22);
`);
  await writeFile(join(tools, 'curl'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(curlPeer)} "$@"\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: tools + ':' + process.env.PATH, MOBILE_HERDR_BUN: process.execPath,
    MOBILE_HERDR_STATE: join(root, 'state'), TEST_ARCHIVE: archive, TEST_CHECKSUM: archive + '.sha256' };
  const installer = resolve(import.meta.dir, '../install.sh');
  async function install(extra: string[] = [], custom = env) {
    const child = Bun.spawn(['bash', installer, '--prefix', prefix, '--bin-dir', bin, ...extra], { env: custom, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code && !extra.length && custom === env) throw new Error(`Installer fixture failed: ${stderr}`);
    return { code, stdout, stderr };
  }
  async function reported(name: string) {
    const child = Bun.spawn([join(bin, name), '--version'], { env, stdout: 'pipe', stderr: 'pipe' });
    return [await child.exited, (await new Response(child.stdout).text()).trim()];
  }
  const first = await install();
  check('installer verifies and installs both commands into paths with spaces and apostrophes', first.code === 0 && JSON.stringify(await reported('mobile-herdr')) === JSON.stringify([0, version]) && JSON.stringify(await reported('mherdr')) === JSON.stringify([0, version]));
  const selected = await readlink(join(prefix, 'current'));
  check('repeating installation keeps the same version without touching user state', (await install()).code === 0 && await readlink(join(prefix, 'current')) === selected && !(await Bun.file(join(env.MOBILE_HERDR_STATE!, 'token')).exists()));
  const wrong = join(root, 'wrong.sha256'); await writeFile(wrong, '0'.repeat(64) + `  mobile-herdr-${version}.tar.gz\n`);
  const rejected = await install([], { ...env, TEST_CHECKSUM: wrong });
  check('checksum failure leaves installed commands and selected version intact', rejected.code !== 0 && await readlink(join(prefix, 'current')) === selected && (await reported('mobile-herdr'))[1] === version);
  const protectedBin = join(root, 'unrelated-bin'); await mkdir(protectedBin);
  await writeFile(join(protectedBin, 'mobile-herdr'), 'unrelated user command\n');
  const conflict = await install(['--bin-dir', protectedBin]);
  check('installer refuses to overwrite an unrelated command', conflict.code !== 0 && await readFile(join(protectedBin, 'mobile-herdr'), 'utf8') === 'unrelated user command\n');
  check('unavailable release preserves current installation', (await install(['--version', '99.0.0'])).code !== 0 && await readlink(join(prefix, 'current')) === selected);

  // Exercise automatic Bun setup without altering this machine's Bun, HOME or shell files.
  const isolatedTools = join(root, 'isolated-tools'); await mkdir(isolatedTools);
  await symlink(join(tools, 'curl'), join(isolatedTools, 'curl'));
  for (const name of ['bash', 'uname', 'tar', 'gzip', 'mktemp', 'sha256sum', 'grep', 'mkdir', 'rmdir', 'rm', 'awk', 'cat', 'mv', 'chmod', 'ln', 'unzip', 'dirname']) {
    const path = Bun.which(name); if (!path) throw new Error(`Installer verification needs ${name}`);
    await symlink(path, join(isolatedTools, name));
  }
  const cleanHome = join(root, 'empty-home'); await mkdir(cleanHome);
  const auto = await install(['--prefix', join(root, 'auto-runtime'), '--bin-dir', join(root, 'auto-bin')], { ...env, HOME: cleanHome, PATH: isolatedTools, MOBILE_HERDR_BUN: '' });
  if (auto.code !== 0) throw new Error(`Automatic Bun installation fixture failed: ${auto.stderr}`);
  check('missing Bun installs into the isolated prefix without editing shell configuration', auto.code === 0 && await Bun.file(join(root, 'auto-runtime/bun/bin/bun')).exists() && !(await Bun.file(join(cleanHome, '.bashrc')).exists()));
}

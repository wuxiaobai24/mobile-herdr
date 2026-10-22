import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { version } from '../package.json';

const root = resolve(import.meta.dir, '..');

async function command(args: string[], cwd = root): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`);
  return stdout.trim();
}

async function bundle(entry: string, destination: string, target: 'bun' | 'node' = 'bun'): Promise<void> {
  const result = await Bun.build({ entrypoints: [join(root, entry)], outdir: dirname(destination), naming: basename(destination), target, packages: 'bundle' });
  if (!result.success) throw new Error(result.logs.join('\n'));
}

async function dependencyNotices(destination: string): Promise<void> {
  const modules = join(root, 'node_modules');
  const notices: string[] = ['# Third-party notices', '', 'Includes notices from installed build/runtime dependencies; some are not used in the runtime bundle.', ''];
  const packages = new Bun.Glob('**/package.json');
  for await (const relative of packages.scan({ cwd: modules, onlyFiles: true, followSymlinks: false })) {
    const file = join(modules, relative);
    const metadata = JSON.parse(await readFile(file, 'utf8'));
    if (!metadata.name || !metadata.version) continue;
    notices.push(`## ${metadata.name}@${metadata.version}`, '', `License metadata: ${JSON.stringify(metadata.license ?? metadata.licenses ?? 'not specified')}`, '');
    const directory = dirname(file);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(licen[sc]e|copying|notice)([._-].*)?$/i.test(entry.name)) continue;
      const output = join('licenses', dirname(relative), entry.name);
      await mkdir(dirname(join(destination, output)), { recursive: true });
      await cp(join(directory, entry.name), join(destination, output));
      notices.push(`- [${entry.name}](${output})`);
    }
    notices.push('');
  }
  await writeFile(join(destination, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'));
}

function launcher(): string {
  return `#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "\${1:-help}" in
  help|--help|-h)
    echo 'Mobile Herdr ${version} — private beta'
    echo 'Usage: ./bin/mobile-herdr <start|background|status|stop|pair|install-agent|agent|version>'
    echo 'start: run the bridge; configure its address with MOBILE_HERDR_HOST/PORT'
    echo 'pair --url <phone-accessible URL>: print a private pairing QR code'
    echo 'install-agent [--bin-dir <directory>]: install mherdr for Herdr panes'
    exit 0 ;;
  version|--version) echo '${version}'; exit 0 ;;
  start) ENTRY='server/index.ts' ;;
  background|status|stop) ENTRY='scripts/bridge.ts' ;;
  pair) ENTRY='scripts/pair.ts' ;;
  install-agent) ENTRY='scripts/install-agent.ts' ;;
  agent) ENTRY='scripts/agent.ts' ;;
  *) echo 'Unknown command; use --help.' >&2; exit 2 ;;
esac
COMMAND=$1
shift
if [ "$ENTRY" = "scripts/bridge.ts" ]; then set -- "$COMMAND" "$@"; fi
BUN_BIN=\${MOBILE_HERDR_BUN:-bun}
if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
  echo 'Bun 1.4+ is required. See https://bun.sh/docs/installation' >&2
  exit 1
fi
"$BUN_BIN" -e 'const [major, minor] = Bun.version.split(".").map(Number); if (major < 1 || (major === 1 && minor < 4)) { console.error("Bun 1.4+ is required."); process.exit(1); }'
exec "$BUN_BIN" run "$APP_DIR/$ENTRY" "$@"
`;
}

export async function createRelease(outputDirectory = join(root, 'artifacts/releases')): Promise<string> {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  await command([process.execPath, 'run', 'build']);
  const temporary = await mkdtemp(join(tmpdir(), 'mhr-pack-'));
  const name = `mobile-herdr-${version}`;
  const destination = join(temporary, name);
  try {
    await mkdir(join(destination, 'bin'), { recursive: true });
    // Explicit allowlist: no home state, credentials, transcripts, tests or build artifacts.
    for (const entry of ['server/index.ts', 'scripts/bridge.ts', 'scripts/agent.ts', 'scripts/native-host.ts', 'scripts/pair.ts', 'scripts/install-agent.ts']) {
      await bundle(entry, join(destination, entry));
    }
    await bundle('server/ssh-worker.ts', join(destination, 'server/ssh-worker.bundle.js'));
    // Pi loads this extension inside its Node process, not inside Bun.
    await bundle('plugins/pi/mobile-herdr.ts', join(destination, 'plugins/pi/mobile-herdr.ts'), 'node');
    await cp(join(root, 'dist'), join(destination, 'dist'), { recursive: true });
    await cp(join(root, 'docs/beta-guide.md'), join(destination, 'README.md'));
    await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'mobile-herdr', version, private: true, type: 'module', engines: { bun: '>=1.4.0' }, scripts: {
      start: 'bun server/index.ts', pair: 'bun scripts/pair.ts', agent: 'bun scripts/agent.ts', 'install:agent': 'bun scripts/install-agent.ts',
    } }, null, 2) + '\n');
    await writeFile(join(destination, 'bin/mobile-herdr'), launcher(), { mode: 0o755 });
    await dependencyNotices(destination);
    await cp(join(root, 'docs/theme-licenses'), join(destination, 'licenses/themes'), { recursive: true });
    await writeFile(join(destination, 'THEME_CREDITS.md'), (await readFile(join(root, 'docs/theme-credits.md'), 'utf8')).replaceAll('theme-licenses/', 'licenses/themes/'));
    const notices = join(destination, 'THIRD_PARTY_NOTICES.md');
    await writeFile(notices, await readFile(notices, 'utf8') + '\n## Color themes\n\nCatppuccin and Flexoki are MIT licensed. See THEME_CREDITS.md and licenses/themes/.\n');
    await writeFile(join(destination, 'release.json'), JSON.stringify({ version, channel: 'private-beta', builtAt: new Date().toISOString(), buildBun: Bun.version,
      sourceCommit: await command(['git', 'rev-parse', 'HEAD']), sourceDirty: !!await command(['git', 'status', '--porcelain']),
      requirements: { bun: '>=1.4.0', herdr: '0.9.3 / protocol 22', platform: 'Linux or macOS; verify on each target before recommending it' },
    }, null, 2) + '\n');
    const output = resolve(outputDirectory);
    await mkdir(output, { recursive: true });
    const archive = join(output, name + '.tar.gz');
    // A newly built archive invalidates any previous smoke-test report for this name.
    await rm(archive + '.verification.json', { force: true });
    await command(['tar', '-czf', archive, '-C', temporary, name]);
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(archive + '.sha256', `${digest}  ${basename(archive)}\n`);
    return archive;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
  if (process.argv.length > 2) throw new Error('用法：bun run release:pack（输出到 artifacts/releases）');
  const archive = await createRelease();
  console.log(`内测包：${archive}\n校验和：${archive}.sha256\n尚未对外发布；运行 bun run test:release 验证解压后的包。`);
}

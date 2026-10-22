import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：bun run install:agent [--bin-dir <目录>]');
  console.log('默认安装到 ~/.local/bin，不修改 shell 配置。请保留安装来源目录。');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--bin-dir' || !args[1])) throw new Error('未知参数；请使用 --help 查看用法。');
const directory = args.length ? resolve(args[1]) : join(homedir(), '.local/bin');
const path = join(directory, 'mherdr');
const marker = '# Mobile Herdr agent launcher';
const previous = await readFile(path, 'utf8').catch(() => '');
if (previous && !previous.includes(marker)) throw new Error(`${path} 已存在，未覆盖。`);
function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
await mkdir(directory, { recursive: true });
await writeFile(path, `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} run ${quote(resolve(import.meta.dir, 'agent.ts'))} "$@"\n`, { mode: 0o755 });
await chmod(path, 0o755);
console.log(`已安装 ${path}。在 Herdr 的终端中使用 mherdr codex 或 mherdr pi。`);
if (!(process.env.PATH ?? '').split(':').includes(directory)) console.log(`请将 ${directory} 加入 PATH，或用完整路径运行。安装未修改 shell 配置。`);
console.log('请保留此安装来源目录；升级时等当前 agent 任务完成后，再从新目录重新安装启动命令。');

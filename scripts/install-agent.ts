import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const directory = join(homedir(), '.local/bin');
const path = join(directory, 'mherdr');
const marker = '# Mobile Herdr agent launcher';
const previous = await readFile(path, 'utf8').catch(() => '');
if (previous && !previous.includes(marker)) throw new Error(`${path} 已存在，未覆盖。`);
function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
await mkdir(directory, { recursive: true });
await writeFile(path, `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} run ${quote(resolve(import.meta.dir, 'agent.ts'))} "$@"\n`, { mode: 0o755 });
await chmod(path, 0o755);
console.log(`已安装 ${path}。在 Herdr 的终端中使用 mherdr codex 或 mherdr pi。`);

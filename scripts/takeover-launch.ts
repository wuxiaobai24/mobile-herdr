import { lstat, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpc } from '../server/rpc';
import type { Snapshot } from '../shared/protocol';

// The terminal command contains only this private ticket's path, never process credentials.
const path = resolve(process.argv[2] ?? '');
const info = await lstat(path);
if (!info.isFile() || info.uid !== process.getuid?.() || info.mode & 0o077 || info.size > 256 * 1024 || !/^[a-f\d-]{36}\.json$/.test(path.split('/').at(-1)!)) throw new Error('无效接管凭据。');
const consumed = path + '.consumed';
await rename(path, consumed);
let launch: { socket: string; paneId: string; terminalId: string; shellPid: number; env: Record<string, string>; args: string[]; conversation?: string };
try { launch = JSON.parse(await readFile(consumed, 'utf8')); } finally { await rm(consumed, { force: true }); }
if (process.ppid !== launch.shellPid || process.env.HERDR_PANE_ID !== launch.paneId || (process.env.HERDR_SOCKET_PATH ?? process.env.HERDR_SOCKET) !== launch.socket) throw new Error('当前 shell 与接管目标不一致。');
const { snapshot } = await rpc<{ snapshot: Snapshot }>(launch.socket, 'session.snapshot');
const pane = snapshot.panes.find(row => row.pane_id === launch.paneId);
const conversation = launch.conversation ?? launch.args[2];
if (!pane || pane.terminal_id !== launch.terminalId || pane.agent && (pane.agent !== launch.args[0] || pane.agent_session?.value && pane.agent_session.value !== conversation)) throw new Error('会话已变化，未启动 agent。');
const child = Bun.spawn([process.execPath, 'run', join(dirname(fileURLToPath(import.meta.url)), 'agent.ts'), ...launch.args], { env: { ...launch.env, MOBILE_HERDR_VERIFIED_RESTORE: conversation }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
process.exitCode = await child.exited;

import { spawn } from 'node:child_process';
import { mkdir, lstat, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { rpc } from '../server/rpc';
import { findNative, nativeCall } from '../server/native/registry';
import type { NativeIdentity, NativeRecord } from '../server/native/controller';
import type { NativeState } from '../shared/native';
import type { Pane, Snapshot } from '../shared/protocol';
import { isDesktopReclaim } from '../shared/terminal-keys';
import { acquireLaunchLock, clearStaleLaunchLock, launchLockPath, launchLockState } from './agent-lock';
import { assertSessionAvailable, codexOptions, piResumeId, type CodexOptions } from './agent-options';
import { version } from '../package.json';

const HELP = `mherdr codex [参数]  在当前 Herdr pane 启动或接回 Codex
mherdr pi [参数]     在当前 Herdr pane 启动 Pi
mherdr status [--json]  查看当前 pane 的连接和控制权
mherdr doctor [--json]  检查 CLI、Herdr 和启动锁
mherdr doctor --clear-stale-lock  清理已退出启动器的锁
mherdr stop         停止当前 pane 的原生 agent

手机点「在手机继续」，电脑按 Ctrl+] 接回。
恢复旧会话：mherdr codex resume <完整 ID> / mherdr pi --session <完整 ID 或路径>。`;

interface Context { socket: string; pane: Pane; snapshot: Snapshot; identity: NativeIdentity; directory: string; lock: string }

async function context(): Promise<Context> {
  const socket = process.env.HERDR_SOCKET_PATH ?? process.env.HERDR_SOCKET;
  const paneId = process.env.HERDR_PANE_ID;
  if (!socket || !paneId) throw new Error('请在 Herdr 的终端中运行，保留 HERDR_SOCKET_PATH 和 HERDR_PANE_ID。');
  const { snapshot } = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
  const pane = snapshot.panes.find(row => row.pane_id === paneId);
  if (!pane) throw new Error('找不到当前 Herdr pane；请在当前 pane 新开的 shell 中重试。');
  const directory = join(process.env.MOBILE_HERDR_STATE ?? join(homedir(), '.local/state/mobile-herdr'), 'native');
  const identity = { herdrSocket: socket, paneId, terminalId: pane.terminal_id };
  return { socket, pane, snapshot, identity, directory, lock: launchLockPath(directory, identity) };
}

function binary(provider: 'codex' | 'pi'): string {
  const value = process.env[provider === 'codex' ? 'MOBILE_HERDR_CODEX_BINARY' : 'MOBILE_HERDR_PI_BINARY'] ?? provider;
  const path = Bun.which(value);
  if (!path) throw new Error(`找不到 ${provider}。请先安装原 CLI，或设置 MOBILE_HERDR_${provider.toUpperCase()}_BINARY。`);
  return path;
}

async function summarize(ctx: Context): Promise<object> {
  const record = await findNative(ctx.directory, ctx.socket, ctx.pane);
  const base = { pane: ctx.pane.pane_id, terminal: ctx.pane.terminal_id, provider: record?.provider ?? ctx.pane.agent ?? null };
  if (!record) return { ...base, connected: false, status: '未启用原生连接', hint: '在此 pane 运行 mherdr codex 或 mherdr pi。' };
  try {
    const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' });
    const reference = ctx.pane.agent_session;
    if (ctx.pane.agent && ctx.pane.agent !== record.provider || reference?.agent === record.provider && reference.kind === 'id' && state.conversationId && reference.value !== state.conversationId) {
      return { ...base, connected: false, status: 'Herdr 上报的 agent 或对话与原生连接不一致', hint: '请在电脑确认当前会话。' };
    }
    return { ...base, connected: state.connected, status: state.status, ready: state.ready !== false && !!state.conversationId,
      control: state.owner === 'desktop' ? '电脑' : '手机', conversation: state.conversationId ?? null, runtime: state.runtimeId,
      model: state.model ?? null, pendingRequests: state.requests.length, error: state.error ?? null };
  } catch { return { ...base, connected: false, status: '原生进程离线', hint: '先运行 mherdr doctor 检查，不会自动重放消息。' }; }
}

function print(value: object, json: boolean): void {
  if (json) { console.log(JSON.stringify(value)); return; }
  for (const [key, item] of Object.entries(value)) console.log(`${key}: ${typeof item === 'object' && item !== null ? JSON.stringify(item) : item}`);
}

async function doctor(args: string[]): Promise<void> {
  const checks: Record<string, unknown> = { version, bun: Bun.version };
  for (const provider of ['codex', 'pi'] as const) {
    try { checks[provider] = binary(provider); } catch { checks[provider] = '未找到 CLI'; }
  }
  const ctx = await context().catch(error => { checks.herdr = error.message; return undefined; });
  if (ctx) {
    checks.herdr = '已连接当前 pane';
    if (args.includes('--clear-stale-lock')) checks.cleared = await clearStaleLaunchLock(ctx.lock);
    checks.launcher = await launchLockState(ctx.lock) ?? '没有启动器占用';
    checks.native = await summarize(ctx);
  } else if (args.includes('--clear-stale-lock')) throw new Error('无法确认当前 Herdr pane，不清理启动锁。');
  print(checks, args.includes('--json'));
}

async function waitForChild(child: Bun.Subprocess): Promise<number> {
  function terminate(): void { child.kill('SIGTERM'); }
  process.on('SIGTERM', terminate);
  try { return await child.exited; }
  finally { process.off('SIGTERM', terminate); }
}

async function launchPi(ctx: Context, args: string[], command: string): Promise<number> {
  const session = await piResumeId(args);
  assertSessionAvailable(ctx.snapshot.panes, ctx.pane, session);
  if (session) for (const other of ctx.snapshot.panes) {
    if (other.terminal_id === ctx.pane.terminal_id || other.agent !== 'pi' || other.agent_session?.kind !== 'path') continue;
    const id = await piResumeId(['--session', other.agent_session.value]);
    if (id === session) throw new Error('此 Pi 会话仍在另一个 Herdr pane 中运行。请先退出原 CLI。');
  }
  if (ctx.pane.agent || await registered(ctx)) throw new Error('此 pane 已有 agent 或原生连接。请先退出旧 CLI，或在新 pane 启动 Pi。');
  const child = Bun.spawn([command, '--extension', resolve(import.meta.dir, '../plugins/pi/mobile-herdr.ts'), ...args], {
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, MOBILE_HERDR_NATIVE_DIRECTORY: ctx.directory, MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify(ctx.identity) },
  });
  return waitForChild(child);
}

async function registered(ctx: Context): Promise<NativeRecord | undefined> {
  const record = await findNative(ctx.directory, ctx.socket, ctx.pane);
  if (!record) return;
  try { process.kill(record.pid, 0); return record; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    await unlink(join(ctx.directory, record.runtimeId + '.json'));
    await unlink(join(ctx.directory, record.runtimeId + '.launch.json')).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    for (const path of [record.endpoint, join(ctx.directory, record.runtimeId + '.tui.sock')]) {
      const info = await lstat(path).catch(() => undefined);
      if (info?.isSocket()) await unlink(path);
    }
  }
}

async function startCodex(ctx: Context, options: CodexOptions, command: string): Promise<NativeRecord> {
  const child = spawn(process.execPath, ['run', resolve(import.meta.dir, 'native-host.ts')], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, MOBILE_HERDR_CODEX_BINARY: command, MOBILE_HERDR_CODEX_SERVER_ARGS: JSON.stringify(options.serverArgs),
      MOBILE_HERDR_NATIVE_DIRECTORY: ctx.directory, MOBILE_HERDR_NATIVE_IDENTITY: JSON.stringify(ctx.identity) },
  });
  child.unref();
  for (let index = 0; index < 150; index++) {
    const record = await findNative(ctx.directory, ctx.socket, ctx.pane);
    if (record) return record;
    if (child.exitCode !== null || child.signalCode) break;
    await Bun.sleep(100);
  }
  // Only this invocation's new host is stopped; an existing runtime is never replaced.
  child.kill('SIGTERM');
  throw new Error('Codex 共享后台启动失败。请检查 CLI 的 app-server 支持和启动配置；可运行 mherdr doctor。');
}

async function launchCodex(ctx: Context, args: string[], options: CodexOptions, command: string): Promise<number> {
  assertSessionAvailable(ctx.snapshot.panes, ctx.pane, options.command === 'resume' ? options.resumeId : undefined);
  let record = await registered(ctx);
  if (record && record.provider !== 'codex') throw new Error('此 pane 已有 Pi 原生连接。请先退出 Pi，或在新 pane 启动 Codex。');
  if (!record && ctx.pane.agent) throw new Error('此 pane 已有 agent。请先结束当前任务并退出旧 CLI，再启用原生连接。');
  const created = !record;
  record ??= await startCodex(ctx, options, command);
  try { return await attachCodex(ctx, record, args, options, command, created); }
  finally {
    if (created) {
      const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' }).catch(() => undefined);
      if (state && !state.conversationId) await nativeCall(record.endpoint, { method: 'shutdown' }).catch(() => {});
    }
  }
}

async function attachCodex(ctx: Context, record: NativeRecord, args: string[], options: CodexOptions, command: string, created: boolean): Promise<number> {
  const launchFile = join(ctx.directory, record.runtimeId + '.launch.json');
  if (created) await writeFile(launchFile, JSON.stringify(options.reattachArgs), { mode: 0o600, flag: 'wx' });
  const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' });
  if (!state.connected) throw new Error(state.error ?? '原生进程已离线。请先用 mherdr stop 停止旧后台，再重新启动。');
  if (state.conversationId && args.length && !(options.command === 'resume' && options.resumeId === state.conversationId && args.length === 2)) throw new Error('此 pane 已有原生会话。直接运行 mherdr codex 接回；其他会话或配置请在新 pane 启动。');
  const proxy = join(ctx.directory, record.runtimeId + '.tui.sock');
  if (!(await lstat(proxy)).isSocket()) throw new Error('Codex 终端连接不存在。请运行 mherdr doctor 检查。');
  const info = await lstat(launchFile).catch(() => undefined);
  if (!info?.isFile() || info.size > 65536 || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw new Error('此实例缺少安全的重连配置。请先完成当前任务，再用 mherdr stop 停止，并按精确会话 ID 恢复。');
  const reattachArgs: unknown = JSON.parse(await readFile(launchFile, 'utf8'));
  if (!Array.isArray(reattachArgs) || !reattachArgs.every(value => typeof value === 'string')) throw new Error('实例重连配置无效，未启动另一个终端。');
  const endpoint = record.endpoint;
  await nativeCall(endpoint, { method: 'attach' });
  const remote = `unix://${proxy}`;
  const launchArgs = state.conversationId ? ['resume', state.conversationId, '--remote', remote, ...reattachArgs] : ['--remote', remote, ...args];
  console.log('已启用手机接管。在手机选择当前 pane；电脑按 Ctrl+] 随时接回。退出终端界面不会停止后台 Codex。');
  const terminal = new Bun.Terminal({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24, data(_terminal, bytes) { process.stdout.write(bytes); } });
  let owner = 'desktop';
  const poll = setInterval(() => void nativeCall<NativeState>(endpoint, { method: 'state' }).then(value => { owner = value.owner; }).catch(() => {}), 300);
  function input(bytes: Buffer): void {
    if (isDesktopReclaim(bytes.toString())) { void nativeCall(endpoint, { method: 'desktop' }).then(() => { owner = 'desktop'; }).catch(() => {}); return; }
    if (owner === 'desktop' || bytes[0] === 0x1b) terminal.write(bytes);
  }
  function resize(): void { terminal.resize(process.stdout.columns || 80, process.stdout.rows || 24); }
  try {
    const tui = Bun.spawn([command, ...launchArgs], { terminal, env: { ...process.env } });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume(); process.stdin.on('data', input); process.stdout.on('resize', resize);
    return await waitForChild(tui);
  } finally {
    clearInterval(poll); process.stdin.off('data', input); process.stdout.off('resize', resize); process.stdin.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    terminal.close();
  }
}

async function main(): Promise<void> {
  const [provider, ...args] = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
  if (!provider || ['--help', '-h', 'help'].includes(provider)) { console.log(HELP); return; }
  if (provider === '--version' || provider === '-V') { console.log(version); return; }
  if (['doctor', 'status', 'stop'].includes(provider)) {
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
    const allowed = provider === 'doctor' ? ['--json', '--clear-stale-lock'] : provider === 'status' ? ['--json'] : [];
    if (args.some(arg => !allowed.includes(arg))) throw new Error('参数无效，请运行 mherdr --help 查看用法。');
  }
  if (provider === 'doctor') { await doctor(args); return; }
  if (!['codex', 'pi', 'stop', 'status'].includes(provider)) throw new Error(HELP);
  const beforeSeparator = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'));
  if ((provider === 'codex' || provider === 'pi') && beforeSeparator.some(arg => ['--help', '-h', '--version', '-V', '-v'].includes(arg))) {
    process.exitCode = await waitForChild(Bun.spawn([binary(provider), ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: { ...process.env } })); return;
  }
  const options = provider === 'codex' ? codexOptions(args) : undefined;
  const ctx = await context();
  if (provider === 'status') { print(await summarize(ctx), args.includes('--json')); return; }
  if (provider === 'stop') {
    const record = await findNative(ctx.directory, ctx.socket, ctx.pane);
    if (!record) throw new Error('当前 pane 没有原生 agent。');
    await nativeCall(record.endpoint, { method: 'shutdown' }); console.log('已请求停止当前 pane 的原生 agent。'); return;
  }
  const command = binary(provider as 'codex' | 'pi');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互终端运行 mherdr；脚本或 RPC 模式请使用原 CLI。');
  await mkdir(ctx.directory, { recursive: true, mode: 0o700 });
  const unlock = await acquireLaunchLock(ctx.lock);
  try { process.exitCode = provider === 'pi' ? await launchPi(ctx, args, command) : await launchCodex(ctx, args, options!, command); }
  finally { await unlock(); }
}

await main().catch(error => { console.error(`mherdr: ${error instanceof Error ? error.message : '操作失败。'}`); process.exitCode = 1; });

import { mkdir, readFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BridgeConfig } from '../config';
import { BridgeError, rpc } from '../rpc';
import type { Pane } from '../../shared/protocol';
import type { NativeState } from '../../shared/native';
import type { NativeRecord } from './controller';
import { findNative, nativeCall } from './registry';
import { clearStaleLaunchLock, launchLockPath, launchLockState } from '../../scripts/agent-lock';
import { codexOptions } from '../../scripts/agent-options';

interface ProcessInfo { shell_pid?: number; foreground_processes?: { pid: number; argv?: string[] }[] }
export interface RestartJob { id: string; socket: string; pane: Pane; clientId: string; runtimeId?: string }
export interface RestartHooks {
  pane(released?: boolean): Promise<Pane>;
  progress(phase: 'checking' | 'waiting' | 'reconnecting', message: string, cancellable?: boolean): void;
  claim(conversation: string): Promise<boolean>;
  complete(): void;
}
function changed(): never { throw new BridgeError('agent_changed', '原运行实例或输入权已变化，重启已停止。', 409); }
function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export function piRestartArgs(args: string[], conversation: string): string[] {
  const values = new Set(['--provider', '--model', '--thinking', '--tools', '--session-dir', '--extension', '-e', '--theme']);
  const switches = new Set(['--offline', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-approve']);
  const result: string[] = ['--session', conversation];
  for (let i = 0; i < args.length; i++) {
    const token = args[i], name = token.split('=')[0];
    if (['--continue', '-c', '--resume', '-r'].includes(token)) continue;
    if (name === '--session') { if (token === name) i++; continue; }
    if (values.has(name)) {
      const value = token === name ? args[++i] : token.slice(name.length + 1);
      if (!value || value.startsWith('-')) throw new Error('Pi 启动参数不完整，未停止原进程。');
      if (['--extension', '-e'].includes(name) && /(?:^|\/)mobile-herdr\.(?:ts|js)$/.test(value)) continue;
      result.push(name, value); continue;
    }
    if (switches.has(token)) { result.push(token); continue; }
    throw new Error('无法安全恢复 Pi 启动参数，未停止原进程。请在电脑完成重启。');
  }
  return result;
}

/** Explicit idle-only replacement; the original process must be gone before launch. */
export async function restartNative(config: BridgeConfig, root: string, job: RestartJob, record: NativeRecord, hooks: RestartHooks): Promise<void> {
  if (record.provider === 'omp') throw new Error('OMP 暂不支持从手机重启适配器；请在电脑退出后显式重新启动，原进程保持运行。');
  if (job.runtimeId && job.runtimeId !== record.runtimeId) changed();
  const directory = join(config.stateDir, 'native');
  const original = await nativeCall<NativeState>(record.endpoint, { method: 'state' });
  const conversation = original.conversationId;
  if (!original.connected || !conversation || original.ready === false) throw new Error('原会话尚未就绪，请先在电脑核对当前连接。');
  function matches(state: NativeState): void {
    if (state.runtimeId !== original.runtimeId || state.conversationId !== conversation || !state.connected || state.owner !== 'desktop' && state.owner !== job.clientId) changed();
  }
  matches(original);
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    await hooks.pane();
    const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' }); matches(state);
    if (state.requests.length || state.status === 'blocked') throw new Error('请先处理当前审批或问题，再用新版重启。');
    if (state.status === 'idle') break;
    if (Date.now() > deadline) throw new Error('等待任务结束超时，原实例保持运行。');
    hooks.progress('waiting', '等待当前任务完成，再用新版 mherdr 重启，可取消…'); await Bun.sleep(300);
  }
  const info = async () => (await rpc<{ process_info: ProcessInfo }>(job.socket, 'pane.process_info', { pane_id: job.pane.pane_id })).process_info;
  const initial = await info();
  if (!initial.shell_pid) throw new Error('Herdr 未报告原 shell，未停止当前 agent。');
  const env = Object.fromEntries((await readFile(`/proc/${record.pid}/environ`, 'utf8')).split('\0').filter(Boolean).map(row => { const at = row.indexOf('='); return [row.slice(0, at), row.slice(at + 1)]; }));
  if (env.HERDR_PANE_ID !== job.pane.pane_id || (env.HERDR_SOCKET_PATH ?? env.HERDR_SOCKET) !== job.socket) changed();
  const lock = launchLockPath(directory, record), launcher = await launchLockState(lock);
  let args: string[], binary: string;
  if (record.provider === 'codex') {
    const saved: unknown = JSON.parse(await readFile(join(directory, record.runtimeId + '.launch.json'), 'utf8'));
    if (!Array.isArray(saved) || !saved.every(value => typeof value === 'string')) throw new Error('原实例缺少可验证的启动参数，未停止当前 agent。');
    const options = codexOptions(['resume', conversation, ...saved]);
    args = ['codex', 'resume', conversation];
    for (let i = 0; i < options.reattachArgs.length; i++) {
      const flag = options.reattachArgs[i];
      if (original.model && ['--model', '-m'].includes(flag)) { i++; continue; }
      args.push(flag);
    }
    if (original.model) args.push('--model', original.model);
    binary = env.MOBILE_HERDR_CODEX_BINARY ?? 'codex';
  } else {
    const command = (await readFile(`/proc/${record.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    const offset = command.findIndex(value => /(?:^|\/)pi(?:\.js)?$|\/pi-coding-agent\/dist\/cli\.js$/.test(value));
    if (offset < 0) throw new Error('无法验证原 Pi 启动参数，未停止当前 agent。');
    const saved: unknown = env.MOBILE_HERDR_PI_RESTART_ARGS ? JSON.parse(env.MOBILE_HERDR_PI_RESTART_ARGS) : command.slice(offset + 1);
    if (!Array.isArray(saved) || !saved.every(value => typeof value === 'string')) throw new Error('Pi 重启参数无效，原进程保持运行。');
    args = ['pi', ...piRestartArgs(saved, conversation)]; binary = env.MOBILE_HERDR_PI_BINARY ?? command[offset];
  }
  if (!Bun.which(binary)) throw new Error('原 CLI 已不在开发机上，未停止当前 agent。');
  if (record.provider === 'codex' && launcher?.alive) {
    const roots = new Set(initial.foreground_processes?.map(row => row.pid));
    let ancestor = launcher.pid;
    for (let i = 0; i < 64 && ancestor > 1 && !roots.has(ancestor); i++) {
      const status = await readFile(`/proc/${ancestor}/status`, 'utf8').catch(() => '');
      ancestor = Number(status.match(/^PPid:\s*(\d+)/m)?.[1] ?? 0);
    }
    if (!roots.has(ancestor)) throw new Error('启动器不在当前终端前台，未停止其他进程。');
    const launcherEnv = (await readFile(`/proc/${launcher.pid}/environ`, 'utf8')).split('\0');
    if (!launcherEnv.includes('HERDR_PANE_ID=' + job.pane.pane_id) || !launcherEnv.some(value => value === 'HERDR_SOCKET_PATH=' + job.socket || value === 'HERDR_SOCKET=' + job.socket)) changed();
  } else if (record.provider === 'codex' && initial.foreground_processes?.some(row => row.pid !== initial.shell_pid)) {
    throw new Error('原终端不是可识别的 mherdr 启动器，未停止当前进程。');
  }
  const launchDirectory = join(config.stateDir, 'takeover'); await mkdir(launchDirectory, { recursive: true, mode: 0o700 });
  const launchPath = join(launchDirectory, job.id + '.json');
  delete env.MOBILE_HERDR_CODEX_TRANSPORT; delete env.MOBILE_HERDR_CODEX_PROXY_ADAPTER;
  const launch = { socket: job.socket, paneId: job.pane.pane_id, terminalId: job.pane.terminal_id, shellPid: initial.shell_pid,
    env: { ...env, MOBILE_HERDR_STATE: config.stateDir, [record.provider === 'codex' ? 'MOBILE_HERDR_CODEX_BINARY' : 'MOBILE_HERDR_PI_BINARY']: binary }, args, conversation };
  const ticket = await open(launchPath, 'wx', 0o600);
  try { await ticket.writeFile(JSON.stringify(launch)); } finally { await ticket.close(); }
  try {
    await hooks.pane();
    const current = await nativeCall<NativeState>(record.endpoint, { method: 'state' }); matches(current);
    if (current.status !== 'idle' || current.requests.length) throw new Error('Agent 又开始工作，原实例保持运行。');
    if (current.owner === 'desktop') await nativeCall(record.endpoint, { method: 'action', input: { action: 'claim', runtimeId: current.runtimeId, conversationId: conversation, epoch: current.epoch, clientId: job.clientId, requestId: 'restart-fence-' + job.id } });
    const fenced = await nativeCall<NativeState>(record.endpoint, { method: 'state' }); matches(fenced);
    if (fenced.status !== 'idle' || fenced.requests.length) throw new Error('Agent 又开始工作，原实例保持运行。');
    hooks.progress('reconnecting', '正在退出旧实例，使用新版 mherdr 恢复同一会话…', false);
    if (record.provider === 'codex' && launcher?.alive) process.kill(launcher.pid, 'SIGTERM');
    // Stop only this registered provider. Herdr and other panes stay running.
    await nativeCall(record.endpoint, { method: 'shutdown' });
    let released = false;
    for (let i = 0; i < 150; i++) {
      await hooks.pane(true); const next = await info();
      const native = await findNative(directory, job.socket, job.pane);
      const oldAlive = (() => { try { process.kill(record.pid, 0); return true; } catch { return false; } })();
      if (!oldAlive && !native && next.shell_pid === initial.shell_pid && next.foreground_processes?.length === 1 && next.foreground_processes[0].pid === initial.shell_pid) { released = true; break; }
      await Bun.sleep(100);
    }
    if (!released) throw new Error('旧实例尚未确认退出，没有启动第二份 agent。请查看原终端。');
    const lockState = await launchLockState(lock);
    if (lockState?.alive) throw new Error('旧启动器仍占用终端，没有启动第二份 agent。');
    if (lockState) await clearStaleLaunchLock(lock);
    await hooks.pane(true);
    const command = [process.execPath, 'run', join(root, 'scripts/takeover-launch.ts'), launchPath].map(quote).join(' ');
    await rpc(job.socket, 'pane.send_input', { pane_id: job.pane.pane_id, text: command, keys: ['enter'] });
    for (let i = 0; i < 200; i++) {
      await hooks.pane(true);
      const next = await findNative(directory, job.socket, job.pane);
      if (next && next.runtimeId !== record.runtimeId && await hooks.claim(conversation)) {
        for (const setting of ['model', 'reasoning', 'mode'] as const) {
          const state = await nativeCall<NativeState>(next.endpoint, { method: 'state' });
          const value = setting === 'model' ? original.model : setting === 'reasoning' ? original.reasoningEffort : original.mode;
          const currentValue = setting === 'model' ? state.model : setting === 'reasoning' ? state.reasoningEffort : state.mode;
          const supported = setting === 'model' ? state.capabilities.models : setting === 'reasoning' ? state.capabilities.reasoning : state.capabilities.modes;
          if (!value || !supported || value === currentValue) continue;
          await nativeCall(next.endpoint, { method: 'action', input: { action: setting, runtimeId: state.runtimeId, conversationId: conversation, clientId: job.clientId, epoch: state.epoch,
            requestId: 'restart-' + setting + '-' + job.id, ...(setting === 'model' ? { model: value } : setting === 'reasoning' ? { reasoningEffort: value } : { mode: value as 'plan' | 'default' }) } });
        }
        hooks.complete(); return;
      }
      await Bun.sleep(200);
    }
    throw new Error('新版恢复结果未确认。请查看原终端，不会自动再次启动。');
  } finally { await rm(launchPath, { force: true }); }
}

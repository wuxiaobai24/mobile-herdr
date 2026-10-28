import { codexStatusConversation, daemonHasThread } from './codex-daemon';
import { CODEX_FRAME_BYTES } from './ndjson';
import { mkdir, open, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { BridgeConfig } from '../config';
import { BridgeError, rpc } from '../rpc';
import type { Pane, Snapshot } from '../../shared/protocol';
import type { NativeState } from '../../shared/native';
import type { TakeoverState } from '../../shared/takeover';
import { findNative, nativeCall } from './registry';
import { codexOptions } from '../../scripts/agent-options';
import { restartNative } from './restart';
import { createHash } from 'node:crypto';

type ProcessInfo = { shell_pid?: number; foreground_processes?: { pid: number; argv?: string[] }[] };
type Job = TakeoverState & { socket: string; pane: Pane; clientId: string; cancelled: boolean; at: number; runtimeId?: string };
export async function codexSessionForProcess(pid: number, home: string): Promise<string> {
  const ids = new Set<string>(), processes = [pid];
  for (let index = 0; index < processes.length && index < 64; index++) {
    const current = processes[index];
    const children = await readFile(`/proc/${current}/task/${current}/children`, 'utf8').catch(() => '');
    for (const child of children.trim().split(/\s+/).map(Number).filter(value => value > 0)) if (!processes.includes(child)) processes.push(child);
    const directory = `/proc/${current}/fd`;
    for (const fd of await readdir(directory).catch(() => [])) {
    if (!/^\d+$/.test(fd)) continue;
    const path = await readlink(join(directory, fd)).catch(() => '');
    if (!path.startsWith(join(home, 'sessions') + '/') || !/\/rollout-[^/]+\.jsonl$/.test(path)) continue;
    const file = await open(path, 'r').catch(() => undefined);
    if (!file) continue;
    try {
      const chunks: Buffer[] = []; let position = 0;
      while (position < CODEX_FRAME_BYTES) {
        const buffer = Buffer.alloc(Math.min(65536, CODEX_FRAME_BYTES - position));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (!bytesRead) throw new Error('incomplete metadata');
        const end = buffer.subarray(0, bytesRead).indexOf(10);
        chunks.push(buffer.subarray(0, end < 0 ? bytesRead : end)); position += bytesRead;
        if (end >= 0) break;
      }
      const header = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (header.type === 'session_meta' && /^[a-f\d-]{36}$/i.test(header.payload?.id)) ids.add(header.payload.id);
    } catch { /* A partial or unrelated file is not an identity source. */ }
    finally { await file.close(); }
    }
  }
  if (ids.size !== 1) throw new Error('无法从原 Codex 进程确认唯一会话 ID，未按目录或修改时间猜测。');
  return [...ids][0];
}
const COMPLETE = new Set(['ready', 'failed', 'cancelled']);
function quote(text: string): string { return "'" + text.replaceAll("'", "'\\''") + "'"; }
function changed(): never { throw new BridgeError('agent_changed', '当前终端或对话已变化，接管已停止。请重新选择会话。', 409); }

/** First-time setup is explicit; ordinary handoffs only change fenced ownership. */
export class Takeovers {
  private jobs = new Map<string, Job>();
  private starts = new Map<string, Promise<TakeoverState>>();
  private closed = false;
  constructor(private config: BridgeConfig, private root: string, private activity?: () => void) {}
  get busy(): boolean { return [...this.jobs.values()].some(job => !COMPLETE.has(job.phase)); }
  replacing(socket: string, pane: string): boolean { return [...this.jobs.values()].some(job => job.socket === socket && job.pane.pane_id === pane && job.operation === 'restart' && !job.cancellable && !COMPLETE.has(job.phase)); }
  close(): void { this.closed = true; for (const job of this.jobs.values()) if (job.cancellable) job.cancelled = true; }
  private view(job: Job): TakeoverState { const { id, phase, message, cancellable, operation } = job; return { id, phase, message, cancellable, operation }; }
  get(socket: string, pane: Pane): TakeoverState | null {
    const job = [...this.jobs.values()].find(row => row.socket === socket && row.pane.pane_id === pane.pane_id && row.pane.terminal_id === pane.terminal_id);
    return job ? this.view(job) : null;
  }
  start(socket: string, pane: Pane, input: Record<string, unknown>): Promise<TakeoverState> {
    const key = socket + '\0' + pane.terminal_id;
    const previous = this.starts.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.begin(socket, pane, input));
    this.starts.set(key, next);
    void next.finally(() => { if (this.starts.get(key) === next) this.starts.delete(key); }).catch(() => {});
    return next;
  }
  private async begin(socket: string, pane: Pane, input: Record<string, unknown>): Promise<TakeoverState> {
    if (input.terminalId !== pane.terminal_id || input.conversation !== pane.agent_session?.value || input.agent !== pane.agent) changed();
    if (!/^[\w-]{8,128}$/.test(String(input.clientId ?? '')) || input.clientId === 'desktop') throw new BridgeError('invalid_input', '设备标识尚未就绪。', 400);
    const existing = [...this.jobs.values()].find(row => row.socket === socket && row.pane.terminal_id === pane.terminal_id && !COMPLETE.has(row.phase));
    if (existing) {
      if (existing.clientId !== input.clientId) throw new BridgeError('takeover_busy', '另一台设备正在启用接管。', 409);
      if (input.cancel !== true && (existing.operation === 'restart') !== (input.restart === true)) throw new BridgeError('takeover_busy', '此终端的操作尚未结束，请先等待或取消。', 409);
      if (input.cancel === true && existing.cancellable) existing.cancelled = true;
      return this.view(existing);
    }
    if (input.cancel === true) throw new BridgeError('takeover_finished', '接管操作已经结束。', 409);
    for (const [id, job] of this.jobs) if (COMPLETE.has(job.phase) && Date.now() - job.at > 600000) this.jobs.delete(id);
    if (this.jobs.size >= 128) throw new BridgeError('takeover_limit', '接管操作过多，请稍后重试。', 429);
    for (const [id, job] of this.jobs) if (job.socket === socket && job.pane.terminal_id === pane.terminal_id) this.jobs.delete(id);
    if (input.restart === true) {
      if (!/^[\w-]{8,128}$/.test(String(input.requestId ?? ''))) throw new BridgeError('invalid_input', '重启操作需要唯一请求 ID。', 400);
      const root = join(this.config.stateDir, 'restart-receipts'); await mkdir(root, { recursive: true, mode: 0o700 });
      const receipt = join(root, createHash('sha256').update(socket + '\0' + input.requestId).digest('hex') + '.json');
      try { await writeFile(receipt, JSON.stringify({ terminal: pane.terminal_id, runtimeId: input.runtimeId, clientId: input.clientId }), { mode: 0o600, flag: 'wx' }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new BridgeError('delivery_unknown', '该重启请求已经提交，请核对当前实例；不会重复启动。', 409);
      }
    }
    const job: Job = { id: randomUUID(), operation: input.restart === true ? 'restart' : 'takeover', runtimeId: typeof input.runtimeId === 'string' ? input.runtimeId : undefined, phase: 'checking', message: '正在检查当前会话…', cancellable: true, socket, pane: structuredClone(pane), clientId: String(input.clientId), cancelled: false, at: Date.now() };
    this.jobs.set(job.id, job);
    void this.run(job).catch(error => { job.phase = job.cancelled ? 'cancelled' : 'failed'; job.message = job.cancelled ? '已取消，当前 agent 保持运行。' : error instanceof Error ? error.message : '启用失败。'; job.cancellable = false; });
    return this.view(job);
  }
  private progress(job: Job, phase: TakeoverState['phase'], message: string, cancellable = true): void { job.phase = phase; job.message = message; job.cancellable = cancellable; }
  private async pane(job: Job, allowReleased = false): Promise<Pane> {
    if (job.cancelled || this.closed && job.cancellable) { job.cancelled = true; throw new Error('cancelled'); }
    this.activity?.();
    const { snapshot } = await rpc<{ snapshot: Snapshot }>(job.socket, 'session.snapshot');
    const current = snapshot.panes.find(row => row.pane_id === job.pane.pane_id);
    if (!current || current.terminal_id !== job.pane.terminal_id) changed();
    if (!allowReleased && (current.agent !== job.pane.agent || current.agent_session?.value !== job.pane.agent_session?.value)) changed();
    if (snapshot.panes.some(row => row.terminal_id !== current.terminal_id && row.agent && job.pane.agent_session && row.agent_session?.value === job.pane.agent_session.value)) throw new Error('同一会话仍在另一个终端运行，未创建第二个 agent。');
    return current;
  }
  private async info(job: Job): Promise<ProcessInfo> { return (await rpc<{ process_info: ProcessInfo }>(job.socket, 'pane.process_info', { pane_id: job.pane.pane_id })).process_info; }
  private async claim(job: Job, expected?: string, expectedPid?: number, finish = true): Promise<boolean> {
    const pane = await this.pane(job, true);
    const record = await findNative(join(this.config.stateDir, 'native'), job.socket, pane);
    if (!record) return false;
    if (expectedPid && record.pid !== expectedPid) changed();
    const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' });
    if (!state.connected) throw new Error(state.error ?? '原生连接已断开，请在电脑检查。');
    const reference = job.pane.agent_session;
    const conversation = expected ?? (reference?.kind === 'id' ? reference.value : undefined);
    if (record.provider !== job.pane.agent) changed();
    if (!state.conversationId || state.ready === false) return false;
    if (conversation && state.conversationId !== conversation) changed();
    if (pane.agent && pane.agent !== record.provider) changed();
    this.progress(job, 'claiming', '正在切换到手机…', false);
    await nativeCall(record.endpoint, { method: 'action', input: { action: 'claim', runtimeId: state.runtimeId, conversationId: state.conversationId, epoch: state.epoch, clientId: job.clientId, requestId: 'takeover-' + job.id } });
    if (finish) this.progress(job, 'ready', '已接管，可以继续当前对话。', false); return true;
  }
  private async run(job: Job): Promise<void> {
    await this.pane(job);
    if (job.operation === 'restart') {
      const record = await findNative(join(this.config.stateDir, 'native'), job.socket, job.pane);
      if (record) {
        await restartNative(this.config, this.root, job, record, {
          pane: released => this.pane(job, released), progress: (phase, message, cancellable = true) => this.progress(job, phase, message, cancellable),
          claim: conversation => this.claim(job, conversation, undefined, false),
          complete: () => this.progress(job, 'ready', '已使用新版 mherdr 恢复原对话，可以继续。', false),
        });
        return;
      }
      if (job.runtimeId) changed();
      // An unregistered legacy CLI uses the existing exact-identity setup path.
    }
    if (await this.claim(job)) return;
    if (!['codex', 'pi'].includes(job.pane.agent ?? '')) throw new Error('此 agent 暂不支持原生接管。');

    for (const entry of ['scripts/agent.ts','scripts/native-host.ts','scripts/takeover-launch.ts','scripts/codex-proxy.ts','plugins/pi/mobile-herdr.ts']) if (!(await Bun.file(join(this.root,entry)).exists())) throw new Error('桥接缺少接管组件，请更新 Web bridge 后重试；原 CLI 保持运行。');
    const info = await this.info(job);
    const processes = info.foreground_processes ?? [];
    const processInfo = processes.find(row => row.pid !== info.shell_pid && row.argv?.some(arg => /(?:^|\/)(?:codex|pi)(?:\.js)?$/.test(arg)));
    if (!processInfo) throw new Error('无法确认原 CLI 进程，未向终端发送命令。');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (true) {
      const pane = await this.pane(job);
      if (!(await this.info(job)).foreground_processes?.some(row => row.pid === processInfo.pid)) changed();
      if (['idle', 'done'].includes(pane.agent_status)) break;
      if (pane.agent_status === 'blocked') throw new Error('Agent 正在等待确认，请先处理当前请求，再启用接管。');
      if (pane.agent_status !== 'working') throw new Error('无法确认 agent 是否空闲，未修改当前会话。');
      if (Date.now() > deadline) throw new Error('等待任务完成超时；当前 agent 保持运行，可稍后重试。');
      this.progress(job, 'waiting', '等待当前任务完成，可取消…'); await Bun.sleep(300);
    }
    // Linux process environment stays in memory/private files, never in a PTY command or response.
    const env = Object.fromEntries((await readFile(`/proc/${processInfo.pid}/environ`, 'utf8')).split('\0').filter(Boolean).map(row => { const at = row.indexOf('='); return [row.slice(0, at), row.slice(at + 1)]; }));
    if (env.HERDR_PANE_ID !== job.pane.pane_id || (env.HERDR_SOCKET_PATH ?? env.HERDR_SOCKET) !== job.socket) throw new Error('CLI 没有继承当前 Herdr 标识，未修改会话。');
    if (job.pane.agent === 'pi') await this.connectPi(job, processInfo.argv!, env, processInfo.pid);
    else await this.connectCodex(job, info, processInfo.argv!, env, processInfo.pid);
  }
  private async connectPi(job: Job, args: string[], env: Record<string, string>, pid: number): Promise<void> {
    if (args.includes('--no-extensions') || args.includes('-ne')) throw new Error('当前 Pi 禁用了扩展加载；此实例无法热接入。下次用 mherdr pi 启动即可一键切换。');
    const reference = job.pane.agent_session;
    let conversation = reference?.value;
    if (reference?.kind === 'path') {
      const file = await open(reference.value, 'r');
      try { const buffer = Buffer.alloc(4096); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); const header = JSON.parse(buffer.toString('utf8', 0, bytesRead).split('\n')[0]); if (header.type !== 'session' || typeof header.id !== 'string') changed(); conversation = header.id; } finally { await file.close(); }
    }
    const home = env.PI_CODING_AGENT_DIR ?? this.config.piHome;
    const directory = join(home, 'extensions'); await mkdir(directory, { recursive: true });
    const path = join(directory, 'mobile-herdr.ts'), marker = '// Mobile Herdr managed extension';
    const previous = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (previous && !previous.startsWith(marker)) throw new Error('Pi 中已有同名扩展，未覆盖。');
    const installation = await readFile(join(this.root, '.installation.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    const extension = join(installation?.prefix ? join(installation.prefix, 'current') : this.root, 'plugins/pi/mobile-herdr.ts');
    const source = `${marker}\nimport activate from ${JSON.stringify(pathToFileURL(extension).href)};\nexport default (pi) => activate(pi, { directory: ${JSON.stringify(join(this.config.stateDir, 'native'))} });\n`;
    const temporary = path + '.' + job.id;
    await writeFile(temporary, source, { mode: 0o600 }); await rename(temporary, path);
    const pane = await this.pane(job);
    if (!(await this.info(job)).foreground_processes?.some(row => row.pid === pid)) changed();
    if (!['idle', 'done'].includes(pane.agent_status)) throw new Error('Agent 又开始工作，请稍后重试。');
    this.progress(job, 'connecting', '正在给原 Pi 进程加载手机连接…', false);
    await rpc(job.socket, 'agent.prompt', { target: job.pane.pane_id, text: '/reload' });
    for (let i = 0; i < 150; i++) { if (await this.claim(job, conversation, pid)) return; await this.pane(job, true); await Bun.sleep(200); }
    throw new Error('Pi 未确认扩展已加载。原会话没有被重启；请在终端检查扩展错误。');
  }
  private async connectCodex(job: Job, info: ProcessInfo, argv: string[], env: Record<string, string>, pid: number): Promise<void> {
    const reported = job.pane.agent_session;
    let conversation = reported?.kind === 'id' && reported.agent === 'codex' ? reported.value : undefined;
    const offset = argv.findIndex(arg => /(?:^|\/)codex$/.test(arg));
    if (offset < 0 || !info.shell_pid) throw new Error('无法识别原 Codex 启动配置。');
    const options = codexOptions(argv.slice(offset + 1));
    const executable = argv[offset];
    const help = Bun.spawn([executable, '--help'], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => help.kill(), 5000);
    try { const output = await new Response(help.stdout).text(); if (await help.exited !== 0 || !output.includes('--remote')) throw new Error('当前 Codex 不支持共享连接，请先升级 Codex CLI；原会话保持运行。'); } finally { clearTimeout(timer); }
    const embedded = await codexSessionForProcess(pid, env.CODEX_HOME ?? this.config.codexHome).catch(() => undefined);
    if (embedded) {
      if (conversation && conversation !== embedded) changed();
      conversation = embedded;
    } else {
      if (!conversation) {
        this.progress(job, 'checking', '正在向原 Codex 确认当前会话…');
        const before = await rpc<{read:{text:string;revision?:number}}>(job.socket, 'pane.read', {pane_id: job.pane.pane_id, source: 'recent_unwrapped', lines: 120, strip_ansi: true});
        const current = await this.pane(job);
        if (!['idle', 'done'].includes(current.agent_status) || !(await this.info(job)).foreground_processes?.some(row => row.pid === pid)) changed();
        await rpc(job.socket, 'agent.prompt', {target:job.pane.pane_id,text:'/status'});
        for (let i = 0; i < 30; i++) {
          const next = await rpc<{read:{text:string;revision?:number}}>(job.socket, 'pane.read', {pane_id:job.pane.pane_id,source:'recent_unwrapped',lines:120,strip_ansi:true});
          if (next.read.text !== before.read.text) conversation = codexStatusConversation(next.read.text);
          if (conversation) break;
          await this.pane(job); await Bun.sleep(100);
        }
      }
      if (!conversation || !await daemonHasThread(executable, options.serverArgs, env, conversation, join(this.root, 'scripts/codex-proxy.ts'))) throw new Error('无法确认原 Codex 后台中的当前会话。原 CLI 保持运行，未创建另一份执行后端。');
      env.MOBILE_HERDR_CODEX_TRANSPORT = 'proxy';
    }
    if (!conversation || !/^[a-f\d-]{36}$/i.test(conversation)) throw new Error('Codex 会话 ID 无效。');
    const launchDirectory = join(this.config.stateDir, 'takeover'); await mkdir(launchDirectory, { recursive: true, mode: 0o700 });
    const launchPath = join(launchDirectory, job.id + '.json');
    const launch = { socket: job.socket, paneId: job.pane.pane_id, terminalId: job.pane.terminal_id, shellPid: info.shell_pid, env: { ...env, MOBILE_HERDR_STATE: this.config.stateDir, MOBILE_HERDR_CODEX_BINARY: executable }, args: ['codex', 'resume', conversation, ...options.reattachArgs] };
    const handle = await open(launchPath, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(launch)); } finally { await handle.close(); }
    try {
      const current = await this.pane(job);
      if (!(await this.info(job)).foreground_processes?.some(row => row.pid === pid)) changed();
      if (!['idle', 'done'].includes(current.agent_status)) throw new Error('Agent 又开始工作，请稍后重试。');
      this.progress(job, 'reconnecting', '正在退出空闲 Codex 界面并恢复同一个会话…', false);
      await rpc(job.socket, 'agent.prompt', { target: job.pane.pane_id, text: '/exit' });
      let shellReady = false;
      for (let i = 0; i < 100; i++) {
        const pane = await this.pane(job, true), next = await this.info(job);
        if (pane.agent && (pane.agent !== 'codex' || pane.agent_session?.value && pane.agent_session.value !== conversation)) changed();
        if (next.shell_pid === info.shell_pid && next.foreground_processes?.length === 1 && next.foreground_processes[0].pid === info.shell_pid) { shellReady = true; break; }
        await Bun.sleep(100);
      }
      if (!shellReady) throw new Error('原 Codex 尚未退出，未启动第二个进程。请在电脑检查。');
      const pane = await this.pane(job, true), next = await this.info(job);
      if (next.shell_pid !== info.shell_pid || next.foreground_processes?.length !== 1 || next.foreground_processes[0].pid !== info.shell_pid || pane.agent && pane.agent !== 'codex') changed();
      const command = [process.execPath, 'run', join(this.root, 'scripts/takeover-launch.ts'), launchPath].map(quote).join(' ');
      await rpc(job.socket, 'pane.send_text', { pane_id: job.pane.pane_id, text: command });
      await rpc(job.socket, 'pane.send_keys', { pane_id: job.pane.pane_id, keys: ['enter'] });
      for (let i = 0; i < 200; i++) { if (await this.claim(job, conversation)) return; await Bun.sleep(200); }
      throw new Error('恢复尚未确认。请查看原终端；不会自动重试或创建第二个 agent。');
    } finally { await rm(launchPath, { force: true }); }
  }
}

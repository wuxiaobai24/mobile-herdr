import { nativeRuntimeAssets } from './native/assets';
import { createServer, createConnection, type Socket } from 'node:net';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { HerdrMachine } from '../shared/protocol';
import { BridgeError } from './rpc';

export interface SshProfile { id: string; label: string; target: string; session: string; enabled: boolean }
export interface RemoteEndpoint { url: string; token: string; transport?: 'ssh-tcp' | 'ssh-unix'; closed: Promise<unknown>; close(): Promise<void> }
export interface RemoteGateway {
  list(): Promise<{ machines: HerdrMachine[]; error?: string }>;
  destination(id: string): RemoteEndpoint;
}
interface Entry { profile: SshProfile; row: HerdrMachine; endpoint?: RemoteEndpoint; pending?: Promise<void>; failures: number; retryAt: number }

export function parseProfiles(value: unknown): SshProfile[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid Herdr machine catalog.');
  const profiles: SshProfile[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || ids.has(row.id) ||
      typeof row.label !== 'string' || !row.label || row.label.length > 256 || typeof row.enabled !== 'boolean' ||
      typeof row.target !== 'string' || row.target.length > 512 || !row.target || /[\s\x00-\x1f]/.test(row.target) || row.target.startsWith('-') ||
      typeof row.session !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(row.session) || ['.', '..'].includes(row.session) || row.session.startsWith('-')) throw new Error('Invalid Herdr machine profile.');
    ids.add(row.id); profiles.push({ id: row.id, label: row.label, target: row.target, session: row.session, enabled: row.enabled });
  }
  return profiles;
}
export function profileRoute(profile: SshProfile): string {
  const fingerprint = createHash('sha256').update(JSON.stringify([profile.id, profile.target, profile.session])).digest('hex').slice(0, 20);
  return `ssh-${fingerprint}`;
}
async function readProfiles(): Promise<SshProfile[]> {
  const child = Bun.spawn([Bun.which('herdr') ?? 'herdr', 'machine', 'list', '--json'], { stdout: 'pipe', stderr: 'ignore' });
  const timeout = setTimeout(() => child.kill(), 8000);
  try {
    const text = await new Response(child.stdout).text();
    if (await child.exited !== 0 || text.length > 131072) throw new Error('Herdr machine list failed.');
    return parseProfiles(JSON.parse(text));
  } finally { clearTimeout(timeout); }
}

let workerBundle: Promise<string> | undefined;
async function workerSource(): Promise<string> {
  workerBundle ??= (async () => {
    const built = join(import.meta.dir, 'ssh-worker.bundle.js');
    if (await stat(built).catch(() => null)) return readFile(built, 'utf8');
    const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'ssh-worker.ts')], target: 'bun' });
    if (!result.success) throw new Error('Unable to build SSH worker.');
    return result.outputs[0].text();
  })().catch(error => { workerBundle = undefined; throw error; });
  return workerBundle;
}
function sshError(stderr: string, profile: SshProfile): BridgeError {
  if (/Permission denied|Host key verification|REMOTE HOST IDENTIFICATION|sign_and_send_pubkey|Authentication failed/i.test(stderr)) {
    return new BridgeError('ssh_auth', `SSH 需要认证或确认主机密钥。请在开发机运行 herdr machine reconnect ${profile.id}，完成后会自动重试。`, 409);
  }
  if (stderr.includes('MOBILE_HERDR_BUN_MISSING')) return new BridgeError('ssh_bun_missing', '远端需要 Bun 1.4+。请在远端安装后重试；不会自动安装或重启 Herdr。', 409);
  if (stderr.includes('MOBILE_HERDR_REMOTE_UNAVAILABLE')) return new BridgeError('ssh_remote_unavailable', '远端 Bun、Herdr CLI 或指定 session 尚未就绪。请在电脑检查；不会自动启动或升级 Herdr。', 409);
  if (/administratively prohibited|forwarding failed|open failed/i.test(stderr)) return new BridgeError('ssh_forwarding', 'SSH 通道未能建立，可能是转发限制或远端监听不可用。', 409);
  return new BridgeError('ssh_offline', 'SSH 连接失败。请检查 Herdr machine 的地址、网络与认证；会自动重试。', 502);
}

export async function openSsh(profile: SshProfile): Promise<RemoteEndpoint> {
  try { return await openSshTransport(profile, 'tcp'); }
  catch (error) { if (!(error instanceof BridgeError) || error.code !== 'ssh_forwarding') throw error; }
  try { return await openSshTransport(profile, 'unix'); }
  catch (error) {
    if (!(error instanceof BridgeError) || error.code !== 'ssh_forwarding') throw error;
    throw new BridgeError('ssh_forwarding', 'SSH 的 TCP 与 Unix socket 通道均未建立。请检查 SSH 转发策略（AllowTcpForwarding / PermitOpen、AllowStreamLocalForwarding）及远端监听状态；也可手动添加已有 Web bridge 地址。', 409);
  }
}
async function openSshTransport(profile: SshProfile, transport: 'tcp' | 'unix'): Promise<RemoteEndpoint> {
  const [source, assets] = await Promise.all([workerSource(), nativeRuntimeAssets(resolve(import.meta.dir, '..'))]);
  const directory = await mkdtemp(join(tmpdir(), 'mhs-'));
  await chmod(directory, 0o700);
  const localSocket = join(directory, 'bridge.sock');
  const controlSocket = join(directory, 'control.sock');
  const remoteSocket = `/tmp/mobile-herdr-${randomUUID()}.sock`;
  const token = randomBytes(32).toString('base64url');
  const shell = 'if command -v bun >/dev/null 2>&1; then exec bun run -; elif [ -x "$HOME/.bun/bin/bun" ]; then exec "$HOME/.bun/bin/bun" run -; else echo MOBILE_HERDR_BUN_MISSING >&2; exit 127; fi';
  const binary = process.env.MOBILE_HERDR_SSH_BINARY ?? 'ssh';
  const child = Bun.spawn([binary, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', ...(transport === 'tcp' ? ['-S', controlSocket, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no'] : ['-S', 'none', '-o', 'ControlMaster=no', '-L', `${localSocket}:${remoteSocket}`]), '--', profile.target, shell], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let errorText = '';
  let ready = false;
  let remotePort: number | undefined;
  const sockets = new Set<Socket>();
  const proxy = createServer(client => {
    const upstream = createConnection(localSocket);
    sockets.add(client); sockets.add(upstream);
    client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.pipe(upstream); upstream.pipe(client);
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      clearInterval(heartbeat);
      for (const socket of sockets) socket.destroy();
      if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve()));
      if (child.exitCode === null) child.kill('SIGTERM');
      await child.exited;
      await rm(directory, { recursive: true, force: true });
    })();
    return closing;
  }
  const stderrDone = (async () => { for await (const chunk of child.stderr) errorText = (errorText + new TextDecoder().decode(chunk)).slice(-8192); })();
  void (async () => {
    let buffer = ''; const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'mobile-herdr-ssh-ready' && (transport === 'unix' || (Number.isInteger(event.port) && event.port > 0 && event.port < 65536))) { ready = true; remotePort = event.port; }
        } catch { /* Ignore login banners, never surface raw remote output. */ }
      }
      buffer = buffer.slice(-8192);
    }
  })();
  try {
    // Code and the temporary credential travel only inside SSH stdin, never argv or logs.
    child.stdin.write(source + `\nawait startSshWorker(${JSON.stringify({ ...(transport === 'unix' ? { socket: remoteSocket } : {}), token, session: profile.session, assets })});\n`);
    child.stdin.end();
    for (let attempt = 0; attempt < 300 && !ready && child.exitCode === null; attempt++) await Bun.sleep(50);
    if (!ready || child.exitCode !== null) { if (child.exitCode !== null) await stderrDone; throw sshError(errorText, profile); }
    if (transport === 'tcp') {
      const forward = Bun.spawn([binary, '-S', controlSocket, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-O', 'forward', '-L', `${localSocket}:127.0.0.1:${remotePort}`, '--', profile.target], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
      const deadline = setTimeout(() => forward.kill(), 10000);
      try {
        const output = await new Response(forward.stderr).text();
        if (await forward.exited !== 0) throw new BridgeError('ssh_forwarding', 'SSH TCP 通道未能建立。', 409);
        errorText = (errorText + output).slice(-8192);
      } finally { clearTimeout(deadline); }
    }
    await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', () => { proxy.off('error', reject); resolve(); }); });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('SSH proxy unavailable.');
    const url = `http://127.0.0.1:${address.port}`;
    async function probe(): Promise<void> {
      const response = await fetch(url + '/api/info', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      await response.arrayBuffer();
      if (!response.ok) throw new Error('SSH heartbeat failed.');
    }
    try { await probe(); }
    catch {
      const error = sshError(errorText, profile);
      if (['ssh_auth', 'ssh_bun_missing', 'ssh_remote_unavailable'].includes(error.code)) throw error;
      throw new BridgeError('ssh_forwarding', 'SSH 通道探测失败。', 409);
    }
    let probing = false;
    heartbeat = setInterval(() => {
      if (probing) return;
      probing = true;
      void probe().catch(() => close()).finally(() => { probing = false; });
    }, 10000);
    heartbeat.unref();
    void child.exited.then(() => close());
    return { url, token, transport: transport === 'tcp' ? 'ssh-tcp' : 'ssh-unix', closed: child.exited, close };
  } catch (error) { await close(); throw error; }
}

export class SshMachines implements RemoteGateway {
  private entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing?: Promise<void>;
  private stopped = false;
  private error?: string;
  constructor(private read = readProfiles, private open = openSsh) {}
  start(): void { void this.refresh(); this.timer = setInterval(() => void this.refresh(), 5000); this.timer.unref(); }
  refresh(): Promise<void> {
    this.refreshing ??= this.update().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async update(): Promise<void> {
    try {
      const profiles = await this.read();
      if (this.stopped) return;
      this.error = undefined;
      const routes = new Set(profiles.map(profileRoute));
      for (const [id, entry] of this.entries) if (!routes.has(id)) { this.entries.delete(id); void entry.endpoint?.close(); }
      for (const profile of profiles) {
        const id = profileRoute(profile);
        let entry = this.entries.get(id);
        if (!entry) { entry = { profile, row: { id, name: profile.label, session: profile.session, status: profile.enabled ? 'connecting' : 'disabled' }, failures: 0, retryAt: 0 }; this.entries.set(id, entry); }
        entry.profile = profile; entry.row.name = profile.label;
        if (!profile.enabled) { entry.row.status = 'disabled'; entry.row.error = undefined; const endpoint = entry.endpoint; entry.endpoint = undefined; void endpoint?.close(); }
        else if (!entry.endpoint && !entry.pending && Date.now() >= entry.retryAt) this.connect(id, entry);
      }
    } catch { if (!this.stopped) this.error = '无法读取 Herdr machine 列表；保留已有连接，请在开发机检查 herdr machine list --json。'; }
  }
  private connect(id: string, entry: Entry): void {
    entry.row.status = 'connecting'; entry.row.error = undefined;
    entry.pending = this.open(entry.profile).then(async endpoint => {
      if (this.stopped || this.entries.get(id) !== entry || !entry.profile.enabled) { await endpoint.close(); return; }
      entry.endpoint = endpoint; entry.row.status = 'online'; entry.failures = 0;
      void endpoint.closed.then(() => {
        if (entry.endpoint !== endpoint) return;
        entry.endpoint = undefined; entry.row.status = 'offline'; entry.row.error = 'SSH 连接已断开，正在重连。'; entry.retryAt = Date.now() + 1000;
      });
    }).catch(error => {
      if (this.entries.get(id) !== entry || !entry.profile.enabled || this.stopped) return;
      entry.row.status = 'offline'; entry.row.error = error instanceof BridgeError ? error.message : 'SSH 连接暂不可用，正在重试。';
      entry.retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(entry.failures++, 6));
    }).finally(() => { entry.pending = undefined; });
  }
  async list(): Promise<{ machines: HerdrMachine[]; error?: string }> {
    if (!this.timer) await this.refresh();
    return { machines: [...this.entries.values()].map(entry => ({ ...entry.row })), ...(this.error ? { error: this.error } : {}) };
  }
  destination(id: string): RemoteEndpoint {
    const entry = this.entries.get(id);
    if (!entry || !entry.profile.enabled) throw new BridgeError('ssh_machine_unavailable', '此 Herdr machine 已移除、禁用或更换目标，请重新选择。', 409);
    if (!entry.endpoint) throw new BridgeError('ssh_connecting', entry.row.error ?? '正在连接 Herdr SSH machine，请稍后重试。', 503);
    return entry.endpoint;
  }
  async close(): Promise<void> {
    this.stopped = true; clearInterval(this.timer);
    await this.refreshing;
    await Promise.all([...this.entries.values()].map(async entry => { await entry.pending; await entry.endpoint?.close(); }));
    this.entries.clear();
  }
}

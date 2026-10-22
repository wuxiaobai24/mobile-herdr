import { createServer, type Server, type Socket } from 'node:net';
import { mkdir, chmod, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeAction, NativeState } from '../../shared/native';
import type { ChatMessage } from '../../shared/protocol';
import { BridgeError } from '../rpc';

export interface NativeIdentity { herdrSocket: string; paneId: string; terminalId: string }
export interface NativeRecord extends NativeIdentity { runtimeId: string; provider: 'codex' | 'pi'; pid: number; endpoint: string }
export interface NativeEnvelope { method: 'state' | 'action' | 'desktop' | 'attach' | 'shutdown'; input?: NativeAction }

/** The provider, not the web bridge, owns this state and all delivery receipts. */
export class NativeController {
  readonly state: NativeState;
  readonly record: NativeRecord;
  private server?: Server;
  private sockets = new Set<Socket>();
  private receipts = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  onControl?: () => void;
  beforeClaim?: () => void;
  onShutdown?: () => void;
  onAttach?: () => void;
  perform?: (input: NativeAction) => Promise<unknown>;

  constructor(private directory: string, identity: NativeIdentity, provider: 'codex' | 'pi') {
    const runtimeId = randomUUID();
    this.record = { ...identity, runtimeId, provider, pid: process.pid, endpoint: join(directory, runtimeId + '.sock') };
    this.state = { runtimeId, provider, owner: 'desktop', epoch: 0, revision: 0, connected: true, status: 'idle',
      messages: [], requests: [], truncated: false, capabilities: { steer: true, approvals: provider === 'codex', models: true } };
  }
  changed(): void { this.state.revision++; }
  message(message: ChatMessage): void {
    const existing = this.state.messages.find(row => row.id === message.id);
    if (existing) Object.assign(existing, message); else this.state.messages.push(message);
    // Bound both individual tool output and the complete reconnect snapshot.
    for (const row of this.state.messages) {
      if (row.text.length > 12000) { row.text = row.text.slice(-12000); this.state.truncated = true; }
      if (row.output && row.output.length > 12000) { row.output = row.output.slice(-12000); this.state.truncated = true; }
    }
    let size = this.state.messages.reduce((sum, row) => sum + row.text.length + (row.output?.length ?? 0), 0);
    while (this.state.messages.length > 160 || size > 120000) {
      const row = this.state.messages.shift()!; size -= row.text.length + (row.output?.length ?? 0); this.state.truncated = true;
    }
    this.changed();
  }
  desktop(): void {
    this.state.owner = 'desktop'; this.state.epoch++; this.changed(); this.onControl?.();
  }
  async dispatch(input: NativeAction): Promise<unknown> {
    if (input.runtimeId !== this.state.runtimeId) throw new BridgeError('runtime_changed', '运行实例已变化，请刷新后重新接管。', 409);
    if (!/^[\w-]{8,128}$/.test(input.requestId ?? '') || !/^[\w-]{8,128}$/.test(input.clientId ?? '') || input.clientId === 'desktop') throw new BridgeError('invalid_input', '操作标识无效。', 400);
    const { epoch: _epoch, ...operation } = input;
    const fingerprint = JSON.stringify(operation);
    const previous = this.receipts.get(input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BridgeError('request_conflict', '请求 ID 已用于其他操作。', 409);
      return previous.promise;
    }
    if (this.receipts.size >= 4000) throw new BridgeError('receipt_limit', '本会话的操作回执已满，请从电脑接回。', 409);
    if (input.epoch !== this.state.epoch) throw new BridgeError('control_changed', '控制权已变化，草稿已保留。请检查当前状态。', 409);
    if (input.conversationId && input.conversationId !== this.state.conversationId) throw new BridgeError('conversation_changed', '对话已变化，请检查当前会话。', 409);
    if (input.action === 'claim') {
      this.beforeClaim?.();
      if (this.state.owner !== 'desktop' && this.state.owner !== input.clientId) throw new BridgeError('control_owned', '另一台设备正在控制。请先交还控制权。', 409);
      this.state.owner = input.clientId; this.state.epoch++; this.changed(); this.onControl?.();
    } else {
      if (this.state.owner !== input.clientId) throw new BridgeError('control_required', '请先点击「在手机继续」。', 409);
      if (input.action === 'release') this.desktop();
    }
    const promise = input.action === 'claim' || input.action === 'release'
      ? Promise.resolve({ ok: true, epoch: this.state.epoch })
      : this.perform ? this.perform(input) : Promise.reject(new BridgeError('native_unavailable', '原生连接尚未就绪。', 409));
    this.receipts.set(input.requestId, { fingerprint, promise });
    return promise;
  }
  async listen(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    this.server = createServer(socket => {
      this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket));
      socket.setEncoding('utf8'); socket.setTimeout(35000, () => socket.destroy());
      let buffer = ''; let received = false;
      socket.on('error', () => {});
      socket.on('data', chunk => {
        if (received) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 65536) { socket.destroy(); return; }
        const end = buffer.indexOf('\n'); if (end < 0) return;
        received = true;
        void (async () => {
          try {
            const request = JSON.parse(buffer.slice(0, end)) as NativeEnvelope;
            let result: unknown;
            if (request.method === 'state') result = this.state;
            else if (request.method === 'desktop') { this.desktop(); result = { ok: true }; }
            else if (request.method === 'attach' && this.onAttach) { this.onAttach(); this.desktop(); result = { ok: true }; }
            else if (request.method === 'shutdown' && this.onShutdown) { result = { ok: true }; setTimeout(() => this.onShutdown?.(), 20); }
            else if (request.method === 'action' && request.input) result = await this.dispatch(request.input);
            else throw new BridgeError('invalid_input', '无效操作。', 400);
            socket.end(JSON.stringify({ result }) + '\n');
          } catch (error) {
            socket.end(JSON.stringify({ error: { code: error instanceof BridgeError ? error.code : 'native_error', message: error instanceof Error ? error.message : '原生操作失败。' } }) + '\n');
          }
        })();
      });
    });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.record.endpoint, resolve); });
    await chmod(this.record.endpoint, 0o600);
    const path = join(this.directory, this.record.runtimeId + '.json');
    await writeFile(path + '.tmp', JSON.stringify(this.record), { mode: 0o600 }); await rename(path + '.tmp', path);
  }
  async close(): Promise<void> {
    this.state.connected = false; this.state.status = 'offline'; this.changed();
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    await unlink(this.record.endpoint).catch(() => {});
    await unlink(join(this.directory, this.record.runtimeId + '.json')).catch(() => {});
  }
}

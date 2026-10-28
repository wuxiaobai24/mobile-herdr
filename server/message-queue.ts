import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeAction, NativeState } from '../shared/native';
import type { EnqueueInput, QueuedMessage } from '../shared/queue';
import type { Pane } from '../shared/protocol';
import { BridgeError } from './rpc';

interface Entry extends QueuedMessage { socket: string; leaseId: string; fingerprint: string }
interface Lease { socket: string; clientId: string; seen: number }
interface Target { pane: Pane; state?: NativeState; send: (action: NativeAction) => Promise<unknown> }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{8,128}$/.test(value);
const active = (row: Entry): boolean => ['queued', 'delivering', 'held', 'uncertain'].includes(row.status);

/** Only a continuously connected, foreground device may authorize automatic delivery.
 * A bridge restart loads drafts as held; a provider owns final delivery deduplication. */
export class MessageQueue {
  private entries: Entry[] = [];
  private leases = new Map<string, Lease>();
  private ready: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private running = false;
  private inflight = new Set<Entry>();
  private deliveries = new Set<Promise<void>>();
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private directory: string, private target: (socket: string, paneId: string) => Promise<Target>) {
    this.ready = this.load();
    void this.ready.catch(() => {});
  }
  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'messages.json'), 'utf8'));
      if (!Array.isArray(data)) throw new Error('Invalid queue');
      this.entries = data.slice(-400).filter(row => validId(row.id) && typeof row.socket === 'string' && typeof row.text === 'string');
      for (const row of this.entries) {
        if (row.status === 'queued') { row.status = 'held'; row.detail = 'Bridge 已重启，请检查后手动投递。'; }
        if (row.status === 'delivering') { row.status = 'uncertain'; row.detail = '投递期间连接已中断，请先核对原会话。'; }
      }
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  private persist(): Promise<void> {
    const content = JSON.stringify(this.entries);
    const write = this.writes.then(async () => {
      const path = join(this.directory, 'messages.json');
      await writeFile(path + '.tmp', content, { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  lease(socket: string, clientId: string): string {
    if (!validId(clientId) || clientId === 'desktop') throw new BridgeError('invalid_input', '设备标识无效。', 400);
    const id = randomUUID(); this.leases.set(id, { socket, clientId, seen: Date.now() }); return id;
  }
  heartbeat(id: string): void { const lease = this.leases.get(id); if (lease) lease.seen = Date.now(); }
  private connected(row: Pick<Entry, 'leaseId' | 'socket' | 'clientId'>): boolean {
    const lease = this.leases.get(row.leaseId);
    return !this.closed && !!lease && lease.socket === row.socket && lease.clientId === row.clientId && Date.now() - lease.seen < 15000;
  }
  async disconnect(id: string): Promise<void> {
    this.leases.delete(id); await this.ready;
    for (const row of this.entries) if (row.leaseId === id && row.status === 'queued') { row.status = 'held'; row.detail = '连接已中断，请检查后手动投递。'; row.updated = Date.now(); }
    await this.persist();
  }
  private public(row: Entry): QueuedMessage { const { socket: _socket, leaseId: _lease, fingerprint: _fingerprint, ...value } = row; return value; }
  async list(socket: string, clientId: string): Promise<QueuedMessage[]> {
    await this.ready;
    const rows = this.entries.filter(row => row.socket === socket && row.clientId === clientId && row.status !== 'cancelled');
    const receipts = new Set(rows.filter(row => !active(row)).slice(-20));
    return rows.filter(row => active(row) || receipts.has(row)).map(row => {
      const value = this.public(row);
      return active(row) ? value : { ...value, text: '', skills: undefined, attachments: undefined };
    });
  }
  private verify(row: QueuedMessage, target: Target): NativeState {
    const { state, pane } = target;
    if (pane.terminal_id !== row.terminalId || !state?.connected || state.runtimeId !== row.runtimeId || state.conversationId !== row.conversationId) throw new BridgeError('queue_target_changed', '原终端或对话已变化，请保留内容并重新选择。', 409);
    if (state.owner !== row.clientId || state.epoch !== row.epoch) throw new BridgeError('control_changed', '输入权已变化，请核对原会话后取回草稿。', 409);
    if (!state.capabilities.idlePrompt) throw new BridgeError('queue_unsupported', '当前适配器尚未支持下一轮消息，请在任务结束后使用新版 mherdr 重启。', 409);
    return state;
  }
  async enqueue(socket: string, id: string, input: EnqueueInput): Promise<QueuedMessage> {
    await this.ready;
    if (!validId(id) || !validId(input.clientId) || typeof input.text !== 'string' || input.text.length > 32000 || !input.text.trim() && !input.attachments?.length || !Number.isSafeInteger(input.epoch)
      || ![input.paneId, input.terminalId, input.runtimeId, input.conversationId].every(value => typeof value === 'string' && value.length > 0 && value.length < 512)
      || [input.skills, input.attachments].some(value => value !== undefined && (!Array.isArray(value) || value.length > 30 || !value.every(item => typeof item === 'string' && item.length < 1024)))) throw new BridgeError('invalid_input', '下一轮消息格式无效。', 400);
    const { leaseId, paneId, terminalId, runtimeId, conversationId, clientId, epoch, text, skills, attachments } = input;
    const content = { paneId, terminalId, runtimeId, conversationId, clientId, epoch, text, skills, attachments };
    const fingerprint = JSON.stringify(content);
    const existing = this.entries.find(row => row.socket === socket && row.clientId === input.clientId && row.id === id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new BridgeError('request_conflict', '请求 ID 已用于其他消息。', 409);
      return this.public(existing);
    }
    if (!this.connected({ ...input, socket })) throw new BridgeError('queue_disconnected', '队列连接未就绪，草稿已保留。', 409);
    const target = await this.target(socket, input.paneId);
    this.verify({ ...content, id, status: 'queued', created: 0, updated: 0 }, target);
    // Recheck after reads; never accept a disconnected lease or race past the limit.
    if (!this.connected({ ...input, socket })) throw new BridgeError('queue_disconnected', '队列连接已断开，草稿已保留。', 409);
    const duplicate = this.entries.find(row => row.socket === socket && row.clientId === input.clientId && row.id === id);
    if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw new BridgeError('request_conflict', '请求 ID 已用于其他消息。', 409); return this.public(duplicate); }
    if (this.entries.filter(active).length >= 400 || this.entries.filter(row => row.clientId === input.clientId && active(row)).length >= 20) throw new BridgeError('queue_full', '最多保留 20 条待处理消息。', 409);
    const row: Entry = { ...content, leaseId, socket, fingerprint, id, status: 'queued', created: Date.now(), updated: Date.now() };
    const retained = this.entries.filter(item => active(item) || Date.now() - item.updated < 86400000);
    while (retained.length >= 400) retained.splice(retained.findIndex(item => !active(item)), 1);
    this.entries = [...retained, row];
    try { await this.persist(); } catch (error) { row.status = 'held'; row.detail = '保存失败，请核对后取回草稿。'; throw error; }
    return this.public(row);
  }
  async change(socket: string, clientId: string, id: string, action: 'send' | 'discard'): Promise<QueuedMessage> {
    await this.ready;
    const row = this.entries.find(row => row.socket === socket && row.clientId === clientId && row.id === id);
    if (!row) throw new BridgeError('queue_not_found', '找不到这条消息。', 404);
    if (action === 'discard') {
      if (this.inflight.has(row) || row.status === 'delivering') throw new BridgeError('queue_delivering', '消息正在投递，请先核对结果。', 409);
      row.status = 'cancelled'; row.updated = Date.now(); await this.persist();
    } else {
      if (['sent', 'cancelled'].includes(row.status)) return this.public(row);
      if (row.status === 'uncertain') throw new BridgeError('queue_uncertain', '送达结果未确认，请先查看原会话，避免重复执行。', 409);
      if (this.inflight.has(row) || row.status === 'delivering') throw new BridgeError('queue_delivering', '消息正在投递，请先核对结果。', 409);
      await this.deliver(row, false);
    }
    return this.public(row);
  }
  private deliver(row: Entry, automatic: boolean): Promise<void> {
    const task = this.performDelivery(row, automatic);
    this.deliveries.add(task);
    void task.finally(() => this.deliveries.delete(task)).catch(() => {});
    return task;
  }
  private async performDelivery(row: Entry, automatic: boolean): Promise<void> {
    this.inflight.add(row);
    let dispatched = false;
    let changed = false;
    try {
      const target = await this.target(row.socket, row.paneId);
      const state = this.verify(row, target);
      if (automatic && !this.connected(row)) throw new BridgeError('queue_disconnected', '连接已断开，请检查后手动投递。', 409);
      if (automatic && (state.status !== 'idle' || state.requests.length)) { row.status = 'queued'; return; }
      row.status = 'delivering'; row.updated = Date.now(); changed = true;
      await this.persist();
      if (automatic && !this.connected(row)) throw new BridgeError('queue_disconnected', '连接已断开，请检查后手动投递。', 409);
      // No asynchronous work between the last lease check and provider dispatch.
      const requestId = 'queue_' + createHash('sha256').update(row.socket + row.clientId + row.id).digest('hex');
      dispatched = true;
      await target.send({ action: automatic ? 'prompt_idle' : 'prompt', runtimeId: row.runtimeId, conversationId: row.conversationId, clientId: row.clientId, epoch: row.epoch, requestId, text: row.text, skills: row.skills, attachments: row.attachments });
      row.status = 'sent'; row.detail = undefined;
    } catch (error) {
      const safeBusy = error instanceof BridgeError && error.code === 'queue_not_idle';
      if (safeBusy && automatic && this.connected(row)) row.status = 'queued';
      else if (dispatched && !safeBusy) row.status = 'uncertain';
      else row.status = 'held';
      changed = true;
      row.detail = error instanceof Error ? error.message : '投递失败，请核对原会话。';
    } finally {
      if (row.status === 'queued' && !this.connected(row)) { row.status = 'held'; row.detail = '连接已断开，请检查后手动投递。'; }
      this.inflight.delete(row);
      if (changed || row.status !== 'queued') { row.updated = Date.now(); await this.persist(); }
    }
  }
  async tick(): Promise<void> {
    await this.ready;
    if (this.closed || this.running) return;
    this.running = true;
    try {
      for (const row of this.entries) {
        if (this.closed) break;
        if (row.status !== 'queued' || this.inflight.has(row)) continue;
        if (!this.connected(row)) { row.status = 'held'; row.detail = '连接已中断，请检查后手动投递。'; await this.persist(); continue; }
        // Claim the row before awaiting provider state; manual sends cannot race it.
        await this.deliver(row, true);
      }
    } finally { this.running = false; }
  }
  start(): void { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 500); this.timer.unref(); }
  async close(): Promise<void> {
    this.closed = true; clearInterval(this.timer);
    await this.ready;
    await Promise.allSettled([...this.deliveries]);
    for (const id of this.leases.keys()) await this.disconnect(id);
    await this.writes;
  }
}

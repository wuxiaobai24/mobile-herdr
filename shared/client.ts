import type { BridgeInfo, Conversation, Machine, Snapshot } from './protocol';
import type { NativeState } from './native';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}
export function requestId(): string { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; }
export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('请输入 http(s)://主机:端口，不要包含路径、用户名或密钥。');
  return url.origin;
}
export function websocketUrl(machine: Machine, path: string): string { return machine.url.replace(/^http/, 'ws') + path; }
export function machineScope(machine: Machine): string { return machine.remote ? `${machine.url}::${machine.remote}` : machine.url; }
export async function api<T>(machine: Machine, path: string, options?: { body: object; id?: string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(machine.url + path, {
      method: options ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${machine.token}`, ...(machine.remote ? { 'X-Herdr-Machine': machine.remote } : {}), ...(options ? { 'Content-Type': 'application/json', 'X-Request-ID': options.id ?? requestId() } : {}) },
      body: options ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    const message = options ? '连接中断，操作可能已经送达。草稿已保留；请检查原会话后再决定是否重发。' : '无法连接开发机。请检查地址、网络和 bridge 端口。';
    throw new ApiError('network_error', message);
  }
  const value = await response.json().catch(() => { throw new ApiError('invalid_response', '该地址未返回 Bridge 响应，请检查端口。'); });
  if (!response.ok) throw new ApiError(value.error?.code ?? 'request_failed', value.error?.message ?? '开发机操作失败。', response.status);
  return value as T;
}
export function panePath(session: string, pane: string, action: string): string { return `/api/panes/${encodeURIComponent(pane)}/${action}?session=${encodeURIComponent(session)}`; }
export async function connect(machine: Machine): Promise<BridgeInfo> {
  const info = await api<BridgeInfo>(machine, '/api/info');
  if (!Array.isArray(info.sessions) || typeof info.name !== 'string') throw new ApiError('invalid_bridge', '这个地址不是 Mobile Herdr bridge。');
  return info;
}
export interface WatchState { snapshot?: Snapshot; chat?: Conversation; native?: NativeState | null }
export function watch(machine: Machine, session: string, pane: string | undefined, onState: (state: WatchState) => void, onStatus: (status: 'live' | 'connecting' | 'offline', error?: string) => void, timing: { heartbeatMs?: number; timeoutMs?: number; retryMs?: number } = {}): () => void {
  let closed = false, attempts = 0;
  let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  const heartbeatMs = timing.heartbeatMs ?? 5000, timeoutMs = timing.timeoutMs ?? 20000;
  function reconnect(reason: string, code?: number): void {
    clearInterval(heartbeat); clearTimeout(timer);
    const previous = socket; socket = undefined;
    if (previous) { previous.onclose = null; previous.close(); }
    if (closed) return;
    onStatus('offline', code === 1008 ? '连接密钥失效，请重新连接。' : reason);
    if (code !== 1008) timer = setTimeout(open, timing.retryMs ?? Math.min(15000, 750 * 2 ** attempts++) + Math.random() * 300);
  }
  function open(): void {
    if (closed) return;
    onStatus('connecting');
    const active = new WebSocket(websocketUrl(machine, '/api/watch')); socket = active;
    let lastSeen = Date.now(), reason = '连接中断，正在重连…';
    heartbeat = setInterval(() => {
      if (closed || socket !== active) return;
      if (Date.now() - lastSeen > timeoutMs) { reconnect('连接响应超时，正在重新核对会话…'); return; }
      if (active.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: 'ping' }));
    }, heartbeatMs);
    active.onopen = () => { if (socket === active) active.send(JSON.stringify({ type: 'auth', token: machine.token, machine: machine.remote, session, pane })); };
    active.onmessage = event => {
      if (closed || socket !== active) return;
      try {
        const frame = JSON.parse(String(event.data)); lastSeen = Date.now();
        if (frame.type === 'state') { attempts = 0; onState(frame); onStatus('live'); }
        if (frame.type === 'error') { reason = frame.error.message; onStatus('offline', reason); }
      } catch { reconnect('收到无效的实时数据，正在重连。'); }
    };
    active.onerror = () => { if (!closed && socket === active) reconnect('连接中断，正在重连…'); };
    active.onclose = event => { if (!closed && socket === active) reconnect(reason, event.code); };
  }
  open();
  return () => { closed = true; clearTimeout(timer); clearInterval(heartbeat); const previous = socket; socket = undefined; previous?.close(); };
}

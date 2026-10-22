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
export async function api<T>(machine: Machine, path: string, options?: { body: object; id?: string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(machine.url + path, {
      method: options ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${machine.token}`, ...(options ? { 'Content-Type': 'application/json', 'X-Request-ID': options.id ?? requestId() } : {}) },
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
export function watch(machine: Machine, session: string, pane: string | undefined, onState: (state: WatchState) => void, onStatus: (status: 'live' | 'connecting' | 'offline', error?: string) => void): () => void {
  let closed = false;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  function open(): void {
    if (closed) return;
    onStatus('connecting');
    socket = new WebSocket(websocketUrl(machine, '/api/watch'));
    let reason: string | undefined;
    socket.onopen = () => socket?.send(JSON.stringify({ type: 'auth', token: machine.token, session, pane }));
    socket.onmessage = event => {
      if (closed) return;
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.type === 'state') { attempts = 0; onState(frame); onStatus('live'); }
        if (frame.type === 'error') { reason = frame.error.message; onStatus('offline', reason); }
      } catch { onStatus('offline', '收到无效的实时数据。'); }
    };
    socket.onerror = () => { if (!closed) onStatus('offline', '连接中断，正在重连…'); };
    socket.onclose = event => {
      if (closed) return;
      onStatus('offline', reason ?? '连接中断，正在重连…');
      if (event.code === 1008) { onStatus('offline', '连接密钥失效，请重新连接。'); return; }
      timer = setTimeout(open, Math.min(15000, 750 * 2 ** attempts++) + Math.random() * 300);
    };
  }
  open();
  return () => { closed = true; clearTimeout(timer); socket?.close(); };
}

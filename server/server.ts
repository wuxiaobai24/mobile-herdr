import { androidDownload } from './android-download';
import { MessageQueue } from './message-queue';
import type { EnqueueInput } from '../shared/queue';
import { projectFiles } from './files';
import { uploadAttachment, resolveAttachments, attachmentPrompt } from './attachments';
import { messageImage } from './message-images';
import { layoutChange } from './layout';
import type { LayoutInput } from '../shared/layout';
import { startUpdate, updateStatus } from './updates';
import { Takeovers } from './native/takeover';
import { join, resolve, sep } from 'node:path';
import type { ServerWebSocket } from 'bun';
import type { Conversation, Pane, Snapshot, HistoryPage } from '../shared/protocol';
import { allowedOrigin, cliEnvironment, resolveSession, sessions, validToken, type BridgeConfig } from './config';
import { BridgeError, rpc } from './rpc';
import { historyCursor, historyIdentity } from './history';
import { Transcripts } from './transcripts';
import type { NativeAction, NativeState } from '../shared/native';
import { findNative, nativeCall } from './native/registry';
import { isDesktopReclaim, isTerminalReply } from '../shared/terminal-keys';
import { version } from '../package.json';
import type { DiagnosticReport } from '../shared/diagnostics';
import type { RemoteGateway } from './ssh-machines';

interface SocketData {
  kind: 'watch' | 'terminal' | 'queue'; authenticated: boolean; timer?: ReturnType<typeof setInterval>;
  deadline?: ReturnType<typeof setTimeout>; process?: Bun.Subprocess; closed?: boolean;
  nativeEndpoint?: string;
  queueLease?: string;
  terminalSocket?: string; terminalPane?: string; terminalId?: string;
  terminalWritable?: boolean;
  remote?: WebSocket;
  remoteRouting?: boolean;
}
const SAFE_KEYS = new Set(['enter', 'esc', 'up', 'down', 'left', 'right', 'tab', 'ctrl+c', 'ctrl+d', 'ctrl+l', 'backspace']);

export function createBridge(config: BridgeConfig, options: { remotes?: RemoteGateway; unix?: string; onActivity?: () => void; runtimeRoot?: string } = {}): Bun.Server<SocketData> {
  const transcripts = new Transcripts(config);
  const takeovers = new Takeovers(config, options.runtimeRoot ?? resolve(import.meta.dir, '..'), options.onActivity);
  const publicDir = resolve(import.meta.dir, '../dist');
  const mutationResults = new Map<string, { at: number; promise: Promise<unknown> }>();
  const clients = new Set<ServerWebSocket<SocketData>>();
  const nativeDirectory = join(config.stateDir, 'native');
  const queue = new MessageQueue(join(config.stateDir, 'queue'), async (socket, paneId) => {
    if (takeovers.replacing(socket, paneId)) throw new BridgeError('agent_restarting', '会话正在重启，消息已暂停。', 409);
    const pane = await getPane(socket, paneId), state = await nativeState(socket, pane);
    const record = await findNative(nativeDirectory, socket, pane);
    return { pane, state, send: input => {
      if (!record || record.runtimeId !== input.runtimeId) throw new BridgeError('runtime_changed', '原生实例已变化。', 409);
      return nativeCall(record.endpoint, { method: 'action', input }, 14000);
    } };
  });

  async function terminalControl(ws: ServerWebSocket<SocketData>): Promise<boolean> {
    if (ws.data.terminalSocket && ws.data.terminalPane && takeovers.replacing(ws.data.terminalSocket, ws.data.terminalPane)) {
      ws.data.terminalWritable = false; ws.send(JSON.stringify({ type: 'control', writable: false, message: '正在使用新版 mherdr 恢复当前会话，终端暂时只读。' })); return false;
    }
    async function refreshNative(): Promise<void> {
      if (!ws.data.terminalSocket || !ws.data.terminalId) return;
      const record = await findNative(nativeDirectory, ws.data.terminalSocket, { terminal_id: ws.data.terminalId } as Pane);
      ws.data.nativeEndpoint = record?.endpoint;
    }
    if (!ws.data.nativeEndpoint) await refreshNative();
    if (!ws.data.nativeEndpoint) return true;
    let writable = false;
    let message = '原生连接中断，终端只读。请在电脑检查当前会话。';
    try {
      const state = await nativeCall<NativeState>(ws.data.nativeEndpoint, { method: 'state' });
      writable = state.connected && state.owner === 'desktop';
      if (state.connected) message = writable ? '' : 'Chat 正在控制此会话。交还输入权后可使用终端键盘。';
    } catch { await refreshNative(); /* The next control read checks the replacement provider. */ }
    if (!ws.data.closed && ws.data.terminalWritable !== writable) {
      ws.data.terminalWritable = writable;
      ws.send(JSON.stringify({ type: 'control', writable, message }));
    }
    return writable;
  }

  async function nativeState(socket: string, pane: Pane): Promise<NativeState | undefined> {
    const record = await findNative(nativeDirectory, socket, pane);
    if (!record) return;
    try {
      const state = await nativeCall<NativeState>(record.endpoint, { method: 'state' });
      const reference = pane.agent_session;
      const changedAgent = pane.agent && pane.agent !== record.provider;
      const changedSession = reference?.agent === record.provider && reference.kind === 'id' && state.conversationId && reference.value !== state.conversationId;
      if (changedAgent || changedSession) return { ...state, connected: false, status: 'offline', error: '此 pane 已切换到其他 agent 或对话。请在电脑确认当前会话，原生消息已暂停。' };
      return state;
    }
    catch {
      return { runtimeId: record.runtimeId, provider: record.provider, connected: false, owner: 'desktop', epoch: -1, revision: -1, status: 'offline',
        messages: [], requests: [], truncated: false, capabilities: { steer: false, approvals: false, models: false }, error: '原生连接已断开。请在电脑检查进程，消息不会自动重发。' };
    }
  }
  function nativeChat(state: NativeState): Conversation {
    const identity = historyIdentity([state.runtimeId, state.conversationId]);
    return { source: state.provider, binding: 'reported', candidates: [], truncated: state.truncated, messages: state.messages,
      history: state.capabilities.history ? { identity, hasMore: state.truncated, cursor: state.truncated ? historyCursor(identity, { before: state.messages[0]?.id }) : undefined } : undefined };
  }

  async function snapshot(socket: string): Promise<Snapshot> {
    const result = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
    if (result.snapshot.protocol !== 22) throw new BridgeError('unsupported_protocol', `当前支持 Herdr protocol 22，开发机返回 ${result.snapshot.protocol}。`, 409);
    return result.snapshot;
  }
  async function getPane(socket: string, id: string): Promise<Pane> {
    const pane = (await snapshot(socket)).panes.find(pane => pane.pane_id === id);
    if (!pane) throw new BridgeError('pane_not_found', '该 pane 已关闭，请重新选择。', 404);
    return pane;
  }
  function response(request: Request, value: unknown, status = 200): Response {
    const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const origin = request.headers.get('origin');
    if (origin && allowedOrigin(config, request)) {
      headers.set('access-control-allow-origin', origin);
      headers.set('vary', 'Origin');
      headers.set('access-control-allow-headers', 'Authorization, Content-Type, X-Request-ID, X-Herdr-Machine');
      headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (value instanceof Response) {
      for (const key of ['content-type', 'content-length', 'content-disposition', 'x-file-size']) { const header = value.headers.get(key); if (header) headers.set(key, header); }
      headers.set('access-control-expose-headers', 'Content-Disposition, Content-Length, X-File-Size');
      return new Response(value.body, { status: value.status, headers });
    }
    return Response.json(value, { status, headers });
  }
  function fail(error: unknown): { code: string; message: string } {
    if (error instanceof BridgeError) return { code: error.code, message: error.message };
    console.error('Bridge operation failed:', error instanceof Error ? error.message : 'unknown');
    return { code: 'internal_error', message: '开发机操作失败，请检查 bridge 日志。' };
  }
  async function body(request: Request, limit = 65536): Promise<Record<string, unknown>> {
    let value: unknown;
    const text = await request.text();
    if (Buffer.byteLength(text) > limit) throw new BridgeError('invalid_body', '请求内容过长。', 413);
    try { value = JSON.parse(text); } catch { throw new BridgeError('invalid_body', '请求格式无效。', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('invalid_body', '请求格式无效。', 400);
    return value as Record<string, unknown>;
  }
  function string(value: unknown, max = 32000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BridgeError('invalid_input', '输入为空或超过长度限制。', 400);
    return value;
  }
  async function mutate(request: Request, action: () => Promise<unknown>): Promise<unknown> {
    const id = request.headers.get('x-request-id');
    if (!id || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new BridgeError('request_id_required', '写入操作需要唯一的请求 ID。', 400);
    const content = await request.clone().text();
    const key = `${request.headers.get('x-herdr-machine') ?? 'local'}:${id}:${new URL(request.url).pathname}:${new URL(request.url).search}:${Bun.hash(content)}`;
    const existing = mutationResults.get(key);
    if (existing) return existing.promise;
    for (const [key, value] of mutationResults) if (Date.now() - value.at > 300000) mutationResults.delete(key);
    if (mutationResults.size >= 1000) throw new BridgeError('busy', '操作过于频繁，请稍后重试。', 429);
    const promise = action();
    mutationResults.set(key, { at: Date.now(), promise });
    return promise;
  }

  const server = Bun.serve<SocketData>({
    ...(options.unix ? { unix: options.unix } : { hostname: config.host, port: config.port, idleTimeout: 60 }), maxRequestBodySize: 12 * 1024 * 1024,
    async fetch(request, server) {
      options.onActivity?.();
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        if (!allowedOrigin(config, request)) return response(request, { error: { code: 'origin_denied', message: '此客户端来源未获允许。' } }, 403);
        if (request.method === 'OPTIONS') return response(request, {});
        if (['/api/watch', '/api/terminal', '/api/queue/watch'].includes(url.pathname)) {
          if (server.upgrade(request, { data: { kind: url.pathname === '/api/watch' ? 'watch' : url.pathname === '/api/queue/watch' ? 'queue' : 'terminal', authenticated: false } })) return;
          return response(request, { error: { code: 'upgrade_required', message: '需要 WebSocket。' } }, 426);
        }
        if (!validToken(config, request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')) return response(request, { error: { code: 'unauthorized', message: '连接密钥无效，请重新连接开发机。' } }, 401);
        try {
          const machineId = request.headers.get('x-herdr-machine');
          if (machineId) {
            async function forward(): Promise<{ status: number; value: unknown }> {
              const endpoint = options.remotes?.destination(machineId!);
              if (!endpoint) throw new BridgeError('ssh_unavailable', '此 bridge 尚未启用 Herdr SSH machine。', 409);
              const headers = new Headers({ Authorization: `Bearer ${endpoint.token}` });
              for (const key of ['content-type', 'x-request-id']) { const value = request.headers.get(key); if (value) headers.set(key, value); }
              try {
                const result = await fetch(endpoint.url + url.pathname + url.search, { method: request.method, headers,
                  body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text(), signal: AbortSignal.timeout(url.searchParams.get('mode') === 'download' ? 120000 : 20000), redirect: 'error' });
                return { status: result.status, value: result.ok && (/\/(files|attachments)$/.test(url.pathname) || url.pathname === '/api/android') && url.searchParams.get('mode') === 'download' ? result : await result.json() };
              } catch { throw new BridgeError('ssh_delivery_unknown', request.method === 'POST' ? 'SSH 连接中断，操作可能已经送达。草稿已保留；请检查原会话后再决定是否重发。' : 'SSH 连接已断开，正在重连。', 502); }
            }
            const result = request.method === 'POST' ? await mutate(request, forward) as { status: number; value: unknown } : await forward();
            return response(request, result.value, result.status);
          }
          if (url.pathname === '/api/update') {
            if (request.method === 'GET') return response(request, await updateStatus(config.stateDir).catch(error => { throw new BridgeError('update_check_failed', error.message, 502); }));
            if (request.method === 'POST' && takeovers.busy) throw new BridgeError('takeover_busy', '当前正在启用手机接管，请完成或取消后再更新。', 409);
            if (request.method === 'POST') return response(request, await mutate(request, () => startUpdate(resolve(import.meta.dir, '..'), config.stateDir, process.pid).catch(error => { throw new BridgeError('update_failed', error.message, 409); })));
            throw new BridgeError('method_not_allowed', '请求方法无效。', 405);
          }
          if (request.method === 'GET' && url.pathname === '/api/machines') return response(request, options.remotes ? await options.remotes.list() : { machines: [] });
          if (request.method === 'GET' && url.pathname === '/api/android') return response(request, await androidDownload(options.runtimeRoot ?? resolve(import.meta.dir, '..'), url.searchParams.get('mode')));
          if (request.method === 'GET' && url.pathname === '/api/info') {
            return response(request, { name: config.name, version, nativeProtocols: ['codex-app-server', 'pi-extension'], sessions: (await sessions(config)).map(({ socket: _, ...session }) => session) });
          }
          if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
            const catalog = options.remotes ? await options.remotes.list() : { machines: [] };
            const report: DiagnosticReport = { schemaVersion: 1, bridgeVersion: version, bunVersion: Bun.version, platform: process.platform, arch: process.arch,
              herdr: { connected: false, sessionCount: 0 }, ssh: { enabled: !!options.remotes, online: 0, connecting: 0, offline: 0, disabled: 0 },
              capabilities: { heartbeat: true, history: true, diff: true }, managed: !!process.env.MOBILE_HERDR_MANAGED_NONCE };
            for (const row of catalog.machines) report.ssh[row.status]++;
            try {
              report.herdr.sessionCount = (await sessions(config)).length;
              const socket = await resolveSession(config, url.searchParams.get('session') ?? 'default'), state = await snapshot(socket);
              report.herdr = { ...report.herdr, connected: true, version: state.version, protocol: state.protocol };
              const pane = state.panes.find(row => row.pane_id === url.searchParams.get('pane'));
              const native = pane && await nativeState(socket, pane);
              if (native) report.native = { provider: native.provider, connected: native.connected, status: native.status, control: native.owner === 'desktop' ? 'desktop' : 'mobile', pending: native.requests.length };
            } catch { /* Report offline without exposing paths or provider error details. */ }
            return response(request, report);
          }
          const socket = await resolveSession(config, url.searchParams.get('session') ?? 'default');
          if (request.method === 'POST' && url.pathname === '/api/layout') return response(request, await mutate(request, async () => layoutChange(config.stateDir, socket, request.headers.get('x-request-id')!, await body(request) as unknown as LayoutInput)));
          if (url.pathname === '/api/queue') {
            if (request.method === 'GET') return response(request, await queue.list(socket, url.searchParams.get('clientId') ?? ''));
            if (request.method !== 'POST') throw new BridgeError('method_not_allowed', '请求方法无效。', 405);
            const input = await body(request), requestId = request.headers.get('x-request-id') ?? '';
            if (input.action === 'enqueue') return response(request, await queue.enqueue(socket, requestId, input as unknown as EnqueueInput));
            if ((input.action === 'send' || input.action === 'discard') && typeof input.id === 'string' && typeof input.clientId === 'string') return response(request, await queue.change(socket, input.clientId, input.id, input.action));
            throw new BridgeError('invalid_input', '队列操作无效。', 400);
          }
          if (request.method === 'GET' && url.pathname === '/api/attention') {
            const value = await snapshot(socket);
            const panes: Pane[] = [];
            for (let i = 0; i < value.panes.length; i += 3) panes.push(...await Promise.all(value.panes.slice(i, i + 3).map(async pane => {
              const state = await nativeState(socket, pane);
              return state ? { ...pane, agent: state.provider, agent_status: state.connected && state.status !== 'offline' ? state.status : 'unknown' as const } : pane;
            })));
            return response(request, { ...value, panes });
          }
          if (request.method === 'GET' && url.pathname === '/api/snapshot') return response(request, await snapshot(socket));
          const match = url.pathname.match(/^\/api\/panes\/([^/]+)\/(chat|history|screen|bind|prompt|keys|interrupt|launch|native|takeover|files|attachments|media)$/);
          if (!match) throw new BridgeError('not_found', '接口不存在。', 404);
          const id = decodeURIComponent(match[1]);
          const pane = await getPane(socket, id);
          const action = match[2];
          if (request.method === 'GET' && action === 'media') {
            const native = await nativeState(socket, pane);
            const messages = native ? native.messages : (await transcripts.read(socket, pane)).messages;
            return response(request, await messageImage(pane, messages, url.searchParams.get('path') ?? ''));
          }
          if (action === 'attachments') {
            const current = await nativeState(socket, pane);
            const scope = { socket, terminal: pane.terminal_id, conversation: current?.conversationId ?? pane.agent_session?.value };
            if (request.method === 'GET') {
              const [file] = await resolveAttachments(config.stateDir, scope, [url.searchParams.get('id')], true);
              if (url.searchParams.get('mode') === 'download') return response(request, new Response(Bun.file(file.path), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16))}` } }));
              if (file.mime.startsWith('image/')) return response(request, { ...file, path: undefined, uri: `data:${file.mime};base64,${Buffer.from(await Bun.file(file.path).bytes()).toString('base64')}` });
              return response(request, { ...file, path: undefined });
            }
            if (request.method !== 'POST') throw new BridgeError('method_not_allowed', '请求方法无效。', 405);
            if (current && !current.capabilities.attachments) throw new BridgeError('unsupported_action', '当前 agent 适配器尚未支持附件。请在任务结束后使用新版启动器。', 409);
            return response(request, await mutate(request, async () => uploadAttachment(config.stateDir, scope, request.headers.get('x-request-id')!, await body(request, 12 * 1024 * 1024))));
          }
          if (request.method === 'GET' && action === 'files') return response(request, await projectFiles(pane, url.searchParams));
          if (request.method === 'GET' && action === 'takeover') return response(request, takeovers.get(socket, pane));
          if (request.method === 'GET' && action === 'native') return response(request, await nativeState(socket, pane) ?? null);
          if (request.method === 'GET' && action === 'chat') { const native = await nativeState(socket, pane); return response(request, native ? nativeChat(native) : await transcripts.read(socket, pane)); }
          if (request.method === 'GET' && action === 'history') {
            const cursor = url.searchParams.get('cursor') ?? undefined;
            const current = await nativeState(socket, pane);
            if (current) {
              if (!current.connected || !current.conversationId) throw new BridgeError('native_offline', '原会话尚未就绪，请稍后重试。', 409);
              if (!current.capabilities.history) throw new BridgeError('history_unsupported', '此运行实例暂不支持分页；可继续读取当前记录。', 409);
              const record = await findNative(nativeDirectory, socket, pane);
              if (!record) throw new BridgeError('native_offline', '原生连接已变化。', 409);
              return response(request, await nativeCall<HistoryPage>(record.endpoint, { method: 'history', history: { runtimeId: current.runtimeId, conversationId: current.conversationId, cursor } }, 15000));
            }
            return response(request, await transcripts.page(socket, pane, cursor));
          }
          if (request.method === 'GET' && action === 'screen') {
            const lines = Number(url.searchParams.get('lines') ?? 200);
            if (!Number.isInteger(lines) || lines < 1 || lines > 5000) throw new BridgeError('invalid_lines', '历史行数须为 1–5000。', 400);
            const result = await rpc<{ read: unknown }>(socket, 'pane.read', { pane_id: id, source: 'recent_unwrapped', lines, strip_ansi: true });
            return response(request, result);
          }
          if (request.method !== 'POST') throw new BridgeError('method_not_allowed', '请求方法无效。', 405);
          const result = await mutate(request, async () => {
            const input = await body(request);
            if (action === 'takeover') return takeovers.start(socket, await getPane(socket, id), { ...input, requestId: request.headers.get('x-request-id') });
            const setup = takeovers.get(socket, pane);
            if (setup?.operation === 'restart' && !setup.cancellable && !['ready', 'failed', 'cancelled'].includes(setup.phase)) throw new BridgeError('agent_restarting', '当前实例正在重启，草稿已保留，请等待恢复。', 409);
            const native = await findNative(nativeDirectory, socket, pane);
            if (action === 'native') {
              if (!native) throw new BridgeError('native_unavailable', '此 pane 尚未启用原生连接。请按页面说明在电脑启动。', 409);
              if (input.runtimeId !== native.runtimeId) throw new BridgeError('runtime_changed', '此 pane 的运行实例已变化，请重新接管。', 409);
              const current = await nativeState(socket, pane);
              if (!current?.connected) throw new BridgeError('native_offline', current?.error ?? '原生连接已中断。', 409);
              return nativeCall(native.endpoint, { method: 'action', input: { ...input, requestId: request.headers.get('x-request-id')! } as unknown as NativeAction }, 14000);
            }
            if (native && ['prompt', 'keys', 'interrupt', 'launch', 'bind'].includes(action)) throw new BridgeError('native_control_required', '此 pane 已启用原生连接，请使用原生 Chat 控件。', 409);
            if (action === 'interrupt') {
              const current = await getPane(socket, id);
              if (current.terminal_id !== input.terminalId || current.agent !== input.agent || current.agent_session?.value !== input.conversation) throw new BridgeError('agent_changed', '此 pane 的 agent 已变化，请检查当前会话。', 409);
              if (!current.agent || !['pi', 'codex', 'claude'].includes(current.agent)) throw new BridgeError('unsupported_agent', '此 agent 的中断方式未知，请在终端操作。', 409);
              if (['idle', 'done'].includes(current.agent_status)) return { ok: true, alreadyStopped: true };
              if (!['working', 'blocked'].includes(current.agent_status)) throw new BridgeError('agent_not_ready', '无法确认 agent 状态，请先查看终端。', 409);
              return rpc(socket, 'agent.send_keys', { target: id, keys: [current.agent === 'codex' ? 'ctrl+c' : 'esc'] });
            }
            if (action === 'bind') { await transcripts.bind(socket, pane, string(input.candidateId, 256)); return { ok: true }; }
            if (action === 'prompt') {
              if (!pane.agent) throw new BridgeError('not_an_agent', '此 pane 中没有 agent，请使用终端。', 409);
              if (pane.agent_status === 'working') throw new BridgeError('agent_working', 'Agent 正在工作，草稿已保留，请等待或先中断。', 409);
              const files = await resolveAttachments(config.stateDir, { socket, terminal: pane.terminal_id, conversation: pane.agent_session?.value }, input.attachments);
              const text = typeof input.text === 'string' && !input.text.trim() && files.length ? '' : string(input.text);
              const current = await getPane(socket, id);
              if (current.terminal_id !== pane.terminal_id || current.agent_session?.value !== pane.agent_session?.value) throw new BridgeError('agent_changed', '当前会话已变化，附件与草稿已保留。', 409);
              return rpc(socket, 'agent.prompt', { target: id, text: attachmentPrompt(text, files) });
            }
            if (action === 'keys') {
              if (!Array.isArray(input.keys) || input.keys.length > 8 || !input.keys.every(key => typeof key === 'string' && SAFE_KEYS.has(key))) throw new BridgeError('invalid_keys', '不支持的快捷键。', 400);
              return rpc(socket, 'pane.send_keys', { pane_id: id, keys: input.keys });
            }
            if (action === 'launch') {
              if (pane.agent) throw new BridgeError('pane_busy', '此 pane 已有 agent。', 409);
              const kind = string(input.kind, 20);
              if (!['codex', 'claude', 'pi'].includes(kind)) throw new BridgeError('unsupported_agent', '暂不支持此 agent。', 400);
              return rpc(socket, 'agent.start', { pane_id: id, name: `mobile-${Bun.randomUUIDv7().slice(-8)}`, kind, timeout_ms: 6000 });
            }
            throw new BridgeError('not_found', '接口不存在。', 404);
          });
          return response(request, result);
        } catch (error) { return response(request, { error: fail(error) }, error instanceof BridgeError ? error.status : 500); }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const path = resolve(publicDir, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(publicDir + sep) && path !== publicDir) return new Response(null, { status: 404 });
      let file = Bun.file(path);
      if (!(await file.exists()) || url.pathname === '/') file = Bun.file(join(publicDir, 'index.html'));
      if (!(await file.exists())) return new Response('先运行 bun run build，或在另一个终端运行 bun run dev。', { status: 503 });
      return new Response(file, { headers: {
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache',
        'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http: https: ws: wss:; frame-src 'self' http: https:; frame-ancestors 'self' ${config.origins.join(' ')}; base-uri 'none'; form-action 'none'`,
      } });
    },
    websocket: {
      maxPayloadLength: 65536, idleTimeout: 90,
      open(ws) {
        clients.add(ws);
        ws.data.deadline = setTimeout(() => ws.close(1008, 'authentication_timeout'), 5000);
      },
      async message(ws, message) {
        try {
          if (ws.data.authenticated) {
            if (ws.data.remoteRouting) {
              if (ws.data.remote && ws.data.remote.bufferedAmount > 1024 * 1024) { ws.close(1013, 'slow_ssh'); return; }
              if (ws.data.remote?.readyState === WebSocket.OPEN) ws.data.remote.send(message);
              return;
            }
            const input = JSON.parse(String(message));
            if (input.type === 'ping') { if (ws.data.queueLease) queue.heartbeat(ws.data.queueLease); ws.send(JSON.stringify({ type: 'pong' })); if (ws.data.kind === 'terminal') void terminalControl(ws); return; }
            if (ws.data.kind !== 'terminal' || !ws.data.process?.terminal) return;
            if ((ws.data.nativeEndpoint || ws.data.terminalSocket) && input.type === 'input') {
              if (!await terminalControl(ws) && !(typeof input.data === 'string' && isTerminalReply(input.data))) {
                if (typeof input.data === 'string' && isDesktopReclaim(input.data) && ws.data.nativeEndpoint && !(ws.data.terminalSocket && ws.data.terminalPane && takeovers.replacing(ws.data.terminalSocket, ws.data.terminalPane))) { await nativeCall(ws.data.nativeEndpoint, { method: 'desktop' }); await terminalControl(ws); }
                return;
              }
            }
            if (input.type === 'input' && typeof input.data === 'string' && input.data.length <= 32768) ws.data.process.terminal.write(input.data);
            if (input.type === 'resize' && Number.isInteger(input.cols) && Number.isInteger(input.rows)) ws.data.process.terminal.resize(Math.max(20, Math.min(400, input.cols)), Math.max(5, Math.min(150, input.rows)));
            return;
          }
          const hello = JSON.parse(String(message));
          if (hello.type !== 'auth' || typeof hello.token !== 'string' || !validToken(config, hello.token)) { ws.close(1008, 'unauthorized'); return; }
          ws.data.authenticated = true;
          clearTimeout(ws.data.deadline);
          if (hello.machine !== undefined) {
            if (typeof hello.machine !== 'string') throw new BridgeError('invalid_machine', '无效的 Herdr machine。', 400);
            ws.data.remoteRouting = true;
            const endpoint = options.remotes?.destination(hello.machine);
            if (!endpoint) throw new BridgeError('ssh_unavailable', '此 bridge 尚未启用 Herdr SSH machine。', 409);
            const upstream = new WebSocket(endpoint.url.replace(/^http/, 'ws') + (ws.data.kind === 'terminal' ? '/api/terminal' : ws.data.kind === 'queue' ? '/api/queue/watch' : '/api/watch'));
            ws.data.remote = upstream; upstream.binaryType = 'arraybuffer';
            upstream.onopen = () => {
              if (ws.data.closed) { upstream.close(); return; }
              upstream.send(JSON.stringify({ ...hello, machine: undefined, token: endpoint.token }));
            };
            upstream.onmessage = event => {
              if (ws.data.closed) return;
              if (ws.getBufferedAmount() > 1024 * 1024) { ws.close(1013, 'slow_client'); return; }
              ws.send(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
            };
            upstream.onclose = event => { if (!ws.data.closed) ws.close(event.code === 1008 ? 1011 : 1000, 'ssh_disconnected'); };
            upstream.onerror = () => { if (!ws.data.closed) ws.close(1011, 'ssh_connection_failed'); };
            return;
          }
          const socket = await resolveSession(config, typeof hello.session === 'string' ? hello.session : 'default');
          const paneId = typeof hello.pane === 'string' ? hello.pane : undefined;
          if (ws.data.closed) return;
          if (ws.data.kind === 'queue') {
            ws.data.queueLease = queue.lease(socket, hello.clientId);
            ws.send(JSON.stringify({ type: 'queue-ready', leaseId: ws.data.queueLease }));
            return;
          }
          if (ws.data.kind === 'terminal') {
            if (!paneId) throw new BridgeError('pane_required', '请选择终端。');
            const pane = await getPane(socket, paneId);
            ws.data.terminalSocket = socket; ws.data.terminalPane = paneId; ws.data.terminalId = pane.terminal_id;
            ws.data.nativeEndpoint = (await findNative(nativeDirectory, socket, pane))?.endpoint;
            if (ws.data.closed) return;
            const process = Bun.spawn([Bun.which('herdr') ?? 'herdr', 'terminal', 'attach', pane.terminal_id], {
              env: cliEnvironment(socket),
              terminal: {
                cols: Math.max(20, Math.min(400, Number(hello.cols) || 80)), rows: Math.max(5, Math.min(150, Number(hello.rows) || 24)),
                data(_terminal, data) {
                  if (ws.data.closed) return;
                  if (ws.getBufferedAmount() > 1024 * 1024) { ws.close(1013, 'slow_client'); return; }
                  ws.send(data);
                },
              },
            });
            ws.data.process = process;
            void process.exited.then(code => { if (!ws.data.closed) { if (code !== 0) ws.send(JSON.stringify({ type: 'error', error: { message: `终端连接失败（退出码 ${code}）。请查看终端输出或检查开发机上的 Herdr。` } })); ws.close(code === 0 ? 1000 : 1011, 'terminal_detached'); } });
            await terminalControl(ws);
            ws.send(JSON.stringify({ type: 'ready' }));
          } else {
            let running = false;
            let previousSnapshot = '';
            let previousChat = '';
            let previousNative = '';
            let cachedState: Snapshot | undefined;
            let snapshotAt = 0;
            async function tick(): Promise<void> {
              if (running || ws.data.closed) return;
              running = true;
              try {
                if (!cachedState || Date.now() - snapshotAt > 1400) { cachedState = await snapshot(socket); snapshotAt = Date.now(); }
                const state = cachedState;
                const pane = state.panes.find(item => item.pane_id === paneId);
                const native = pane ? await nativeState(socket, pane) : undefined;
                const chat: Conversation | undefined = native ? nativeChat(native) : pane ? await transcripts.read(socket, pane) : undefined;
                const snapshotJson = JSON.stringify(state);
                const chatJson = JSON.stringify(chat) ?? '';
                const snapshotChanged = snapshotJson !== previousSnapshot;
                const chatChanged = chatJson !== previousChat;
                const nativeJson = JSON.stringify(native ?? null);
                const nativeChanged = nativeJson !== previousNative;
                if (!ws.data.closed && (snapshotChanged || chatChanged || nativeChanged)) {
                  const frame = JSON.stringify({ type: 'state', ...(snapshotChanged ? { snapshot: state } : {}), ...(chatChanged ? { chat } : {}), ...(nativeChanged ? { native: native ?? null } : {}) });
                  if (ws.getBufferedAmount() > 1024 * 1024) ws.close(1013, 'slow_client');
                  else { ws.send(frame); previousSnapshot = snapshotJson; previousChat = chatJson; previousNative = nativeJson; }
                }
              } catch (error) {
                // Recovery must send a fresh state even when its contents did not change.
                previousSnapshot = ''; previousChat = ''; previousNative = ''; snapshotAt = 0;
                if (!ws.data.closed) ws.send(JSON.stringify({ type: 'error', error: fail(error) }));
              }
              finally { running = false; }
            }
            void tick();
            ws.data.timer = setInterval(() => void tick(), 300);
          }
        } catch (error) { ws.send(JSON.stringify({ type: 'error', error: fail(error) })); ws.close(1011, 'bridge_error'); }
      },
      close(ws) {
        ws.data.closed = true;
        if (ws.data.queueLease) void queue.disconnect(ws.data.queueLease).catch(() => {});
        ws.data.remote?.close();
        clearTimeout(ws.data.deadline); clearInterval(ws.data.timer);
        // Only the attach client is terminated; the Herdr pane and agent remain alive.
        ws.data.process?.kill(); ws.data.process?.terminal?.close();
        clients.delete(ws);
      },
    },
  });
  queue.start();
  const stop = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    const closing = queue.close();
    await stop(closeActiveConnections); await closing;
  };
  return server;
}

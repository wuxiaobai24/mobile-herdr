import type { ServerWebSocket } from 'bun';
import type { NativeAction, NativeRequest } from '../../shared/native';
import type { ChatMessage } from '../../shared/protocol';
import { NativeController } from './controller';
import { BridgeError } from '../rpc';
import { suppliedChanges } from '../../shared/diff';
import { version } from '../../package.json';

type Frame = Record<string, any>;
type Desktop = ServerWebSocket<{ ready: boolean }>;
const READ_METHOD = /(?:\/(?:list|read|get|status|detect)$)|^(?:model\/list|skills\/list|account\/read|configRequirements\/read|thread\/loaded\/list|thread\/turns\/list|thread\/items\/list|fuzzyFileSearch)/;

/** One app-server connection. The official TUI and phone share its live thread. */
export class CodexRuntime {
  private child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private requests = new Map<string, Frame>();
  private desktop?: Desktop;
  private initialized: Promise<any>;
  private turnId?: string;
  private stopped = false;
  private counter = 0;
  private proxy?: Bun.Server<{ ready: boolean }>;
  private selecting = 0;

  constructor(readonly control: NativeController, command: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env) {
    const providerEnv = { ...env };
    for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID']) delete providerEnv[key];
    this.child = Bun.spawn([command, ...args, 'app-server', '--stdio'], { env: providerEnv, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    void this.read();
    // Drain diagnostics without putting transcripts, prompts or credentials in logs.
    const stderr = this.child.stderr;
    void (async () => { for await (const _chunk of stderr) { /* Drain without retaining diagnostics. */ } })();
    this.initialized = this.call('initialize', { clientInfo: { name: 'mobile_herdr', title: 'Mobile Herdr', version }, capabilities: { experimentalApi: true } });
    void this.initialized.then(async () => {
      this.write({ method: 'initialized' });
      try {
        const catalog = await this.call('model/list', {});
        control.state.models = (catalog.data ?? []).slice(0, 100).map((row: Frame) => ({ id: row.model ?? row.id, name: row.displayName ?? row.model ?? row.id })); control.changed();
      } catch { control.state.capabilities.models = false; control.changed(); }
    }).catch(error => this.offline(error));
    control.readHistory = async cursor => {
      await this.initialized;
      const threadId = control.state.conversationId;
      if (!threadId) throw new BridgeError('native_not_ready', '对话尚未准备好。', 409);
      const page = await this.call('thread/turns/list', { threadId, cursor, limit: 20, sortDirection: 'desc', itemsView: 'full' });
      return { messages: [...(page.data ?? [])].reverse().flatMap((turn: Frame) => (turn.items ?? []).map((item: Frame) => this.itemMessage(item)).filter(Boolean)), nextCursor: page.nextCursor ?? undefined };
    };
    control.perform = input => this.perform(input);
    control.state.ready = false;
    control.beforeClaim = () => {
      if (!control.state.connected || !control.state.conversationId || control.state.ready === false || this.selecting) throw new BridgeError('native_not_ready', '电脑正在准备对话，请稍后再接管。', 409);
    };
    control.onAttach = () => { control.state.ready = false; control.changed(); };
    control.onControl = () => {
      if (control.state.owner === 'desktop') for (const request of this.requests.values()) this.sendDesktop(request);
    };
    void this.child.exited.then(() => this.offline(new Error('Codex 进程已退出。请在电脑重新启动原生会话。')));
  }
  private offline(error: Error): void {
    this.control.state.connected = false; this.control.state.status = 'offline'; this.control.state.error = error.message; this.control.changed();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  private write(frame: Frame): void {
    if (this.stopped || !this.control.state.connected) throw new BridgeError('native_offline', 'Codex 已离线。', 409);
    this.child.stdin.write(JSON.stringify(frame) + '\n'); this.child.stdin.flush();
  }
  call(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `mobile-herdr-${++this.counter}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BridgeError('delivery_unknown', 'Codex 未确认操作结果。请查看当前对话，不要换请求重发。', 409)); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  private sendDesktop(frame: Frame): void {
    if (!this.desktop?.data.ready) return;
    if (this.desktop.getBufferedAmount() > 1024 * 1024) { this.desktop.close(1013, 'slow_desktop'); return; }
    this.desktop.send(JSON.stringify(frame));
  }
  private async read(): Promise<void> {
    const decoder = new TextDecoder(); let buffer = ''; let protocolStarted = false;
    try {
      for await (const chunk of this.child.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 16 * 1024 * 1024) throw new Error('Codex 数据帧超过限制。');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          // Version-manager launchers may print a prelude before exec'ing Codex.
          // Never log it: stdout can contain user environment information.
          if (!line.trim() || (!protocolStarted && !line.trimStart().startsWith('{'))) continue;
          protocolStarted = true; this.receive(JSON.parse(line));
        }
      }
    } catch (error) { this.offline(error instanceof Error ? error : new Error('Codex 数据读取失败。')); }
  }
  private receive(frame: Frame): void {
    if (frame.id !== undefined && !frame.method) {
      const pending = this.pending.get(String(frame.id));
      if (pending) {
        this.pending.delete(String(frame.id)); clearTimeout(pending.timer);
        if (frame.error) pending.reject(new BridgeError('provider_rejected', frame.error.message ?? 'Codex 拒绝操作。', 409));
        else pending.resolve(frame.result);
      }
      return;
    }
    const p = frame.params ?? {};
    const threadId = p.threadId ?? p.thread?.id;
    const relevant = !threadId || threadId === this.control.state.conversationId;
    if (frame.id !== undefined && frame.method) {
      const id = String(frame.id); this.requests.set(id, frame);
      if (relevant) {
        const standardApproval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(frame.method);
        const approval = standardApproval && (!Array.isArray(p.availableDecisions) || (p.availableDecisions.includes('accept') && p.availableDecisions.includes('decline')));
        const questions = frame.method === 'item/tool/requestUserInput' && Array.isArray(p.questions) ? p.questions : undefined;
        const request: NativeRequest = { id, kind: approval ? 'approval' : questions ? 'question' : 'unsupported',
          title: questions ? 'Agent 需要你的回答' : approval ? '需要你的确认' : '请在电脑处理此请求',
          approvalType: frame.method === 'item/fileChange/requestApproval' ? 'files' : 'command',
          command: typeof p.command === 'string' ? p.command.slice(0, 12000) : undefined, cwd: typeof p.cwd === 'string' ? p.cwd.slice(0, 1024) : undefined,
          changes: suppliedChanges(p.changes ?? this.control.state.messages.find(row => row.id === p.itemId)?.text).map(file => ({ path: file.path, diff: file.patch })),
          detail: questions ? '' : String(p.reason ?? p.message ?? (p.command ? '' : '请交还电脑，在终端处理这个请求。')).slice(0, 12000), questions };
        this.control.state.requests.push(request); this.control.state.status = 'blocked'; this.control.changed();
      } else if (this.control.state.owner !== 'desktop') {
        this.control.state.requests.push({ id, kind: 'unsupported', title: '后台任务需要你处理', detail: '请交还电脑，在原始终端处理后台任务的请求。' });
        this.control.state.status = 'blocked'; this.control.changed();
      }
      if (this.control.state.owner === 'desktop') this.sendDesktop(frame);
      return;
    }
    if (relevant || frame.method === 'serverRequest/resolved') this.notification(frame.method, p);
    this.sendDesktop(frame);
  }
  private notification(method: string, p: Frame): void {
    const state = this.control.state;
    if (method === 'turn/started') { this.turnId = p.turn.id; state.status = 'working'; state.error = undefined; }
    if (method === 'turn/completed') {
      if (this.turnId === p.turn.id) this.turnId = undefined;
      state.status = state.requests.length ? 'blocked' : 'idle'; state.error = p.turn.error?.message;
    }
    if (method === 'serverRequest/resolved') {
      this.requests.delete(String(p.requestId)); state.requests = state.requests.filter(row => row.id !== String(p.requestId));
      state.status = state.requests.length ? 'blocked' : this.turnId ? 'working' : 'idle';
    }
    if (method === 'item/fileChange/patchUpdated') {
      this.control.message({ id: p.itemId, role: 'tool', toolName: 'fileChange', text: JSON.stringify(p.changes ?? []) });
      for (const request of state.requests) if (this.requests.get(request.id)?.params?.itemId === p.itemId) request.changes = suppliedChanges(p.changes).map(file => ({ path: file.path, diff: file.patch }));
    }
    if (method === 'item/started' || method === 'item/completed') this.item(p.item);
    if (method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta') {
      const previous = state.messages.find(row => row.id === p.itemId);
      const tool = method.includes('commandExecution');
      this.control.message({ id: p.itemId, role: tool ? 'tool' : 'assistant', text: tool ? previous?.text ?? '' : (previous?.text ?? '') + p.delta,
        ...(tool ? { toolName: previous?.toolName ?? 'command', output: (previous?.output ?? '') + p.delta } : {}) });
    }
    if (method === 'turn/plan/updated') this.control.message({ id: `plan-${p.turnId}`, role: 'assistant', text: (p.plan ?? []).map((row: Frame) => `${row.status === 'completed' ? '- [x]' : '- [ ]'} ${row.step}`).join('\n') });
    if (method === 'turn/diff/updated' && p.diff) this.control.message({ id: `diff-${p.turnId}`, role: 'tool', toolName: 'diff', text: p.diff });
    if (method === 'error') state.error = p.error?.message;
    if (method === 'thread/status/changed' && p.status?.type === 'idle' && !state.requests.length) state.status = 'idle';
    this.control.changed();
  }
  private itemMessage(item: Frame): ChatMessage | undefined {
    if (!item?.id) return;
    let message: ChatMessage;
    if (item.type === 'userMessage') message = { id: item.id, role: 'user', text: (item.content ?? []).map((row: Frame) => row.text ?? (row.type === 'image' ? '[图片]' : '')).join('\n') };
    else if (['agentMessage', 'plan'].includes(item.type)) message = { id: item.id, role: 'assistant', text: item.text ?? '' };
    else if (item.type === 'reasoning') return;
    else message = { id: item.id, role: 'tool', toolName: item.type, text: item.command ?? item.query ?? (item.changes ? JSON.stringify(item.changes) : item.name ?? item.type), output: item.aggregatedOutput ?? (item.result ? JSON.stringify(item.result) : undefined) };
    return message;
  }
  private item(item: Frame): void { const message = this.itemMessage(item); if (message) this.control.message(message); }
  private async selectThread(result: Frame): Promise<void> {
    const state = this.control.state;
    const thread = result.thread;
    // The official TUI also starts ephemeral helper threads (for example titles).
    // Those must never replace the conversation selected by the user.
    if (!thread?.id || thread.ephemeral) return;
    if (state.conversationId !== thread.id) {
      if (state.conversationId) this.control.desktop();
      state.messages = []; state.requests = []; state.truncated = false;
    }
    state.conversationId = thread.id; state.model = result.model ?? state.model;
    const turns = thread.turns ?? [];
    for (const turn of turns) for (const item of turn.items ?? []) this.item(item);
    this.control.changed();
    // Recent versions persist history in pages rather than returning it on resume.
    if (!turns.length) {
      try {
        const history = await this.call('thread/turns/list', { threadId: thread.id, limit: 40, sortDirection: 'desc', itemsView: 'full' });
        if (state.conversationId === thread.id) {
          const live = [...state.messages]; state.messages = [];
          for (const turn of [...(history.data ?? [])].reverse()) {
            for (const item of turn.items ?? []) this.item(item);
            if (turn.status === 'inProgress') { this.turnId = turn.id; state.status = 'working'; }
          }
          for (const row of live) this.control.message(row);
          state.truncated ||= !!history.nextCursor;
        }
      } catch { /* Live events still work on CLIs without paginated history. */ }
    }
  }
  private async perform(input: NativeAction): Promise<unknown> {
    await this.initialized;
    const state = this.control.state; const threadId = state.conversationId;
    if (state.owner !== input.clientId || state.epoch !== input.epoch) throw new BridgeError('control_changed', '控制权已变化。请检查当前状态。', 409);
    if (!state.connected || !threadId) throw new BridgeError('native_not_ready', '请先在电脑打开 Codex 对话。', 409);
    if (input.action === 'prompt') {
      if (!input.text?.trim() || input.text.length > 32000) throw new BridgeError('invalid_input', '消息为空或过长。', 400);
      if (state.requests.length) throw new BridgeError('agent_blocked', '请先回答当前问题。', 409);
      const content = [{ type: 'text', text: input.text }];
      const result = this.turnId
        ? await this.call('turn/steer', { threadId, expectedTurnId: this.turnId, input: content })
        : await this.call('turn/start', { threadId, input: content, ...(state.model ? { model: state.model } : {}) });
      return { ok: true, turnId: result.turn?.id ?? result.turnId, receipt: input.requestId };
    }
    if (input.action === 'stop') {
      if (!this.turnId) return { ok: true };
      return this.call('turn/interrupt', { threadId, turnId: this.turnId });
    }
    if (input.action === 'model') {
      if (state.status !== 'idle') throw new BridgeError('agent_working', '请在任务结束后切换模型。', 409);
      if (!input.model || input.model.length > 150) throw new BridgeError('invalid_input', '模型 ID 无效。', 400);
      const catalog = await this.call('model/list', {});
      if (!(catalog.data ?? []).some((model: Frame) => model.model === input.model || model.id === input.model)) throw new BridgeError('invalid_input', '当前账号未提供此模型。', 400);
      state.model = input.model; this.control.changed(); return { ok: true };
    }
    if (input.action === 'reply') {
      const request = this.requests.get(input.request ?? '');
      if (!request || request.params?.threadId !== threadId) throw new BridgeError('request_resolved', '该问题已经结束，请检查最新状态。', 409);
      let result: Frame;
      if (request.method === 'item/tool/requestUserInput') {
        const answers: Frame = {};
        for (const question of request.params.questions) {
          const answer = input.answers?.[question.id];
          if (!Array.isArray(answer) || !answer.length || answer.some(value => typeof value !== 'string' || value.length > 4000)) throw new BridgeError('invalid_input', '请回答所有问题。', 400);
          answers[question.id] = { answers: answer };
        }
        result = { answers };
      } else if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) {
        if (!['accept', 'decline', 'cancel'].includes(input.decision ?? '')) throw new BridgeError('invalid_input', '审批选项无效。', 400);
        if (Array.isArray(request.params.availableDecisions) && !request.params.availableDecisions.includes(input.decision)) throw new BridgeError('unsupported_request', '此审批需要交还电脑处理。', 409);
        result = { decision: input.decision };
      } else throw new BridgeError('unsupported_request', '此请求需要交还电脑处理。', 409);
      this.write({ id: request.id, result });
      this.requests.delete(String(request.id)); state.requests = state.requests.filter(row => row.id !== String(request.id));
      state.status = state.requests.length ? 'blocked' : this.turnId ? 'working' : 'idle'; this.control.changed();
      return { ok: true, receipt: input.requestId };
    }
    throw new BridgeError('unsupported_action', '不支持此操作。', 400);
  }
  get port(): number | undefined { return this.proxy?.port; }
  async listen(path: string | number): Promise<void> {
    await this.initialized;
    const runtime = this;
    this.proxy = Bun.serve<{ ready: boolean }>({ ...(typeof path === 'string' ? { unix: path } : { hostname: '127.0.0.1', port: path }),
      fetch(request, server) { if (server.upgrade(request, { data: { ready: false } })) return; return new Response(null, { status: 426 }); },
      websocket: {
        maxPayloadLength: 2 * 1024 * 1024,
        open(ws) { if (runtime.desktop) { ws.close(1008, 'desktop_already_connected'); return; } runtime.desktop = ws; },
        async message(ws, bytes) {
          try {
            const frame = JSON.parse(String(bytes));
            if (frame.method === 'initialize') { ws.send(JSON.stringify({ id: frame.id, result: await runtime.initialized })); return; }
            if (frame.method === 'initialized') { ws.data.ready = true; for (const request of runtime.requests.values()) if (runtime.control.state.owner === 'desktop') runtime.sendDesktop(request); return; }
            if (!ws.data.ready) throw new Error('尚未初始化。');
            if (!frame.method && frame.id !== undefined) {
              if (runtime.control.state.owner === 'desktop' && runtime.requests.has(String(frame.id))) {
                runtime.write(frame); runtime.requests.delete(String(frame.id));
                runtime.control.state.requests = runtime.control.state.requests.filter(row => row.id !== String(frame.id)); runtime.control.changed();
              }
              return;
            }
            if (runtime.control.state.owner !== 'desktop' && !READ_METHOD.test(frame.method)) {
              ws.send(JSON.stringify({ id: frame.id, error: { code: -32001, message: '手机正在控制。按 Ctrl+] 接回电脑，或在手机点「交还电脑」。' } })); return;
            }
            if (frame.id === undefined) { runtime.write(frame); return; }
            const selecting = ['thread/start', 'thread/resume', 'thread/fork'].includes(frame.method);
            if (selecting) { runtime.selecting++; runtime.control.state.ready = false; runtime.control.changed(); }
            try {
              const result = await runtime.call(frame.method, frame.params);
              if (selecting) await runtime.selectThread(result);
              ws.send(JSON.stringify({ id: frame.id, result }));
            } catch (error) { ws.send(JSON.stringify({ id: frame.id, error: { code: -32000, message: error instanceof Error ? error.message : '请求失败。' } })); }
            finally { if (selecting) { runtime.selecting--; runtime.control.state.ready = runtime.selecting === 0 && !!runtime.control.state.conversationId; runtime.control.changed(); } }
          } catch { ws.close(1003, 'invalid_frame'); }
        },
        close(ws) { if (runtime.desktop === ws) runtime.desktop = undefined; },
      },
    });
  }
  async close(): Promise<void> { this.stopped = true; this.proxy?.stop(true); this.child.kill(); await this.child.exited; }
}

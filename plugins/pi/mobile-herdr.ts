import { homedir } from 'node:os';
import { join } from 'node:path';
import { rpc } from '../../server/rpc';
import type { Snapshot } from '../../shared/protocol';
import { NativeController, type NativeIdentity } from '../../server/native/controller';
import { BridgeError } from '../../server/rpc';
import { PiDialogs } from '../../server/native/pi-dialogs';
import { reportToHerdr } from '../../server/native/herdr-reporting';
import { isDesktopReclaim, isTerminalReply } from '../../shared/terminal-keys';
import { resolveAttachments, attachmentPrompt } from '../../server/attachments';
import { messageMedia, uploadedPrompt } from '../../shared/message-media';

// Structural API typing keeps the extension usable with Pi's bundled distribution.
type PiContext = {
  cwd: string; model?: { id: string }; abort: () => void; isIdle: () => boolean;
  shutdown: () => void;
  sessionManager: { getSessionId(): string; getBranch(): any[] };
  modelRegistry: { getAvailable(): any[] };
  compact?: (options?: { onComplete?: () => void; onError?: (error: Error) => void }) => void;
  getContextUsage?: () => { tokens?: number; contextWindow: number } | undefined;
  ui: { setStatus(key: string, text?: string): void; notify(text: string, type?: string): void; [key: string]: any };
};
type PiAPI = {
  on(event: string, handler: (event: any, ctx: PiContext) => any): void;
  registerShortcut(key: string, options: { description: string; handler: (ctx: PiContext) => Promise<void> }): void;
  registerCommand(name: string, options: { description: string; handler: (args: string, ctx: PiContext) => Promise<void> }): void;
  sendUserMessage(text: string, options?: { deliverAs?: 'steer' | 'followUp'; expandPromptTemplates?: boolean }): void;
  getAllTools(): any[];
  setModel(model: any): Promise<boolean>;
  getCommands?: () => { name: string; description?: string }[];
  getThinkingLevel?: () => string;
  setThinkingLevel?: (level: string) => void;
};

const factoriesKey = Symbol.for('mobile-herdr.pi.factories');
const shared = globalThis as typeof globalThis & { [factoriesKey]?: WeakSet<object> };
const activeFactories = shared[factoriesKey] ??= new WeakSet<object>();
export default function mobileHerdr(pi: PiAPI, options: { directory?: string } = {}): void {
  if (activeFactories.has(pi)) return;
  activeFactories.add(pi);
  let control: NativeController | undefined;
  let context: PiContext | undefined;
  let dialogs: PiDialogs | undefined;
  let removeTerminalInput: (() => void) | undefined;
  let stopReporting: (() => Promise<void>) | undefined;
  let sequence = 0;
  let supportedThinkingLevels: ((model: any) => string[]) | undefined;
  let compacting = false;
  function syncOptions(ctx: PiContext): void {
    if (!control) return;
    control.state.model = ctx.model ? `${(ctx.model as any).provider}/${ctx.model.id}` : undefined;
    control.state.models = ctx.modelRegistry.getAvailable().slice(0, 100).map(row => ({
      id: `${row.provider}/${row.id}`, name: row.name ?? row.id,
      reasoningEfforts: supportedThinkingLevels?.(row).map(id => ({ id, name: id })),
    }));
    control.state.reasoningEffort = pi.getThinkingLevel?.();
    control.state.capabilities.reasoning = !!supportedThinkingLevels && !!pi.setThinkingLevel && !!pi.getThinkingLevel;
    control.state.capabilities.compact = !!ctx.compact;
    control.state.commands = (pi.getCommands?.() ?? [])
      .filter(row => /^[\w:.-]{1,120}$/.test(row.name) && !['new', 'resume', 'fork', 'tree', 'reload', 'exit', 'quit'].includes(row.name))
      .slice(0, 200).map(row => ({ name: row.name, description: row.description?.slice(0, 200) ?? '' }));
    control.state.capabilities.commands = !!pi.getCommands;
    const usage = ctx.getContextUsage?.();
    control.state.context = usage?.tokens !== undefined && usage.contextWindow > 0 ? { tokens: usage.tokens, window: usage.contextWindow } : undefined;
    control.changed();
  }
  const messageIds = new WeakMap<object, string>();
  function message(message: any, fallback?: string): void {
    if (!control || !message || !['user', 'assistant', 'toolResult'].includes(message.role)) return;
    let id = fallback ?? message.id ?? messageIds.get(message);
    if (!id) { id = `${message.role}-${message.timestamp ?? ++sequence}`; messageIds.set(message, id); }
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
    const text = content.filter((row: any) => row.type === 'text').map((row: any) => row.text).join('\n');
    if (message.role === 'toolResult') {
      const toolId = message.toolCallId ?? id;
      const previous = control.state.messages.find(row => row.id === toolId);
      control.message({ id: toolId, role: 'tool', toolName: message.toolName ?? previous?.toolName ?? 'tool', text: previous?.text ?? '', output: text, media: messageMedia(content), toolStatus: message.isError ? 'failed' : 'completed' });
    } else {
      const prompt = message.role === 'user' ? uploadedPrompt(text) : { text, media: [] };
      const media = [...prompt.media, ...messageMedia(content)];
      if (text || media.length) control.message({ id, role: message.role, text: prompt.text, media });
      for (const row of content.filter((row: any) => row.type === 'toolCall')) control.message({ id: row.id, role: 'tool', toolName: row.name, text: JSON.stringify(row.arguments) });
    }
  }
  pi.on('session_start', async (_event, ctx) => {
    context = ctx;
    // Resolve through Pi's bundled API; older distributions retain their other controls.
    for (const name of ['@earendil-works/pi-ai/compat', '@mariozechner/pi-ai']) {
      try {
        const api = await import(name);
        if (typeof api.getSupportedThinkingLevels === 'function') { supportedThinkingLevels = api.getSupportedThinkingLevels; break; }
      } catch { /* Reasoning choices remain unavailable without model capability metadata. */ }
    }
    const directory = options.directory ?? process.env.MOBILE_HERDR_NATIVE_DIRECTORY ?? join(process.env.MOBILE_HERDR_STATE ?? join(homedir(), '.local/state/mobile-herdr'), 'native');
    let identity = JSON.parse(process.env.MOBILE_HERDR_NATIVE_IDENTITY ?? '{}') as NativeIdentity;
    if (identity.paneId !== process.env.HERDR_PANE_ID || identity.herdrSocket !== (process.env.HERDR_SOCKET_PATH ?? process.env.HERDR_SOCKET)) identity = {} as NativeIdentity;
    if (!identity.terminalId) {
      const herdrSocket = process.env.HERDR_SOCKET_PATH ?? process.env.HERDR_SOCKET;
      const paneId = process.env.HERDR_PANE_ID;
      if (!herdrSocket || !paneId) return;
      const { snapshot } = await rpc<{ snapshot: Snapshot }>(herdrSocket, 'session.snapshot');
      const pane = snapshot.panes.find(row => row.pane_id === paneId);
      if (!pane || pane.agent && pane.agent !== 'pi') return;
      identity = { herdrSocket, paneId, terminalId: pane.terminal_id };
    }
    const provider = process.env.MOBILE_HERDR_PROVIDER === 'omp' ? 'omp' : 'pi';
    control = new NativeController(directory, identity, provider);
    const current = control;
    current.onShutdown = () => context?.shutdown();
    current.state.conversationId = ctx.sessionManager.getSessionId();
    syncOptions(ctx);
    for (const entry of ctx.sessionManager.getBranch()) if (entry.type === 'message') message(entry.message, entry.id);
    dialogs = new PiDialogs(current, () => context?.isIdle() ?? true); dialogs.wrap(ctx.ui);
    current.beforeClaim = () => {
      if (provider === 'omp' && typeof ctx.ui.onTerminalInput !== 'function') throw new BridgeError('unsupported_action', '当前 OMP 不支持安全的终端输入隔离，请继续使用电脑。', 409);
      if (provider === 'omp' && context?.sessionManager.getSessionId() !== current.state.conversationId) throw new BridgeError('native_changed', 'OMP 对话已切换，请在电脑重新启动连接。', 409);
      dialogs?.beforeClaim();
    };
    removeTerminalInput = ctx.ui.onTerminalInput?.((data: string) => {
      if (isDesktopReclaim(data)) { current.desktop(); return { consume: true }; }
      if (current.state.owner === 'desktop' || isTerminalReply(data)) return;
      return { consume: true };
    });
    current.state.capabilities.approvals = true;
    current.state.capabilities.attachments = true;
    current.state.capabilities.idlePrompt = provider !== 'omp';
    current.onControl = () => {
      ctx.ui.setStatus('mobile-herdr', current.state.owner === 'desktop' ? '手机可接管 · Ctrl+] 接回' : '手机正在控制 · Ctrl+] 接回');
      if (current.state.owner === 'desktop') dialogs?.desktop();
    };
    current.perform = async input => {
      if (!context) throw new BridgeError('native_not_ready', 'Pi 尚未就绪。', 409);
      if (provider === 'omp' && context.sessionManager.getSessionId() !== current.state.conversationId) throw new BridgeError('native_changed', 'OMP 对话已切换，请在电脑重新启动连接。', 409);
      if (input.action === 'prompt' || input.action === 'prompt_idle') {
        if (compacting) throw new BridgeError('agent_working', '正在压缩上下文，请稍后发送。', 409);
        if (typeof input.text !== 'string' || input.text.length > 32000 || !input.text.trim() && !input.attachments?.length) throw new BridgeError('invalid_input', '消息为空或过长。', 400);
        const files = await resolveAttachments(join(directory, '..'), { socket: current.record.herdrSocket, terminal: current.record.terminalId, conversation: current.state.conversationId }, input.attachments);
        if (current.state.owner !== input.clientId || current.state.epoch !== input.epoch || current.state.conversationId !== input.conversationId) throw new BridgeError('control_changed', '控制权或对话已变化，草稿已保留。', 409);
        if (input.action === 'prompt_idle' && (!context.isIdle() || compacting || current.state.requests.length)) throw new BridgeError('queue_not_idle', '会话正在工作，下一轮消息继续等待。', 409);
        pi.sendUserMessage(attachmentPrompt(input.text, files), context.isIdle() ? undefined : { deliverAs: 'steer' });
        return { ok: true, receipt: input.requestId };
      }
      if (input.action === 'stop') { context.abort(); dialogs?.cancel(); return { ok: true }; }
      if (input.action === 'reply') { dialogs!.reply(input); return { ok: true }; }
      if (input.action === 'model' || input.action === 'reasoning') {
        if (!context.isIdle()) throw new BridgeError('agent_working', '请在任务结束后切换模型。', 409);
        if (input.action === 'reasoning') {
          const levels = context.model && supportedThinkingLevels?.(context.model);
          if (!input.reasoningEffort || !levels?.includes(input.reasoningEffort) || !pi.setThinkingLevel) throw new BridgeError('invalid_input', '当前模型不支持此思考强度。', 400);
          pi.setThinkingLevel(input.reasoningEffort); syncOptions(context);
          return { ok: true, model: current.state.model, reasoningEffort: current.state.reasoningEffort };
        }
        const model = context.modelRegistry.getAvailable().find(row => `${row.provider}/${row.id}` === input.model);
        if (!model || !(await pi.setModel(model))) throw new BridgeError('invalid_input', '当前账号未提供此模型。', 400);
        syncOptions(context);
        return { ok: true, model: current.state.model, reasoningEffort: current.state.reasoningEffort };
      }
      if (input.action === 'command') {
        if (!context.isIdle()) throw new BridgeError('agent_working', '请先停止当前任务，再执行命令。', 409);
        syncOptions(context);
        const name = input.text?.match(/^\/([\w:.-]+)(?:\s|$)/)?.[1];
        if (!input.text || input.text.length > 32000 || !current.state.commands?.some(command => command.name === name)) throw new BridgeError('unsupported_action', '当前会话未提供此命令，请在终端查看。', 400);
        pi.sendUserMessage(input.text, { expandPromptTemplates: true });
        return { ok: true, receipt: input.requestId };
      }
      if (input.action === 'compact') {
        if (!context.isIdle() || compacting) throw new BridgeError('agent_working', '请在任务结束后压缩上下文。', 409);
        if (!context.compact) throw new BridgeError('unsupported_action', '当前 Pi 未提供上下文压缩。', 400);
        compacting = true; current.state.status = 'working'; current.state.capabilities.steer = false; current.changed();
        function finish(error?: Error): void {
          compacting = false; current.state.status = 'idle'; current.state.capabilities.steer = true;
          current.state.error = error?.message; current.changed();
        }
        context.compact({ onComplete: () => finish(), onError: finish });
        return { ok: true, receipt: input.requestId };
      }
      throw new BridgeError('unsupported_action', '此 Pi 操作需要原始终端。', 409);
    };
    await current.listen(); current.onControl(); stopReporting = reportToHerdr(current);
  });
  pi.on('input', (event, ctx) => {
    context = ctx;
    if (control && control.state.owner !== 'desktop' && event.source === 'interactive') {
      ctx.ui.notify('手机正在控制。按 Ctrl+] 接回电脑。', 'warning'); return { action: 'handled' };
    }
    return { action: 'continue' };
  });
  for (const type of ['message_start', 'message_update', 'message_end']) pi.on(type, (event, ctx) => {
    context = ctx; message(event.message);
  });
  pi.on('tool_execution_start', (event, ctx) => {
    context = ctx; control?.message({ id: event.toolCallId, role: 'tool', toolName: event.toolName, text: JSON.stringify(event.args ?? {}), toolStatus: 'running' });
  });
  pi.on('tool_execution_update', event => {
    const previous = control?.state.messages.find(row => row.id === event.toolCallId);
    if (previous) control?.message({ ...previous, output: event.partialResult?.content?.filter((row: any) => row.type === 'text').map((row: any) => row.text).join('\n') });
  });
  pi.on('agent_start', (_event, ctx) => { context = ctx; if (control) { control.state.status = 'working'; control.changed(); } });
  pi.on('agent_settled', (_event, ctx) => { context = ctx; if (control) { control.state.status = 'idle'; syncOptions(ctx); } });
  if (process.env.MOBILE_HERDR_PROVIDER === 'omp') pi.on('agent_end', (_event, ctx) => {
    context = ctx;
    // OMP does not emit Pi's agent_settled extension event. Check after the
    // callback so the provider has updated its own idle flag.
    setTimeout(() => { if (control && context === ctx && ctx.isIdle()) { control.state.status = 'idle'; syncOptions(ctx); } }, 50);
  });
  pi.on('model_select', (_event, ctx) => { context = ctx; syncOptions(ctx); });
  pi.on('thinking_level_select', (_event, ctx) => { context = ctx; syncOptions(ctx); });
  async function desktop(ctx: PiContext): Promise<void> { control?.desktop(); ctx.ui.notify('已接回电脑。'); }
  pi.registerShortcut('ctrl+]', { description: '接回电脑控制', handler: desktop });
  pi.registerCommand('desktop', { description: '接回电脑控制', handler: async (_args, ctx) => desktop(ctx) });
  pi.on('session_shutdown', async () => { activeFactories.delete(pi); removeTerminalInput?.(); dialogs?.close(); dialogs = undefined; await stopReporting?.(); const previous = control; control = undefined; await previous?.close(); });
}

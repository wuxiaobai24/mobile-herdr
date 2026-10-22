import { NativeController, type NativeIdentity } from '../../server/native/controller';
import { BridgeError } from '../../server/rpc';
import { PiDialogs } from '../../server/native/pi-dialogs';
import { reportToHerdr } from '../../server/native/herdr-reporting';
import { isDesktopReclaim } from '../../shared/terminal-keys';

// Structural API typing keeps the extension usable with Pi's bundled distribution.
type PiContext = {
  cwd: string; model?: { id: string }; abort: () => void; isIdle: () => boolean;
  shutdown: () => void;
  sessionManager: { getSessionId(): string; getBranch(): any[] };
  modelRegistry: { getAvailable(): any[] };
  ui: { setStatus(key: string, text?: string): void; notify(text: string, type?: string): void; [key: string]: any };
};
type PiAPI = {
  on(event: string, handler: (event: any, ctx: PiContext) => any): void;
  registerShortcut(key: string, options: { description: string; handler: (ctx: PiContext) => Promise<void> }): void;
  registerCommand(name: string, options: { description: string; handler: (args: string, ctx: PiContext) => Promise<void> }): void;
  sendUserMessage(text: string, options?: { deliverAs: 'steer' | 'followUp' }): void;
  getAllTools(): any[];
  setModel(model: any): Promise<boolean>;
};

export default function mobileHerdr(pi: PiAPI): void {
  let control: NativeController | undefined;
  let context: PiContext | undefined;
  let dialogs: PiDialogs | undefined;
  let removeTerminalInput: (() => void) | undefined;
  let stopReporting: (() => Promise<void>) | undefined;
  let sequence = 0;
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
      control.message({ id: toolId, role: 'tool', toolName: message.toolName ?? previous?.toolName ?? 'tool', text: previous?.text ?? '', output: text });
    } else {
      if (text) control.message({ id, role: message.role, text });
      for (const row of content.filter((row: any) => row.type === 'toolCall')) control.message({ id: row.id, role: 'tool', toolName: row.name, text: JSON.stringify(row.arguments) });
    }
  }
  pi.on('session_start', async (_event, ctx) => {
    context = ctx;
    const directory = process.env.MOBILE_HERDR_NATIVE_DIRECTORY;
    const identity = JSON.parse(process.env.MOBILE_HERDR_NATIVE_IDENTITY ?? '{}') as NativeIdentity;
    if (!directory || !identity.terminalId) return;
    control = new NativeController(directory, identity, 'pi');
    const current = control;
    current.onShutdown = () => context?.shutdown();
    current.state.conversationId = ctx.sessionManager.getSessionId();
    current.state.model = ctx.model ? `${(ctx.model as any).provider}/${ctx.model.id}` : undefined;
    current.state.models = ctx.modelRegistry.getAvailable().slice(0, 100).map(row => ({ id: `${row.provider}/${row.id}`, name: row.name ?? row.id }));
    for (const entry of ctx.sessionManager.getBranch()) if (entry.type === 'message') message(entry.message, entry.id);
    dialogs = new PiDialogs(current, () => context?.isIdle() ?? true); dialogs.wrap(ctx.ui);
    current.beforeClaim = () => dialogs?.beforeClaim();
    removeTerminalInput = ctx.ui.onTerminalInput?.((data: string) => {
      if (isDesktopReclaim(data)) { current.desktop(); return { consume: true }; }
      if (current.state.owner === 'desktop' || /^\u001b\[[\d;?]*[Rcn]$/.test(data)) return;
      return { consume: true };
    });
    current.state.capabilities.approvals = true;
    current.onControl = () => {
      ctx.ui.setStatus('mobile-herdr', current.state.owner === 'desktop' ? '手机可接管 · Ctrl+] 接回' : '手机正在控制 · Ctrl+] 接回');
      if (current.state.owner === 'desktop') dialogs?.desktop();
    };
    current.perform = async input => {
      if (!context) throw new BridgeError('native_not_ready', 'Pi 尚未就绪。', 409);
      if (input.action === 'prompt') {
        if (!input.text?.trim() || input.text.length > 32000) throw new BridgeError('invalid_input', '消息为空或过长。', 400);
        pi.sendUserMessage(input.text, context.isIdle() ? undefined : { deliverAs: 'steer' });
        return { ok: true, receipt: input.requestId };
      }
      if (input.action === 'stop') { context.abort(); dialogs?.cancel(); return { ok: true }; }
      if (input.action === 'reply') { dialogs!.reply(input); return { ok: true }; }
      if (input.action === 'model') {
        if (!context.isIdle()) throw new BridgeError('agent_working', '请在任务结束后切换模型。', 409);
        const model = context.modelRegistry.getAvailable().find(row => `${row.provider}/${row.id}` === input.model);
        if (!model || !(await pi.setModel(model))) throw new BridgeError('invalid_input', '当前账号未提供此模型。', 400);
        return { ok: true };
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
    context = ctx; control?.message({ id: event.toolCallId, role: 'tool', toolName: event.toolName, text: JSON.stringify(event.args ?? {}) });
  });
  pi.on('tool_execution_update', event => {
    const previous = control?.state.messages.find(row => row.id === event.toolCallId);
    if (previous) control?.message({ ...previous, output: event.partialResult?.content?.filter((row: any) => row.type === 'text').map((row: any) => row.text).join('\n') });
  });
  pi.on('agent_start', (_event, ctx) => { context = ctx; if (control) { control.state.status = 'working'; control.changed(); } });
  pi.on('agent_settled', (_event, ctx) => { context = ctx; if (control) { control.state.status = 'idle'; control.changed(); } });
  pi.on('model_select', (event, ctx) => { context = ctx; if (control) { control.state.model = `${event.model.provider}/${event.model.id}`; control.changed(); } });
  async function desktop(ctx: PiContext): Promise<void> { control?.desktop(); ctx.ui.notify('已接回电脑。'); }
  pi.registerShortcut('ctrl+]', { description: '接回电脑控制', handler: desktop });
  pi.registerCommand('desktop', { description: '接回电脑控制', handler: async (_args, ctx) => desktop(ctx) });
  pi.on('session_shutdown', async () => { removeTerminalInput?.(); dialogs?.close(); dialogs = undefined; await stopReporting?.(); const previous = control; control = undefined; await previous?.close(); });
}

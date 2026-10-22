import type { NativeAction } from '../../shared/native';
import type { NativeController } from './controller';
import { BridgeError } from '../rpc';

type DialogUI = Record<string, any>;
interface PendingDialog { accept(input: NativeAction): void; desktop(): void; cancel(): void }

/** Relay the standard extension dialog API; custom terminal components stay on the desktop. */
export class PiDialogs {
  private pending = new Map<string, PendingDialog>();
  private restore: (() => void)[] = [];
  private counter = 0;
  private desktopCount = 0;
  constructor(private control: NativeController, private idle: () => boolean) {}

  wrap(ui: DialogUI): void {
    for (const method of ['confirm', 'select', 'input', 'editor']) {
      const original = ui[method];
      if (typeof original !== 'function') continue;
      const bridge = this;
      const wrapped = function (...args: any[]): Promise<unknown> {
        async function onDesktop(): Promise<unknown> {
          bridge.desktopCount++;
          try { return await original.apply(ui, args); } finally { bridge.desktopCount--; }
        }
        if (bridge.control.state.owner === 'desktop') return onDesktop();
        return bridge.open(method, args, onDesktop);
      };
      ui[method] = wrapped;
      this.restore.push(() => { if (ui[method] === wrapped) ui[method] = original; });
    }
  }
  private open(method: string, args: any[], desktop: () => Promise<unknown>): Promise<unknown> {
    const id = `pi-dialog-${++this.counter}`;
    const confirm = method === 'confirm';
    const choices = method === 'select' && Array.isArray(args[1]) ? args[1] as string[] : undefined;
    const options = args[2] ?? {};
    this.control.state.requests.push({ id, kind: confirm ? 'approval' : 'question', title: String(args[0]), detail: confirm ? String(args[1] ?? '') : '',
      ...(!confirm ? { questions: [{ id: 'answer', header: String(args[0]), question: String(args[0]), options: choices?.map(label => ({ label })) }] } : {}) });
    this.control.state.status = 'blocked'; this.control.changed();
    return new Promise(resolve => {
      let done = false; let returning = false; let timer: ReturnType<typeof setTimeout> | undefined;
      function aborted(): void { settle(confirm ? false : undefined); }
      const settle = (value: unknown): void => {
        if (done) return; done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', aborted);
        this.pending.delete(id); this.control.state.requests = this.control.state.requests.filter(row => row.id !== id);
        this.control.state.status = this.control.state.requests.length ? 'blocked' : this.idle() ? 'idle' : 'working'; this.control.changed(); resolve(value);
      };
      this.pending.set(id, {
        accept(input) {
          if (confirm) {
            if (!['accept', 'decline', 'cancel'].includes(input.decision ?? '')) throw new BridgeError('invalid_input', '确认选项无效。', 400);
            settle(input.decision === 'accept');
          } else {
            const value = input.answers?.answer?.[0];
            if (typeof value !== 'string' || value.length > 4000 || (choices && !choices.includes(value))) throw new BridgeError('invalid_input', '请提供有效回答。', 400);
            settle(value);
          }
        },
        desktop() { if (returning || done) return; returning = true; void desktop().then(settle, () => settle(confirm ? false : undefined)); },
        cancel: aborted,
      });
      options.signal?.addEventListener('abort', aborted, { once: true });
      if (options.signal?.aborted) aborted();
      if (Number.isFinite(options.timeout) && options.timeout >= 0) timer = setTimeout(aborted, options.timeout);
    });
  }
  reply(input: NativeAction): void {
    const request = this.pending.get(input.request ?? '');
    if (!request) throw new BridgeError('request_resolved', '此问题已结束。', 409);
    request.accept(input);
  }
  beforeClaim(): void { if (this.desktopCount) throw new BridgeError('desktop_dialog', '电脑上有尚未完成的 Pi 弹窗，请先处理后再接管。', 409); }
  desktop(): void { for (const request of this.pending.values()) request.desktop(); }
  cancel(): void { for (const request of [...this.pending.values()]) request.cancel(); }
  close(): void { for (const restore of this.restore) restore(); this.cancel(); }
}

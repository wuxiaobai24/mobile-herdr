import type { NativeController } from './controller';
import { rpc } from '../rpc';

/** Report only the provider this adapter owns; never replace another pane's authority. */
export function reportToHerdr(control: NativeController): () => Promise<void> {
  let previous = ''; let running = false; let closed = false; let sequence = 0;
  const identity = { pane_id: control.record.paneId, source: `mobile-herdr:${control.record.runtimeId}`, agent: control.state.provider };
  async function tick(): Promise<void> {
    if (running || closed) return;
    const state = control.state;
    const signature = JSON.stringify([state.status, state.conversationId, state.owner]);
    if (signature === previous || !state.connected) return;
    running = true;
    try {
      await rpc(control.record.herdrSocket, 'pane.report_agent', { ...identity, seq: ++sequence,
        state: state.status === 'offline' ? 'unknown' : state.status,
        agent_session_id: state.conversationId,
        message: state.owner === 'desktop' ? '电脑控制 · 手机可接管' : '手机控制 · Ctrl+] 接回',
      });
      previous = signature;
    } catch { /* Web access remains available if this Herdr lacks report support. */ }
    finally { running = false; }
  }
  void tick(); const timer = setInterval(() => void tick(), 700);
  return async () => { closed = true; clearInterval(timer); await rpc(control.record.herdrSocket, 'pane.release_agent', { ...identity, seq: ++sequence }).catch(() => {}); };
}

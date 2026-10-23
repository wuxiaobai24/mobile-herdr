import { useEffect, useState } from 'react';
import type { Machine, Pane } from '../shared/protocol';
import type { TakeoverState } from '../shared/takeover';
import { api, panePath } from '../shared/client';

export function useTakeover(machine: Machine | undefined, session: string, pane: Pane | undefined, clientId: string, visible: boolean) {
  const [result, setResult] = useState<{ scope: string; state: TakeoverState | null }>();
  const [pending, setPending] = useState(false);
  const scope = `${machine?.id}:${session}:${pane?.pane_id}:${pane?.terminal_id}`;
  useEffect(() => {
    if (!machine || !pane || !visible) return;
    let closed = false, timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const state = await api<TakeoverState | null>(machine!, panePath(session, pane!.pane_id, 'takeover'));
        if (!closed) setResult({ scope, state });
      } catch { /* The connection banner handles read failures; never replay setup. */ }
      if (!closed) timer = setTimeout(() => void poll(), 500);
    }
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [scope, visible]);
  async function start(cancel = false): Promise<void> {
    if (!machine || !pane || !clientId || pending) return;
    setPending(true);
    try {
      const state = await api<TakeoverState>(machine, panePath(session, pane.pane_id, 'takeover'), { body: { agent: pane.agent, terminalId: pane.terminal_id, conversation: pane.agent_session?.value, clientId, cancel } });
      setResult({ scope, state });
    } finally { setPending(false); }
  }
  return { state: result?.scope === scope ? result.state : null, pending, start };
}

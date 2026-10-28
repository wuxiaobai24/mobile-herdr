import { useEffect, useRef, useState } from 'react';
import type { Machine, Pane } from '../shared/protocol';
import type { TakeoverState } from '../shared/takeover';
import { api, machineScope, panePath, requestId } from '../shared/client';
import { loadDraft, saveDraft } from './storage';
import type { NativeState } from '../shared/native';

export function useTakeover(machine: Machine | undefined, session: string, pane: Pane | undefined, clientId: string, visible: boolean, native?: NativeState | null) {
  const [result, setResult] = useState<{ scope: string; state: TakeoverState | null }>();
  const [pending, setPending] = useState(false);
  const delivery = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const scope = `${machine?.id}:${session}:${pane?.pane_id}:${pane?.terminal_id}`;
  const key = `takeover-delivery:${machine ? machineScope(machine) : ''}:${scope}`;
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
  async function start(cancel = false, restart = false): Promise<void> {
    if (!machine || !pane || !clientId || pending) return;
    setPending(true);
    try {
      const body = { agent: pane.agent, terminalId: pane.terminal_id, conversation: pane.agent_session?.value, clientId, cancel, restart, ...(restart && native ? { runtimeId: native.runtimeId } : {}) };
      const fingerprint = JSON.stringify(body);
      if (!delivery.current) { try { delivery.current = JSON.parse(await loadDraft(key) || 'null') ?? undefined; } catch { /* Keep a new explicit request independent of broken metadata. */ } }
      if (delivery.current?.fingerprint !== fingerprint) delivery.current = { fingerprint, id: requestId() };
      await saveDraft(key, JSON.stringify(delivery.current));
      const state = await api<TakeoverState>(machine, panePath(session, pane.pane_id, 'takeover'), { body, id: delivery.current.id });
      setResult({ scope, state });
      delivery.current = undefined; await saveDraft(key, '');
    } finally { setPending(false); }
  }
  return { state: result?.scope === scope ? result.state : null, pending, start, restart: () => start(false, true) };
}

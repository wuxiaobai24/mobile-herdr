import { useEffect, useRef, useState } from 'react';
import type { NativeAction, NativeState } from '../shared/native';
import type { Machine } from '../shared/protocol';
import { api, panePath, requestId } from '../shared/client';
import { loadDraft, saveDraft } from './storage';

export function useNativeControl(machine: Machine | undefined, session: string, pane: string | undefined, state: NativeState | null | undefined) {
  const [clientId, setClientId] = useState('');
  const confirmedEpoch = useRef<{ runtimeId: string; epoch: number } | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState<{ scope: string; epoch: number; owner: string }>();
  const scope = `${machine?.id}:${machine?.url}:${machine?.remote}:${session}:${pane}:${state?.runtimeId}:${state?.conversationId}`;
  useEffect(() => {
    void loadDraft('device-id').then(async saved => {
      const value = saved || `phone_${requestId()}`;
      if (!saved) await saveDraft('device-id', value);
      setClientId(value);
    });
  }, []);
  // An HTTP receipt can arrive before the next watch frame. Do not use an older fence
  // for a second action, or regress ownership while that frame is still in flight.
  const receipt = state && acknowledged?.scope === scope && acknowledged.epoch > state.epoch ? acknowledged : undefined;
  const owner = receipt?.owner ?? state?.owner;
  const epoch = receipt?.epoch ?? state?.epoch;
  const owns = !!clientId && owner === clientId;
  async function act(action: NativeAction['action'], values: Partial<NativeAction> = {}, id = requestId()): Promise<unknown> {
    if (!machine || !pane || !state || !clientId) throw new Error('原生连接尚未就绪。');
    const result = await api<{ epoch?: number }>(machine, panePath(session, pane, 'native'), { id, body: { ...values, action, runtimeId: state.runtimeId, conversationId: state.conversationId, clientId, epoch } });
    if (['claim', 'release'].includes(action) && Number.isSafeInteger(result.epoch)) {
      const next = { scope, epoch: result.epoch!, owner: action === 'claim' ? clientId : 'desktop' };
      setAcknowledged(previous => previous?.scope === scope && previous.epoch > next.epoch ? previous : next);
    }
    return result;
  }
  async function interrupt(id = requestId()): Promise<unknown> {
    if (owns) return act('stop', {}, id);
    const claimed = await act('claim', {}, id + '_claim') as { epoch: number };
    if (!machine || !pane || !state || !Number.isInteger(claimed.epoch)) throw new Error('接管结果未确认，请检查当前会话。');
    return api(machine, panePath(session, pane, 'native'), { id, body: { action: 'stop', runtimeId: state.runtimeId, conversationId: state.conversationId, clientId, epoch: claimed.epoch } });
  }
  return { clientId, owns, owner, act, interrupt };
}
export type NativeControl = ReturnType<typeof useNativeControl>;

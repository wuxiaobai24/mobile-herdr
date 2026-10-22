import { useEffect, useState } from 'react';
import type { NativeAction, NativeState } from '../shared/native';
import type { Machine } from '../shared/protocol';
import { api, panePath, requestId } from '../shared/client';
import { loadDraft, saveDraft } from './storage';

export function useNativeControl(machine: Machine | undefined, session: string, pane: string | undefined, state: NativeState | null | undefined) {
  const [clientId, setClientId] = useState('');
  useEffect(() => {
    void loadDraft('device-id').then(async saved => {
      const value = saved || `phone_${requestId()}`;
      if (!saved) await saveDraft('device-id', value);
      setClientId(value);
    });
  }, []);
  const owns = !!clientId && state?.owner === clientId;
  async function act(action: NativeAction['action'], values: Partial<NativeAction> = {}, id = requestId()): Promise<unknown> {
    if (!machine || !pane || !state || !clientId) throw new Error('原生连接尚未就绪。');
    return api(machine, panePath(session, pane, 'native'), { id, body: { ...values, action, runtimeId: state.runtimeId, conversationId: state.conversationId, clientId, epoch: state.epoch } });
  }
  return { clientId, owns, act };
}
export type NativeControl = ReturnType<typeof useNativeControl>;

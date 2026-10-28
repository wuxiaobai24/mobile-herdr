import { AppState, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { watch } from '../shared/client';
import type { Conversation, Machine, Snapshot } from '../shared/protocol';
import type { NativeState } from '../shared/native';
import { useNetworkOnline } from './useNetworkOnline';

export function useConnection(machine: Machine | undefined, session: string, pane?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [chat, setChat] = useState<Conversation>();
  const [native, setNative] = useState<NativeState | null>();
  const scope = `${machine?.id}:${machine?.url}:${session}`;
  const paneScope = `${scope}:${pane}`;
  const [snapshotScope, setSnapshotScope] = useState('');
  const [conversationScope, setConversationScope] = useState('');
  const [status, setStatus] = useState<'live' | 'connecting' | 'offline'>('connecting');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(Platform.OS === 'web' || AppState.currentState !== 'background');
  const networkOnline = useNetworkOnline();
  function reconnect(): void { setStatus('connecting'); setGeneration(value => value + 1); }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (Platform.OS !== 'web') setActive(state === 'active');
      if (state === 'active') reconnect();
      else if (Platform.OS !== 'web') setStatus('offline');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const restore = () => { if (document.visibilityState === 'visible') reconnect(); };
    window.addEventListener('pageshow', restore); document.addEventListener('visibilitychange', restore);
    return () => { window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', restore); };
  }, []);
  useEffect(() => {
    setSnapshot(undefined); setChat(undefined);
  }, [machine?.id, session]);
  useEffect(() => { setChat(undefined); setNative(undefined); }, [machine?.id, session, pane]);
  useEffect(() => {
    setError('');
    if (!machine) return;
    if (!active) { setStatus('offline'); return; }
    if (!networkOnline) { setStatus('offline'); setError('设备已离线，草稿会保留。'); return; }
    return watch(machine, session, pane, state => {
      if (state.snapshot) { setSnapshot(state.snapshot); setSnapshotScope(scope); }
      if (state.chat || state.native !== undefined) setConversationScope(paneScope);
      if (state.chat && (state.native?.connected !== false || state.chat.messages.length)) setChat(state.chat);
      if (state.native !== undefined) setNative(previous => state.native && !state.native.connected && previous?.runtimeId === state.native.runtimeId ? { ...state.native, messages: previous.messages } : state.native);
    }, (status, error) => { setStatus(status); setError(error ?? ''); });
  }, [machine?.id, machine?.url, machine?.token, session, pane, generation, networkOnline, active]);
  return { snapshot: snapshotScope === scope ? snapshot : undefined, chat: conversationScope === paneScope ? chat : undefined,
    native: conversationScope === paneScope ? native : undefined, status, error, reconnect,
    acceptSnapshot(value: Snapshot): void { setSnapshot(value); setSnapshotScope(scope); } };
}

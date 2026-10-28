import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, connect, machineScope } from '../shared/client';
import type { Machine, Pane, Snapshot } from '../shared/protocol';
import { attentionKey, attentionTargets, observeAttention, readAttention, type AttentionMemory } from '../shared/attention';
import { loadDraft, saveDraft } from './storage';

interface SessionSnapshot { machine: Machine; session: string; snapshot: Snapshot; stale: boolean }
export function useAttention(machines: Machine[], current: Machine | undefined, session: string, snapshot: Snapshot | undefined, pane: Pane | undefined, visible: boolean, online: boolean) {
  const [rows, setRows] = useState<SessionSnapshot[]>([]);
  const [memory, setMemory] = useState<AttentionMemory>();
  const [error, setError] = useState('');
  const [active, setActive] = useState(Platform.OS === 'web' ? document.visibilityState !== 'hidden' : AppState.currentState !== 'background');
  const live = useRef({ current, session, snapshot, pane, visible, active });
  live.current = { current, session, snapshot, pane, visible, active };
  const signature = JSON.stringify(machines.map(machine => [machine.id, machine.url, machine.remote, machine.token, machine.remoteStatus]));
  useEffect(() => { void loadDraft('attention-v1').then(value => setMemory(readAttention(value))).catch(() => { setMemory({}); setError('无法读取未读记录。'); }); }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (Platform.OS !== 'web') setActive(state === 'active'); });
    const visibility = () => setActive(document.visibilityState !== 'hidden');
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility);
    return () => { listener.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!memory) return;
    const timer = setTimeout(() => { void saveDraft('attention-v1', JSON.stringify(memory)).catch(() => setError('未读记录未能保存。')); }, 500);
    return () => clearTimeout(timer);
  }, [memory]);
  function accept(machine: Machine, targetSession: string, value: Snapshot): void {
    const selected = live.current;
    const read = selected.active && selected.visible && selected.current && machineScope(selected.current) === machineScope(machine) && selected.session === targetSession && selected.pane
      ? attentionKey(machine, targetSession, selected.pane) : undefined;
    setMemory(previous => previous ? observeAttention(previous, machine, targetSession, value, read) : previous);
  }
  useEffect(() => {
    if (!current || !snapshot || !memory) return;
    accept(current, session, { ...snapshot, panes: pane ? [pane] : [] });
  }, [current?.id, session, snapshot, pane?.pane_id, visible, active, memory === undefined]);
  useEffect(() => {
    if (!active || !memory) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      // Limit concurrent bridge reads; failures keep the last known inbox rows.
      const fresh: SessionSnapshot[] = [], failed = new Set<string>();
      for (let i = 0; i < machines.length && !cancelled; i += 3) {
        await Promise.all(machines.slice(i, i + 3).map(async machine => {
          try {
            const info = await connect(machine);
            for (const entry of info.sessions) {
              if (cancelled) return;
              const value = await api<Snapshot>(machine, `/api/attention?session=${encodeURIComponent(entry.id)}`);
              fresh.push({ machine, session: entry.id, snapshot: value, stale: false });
              if (!cancelled) accept(machine, entry.id, value);
            }
          } catch { failed.add(machine.id); }
        }));
      }
      if (cancelled) return;
      setRows(previous => [...fresh.filter(row => !failed.has(row.machine.id)), ...previous.filter(row => failed.has(row.machine.id)).map(row => ({ ...row, stale: true }))]);
      setError(failed.size ? '部分开发机未连接，保留上次结果。' : '');
      timer = setTimeout(() => void poll(), 5000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [signature, active, memory === undefined]);
  const polled = rows.find(row => row.machine.id === current?.id && row.session === session);
  const combined = rows.filter(row => row.machine.id !== current?.id || row.session !== session);
  if (current && snapshot) {
    const merged = { ...snapshot, panes: snapshot.panes.map(row => {
      if (row.pane_id === pane?.pane_id) return pane;
      return polled?.snapshot.panes.find(item => item.pane_id === row.pane_id && item.terminal_id === row.terminal_id) ?? row;
    }) };
    combined.push({ machine: current, session, snapshot: merged, stale: !online });
  }
  const items = combined.flatMap(row => attentionTargets(row.machine, row.session, row.snapshot, memory ?? {}).map(target => ({ ...target, stale: row.stale })))
    .sort((a, b) => Number(b.kind === 'blocked') - Number(a.kind === 'blocked'));
  return { items, error };
}

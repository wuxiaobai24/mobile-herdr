import type { Machine, Pane, Snapshot } from './protocol';
import { machineScope } from './client';

export interface AttentionTarget { machine: Machine; session: string; pane: Pane; workspace: string; tab: string; kind: 'blocked' | 'done' }
export interface AttentionRecord { status: Pane['agent_status']; unread: boolean; at: number }
export type AttentionMemory = Record<string, AttentionRecord>;
export function attentionKey(machine: Machine, session: string, pane: Pane): string {
  return JSON.stringify([machineScope(machine), session, pane.pane_id, pane.terminal_id]);
}
export function readAttention(raw: string): AttentionMemory {
  try {
    return Object.fromEntries(Object.entries(JSON.parse(raw)).filter(([, value]) => {
      const row = value as AttentionRecord;
      return row && ['idle', 'working', 'blocked', 'done', 'unknown'].includes(row.status) && typeof row.unread === 'boolean' && Number.isFinite(row.at);
    }).slice(-2000)) as AttentionMemory;
  } catch { return {}; }
}
export function observeAttention(memory: AttentionMemory, machine: Machine, session: string, snapshot: Snapshot, read?: string): AttentionMemory {
  const next = { ...memory };
  for (const pane of snapshot.panes) {
    const key = attentionKey(machine, session, pane), prior = memory[key];
    const completed = pane.agent_status === 'done' || pane.agent_status === 'idle' && ['working', 'blocked'].includes(prior?.status ?? '');
    next[key] = { status: pane.agent_status, unread: key !== read && (prior?.unread === true || completed && ['working', 'blocked'].includes(prior?.status ?? '')), at: Date.now() };
  }
  return Object.fromEntries(Object.entries(next).sort((a, b) => a[1].at - b[1].at).slice(-2000));
}
export function attentionTargets(machine: Machine, session: string, snapshot: Snapshot, memory: AttentionMemory): AttentionTarget[] {
  return snapshot.panes.filter(pane => pane.agent && (pane.agent_status === 'blocked' || memory[attentionKey(machine, session, pane)]?.unread))
    .map(pane => ({ machine, session, pane, kind: pane.agent_status === 'blocked' ? 'blocked' : 'done',
      workspace: snapshot.workspaces.find(row => row.workspace_id === pane.workspace_id)?.label ?? pane.workspace_id,
      tab: snapshot.tabs.find(row => row.tab_id === pane.tab_id)?.label ?? pane.tab_id }));
}

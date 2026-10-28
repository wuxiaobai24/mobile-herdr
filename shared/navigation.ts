import type { Pane, Snapshot } from './protocol';

export type PaneMode = 'chat' | 'terminal';
export interface PaneVisit { paneId: string; terminalId: string; workspaceId: string; tabId: string; mode: PaneMode }
export interface PaneNavigation { tabs: Record<string, PaneVisit>; workspaces: Record<string, string> }
export function emptyNavigation(): PaneNavigation { return { tabs: {}, workspaces: {} }; }
export function readNavigation(raw: string): PaneNavigation {
  try {
    const value = JSON.parse(raw), result = emptyNavigation();
    for (const [key, row] of Object.entries(value.tabs ?? {}).slice(-100)) {
      const item = row as PaneVisit;
      if ([item.paneId, item.terminalId, item.workspaceId, item.tabId].every(value => typeof value === 'string') && item.tabId === key && ['chat', 'terminal'].includes(item.mode)) result.tabs[key] = item;
    }
    for (const row of Object.values(result.tabs)) if (value.workspaces?.[row.workspaceId] === row.tabId) result.workspaces[row.workspaceId] = row.tabId;
    return result;
  } catch { return emptyNavigation(); }
}
export function rememberPane(previous: PaneNavigation, pane: Pane, mode: PaneMode): PaneNavigation {
  const visit: PaneVisit = { paneId: pane.pane_id, terminalId: pane.terminal_id, workspaceId: pane.workspace_id, tabId: pane.tab_id, mode };
  if (JSON.stringify(previous.tabs[pane.tab_id]) === JSON.stringify(visit) && previous.workspaces[pane.workspace_id] === pane.tab_id) return previous;
  const tabs = { ...previous.tabs }; delete tabs[pane.tab_id]; tabs[pane.tab_id] = visit;
  const next = { tabs: Object.fromEntries(Object.entries(tabs).slice(-100)), workspaces: { ...previous.workspaces, [pane.workspace_id]: pane.tab_id } };
  return readNavigation(JSON.stringify(next));
}
export function tabPane(snapshot: Snapshot, tabId: string, memory: PaneNavigation): Pane | undefined {
  const visit = memory.tabs[tabId];
  return snapshot.panes.find(pane => pane.tab_id === tabId && pane.pane_id === visit?.paneId && pane.terminal_id === visit.terminalId)
    ?? snapshot.panes.find(pane => pane.tab_id === tabId);
}
export function workspacePane(snapshot: Snapshot, workspaceId: string, memory: PaneNavigation): Pane | undefined {
  const last = memory.workspaces[workspaceId];
  const active = snapshot.workspaces.find(row => row.workspace_id === workspaceId)?.active_tab_id;
  for (const tab of [last, active]) {
    if (!tab || !snapshot.tabs.some(row => row.workspace_id === workspaceId && row.tab_id === tab)) continue;
    const pane = tabPane(snapshot, tab, memory); if (pane) return pane;
  }
  return snapshot.panes.find(pane => pane.workspace_id === workspaceId);
}
export function matchingPanes(snapshot: Snapshot, workspaceId: string, query: string): Pane[] {
  const needle = query.trim().toLocaleLowerCase();
  const workspace = snapshot.workspaces.find(row => row.workspace_id === workspaceId);
  return snapshot.panes.filter(pane => pane.workspace_id === workspaceId && (!needle || [workspace?.label, workspaceId, pane.tab_id,
    snapshot.tabs.find(tab => tab.tab_id === pane.tab_id)?.label, pane.label, pane.terminal_title_stripped, pane.foreground_cwd, pane.cwd, pane.agent, pane.pane_id]
    .join(' ').toLocaleLowerCase().includes(needle)));
}

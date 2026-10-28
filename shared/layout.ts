import type { Pane, Snapshot } from './protocol';
export type LayoutAction = 'workspace.create' | 'tab.create' | 'pane.split' | 'workspace.rename' | 'tab.rename' | 'pane.rename';
export interface LayoutInput { action: LayoutAction; workspaceId?: string; tabId?: string; paneId?: string; terminalId?: string; label?: string; cwd?: string; direction?: 'right' | 'down' }
export interface LayoutResult { snapshot: Snapshot; pane?: Pane }

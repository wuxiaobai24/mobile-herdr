export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
export interface AgentSession { agent: string; kind: 'id' | 'path'; value: string; source: string }
export interface Pane {
  pane_id: string; workspace_id: string; tab_id: string; terminal_id: string;
  agent?: string; agent_status: AgentStatus; agent_session?: AgentSession;
  cwd?: string; foreground_cwd?: string; label?: string; terminal_title?: string;
  terminal_title_stripped?: string; revision: number; focused: boolean;
}
export interface Workspace { workspace_id: string; label?: string; number: number; agent_status: AgentStatus; active_tab_id?: string }
export interface Tab { tab_id: string; workspace_id: string; label?: string; number: number }
export interface Snapshot {
  protocol: number; version: string; panes: Pane[]; workspaces: Workspace[]; tabs: Tab[];
  focused_pane_id?: string;
}
export interface Session { id: string; name: string }
export interface Machine { id: string; name: string; url: string; token: string; remote?: string; parentId?: string; remoteStatus?: HerdrMachine['status']; remoteError?: string; remoteSession?: string }
export interface HerdrMachine { id: string; name: string; session: string; status: 'connecting' | 'online' | 'offline' | 'disabled'; error?: string }
export interface BridgeInfo { name: string; version: string; sessions: Session[] }
export interface ChatMessage {
  id: string; role: 'user' | 'assistant' | 'tool'; text: string; timestamp?: string;
  toolName?: string; output?: string;
}
export interface TranscriptCandidate { id: string; title: string; updated: number; agent: string }
export interface Conversation {
  source: 'codex' | 'claude' | 'pi' | 'unavailable'; messages: ChatMessage[];
  binding: 'reported' | 'selected' | 'none'; candidates: TranscriptCandidate[];
  truncated: boolean;
}
export interface Screen { text: string; revision: number; truncated: boolean }
export const statusLabel: Record<AgentStatus, string> = {
  idle: '就绪', working: '工作中', blocked: '需要你', done: '已完成', unknown: '终端',
};

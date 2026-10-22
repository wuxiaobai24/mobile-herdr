import type { ChatMessage } from './protocol';

export interface NativeQuestion {
  id: string; header: string; question: string;
  options?: { label: string; description?: string }[];
}
export interface NativeRequest {
  id: string; kind: 'approval' | 'question' | 'unsupported'; title: string; detail: string;
  questions?: NativeQuestion[];
  command?: string; cwd?: string; approvalType?: 'command' | 'files'; changes?: { path: string; diff: string }[];
}
export interface NativeState {
  runtimeId: string; provider: 'codex' | 'pi'; connected: boolean;
  ready?: boolean;
  owner: 'desktop' | string; epoch: number; revision: number;
  status: 'idle' | 'working' | 'blocked' | 'offline';
  conversationId?: string; model?: string; error?: string;
  models?: { id: string; name: string }[];
  messages: ChatMessage[]; requests: NativeRequest[]; truncated: boolean;
  capabilities: { steer: boolean; approvals: boolean; models: boolean; history?: boolean };
}
export interface NativeAction {
  action: 'claim' | 'release' | 'prompt' | 'stop' | 'reply' | 'model';
  runtimeId: string; clientId: string; epoch: number; requestId: string;
  conversationId?: string;
  text?: string; request?: string; decision?: 'accept' | 'decline' | 'cancel';
  answers?: Record<string, string[]>; model?: string;
}

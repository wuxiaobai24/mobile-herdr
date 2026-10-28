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
export interface NativeModel {
  id: string; name: string;
  reasoningEfforts?: { id: string; name: string }[];
  defaultReasoningEffort?: string;
}
export interface NativeCommand { name: string; description: string }
export interface NativeSkill { name: string; path: string; description: string; title?: string }
export interface NativeState {
  runtimeId: string; provider: 'codex' | 'pi' | 'omp'; connected: boolean;
  adapterVersion?: string;
  ready?: boolean;
  owner: 'desktop' | string; epoch: number; revision: number;
  status: 'idle' | 'working' | 'blocked' | 'offline';
  conversationId?: string; model?: string; error?: string;
  models?: NativeModel[];
  reasoningEffort?: string;
  mode?: 'plan' | 'default';
  context?: { tokens: number; window: number };
  commands?: NativeCommand[];
  skills?: NativeSkill[];
  messages: ChatMessage[]; requests: NativeRequest[]; truncated: boolean;
  capabilities: { steer: boolean; idlePrompt?: boolean; approvals: boolean; models: boolean; history?: boolean; reasoning?: boolean; commands?: boolean; skills?: boolean; attachments?: boolean; compact?: boolean; modes?: boolean; review?: boolean };
}
export interface NativeAction {
  action: 'claim' | 'release' | 'prompt' | 'prompt_idle' | 'stop' | 'reply' | 'model' | 'reasoning' | 'compact' | 'command' | 'mode' | 'review';
  runtimeId: string; clientId: string; epoch: number; requestId: string;
  conversationId?: string;
  text?: string; request?: string; decision?: 'accept' | 'decline' | 'cancel';
  answers?: Record<string, string[]>; model?: string; reasoningEffort?: string;
  mode?: 'plan' | 'default';
  skills?: string[];
  attachments?: string[];
}

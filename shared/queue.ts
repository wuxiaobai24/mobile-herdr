export type QueueStatus = 'queued' | 'delivering' | 'sent' | 'held' | 'uncertain' | 'cancelled';
export interface QueuedMessage {
  id: string; paneId: string; terminalId: string; runtimeId: string; conversationId: string;
  clientId: string; epoch: number; text: string; skills?: string[]; attachments?: string[];
  status: QueueStatus; created: number; updated: number; detail?: string;
}
export interface EnqueueInput {
  leaseId: string; paneId: string; terminalId: string; runtimeId: string; conversationId: string;
  clientId: string; epoch: number; text: string; skills?: string[]; attachments?: string[];
}
export const queueStatusLabel: Record<QueueStatus, string> = { queued: '下一轮再做', delivering: '正在投递', sent: '已送达', held: '已暂停', uncertain: '待核对送达结果', cancelled: '已移除' };

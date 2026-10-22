import { createHash } from 'node:crypto';
import { BridgeError } from './rpc';
import type { ChatMessage, HistoryPage } from '../shared/protocol';
export function historyIdentity(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32); }
export function historyCursor(identity: string, position: unknown): string { return Buffer.from(JSON.stringify({ identity, position })).toString('base64url'); }
export function decodeCursor(cursor: string, identity: string): unknown {
  try {
    if (cursor.length > 4096) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (value.identity !== identity) throw new Error();
    return value.position;
  } catch { throw new BridgeError('history_changed', '历史所属会话已变化，请重新打开当前对话。', 409); }
}
export function messagePage(messages: ChatMessage[], identity: string, before?: string): HistoryPage {
  const endId = before ? decodeCursor(before, identity) : undefined;
  const end = endId === undefined ? messages.length : messages.findIndex(message => message.id === endId);
  if (end < 0) throw new BridgeError('history_changed', '历史位置已变化，请重新打开对话。', 409);
  let bytes = 0, start = end;
  for (; start > 0 && end - start < 60; start--) {
    const size = Buffer.byteLength(JSON.stringify(messages[start - 1]));
    if (bytes + size > 240000 && start !== end) break;
    bytes += size;
  }
  return { identity, messages: messages.slice(start, end), hasMore: start > 0, cursor: start > 0 ? historyCursor(identity, messages[start].id) : undefined };
}

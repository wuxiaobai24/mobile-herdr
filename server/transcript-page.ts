import type { FileHandle } from 'node:fs/promises';
import type { ChatMessage, HistoryPage } from '../shared/protocol';
import { historyCursor } from './history';
import { parseTranscript } from './transcript-parser';
import { BridgeError } from './rpc';

const INITIAL_BYTES = 64 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGES = 60;

/** Expand backwards only when the tail does not contain a full page. */
export async function readTranscriptPage(file: FileHandle, agent: string, end: number, identity: string): Promise<HistoryPage> {
  let window = Math.min(INITIAL_BYTES, end);
  let start = end - window;
  let parsed: ChatMessage[] = [];
  let positions = new Map<string, number>();
  let tail = Buffer.alloc(0);
  for (;;) {
    start = end - window;
    const buffer = Buffer.alloc(window);
    const prefix = window - tail.length;
    tail.copy(buffer, prefix);
    let bytesRead = 0;
    while (bytesRead < prefix) {
      const result = await file.read({ buffer, offset: bytesRead, length: prefix - bytesRead, position: start + bytesRead });
      if (!result.bytesRead) throw new BridgeError('history_changed', '历史文件已变化，请重新打开对话。', 409);
      bytesRead += result.bytesRead;
    }
    tail = buffer;
    let records = buffer, offset = start;
    if (start > 0) {
      const boundary = records.indexOf(10);
      offset += boundary + 1;
      records = boundary < 0 ? records.subarray(0, 0) : records.subarray(boundary + 1);
    }
    positions = new Map();
    parsed = parseTranscript(records.toString('utf8').split('\n').slice(0, -1), agent, { offset, positions });
    // The extra message proves that the first returned record is a safe cursor.
    if (parsed.length > MAX_MESSAGES || start === 0 || window === MAX_BYTES) break;
    window = Math.min(window * 2, end, MAX_BYTES);
  }

  const messages: ChatMessage[] = [];
  let bytes = 0;
  for (let i = parsed.length - 1; i >= 0 && messages.length < MAX_MESSAGES; i--) {
    const row = parsed[i], text = row.text.length > 64000 ? '…\n' + row.text.slice(-64000) : row.text;
    const message = { ...row, text, ...(text !== row.text ? { truncated: true } : {}) };
    const size = Buffer.byteLength(JSON.stringify(message));
    if (bytes + size > 256000 && messages.length) break;
    messages.unshift(message);
    bytes += size;
  }
  const earlier = messages.length ? positions.get(messages[0].id)! : start;
  const hasMore = start > 0 || parsed.length > messages.length;
  return { identity, messages, hasMore, cursor: hasMore ? historyCursor(identity, earlier) : undefined,
    ...(!messages.length && start > 0 ? { limited: true } : {}) };
}

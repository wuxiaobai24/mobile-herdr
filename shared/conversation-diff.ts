import { parseMarkdown } from './markdown';
import { suppliedChanges } from './diff';
import type { ChatMessage } from './protocol';

export interface ConversationChange { path: string; patches: string[]; added: number; removed: number }
export function conversationChanges(messages: ChatMessage[]): ConversationChange[] {
  const files = new Map<string, ConversationChange>();
  for (const message of messages) for (const source of [message.text, message.output]) {
    if (!source) continue;
    const nodes = /```|~~~/.test(source) ? parseMarkdown(source).children : [];
    const fenced = nodes.filter(row => row.type === 'code' && ['diff', 'patch'].includes(row.lang ?? ''));
    const sources = fenced.length ? fenced.map(row => row.type === 'code' ? row.value : '') : [source];
    for (const file of sources.flatMap(suppliedChanges)) {
      file.patch = file.patch.replace(/\n+$/, '\n');
      const entry = files.get(file.path) ?? { path: file.path, patches: [], added: 0, removed: 0 };
      if (entry.patches.includes(file.patch)) continue;
      entry.patches.push(file.patch); entry.added += file.added; entry.removed += file.removed;
      files.set(file.path, entry);
    }
  }
  return [...files.values()];
}

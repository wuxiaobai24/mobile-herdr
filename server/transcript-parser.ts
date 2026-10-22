import type { ChatMessage } from '../shared/protocol';

type RecordValue = Record<string, any>;
function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => ['text', 'input_text', 'output_text'].includes(block?.type))
    .map(block => block.text ?? '').join('\n');
}

/** Read public messages and tools only; never expose system instructions or reasoning. */
export function parseTranscript(lines: string[], agent: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const tools = new Map<string, ChatMessage>();
  const seen = new Set<string>();
  function add(message: ChatMessage): void {
    if (!message.text.trim() || seen.has(message.id)) return;
    seen.add(message.id); messages.push(message);
  }
  for (let index = 0; index < lines.length; index++) {
    let record: RecordValue;
    try { record = JSON.parse(lines[index]); } catch { continue; }
    const timestamp = record.timestamp;
    const fallbackId = `${agent}:${index}`;
    if (agent === 'codex') {
      if (record.type !== 'response_item') continue;
      const item = record.payload ?? {};
      if (item.type === 'message' && ['user', 'assistant'].includes(item.role) && item.channel !== 'analysis') {
        const text = textContent(item.content);
        if (item.role === 'user' && /^\s*<(environment_context|permissions|instructions|turn_aborted)>/.test(text)) continue;
        add({ id: item.id ?? fallbackId, role: item.role, text, timestamp });
      } else if (['function_call', 'custom_tool_call'].includes(item.type)) {
        const message: ChatMessage = { id: item.call_id ?? fallbackId, role: 'tool', toolName: item.name, text: String(item.arguments ?? item.input ?? '').slice(0, 12000), timestamp };
        tools.set(message.id, message); add(message);
      } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
        const tool = tools.get(item.call_id);
        if (tool) tool.output = String(typeof item.output === 'string' ? item.output : JSON.stringify(item.output)).slice(0, 16000);
      }
    } else {
      const item = record.message;
      if (!item || !['user', 'assistant', 'toolResult'].includes(item.role)) continue;
      if (item.role === 'toolResult') {
        const tool = tools.get(item.toolCallId);
        if (tool) tool.output = textContent(item.content).slice(0, 16000);
        continue;
      }
      const text = textContent(item.content);
      add({ id: record.uuid ?? record.id ?? fallbackId, role: item.role, text, timestamp });
      if (!Array.isArray(item.content)) continue;
      for (const [blockIndex, block] of item.content.entries()) {
        if (['tool_use', 'toolCall'].includes(block.type)) {
          const message: ChatMessage = { id: block.id ?? `${fallbackId}:${blockIndex}`, role: 'tool', toolName: block.name, text: JSON.stringify(block.input ?? block.arguments ?? {}).slice(0, 12000), timestamp };
          tools.set(message.id, message); add(message);
        } else if (block.type === 'tool_result') {
          const tool = tools.get(block.tool_use_id);
          if (tool) tool.output = textContent(block.content).slice(0, 16000);
        }
      }
    }
  }
  return messages.slice(-500);
}

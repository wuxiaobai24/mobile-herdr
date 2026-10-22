import { describe, expect, test } from 'bun:test';
import { parseTranscript } from '../server/transcript-parser';
const lines = (values: unknown[]) => values.map(value => JSON.stringify(value));

describe('native transcript normalization', () => {
  test('Codex public messages and matched tool output, without reasoning, system messages or duplicate event messages', () => {
    const result = parseTranscript(lines([
      { type: 'session_meta', payload: { base_instructions: 'private instructions' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'duplicate response' } },
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'secret system prompt' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'private reasoning' }] } },
      { type: 'response_item', payload: { type: 'message', id: 'm1', role: 'user', content: [{ type: 'input_text', text: '修复问题' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'exec', call_id: 't1', arguments: '{"cmd":"test"}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 't1', output: 'passed' } },
      { type: 'response_item', payload: { type: 'message', id: 'm2', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '已修复' }] } },
    ]), 'codex');
    expect(result.map(message => message.role)).toEqual(['user', 'tool', 'assistant']);
    expect(result[1].output).toBe('passed');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  test('Claude tool_result and Pi toolResult match their original tool use', () => {
    for (const agent of ['pi', 'claude']) {
      const toolType = agent === 'pi' ? 'toolCall' : 'tool_use';
      const output = agent === 'pi' ? { message: { role: 'toolResult', toolCallId: 'tool1', content: [{ type: 'text', text: 'ok' }] } } : { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'ok' }] } };
      const result = parseTranscript(lines([
        { id: 'a', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }, { type: toolType, id: 'tool1', name: 'read', input: { path: 'a.ts' } }] } }, output,
      ]), agent);
      expect(result).toHaveLength(1); expect(result[0].output).toBe('ok'); expect(JSON.stringify(result)).not.toContain('hidden');
    }
  });
  test('incomplete JSONL records are ignored', () => { expect(parseTranscript(['{"type":'], 'codex')).toEqual([]); });
});

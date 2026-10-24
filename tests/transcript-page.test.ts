import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTranscriptPage } from '../server/transcript-page';
import { decodeCursor } from '../server/history';
import { parseTranscript } from '../server/transcript-parser';

async function withTranscript(content: string, run: (file: Awaited<ReturnType<typeof open>>, size: number) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mh-page-'));
  const path = join(directory, 'conversation.jsonl');
  await writeFile(path, content);
  const file = await open(path, 'r');
  try { await run(file, Buffer.byteLength(content)); }
  finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
}
const record = (id: number, text = `消息 ${id} 中文🙂`) => JSON.stringify({ id: `message-${id}`, message: { role: id % 2 ? 'assistant' : 'user', content: text } }) + '\n';

test('dense transcript pages read only 64 KiB and preserve byte-based Unicode pagination', async () => {
  const content = (JSON.stringify({ metadata: 'x'.repeat(4000) }) + '\n').repeat(1000)
    + Array.from({ length: 207 }, (_, i) => record(i)).join('');
  await withTranscript(content, async (file, size) => {
    const read = spyOn(file, 'read');
    const latest = await readTranscriptPage(file, 'pi', size, 'exact-identity');
    const bytes = read.mock.calls.reduce((sum, args) => sum + Number(args[0]?.length), 0);
    expect(bytes).toBe(65536);
    expect(latest.messages).toEqual(parseTranscript(content.split('\n'), 'pi').slice(-60));
    const messages = [...latest.messages];
    let cursor = latest.cursor;
    while (cursor) {
      const position = Number(decodeCursor(cursor, 'exact-identity'));
      const page = await readTranscriptPage(file, 'pi', position, 'exact-identity');
      messages.unshift(...page.messages); cursor = page.cursor;
    }
    expect(messages).toHaveLength(207);
    expect(new Set(messages.map(message => message.id)).size).toBe(207);
    expect(messages[0].text).toBe('消息 0 中文🙂');
    read.mockRestore();
  });
});

test('tail expansion keeps tool results, skips incomplete records and truncates large messages', async () => {
  const rows = [
    record(0, 'a'.repeat(80000)),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool', name: 'exec', arguments: { cmd: 'test' } }] } }) + '\n',
    JSON.stringify({ message: { role: 'toolResult', toolCallId: 'tool', content: '结果'.repeat(60000) } }) + '\n',
    record(1, '完成'), '{"id":"incomplete',
  ];
  await withTranscript(rows.join(''), async (file, size) => {
    const page = await readTranscriptPage(file, 'pi', size, 'tools');
    expect(page.messages).toHaveLength(3);
    expect(page.messages[0]).toMatchObject({ id: 'message-0', truncated: true });
    expect(page.messages[0].text.length).toBeLessThan(64010);
    expect(page.messages[1]).toMatchObject({ id: 'tool', output: '结果'.repeat(8000), truncated: true });
    expect(page.messages[2].text).toBe('完成');
    expect(page.hasMore).toBe(false);
  });
});

test('oversized JSONL records remain bounded and allow paging past their incomplete tail', async () => {
  await withTranscript(record(0) + JSON.stringify({ metadata: 'x'.repeat(9 * 1024 * 1024) }) + '\n', async (file, size) => {
    const page = await readTranscriptPage(file, 'pi', size, 'bounded');
    expect(page).toMatchObject({ messages: [], hasMore: true, limited: true });
    const previous = await readTranscriptPage(file, 'pi', Number(decodeCursor(page.cursor!, 'bounded')), 'bounded');
    expect(previous.messages[0].text).toBe('消息 0 中文🙂');
    expect(previous.hasMore).toBe(false);
  });
});

test('empty transcripts have a complete empty page', async () => {
  await withTranscript('', async file => {
    expect(await readTranscriptPage(file, 'pi', 0, 'empty')).toEqual({ identity: 'empty', messages: [], hasMore: false, cursor: undefined });
  });
});

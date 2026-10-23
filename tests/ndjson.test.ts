import { expect, test } from 'bun:test';
import { ndjsonLines } from '../server/native/ndjson';
import { createNativeFixture } from './native-fixture';

async function* chunks(values: Uint8Array[]): AsyncGenerator<Uint8Array> { yield* values; }
async function lines(values: Uint8Array[], limit: number): Promise<string[]> {
  const result: string[] = [];
  for await (const line of ndjsonLines(chunks(values), limit)) result.push(line);
  return result;
}
test('NDJSON limits each frame even when a single read batch exceeds the limit', async () => {
  expect(await lines([Buffer.from('12345678\nabcdefgh\n')], 8)).toEqual(['12345678', 'abcdefgh']);
  const unicode = Buffer.from('{"text":"中文🙂"}\n');
  expect(await lines([...unicode].map(byte => new Uint8Array([byte])), 64)).toEqual(['{"text":"中文🙂"}']);
  await expect(lines([Buffer.from('12345'), Buffer.from('6789\n')], 8)).rejects.toThrow('单条数据');
  await expect(lines([Buffer.from('{"partial":')], 64)).rejects.toThrow('未完整接收');
});
test('Codex broker accepts a 17 MiB response and continues the original connection', async () => {
  const fixture = await createNativeFixture();
  try {
    const reply = await fixture.desktopCall('config/read', { largeFixture: true });
    expect(reply.result.content.length).toBe(17 * 1024 * 1024);
    const next = await fixture.desktopCall('turn/start', { threadId: 'test-thread-original', input: [{ type: 'text', text: 'continue after large frame' }] });
    expect(next.error).toBeUndefined();
    expect(fixture.control.state.connected).toBe(true);
    expect(fixture.control.state.conversationId).toBe('test-thread-original');
  } finally { await fixture.close(); }
}, 15000);

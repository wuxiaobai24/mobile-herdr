export const CODEX_FRAME_BYTES = 64 * 1024 * 1024;

/** Bound individual frames, not arbitrary OS read batches. Decode UTF-8 only after reassembly. */
export async function* ndjsonLines(stream: AsyncIterable<Uint8Array>, maxBytes = CODEX_FRAME_BYTES): AsyncGenerator<string> {
  let parts: Buffer[] = [];
  let length = 0;
  for await (const bytes of stream) {
    const chunk = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const stop = end < 0 ? chunk.length : end;
      const part = chunk.subarray(start, stop);
      length += part.length;
      if (length > maxBytes) throw new Error(`Codex 单条数据超过 ${Math.round(maxBytes / 1024 / 1024)} MiB，请在电脑检查超大工具输出或会话历史。`);
      if (part.length) parts.push(part);
      if (end < 0) break;
      yield Buffer.concat(parts, length).toString('utf8');
      parts = []; length = 0; start = end + 1;
    }
  }
  if (length) throw new Error('Codex 数据帧未完整接收。请检查开发机进程，不要自动重发消息。');
}

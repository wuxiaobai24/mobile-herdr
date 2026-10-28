import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, panePath } from '../shared/client';
import type { Attachment } from '../shared/attachments';
import type { NativeAction } from '../shared/native';
import { createNativeFixture } from './native-fixture';
import { parseTranscript } from '../server/transcript-parser';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOQq3gGRww4OQBSLhHR6WGRvAAAAABJRU5ErkJggg==';
test('authenticated attachments bind to the current thread, reach Codex as local images, and preserve receipts', async () => {
  const f = await createNativeFixture();
  const machine = { id: 'test', name: 'test', url: f.url, token: f.config.token };
  const path = panePath('default', 'w1:p1', 'attachments');
  let sequence = 0;
  const action = (values: Partial<NativeAction>): NativeAction => ({ action: 'prompt', runtimeId: f.control.state.runtimeId,
    conversationId: f.control.state.conversationId, clientId: 'attachment-phone', epoch: f.control.state.epoch,
    requestId: 'attachments-test-' + ++sequence, ...values });
  try {
    await expect(api({ ...machine, token: '' }, path, { body: { name: 'private.png', base64: png }, id: 'upload-private-1' })).rejects.toMatchObject({ code: 'unauthorized' });
    const image = await api<Attachment>(machine, path, { body: { name: '设计图.png', base64: png }, id: 'upload-image-1' });
    expect(image.mime).toBe('image/png');
    expect(await api(machine, path, { body: { name: '设计图.png', base64: png }, id: image.id })).toEqual(image);
    await expect(api(machine, path, { body: { name: 'other.png', base64: png }, id: image.id })).rejects.toMatchObject({ code: 'request_conflict' });
    await expect(api(machine, path, { body: { name: '../escape', base64: png }, id: 'upload-badname' })).rejects.toMatchObject({ code: 'invalid_input' });
    const file = await api<Attachment>(machine, path, { body: { name: 'metadata.json', base64: Buffer.from('{"request":"check"}').toString('base64') }, id: 'upload-document-1' });
    const preview = await api<{ uri: string }>(machine, path + `&id=${image.id}`);
    expect(preview.uri).toBe('data:image/png;base64,' + png);
    const download = await fetch(f.url + path + `&id=${file.id}&mode=download`, { headers: { Authorization: `Bearer ${machine.token}` } });
    expect(await download.text()).toBe('{"request":"check"}');
    await f.control.dispatch(action({ action: 'claim' }));
    const input = action({ text: '检查附件', attachments: [image.id, file.id] });
    await f.control.dispatch(input); await f.control.dispatch(input);
    await f.desktopCall('model/list');
    const starts = f.frames.filter(frame => frame.method === 'fixture/turnOptions');
    expect(starts).toHaveLength(1);
    const localImage = starts[0].params.input.find((row: any) => row.type === 'localImage');
    expect(Buffer.from(await readFile(localImage.path)).toString('base64')).toBe(png);
    expect(starts[0].params.input[0].text).toContain('metadata.json');
    const message = f.control.state.messages.find(row => row.role === 'user')!;
    expect(message.text).toBe('检查附件');
    expect(message.media?.map(row => row.type)).toEqual(['image', 'file']);
    const generated = join(f.directory, 'generated.png');
    await writeFile(generated, Buffer.from(png, 'base64'));
    const generatedPath = panePath('default', 'w1:p1', 'media') + `&path=${encodeURIComponent(generated)}`;
    await expect(api(machine, generatedPath)).rejects.toMatchObject({ code: 'image_unavailable' });
    f.control.message({ id: 'generated-image', role: 'assistant', text: `![生成的图片](${generated})` });
    expect((await api<{ uri: string }>(machine, generatedPath)).uri).toBe('data:image/png;base64,' + png);
    f.control.state.conversationId = 'different-thread';
    await expect(f.control.dispatch(action({ text: '不能跨会话发送', attachments: [image.id] }))).rejects.toMatchObject({ code: 'attachment_unavailable' });
    for (let i = 0; i < 5; i++) f.control.message({ id: `inline-image-${i}`, role: 'assistant', text: '工具返回的图片', media: [{ type: 'image', name: 'result.png', url: 'data:image/png;base64,' + 'A'.repeat(500000) }] });
    expect(Buffer.byteLength(JSON.stringify(f.control.state))).toBeLessThan(1500000);
    expect(f.control.state.truncated).toBe(true);
  } finally { await f.close(); }
});

test('transcript parsing retains image-only messages and image tool output', () => {
  const lines = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://example.com/image.png' } }] } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'view-1', name: 'view_image', arguments: '{"path":"image.png"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'view-1', output: [{ type: 'image', url: 'https://example.com/result.png' }] } },
  ].map(row => JSON.stringify(row));
  const messages = parseTranscript(lines, 'codex');
  expect(messages[0].media?.[0].url).toBe('https://example.com/image.png');
  expect(messages[1].media?.[0].url).toBe('https://example.com/result.png');
});

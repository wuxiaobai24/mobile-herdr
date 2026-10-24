import { expect, test } from 'bun:test';
import { mkdir, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge } from '../server/server';
import { createFixture } from './fixture';
import { filePath, MAX_DOWNLOAD_BYTES } from '../shared/files';

async function filesFixture() {
  const fixture = await createFixture(), root = join(fixture.directory, 'project');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '说明 文档.md'), '# 手机文件\n\n内容预览 ✓');
  await writeFile(join(root, 'src/hello.ts'), 'export const greeting = "你好";');
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(root, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOQq3gGRww4OQBSLhHR6WGRvAAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(root, 'large.txt'), '你'.repeat(100000));
  await writeFile(join(root, 'too-large.bin'), ''); await truncate(join(root, 'too-large.bin'), MAX_DOWNLOAD_BYTES + 1);
  await symlink(fixture.transcript, join(root, 'outside'));
  await symlink(join(root, 'src'), join(root, 'source-link'));
  fixture.snapshot.panes[0].foreground_cwd = root;
  const get = (path = '', mode?: 'preview' | 'download', expectedRoot: string | undefined = root) => fetch(fixture.url + filePath('default', 'w1:p1', path, expectedRoot, mode), { headers: { Authorization: `Bearer ${fixture.config.token}` } });
  return { ...fixture, root, get };
}
test('project files list, preview UTF-8/images/binary, and download exact bytes with header authentication', async () => {
  const fixture = await filesFixture();
  try {
    const listing = await (await fixture.get()).json();
    expect(listing.root).toBe(fixture.root);
    expect(listing.entries[0].kind).toBe('directory');
    expect(listing.entries.find((row: any) => row.name === 'outside').kind).toBe('blocked');
    expect((await (await fixture.get('src')).json()).entries[0].name).toBe('hello.ts');
    expect((await (await fixture.get('source-link')).json()).entries[0].name).toBe('hello.ts');
    expect(await (await fixture.get('说明 文档.md', 'preview')).json()).toMatchObject({ kind: 'text', text: '# 手机文件\n\n内容预览 ✓', truncated: false });
    expect((await (await fixture.get('image.png', 'preview')).json()).uri).toStartWith('data:image/png;base64,');
    expect(await (await fixture.get('binary.bin', 'preview')).json()).toMatchObject({ kind: 'binary' });
    const large = await (await fixture.get('large.txt', 'preview')).json();
    expect(large.kind).toBe('text'); expect(large.truncated).toBeTrue(); expect(large.text).not.toContain('�');
    const download = await fixture.get('说明 文档.md', 'download');
    expect(download.headers.get('content-disposition')).toContain("filename*=UTF-8''" + encodeURIComponent('说明 文档.md'));
    expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await download.text()).toBe('# 手机文件\n\n内容预览 ✓');
    expect(new Uint8Array(await (await fixture.get('binary.bin', 'download')).arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect((await fetch(fixture.url + filePath('default', 'w1:p1', 'binary.bin', fixture.root, 'download'))).status).toBe(401);
    expect(fixture.calls.every(row => row.method === 'session.snapshot')).toBeTrue();
  } finally { await fixture.close(); }
});
test('files reject traversal, links outside root, special files, oversized downloads and changed session roots', async () => {
  const fixture = await filesFixture();
  try {
    expect((await fixture.get('../secret', 'preview')).status).toBe(400);
    expect((await fixture.get('/etc/passwd', 'download')).status).toBe(400);
    expect((await fixture.get('outside', 'preview')).status).toBe(403);
    expect((await fixture.get('outside', 'download')).status).toBe(403);
    expect((await fixture.get('src', 'download')).status).toBe(400);
    const child = Bun.spawn(['mkfifo', join(fixture.root, 'pipe')]); expect(await child.exited).toBe(0);
    expect((await fixture.get('pipe', 'preview')).status).toBe(400);
    expect((await fixture.get('too-large.bin', 'download')).status).toBe(413);
    fixture.snapshot.panes[0].foreground_cwd = join(fixture.root, 'src');
    expect((await fixture.get('hello.ts', 'preview')).status).toBe(409);
    fixture.snapshot.panes[0].cwd = undefined; fixture.snapshot.panes[0].foreground_cwd = undefined;
    expect((await fixture.get()).status).toBe(409);
  } finally { await fixture.close(); }
});
test('SSH forwarding preserves streamed file bytes, attachment headers and error responses', async () => {
  const remote = await filesFixture(), local = await createFixture();
  const bridge = createBridge(local.config, { remotes: { destination(id: string) { if (id !== 'fixture-ssh') throw new Error('Unknown test target'); return { url: remote.url, token: remote.config.token }; } } as any });
  try {
    const path = filePath('default', 'w1:p1', '说明 文档.md', remote.root, 'download');
    const request = (path: string) => fetch(`http://127.0.0.1:${bridge.port}${path}`, { headers: { Authorization: `Bearer ${local.config.token}`, 'X-Herdr-Machine': 'fixture-ssh' } });
    const result = await request(path);
    expect(result.status).toBe(200); expect(result.headers.get('content-disposition')).toContain('attachment;');
    expect(await result.text()).toBe('# 手机文件\n\n内容预览 ✓');
    const denied = await request(filePath('default', 'w1:p1', 'outside', remote.root, 'download'));
    expect(denied.status).toBe(403); expect((await denied.json()).error.code).toBe('file_outside_project');
  } finally { bridge.stop(true); await local.close(); await remote.close(); }
});

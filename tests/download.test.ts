import { expect, test } from 'bun:test';
import { receiveDownload, downloadLabel, downloadResultLabel } from '../shared/download';
import { projectLink } from '../shared/project-link';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge } from '../server/server';
import { createFixture } from './fixture';
const machine = { id: 'fixture', name: 'test', url: 'http://test', token: 'private-test-key' };
test('file links resolve only within the selected project, including encoded names and line suffixes', () => {
  expect(projectLink('/work/project/artifacts/app.apk', '/work/project')).toEqual({ path: 'artifacts/app.apk', name: 'app.apk' });
  expect(projectLink('./说明%20文件.md:12', '/work/project')?.path).toBe('说明 文件.md');
  expect(projectLink('file:///work/project/app.apk', '/work/project')?.path).toBe('app.apk');
  for (const value of ['/work/other/app.apk', '/work/project-two/app.apk', '../app.apk', '%2e%2e/app.apk', '//evil/app.apk', 'javascript:alert(1)', 'file://host/work/project/app.apk']) expect(projectLink(value, '/work/project')).toBeUndefined();
});
test('download streams progress before completion, authenticates in headers and checks exact length', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const progress: number[] = [], chunks: Uint8Array[] = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    expect(new URL(request.url).search).toBe(''); expect(request.headers.get('authorization')).toBe('Bearer ' + machine.token);
    let step = 0;
    return new Response(new ReadableStream({ async pull(controller) { if (step++ === 0) controller.enqueue(new Uint8Array([1,2])); else { await gate; controller.enqueue(new Uint8Array([3,4])); controller.close(); } } }), { headers: { 'content-length': '4' } });
  } });
  try {
    const promise = receiveDownload({ ...machine, url: `http://127.0.0.1:${server.port}` }, '/', bytes => { chunks.push(bytes); }, { onProgress: value => { progress.push(value.loaded); } });
    for (let i = 0; i < 100 && !progress.includes(2); i++) await Bun.sleep(5);
    expect(progress).toContain(2); expect(chunks).toHaveLength(1);
    release(); expect(await promise).toBe(4); expect(progress.at(-1)).toBe(4);
  } finally { release(); await server.stop(true); }
});
test('download failures, cancellation and truncated responses cannot report success', async () => {
  const fetcher = (response: Response) => (async () => response);
  await expect(receiveDownload(machine, '/', () => {}, {}, fetcher(new Response('abc', { headers: { 'content-length': '5' } })))).rejects.toThrow('不完整');
  await expect(receiveDownload(machine, '/', () => {}, {}, fetcher(new Response('', { headers: { 'content-length': '104857601' } })))).rejects.toThrow('100 MB');
  await expect(receiveDownload(machine, '/', () => {}, {}, fetcher(Response.json({ error: { message: '不允许访问' } }, { status: 403 })))).rejects.toThrow('不允许访问');
  const controller = new AbortController();
  await expect(receiveDownload(machine, '/', () => { controller.abort(); }, { signal: controller.signal }, fetcher(new Response('abc')))).rejects.toHaveProperty('code', 'download_cancelled');
  expect(downloadLabel({ phase: 'downloading', loaded: 512, total: 1024 })).toContain('50%');
  expect(downloadResultLabel('handed-off')).toContain('浏览器下载列表');
  expect(downloadResultLabel('saved')).toBe('文件已保存。');
});
test('local APK endpoint requires header authentication and returns a bounded binary stream', async () => {
  const f = await createFixture();
  await mkdir(join(f.directory, 'artifacts/android'), { recursive: true });
  await writeFile(join(f.directory, 'artifacts/android/mobile-herdr.apk'), new Uint8Array(2048));
  const bridge = createBridge({ ...f.config, port: 0 }, { runtimeRoot: f.directory });
  const url = `http://127.0.0.1:${bridge.port}`;
  try {
    const unauthorized = await fetch(url + '/api/android'); expect(unauthorized.status).toBe(401);
    const headers = { authorization: 'Bearer ' + f.config.token };
    const info = await fetch(url + '/api/android', { headers }).then(response => response.json());
    expect(info.available).toBe(true); expect(info.size).toBeGreaterThan(1000); expect(info.sha256).toMatch(/^[a-f\d]{64}$/);
    const response = await fetch(url + '/api/android?mode=download', { headers });
    expect(response.headers.get('content-length')).toBe(String(info.size)); expect(response.headers.get('content-disposition')).toContain('mobile-herdr.apk');
    await response.body!.cancel();
  } finally { await bridge.stop(true); await f.close(); }
});

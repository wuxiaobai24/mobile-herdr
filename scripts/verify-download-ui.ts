import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNativeFixture } from '../tests/native-fixture';
import { prepareProjectFiles } from '../tests/file-fixture';
const fixture = await createNativeFixture();
const root = await prepareProjectFiles(fixture);
await writeFile(join(root, 'slow.apk'), new Uint8Array(2 * 1024 * 1024).fill(42));
fixture.control.message({ id: 'download-link', role: 'assistant', text: `[下载测试 APK](${root}/slow.apk)\n\n[项目说明](${root}/说明%20文档.md)` });
let fail = false, cancelled = 0;
const proxy = Bun.serve<{ upstream?: WebSocket; path: string }>({ hostname: '127.0.0.1', port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/watch')) { if (server.upgrade(request, { data: { path: url.pathname } })) return; return new Response(null, { status: 426 }); }
    if (url.pathname === '/fixture-fail') { fail = true; return Response.json({ ok: true }); }
    if (url.pathname === '/fixture-reset') { fail = false; return Response.json({ cancelled }); }
    const response = await fetch(fixture.url + url.pathname + url.search, { method: request.method, headers: request.headers, body: request.method === 'POST' ? await request.text() : undefined });
    if (url.searchParams.get('mode') !== 'download' || !response.ok || !response.body) return response;
    const reader = response.body.getReader(); let count = 0;
    const headers = new Headers(response.headers); headers.delete('transfer-encoding'); headers.delete('content-encoding');
    return new Response(new ReadableStream({ async pull(controller) {
      try { const value = await reader.read(); if (value.done) controller.close(); else { await Bun.sleep(60); if (fail && ++count > 2) { await reader.cancel(); controller.close(); } else controller.enqueue(value.value); } }
      catch (error) { controller.error(error); }
    }, async cancel() { cancelled++; await reader.cancel(); } }), { headers, status: response.status });
  }, websocket: { message(ws, message) {
    if (!ws.data.upstream) { const upstream = new WebSocket(fixture.url.replace('http', 'ws') + ws.data.path); ws.data.upstream = upstream; upstream.onopen = () => upstream.send(String(message)); upstream.onmessage = event => ws.send(String(event.data)); upstream.onclose = () => ws.close(); }
    else if (ws.data.upstream.readyState === WebSocket.OPEN) ws.data.upstream.send(String(message));
  }, close(ws) { ws.data.upstream?.close(); } },
});
fixture.config.origins.push(`http://127.0.0.1:${proxy.port}`);
await mkdir('artifacts/download-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-download-ui.py'], { env: { ...process.env, MOBILE_HERDR_TEST_URL: `http://127.0.0.1:${proxy.port}`, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error('Download UI verification failed');
} finally { await proxy.stop(true); await fixture.close(); }

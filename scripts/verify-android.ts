import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareProjectFiles } from '../tests/file-fixture';
import { createNativeFixture } from '../tests/native-fixture';
import { createBridge } from '../server/server';
import { nativeCall } from '../server/native/registry';

const serial = process.env.MOBILE_HERDR_ANDROID_SERIAL;
if (!serial?.startsWith('emulator-')) throw new Error('Set MOBILE_HERDR_ANDROID_SERIAL to a dedicated Android emulator. This test installs and clears the test app on that emulator.');
const sdk = process.env.ANDROID_HOME ?? join(homedir(), 'Android/Sdk');
const adb = join(sdk, 'platform-tools/adb');
const emulator = await Bun.$`${adb} -s ${serial} shell getprop ro.kernel.qemu`.quiet();
if (emulator.text().trim() !== '1') throw new Error('Android verification only operates on an emulator.');
const fixture = await createNativeFixture();
const fileRoot = await prepareProjectFiles(fixture);
if (process.env.MOBILE_HERDR_ANDROID_DOWNLOAD_ONLY === '1') await writeFile(join(fileRoot, 'slow.apk'), new Uint8Array(4 * 1024 * 1024).fill(42));
fixture.control.readHistory = undefined;
for (let i = 0; i < 180; i++) fixture.control.message({ id: `android-history-${i}`, role: i % 2 ? 'assistant' : 'user', text: `Android earlier message ${i}` });
fixture.control.message({ id: 'android-reading-question', role: 'user', text: 'Android reading question' });
fixture.control.message({ id: 'android-tool', role: 'tool', toolName: 'exec_command', text: '{"cmd":"bun run typecheck"}', output: 'Typecheck passed', toolStatus: 'completed', durationMs: 1000, exitCode: 0 });
fixture.control.message({ id: 'android-image', role: 'assistant', text: '![Android 项目截图](preview.png)' });
fixture.control.message({ id: 'android-reading-answer', role: 'assistant', text: '# 安卓阅读\n\n共享主题与原生 Markdown。\n\n- **同一个会话**\n- 草稿和输入权保持隔离\n\n```ts\nconst client = "shared";\n```\n\n| 端 | UI |\n| --- | --- |\n| Web | React Native Web |\n| Android | React Native |\n\n' + '继续原来的开发任务。\n\n'.repeat(12) });
if (process.env.MOBILE_HERDR_ANDROID_DOWNLOAD_ONLY === '1') fixture.control.message({ id: 'download-link', role: 'assistant', text: `[Android 下载 APK](${fileRoot}/slow.apk)` });
fixture.config.port = fixture.bridge.port!;
let bridge = fixture.bridge;
const identity = fixture.control.state.runtimeId;
const terminalInput: string[] = [];
let historyReads = 0;
fixture.snapshot.tabs.push({ workspace_id: 'w1', tab_id: 'w1:t2', label: 'release 手机验证', number: 2 });
fixture.snapshot.panes.push({ ...fixture.snapshot.panes[0], pane_id: 'w1:p2', terminal_id: 'android-navigation-test', tab_id: 'w1:t2', label: 'Android second tab', agent: undefined, agent_session: undefined, agent_status: 'idle', focused: false });
// The APK uses a real WebView with a VT peer owned by this test, not a user PTY.
const clientBridge = Bun.serve<{ terminal: boolean; authenticated?: boolean; upstream?: WebSocket; path: string }>({
  hostname: '127.0.0.1', port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/history')) historyReads++;
    if (['/api/watch', '/api/terminal', '/api/queue/watch'].includes(url.pathname)) {
      if (server.upgrade(request, { data: { terminal: url.pathname === '/api/terminal', path: url.pathname } })) return;
      return new Response(null, { status: 426 });
    }
    if (url.pathname === '/api/update') return Response.json({ phase: 'idle', current: '0.2.2-beta.6', latest: '0.2.2-beta.7', available: true, supported: false, message: '有新版本可用。' });
    try {
      const response = await fetch(fixture.url + url.pathname + url.search, { method: request.method, headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() });
      if (url.searchParams.get('mode') !== 'download' || url.searchParams.get('path') !== 'slow.apk' && !(process.env.MOBILE_HERDR_ANDROID_DOWNLOAD_ONLY === '1' && url.pathname === '/api/android') || !response.body || !response.ok) return response;
      const reader = response.body.getReader();
      let pending = new Uint8Array(), offset = 0;
      return new Response(new ReadableStream({ async pull(controller) {
        try {
          if (offset === pending.length) { const part = await reader.read(); if (part.done) { controller.close(); return; } pending = part.value; offset = 0; }
          await Bun.sleep(100); const end = Math.min(pending.length, offset + 32768); controller.enqueue(pending.subarray(offset, end)); offset = end;
        } catch (error) { controller.error(error); }
      }, cancel: () => reader.cancel() }), { headers: response.headers });
    }
    catch { return new Response('Test bridge offline', { status: 503 }); }
  },
  websocket: {
    message(ws, bytes) {
      const frame = JSON.parse(String(bytes));
      if (!ws.data.terminal) {
        if (!ws.data.upstream) {
          if (frame.type !== 'auth') { ws.close(1008); return; }
          const upstream = new WebSocket(fixture.url.replace(/^http/, 'ws') + ws.data.path); ws.data.upstream = upstream;
          upstream.onopen = () => upstream.send(String(bytes));
          upstream.onmessage = event => ws.send(String(event.data));
          upstream.onclose = () => ws.close(1011, 'test_bridge_disconnected');
          upstream.onerror = () => ws.close(1011, 'test_bridge_unavailable');
        } else if (ws.data.upstream.readyState === WebSocket.OPEN) ws.data.upstream.send(String(bytes));
        return;
      }
      if (!ws.data.authenticated) {
        if (frame.type !== 'auth' || frame.token !== fixture.config.token || frame.session !== 'default' || frame.pane !== 'w1:p1') { ws.close(1008); return; }
        ws.data.authenticated = true; ws.send('{"type":"ready"}');
        ws.send(new TextEncoder().encode('\u001b[?2004hAndroid isolated VT fixture\r\n'));
      }
      if (frame.type === 'ping' || frame.type === 'auth') {
        ws.send(JSON.stringify({ type: 'control', writable: fixture.control.state.owner === 'desktop', message: '手机对话正在控制，终端只读' }));
        ws.send('{"type":"pong"}');
      }
      if (frame.type === 'input' && fixture.control.state.owner === 'desktop' && typeof frame.data === 'string') terminalInput.push(frame.data);
    },
    close(ws) { ws.data.upstream?.close(); },
  },
});
const clientUrl = `http://127.0.0.1:${clientBridge.port}`;
fixture.config.origins.push(clientUrl);
// Only this isolated Unix socket and fake provider are ever used by the APK.
const inspector = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  switch (new URL(request.url).pathname) {
    case '/state': return Response.json({ owner: fixture.control.state.owner, runtimeId: fixture.control.state.runtimeId, requests: fixture.control.state.requests.length,
      model: fixture.control.state.model, effort: fixture.control.state.reasoningEffort, mode: fixture.control.state.mode, terminalInput, historyReads,
      layout: fixture.calls.filter(row => /^(workspace|tab|pane)\.(create|rename|split)$/.test(row.method)), focused: fixture.snapshot.focused_pane_id,
      providerInputs: fixture.frames.filter(frame => frame.method === 'fixture/turnOptions').map(frame => frame.params.input),
      queueSent: fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Android queued next turn').length,
      queueReplayed: fixture.control.state.messages.some(row => row.role === 'user' && row.text === 'Android held next turn'),
      sent: fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Android native message').length,
      replayed: fixture.control.state.messages.some(row => row.role === 'user' && row.text === 'Android offline draft') });
    case '/disconnect': await bridge.stop(true); return Response.json({ ok: true });
    case '/reconnect': bridge = createBridge(fixture.config); return Response.json({ ok: true });
    case '/reclaim': await nativeCall(fixture.control.record.endpoint, { method: 'desktop' }); return Response.json({ ok: true });
    case '/blocked': fixture.control.state.status = 'blocked'; fixture.control.changed(); return Response.json({ ok: true });
    case '/working': fixture.control.state.status = 'working'; fixture.control.changed(); return Response.json({ ok: true });
    case '/idle': await fixture.control.perform!({ action: 'stop', runtimeId: fixture.control.state.runtimeId, clientId: fixture.control.state.owner, epoch: fixture.control.state.epoch, requestId: 'android_inspector_idle' }); fixture.control.state.status = 'idle'; fixture.control.changed(); return Response.json({ ok: true });
    default: return new Response('Not found', { status: 404 });
  }
} });
await mkdir('artifacts/android/ui', { recursive: true });
try {
  await Bun.$`${adb} -s ${serial} reverse tcp:${clientBridge.port} tcp:${clientBridge.port}`.quiet();
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'uiautomator2==3.7.0', 'python', 'scripts/verify-android.py'], {
    env: { ...process.env, PATH: join(sdk, 'platform-tools') + ':' + process.env.PATH, MOBILE_HERDR_ANDROID_SERIAL: serial,
      MOBILE_HERDR_TEST_URL: clientUrl, MOBILE_HERDR_TEST_TOKEN: fixture.config.token,
      MOBILE_HERDR_TEST_INSPECTOR: `http://127.0.0.1:${inspector.port}`, MOBILE_HERDR_ANDROID_APK: resolve(process.env.MOBILE_HERDR_ANDROID_APK ?? 'artifacts/android/mobile-herdr.apk') },
    stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Android emulator verification failed.');
  if (fixture.control.state.runtimeId !== identity || fixture.control.state.owner !== 'desktop') throw new Error('Android did not preserve the runtime and return input to desktop.');
  if (process.env.MOBILE_HERDR_ANDROID_FILES_ONLY !== '1' && process.env.MOBILE_HERDR_ANDROID_INBOX_ONLY !== '1' && process.env.MOBILE_HERDR_ANDROID_DOWNLOAD_ONLY !== '1' && fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Android native message').length !== 1) throw new Error('Android prompt was lost or duplicated.');
} finally {
  await Bun.$`${adb} -s ${serial} reverse --remove tcp:${clientBridge.port}`.quiet().nothrow();
  inspector.stop(true); clientBridge.stop(true); await bridge.stop(true); await fixture.close();
}

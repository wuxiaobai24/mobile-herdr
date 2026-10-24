import { mkdir } from 'node:fs/promises';
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
await prepareProjectFiles(fixture);
fixture.control.message({ id: 'android-reading-question', role: 'user', text: 'Android reading question' });
fixture.control.message({ id: 'android-reading-answer', role: 'assistant', text: '# 安卓阅读\n\n共享主题与原生 Markdown。\n\n- **同一个会话**\n- 草稿和输入权保持隔离\n\n```ts\nconst client = "shared";\n```\n\n| 端 | UI |\n| --- | --- |\n| Web | React Native Web |\n| Android | React Native |\n\n' + '继续原来的开发任务。\n\n'.repeat(12) });
fixture.config.port = fixture.bridge.port!;
let bridge = fixture.bridge;
const identity = fixture.control.state.runtimeId;
const terminalInput: string[] = [];
// The APK uses a real WebView with a VT peer owned by this test, not a user PTY.
const clientBridge = Bun.serve<{ terminal: boolean; authenticated?: boolean; upstream?: WebSocket }>({
  hostname: '127.0.0.1', port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/api/watch' || url.pathname === '/api/terminal') {
      if (server.upgrade(request, { data: { terminal: url.pathname === '/api/terminal' } })) return;
      return new Response(null, { status: 426 });
    }
    if (url.pathname === '/api/update') return Response.json({ phase: 'idle', current: '0.2.2-beta.6', latest: '0.2.2-beta.7', available: true, supported: false, message: '有新版本可用。' });
    try { return await fetch(fixture.url + url.pathname + url.search, { method: request.method, headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() }); }
    catch { return new Response('Test bridge offline', { status: 503 }); }
  },
  websocket: {
    message(ws, bytes) {
      const frame = JSON.parse(String(bytes));
      if (!ws.data.terminal) {
        if (!ws.data.upstream) {
          if (frame.type !== 'auth') { ws.close(1008); return; }
          const upstream = new WebSocket(fixture.url.replace(/^http/, 'ws') + '/api/watch'); ws.data.upstream = upstream;
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
      model: fixture.control.state.model, effort: fixture.control.state.reasoningEffort, mode: fixture.control.state.mode, terminalInput,
      sent: fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Android native message').length,
      replayed: fixture.control.state.messages.some(row => row.role === 'user' && row.text === 'Android offline draft') });
    case '/disconnect': bridge.stop(true); return Response.json({ ok: true });
    case '/reconnect': bridge = createBridge(fixture.config); return Response.json({ ok: true });
    case '/reclaim': await nativeCall(fixture.control.record.endpoint, { method: 'desktop' }); return Response.json({ ok: true });
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
  if (process.env.MOBILE_HERDR_ANDROID_FILES_ONLY !== '1' && fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Android native message').length !== 1) throw new Error('Android prompt was lost or duplicated.');
} finally {
  await Bun.$`${adb} -s ${serial} reverse --remove tcp:${clientBridge.port}`.quiet().nothrow();
  inspector.stop(true); clientBridge.stop(true); bridge.stop(true); await fixture.close();
}

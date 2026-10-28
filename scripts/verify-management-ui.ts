import { mkdir } from 'node:fs/promises';
import { createNativeFixture } from '../tests/native-fixture';
const fixture = await createNativeFixture();
fixture.control.readHistory = undefined;
for (let i = 0; i < 260; i++) fixture.control.message({ id: `history-${i}`, role: i % 2 ? 'assistant' : 'user', text: `管理历史消息 ${i} · 原来的完整对话` });
const inspector = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  if (new URL(request.url).pathname === '/working') { fixture.control.state.status = 'working'; fixture.control.changed(); }
  return Response.json({ calls: fixture.calls.filter(row => /^(workspace|tab|pane)\.(create|rename|split)$/.test(row.method)), focused: fixture.snapshot.focused_pane_id, workspaces: fixture.snapshot.workspaces.length, tabs: fixture.snapshot.tabs.length, panes: fixture.snapshot.panes.length, runtimeId: fixture.control.state.runtimeId });
} });
await mkdir('artifacts/management-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-management-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token, MOBILE_HERDR_TEST_INSPECTOR: `http://127.0.0.1:${inspector.port}` }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Management/history UI verification failed.');
} finally { inspector.stop(true); await fixture.close(); }

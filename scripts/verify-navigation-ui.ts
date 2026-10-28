import { mkdir } from 'node:fs/promises';
import { createNativeFixture } from '../tests/native-fixture';
const fixture = await createNativeFixture(), remote = await createNativeFixture();
remote.config.name = '远程开发机'; remote.config.origins.push(fixture.url);
remote.snapshot.workspaces[0].label = 'remote-project'; remote.control.state.status = 'blocked';
const first = fixture.snapshot.panes[0];
for (let tab = 1; tab <= 10; tab++) {
  const tabId = `w1:t${tab}`;
  if (tab > 1) fixture.snapshot.tabs.push({ tab_id: tabId, workspace_id: 'w1', label: tab === 2 ? 'release 发布中文' : `任务 ${tab} 长标签页名称`, number: tab });
  for (let split = 1; split <= 2; split++) {
    if (tab === 1 && split === 1) continue;
    const paneId = `w1:p${(tab - 1) * 2 + split}`;
    fixture.snapshot.panes.push({ ...first, pane_id: paneId, terminal_id: 'navigation-' + paneId, tab_id: tabId, label: `任务 ${tab} 终端 ${split}`, agent: undefined, agent_session: undefined, agent_status: 'idle', focused: false });
  }
}
fixture.snapshot.panes.push({ ...fixture.snapshot.panes[2], pane_id: 'w3:p2', terminal_id: 'idle-sibling', label: '不该夹带的空闲任务', agent_status: 'idle' });
const inspector = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/working') { fixture.control.state.status = 'working'; fixture.control.changed(); }
  if (path === '/idle') {
    await fixture.control.perform!({ action: 'stop', clientId: fixture.control.state.owner, epoch: fixture.control.state.epoch, runtimeId: fixture.control.state.runtimeId, requestId: 'inspector_stop_idle' });
    fixture.control.state.status = 'idle'; fixture.control.changed();
  }
  if (path === '/complete') { const pane = fixture.snapshot.panes.find(row => row.pane_id === 'w2:p1')!; pane.agent_status = 'done'; }
  return Response.json({ users: fixture.control.state.messages.filter(row => row.role === 'user').map(row => row.text), writes: fixture.calls.filter(row => !['session.snapshot', 'pane.process_info'].includes(row.method)), focused: fixture.snapshot.focused_pane_id, runtimeId: fixture.control.state.runtimeId });
} });
await mkdir('artifacts/navigation-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-navigation-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token,
      MOBILE_HERDR_TEST_REMOTE_URL: remote.url, MOBILE_HERDR_TEST_REMOTE_TOKEN: remote.config.token, MOBILE_HERDR_TEST_INSPECTOR: `http://127.0.0.1:${inspector.port}` }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Navigation/inbox/queue verification failed.');
} finally { inspector.stop(true); await fixture.close(); await remote.close(); }

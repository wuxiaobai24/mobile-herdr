import { mkdir } from 'node:fs/promises';
import { createSshUiFixture } from '../tests/ssh-ui-fixture';

const fixture = await createSshUiFixture();
await mkdir('artifacts/ssh-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-ssh-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('SSH machine browser verification failed.');
  if (fixture.remote.control.state.messages.filter(row => row.role === 'user' && row.text === '从手机继续远程任务').length !== 1) throw new Error('Remote prompt was lost or duplicated.');
  if (fixture.remote.control.state.messages.some(row => row.role === 'user' && row.text === 'SSH 断线保留的草稿')) throw new Error('Draft was replayed during reconnect.');
  if (fixture.remote.control.state.owner !== 'desktop') throw new Error('Remote input was not returned to desktop.');
} finally { await fixture.close(); }

import { appendFile, mkdir } from 'node:fs/promises';
import { createFixture } from '../tests/fixture';

const fixture = await createFixture();
fixture.snapshot.workspaces[0].label = 'feature-mobile-session-switch';
fixture.snapshot.panes[0].agent_status = 'working';
await appendFile(fixture.transcript, JSON.stringify({ type: 'message', id: 'mobile-layout-reply', message: { role: 'assistant', content: [{ type: 'text', text: '日志已添加。现在开始编译项目。\n\n编译完成后，我会继续检查测试结果，并保留当前会话。' }] } }) + '\n');
await mkdir('artifacts/mobile-layout', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-mobile-layout.py', ...process.argv.slice(2)], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Mobile layout verification failed.');
} finally { await fixture.close(); }

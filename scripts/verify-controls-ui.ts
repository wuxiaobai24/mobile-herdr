import { mkdir } from 'node:fs/promises';
import { createNativeFixture } from '../tests/native-fixture';
import { prepareProjectFiles } from '../tests/file-fixture';

const fixture = await createNativeFixture();
fixture.control.readHistory = undefined;
await prepareProjectFiles(fixture);
fixture.setScreen(Array.from({ length: 250 }, (_, i) => `Terminal history ${i}`).join('\n'));
for (let i = 0; i < 180; i++) fixture.control.message({ id: `controls-${i}`, role: i % 2 ? 'assistant' : 'user', text: `阅读消息 ${i} · 同一个会话` });
fixture.control.message({ id: 'ui-command', role: 'tool', toolName: 'exec_command', text: '{"cmd":"bun run typecheck"}', output: 'Typecheck passed', toolStatus: 'completed', durationMs: 1200, exitCode: 0 });
fixture.control.message({ id: 'ui-image', role: 'assistant', text: '布局截图\n\n![项目截图](preview.png)' });
const inspector = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
  return Response.json({ model: fixture.control.state.model, effort: fixture.control.state.reasoningEffort,
    owner: fixture.control.state.owner, status: fixture.control.state.status,
    sent: fixture.control.state.messages.filter(row => row.role === 'user' && row.text === 'Controls native message').length,
    skillInputs: fixture.frames.filter(frame => frame.method === 'fixture/turnOptions').map(frame => frame.params.input),
    slashPrompts: fixture.control.state.messages.filter(row => row.role === 'user' && row.text.startsWith('/')).length });
} });
await mkdir('artifacts/controls-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-controls-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token,
      MOBILE_HERDR_TEST_INSPECTOR: `http://127.0.0.1:${inspector.port}` }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Mobile controls verification failed.');
} finally { inspector.stop(true); await fixture.close(); }

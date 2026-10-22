import { mkdir } from 'node:fs/promises';
import { createNativeFixture } from '../tests/native-fixture';
const fixture = await createNativeFixture();
fixture.control.readHistory = undefined;
for (let i = 0; i < 240; i++) fixture.control.message({ id: `history-${i}`, role: i % 2 ? 'assistant' : 'user', text: `历史消息 ${String(i).padStart(3, '0')} · 保留同一个会话` });
const patch = '--- a/app/card.ts\n+++ b/app/card.ts\n@@ -1,2 +1,2 @@\n-const color = "green";\n+const color = "blue";\n export default color;\n';
fixture.control.message({ id: 'diff-message', role: 'assistant', text: '卡片颜色已调整：\n\n```diff\n' + patch + '```' });
fixture.setScreen(Array.from({ length: 400 }, (_, i) => `terminal-line-${String(i).padStart(3, '0')} preserved output`).join('\n'));
await mkdir('artifacts/experience-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-experience-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Experience UI checks failed.');
} finally { await fixture.close(); }

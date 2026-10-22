import { mkdir } from 'node:fs/promises';
import { createFixture } from '../tests/fixture';
const fixture = await createFixture();
fixture.setScreen(Array.from({ length: 400 }, (_, i) => `history-${String(i + 1).padStart(3, '0')}  终端输出 · preserved line${i === 199 ? ' /workspace/mobile-herdr/packages/terminal/history/very-long-output-that-must-remain-horizontally-scrollable.log' : ''}`).join('\n'));
await mkdir('artifacts/appearance-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-appearance-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Appearance/terminal UI checks failed.');
  const reads = fixture.calls.filter(c => c.method === 'pane.read');
  if (!reads.length || reads.some(c => c.params.pane_id !== 'w1:p1' || c.params.lines !== 2000)) throw new Error('History must read the selected pane only.');
} finally { await fixture.close(); }

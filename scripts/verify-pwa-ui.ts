import { mkdir } from 'node:fs/promises';
import { createFixture } from '../tests/fixture';
const fixture = await createFixture();
await mkdir('artifacts/pwa-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-pwa-ui.py'], { env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('PWA browser checks failed.');
  if (fixture.calls.some(row => row.method === 'agent.prompt')) throw new Error('Offline draft was replayed.');
} finally { await fixture.close(); }

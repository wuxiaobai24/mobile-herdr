import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createFixture } from '../tests/fixture';

const fixture = await createFixture();
fixture.config.token = randomBytes(4).toString('hex');
await mkdir('artifacts/ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token },
    stdout: 'inherit', stderr: 'inherit',
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Browser verification failed (${code}).`);
} finally { await fixture.close(); }

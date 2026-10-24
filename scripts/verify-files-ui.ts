import { mkdir } from 'node:fs/promises';
import { createFixture } from '../tests/fixture';
import { prepareProjectFiles } from '../tests/file-fixture';
const fixture = await createFixture();
await prepareProjectFiles(fixture);
await mkdir('artifacts/files-update/ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-files-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Files and update UI verification failed.');
} finally { await fixture.close(); }

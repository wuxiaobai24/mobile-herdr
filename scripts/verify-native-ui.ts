import { mkdir } from 'node:fs/promises';
import { createNativeFixture } from '../tests/native-fixture';

const fixture = await createNativeFixture();
await mkdir('artifacts/native-ui', { recursive: true });
try {
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-native-ui.py'], {
    env: { ...process.env, MOBILE_HERDR_TEST_URL: fixture.url, MOBILE_HERDR_TEST_TOKEN: fixture.config.token }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error('Native mobile browser verification failed.');
  if (fixture.control.state.messages.filter(row => row.role === 'user' && row.text === '断线结果验证').length !== 1) throw new Error('Ambiguous send was duplicated.');
  if (fixture.control.state.owner !== 'desktop') throw new Error('Control did not return to desktop.');
  const before = fixture.control.state.runtimeId;
  const reply = await fixture.desktopCall('turn/steer', { input: [{ type: 'text', text: '电脑继续开发' }] });
  if (reply.error || fixture.control.state.runtimeId !== before) throw new Error('Desktop could not continue the same runtime.');
} finally { await fixture.close(); }

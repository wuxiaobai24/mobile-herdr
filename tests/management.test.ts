import { expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createFixture } from './fixture';
import { managedRequest, type ManagedRecord } from '../server/management';
test('background lifecycle manages only its own bridge and never trusts a PID file as signal authority', async () => {
  const fixture = await createFixture();
  const state = join(fixture.directory, 'managed-state'); await mkdir(state);
  const env = { ...process.env, MOBILE_HERDR_STATE: state, MOBILE_HERDR_PORT: '0', MOBILE_HERDR_HOST: '127.0.0.1', MOBILE_HERDR_SOCKET: fixture.config.socket, HERDR_SOCKET: fixture.config.socket, MOBILE_HERDR_SSH_DISCOVERY: '0', MOBILE_HERDR_TOKEN: 'isolated-background-fixture-only-token' };
  const file = join(state, 'bridge.json'); let record: ManagedRecord | undefined;
  async function command(action: string) {
    const child = Bun.spawn([process.execPath, resolve('scripts/bridge.ts'), action, '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err, code };
  }
  try {
    expect(JSON.parse((await command('status')).out).running).toBe(false);
    const started = await command('start'); expect(started.code).toBe(0);
    const value = JSON.parse(started.out); expect(value.running).toBe(true);
    record = JSON.parse(await readFile(file, 'utf8')); expect(started.out).not.toContain(record!.nonce); expect(started.out).not.toContain(env.MOBILE_HERDR_TOKEN);
    expect(JSON.parse((await command('start')).out).pid).toBe(value.pid);
    const diagnostic = await fetch(value.url + '/api/diagnostics', { headers: { Authorization: `Bearer ${env.MOBILE_HERDR_TOKEN}` } }).then(r => r.json()); expect(diagnostic.managed).toBe(true);
    await writeFile(file, JSON.stringify({ ...record, pid: process.pid, nonce: 'invalid-nonce' }), { mode: 0o600 });
    expect((await command('stop')).code).toBe(1); expect((await managedRequest(record!, 'status')).running).toBe(true);
    await writeFile(file, JSON.stringify(record), { mode: 0o600 });
    expect((await command('stop')).code).toBe(0);
    for (let i = 0; i < 100 && JSON.parse((await command('status')).out).running; i++) await Bun.sleep(30);
    expect(JSON.parse((await command('status')).out).running).toBe(false);
    const existing = await fetch(fixture.url + '/api/info', { headers: { Authorization: `Bearer ${fixture.config.token}` } }); expect(existing.ok).toBe(true);
  } finally {
    if (record) await managedRequest(record, 'stop').catch(() => {});
    await fixture.close();
  }
}, 15000);

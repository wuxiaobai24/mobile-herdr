import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { savedToken, saveToken, validateToken } from '../server/auth-token';

test('custom tokens are validated before atomic replacement and retain private permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mhr-token-'));
  try {
    const generated = await savedToken(directory); expect(generated.length).toBeGreaterThanOrEqual(24);
    expect(await savedToken(directory)).toBe(generated);
    const custom = randomBytes(32).toString('base64url'); await saveToken(directory, custom);
    expect(await savedToken(directory)).toBe(custom); expect((await stat(join(directory, 'token'))).mode & 0o777).toBe(0o600);
    for (const value of ['', 'short', 'x'.repeat(24) + '\nInjected', ' '.repeat(24), 'x'.repeat(4097)]) expect(() => validateToken(value)).toThrow();
    await expect(saveToken(directory, 'invalid')).rejects.toThrow(); expect(await savedToken(directory)).toBe(custom);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('token CLI keeps secrets out of output and rejects argument exposure and empty environment values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mhr-token-cli-'));
  const env: NodeJS.ProcessEnv = { ...process.env, MOBILE_HERDR_STATE: directory }; delete env.MOBILE_HERDR_TOKEN;
  async function cli(args: string[], input = '', custom = env) {
    const child = Bun.spawn([process.execPath, resolve('scripts/token.ts'), ...args], { env: custom, stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe' });
    return { code: await child.exited, text: await new Response(child.stdout).text() + await new Response(child.stderr).text() };
  }
  try {
    const secret = randomBytes(32).toString('base64url');
    const result = await cli(['set', '--stdin'], secret + '\n');
    expect(result.code).toBe(0); expect(result.text).not.toContain(secret); expect(await savedToken(directory)).toBe(secret);
    const rejected = await cli(['set', secret]); expect(rejected.code).toBe(1); expect(rejected.text).not.toContain(secret);
    const invalid = await cli(['set', '--stdin'], 'short\n'); expect(invalid.code).toBe(1); expect(await savedToken(directory)).toBe(secret);
    const overridden = await cli(['status'], '', { ...env, MOBILE_HERDR_TOKEN: secret }); expect(overridden.text).toContain('环境变量'); expect(overridden.text).not.toContain(secret);
    expect((await cli(['status'], '', { ...env, MOBILE_HERDR_TOKEN: '' })).code).toBe(1);
    expect((await readFile(join(directory, 'token'), 'utf8')).trim()).toBe(secret);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

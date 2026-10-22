import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isValidToken } from '../shared/auth';

export function stateDirectory(): string { return process.env.MOBILE_HERDR_STATE ?? join(homedir(), '.local/state/mobile-herdr'); }
export function validateToken(token: string): string {
  if (!isValidToken(token)) throw new Error('连接密钥需要 8–4096 个非空白 ASCII 字符。');
  return token;
}
export async function savedToken(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'token');
  try { await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { await writeFile(path, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  await chmod(path, 0o600);
  return validateToken((await readFile(path, 'utf8')).trim());
}
export async function saveToken(directory: string, value: string): Promise<void> {
  validateToken(value);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, '.token-' + randomBytes(12).toString('hex'));
  try {
    await writeFile(temporary, value + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, 'token'));
  } finally { await rm(temporary, { force: true }); }
}

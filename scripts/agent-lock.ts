import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeIdentity } from '../server/native/controller';

export function launchLockPath(directory: string, identity: NativeIdentity): string {
  const key = createHash('sha256').update(identity.herdrSocket + '\0' + identity.terminalId).digest('hex').slice(0, 32);
  return join(directory, `launch-${key}.lock`);
}

export async function launchLockState(path: string): Promise<{ pid: number; alive: boolean } | undefined> {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return;
  const value = JSON.parse(raw);
  if (!Number.isInteger(value.pid) || value.pid <= 0) throw new Error('启动锁无效，未自动移除。');
  try { process.kill(value.pid, 0); return { pid: value.pid, alive: true }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    return { pid: value.pid, alive: false };
  }
}

export async function acquireLaunchLock(path: string): Promise<() => Promise<void>> {
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('此 pane 已有启动器运行，或上次异常退出。请运行 mherdr doctor 检查；确认过期后用 mherdr doctor --clear-stale-lock 清理。');
  }
  try { await file.writeFile(JSON.stringify({ pid: process.pid })); }
  catch (error) { await file.close(); await unlink(path); throw error; }
  const own = await file.stat();
  return async () => {
    const current = await stat(path).catch(() => undefined);
    if (current?.ino === own.ino && current.dev === own.dev) await unlink(path);
    await file.close();
  };
}

/** Explicit recovery only. Serialize cleaners so one cannot unlink a replacement lock. */
export async function clearStaleLaunchLock(path: string): Promise<boolean> {
  const guard = path + '.repair';
  try { await mkdir(guard, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    const state = await launchLockState(path);
    if (!state) return false;
    if (state.alive) throw new Error('启动器仍在运行，不能清理它的锁。');
    await unlink(path); return true;
  } finally { await rmdir(guard); }
}

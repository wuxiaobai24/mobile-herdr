import { spawn } from 'node:child_process';
import { mkdtemp, chmod, open, readFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { managedRequest, type ManagedRecord } from '../server/management';
import { version } from '../package.json';
const [action = 'help', ...args] = process.argv.slice(2);
const stateDir = process.env.MOBILE_HERDR_STATE ?? join(homedir(), '.local/state/mobile-herdr');
const recordPath = join(stateDir, 'bridge.json');
async function record(): Promise<ManagedRecord | undefined> {
  const mode = await stat(recordPath).catch(() => null);
  if (!mode?.isFile() || mode.mode & 0o077 || mode.uid !== process.getuid?.()) return;
  return readFile(recordPath, 'utf8').then(JSON.parse).catch(() => undefined);
}
async function status() {
  const saved = await record();
  if (!saved) return { running: false };
  return managedRequest(saved, 'status').catch(() => ({ running: false }));
}
async function start(): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lock = join(stateDir, 'bridge-start.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch { throw new Error('另一个启动命令正在运行；确认它已退出后可移除 bridge-start.lock 再试。'); }
  let child: ReturnType<typeof spawn> | undefined, directory: string | undefined;
  try {
    const current = await status(); if (current.running) { print(current); return; }
    directory = await mkdtemp(join(tmpdir(), 'mhb-')); await chmod(directory, 0o700);
    const nonce = randomBytes(24).toString('hex');
    const log = await open(join(stateDir, 'bridge.log'), 'a', 0o600); await log.chmod(0o600);
    try {
      child = spawn(process.execPath, ['run', resolve(import.meta.dir, '../server/index.ts')], { detached: true, stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, MOBILE_HERDR_MANAGED_NONCE: nonce, MOBILE_HERDR_CONTROL_DIR: directory } });
    } finally { await log.close(); }
    child.on('error', () => {}); child.unref();
    for (let i = 0; i < 150; i++) {
      const saved = await record();
      if (saved?.nonce === nonce) { const current = await managedRequest(saved, 'status'); print(current); return; }
      if (child.exitCode !== null || child.signalCode) break;
      await Bun.sleep(50);
    }
    // This child was created by this invocation; no Herdr or existing bridge is signaled.
    child.kill('SIGTERM'); throw new Error('后台 bridge 启动失败。请检查端口占用或本机 bridge.log；日志不会自动上传。');
  } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
  finally { await rm(lock, { recursive: true, force: true }); }
}
function print(value: unknown): void { console.log(JSON.stringify(value, null, args.includes('--json') ? undefined : 2)); }
try {
  if (['help', '--help', '-h'].includes(action)) console.log(`Mobile Herdr ${version}\nservice start | status [--json] | stop\n只管理此 state 目录下由本命令启动的 Web bridge；不停止 Herdr 或 agent。`);
  else if (['start', 'background'].includes(action)) await start();
  else if (action === 'status') print(await status());
  else if (action === 'stop') {
    const saved = await record();
    if (!saved) print({ running: false });
    else {
      const result = await managedRequest(saved, 'stop');
      let stopped = false;
      for (let i = 0; i < 100; i++) {
        if (!(await managedRequest(saved, 'status').catch(() => ({ running: false }))).running) { stopped = true; break; }
        await Bun.sleep(50);
      }
      if (!stopped) throw new Error('停止请求已提交，后台仍在收尾。请稍后运行 status 检查。');
      print(result);
    }
  }
  else throw new Error('不支持的命令，请使用 start、status 或 stop。');
} catch (error) { console.error(error instanceof Error ? error.message : '后台管理失败。'); process.exitCode = 1; }

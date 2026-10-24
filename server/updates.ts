import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile, readlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { managedRequest, type ManagedRecord } from './management';
import { version } from '../package.json';

const REPOSITORY = 'wuxiaobai24/mobile-herdr';
export interface Release { version: string; tag: string }
export interface UpdateState { id?: string; phase: 'idle' | 'installing' | 'restarting' | 'ready' | 'failed'; message: string; current: string; latest?: string; available: boolean; supported: boolean; startedAt?: number }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/;
export function compareVersions(a: string, b: string): number {
  const left = VERSION.exec(a), right = VERSION.exec(b);
  if (!left || !right) throw new Error('版本格式无效。');
  for (let i = 1; i <= 3; i++) { const difference = Number(left[i]) - Number(right[i]); if (difference) return difference; }
  if (!left[4] || !right[4]) return left[4] ? -1 : right[4] ? 1 : 0;
  const x = left[4].split('.'), y = right[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const numericX = /^\d+$/.test(x[i]), numericY = /^\d+$/.test(y[i]);
    if (numericX && numericY) return Number(x[i]) - Number(y[i]);
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
export function selectRelease(rows: any[], current = version): Release | undefined {
  const releases = rows.filter(row => !row.draft && typeof row.tag_name === 'string' && row.tag_name.startsWith('v') && VERSION.test(row.tag_name.replace(/^v/, '')) && (current.includes('-') || !row.prerelease)).filter(row => {
    const name = 'mobile-herdr-' + row.tag_name.replace(/^v/, '') + '.tar.gz';
    return [name, name + '.sha256'].every(name => row.assets?.some((asset: any) => asset.name === name && asset.browser_download_url === `https://github.com/${REPOSITORY}/releases/download/${row.tag_name}/${name}`));
  }).map(row => ({ version: row.tag_name.replace(/^v/, ''), tag: row.tag_name }));
  return releases.sort((a, b) => compareVersions(b.version, a.version))[0];
}
let catalog: { at: number; channel: boolean; promise: Promise<Release> } | undefined;
export function latestRelease(current = version): Promise<Release> {
  const channel = current.includes('-');
  if (catalog && catalog.channel === channel && Date.now() - catalog.at < 60000) return catalog.promise;
  const promise = (async () => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mobile-Herdr-Updater' }, signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error(`无法检查 GitHub release（${response.status}），请稍后重试。`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Release 响应无效。');
    const release = selectRelease(rows, current);
    if (!release) throw new Error('没有找到完整的发布包与校验文件。');
    return release;
  })();
  catalog = { at: Date.now(), channel, promise }; return promise;
}
async function managed(stateDir: string): Promise<ManagedRecord | undefined> {
  const path = join(stateDir, 'bridge.json'), info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.mode & 0o077 || info.uid !== process.getuid?.()) return;
  return readFile(path, 'utf8').then(JSON.parse).catch(() => undefined);
}
export async function updateStatus(stateDir: string, dependencies: { latest?: (current: string) => Promise<Release> } = {}): Promise<UpdateState> {
  const saved = await readFile(join(stateDir, 'update.json'), 'utf8').then(JSON.parse).catch(() => null) as UpdateState | null;
  const record = await managed(stateDir);
  const runtime = record && await managedRequest(record, 'status').catch(() => undefined);
  const current = runtime?.running && runtime.version ? runtime.version : version;
  const supported = !!runtime?.running && !!record?.restart;
  const active = saved && ['installing', 'restarting'].includes(saved.phase);
  const latest = await (dependencies.latest ?? latestRelease)(current).catch(error => { if (active) return undefined; throw error; });
  const available = !!latest && compareVersions(latest.version, current) > 0;
  const base = { current, supported, latest: latest?.version ?? saved?.latest, available };
  if (active) {
    const worker = await readFile(join(stateDir, 'update-worker.json'), 'utf8').then(JSON.parse).catch(() => null);
    const missing = worker?.id !== saved.id || !Number.isInteger(worker.pid);
    if (missing ? Date.now() - (saved.startedAt ?? 0) > 10000 : !alive(worker.pid)) {
      return { ...saved, ...base, phase: 'failed', message: '上次更新进程已中断。请检查当前版本后重试。' };
    }
    return { ...saved, ...base };
  }
  if (saved?.phase === 'failed' && available && saved.latest === latest?.version) return { ...saved, ...base };
  const ready = saved?.phase === 'ready' && !available && saved.latest === current;
  return { ...base, phase: ready ? 'ready' : 'idle', message: available ? '有新版本可用。' : '当前已是最新版本。' };
}
async function save(stateDir: string, state: UpdateState): Promise<void> {
  const path = join(stateDir, 'update.json'), temporary = path + '.' + process.pid;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await rename(temporary, path);
}
const starts = new Map<string, Promise<UpdateState>>();
export function startUpdate(root: string, stateDir: string, expectedPid: number): Promise<UpdateState> {
  const existing = starts.get(stateDir); if (existing) return existing;
  const promise = startUpdateOnce(root, stateDir, expectedPid); starts.set(stateDir, promise);
  void promise.finally(() => { if (starts.get(stateDir) === promise) starts.delete(stateDir); }).catch(() => {}); return promise;
}
async function startUpdateOnce(root: string, stateDir: string, expectedPid: number): Promise<UpdateState> {
  const record = await managed(stateDir);
  if (!record || record.pid !== expectedPid || !record.restart || !(await managedRequest(record, 'status')).running) throw new Error('当前 bridge 未由服务命令管理。请先用 mobile-herdr background 启动，才能在页面内更新。');
  const state = await updateStatus(stateDir);
  if (['installing', 'restarting'].includes(state.phase) || !state.available) return state;
  const result: UpdateState = { ...state, id: randomUUID(), phase: 'installing', startedAt: Date.now(), message: '正在下载并校验最新版本…' };
  // Serialize starts before detaching; the updater also owns an installation lock.
  await save(stateDir, result);
  const child = spawn(process.execPath, ['run', join(root, 'scripts/update.ts'), '--background', result.id!, String(expectedPid)], { detached: true, stdio: 'ignore', env: { ...process.env, MOBILE_HERDR_STATE: stateDir } });
  if (child.pid) await writeFile(join(stateDir, 'update-worker.json'), JSON.stringify({ id: result.id, pid: child.pid }), { mode: 0o600 });
  child.on('error', () => { void save(stateDir, { ...result, phase: 'failed', message: '无法启动更新进程。' }); }); child.unref(); return result;
}
async function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = Bun.spawn(args, { env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  if (await child.exited !== 0) throw new Error('更新命令执行失败，原版本已保留。');
}
export async function performUpdate(root: string, stateDir: string, id: string, expectedPid: number, dependencies: { latest?: () => Promise<Release>; run?: typeof run } = {}): Promise<void> {
  const lock = join(stateDir, 'update.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await lstat(lock), owner = await readFile(join(lock, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || !Number.isInteger(owner?.pid) || alive(owner.pid)) throw new Error('已有更新在执行。');
    await rm(lock, { recursive: true }); await mkdir(lock, { mode: 0o700 });
  }
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  let state = await readFile(join(stateDir, 'update.json'), 'utf8').then(JSON.parse) as UpdateState;
  let previous: ManagedRecord | undefined, stopped = false;
  const nextNonce = randomBytes(24).toString('hex');
  const metadata = await readFile(join(root, '.installation.json'), 'utf8').then(JSON.parse).catch(() => undefined);
  const prefix = metadata?.prefix ?? process.env.MOBILE_HERDR_INSTALL_DIR ?? join(homedir(), '.local/share/mobile-herdr');
  const binDir = metadata?.binDir ?? process.env.MOBILE_HERDR_BIN_DIR ?? join(homedir(), '.local/bin');
  const link = join(prefix, 'current');
  const linkInfo = await lstat(link).catch(() => undefined);
  if (linkInfo && !linkInfo.isSymbolicLink()) { await rm(lock, { recursive: true, force: true }); await save(stateDir, { ...state, phase: 'failed', message: '安装目标 current 不是版本链接，未覆盖。' }); return; }
  const oldLink = await readlink(link).catch(() => undefined);
  const wrappers = await Promise.all(['mherdr', 'mobile-herdr'].map(async name => ({ path: join(binDir, name), content: await readFile(join(binDir, name)).catch(() => undefined) })));
  try {
    if (state.id !== id || state.phase !== 'installing') throw new Error('更新任务身份已变化。');
    previous = await managed(stateDir);
    if (!previous || previous.pid !== expectedPid || !previous.restart || !(await managedRequest(previous, 'status')).running) throw new Error('原 bridge 身份已变化，更新已停止。');
    const runtime = await managedRequest(previous, 'status');
    if (runtime.version !== state.current) throw new Error('运行版本已变化，请重新检查更新。');
    const latest = await (dependencies.latest ?? (() => latestRelease(state.current)))();
    if (latest.version !== state.latest || compareVersions(latest.version, runtime.version!) <= 0) throw new Error('发布版本发生变化，请重新检查更新。');
    const env: NodeJS.ProcessEnv = { ...process.env, ...previous.restart, MOBILE_HERDR_BUN: process.execPath };
    delete env.MOBILE_HERDR_MANAGED_NONCE; delete env.MOBILE_HERDR_CONTROL_DIR;
    await (dependencies.run ?? run)(['bash', join(root, 'install.sh'), '--version', latest.version, '--prefix', prefix, '--bin-dir', binDir, '--no-install-bun'], env);
    const destination = await readlink(link);
    state = { ...state, phase: 'restarting', message: '校验完成，正在切换 Web bridge；agent 继续运行…' }; await save(stateDir, state);
    await managedRequest(previous, 'stop'); stopped = true;
    for (let i = 0; i < 100; i++) { if (!(await managedRequest(previous, 'status').catch(() => ({ running: false }))).running) break; await Bun.sleep(100); }
    await (dependencies.run ?? run)([process.execPath, 'run', join(destination, 'scripts/bridge.ts'), 'start'], { ...env, MOBILE_HERDR_NEXT_NONCE: nextNonce });
    const next = await managed(stateDir);
    if (!next || next.nonce !== nextNonce || (await managedRequest(next, 'status')).version !== latest.version) throw new Error('新版本没有通过启动检查。');
    const health = await fetch(next.url + '/api/info', { headers: { Authorization: 'Bearer ' + previous.restart.MOBILE_HERDR_TOKEN }, signal: AbortSignal.timeout(5000) });
    if (!health.ok || (await health.json() as {version:string}).version !== latest.version) throw new Error('新版本健康检查失败。');
    await save(stateDir, { ...state, phase: 'ready', message: '更新完成，页面将加载新版本。', current: latest.version, available: false });
  } catch (error) {
    let rollback = '原 bridge 继续运行。';
    try {
      const fs = await import('node:fs/promises');
      if (oldLink) { const temporary = join(prefix, '.rollback-' + id); await fs.symlink(oldLink, temporary); await rename(temporary, link); } else await rm(link, { force: true });
      for (const wrapper of wrappers) { if (wrapper.content) await writeFile(wrapper.path, wrapper.content, { mode: 0o755 }); else await rm(wrapper.path, { force: true }); }
      if (stopped && previous?.restart) {
        const next = await managed(stateDir);
        if (next && next.nonce === nextNonce) await managedRequest(next, 'stop').catch(() => {});
        else if (next && next.nonce !== previous.nonce && (await managedRequest(next, 'status').catch(() => ({running:false}))).running) throw new Error('Another bridge replaced this update attempt.');
        await Bun.sleep(200);
        const env: NodeJS.ProcessEnv = { ...process.env, ...previous.restart }; delete env.MOBILE_HERDR_MANAGED_NONCE; delete env.MOBILE_HERDR_CONTROL_DIR;
        await (dependencies.run ?? run)([process.execPath, 'run', join(root, 'scripts/bridge.ts'), 'start'], env);
        rollback = '已回滚到原版本。';
      }
    } catch { rollback = '自动恢复未确认，请在开发机检查 mobile-herdr status。'; }
    await save(stateDir, { ...state, phase: 'failed', message: `${error instanceof Error ? error.message : '更新失败。'} ${rollback}` });
  } finally { await rm(lock, { recursive: true, force: true }); }
}

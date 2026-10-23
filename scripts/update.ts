import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { performUpdate, startUpdate, updateStatus } from '../server/updates';
const root = resolve(import.meta.dir, '..'), stateDir = process.env.MOBILE_HERDR_STATE ?? join(homedir(), '.local/state/mobile-herdr');
const [action, id, pid] = process.argv.slice(2);
try {
  if (action === '--background' && id && /^\d+$/.test(pid ?? '')) await performUpdate(root, stateDir, id, Number(pid));
  else if (action === '--check') console.log(JSON.stringify(await updateStatus(stateDir)));
  else if (!action) {
    const record = JSON.parse(await readFile(join(stateDir, 'bridge.json'), 'utf8'));
    const state = await startUpdate(root, stateDir, record.pid);
    console.log(state.message);
    console.log('可运行 mobile-herdr update --check 查看结果；运行中的 agent 保持连接。');
  } else throw new Error('用法：mobile-herdr update [--check]');
} catch (error) { console.error(error instanceof Error ? error.message : '更新失败。'); process.exitCode = 1; }

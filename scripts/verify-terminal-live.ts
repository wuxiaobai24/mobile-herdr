import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../server/server';
import { loadConfig } from '../server/config';
import { rpc } from '../server/rpc';
import type { Pane } from '../shared/protocol';
const directory = await mkdtemp(join(tmpdir(), 'mh-terminal-'));
const name = 'mobile-terminal-test-' + Date.now(), sessionDirectory = join(homedir(), '.config/herdr/sessions', name), socket = join(sessionDirectory, 'herdr.sock');
const herdr = Bun.spawn(['herdr', '--session', name, 'server'], { stdout: 'ignore', stderr: 'ignore' });
const config = { ...await loadConfig({ token: 'terminal-isolated-test-key-12345678' }), socket, port: 0, stateDir: directory };
const bridge = createBridge(config);
try {
  for (let i = 0; ; i++) { try { await rpc(socket, 'ping'); break; } catch { if (i >= 100) throw new Error('Test session failed.'); await Bun.sleep(100); } }
  const { root_pane: pane } = await rpc<{ root_pane: Pane }>(socket, 'workspace.create', { cwd: directory, label: 'owned-terminal-test', focus: false });
  await mkdir('artifacts/terminal-live', { recursive: true });
  const child = Bun.spawn(['uv', 'run', '--python', '3.12', '--with', 'playwright==1.60.0', 'python', 'scripts/verify-terminal-live.py'], { env: { ...process.env, MOBILE_HERDR_TEST_URL: `http://127.0.0.1:${bridge.port}`, MOBILE_HERDR_TEST_TOKEN: config.token }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Live terminal browser verification failed.');
  const screen = await rpc<{ read: {text:string} }>(socket, 'pane.read', { pane_id: pane.pane_id, source: 'recent_unwrapped', lines: 80, strip_ansi: true });
  if (!screen.read.text.includes('TERMINAL_BROWSER_VERIFIED')) throw new Error('Browser input did not reach the original PTY.');
  console.log('Real Herdr PTY: browser keyboard and shortcut input reached the owned original terminal.');
} finally { bridge.stop(true); await rpc(socket, 'server.stop').catch(() => herdr.kill()); await herdr.exited; await rm(directory, { recursive: true, force: true }); await rm(sessionDirectory, { recursive: true, force: true }); }

import { materializeNativeAssets, type NativeAssets } from './native/assets';
import { chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';
import { createBridge } from './server';
import { rpc } from './rpc';

export async function startSshWorker(input: { socket?: string; token: string; session: string; assets: NativeAssets }): Promise<void> {
  try {
    const [major, minor] = Bun.version.split('.').map(Number);
    if (major < 1 || major === 1 && minor < 4) { console.error('MOBILE_HERDR_BUN_MISSING'); process.exitCode = 1; return; }
    const herdr = Bun.which('herdr') ?? join(homedir(), '.local/bin/herdr');
    const child = Bun.spawn([herdr, ...(input.session === 'default' ? [] : ['--session', input.session]), 'status', 'server', '--json'], { stdout: 'pipe', stderr: 'ignore' });
    const timeout = setTimeout(() => child.kill(), 8000);
    let status: { running?: boolean; socket?: string };
    try { status = JSON.parse(await new Response(child.stdout).text()); if (await child.exited !== 0) throw new Error('Herdr status unavailable.'); }
    finally { clearTimeout(timeout); }
    if (!status.running || !status.socket) throw new Error('Herdr is not running.');
    const snapshot = await rpc<{ snapshot: { protocol: number } }>(status.socket, 'session.snapshot');
    if (snapshot.snapshot.protocol !== 22) throw new Error('Unsupported protocol.');
    // Preserve the remote native registry location; the gateway credential is temporary.
    const config = { ...await loadConfig({ token: input.token }), socket: status.socket, host: '127.0.0.1', port: 0, origins: [] };
    const runtimeRoot = await materializeNativeAssets(config.stateDir, input.assets);
    let lastActivity = Date.now();
    const bridge = createBridge(config, { runtimeRoot, unix: input.socket, onActivity: () => { lastActivity = Date.now(); } });
    if (input.socket) await chmod(input.socket, 0o600);
    let stopping = false;
    async function stop(): Promise<void> {
      if (stopping) return; stopping = true;
      clearInterval(idle); bridge.stop(true); if (input.socket) await unlink(input.socket).catch(() => {}); process.exit(0);
    }
    const idle = setInterval(() => { if (Date.now() - lastActivity > 35000) void stop(); }, 5000);
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => void stop());
    console.log(JSON.stringify({ type: 'mobile-herdr-ssh-ready', ...(input.socket ? {} : { port: bridge.port }) }));
  } catch { console.error('MOBILE_HERDR_REMOTE_UNAVAILABLE'); process.exitCode = 1; }
}

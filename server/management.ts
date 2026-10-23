import { createServer, createConnection, type Socket } from 'node:net';
import { chmod, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BridgeConfig } from './config';
import { version } from '../package.json';
export interface ManagedRecord { nonce: string; socket: string; directory: string; pid: number; url: string; startedAt: string; restart?: Record<string, string> }
export async function managedRequest(record: ManagedRecord, action: 'status' | 'stop'): Promise<{ running: boolean; version?: string; pid?: number; url?: string; startedAt?: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(record.socket); let buffer = '';
    socket.setEncoding('utf8'); socket.setTimeout(2500, () => { socket.destroy(); reject(new Error('后台 bridge 没有响应。')); });
    socket.on('error', reject); socket.on('connect', () => socket.write(JSON.stringify({ nonce: record.nonce, action }) + '\n'));
    socket.on('data', chunk => { buffer += chunk; if (buffer.length > 4096) { socket.destroy(); reject(new Error('无效后台响应。')); } else if (buffer.includes('\n')) { socket.end(); try { const value = JSON.parse(buffer); if (value.error) reject(new Error('后台控制身份不匹配。')); else resolve(value); } catch { reject(new Error('无效后台响应。')); } } });
    socket.on('end', () => { if (!buffer) reject(new Error('后台 bridge 未返回状态。')); });
  });
}
export async function serveManagement(config: BridgeConfig, port: number, stop: () => void): Promise<{ close(): Promise<void> } | undefined> {
  const nonce = process.env.MOBILE_HERDR_MANAGED_NONCE, directory = process.env.MOBILE_HERDR_CONTROL_DIR;
  if (!nonce || !/^[a-f0-9]{48}$/.test(nonce) || !directory) return;
  const recordPath = join(config.stateDir, 'bridge.json');
  const record: ManagedRecord = { nonce, socket: join(directory, 'control.sock'), directory, pid: process.pid,
    restart: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !!value && key.startsWith('MOBILE_HERDR_') && !['MOBILE_HERDR_MANAGED_NONCE', 'MOBILE_HERDR_CONTROL_DIR'].includes(key))) as Record<string, string>, MOBILE_HERDR_STATE: config.stateDir, MOBILE_HERDR_HOST: config.host, MOBILE_HERDR_PORT: String(port), MOBILE_HERDR_TOKEN: config.token, MOBILE_HERDR_ORIGINS: config.origins.join(','), MOBILE_HERDR_HERDR_HOME: config.herdrHome, CODEX_HOME: config.codexHome, CLAUDE_CONFIG_DIR: config.claudeHome, PI_CODING_AGENT_DIR: config.piHome, ...(config.socket ? { MOBILE_HERDR_SOCKET: config.socket, HERDR_SOCKET: config.socket } : {}) },
    url: `http://${config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host.includes(':') ? `[${config.host}]` : config.host}:${port}`, startedAt: new Date().toISOString() };
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = ''; socket.setEncoding('utf8'); socket.setTimeout(3000, () => socket.destroy());
    socket.on('data', chunk => {
      buffer += chunk; if (buffer.length > 1024) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      try {
        const input = JSON.parse(buffer); buffer = '';
        if (input.nonce !== nonce || !['status', 'stop'].includes(input.action)) { socket.end('{"error":true}\n'); return; }
        socket.end(JSON.stringify({ running: input.action !== 'stop', version, pid: process.pid, url: record.url, startedAt: record.startedAt }) + '\n');
        if (input.action === 'stop') setTimeout(stop, 50);
      } catch { socket.destroy(); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(record.socket, resolve); });
  await chmod(record.socket, 0o600);
  await writeFile(recordPath + '.tmp', JSON.stringify(record), { mode: 0o600 }); await rename(recordPath + '.tmp', recordPath);
  return { async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const saved = await readFile(recordPath, 'utf8').then(JSON.parse).catch(() => null);
    if (saved?.nonce === nonce) await rm(recordPath, { force: true });
    await rm(directory, { recursive: true, force: true });
  } };
}

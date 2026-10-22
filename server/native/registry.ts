import { createConnection } from 'node:net';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pane } from '../../shared/protocol';
import type { NativeEnvelope, NativeRecord } from './controller';
import { BridgeError } from '../rpc';

export function nativeCall<T>(endpoint: string, request: NativeEnvelope, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint); let buffer = ''; let settled = false;
    function finish(error?: Error, result?: T): void {
      if (settled) return; settled = true; socket.destroy(); if (error) reject(error); else resolve(result!);
    }
    socket.setEncoding('utf8'); socket.setTimeout(timeout, () => finish(new BridgeError('native_timeout', '原生连接超时；操作结果未确认，请勿换一条消息重发。', 409)));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('error', () => finish(new BridgeError('native_offline', '原生进程连接中断。请在电脑检查，消息不会自动重发。', 409)));
    socket.on('end', () => finish(new BridgeError('native_closed', '原生连接已关闭。', 409)));
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return finish(new BridgeError('native_too_large', '原生状态过大。', 409));
      if (!buffer.includes('\n')) return;
      try { const value = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); finish(value.error ? new BridgeError(value.error.code, value.error.message, 409) : undefined, value.result); }
      catch { finish(new BridgeError('native_invalid', '原生进程返回无效数据。', 409)); }
    });
  });
}
export async function findNative(directory: string, socket: string, pane: Pane): Promise<NativeRecord | undefined> {
  const entries = await readdir(directory).catch(() => []);
  for (const name of entries.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).slice(0, 256)) {
    const path = join(directory, name);
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile() || stat.size > 4096 || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) continue;
    const record: NativeRecord | undefined = await readFile(path, 'utf8').then(JSON.parse).catch(() => undefined);
    if (!record || record.runtimeId + '.json' !== name || typeof record.endpoint !== 'string' || !['codex', 'pi'].includes(record.provider) || !Number.isInteger(record.pid) || record.pid <= 0) continue;
    if (record && record.herdrSocket === socket && record.terminalId === pane.terminal_id && resolve(record.endpoint) === join(resolve(directory), record.runtimeId + '.sock')) return record;
  }
}

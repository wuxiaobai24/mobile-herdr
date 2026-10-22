import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';

export class BridgeError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

/** Herdr's API is newline-delimited JSON, not JSON-RPC 2.0. One connection per call. */
export function rpc<T = Record<string, unknown>>(socketPath: string, method: string, params: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;
    function finish(error?: Error, result?: T): void {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(result!);
    }
    socket.setEncoding('utf8');
    socket.setTimeout(8000, () => finish(new BridgeError('herdr_timeout', 'Herdr 响应超时，请检查开发机上的 session。')));
    socket.on('error', () => finish(new BridgeError('herdr_offline', '无法连接 Herdr，请在开发机上启动对应的 session。')));
    socket.on('end', () => finish(new BridgeError('herdr_closed', 'Herdr 连接已关闭。')));
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) return finish(new BridgeError('too_large', 'Herdr 响应过大。'));
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const response = JSON.parse(line);
          if (response.id !== id) continue;
          if (response.error) finish(new BridgeError(response.error.code, response.error.message, 409));
          else finish(undefined, response.result as T);
        } catch { finish(new BridgeError('invalid_response', 'Herdr 返回了无效响应。')); }
      }
    });
  });
}

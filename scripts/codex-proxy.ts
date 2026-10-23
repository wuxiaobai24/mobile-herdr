import { Duplex } from 'node:stream';
import type WebSocketClass from 'ws';
// Bun replaces the public ws entry with a shim that ignores createConnection.
// @ts-expect-error The pinned upstream entry has no separate declaration file.
import WebSocketImplementation from '../node_modules/ws/wrapper.mjs';
const WebSocket = WebSocketImplementation as typeof WebSocketClass;
import { CODEX_FRAME_BYTES, ndjsonLines } from '../server/native/ndjson';

// `app-server proxy` is a raw byte tunnel to a WebSocket control socket, not JSONL.
// The adapter performs the HTTP Upgrade and framing without opening a TCP listener.
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('缺少 Codex executable。');
const child = Bun.spawn([command, ...args, 'app-server', 'proxy'], { env: { ...process.env }, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
const reader = child.stdout.getReader();
let reading = false;
const stream = new Duplex({
  read() {
    if (reading) return;
    reading = true;
    void reader.read().then(({value, done}) => { reading = false; this.push(done ? null : Buffer.from(value)); }).catch(error => this.destroy(error));
  },
  write(chunk, _encoding, callback) { try { child.stdin.write(chunk); void Promise.resolve(child.stdin.flush()).then(() => callback(), callback); } catch (error) { callback(error as Error); } },
  final(callback) { child.stdin.end(); callback(); },
  destroy(error, callback) { child.kill(); callback(error); },
});
const socket = new WebSocket('ws://localhost/', { createConnection: () => stream, perMessageDeflate: false, handshakeTimeout: 5000, maxPayload: CODEX_FRAME_BYTES });
let stopped = false;
function stop(code = 0): void { if (stopped) return; stopped = true; socket.terminate(); stream.destroy(); child.kill(); process.exit(code); }
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => stop());
socket.on('error', () => stop(1)); socket.on('close', () => stop());
socket.on('message', data => {
  try {
    const frame = JSON.parse(data.toString());
    if (process.stdout.writableLength > CODEX_FRAME_BYTES * 2) return stop(1);
    process.stdout.write(JSON.stringify(frame) + '\n');
  } catch { stop(1); }
});
socket.on('open', () => { void (async () => {
  try { for await (const line of ndjsonLines(Bun.stdin.stream())) { if (socket.readyState !== WebSocket.OPEN) break; await new Promise<void>((resolve, reject) => socket.send(line, error => error ? reject(error) : resolve())); } stop(); }
  catch { stop(1); }
})(); });

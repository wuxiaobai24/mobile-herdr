import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const terminal = new Terminal({ cursorBlink: true, fontFamily: 'Menlo,Consolas,monospace', fontSize: 13, scrollback: 5000, allowProposedApi: false, theme: { background: '#101415', foreground: '#edf2ef', cursor: '#b8edcf' } });
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(document.getElementById('terminal')!);
let socket: WebSocket | undefined;
let credentials: { token: string; session: string; pane: string } | undefined;
let connected = false;
const state = document.getElementById('state')!;
function resize(): void { fit.fit(); if (connected) socket?.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })); }
new ResizeObserver(resize).observe(document.getElementById('terminal')!);
function start(): void {
  if (!credentials) return;
  if (socket) { socket.onclose = null; socket.close(); }
  connected = false; terminal.reset(); state.textContent = '连接原始终端…';
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/terminal');
  const active = socket;
  active.binaryType = 'arraybuffer';
  active.onopen = () => { fit.fit(); active.send(JSON.stringify({ type: 'auth', ...credentials, cols: terminal.cols, rows: terminal.rows })); };
  active.onmessage = event => {
    if (active !== socket) return;
    if (typeof event.data === 'string') {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'ready') { connected = true; state.textContent = '原始 Herdr pane · 断开连接后 agent 继续运行'; resize(); }
        if (frame.type === 'error') state.textContent = frame.error.message;
      } catch { /* PTY frames are binary; reject unknown control frames. */ }
    } else terminal.write(new Uint8Array(event.data));
  };
  active.onclose = event => { if (active === socket) { connected = false; state.textContent = event.code === 1008 ? '连接密钥无效，请重新连接开发机。' : '终端已断开，点击重连。原 pane 仍在开发机运行。'; } };
  active.onerror = () => { state.textContent = '终端连接失败，请检查网络。'; };
}
function receive(event: MessageEvent): void {
  // A browser parent can only send its own credentials; none are sent back via postMessage.
  if (event.source && event.source !== window.parent && event.source !== window) return;
  let message;
  try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
  if (message?.type !== 'connect' || typeof message.token !== 'string' || typeof message.pane !== 'string' || typeof message.session !== 'string') return;
  if (JSON.stringify(credentials) === JSON.stringify({ token: message.token, session: message.session, pane: message.pane })) return;
  credentials = { token: message.token, session: message.session, pane: message.pane }; start();
}
window.addEventListener('message', receive);
// Android WebView's message event uses document; injected scripts use window.
document.addEventListener('message', receive as EventListener);
terminal.onData(data => { if (connected) socket?.send(JSON.stringify({ type: 'input', data })); });
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => button.onclick = () => {
  if (!connected) return;
  const key = JSON.parse('"' + button.dataset.key + '"');
  socket?.send(JSON.stringify({ type: 'input', data: key })); terminal.focus();
});
document.getElementById('reconnect')!.onclick = start;
window.addEventListener('beforeunload', () => { socket?.close(); terminal.dispose(); });
window.addEventListener('offline', () => { connected = false; socket?.close(); state.textContent = '设备已离线，终端写入已暂停。网络恢复后点击重连。'; });

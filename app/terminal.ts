import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { applyTheme, getTheme, parseAppearance, defaultAppearance, type ThemeColors } from '../shared/themes';

function terminalTheme(c: ThemeColors): ITheme {
  return { background: c.bg, foreground: c.text, cursor: c.accent, selectionBackground: c.accent + '55',
    black: c.surface, brightBlack: c.dim, red: c.red, green: c.success, yellow: c.amber, blue: c.blue, magenta: c.magenta, cyan: c.cyan, white: c.text,
    brightRed: c.red, brightGreen: c.success, brightYellow: c.amber, brightBlue: c.accent, brightMagenta: c.magenta, brightCyan: c.cyan, brightWhite: c.text };
}
const terminal = new Terminal({
  cursorBlink: true, fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace', fontSize: defaultAppearance.terminalSize,
  scrollback: 5000, scrollOnUserInput: true, allowProposedApi: false, theme: terminalTheme(getTheme(defaultAppearance.theme).colors),
});
const fit = new FitAddon();
const surface = document.getElementById('terminal')!;
const state = document.getElementById('state')!;
const history = document.getElementById('history')!;
const historyContent = document.getElementById('history-content')!;
const historyNote = document.getElementById('history-note')!;
const historyButton = document.getElementById('show-history')!;
const latest = document.getElementById('latest')!;
const toolbar = document.getElementById('toolbar')!;
const keys = document.getElementById('keys')!;
const keyboard = document.getElementById('keyboard') as HTMLButtonElement;
terminal.loadAddon(fit); terminal.open(surface);
let socket: WebSocket | undefined;
let credentials: { token: string; session: string; pane: string; machine?: string } | undefined;
let connected = false;
let historyRequest: AbortController | undefined;

function resize(): void {
  if (!history.hidden) return;
  fit.fit();
  if (connected) socket?.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
}
new ResizeObserver(resize).observe(surface);
function scrollState(): void {
  const buffer = terminal.buffer.active;
  latest.hidden = !history.hidden || buffer.viewportY >= buffer.baseY;
}
terminal.onScroll(scrollState);
terminal.onWriteParsed(scrollState);
function hideHistory(): void {
  historyRequest?.abort(); historyRequest = undefined;
  history.hidden = true; surface.hidden = false; toolbar.hidden = false; keys.hidden = false;
  historyButton.setAttribute('aria-pressed', 'false'); keyboard.disabled = !connected;
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => { button.disabled = !connected; });
  resize(); scrollState();
}
async function showHistory(): Promise<void> {
  if (!credentials) return;
  const wasOpen = !history.hidden;
  const oldTop = historyContent.scrollTop;
  history.hidden = false; surface.hidden = true; latest.hidden = true; toolbar.hidden = true; keys.hidden = true;
  terminal.blur(); keyboard.disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => { button.disabled = true; });
  historyButton.setAttribute('aria-pressed', 'true'); historyNote.textContent = '读取历史…';
  historyRequest?.abort();
  const request = new AbortController(); historyRequest = request;
  const target = credentials;
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${target.token}` };
    if (target.machine) headers['X-Herdr-Machine'] = target.machine;
    const query = new URLSearchParams({ session: target.session, lines: '2000' });
    const response = await fetch(`/api/panes/${encodeURIComponent(target.pane)}/screen?${query}`, { headers, signal: request.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? '读取失败，请重试。');
    if (request.signal.aborted || credentials !== target) return;
    historyContent.textContent = result.read?.text || '暂无终端输出。';
    historyNote.textContent = result.read?.truncated ? '最近 2000 行 · 向上滑动查看' : '终端历史 · 滑动查看、选择复制';
    historyContent.scrollTop = wasOpen ? oldTop : historyContent.scrollHeight;
  } catch (error) {
    if (request.signal.aborted) return;
    historyNote.textContent = error instanceof Error ? error.message : '历史读取失败，请重试。';
  }
}
function start(): void {
  if (!credentials) return;
  if (socket) { socket.onclose = null; socket.close(); }
  connected = false; hideHistory(); terminal.reset(); scrollState(); state.textContent = '连接原始终端…';
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/terminal');
  const active = socket;
  active.binaryType = 'arraybuffer';
  active.onopen = () => { fit.fit(); active.send(JSON.stringify({ type: 'auth', ...credentials, cols: terminal.cols, rows: terminal.rows })); };
  active.onmessage = event => {
    if (active !== socket) return;
    if (typeof event.data === 'string') {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'ready') { connected = true; state.textContent = '实时终端 · 滑动查看历史'; if (history.hidden) hideHistory(); resize(); }
        if (frame.type === 'error') state.textContent = frame.error.message;
      } catch { /* PTY frames are binary; reject unknown control frames. */ }
    } else terminal.write(new Uint8Array(event.data));
  };
  active.onclose = event => {
    if (active !== socket) return;
    connected = false; keyboard.disabled = true;
    document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => { button.disabled = true; });
    state.textContent = event.code === 1008 ? '密钥无效，请重新配对' : '已断开 · 原会话继续运行';
  };
  active.onerror = () => { if (active === socket) state.textContent = '终端连接失败，请检查网络。'; };
}
function receive(event: MessageEvent): void {
  // A browser parent can only send its own credentials; none are sent back via postMessage.
  if (event.source && event.source !== window.parent && event.source !== window) return;
  let message;
  try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
  if (message?.type !== 'connect' || typeof message.token !== 'string' || typeof message.pane !== 'string' || typeof message.session !== 'string') return;
  const appearance = parseAppearance(message.appearance);
  const theme = getTheme(appearance.theme);
  applyTheme(document.documentElement, theme);
  terminal.options.theme = terminalTheme(theme.colors);
  terminal.options.fontSize = appearance.terminalSize;
  document.documentElement.style.setProperty('--terminal-size', `${appearance.terminalSize}px`);
  resize();
  const next = { token: message.token, session: message.session, pane: message.pane, machine: typeof message.machine === 'string' ? message.machine : undefined };
  if (JSON.stringify(credentials) === JSON.stringify(next)) return;
  historyContent.textContent = '';
  credentials = next; start();
}
window.addEventListener('message', receive);
// Android WebView's message event uses document; injected scripts use window.
document.addEventListener('message', receive as EventListener);
terminal.onData(data => { if (connected && history.hidden) socket?.send(JSON.stringify({ type: 'input', data })); });

// Browsing never sends wheel reports or arrow keys to the running program.
// Full-screen applications use the alternate buffer, which has no local scrollback.
function browse(lines: number): void {
  if (terminal.buffer.active.type === 'alternate' || terminal.modes.mouseTrackingMode !== 'none' || terminal.buffer.active.baseY === 0) {
    if (lines < 0) void showHistory();
  } else { terminal.scrollLines(lines); scrollState(); }
}
terminal.attachCustomWheelEventHandler(event => {
  if (event.ctrlKey || event.metaKey) return false;
  const delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? surface.clientHeight : 1);
  if (delta) { event.preventDefault(); browse(Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 20))); }
  return false;
});
let touch: { y: number; remainder: number } | undefined;
surface.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) { touch = undefined; return; }
  const point = event.touches[0]; touch = { y: point.clientY, remainder: 0 };
  event.preventDefault(); event.stopImmediatePropagation();
}, { capture: true, passive: false });
surface.addEventListener('touchmove', event => {
  if (!touch || event.touches.length !== 1) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const point = event.touches[0];
  const distance = touch.y - point.clientY;
  touch.y = point.clientY; touch.remainder += distance;
  const lines = Math.trunc(touch.remainder / 20);
  if (lines) { touch.remainder -= lines * 20; browse(lines); }
}, { capture: true, passive: false });
surface.addEventListener('touchend', event => { touch = undefined; event.stopImmediatePropagation(); }, { capture: true });
surface.addEventListener('touchcancel', () => { touch = undefined; }, { capture: true });
terminal.attachCustomKeyEventHandler(event => {
  if (event.type === 'keydown' && event.shiftKey && ['PageUp', 'PageDown'].includes(event.key)) {
    event.preventDefault(); browse((event.key === 'PageUp' ? -1 : 1) * terminal.rows); return false;
  }
  return true;
});
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
  button.disabled = true;
  button.onclick = () => {
    if (!connected || !history.hidden) return;
    const key = JSON.parse('"' + button.dataset.key + '"');
    socket?.send(JSON.stringify({ type: 'input', data: key })); terminal.focus();
  };
});
historyButton.onclick = () => { if (history.hidden) void showHistory(); else hideHistory(); };
document.getElementById('close-history')!.onclick = hideHistory;
document.getElementById('refresh-history')!.onclick = () => void showHistory();
latest.onclick = () => { terminal.scrollToBottom(); scrollState(); };
keyboard.disabled = true;
keyboard.onclick = () => { if (connected && history.hidden) terminal.focus(); };
document.getElementById('reconnect')!.onclick = start;
window.addEventListener('beforeunload', () => { historyRequest?.abort(); socket?.close(); terminal.dispose(); });
window.addEventListener('offline', () => { connected = false; socket?.close(); state.textContent = '设备已离线 · 历史可继续阅读'; });

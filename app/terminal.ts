import { Terminal, type ITheme } from '@xterm/xterm';
import { copyText } from './clipboard.web';
import { FitAddon } from '@xterm/addon-fit';
import { applyTheme, getTheme, parseAppearance, defaultAppearance, type ThemeColors } from '../shared/themes';
import { isTerminalReply } from '../shared/terminal-keys';
import { createTerminalControls } from './terminal-controls';

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
let connected = false, disposing = false, suspended = false, retryCount = 0;
let inputWritable = true, controlMessage = '', lastFailure = '';
function inputState(): void {
  keyboard.disabled = !connected || !inputWritable || !history.hidden;
  controls.setEnabled(!keyboard.disabled);
  if (connected) state.textContent = inputWritable ? '实时终端 · 点击输入，滑动查看历史' : controlMessage;
}
const nativeBridge = (window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }).ReactNativeWebView;
const controls = createTerminalControls({
  input: data => { if (connected && inputWritable && history.hidden) socket?.send(JSON.stringify({ type: 'input', data })); },
  paste: value => terminal.paste(value), focus: () => terminal.focus(), nativeBridge,
});
controls.setEnabled(false);
let lastSeen = Date.now();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let historyRequest: AbortController | undefined;
let historyText = '', selectedHistory = '', matchIndex = 0;
let historyOffset = 0, scrollRemainder = 0, inertia = 0;
function stopInertia(): void { cancelAnimationFrame(inertia); inertia = 0; }
function rememberSelection(): void {
  const selection = window.getSelection();
  if (selection?.anchorNode && historyContent.contains(selection.anchorNode)) selectedHistory = selection.toString();
  document.getElementById('copy-history')!.textContent = selectedHistory ? '复制所选' : '复制';
}
document.addEventListener('selectionchange', rememberSelection);
document.getElementById('copy-history')!.addEventListener('pointerdown', rememberSelection);
const queryField = document.getElementById('history-query') as HTMLInputElement;
function renderHistory(): void {
  selectedHistory = '';
  const query = queryField.value.toLocaleLowerCase();
  historyContent.replaceChildren();
  if (!query) historyContent.textContent = historyText;
  else {
    const source = historyText.toLocaleLowerCase(); let position = 0, found = 0;
    while (position < historyText.length) {
      const index = source.indexOf(query, position);
      if (index < 0 || found >= 500) { historyContent.append(document.createTextNode(historyText.slice(position))); break; }
      historyContent.append(document.createTextNode(historyText.slice(position, index)));
      const mark = document.createElement('mark'); mark.textContent = historyText.slice(index, index + query.length); historyContent.append(mark);
      position = index + query.length; found++;
    }
  }
  updateMatches(false);
}
function updateMatches(scroll: boolean): void {
  const matches = historyContent.querySelectorAll('mark');
  matchIndex = matches.length ? (matchIndex + matches.length) % matches.length : 0;
  matches.forEach((mark, i) => { mark.dataset.active = String(i === matchIndex); });
  document.getElementById('match-count')!.textContent = matches.length ? `${matchIndex + 1}/${matches.length}${matches.length === 500 ? '+' : ''}` : '0';
  if (scroll) matches[matchIndex]?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
queryField.oninput = () => { matchIndex = 0; renderHistory(); updateMatches(true); };
document.getElementById('previous-match')!.onclick = () => { matchIndex--; updateMatches(true); };
document.getElementById('next-match')!.onclick = () => { matchIndex++; updateMatches(true); };
document.getElementById('history-top')!.onclick = () => { historyContent.scrollTop = 0; };
document.getElementById('history-bottom')!.onclick = () => { historyContent.scrollTop = historyContent.scrollHeight; };
document.getElementById('copy-history')!.onclick = () => {
  const selection = window.getSelection();
  const selected = selection?.anchorNode && historyContent.contains(selection.anchorNode) ? selection.toString() || selectedHistory : selectedHistory;
  if (nativeBridge) { nativeBridge.postMessage(JSON.stringify({ type: 'copy', text: selected || historyText })); return; }
  void copyText(selected || historyText).then(() => { historyNote.textContent = selected ? '已复制选中内容' : '已复制历史'; }).catch(() => { historyNote.textContent = '复制不可用，请长按选择文字复制。'; });
};

function resize(): void {
  if (!history.hidden || surface.clientWidth < 1 || surface.clientHeight < 1) return;
  fit.fit();
  if (connected) socket?.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
}
new ResizeObserver(resize).observe(surface);
function scrollState(): void {
  const buffer = terminal.buffer.active;
  latest.hidden = !history.hidden ? history.dataset.swipe !== 'true' : buffer.viewportY >= buffer.baseY;
}
terminal.onScroll(scrollState);
terminal.onWriteParsed(scrollState);
function hideHistory(): void {
  stopInertia(); historyOffset = 0; scrollRemainder = 0;
  historyRequest?.abort(); historyRequest = undefined;
  history.hidden = true; surface.hidden = false; toolbar.hidden = false; keys.hidden = false;
  historyButton.setAttribute('aria-pressed', 'false'); inputState();
  resize(); scrollState();
}
async function showHistory(swipe = false): Promise<void> {
  if (!credentials) return;
  controls.hide();
  const wasOpen = !history.hidden;
  const oldTop = historyContent.scrollTop;
  historyOffset = 0;
  history.dataset.swipe = String(swipe);
  history.hidden = false; surface.hidden = true; latest.hidden = !swipe; toolbar.hidden = !swipe; keys.hidden = !swipe;
  terminal.blur(); keyboard.disabled = true;
  controls.setEnabled(false);
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
    historyText = result.read?.text || '暂无终端输出。'; renderHistory();
    historyNote.textContent = result.read?.truncated ? '最近 2000 行 · 可搜索与复制' : '终端历史 · 滑动查看、选择复制';
    historyContent.scrollTop = (wasOpen ? oldTop : historyContent.scrollHeight - historyContent.clientHeight) + historyOffset;
  } catch (error) {
    if (request.signal.aborted) return;
    historyNote.textContent = error instanceof Error ? error.message : '历史读取失败，请重试。';
    if (swipe) { history.dataset.swipe = 'false'; toolbar.hidden = true; keys.hidden = true; latest.hidden = true; }
  } finally {
    if (historyRequest === request) historyRequest = undefined;
  }
}
function start(reset = true): void {
  if (!credentials || disposing || suspended) return;
  clearTimeout(reconnectTimer); clearInterval(heartbeat); lastSeen = Date.now(); lastFailure = '';
  if (socket) { socket.onclose = null; socket.close(); }
  connected = false; inputState(); if (reset) { hideHistory(); terminal.reset(); } scrollState(); state.textContent = '连接原始终端…';
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/terminal');
  const active = socket;
  active.binaryType = 'arraybuffer';
  active.onopen = () => { fit.fit(); active.send(JSON.stringify({ type: 'auth', ...credentials, cols: terminal.cols, rows: terminal.rows })); };
  heartbeat = setInterval(() => {
    if (disposing || active !== socket) return;
    if (Date.now() - lastSeen > 20000) { connected = false; active.close(); start(false); return; }
    if (active.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: 'ping' }));
  }, 5000);
  active.onmessage = event => {
    if (active !== socket) return; lastSeen = Date.now();
    if (typeof event.data === 'string') {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'ready') { connected = true; retryCount = 0; if (history.hidden) hideHistory(); inputState(); resize(); }
        if (frame.type === 'control') { inputWritable = frame.writable === true; controlMessage = frame.message || '终端当前只读'; inputState(); }
        if (frame.type === 'error') { lastFailure = frame.error.message; state.textContent = lastFailure; }
      } catch { /* PTY frames are binary; reject unknown control frames. */ }
    } else terminal.write(new Uint8Array(event.data));
  };
  active.onclose = event => {
    if (active !== socket) return;
    connected = false; clearInterval(heartbeat); keyboard.disabled = true;
    controls.setEnabled(false);
    state.textContent = lastFailure || (event.code === 1008 ? '密钥无效，请重新配对' : '终端重连中 · 原会话继续运行');
    if (event.code !== 1008 && !disposing && navigator.onLine) reconnectTimer = setTimeout(() => start(false), Math.min(15000, 750 * 2 ** Math.min(retryCount++, 5)));
  };
  active.onerror = () => { if (active === socket) state.textContent = '终端连接失败，请检查网络。'; };
}
function receive(event: MessageEvent): void {
  // A browser parent can only send its own credentials; none are sent back via postMessage.
  if (event.source && event.source !== window.parent && event.source !== window) return;
  let message;
  try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
  if (!message || typeof message !== 'object') return;
  controls.receive(message);
  if (message?.type === 'clipboard-result') { historyNote.textContent = message.ok ? '已复制到剪贴板' : '复制失败，请长按选择。'; return; }
  if (message?.type === 'suspend') {
    suspended = true; connected = false; clearTimeout(reconnectTimer); clearInterval(heartbeat); historyRequest?.abort();
    if (socket) { socket.onclose = null; socket.close(); socket = undefined; }
    terminal.blur(); keyboard.disabled = true;
    controls.setEnabled(false);
    state.textContent = '连接已暂停 · 原会话继续运行'; return;
  }
  if (message?.type !== 'connect' || typeof message.token !== 'string' || typeof message.pane !== 'string' || typeof message.session !== 'string') return;
  const appearance = parseAppearance(message.appearance);
  const theme = getTheme(appearance.theme);
  applyTheme(document.documentElement, theme);
  terminal.options.theme = terminalTheme(theme.colors);
  terminal.options.fontSize = appearance.terminalSize;
  document.documentElement.style.setProperty('--terminal-size', `${appearance.terminalSize}px`);
  resize();
  const next = { token: message.token, session: message.session, pane: message.pane, machine: typeof message.machine === 'string' ? message.machine : undefined };
  const resumed = suspended; suspended = false;
  if (JSON.stringify(credentials) === JSON.stringify(next)) { if (resumed) start(false); return; }
  historyContent.textContent = ''; historyText = ''; queryField.value = '';
  controls.reset();
  credentials = next; start();
}
window.addEventListener('message', receive);
// Android WebView's message event uses document; injected scripts use window.
document.addEventListener('message', receive as EventListener);
terminal.onData(data => {
  if (!connected || !history.hidden) return;
  if (isTerminalReply(data)) socket?.send(JSON.stringify({ type: 'input', data }));
  else if (inputWritable) socket?.send(JSON.stringify({ type: 'input', data: controls.consume(data) }));
});

// Browsing never sends wheel reports or arrow keys to the running program.
// Full-screen applications use the alternate buffer, which has no local scrollback.
function browse(lines: number): void {
  if (terminal.buffer.active.type === 'alternate' || terminal.modes.mouseTrackingMode !== 'none' || terminal.buffer.active.baseY === 0) {
    if (lines < 0) void showHistory();
  } else { terminal.scrollLines(lines); scrollState(); }
}
function browsePixels(pixels: number): void {
  if (!history.hidden) {
    if (historyRequest) historyOffset += pixels;
    historyContent.scrollTop += pixels;
    return;
  }
  if (terminal.buffer.active.type === 'alternate' || terminal.modes.mouseTrackingMode !== 'none' || terminal.buffer.active.baseY === 0) {
    if (pixels < 0) { void showHistory(true); historyOffset += pixels; }
    return;
  }
  const lineHeight = surface.querySelector('.xterm-rows')?.getBoundingClientRect().height;
  const row = lineHeight ? lineHeight / terminal.rows : defaultAppearance.terminalSize * 1.2;
  scrollRemainder += pixels;
  const lines = Math.trunc(scrollRemainder / row);
  if (lines) { terminal.scrollLines(lines); scrollRemainder -= lines * row; scrollState(); }
}
terminal.attachCustomWheelEventHandler(event => {
  if (event.ctrlKey || event.metaKey) return false;
  const delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? surface.clientHeight : 1);
  if (delta) { event.preventDefault(); browse(Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 20))); }
  return false;
});
let touch: { y: number; startY: number; startX: number; moved: boolean; time: number; velocity: number } | undefined;
surface.addEventListener('touchstart', event => {
  stopInertia(); scrollRemainder = 0;
  if (event.touches.length !== 1) { touch = undefined; return; }
  const point = event.touches[0]; touch = { y: point.clientY, startY: point.clientY, startX: point.clientX, moved: false, time: performance.now(), velocity: 0 };
  event.preventDefault(); event.stopImmediatePropagation();
}, { capture: true, passive: false });
// Keep the initiating gesture when history replaces the live terminal surface.
document.addEventListener('touchmove', event => {
  if (!touch || event.touches.length !== 1) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const point = event.touches[0];
  if (!touch.moved && Math.abs(point.clientY - touch.startY) < 8 && Math.abs(point.clientX - touch.startX) < 8) return;
  touch.moved = true;
  const distance = touch.y - point.clientY;
  const now = performance.now();
  touch.velocity = distance / Math.max(8, now - touch.time);
  touch.time = now; touch.y = point.clientY;
  browsePixels(distance);
}, { capture: true, passive: false });
document.addEventListener('touchend', event => {
  if (!touch) return;
  if (!touch.moved && connected && inputWritable && history.hidden) terminal.focus();
  else if (touch.moved && performance.now() - touch.time < 80) {
    let velocity = Math.max(-2.5, Math.min(2.5, touch.velocity)), previous = performance.now();
    const glide = (now: number): void => {
      const elapsed = Math.min(32, now - previous); previous = now;
      browsePixels(velocity * elapsed); velocity *= Math.exp(-elapsed / 180);
      if (Math.abs(velocity) > 0.02) inertia = requestAnimationFrame(glide); else inertia = 0;
    };
    inertia = requestAnimationFrame(glide);
  }
  touch = undefined; event.stopImmediatePropagation();
}, { capture: true });
document.addEventListener('touchstart', event => { if (!surface.contains(event.target as Node)) stopInertia(); }, { capture: true });
document.addEventListener('touchcancel', () => { touch = undefined; stopInertia(); }, { capture: true });
terminal.attachCustomKeyEventHandler(event => {
  if (event.type === 'keydown' && event.shiftKey && ['PageUp', 'PageDown'].includes(event.key)) {
    event.preventDefault(); browse((event.key === 'PageUp' ? -1 : 1) * terminal.rows); return false;
  }
  return true;
});
historyButton.onclick = () => { if (history.hidden || history.dataset.swipe === 'true') void showHistory(); else hideHistory(); };
document.getElementById('close-history')!.onclick = hideHistory;
document.getElementById('refresh-history')!.onclick = () => void showHistory();
latest.onclick = () => { if (!history.hidden) hideHistory(); terminal.scrollToBottom(); scrollState(); };
keyboard.disabled = true;
keyboard.onclick = () => { if (connected && inputWritable && history.hidden) terminal.focus(); };
document.getElementById('reconnect')!.onclick = () => start(false);
window.addEventListener('beforeunload', () => { disposing = true; clearInterval(heartbeat); clearTimeout(reconnectTimer); historyRequest?.abort(); socket?.close(); terminal.dispose(); });
window.addEventListener('offline', () => { connected = false; socket?.close(); state.textContent = '设备已离线 · 历史可继续阅读'; });

window.addEventListener('online', () => start(false));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && credentials) start(false); });

nativeBridge?.postMessage(JSON.stringify({ type: 'terminal-ready' }));

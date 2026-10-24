import { modifiedTerminalInput, type TerminalModifiers } from '../shared/terminal-input';
import { readText } from './clipboard.web';

interface Options {
  input: (value: string) => void;
  paste: (value: string) => void;
  focus: () => void;
  nativeBridge?: { postMessage: (message: string) => void };
}

/** Touch controls share one input gate with the terminal keyboard. */
export function createTerminalControls(options: Options) {
  const keybar = document.getElementById('keys')!;
  const pad = document.getElementById('direction-pad')!;
  const padToggle = document.getElementById('toggle-pad')!;
  const editor = document.getElementById('paste-editor')!;
  const field = document.getElementById('paste-text') as HTMLTextAreaElement;
  const note = document.getElementById('paste-note')!;
  const submit = document.getElementById('send-paste') as HTMLButtonElement;
  const modifiers: TerminalModifiers = { ctrl: false, alt: false };
  let enabled = false, revision = 0, clipboardRequest: string | undefined;
  function clearModifiers(): void {
    modifiers.ctrl = false; modifiers.alt = false;
    keybar.querySelectorAll<HTMLButtonElement>('[data-modifier]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  }
  function consume(value: string): string {
    const result = modifiedTerminalInput(value, modifiers);
    clearModifiers();
    return result;
  }
  function updateSubmit(): void { submit.disabled = !enabled || !field.value; }
  function closePaste(): void { editor.hidden = true; clipboardRequest = undefined; revision++; }
  function fillClipboard(value: string, expected: number): void {
    if (editor.hidden || revision !== expected) return;
    field.value = value.slice(0, 32000);
    note.textContent = value.length > 32000 ? '仅保留前 32000 字符，请检查后粘贴。' : '检查内容后粘贴；换行可能执行命令。';
    updateSubmit();
  }
  function clipboardUnavailable(expected: number): void {
    if (editor.hidden || revision !== expected) return;
    note.textContent = '可在输入框中长按粘贴，检查后再发送。';
  }
  document.getElementById('open-paste')!.onclick = () => {
    editor.hidden = false; pad.hidden = true; padToggle.setAttribute('aria-expanded', 'false'); clearModifiers();
    updateSubmit();
    if (field.value) return;
    const expected = ++revision;
    note.textContent = '读取剪贴板…';
    if (options.nativeBridge) {
      clipboardRequest = String(expected);
      options.nativeBridge.postMessage(JSON.stringify({ type: 'read-clipboard', requestId: clipboardRequest }));
    } else void readText().then(value => fillClipboard(value, expected)).catch(() => clipboardUnavailable(expected));
  };
  field.oninput = () => { revision++; clipboardRequest = undefined; updateSubmit(); };
  document.getElementById('close-paste')!.onclick = closePaste;
  submit.onclick = () => {
    if (!enabled || !field.value) return;
    clearModifiers(); options.paste(field.value); field.value = ''; closePaste(); options.focus();
  };
  keybar.querySelectorAll<HTMLButtonElement>('[data-modifier]').forEach(button => {
    button.onclick = () => {
      if (!enabled) return;
      const modifier = button.dataset.modifier as keyof TerminalModifiers;
      modifiers[modifier] = !modifiers[modifier];
      button.setAttribute('aria-pressed', String(modifiers[modifier]));
    };
    button.onpointerdown = event => event.preventDefault();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
    button.onpointerdown = event => event.preventDefault();
    button.onclick = () => {
      if (!enabled) return;
      options.input(consume(JSON.parse('"' + button.dataset.key + '"')));
    };
  });
  function closePad(): void { pad.hidden = true; padToggle.setAttribute('aria-expanded', 'false'); }
  padToggle.onclick = () => {
    pad.hidden = !pad.hidden; padToggle.setAttribute('aria-expanded', String(!pad.hidden)); closePaste();
  };
  document.getElementById('close-pad')!.onclick = closePad;
  const handle = document.getElementById('pad-handle')!;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  function place(left: number, top: number): void {
    const parent = pad.parentElement!;
    pad.style.left = `${Math.max(0, Math.min(parent.clientWidth - pad.offsetWidth, left))}px`;
    pad.style.top = `${Math.max(0, Math.min(parent.clientHeight - pad.offsetHeight, top))}px`;
    pad.style.bottom = 'auto'; pad.style.right = 'auto';
  }
  handle.onpointerdown = event => {
    drag = { x: event.clientX, y: event.clientY, left: pad.offsetLeft, top: pad.offsetTop };
    handle.setPointerCapture(event.pointerId); event.preventDefault();
  };
  handle.onpointermove = event => { if (drag) place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y); };
  handle.onpointerup = handle.onpointercancel = () => { drag = undefined; };
  new ResizeObserver(() => { if (!pad.hidden && pad.style.left) place(pad.offsetLeft, pad.offsetTop); }).observe(pad.parentElement!);
  return {
    consume,
    hide(): void { closePaste(); closePad(); },
    setEnabled(value: boolean): void {
      enabled = value;
      document.querySelectorAll<HTMLButtonElement>('[data-key], [data-modifier], #open-paste').forEach(button => { button.disabled = !value; });
      if (!value) clearModifiers();
      updateSubmit();
    },
    reset(): void { clearModifiers(); closePaste(); closePad(); field.value = ''; },
    receive(message: { type?: string; requestId?: string; text?: string }): void {
      if (message.type !== 'clipboard-text' || !clipboardRequest || message.requestId !== clipboardRequest) return;
      clipboardRequest = undefined;
      if (typeof message.text === 'string') fillClipboard(message.text, revision);
      else clipboardUnavailable(revision);
    },
  };
}

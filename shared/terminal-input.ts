export interface TerminalModifiers { ctrl: boolean; alt: boolean }

/** Apply one-shot modifiers to a key, preserving terminal escape sequences. */
export function modifiedTerminalInput(value: string, modifiers: TerminalModifiers): string {
  const mask = (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  if (!mask) return value;
  if (/^\u001b(?:\[|O)[ABCDHF]$/.test(value)) return `\u001b[1;${mask + 1}${value.at(-1)}`;
  if (modifiers.ctrl && value.length === 1) {
    const code = value.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) value = String.fromCharCode(code - 64);
    else if (value === ' ') value = '\u0000';
    else if (value === '?') value = '\u007f';
  }
  return modifiers.alt ? '\u001b' + value : value;
}

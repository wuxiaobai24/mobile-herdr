import { expect, test } from 'bun:test';
import { modifiedTerminalInput } from '../shared/terminal-input';

test('one-shot terminal modifiers encode control letters, Alt, arrows and preserve Unicode', () => {
  expect(modifiedTerminalInput('c', { ctrl: true, alt: false })).toBe('\u0003');
  expect(modifiedTerminalInput(']', { ctrl: true, alt: false })).toBe('\u001d');
  expect(modifiedTerminalInput(' ', { ctrl: true, alt: false })).toBe('\u0000');
  expect(modifiedTerminalInput('?', { ctrl: true, alt: false })).toBe('\u007f');
  expect(modifiedTerminalInput('b', { ctrl: false, alt: true })).toBe('\u001bb');
  expect(modifiedTerminalInput('c', { ctrl: true, alt: true })).toBe('\u001b\u0003');
  expect(modifiedTerminalInput('\u001b[A', { ctrl: true, alt: false })).toBe('\u001b[1;5A');
  expect(modifiedTerminalInput('\u001bOD', { ctrl: true, alt: true })).toBe('\u001b[1;7D');
  expect(modifiedTerminalInput('中文🙂', { ctrl: true, alt: false })).toBe('中文🙂');
  expect(modifiedTerminalInput('\u001b[200~粘贴\u001b[201~', { ctrl: false, alt: false })).toBe('\u001b[200~粘贴\u001b[201~');
});

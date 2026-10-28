import { expect, test } from 'bun:test';
import { availableChatCommands, parseChatCommand } from '../shared/chat-commands';
import type { NativeState } from '../shared/native';

test('Codex CLI commands remain discoverable with explicit terminal handling', () => {
  const commands = availableChatCommands({ provider: 'codex', capabilities: { skills: true }, commands: [{ name: 'mcp', description: 'provider action' }] } as NativeState);
  expect(commands.find(command => command.name === 'skills')?.terminal).not.toBe(true);
  expect(commands.find(command => command.name === 'permissions')?.terminal).toBe(true);
  expect(commands.filter(command => command.name === 'mcp')).toHaveLength(1);
  expect(commands.find(command => command.name === 'mcp')?.terminal).not.toBe(true);
  expect(availableChatCommands().some(command => command.name === 'skills')).toBe(false);
  expect(availableChatCommands({ provider: 'pi', capabilities: {} } as NativeState).some(command => command.name === 'permissions')).toBe(false);
});

test('slash commands preserve arguments and advertise only current provider capabilities', () => {
  expect(parseChatCommand('/model fixture-model')).toEqual({ name: 'model', argument: 'fixture-model' });
  expect(parseChatCommand('/MODEL fixture-model')).toEqual({ name: 'model', argument: 'fixture-model' });
  expect(parseChatCommand('/skill:CaseSensitive argument')).toEqual({ name: 'skill:CaseSensitive', argument: 'argument' });
  expect(parseChatCommand('/skill:test 中文\n参数')).toEqual({ name: 'skill:test', argument: '中文\n参数' });
  expect(parseChatCommand('普通消息 /model')).toBeUndefined();
  expect(parseChatCommand('/')).toBeUndefined();
  expect(availableChatCommands().map(command => command.name)).not.toContain('model');
  const state = { capabilities: { models: true, reasoning: true, compact: true }, commands: [{ name: 'custom', description: 'Current extension' }, { name: 'model', description: 'Reserved command' }] } as NativeState;
  const commands = availableChatCommands(state);
  expect(commands.map(command => command.name)).toContain('custom');
  expect(commands.filter(command => command.name === 'model')).toHaveLength(1);
  expect(commands.map(command => command.name)).toContain('reasoning');
});

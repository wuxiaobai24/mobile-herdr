import { expect, test } from 'bun:test';
import { availableChatCommands, parseChatCommand } from '../shared/chat-commands';
import type { NativeState } from '../shared/native';

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

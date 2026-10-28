import { expect, test } from 'bun:test';
import { attentionKey, attentionTargets, observeAttention, readAttention } from '../shared/attention';
import { createFixture } from './fixture';

test('attention is pane-specific and completion unread follows exact machine/session/terminal identity', async () => {
  const f = await createFixture();
  const machine = { id: 'local', name: '本机', url: 'http://localhost:7331', token: 'not-a-real-token' };
  try {
    const pane = f.snapshot.panes[0];
    for (const row of f.snapshot.panes) row.agent_status = 'idle';
    pane.agent_status = 'blocked';
    let memory = observeAttention({}, machine, 'one', f.snapshot);
    expect(attentionTargets(machine, 'one', f.snapshot, memory).map(row => row.pane.pane_id)).toEqual([pane.pane_id]);
    pane.agent_status = 'idle';
    memory = readAttention(JSON.stringify(observeAttention(memory, machine, 'one', f.snapshot)));
    expect(attentionTargets(machine, 'one', f.snapshot, memory)[0].kind).toBe('done');
    expect(attentionTargets(machine, 'two', f.snapshot, memory)).toHaveLength(0);
    const other = { ...machine, remote: 'ssh-other' };
    expect(attentionTargets(other, 'one', f.snapshot, memory)).toHaveLength(0);
    const original = pane.terminal_id; pane.terminal_id = 'replacement';
    expect(attentionTargets(machine, 'one', f.snapshot, memory)).toHaveLength(0);
    pane.terminal_id = original;
    memory = observeAttention(memory, machine, 'one', f.snapshot, attentionKey(machine, 'one', pane));
    expect(attentionTargets(machine, 'one', f.snapshot, memory)).toHaveLength(0);
    pane.agent_status = 'done';
    expect(attentionTargets(machine, 'one', f.snapshot, {})).toHaveLength(0);
    expect(readAttention('invalid')).toEqual({});
  } finally { await f.close(); }
});

import { expect, test } from 'bun:test';
import { emptyNavigation, matchingPanes, readNavigation, rememberPane, tabPane, workspacePane } from '../shared/navigation';
import { createFixture } from './fixture';

test('tab navigation searches displayed tab names and restores only the exact original terminal', async () => {
  const f = await createFixture();
  try {
    const first = f.snapshot.panes[0];
    const other = { ...first, pane_id: 'w1:p2', terminal_id: 'other-terminal', tab_id: 'w1:t2' };
    f.snapshot.tabs.push({ workspace_id: 'w1', tab_id: 'w1:t2', label: 'release 中文', number: 2 });
    f.snapshot.panes.push(other);
    let memory = rememberPane(emptyNavigation(), first, 'chat');
    memory = readNavigation(JSON.stringify(rememberPane(memory, other, 'terminal')));
    expect(workspacePane(f.snapshot, 'w1', memory)).toBe(other);
    expect(memory.tabs['w1:t2'].mode).toBe('terminal');
    expect(matchingPanes(f.snapshot, 'w1', 'release')).toEqual([other]);
    expect(matchingPanes(f.snapshot, 'w1', '中文')).toEqual([other]);
    expect(matchingPanes(f.snapshot, 'w1', 'mobile-herdr')).toHaveLength(2);
    const split = { ...other, pane_id: 'w1:p3', terminal_id: 'split-terminal' }; f.snapshot.panes.push(split);
    memory = rememberPane(memory, split, 'chat');
    expect(tabPane(f.snapshot, 'w1:t2', memory)).toBe(split);
    split.terminal_id = 'replacement';
    expect(tabPane(f.snapshot, 'w1:t2', memory)).toBe(other);
    f.snapshot.panes = f.snapshot.panes.filter(pane => pane.tab_id !== 'w1:t2');
    expect(workspacePane(f.snapshot, 'w1', memory)).toBe(first);
    expect(readNavigation('{broken')).toEqual(emptyNavigation());
    expect(f.calls.every(row => ['session.snapshot', 'pane.process_info'].includes(row.method))).toBe(true);
  } finally { await f.close(); }
});

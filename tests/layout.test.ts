import { expect, test } from 'bun:test';
import { api } from '../shared/client';
import type { LayoutInput, LayoutResult } from '../shared/layout';
import { createFixture } from './fixture';
import { createBridge } from '../server/server';

test('layout operations use explicit workspace/tab/pane targets and preserve desktop focus', async () => {
  const f = await createFixture();
  const machine = { id: 'test', name: 'test', url: f.url, token: f.config.token };
  const scope = { workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', terminalId: 'term-1' };
  const act = (action: LayoutInput['action'], values = {}) => api<LayoutResult>(machine, '/api/layout?session=default', { body: { ...scope, action, ...values } });
  try {
    const workspace = await act('workspace.create', { label: '手机新空间', cwd: '/tmp/project' });
    expect(workspace.pane?.workspace_id).not.toBe('w1');
    expect(workspace.snapshot.focused_pane_id).toBe('w1:p1');
    const tab = await act('tab.create', { label: '手机新标签' });
    expect(tab.pane?.workspace_id).toBe('w1'); expect(tab.pane?.tab_id).not.toBe(scope.tabId);
    expect(f.calls.find(row => row.method === 'tab.create')?.params).toMatchObject({ workspace_id: 'w1', cwd: '/workspace/mobile-herdr', focus: false });
    const split = await act('pane.split', { direction: 'down' });
    expect(split.pane?.tab_id).toBe(scope.tabId);
    await act('workspace.rename', { label: ' renamed ' });
    await act('tab.rename', { label: '新的 tab' });
    await act('pane.rename', { label: '开发终端' });
    expect(f.snapshot.workspaces[0].label).toBe('renamed');
    expect(f.snapshot.tabs[0].label).toBe('新的 tab');
    expect(f.snapshot.panes[0].label).toBe('开发终端');
    await expect(act('pane.split', { direction: 'down', terminalId: 'old-terminal' })).rejects.toMatchObject({ code: 'agent_changed' });
    await expect(act('tab.create', { workspaceId: 'does-not-exist' })).rejects.toMatchObject({ code: 'workspace_changed' });
    await expect(act('workspace.create', { cwd: 'relative/path' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.calls.filter(row => row.method === 'pane.split')).toHaveLength(1);
  } finally { await f.close(); }
});

test('a layout receipt survives bridge restart and cannot create a second terminal', async () => {
  const f = await createFixture(); let next: ReturnType<typeof createBridge> | undefined;
  const machine = { id: 'test', name: 'test', url: f.url, token: f.config.token };
  const input = { body: { action: 'tab.create', workspaceId: 'w1', label: 'once' }, id: 'layout-create-once' };
  try {
    const first = await api<LayoutResult>(machine, '/api/layout?session=default', input);
    f.bridge.stop(true); next = createBridge(f.config); machine.url = `http://127.0.0.1:${next.port}`;
    const second = await api<LayoutResult>(machine, '/api/layout?session=default', input);
    expect(second.pane?.terminal_id).toBe(first.pane?.terminal_id);
    expect(f.calls.filter(row => row.method === 'tab.create')).toHaveLength(1);
    await expect(api(machine, '/api/layout?session=default', { ...input, body: { ...input.body, label: 'another' } })).rejects.toMatchObject({ code: 'request_conflict' });
  } finally { next?.stop(true); await f.close(); }
});

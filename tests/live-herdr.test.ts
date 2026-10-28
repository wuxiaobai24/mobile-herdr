import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { loadConfig } from '../server/config';
import { createBridge } from '../server/server';
import { rpc } from '../server/rpc';
import { api, panePath } from '../shared/client';
import type { Machine, Snapshot } from '../shared/protocol';
import type { LayoutInput, LayoutResult } from '../shared/layout';

test.skipIf(process.env.MOBILE_HERDR_LIVE !== '1')('real Herdr: same pane PTY survives mobile detach, and input reaches its original shell', async () => {
  const name = `mobile-herdr-test-${Date.now()}`;
  const socket = join(homedir(), '.config/herdr/sessions', name, 'herdr.sock');
  const temporary = await mkdtemp(join(tmpdir(), name));
  const herdr = Bun.spawn(['herdr', '--session', name, 'server'], { stdout: 'ignore', stderr: 'ignore', env: { ...process.env,
    MOBILE_HERDR_STATE: temporary, MOBILE_HERDR_NATIVE_IDENTITY: undefined, MOBILE_HERDR_NATIVE_DIRECTORY: undefined,
    HERDR_SOCKET: undefined, HERDR_SOCKET_PATH: undefined, HERDR_PANE_ID: undefined, HERDR_WORKSPACE_ID: undefined, HERDR_TAB_ID: undefined,
  } });
  let bridge: ReturnType<typeof createBridge> | undefined;
  let ws: WebSocket | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await rpc(socket, 'ping'); ready = true; break; } catch { await Bun.sleep(50); }
    }
    expect(ready).toBe(true);
    const created = await rpc<any>(socket, 'workspace.create', { cwd: temporary, label: 'isolated-mobile-check', focus: false });
    const pane = created.root_pane;
    const config = { ...await loadConfig(), socket, stateDir: temporary, host: '127.0.0.1', port: 0, token: 'isolated-live-test-token-only-32chars' };
    bridge = createBridge(config);
    const machine: Machine = { id: 'live', name: 'live', url: `http://127.0.0.1:${bridge.port}`, token: config.token };
    const before = await api<Snapshot>(machine, '/api/snapshot');
    expect(before.panes[0].terminal_id).toBe(pane.terminal_id);
    let output = '';
    let connected = false;
    ws = new WebSocket(machine.url.replace('http', 'ws') + '/api/terminal'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws!.send(JSON.stringify({ type: 'auth', token: machine.token, session: 'default', pane: pane.pane_id, cols: 60, rows: 24 }));
    ws.onmessage = event => {
      if (typeof event.data === 'string') { const value = JSON.parse(event.data); if (value.type === 'ready') connected = true; }
      else output += new TextDecoder().decode(event.data);
    };
    for (let i = 0; i < 100 && (!connected || !output); i++) await Bun.sleep(50);
    expect(connected).toBe(true);
    ws.send(JSON.stringify({ type: 'input', data: "printf 'MOBILE_%s\\n' 'HERDR_ROUNDTRIP'\r" }));
    let screen = '';
    for (let i = 0; i < 100; i++) {
      const result = await api<any>(machine, panePath('default', pane.pane_id, 'screen') + '&lines=2000');
      screen = result.read.text;
      if (screen.includes('MOBILE_HERDR_ROUNDTRIP')) break;
      await Bun.sleep(50);
    }
    expect(screen).toContain('MOBILE_HERDR_ROUNDTRIP');
    ws.close(); await Bun.sleep(100);
    const after = await api<Snapshot>(machine, '/api/snapshot');
    expect(after.panes[0].terminal_id).toBe(pane.terminal_id);
    expect(after.panes[0].pane_id).toBe(pane.pane_id);
    const layout = (input: LayoutInput) => api<LayoutResult>(machine, '/api/layout?session=default', { body: input });
    const scope = { workspaceId: pane.workspace_id, tabId: pane.tab_id, paneId: pane.pane_id, terminalId: pane.terminal_id };
    const tab = await layout({ ...scope, action: 'tab.create', label: 'mobile-tab', cwd: temporary });
    expect(tab.pane?.workspace_id).toBe(pane.workspace_id);
    expect(tab.pane?.tab_id).not.toBe(pane.tab_id);
    const split = await layout({ ...scope, action: 'pane.split', direction: 'right', cwd: temporary });
    expect(split.pane?.tab_id).toBe(pane.tab_id);
    expect(split.pane?.terminal_id).not.toBe(pane.terminal_id);
    await layout({ ...scope, action: 'workspace.rename', label: 'renamed-space' });
    await layout({ ...scope, action: 'tab.rename', label: 'renamed-tab' });
    const renamed = await layout({ ...scope, action: 'pane.rename', label: 'original-shell' });
    expect(renamed.snapshot.workspaces.find(row => row.workspace_id === pane.workspace_id)?.label).toBe('renamed-space');
    expect(renamed.snapshot.tabs.find(row => row.tab_id === pane.tab_id)?.label).toBe('renamed-tab');
    expect(renamed.snapshot.panes.find(row => row.pane_id === pane.pane_id)?.label).toBe('original-shell');
    const space = await layout({ ...scope, action: 'workspace.create', label: 'mobile-space', cwd: temporary });
    expect(space.pane?.workspace_id).not.toBe(pane.workspace_id);
    expect(space.snapshot.focused_pane_id).toBe(after.focused_pane_id);
  } finally {
    ws?.close(); bridge?.stop(true);
    await rpc(socket, 'server.stop').catch(() => herdr.kill());
    await herdr.exited;
    await rm(temporary, { recursive: true, force: true });
    await rm(join(homedir(), '.config/herdr/sessions', name), { recursive: true, force: true });
  }
}, 20000);

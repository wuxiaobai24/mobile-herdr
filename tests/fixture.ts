import { createServer, type Socket } from 'node:net';
import { mkdtemp, mkdir, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Snapshot } from '../shared/protocol';
import type { BridgeConfig } from '../server/config';
import { createBridge } from '../server/server';

export async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-herdr-test-'));
  const piHome = join(directory, 'pi');
  const transcript = join(piHome, 'sessions/project/conversation.jsonl');
  await mkdir(join(piHome, 'sessions/project'), { recursive: true });
  const records = [
    { type: 'session', id: 'session-original', cwd: '/workspace/mobile-herdr', timestamp: '2026-10-21T14:01:00Z' },
    { type: 'message', id: 'message-1', timestamp: '2026-10-21T14:01:00Z', message: { role: 'user', content: [{ type: 'text', text: '帮我把移动端的会话切换做好，继续使用现有的 Herdr session。' }] } },
    { type: 'message', id: 'message-2', timestamp: '2026-10-21T14:01:03Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'app/session-switcher.tsx' } }] } },
    { type: 'message', id: 'message-3', timestamp: '2026-10-21T14:01:04Z', message: { role: 'toolResult', toolCallId: 'tool-1', content: [{ type: 'text', text: '读取了会话切换组件。' }] } },
    { type: 'message', id: 'message-4', timestamp: '2026-10-21T14:01:10Z', message: { role: 'assistant', content: [{ type: 'text', text: '会话切换已经接好。\n\n手机端现在可以：\n\n- 从抽屉选择工作区和原有 pane\n- 随时切换对话与原始终端\n- 切换后保留每个会话的草稿\n\n连接始终指向开发机上的 **同一个 agent 进程**。\n\n```ts\nconst session = await herdr.attach(paneId);\n```\n\n接下来可以直接在这里继续开发。' }] } },
  ];
  await Bun.write(transcript, records.map(row => JSON.stringify(row)).join('\n') + '\n');
  const snapshot: Snapshot = {
    protocol: 22, version: '0.9.3', focused_pane_id: 'w1:p1',
    workspaces: [
      { workspace_id: 'w1', label: 'mobile-herdr', number: 1, agent_status: 'idle', active_tab_id: 'w1:t1' },
      { workspace_id: 'w2', label: 'payments-api', number: 2, agent_status: 'working', active_tab_id: 'w2:t1' },
      { workspace_id: 'w3', label: 'design-system', number: 3, agent_status: 'blocked', active_tab_id: 'w3:t1' },
    ],
    tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Agent', number: 1 }, { tab_id: 'w2:t1', workspace_id: 'w2', label: 'Agent', number: 1 }, { tab_id: 'w3:t1', workspace_id: 'w3', label: 'Agent', number: 1 }],
    panes: [
      { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1', terminal_id: 'term-1', agent: 'pi', agent_status: 'idle', agent_session: { source: 'herdr:pi', agent: 'pi', kind: 'path', value: transcript }, cwd: '/workspace/mobile-herdr', terminal_title_stripped: '移动端会话切换', revision: 1, focused: true },
      { pane_id: 'w2:p1', tab_id: 'w2:t1', workspace_id: 'w2', terminal_id: 'term-2', agent: 'codex', agent_status: 'working', cwd: '/workspace/payments-api', terminal_title_stripped: '修复 webhook 重试', revision: 1, focused: false },
      { pane_id: 'w3:p1', tab_id: 'w3:t1', workspace_id: 'w3', terminal_id: 'term-3', agent: 'claude', agent_status: 'blocked', cwd: '/workspace/design-system', terminal_title_stripped: '更新组件主题', revision: 1, focused: false },
    ],
  };
  const calls: { method: string; params: any }[] = [];
  let foregroundPid = 100;
  const sockets = new Set<Socket>();
  const socketPath = join(directory, 'herdr.sock');
  const api = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = ''; socket.setEncoding('utf8');
    socket.on('data', async chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.trim()); buffer = '';
      calls.push(request);
      const { params, method } = request;
      let result: unknown;
      let error: unknown;
      const pane = snapshot.panes.find(pane => pane.pane_id === (params.pane_id ?? params.target));
      if (method === 'session.snapshot') result = { type: 'session_snapshot', snapshot };
      else if (method === 'pane.process_info') result = { process_info: { foreground_processes: [{ pid: foregroundPid }] } };
      else if (method === 'pane.read') result = { type: 'pane_read', read: { text: '原始终端输出', revision: 1, truncated: false } };
      else if (method === 'agent.prompt') {
        if (pane?.agent_status === 'blocked') error = { code: 'agent_blocked', message: 'Agent is waiting for an approval.' };
        else {
          await appendFile(transcript, JSON.stringify({ type: 'message', id: 'sent-' + calls.length, timestamp: new Date().toISOString(), message: { role: 'user', content: params.text } }) + '\n');
          result = { type: 'agent_prompt_submitted', submitted: true };
        }
      } else if (method === 'pane.send_keys') result = { type: 'pane_keys_sent' };
      else error = { code: 'unknown_method', message: method };
      socket.write(JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }) + '\n');
    });
  });
  await new Promise<void>(resolve => api.listen(socketPath, resolve));
  const config: BridgeConfig = { host: '127.0.0.1', port: 0, name: 'MacBook Pro', token: 'test-only-32-character-access-key', origins: [], herdrHome: directory, socket: socketPath, stateDir: directory, codexHome: join(directory, 'codex'), claudeHome: join(directory, 'claude'), piHome };
  const bridge = createBridge(config);
  return {
    config, snapshot, calls, directory, transcript, bridge, url: `http://127.0.0.1:${bridge.port}`,
    setForegroundPid(pid: number) { foregroundPid = pid; },
    async close() { bridge.stop(true); for (const socket of sockets) socket.destroy(); api.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import type { LayoutInput, LayoutResult } from '../shared/layout';
import type { Pane, Snapshot } from '../shared/protocol';
import { BridgeError, rpc } from './rpc';

export async function layoutChange(stateDir: string, socket: string, id: string, input: LayoutInput): Promise<LayoutResult> {
  const root = join(stateDir, 'layout-receipts');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(socket + '\0' + id).digest('hex');
  const path = join(root, key + '.json'), fingerprint = JSON.stringify(input);
  try { await writeFile(path, JSON.stringify({ fingerprint, pending: true }), { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.fingerprint !== fingerprint) throw new BridgeError('request_conflict', '此请求 ID 已用于其他布局操作。', 409);
    if (saved.result) return saved.result;
    if (saved.error) throw new BridgeError(saved.error.code, saved.error.message, saved.error.status);
    throw new BridgeError('delivery_unknown', '上次创建结果未确认，请刷新列表核对；不会重复创建。', 409);
  }
  async function finish(value: object): Promise<void> { await writeFile(path + '.tmp', JSON.stringify({ fingerprint, ...value }), { mode: 0o600 }); await rename(path + '.tmp', path); }
  try { const result = await changeLayout(socket, input); await finish({ result }); return result; }
  catch (error) {
    // A timeout can arrive after Herdr applied the mutation. Leave its receipt pending.
    if (error instanceof BridgeError && !['herdr_timeout', 'herdr_closed', 'herdr_offline', 'delivery_unknown'].includes(error.code)) await finish({ error: { code: error.code, message: error.message, status: error.status } });
    throw error;
  }
}

/** Layout writes always name their target; they never use desktop focus. */
export async function changeLayout(socket: string, input: LayoutInput): Promise<LayoutResult> {
  const { snapshot } = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
  const workspace = snapshot.workspaces.find(row => row.workspace_id === input.workspaceId);
  const tab = snapshot.tabs.find(row => row.tab_id === input.tabId && row.workspace_id === input.workspaceId);
  const pane = snapshot.panes.find(row => row.pane_id === input.paneId && row.workspace_id === input.workspaceId && row.tab_id === input.tabId);
  const create = input.action === 'workspace.create' || input.action === 'tab.create' || input.action === 'pane.split';
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 120 || /[\x00-\x1f]/.test(input.label))) throw new BridgeError('invalid_input', '名称不能包含控制字符，最多 120 个字符。', 400);
  if (input.cwd !== undefined && (typeof input.cwd !== 'string' || input.cwd.length > 4096 || input.cwd !== '' && !isAbsolute(input.cwd) || /[\x00-\x1f]/.test(input.cwd))) throw new BridgeError('invalid_input', '请输入开发机上的绝对目录。', 400);
  if (!workspace && (input.action !== 'workspace.create' || input.workspaceId)) throw new BridgeError('workspace_changed', '原工作区已关闭，请重新选择。', 409);
  if (['tab.rename', 'pane.split', 'pane.rename'].includes(input.action) && !tab) throw new BridgeError('tab_changed', '原标签页已关闭，请重新选择。', 409);
  if (['pane.split', 'pane.rename'].includes(input.action) && (!pane || pane.terminal_id !== input.terminalId)) throw new BridgeError('agent_changed', '原终端已变化，请重新选择。', 409);
  const label = input.label?.trim();
  const cwd = input.cwd?.trim() || pane?.foreground_cwd || pane?.cwd;
  let result: { root_pane?: Pane; pane?: Pane } = {};
  switch (input.action) {
    case 'workspace.create': result = await rpc(socket, 'workspace.create', { ...(workspace ? { source_workspace_id: workspace.workspace_id } : {}), ...(cwd ? { cwd } : {}), ...(label ? { label } : {}), focus: false }); break;
    case 'tab.create': result = await rpc(socket, 'tab.create', { workspace_id: workspace!.workspace_id, ...(cwd ? { cwd } : {}), ...(label ? { label } : {}), focus: false }); break;
    case 'pane.split':
      if (!['right', 'down'].includes(input.direction ?? '')) throw new BridgeError('invalid_input', '分屏方向无效。', 400);
      result = await rpc(socket, 'pane.split', { workspace_id: workspace!.workspace_id, target_pane_id: pane!.pane_id, direction: input.direction, ...(cwd ? { cwd } : {}), focus: false }); break;
    case 'workspace.rename':
      if (!label) throw new BridgeError('invalid_input', '请输入工作区名称。', 400);
      await rpc(socket, 'workspace.rename', { workspace_id: workspace!.workspace_id, label }); break;
    case 'tab.rename':
      if (!label) throw new BridgeError('invalid_input', '请输入标签页名称。', 400);
      await rpc(socket, 'tab.rename', { tab_id: tab!.tab_id, label }); break;
    case 'pane.rename': await rpc(socket, 'pane.rename', { pane_id: pane!.pane_id, label: label || null }); break;
    default: throw new BridgeError('invalid_input', '不支持此布局操作。', 400);
  }
  const created = result.root_pane ?? result.pane;
  if (create && !created?.pane_id) throw new BridgeError('delivery_unknown', 'Herdr 未返回新终端标识，请刷新会话列表核对结果，不要重复创建。', 409);
  const next = await rpc<{ snapshot: Snapshot }>(socket, 'session.snapshot');
  return { snapshot: next.snapshot, ...(created ? { pane: created } : {}) };
}

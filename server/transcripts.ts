import { Database } from 'bun:sqlite';
import { open, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { Conversation, Pane, TranscriptCandidate, HistoryPage } from '../shared/protocol';
import type { BridgeConfig } from './config';
import { BridgeError, rpc } from './rpc';
import { historyIdentity, historyCursor, decodeCursor } from './history';
import { parseTranscript } from './transcript-parser';

interface Candidate extends TranscriptCandidate { path: string }
interface Binding { path: string; agent: string; identity: string }
const MAX_BYTES = 8 * 1024 * 1024;

export class Transcripts {
  private bindings = new Map<string, Binding>();
  private latest = new Map<string, { signature: string; chat: Conversation }>();
  constructor(private config: BridgeConfig) {}

  private root(agent: string): string | null {
    switch (agent) {
      case 'codex': return join(this.config.codexHome, 'sessions');
      case 'claude': return join(this.config.claudeHome, 'projects');
      case 'pi': return join(this.config.piHome, 'sessions');
      default: return null;
    }
  }

  private async trustedPath(agent: string, path: string): Promise<string | null> {
    const root = this.root(agent);
    if (!root || !path.endsWith('.jsonl')) return null;
    try {
      const canonical = await realpath(path);
      const relation = relative(await realpath(root), canonical);
      if (relation.startsWith('..') || isAbsolute(relation)) return null;
      return canonical;
    } catch { return null; }
  }

  private async files(agent: string): Promise<string[]> {
    const root = this.root(agent);
    if (!root || !(await stat(root).catch(() => null))) return [];
    const paths: string[] = [];
    for await (const path of new Bun.Glob('**/*.jsonl').scan({ cwd: root, absolute: true, onlyFiles: true })) {
      paths.push(path);
      if (paths.length >= 10000) break;
    }
    return paths;
  }

  private async head(path: string): Promise<string> {
    return Bun.file(path).slice(0, 65536).text();
  }

  async candidates(pane: Pane): Promise<Candidate[]> {
    const agent = pane.agent;
    const cwd = pane.foreground_cwd ?? pane.cwd;
    if (!agent || !cwd || !this.root(agent)) return [];
    let paths: { path: string; title?: string; id?: string }[] = [];
    if (agent === 'codex') {
      // Use the agent's own index. Never choose "newest in cwd" as an identity.
      let database: Database | undefined;
      try {
        database = new Database(join(this.config.codexHome, 'state_5.sqlite'), { readonly: true });
        const rows = database.query('SELECT id, rollout_path, title FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 30').all(cwd) as { id: string; rollout_path: string; title: string }[];
        paths = rows.map(row => ({ path: row.rollout_path, title: row.title, id: row.id }));
      } catch {
        for (const path of (await this.files(agent)).reverse().slice(0, 300)) {
          const line = (await this.head(path)).split('\n')[0];
          try { const meta = JSON.parse(line).payload; if (meta?.cwd === cwd) paths.push({ path, id: meta.id }); } catch { /* Truncated/in-progress record. */ }
        }
      } finally { database?.close(); }
    } else {
      const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
      const files = (await this.files(agent)).filter(path => agent === 'pi' || path.includes(`/${encoded}/`));
      for (const path of files.slice(-100)) {
        const lines = (await this.head(path)).split('\n');
        let matches = agent === 'claude';
        for (const line of lines) {
          try { const row = JSON.parse(line); if (row.cwd === cwd) matches = true; } catch { /* Incomplete tail. */ }
        }
        if (matches) paths.push({ path });
      }
    }
    const result: Candidate[] = [];
    for (const entry of paths) {
      const path = await this.trustedPath(agent, entry.path);
      if (!path) continue;
      const info = await stat(path);
      const id = entry.id ?? path.split('/').pop()!.replace('.jsonl', '');
      result.push({ id, path, agent, title: entry.title?.slice(0, 100) || id, updated: info.mtimeMs });
    }
    return result.sort((a, b) => b.updated - a.updated).slice(0, 20);
  }

  private async identity(socket: string, pane: Pane): Promise<string> {
    const result = await rpc<{ process_info: { foreground_process_group_id?: number; foreground_processes?: { pid: number }[] } }>(socket, 'pane.process_info', { pane_id: pane.pane_id });
    const pid = result.process_info.foreground_process_group_id ?? result.process_info.foreground_processes?.[0]?.pid ?? '';
    // Also invalidates a manual binding when a process in the same terminal is replaced.
    return `${pane.terminal_id}:${pane.agent}:${pid}`;
  }

  async bind(socket: string, pane: Pane, candidateId: string): Promise<void> {
    const candidate = (await this.candidates(pane)).find(item => item.id === candidateId);
    if (!candidate) throw new BridgeError('transcript_not_found', '聊天记录已变化，请刷新后重新选择。', 404);
    this.bindings.set(`${socket}:${pane.pane_id}`, { path: candidate.path, agent: candidate.agent, identity: await this.identity(socket, pane) });
  }

  private async locate(socket: string, pane: Pane): Promise<{ path: string | null; binding: Conversation['binding'] }> {
    let path: string | null = null;
    let binding: Conversation['binding'] = 'none';
    const agent = pane.agent ?? '';
    const reference = pane.agent_session;
    if (reference && reference.agent === agent && this.root(agent)) {
      if (reference.kind === 'path') path = await this.trustedPath(agent, reference.value);
      else if (/^[a-zA-Z0-9_-]{1,128}$/.test(reference.value)) {
        const files = (await this.files(agent)).filter(file => file.endsWith(`${reference.value}.jsonl`));
        if (files.length === 1) path = await this.trustedPath(agent, files[0]);
      }
      if (path) binding = 'reported';
    }
    const selected = this.bindings.get(`${socket}:${pane.pane_id}`);
    if (!path && selected) {
      if (selected.agent === agent && selected.identity === await this.identity(socket, pane)) {
        path = await this.trustedPath(agent, selected.path); binding = 'selected';
      } else this.bindings.delete(`${socket}:${pane.pane_id}`);
    }
    return { path, binding };
  }
  async read(socket: string, pane: Pane): Promise<Conversation> {
    const { path, binding } = await this.locate(socket, pane);
    if (!path) return { source: 'unavailable', messages: [], binding: 'none', candidates: (await this.candidates(pane)).map(({ path: _, ...candidate }) => candidate), truncated: false };
    const info = await stat(path), signature = JSON.stringify([socket, pane.terminal_id, pane.agent_session, info.ino, info.size, info.mtimeMs, binding]);
    const cached = this.latest.get(path); if (cached?.signature === signature) return cached.chat;
    const page = await this.page(socket, pane);
    const { messages, ...history } = page;
    const chat: Conversation = { source: pane.agent as Conversation['source'], binding, candidates: [], messages, history, truncated: page.hasMore || !!page.limited };
    if (this.latest.size >= 32) this.latest.delete(this.latest.keys().next().value!);
    this.latest.set(path, { signature, chat }); return chat;
  }
  async page(socket: string, pane: Pane, cursor?: string): Promise<HistoryPage> {
    const { path } = await this.locate(socket, pane);
    if (!path) throw new BridgeError('transcript_unbound', '请先选择当前 pane 的聊天记录。', 409);
    const info = await stat(path);
    const identity = historyIdentity([socket, pane.terminal_id, pane.agent, pane.agent_session, path, info.ino, info.birthtimeMs]);
    const position = cursor ? decodeCursor(cursor, identity) : info.size;
    if (!Number.isSafeInteger(position) || Number(position) < 0 || Number(position) > info.size) throw new BridgeError('history_changed', '历史文件已变化，请重新打开对话。', 409);
    const end = Number(position), start = Math.max(0, end - MAX_BYTES);
    const file = await open(path, 'r');
    let buffer: Buffer;
    try { buffer = Buffer.alloc(end - start); const result = await file.read(buffer, 0, buffer.length, start); buffer = buffer.subarray(0, result.bytesRead); }
    finally { await file.close(); }
    let offset = start;
    if (start > 0) { const boundary = buffer.indexOf(10); if (boundary < 0) return { identity, messages: [], hasMore: true, cursor: historyCursor(identity, start), limited: true }; offset += boundary + 1; buffer = buffer.subarray(boundary + 1); }
    const lines = buffer.toString('utf8').split('\n').slice(0, -1), positions = new Map<string, number>();
    const parsed = parseTranscript(lines, pane.agent ?? '', { offset, positions });
    const messages: Conversation['messages'] = [];
    let bytes = 0;
    for (let i = parsed.length - 1; i >= 0 && messages.length < 60; i--) {
      const row = parsed[i], text = row.text.length > 64000 ? '…\n' + row.text.slice(-64000) : row.text;
      const message = { ...row, text, ...(text !== row.text ? { truncated: true } : {}) }, size = Buffer.byteLength(JSON.stringify(message));
      if (bytes + size > 256000 && messages.length) break;
      messages.unshift(message); bytes += size;
    }
    const earlier = messages.length ? positions.get(messages[0].id)! : start;
    const hasMore = start > 0 || parsed.length > messages.length;
    return { identity, messages, hasMore, cursor: hasMore ? historyCursor(identity, earlier) : undefined };
  }
}

import { Database } from 'bun:sqlite';
import { open, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { Conversation, Pane, TranscriptCandidate } from '../shared/protocol';
import type { BridgeConfig } from './config';
import { BridgeError, rpc } from './rpc';
import { parseTranscript } from './transcript-parser';

interface Candidate extends TranscriptCandidate { path: string }
interface Binding { path: string; agent: string; identity: string }
const MAX_BYTES = 8 * 1024 * 1024;

export class Transcripts {
  private bindings = new Map<string, Binding>();
  private cache = new Map<string, { mtime: number; size: number; messages: Conversation['messages']; truncated: boolean }>();
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

  async read(socket: string, pane: Pane): Promise<Conversation> {
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
    if (!path) {
      const candidates = (await this.candidates(pane)).map(({ path: _path, ...candidate }) => candidate);
      return { source: 'unavailable', messages: [], binding: 'none', candidates, truncated: false };
    }
    const info = await stat(path);
    const cached = this.cache.get(path);
    if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) {
      return { source: agent as Conversation['source'], binding, candidates: [], messages: cached.messages, truncated: cached.truncated };
    }
    const file = await open(path, 'r');
    let text: string;
    try {
      const start = Math.max(0, info.size - MAX_BYTES);
      const buffer = Buffer.alloc(Math.min(info.size, MAX_BYTES));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      text = buffer.subarray(0, bytesRead).toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally { await file.close(); }
    // Ignore the last record until its terminating newline has been written.
    const lines = text.split('\n').slice(0, -1);
    const parsed = parseTranscript(lines, agent);
    const messages: Conversation['messages'] = [];
    let bytes = 0;
    let limited = false;
    // Bound the initial phone payload as well as the filesystem read.
    for (let index = parsed.length - 1; index >= 0; index--) {
      const item = parsed[index];
      const text = item.text.length > 64000 ? '…\n' + item.text.slice(-64000) : item.text;
      limited ||= text !== item.text;
      const message = { ...item, text };
      const size = Buffer.byteLength(JSON.stringify(message));
      if (bytes + size > 256 * 1024) { limited = true; break; }
      bytes += size; messages.unshift(message);
    }
    const truncated = limited || info.size > MAX_BYTES || parsed.length >= 500;
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(path, { mtime: info.mtimeMs, size: info.size, messages, truncated });
    return { source: agent as Conversation['source'], binding, candidates: [], messages, truncated };
  }
}

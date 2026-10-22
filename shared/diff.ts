export interface DiffLine { type: 'context' | 'add' | 'remove' | 'hunk' | 'meta'; text: string; old?: number; next?: number }
export interface FileDiff { path: string; previousPath?: string; status: 'add' | 'delete' | 'modify' | 'rename'; lines: DiffLine[]; added: number; removed: number; patch: string; truncated: boolean; snippet?: boolean }
function pathName(value: string): string { return value.replace(/\t.*$/, '').replace(/^[ab]\//, '').replace(/^"|"$/g, ''); }
/** Display only supplied patch data. Paths are labels, never filesystem requests. */
export function parseDiff(text: string): FileDiff[] {
  const capped = text.length > 512000;
  if (capped) text = text.slice(0, 512000) + '\n…';
  const files: FileDiff[] = [];
  let file: FileDiff | undefined, old: number | undefined, next: number | undefined;
  let inHunk = false;
  function begin(path: string, status: FileDiff['status'] = 'modify'): void {
    file = { path, status, lines: [], added: 0, removed: 0, patch: '', truncated: false }; files.push(file); old = next = undefined; inHunk = false;
  }
  const rows = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.startsWith('diff --git ')) { begin(row.slice(11).replace(/^a\/.*? b\//, '')); file!.patch += row + '\n'; continue; }
    const apply = row.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (apply) { begin(apply[2], apply[1] === 'Add' ? 'add' : apply[1] === 'Delete' ? 'delete' : 'modify'); file!.patch += row + '\n'; inHunk = true; continue; }
    if (row.startsWith('--- ') && rows[i + 1]?.startsWith('+++ ')) {
      const previous = pathName(row.slice(4)), path = pathName(rows[++i].slice(4));
      if (!file || file.lines.length) begin(path === '/dev/null' ? previous : path);
      file!.path = path === '/dev/null' ? previous : path;
      file!.status = previous === '/dev/null' ? 'add' : path === '/dev/null' ? 'delete' : previous !== path ? 'rename' : 'modify';
      if (previous !== path && previous !== '/dev/null') file!.previousPath = previous;
      file!.patch += row + '\n' + rows[i] + '\n'; continue;
    }
    if (!file) continue;
    file.patch += row + '\n';
    const hunk = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk || row.startsWith('@@')) { old = hunk ? Number(hunk[1]) : undefined; next = hunk ? Number(hunk[2]) : undefined; inHunk = true; file.lines.push({ type: 'hunk', text: row }); continue; }
    if (/^(?:new file mode|deleted file mode|rename from|rename to|Binary files)/.test(row)) {
      if (row.startsWith('new file')) file.status = 'add';
      if (row.startsWith('deleted file')) file.status = 'delete';
      if (row.startsWith('rename from')) { file.previousPath = row.slice(12); file.status = 'rename'; }
      if (row.startsWith('rename to')) file.path = row.slice(10);
      file.lines.push({ type: 'meta', text: row }); continue;
    }
    if (inHunk && /^[ +\-\\]/.test(row) && !row.startsWith('*** End')) {
      const type = row[0] === '+' ? 'add' : row[0] === '-' ? 'remove' : row[0] === ' ' ? 'context' : 'meta';
      const line: DiffLine = { type, text: type === 'meta' ? row : row.slice(1) };
      if (type === 'add') { line.next = next; if (next !== undefined) next++; file.added++; }
      if (type === 'remove') { line.old = old; if (old !== undefined) old++; file.removed++; }
      if (type === 'context') { line.old = old; line.next = next; if (old !== undefined) old++; if (next !== undefined) next++; }
      if (file.lines.length < 4000) file.lines.push(line); else file.truncated = true;
    }
  }
  if (capped && file) file.truncated = true;
  return files.filter(file => file.lines.length || file.status !== 'modify');
}
export function suppliedChanges(value: unknown): FileDiff[] {
  if (typeof value === 'string') {
    const parsed = parseDiff(value); if (parsed.length) return parsed;
    try { return suppliedChanges(JSON.parse(value)); } catch { return []; }
  }
  if (Array.isArray(value)) return value.slice(0, 100).flatMap(suppliedChanges);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, any>;
  if (typeof row.diff === 'string') {
    const parsed = parseDiff(row.diff); if (parsed.length) return parsed;
    if (typeof row.path === 'string' && row.diff.startsWith('@@')) return parseDiff(`--- a/${row.path}\n+++ b/${row.path}\n${row.diff}`);
  }
  for (const key of ['patch', 'input']) if (typeof row[key] === 'string') { const files = parseDiff(row[key]); if (files.length) return files; }
  const path = row.path ?? row.file_path ?? row.filePath;
  const before = row.old_string ?? row.oldText ?? row.old_text;
  const after = row.new_string ?? row.newText ?? row.new_text;
  if (typeof path === 'string' && typeof before === 'string' && typeof after === 'string') {
    const a = before ? before.split('\n') : [], b = after ? after.split('\n') : [];
    return parseDiff(`--- a/${path}\n+++ b/${path}\n@@ -1,${a.length} +1,${b.length} @@\n` + a.map((line: string) => '-' + line).concat(b.map((line: string) => '+' + line)).join('\n')).map(file => ({ ...file, snippet: true }));
  }
  return [];
}

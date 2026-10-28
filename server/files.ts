import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Pane } from '../shared/protocol';
import { MAX_DOWNLOAD_BYTES, type FileListing, type FilePreview, type ProjectFile } from '../shared/files';
import { BridgeError } from './rpc';

const TEXT_LIMIT = 256 * 1024, IMAGE_LIMIT = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
function within(root: string, path: string): boolean { const value = relative(root, path); return !isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep); }
function unavailable(): BridgeError { return new BridgeError('file_unavailable', '文件不存在或无法读取，请刷新目录。', 404); }

export async function projectFiles(pane: Pane, params: URLSearchParams): Promise<FileListing | FilePreview | Response> {
  const cwd = pane.foreground_cwd ?? pane.cwd;
  if (!cwd || !isAbsolute(cwd)) throw new BridgeError('file_root_unavailable', '当前会话尚未报告项目目录。', 409);
  const root = await realpath(cwd).catch(() => { throw unavailable(); });
  if (params.has('root') && params.get('root') !== root) throw new BridgeError('file_root_changed', '会话目录已变化，请重新打开文件浏览。', 409);
  const input = params.get('path') ?? '';
  if (input.includes('\0') || isAbsolute(input) || input.split(/[\\/]/).includes('..')) throw new BridgeError('invalid_file_path', '文件路径无效。', 400);
  const path = await realpath(resolve(root, input)).catch(() => { throw unavailable(); });
  if (!within(root, path)) throw new BridgeError('file_outside_project', '此链接指向项目目录之外，无法打开。', 403);
  const mode = params.get('mode');
  if (mode && !['preview', 'download'].includes(mode)) throw new BridgeError('invalid_file_mode', '文件操作无效。', 400);
  if (!mode) {
    const entries: ProjectFile[] = [];
    const directory = await opendir(path).catch(() => { throw unavailable(); });
    let truncated = false;
    for await (const entry of directory) {
      if (entries.length >= 1000) { truncated = true; break; }
      const entryPath = resolve(path, entry.name);
      let kind: ProjectFile['kind'] = 'blocked', size: number | undefined;
      const actual = await realpath(entryPath).catch(() => undefined);
      if (actual && within(root, actual)) {
        const info = await stat(actual).catch(() => undefined);
        if (info?.isDirectory()) kind = 'directory';
        else if (info?.isFile()) { kind = 'file'; size = info.size; }
      }
      entries.push({ name: entry.name, path: relative(root, entryPath).split(sep).join('/'), kind, size });
    }
    entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
    return { root, path: input, entries, truncated };
  }
  // Nonblocking open rejects special files without ever waiting on a FIFO.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw unavailable(); });
  let streamed = false;
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new BridgeError('not_regular_file', '只能预览或下载普通文件。', 400);
    // Resolve the opened descriptor on Linux to fence directory/symlink swaps.
    const actual = await realpath(process.platform === 'linux' ? `/proc/self/fd/${file.fd}` : path).catch(() => '');
    if (!actual || !within(root, actual)) throw new BridgeError('file_outside_project', '文件位置已变化，请刷新目录。', 403);
    const name = basename(input), mime = IMAGE_TYPES[extname(name).toLowerCase()];
    if (mode === 'download') {
      if (info.size > MAX_DOWNLOAD_BYTES) throw new BridgeError('file_too_large', '手机端暂支持下载 100 MB 以内的文件。', 413);
      let offset = 0, closed = false;
      async function close(): Promise<void> { if (!closed) { closed = true; await file.close(); } }
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const bytes = Buffer.alloc(Math.min(65536, info.size - offset));
            if (!bytes.length) { await close(); controller.close(); return; }
            const read = await file.read(bytes, 0, bytes.length, offset);
            if (!read.bytesRead) throw new Error('File changed during download');
            offset += read.bytesRead; controller.enqueue(bytes.subarray(0, read.bytesRead));
          } catch (error) { await close(); controller.error(error); }
        },
        cancel: close,
      });
      streamed = true;
      const encoded = encodeURIComponent(name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16));
      return new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(info.size), 'x-file-size': String(info.size), 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encoded}` } });
    }
    const result: FilePreview = { name, path: input, size: info.size, kind: 'binary', truncated: false };
    if (mime && info.size <= IMAGE_LIMIT) {
      const bytes = Buffer.alloc(info.size), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      return { ...result, kind: 'image', uri: `data:${mime};base64,${bytes.subarray(0, bytesRead).toString('base64')}` };
    }
    if (mime) return result;
    const bytes = Buffer.alloc(Math.min(info.size, TEXT_LIMIT)), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const data = bytes.subarray(0, bytesRead);
    if (data.includes(0)) return result;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: info.size > TEXT_LIMIT });
      return { ...result, kind: 'text', text, truncated: info.size > TEXT_LIMIT };
    } catch { return result; }
  } finally { if (!streamed) await file.close(); }
}

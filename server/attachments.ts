import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type Attachment } from '../shared/attachments';
import { BridgeError } from './rpc';

export interface AttachmentScope { socket: string; terminal: string; conversation?: string }
interface StoredAttachment extends Attachment { scope: AttachmentScope; digest: string }
export interface ResolvedAttachment extends Attachment { path: string }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{8,128}$/.test(value); }
function unavailable(): BridgeError { return new BridgeError('attachment_unavailable', '附件已不可用或不属于当前会话，请移除后重新上传。', 409); }
function directory(stateDir: string, id: string): string { return join(stateDir, 'attachments', id); }
function detectMime(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}
export async function uploadAttachment(stateDir: string, scope: AttachmentScope, id: string, input: Record<string, unknown>): Promise<Attachment> {
  if (!validId(id) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || /[\x00-\x1f/\\]/.test(input.name)) throw new BridgeError('invalid_input', '附件名称无效。', 400);
  if (typeof input.base64 !== 'string' || input.base64.length % 4 !== 0 || input.base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new BridgeError('invalid_input', '附件格式无效或超过 8 MB。', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new BridgeError('invalid_input', '每个附件须小于 8 MB。', 413);
  const value: StoredAttachment = { id, name: input.name, size: bytes.length, mime: detectMime(bytes), scope, digest: createHash('sha256').update(bytes).digest('hex') };
  const dir = directory(stateDir, id);
  await mkdir(join(stateDir, 'attachments'), { recursive: true, mode: 0o700 });
  try { await mkdir(dir, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const prior = await readFile(join(dir, 'metadata.json'), 'utf8').catch(() => '');
    if (prior !== JSON.stringify(value)) throw new BridgeError('request_conflict', '附件请求 ID 已用于其他文件。', 409);
    return { id, name: value.name, size: value.size, mime: value.mime };
  }
  await writeFile(join(dir, 'file-' + value.name), bytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  return { id, name: value.name, size: value.size, mime: value.mime };
}
export async function resolveAttachments(stateDir: string, scope: AttachmentScope, ids: unknown, history = false): Promise<ResolvedAttachment[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || !ids.every(validId) || new Set(ids).size !== ids.length) throw new BridgeError('invalid_input', '附件选择无效，最多选择 6 个附件。', 400);
  return Promise.all(ids.map(async id => {
    try {
      const dir = directory(stateDir, id), value = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8')) as StoredAttachment;
      if (value.scope.socket !== scope.socket || value.scope.terminal !== scope.terminal || !history && value.scope.conversation !== scope.conversation) throw unavailable();
      const path = join(dir, 'file-' + value.name), info = await stat(path);
      if (!info.isFile() || info.size !== value.size) throw unavailable();
      return { id, name: value.name, size: value.size, mime: value.mime, path };
    } catch { throw unavailable(); }
  }));
}
export function attachmentPrompt(text: string, files: ResolvedAttachment[]): string {
  if (!files.length) return text;
  return `${text || '请查看附件。'}\n\n用户上传的附件（开发机文件路径）：\n${files.map(file => JSON.stringify({ name: file.name, path: file.path, mime: file.mime })).join('\n')}`;
}

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_DOWNLOAD_BYTES } from '../shared/files';
import { BridgeError } from './rpc';
export async function androidDownload(root: string, mode: string | null): Promise<object | Response> {
  const file = Bun.file(join(root, 'artifacts/android/mobile-herdr.apk'));
  if (!await file.exists()) {
    if (mode === 'download') throw new BridgeError('apk_unavailable', '此开发机未提供 APK，请打开发布页下载。', 404);
    return { available: false };
  }
  if (file.size > MAX_DOWNLOAD_BYTES) throw new BridgeError('file_too_large', 'APK 超过下载限制。', 413);
  const metadata = await Bun.file(join(root, 'artifacts/android/mobile-herdr.apk.json')).json().catch(() => undefined);
  if (mode === 'download') return new Response(file, { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(file.size), 'x-file-size': String(file.size), 'content-disposition': 'attachment; filename="mobile-herdr.apk"' } });
  return { available: true, size: file.size, version: metadata?.size === file.size ? metadata.version : undefined,
    sha256: createHash('sha256').update(await file.bytes()).digest('hex') };
}

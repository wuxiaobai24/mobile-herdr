import type { Machine } from '../shared/protocol';
import { receiveDownload, type DownloadOptions, type DownloadResult } from '../shared/download';
export async function saveProjectFile(machine: Machine, path: string, name: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  await receiveDownload(machine, path, bytes => { chunks.push(new Uint8Array(bytes)); }, options);
  if (options.signal?.aborted) return 'cancelled';
  const blob = new Blob(chunks, { type: 'application/octet-stream' }), url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'handed-off';
}

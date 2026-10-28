import type { Machine } from './protocol';
import { ApiError } from './client';
import { MAX_DOWNLOAD_BYTES, fileSize } from './files';
export interface DownloadProgress { phase: 'downloading' | 'choosing' | 'saving'; loaded: number; total?: number }
export type DownloadResult = 'saved' | 'handed-off' | 'cancelled';
export type DownloadFetcher = (url: string, options: { headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'body' | 'json'>>;
export interface DownloadOptions { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void }
export function downloadLabel(progress: DownloadProgress): string {
  if (progress.phase === 'choosing') return '下载完成，请选择保存位置…';
  const amount = progress.total ? `${Math.min(100, Math.floor(progress.loaded / progress.total * 100))}% · ${fileSize(progress.loaded)} / ${fileSize(progress.total)}` : fileSize(progress.loaded);
  return `${progress.phase === 'saving' ? '正在保存' : '正在下载'} · ${amount}`;
}
export function downloadResultLabel(result: DownloadResult): string {
  if (result === 'saved') return '文件已保存。';
  if (result === 'cancelled') return '已取消保存。';
  return '已交给浏览器下载，请查看浏览器下载列表。';
}
/** Header-authenticated bounded stream; a timeout measures inactivity, not total file time. */
export async function receiveDownload(machine: Machine, path: string, write: (bytes: Uint8Array) => void | Promise<void>, options: DownloadOptions = {}, fetcher: DownloadFetcher = fetch): Promise<number> {
  const controller = new AbortController();
  let timedOut = false, loaded = 0;
  let timer: ReturnType<typeof setTimeout>;
  function reset(): void { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000); }
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    options.onProgress?.({ phase: 'downloading', loaded: 0 }); reset();
    const response = await fetcher(machine.url + path, { headers: { Authorization: `Bearer ${machine.token}`, ...(machine.remote ? { 'X-Herdr-Machine': machine.remote } : {}) }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new ApiError(value?.error?.code ?? 'download_failed', value?.error?.message ?? `下载失败（${response.status}），请重试。`, response.status);
    }
    const length = response.headers.get('content-length') ?? response.headers.get('x-file-size');
    const total = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
    if (total !== undefined && (!Number.isSafeInteger(total) || total > MAX_DOWNLOAD_BYTES)) throw new Error('文件超过 100 MB 下载限制。');
    if (!response.body) throw new Error('下载响应没有文件内容，请重试。');
    reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error('aborted');
      if (done) break;
      loaded += value.byteLength;
      if (loaded > MAX_DOWNLOAD_BYTES) throw new Error('文件超过 100 MB 下载限制。');
      await write(value); reset();
      options.onProgress?.({ phase: 'downloading', loaded, total });
    }
    if (total !== undefined && total !== loaded) throw new Error('下载不完整，请重试。');
    return loaded;
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError('download_cancelled', '已取消下载。');
    if (timedOut) throw new Error('下载已超过 30 秒没有进度，请检查网络后重试。');
    if (error instanceof TypeError) throw new Error('下载连接中断，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timer!); options.signal?.removeEventListener('abort', cancel);
    await reader?.cancel().catch(() => {});
  }
}

import { File, FileMode, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { ResultCode, startActivityAsync } from 'expo-intent-launcher';
import type { Machine } from '../shared/protocol';
import { ApiError, requestId } from '../shared/client';
import { receiveDownload, type DownloadOptions, type DownloadResult } from '../shared/download';
export async function saveProjectFile(machine: Machine, path: string, name: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const temporary = new File(Paths.cache, 'herdr-download-' + requestId());
  try {
    const handle = temporary.open(FileMode.Truncate);
    let size: number;
    try { size = await receiveDownload(machine, path, bytes => handle.writeBytes(bytes), options, expoFetch); }
    finally { handle.close(); }
    if (options.signal?.aborted) return 'cancelled';
    options.onProgress?.({ phase: 'choosing', loaded: size, total: size });
    const result = await startActivityAsync('android.intent.action.CREATE_DOCUMENT', {
      category: 'android.intent.category.OPENABLE', type: name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream', extra: { 'android.intent.extra.TITLE': name }, flags: 3,
    });
    if (result.resultCode === ResultCode.Canceled) return 'cancelled';
    if (result.resultCode !== ResultCode.Success || !result.data?.startsWith('content://')) throw new Error('未能取得保存位置，请重试。');
    const destination = new File(result.data), input = temporary.open(FileMode.ReadOnly);
    let complete = false;
    try {
      const output = destination.open(FileMode.Truncate);
      try {
        let loaded = 0;
        for (;;) {
          if (options.signal?.aborted) throw new ApiError('download_cancelled', '已取消保存。');
          const bytes = await input.readBytes(65536);
          if (!bytes.length) break;
          await output.writeBytes(bytes); loaded += bytes.length;
          options.onProgress?.({ phase: 'saving', loaded, total: size });
        }
        if (loaded !== size) throw new Error('文件未能完整保存，请重试。');
        complete = true;
      } finally { output.close(); }
    } finally { input.close(); if (!complete) { try { destination.delete(); } catch { /* A provider may refuse deletion; never report success. */ } } }
    return 'saved';
  } finally { if (temporary.exists) temporary.delete(); }
}

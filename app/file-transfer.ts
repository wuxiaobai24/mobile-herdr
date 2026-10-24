import { File, FileMode, Paths } from 'expo-file-system';
import { ResultCode, startActivityAsync } from 'expo-intent-launcher';
import type { Machine } from '../shared/protocol';
import { requestId } from '../shared/client';

export async function saveProjectFile(machine: Machine, path: string, name: string): Promise<boolean> {
  const temporary = new File(Paths.cache, 'herdr-download-' + requestId());
  try {
    await File.downloadFileAsync(machine.url + path, temporary, { headers: { Authorization: `Bearer ${machine.token}`, ...(machine.remote ? { 'X-Herdr-Machine': machine.remote } : {}) }, signal: AbortSignal.timeout(120000) });
    const result = await startActivityAsync('android.intent.action.CREATE_DOCUMENT', {
      category: 'android.intent.category.OPENABLE', type: 'application/octet-stream', extra: { 'android.intent.extra.TITLE': name }, flags: 3,
    });
    if (result.resultCode === ResultCode.Canceled) return false;
    if (result.resultCode !== ResultCode.Success || !result.data?.startsWith('content://')) throw new Error('未能取得保存位置，请重试。');
    // Document-provider URIs must be written directly, not copied as filesystem paths.
    const input = temporary.open(FileMode.ReadOnly);
    try {
      const output = new File(result.data).open(FileMode.Truncate);
      try {
        for (;;) {
          const bytes = await input.readBytes(65536);
          if (!bytes.length) break;
          await output.writeBytes(bytes);
        }
      } finally { output.close(); }
    } finally { input.close(); }
    return true;
  } catch {
    throw new Error('文件未能保存，请检查连接和保存位置后重试。');
  } finally { if (temporary.exists) temporary.delete(); }
}

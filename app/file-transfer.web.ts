import type { Machine } from '../shared/protocol';
import { ApiError } from '../shared/client';

export async function saveProjectFile(machine: Machine, path: string, name: string): Promise<boolean> {
  const response = await fetch(machine.url + path, { headers: { Authorization: `Bearer ${machine.token}`, ...(machine.remote ? { 'X-Herdr-Machine': machine.remote } : {}) }, signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new ApiError(value?.error?.code ?? 'download_failed', value?.error?.message ?? '下载失败，请重试。', response.status);
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

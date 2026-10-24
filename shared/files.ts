export interface ProjectFile { name: string; path: string; kind: 'directory' | 'file' | 'blocked'; size?: number }
export interface FileListing { root: string; path: string; entries: ProjectFile[]; truncated: boolean }
export interface FilePreview { name: string; path: string; size: number; kind: 'text' | 'image' | 'binary'; text?: string; uri?: string; truncated: boolean }
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function filePath(session: string, pane: string, path = '', root?: string, mode?: 'preview' | 'download'): string {
  const params = new URLSearchParams({ session, path });
  if (root) params.set('root', root);
  if (mode) params.set('mode', mode);
  return `/api/panes/${encodeURIComponent(pane)}/files?${params}`;
}

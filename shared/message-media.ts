import type { ChatMedia } from './protocol';

/** Only render public image content; no reasoning or system blocks are inspected. */
export function messageMedia(content: unknown): ChatMedia[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((row: any): ChatMedia[] => {
    const path = row.type === 'localImage' || row.type === 'imageView' ? row.path : undefined;
    const url = ['image', 'input_image', 'image_url'].includes(row.type) ? row.url ?? row.image_url?.url ?? (row.source?.type === 'url' ? row.source.url : undefined) : undefined;
    const data = row.data ?? (row.source?.type === 'base64' ? row.source.data : undefined);
    const inline = row.type === 'image' && typeof data === 'string' && data.length < 1024 * 1024 ? `data:${row.mimeType ?? row.mime_type ?? row.source?.media_type ?? 'image/png'};base64,${data}` : undefined;
    if (!path && !url && !inline) return [];
    const attachmentId = typeof path === 'string' ? path.match(/\/attachments\/([\w-]{8,128})\/file-[^/]+$/)?.[1] : undefined;
    return [{ type: 'image', name: row.alt ?? (typeof path === 'string' ? path.split('/').at(-1)?.replace(/^file-/, '') : undefined) ?? '图片',
      ...(attachmentId ? { attachmentId } : path ? { path } : { url: typeof url === 'string' && url.length < 12000000 ? url : inline }) }];
  }).slice(0, 12);
}

export function uploadedPrompt(text: string): { text: string; media: ChatMedia[] } {
  const marker = '\n\n用户上传的附件（开发机文件路径）：\n';
  const index = text.lastIndexOf(marker);
  if (index < 0) return { text, media: [] };
  const media: ChatMedia[] = [];
  for (const line of text.slice(index + marker.length).split('\n')) {
    try {
      const file = JSON.parse(line), id = typeof file.path === 'string' ? file.path.match(/\/attachments\/([\w-]{8,128})\/file-[^/]+$/)?.[1] : undefined;
      if (!id || typeof file.name !== 'string') return { text, media: [] };
      media.push({ type: String(file.mime).startsWith('image/') ? 'image' : 'file', name: file.name, attachmentId: id });
    } catch { return { text, media: [] }; }
  }
  return { text: text.slice(0, index), media };
}

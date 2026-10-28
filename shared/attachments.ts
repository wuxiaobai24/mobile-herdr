export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 6;
export interface Attachment { id: string; name: string; size: number; mime: string }
export interface PickedAttachment { name: string; size: number; mime: string; base64: string }
export function imageMime(name: string): string | undefined {
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[name.split('.').at(-1)?.toLowerCase() ?? ''];
}
export function attachmentSize(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }

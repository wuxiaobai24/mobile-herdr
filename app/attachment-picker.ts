import { File } from 'expo-file-system';
import { getDocumentAsync } from 'expo-document-picker';
import { MAX_ATTACHMENT_BYTES, imageMime, type PickedAttachment } from '../shared/attachments';

export async function pickAttachments(): Promise<PickedAttachment[]> {
  const picked = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (picked.canceled) return [];
  return Promise.all(picked.assets.map(async asset => {
    const file = new File(asset.uri);
    try {
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('每个附件须小于 8 MB。');
      return { name: asset.name, size: file.size, mime: imageMime(asset.name) ?? asset.mimeType ?? 'application/octet-stream', base64: await file.base64() };
    } finally { if (file.exists) file.delete(); }
  }));
}

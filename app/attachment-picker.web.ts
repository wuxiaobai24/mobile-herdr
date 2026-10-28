import { MAX_ATTACHMENT_BYTES, imageMime, type PickedAttachment } from '../shared/attachments';

export async function readAttachments(files: File[]): Promise<PickedAttachment[]> {
  return Promise.all(files.map(async file => {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('每个附件须小于 8 MB。');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('无法读取所选文件。')); reader.readAsDataURL(file);
    });
    return { name: file.name, size: file.size, mime: imageMime(file.name) ?? file.type ?? 'application/octet-stream', base64 };
  }));
}
export function pickAttachments(): Promise<PickedAttachment[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
    input.onchange = () => { void readAttachments([...input.files ?? []]).then(resolve, reject); };
    input.oncancel = () => resolve([]); input.click();
  });
}

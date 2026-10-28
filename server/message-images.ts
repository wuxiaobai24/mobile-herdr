import { basename, dirname, isAbsolute } from 'node:path';
import type { ChatMessage, Pane } from '../shared/protocol';
import { parseMarkdown } from '../shared/markdown';
import { BridgeError } from './rpc';
import { projectFiles } from './files';

/** Outside-project images must have been explicitly reported by this conversation. */
export async function messageImage(pane: Pane, messages: ChatMessage[], path: string) {
  if (!isAbsolute(path) || !/\.(png|jpe?g|gif|webp)$/i.test(path)) throw new BridgeError('invalid_image', '图片路径无效。', 400);
  function mentions(node: any): boolean {
    return node.type === 'image' && node.url === path || Array.isArray(node.children) && node.children.some(mentions);
  }
  if (!messages.some(message => message.media?.some(media => media.type === 'image' && media.path === path) || message.role === 'assistant' && mentions(parseMarkdown(message.text)))) throw new BridgeError('image_unavailable', '当前对话未报告此图片。', 403);
  return projectFiles({ ...pane, cwd: dirname(path), foreground_cwd: dirname(path) }, new URLSearchParams({ path: basename(path), mode: 'preview' }));
}

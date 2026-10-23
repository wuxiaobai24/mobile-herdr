import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
export function parseMarkdown(text: string): Root { return parser.parse(text); }
export function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); if (['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password) return url.href; }
  catch { /* Relative paths and unsupported schemes remain readable text. */ }
}

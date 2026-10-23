import { normalizeUrl } from './client';
import { isValidToken } from './auth';

export interface Pairing { url: string; token: string; name?: string }

/** The CLI's credential handoff stays in the fragment, never in a request URL. */
export function parsePairing(link: string): Pairing | undefined {
  try {
    if (link.length > 24000) return;
    const url = new URL(link);
    if (!['http:', 'https:', 'mobile-herdr:'].includes(url.protocol) || url.search || url.username || url.password) return;
    if (url.protocol === 'mobile-herdr:' && (url.hostname !== 'pair' || url.pathname)) return;
    const encoded = new URLSearchParams(url.hash.slice(1)).get('connect');
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return;
    // Decode without Node Buffer or browser-only TextDecoder (also runs in Hermes).
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0, count = 0, escaped = '';
    for (const char of encoded) {
      bits = (bits << 6) | alphabet.indexOf(char); count += 6;
      if (count >= 8) { count -= 8; escaped += '%' + ((bits >> count) & 255).toString(16).padStart(2, '0'); }
    }
    const value = JSON.parse(decodeURIComponent(escaped));
    if (value.version !== 1 || !isValidToken(value.token)) return;
    return { url: normalizeUrl(value.url), token: value.token, name: typeof value.name === 'string' ? value.name.slice(0, 200) : undefined };
  } catch { return undefined; }
}

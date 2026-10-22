import { normalizeUrl } from '../shared/client';
import { isValidToken } from '../shared/auth';
export interface Pairing { url: string; token: string; name?: string }
export function consumePairing(): Pairing | undefined {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const encoded = fragment.get('connect');
  if (!encoded) return undefined;
  // Clear the fragment before creating any connections or saving the profile.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value.version !== 1 || !isValidToken(value.token)) return undefined;
    return { url: normalizeUrl(value.url), token: value.token, name: typeof value.name === 'string' ? value.name : undefined };
  } catch { return undefined; }
}

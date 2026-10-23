import { parsePairing, type Pairing } from '../shared/pairing';
export type { Pairing } from '../shared/pairing';
export function consumePairing(): Pairing | undefined {
  if (!new URLSearchParams(location.hash.slice(1)).has('connect')) return;
  const link = location.href;
  // Clear the fragment before creating any connections or saving the profile.
  history.replaceState(null, '', location.pathname + location.search);
  return parsePairing(link);
}
export function subscribePairing(_receive: (value: Pairing) => void): () => void { return () => {}; }

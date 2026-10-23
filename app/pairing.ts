import { Linking } from 'react-native';
import { parsePairing, type Pairing } from '../shared/pairing';
export type { Pairing } from '../shared/pairing';
export function consumePairing(): Pairing | undefined { return undefined; }
export function subscribePairing(receive: (value: Pairing) => void): () => void {
  let active = true;
  const accept = (url: string | null | undefined) => { const pairing = url && parsePairing(url); if (active && pairing) receive(pairing); };
  const subscription = Linking.addEventListener('url', event => accept(event.url));
  void Linking.getInitialURL().then(accept).catch(() => {});
  return () => { active = false; subscription.remove(); };
}

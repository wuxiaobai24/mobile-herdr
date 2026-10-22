import * as SecureStore from 'expo-secure-store';
import type { Machine } from '../shared/protocol';

export async function loadMachines(): Promise<Machine[]> {
  const ids: string[] = JSON.parse(await SecureStore.getItemAsync('machine-index') ?? '[]');
  const machines = await Promise.all(ids.map(async id => {
    const value = await SecureStore.getItemAsync(`machine-${id}`);
    return value ? JSON.parse(value) as Machine : null;
  }));
  return machines.filter((item): item is Machine => !!item);
}
export async function saveMachines(machines: Machine[]): Promise<void> {
  const previous: string[] = JSON.parse(await SecureStore.getItemAsync('machine-index') ?? '[]');
  for (const machine of machines) await SecureStore.setItemAsync(`machine-${machine.id}`, JSON.stringify(machine));
  await SecureStore.setItemAsync('machine-index', JSON.stringify(machines.map(machine => machine.id)));
  for (const id of previous) if (!machines.some(machine => machine.id === id)) await SecureStore.deleteItemAsync(`machine-${id}`);
}
// Drafts are not credentials. SecureStore also gives native drafts durable, private storage.
export async function loadDraft(key: string): Promise<string> { return await SecureStore.getItemAsync(`draft-${hash(key)}`) ?? ''; }
export async function saveDraft(key: string, value: string): Promise<void> {
  if (value) await SecureStore.setItemAsync(`draft-${hash(key)}`, value.slice(0, 16000));
  else await SecureStore.deleteItemAsync(`draft-${hash(key)}`);
}
function hash(value: string): string { return Array.from(value).map(char => char.charCodeAt(0).toString(16)).join(''); }

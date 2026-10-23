import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';
import type { Machine } from '../shared/protocol';
import { createDraftStore } from './draft-store';

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
let database: ReturnType<typeof openDraftDatabase> | undefined;
async function openDraftDatabase() {
  const db = await openDatabaseAsync('mobile-herdr.db');
  await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
  return db;
}
function draftDatabase(): ReturnType<typeof openDraftDatabase> {
  database ??= openDraftDatabase().catch(error => { database = undefined; throw error; });
  return database;
}
const drafts = createDraftStore({
  async get(key) { const db = await draftDatabase(); return (await db.getFirstAsync<{ value: string }>('SELECT value FROM drafts WHERE key = ?', key))?.value ?? null; },
  async set(key, value) { const db = await draftDatabase(); await db.runAsync('INSERT INTO drafts (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); },
}, { get: SecureStore.getItemAsync, remove: SecureStore.deleteItemAsync });
export const loadDraft = drafts.load;
export const saveDraft = drafts.save;

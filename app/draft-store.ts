interface DraftDatabase {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
interface LegacyDrafts {
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/** Serialize reads/migration/writes so a late migration cannot restore a cleared draft. */
export function createDraftStore(database: DraftDatabase, legacy: LegacyDrafts) {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  }
  const legacyKey = (key: string) => 'draft-' + Array.from(key).map(char => char.charCodeAt(0).toString(16)).join('');
  return {
    load: (key: string) => serial(async () => {
      const current = await database.get(key);
      if (current !== null) return current;
      const old = await legacy.get(legacyKey(key));
      if (old !== null) {
        await database.set(key, old);
        await legacy.remove(legacyKey(key));
      }
      return old ?? '';
    }),
    save: (key: string, value: string) => serial(async () => {
      // Empty values are tombstones: never resurrect a legacy draft after clearing it.
      await database.set(key, value);
      await legacy.remove(legacyKey(key));
    }),
  };
}

import { type IDBPDatabase, openDB } from "idb";

const STORES = ["app", "artifacts", "checkpoints", "files", "runs"] as const;
export const STORAGE_MIGRATION_MARKER = "storage-migration-complete";

function isTrainerDatabase(database: IDBPDatabase) {
  const stores = Array.from(database.objectStoreNames);
  if (
    !["app", "files", "runs"].every((name) => stores.includes(name)) ||
    !stores.every((name) => STORES.some((store) => store === name))
  )
    return false;
  const transaction = database.transaction(stores, "readonly");
  return stores.every(
    (name) => transaction.objectStore(name).keyPath === (name === "app" ? "key" : "id"),
  );
}

/** Copy an earlier trainer database atomically; leave the source untouched. */
export async function migrateTrainerDatabase(destinationName: string) {
  const destination = await openDB(destinationName);

  const candidates: IDBPDatabase[] = [];
  try {
    if (await destination.get("app", STORAGE_MIGRATION_MARKER)) return;
    if (typeof indexedDB.databases !== "function") {
      throw new Error(
        "This browser cannot locate saved training data. Use a current browser to migrate your workspace.",
      );
    }
    for (const entry of await indexedDB.databases()) {
      if (!entry.name || entry.name === destination.name || !entry.name.endsWith("-browser"))
        continue;
      const database = await openDB(entry.name);
      if (isTrainerDatabase(database)) {
        candidates.push(database);
      } else database.close();
    }
    if (candidates.length > 1) throw new Error("Multiple saved trainer databases need migration.");

    const rows = new Map<string, Record<string, unknown>[]>();
    const source = candidates[0];
    if (source) {
      const available = STORES.filter((name) => source.objectStoreNames.contains(name));
      const snapshot = source.transaction(available, "readonly");
      await Promise.all(
        available.map(async (name) => {
          rows.set(name, await snapshot.objectStore(name).getAll());
        }),
      );
      await snapshot.done;
    }
    const transaction = destination.transaction([...STORES], "readwrite");
    try {
      for (const name of STORES) {
        for (const row of rows.get(name) ?? []) {
          if (name === "app" && typeof row.key === "string") {
            for (const suffix of ["active-file", "active-run"]) {
              if (String(row.key).endsWith(`:${suffix}`)) row.key = `${destination.name}:${suffix}`;
            }
          }
          const store = transaction.objectStore(name);
          const key = row[name === "app" ? "key" : "id"] as IDBValidKey;
          if (!(await store.get(key))) await store.put(row);
        }
      }
      await transaction.objectStore("app").put({ key: STORAGE_MIGRATION_MARKER, value: "1" });
      await transaction.done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A failed IndexedDB request may already have aborted the transaction.
      }
      await transaction.done.catch(() => {});
      throw error;
    }
  } finally {
    destination.close();
    for (const database of candidates) database.close();
  }
}

/** Copy preferences once without changing shared source keys or current values. */
export function migrateLocalPreferences(prefix: string, providedStorage?: Storage) {
  try {
    const storage = providedStorage ?? window.localStorage;
    const marker = `${prefix}:preferences-migrated`;
    if (storage.getItem(marker)) return;
    for (const suffix of ["theme", "training-config"]) {
      const target = `${prefix}:${suffix}`;
      const candidates = Object.keys(storage).filter(
        (key) =>
          key !== target &&
          key.endsWith(`:${suffix}`) &&
          key.slice(0, -suffix.length - 1).endsWith("-browser"),
      );
      if (candidates.length !== 1) continue;
      const source = candidates[0];
      if (storage.getItem(target) === null) storage.setItem(target, storage.getItem(source) ?? "");
    }
    storage.setItem(marker, "1");
  } catch {
    // Storage can be unavailable; keep using in-memory preferences.
  }
}

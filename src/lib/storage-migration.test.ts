import { deleteDB, openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateLocalPreferences, migrateTrainerDatabase } from "@/lib/storage-migration";

const opened: Awaited<ReturnType<typeof openDB>>[] = [];
const names = ["previous-browser", "train-gpt-in-browser", "another-browser"];

async function database(name: string) {
  const db = await openDB(name, 1, {
    upgrade(db) {
      for (const store of ["app", "files", "runs", "checkpoints", "artifacts"]) {
        db.createObjectStore(store, { keyPath: store === "app" ? "key" : "id" });
      }
    },
  });
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await Promise.all(names.map((name) => deleteDB(name)));
});

describe("trainer storage migration", () => {
  it("copies files, checkpoints, artifacts and preferences while preserving the source", async () => {
    const source = await database(names[0]);
    const target = await database(names[1]);
    await source.put("files", { id: "file", content: "alpha\nbeta" });
    await source.put("runs", { id: "run", likes: ["Example"] });
    await source.put("checkpoints", { id: "run", weights: new Float32Array([1, 2]) });
    await source.put("artifacts", {
      id: "export",
      storage: "opfs",
      opfsPath: "exports/run/model.model",
    });
    await source.put("app", { key: "previous-browser:active-file", value: "file" });
    await migrateTrainerDatabase(target.name);
    expect(await target.get("files", "file")).toEqual(await source.get("files", "file"));
    expect(await target.get("runs", "run")).toEqual(await source.get("runs", "run"));
    expect(await target.get("checkpoints", "run")).toEqual(await source.get("checkpoints", "run"));
    expect(await target.get("artifacts", "export")).toEqual(
      await source.get("artifacts", "export"),
    );
    expect(await target.get("app", "train-gpt-in-browser:active-file")).toMatchObject({
      value: "file",
    });
    expect(await source.count("files")).toBe(1);
    // A completed migration must not resurrect data after the user removes it.
    await target.clear("files");
    await migrateTrainerDatabase(target.name);
    expect(await target.count("files")).toBe(0);
  });

  it("preserves newer destination data", async () => {
    const source = await database(names[0]);
    const target = await database(names[1]);
    await source.put("files", { id: "file", content: "earlier" });
    await target.put("files", { id: "file", content: "current" });
    await migrateTrainerDatabase(target.name);
    expect(await target.get("files", "file")).toMatchObject({ content: "current" });
  });

  it("refuses ambiguous source databases without copying data", async () => {
    await database(names[0]);
    await database(names[2]);
    const target = await database(names[1]);
    await expect(migrateTrainerDatabase(target.name)).rejects.toThrow(
      "Multiple saved trainer databases",
    );
    expect(await target.count("app")).toBe(0);
  });

  it("copies preferences once without replacing newer preferences", () => {
    localStorage.setItem("previous-browser:theme", "dark");
    localStorage.setItem("previous-browser:training-config", '{"steps":5}');
    localStorage.setItem("train-gpt-in-browser:theme", "light");
    migrateLocalPreferences("train-gpt-in-browser", localStorage);
    expect(localStorage.getItem("train-gpt-in-browser:theme")).toBe("light");
    expect(localStorage.getItem("train-gpt-in-browser:training-config")).toBe('{"steps":5}');
    expect(localStorage.getItem("previous-browser:theme")).toBe("dark");
    localStorage.removeItem("train-gpt-in-browser:theme");
    migrateLocalPreferences("train-gpt-in-browser", localStorage);
    expect(localStorage.getItem("train-gpt-in-browser:theme")).toBeNull();
  });

  it("rolls back all copied records when a write fails", async () => {
    const source = await database(names[0]);
    const target = await database(names[1]);
    await source.put("files", { id: "first", content: "alpha" });
    await source.put("files", { id: "second", content: "beta" });
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.transaction.db.name === target.name && (value as { id?: string }).id === "second") {
        throw new DOMException("Storage is full", "QuotaExceededError");
      }
      return put.call(this, value, key);
    });
    await expect(migrateTrainerDatabase(target.name)).rejects.toThrow("Storage is full");
    expect(await target.count("files")).toBe(0);
    expect(await target.count("app")).toBe(0);
    expect(await source.count("files")).toBe(2);
  });

  it("does not silently hide existing data when database discovery is unavailable", async () => {
    const target = await database(names[1]);
    const discover = indexedDB.databases;
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await expect(migrateTrainerDatabase(target.name)).rejects.toThrow(
        "cannot locate saved training data",
      );
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: discover });
    }
  });

  it("ignores unrelated databases with incompatible store keys", async () => {
    const source = await openDB(names[0], 1, {
      upgrade(db) {
        for (const name of ["app", "files", "runs"])
          db.createObjectStore(name, { keyPath: "unrelated" });
      },
    });
    opened.push(source);
    await source.put("files", { unrelated: "foreign", content: "unrelated application" });
    const target = await database(names[1]);
    await migrateTrainerDatabase(target.name);
    expect(await target.count("files")).toBe(0);
  });

  it("tolerates browsers that block localStorage access", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => migrateLocalPreferences("train-gpt-in-browser")).not.toThrow();
  });
});

import type { ImportDefaults, ImportRow } from "./import-model";

/**
 * "Save for later" keeps an unfinished batch on this device: rows, their photos (IndexedDB stores
 * File objects as-is) and the shared defaults. One draft per workspace, so two businesses on a
 * shared computer never see each other's batch. Nothing here reaches the server.
 */
export type SavedBatch = {
  savedAt: string;
  defaults: ImportDefaults;
  rows: ImportRow[];
};

const DB_NAME = "drezivo-batch-import";
const STORE = "drafts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot save a batch for later."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the saved batch."));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Could not save the batch."));
        };
      })
  );
}

export function saveBatch(workspaceKey: string, defaults: ImportDefaults, rows: ImportRow[]): Promise<SavedBatch> {
  // Rows already created belong to the catalogue now; in-flight states restart as drafts.
  const pending = rows
    .filter((row) => row.status !== "created")
    .map((row) => ({ ...row, status: row.status === "error" ? row.status : ("draft" as const) }));
  const batch: SavedBatch = { savedAt: new Date().toISOString(), defaults, rows: pending };
  return run("readwrite", (store) => store.put(batch, workspaceKey)).then(() => batch);
}

export function loadBatch(workspaceKey: string): Promise<SavedBatch | null> {
  return run<SavedBatch | undefined>("readonly", (store) => store.get(workspaceKey) as IDBRequest<SavedBatch | undefined>).then(
    (batch) => {
      if (!batch || !Array.isArray(batch.rows)) return null;
      return {
        ...batch,
        rows: batch.rows.map((row) => {
          const legacy = row as ImportRow & { subcategory?: unknown; measurementMode?: unknown; fitNote?: unknown; measurementKinds?: unknown };
          return {
            ...legacy,
            subcategory: typeof legacy.subcategory === "string" ? legacy.subcategory : "",
            fitRange: typeof legacy.fitRange === "string" ? legacy.fitRange : "",
            description: typeof legacy.description === "string"
              ? legacy.description
              : typeof legacy.fitNote === "string" ? legacy.fitNote : "",
            bust: typeof legacy.bust === "string" ? legacy.bust : "",
            waist: typeof legacy.waist === "string" ? legacy.waist : "",
            length: typeof legacy.length === "string" ? legacy.length : "",
            measurementKinds: legacy.measurementKinds && typeof legacy.measurementKinds === "object"
              ? legacy.measurementKinds as ImportRow["measurementKinds"]
              : { bust: "exact", waist: "exact", length: "exact" },
            measurementConflicts: Array.isArray(legacy.measurementConflicts) ? legacy.measurementConflicts : [],
            conflictingFitNotes: legacy.conflictingFitNotes && typeof legacy.conflictingFitNotes === "object" ? legacy.conflictingFitNotes : {},
            measurementMode:
              legacy.measurementMode === "default_guide" || legacy.measurementMode === "custom" || legacy.measurementMode === "none"
                ? legacy.measurementMode
                : "custom",
          };
        }),
      };
    }
  );
}

export function clearBatch(workspaceKey: string): Promise<void> {
  return run("readwrite", (store) => store.delete(workspaceKey)).then(() => undefined);
}

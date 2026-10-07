import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_IMPORT_DEFAULTS,
  emptyRow,
} from "@/components/inventory/batch-import/import-model";
import { loadBatch, type SavedBatch } from "@/components/inventory/batch-import/draft-store";

function installStoredBatch(batch: SavedBatch) {
  const transaction = {
    objectStore: () => ({ get: () => ({ result: batch }) }) as unknown as IDBObjectStore,
    oncomplete: null as IDBTransaction["oncomplete"],
    onerror: null as IDBTransaction["onerror"],
  };
  const database = {
    transaction: () => {
      setTimeout(
        () =>
          transaction.oncomplete?.call(
            transaction as unknown as IDBTransaction,
            new Event("complete") as Parameters<NonNullable<IDBTransaction["oncomplete"]>>[0]
          ),
        0
      );
      return transaction;
    },
    close: vi.fn(),
  } as unknown as IDBDatabase;
  const openRequest = {
    result: database,
    onsuccess: null as IDBOpenDBRequest["onsuccess"],
    onerror: null as IDBOpenDBRequest["onerror"],
    onupgradeneeded: null as IDBOpenDBRequest["onupgradeneeded"],
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      setTimeout(
        () =>
          openRequest.onsuccess?.call(
            openRequest as unknown as IDBOpenDBRequest,
            new Event("success") as IDBVersionChangeEvent
          ),
        0
      );
      return openRequest;
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("saved batch measurement modes", () => {
  it("keeps explicit saved modes and defaults legacy rows to custom measurements", async () => {
    const guideRow = emptyRow(DEFAULT_IMPORT_DEFAULTS, { measurementMode: "default_guide" });
    const noneRow = emptyRow(DEFAULT_IMPORT_DEFAULTS, { measurementMode: "none" });
    const { measurementMode: _measurementMode, ...legacyData } = emptyRow(DEFAULT_IMPORT_DEFAULTS);
    const legacyRow = legacyData as typeof guideRow;
    installStoredBatch({
      savedAt: "2026-10-07T00:00:00.000Z",
      defaults: DEFAULT_IMPORT_DEFAULTS,
      rows: [guideRow, noneRow, legacyRow],
    });

    const saved = await loadBatch("shop");

    expect(saved?.rows.map((row) => row.measurementMode)).toEqual([
      "default_guide",
      "none",
      "custom",
    ]);
  });
});

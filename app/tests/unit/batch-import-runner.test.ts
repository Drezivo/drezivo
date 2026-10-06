import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => ({ uploadAuthorizedFile: vi.fn() }));
vi.mock("@/lib/authorized-file-upload", () => upload);

const { DrezivoApiError } = await import("@/lib/drezivo-api");
const { DEFAULT_IMPORT_DEFAULTS, emptyRow } = await import("@/components/inventory/batch-import/import-model");
const { chunk, createRows, ensureCategories, readPhotos, uploadPhotos } = await import("@/components/inventory/batch-import/import-runner");

const FILE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const GUIDE_ID = "44444444-4444-4444-8444-444444444444";

function api() {
  return {
    authorizeImportUploads: vi.fn(),
    finalizeImportUploads: vi.fn(),
    createImportClothing: vi.fn(),
    extractClothingPhoto: vi.fn(),
    createCatalogueCategory: vi.fn(),
  };
}

const ok = (data: unknown) => ({ success: true, data, request_id: "r" });
const fail = (message: string) => ({ success: false, error: { code: "VALIDATION_FAILED", message }, request_id: "r" });

describe("batch import runner", () => {
  beforeEach(() => upload.uploadAuthorizedFile.mockReset().mockResolvedValue(undefined));

  it("splits work into batches of 25", () => {
    expect(chunk(Array.from({ length: 60 }, (_, index) => index)).map((group) => group.length)).toEqual([25, 25, 10]);
  });

  it("uploads photos through authorize, PUT and finalize, keeping each row's own keys", async () => {
    const client = api();
    const row = emptyRow(DEFAULT_IMPORT_DEFAULTS, { photo: new File([new Uint8Array([1, 2])], "a.jpg", { type: "image/jpeg" }) });
    client.authorizeImportUploads.mockResolvedValue({
      data: {
        results: [
          {
            idempotency_key: row.uploadKey,
            status: 201,
            body: ok({ file_id: FILE_ID, upload_url: "https://s.test/put", upload_method: "PUT", required_headers: {}, expires_at: "2026-10-05T00:00:00.000Z" }),
          },
        ],
      },
    });
    client.finalizeImportUploads.mockResolvedValue({
      data: {
        results: [
          {
            idempotency_key: row.finalizeKey,
            status: 200,
            body: ok({
              file: { file_id: FILE_ID, purpose: "catalogue_image", lifecycle_status: "accepted", content_type: "image/jpeg", byte_size: 2, sha256: `${"A".repeat(43)}=`, frozen_at: "2026-10-05T00:00:00.000Z" },
            }),
          },
        ],
      },
    });
    const update = vi.fn();
    const progress = vi.fn();

    const uploaded = await uploadPhotos(client as never, [row], update, undefined, progress);

    expect(uploaded.get(row.id)).toBe(FILE_ID);
    expect(client.authorizeImportUploads.mock.calls[0]?.[0].items[0]).toMatchObject({ idempotency_key: row.uploadKey, content_type: "image/jpeg", byte_size: 2 });
    expect(client.finalizeImportUploads.mock.calls[0]?.[0]).toEqual({ items: [{ idempotency_key: row.finalizeKey, file_id: FILE_ID }] });
    expect(update).toHaveBeenLastCalledWith(row.id, { status: "draft", fileId: FILE_ID, message: null });
    expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
  });

  it("marks a row whose photo was refused and does not finalize it", async () => {
    const client = api();
    const row = emptyRow(DEFAULT_IMPORT_DEFAULTS, { photo: new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }) });
    client.authorizeImportUploads.mockResolvedValue({ data: { results: [{ idempotency_key: row.uploadKey, status: 422, body: fail("Photo too large.") }] } });
    const update = vi.fn();

    const uploaded = await uploadPhotos(client as never, [row], update);

    expect(uploaded.size).toBe(0);
    expect(client.finalizeImportUploads).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(row.id, { status: "error", message: "Photo too large." });
  });

  it("creates rows and reports each one's outcome", async () => {
    const client = api();
    const good = emptyRow(DEFAULT_IMPORT_DEFAULTS, { name: "A", category: "Gowns", price: "500" });
    const bad = emptyRow(DEFAULT_IMPORT_DEFAULTS, { name: "B", category: "Gowns", price: "500" });
    client.createImportClothing.mockResolvedValue({
      data: {
        results: [
          { idempotency_key: good.createKey, status: 201, body: ok({ product_id: PRODUCT_ID, code: "A-1", sizing_mode: "free_size", variant_count: 1, physical_piece_count: 1, status: "draft" }) },
          { idempotency_key: bad.createKey, status: 409, body: fail("Your plan's clothing limit is reached.") },
        ],
      },
    });
    const update = vi.fn();
    const ids = new Map([["gowns", "44444444-4444-4444-8444-444444444444"]]);

    const created = await createRows(client as never, [good, bad], DEFAULT_IMPORT_DEFAULTS, ids, GUIDE_ID, false, update);

    expect(created).toBe(1);
    expect(update).toHaveBeenCalledWith(good.id, { status: "created", productId: PRODUCT_ID, message: null });
    expect(update).toHaveBeenCalledWith(bad.id, { status: "error", message: "Your plan's clothing limit is reached." });
  });

  it("reuses existing categories by name and creates each missing one once", async () => {
    const client = api();
    client.createCatalogueCategory.mockResolvedValue({ data: { id: "new-id" } });

    const ids = await ensureCategories(client as never, ["Gowns", "wedding gowns", "Wedding Gowns"], [{ id: "gown-id", name: "gowns" }]);

    expect(client.createCatalogueCategory).toHaveBeenCalledTimes(1);
    expect(ids.get("gowns")).toBe("gown-id");
    expect(ids.get("wedding gowns")).toBe("new-id");
  });

  it("waits and retries a photo when the reader is rate limited, then gives up gracefully", async () => {
    const client = api();
    client.extractClothingPhoto
      .mockRejectedValueOnce(new DrezivoApiError("busy", { status: 429 }))
      .mockResolvedValueOnce({ data: { fields: { name: "Mira" } } })
      .mockRejectedValue(new DrezivoApiError("down", { status: 503 }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRead = vi.fn();
    const onStart = vi.fn();

    await readPhotos(client as never, [{ id: "a", fileId: FILE_ID }], onRead, wait, onStart);
    await readPhotos(client as never, [{ id: "b", fileId: FILE_ID }], onRead, wait);

    expect(wait).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledWith("a", 0, 1);
    expect(onRead).toHaveBeenCalledWith("a", { name: "Mira" }, null);
    expect(onRead).toHaveBeenCalledWith("b", null, "down");
  });

  it("waits out a throttled batch and resends it with the same row keys", async () => {
    const client = api();
    const row = emptyRow(DEFAULT_IMPORT_DEFAULTS, { name: "A", category: "Gowns", price: "500" });
    client.createImportClothing
      .mockRejectedValueOnce(new DrezivoApiError("Too many requests.", { status: 429 }))
      .mockResolvedValueOnce({
        data: {
          results: [{ idempotency_key: row.createKey, status: 201, body: ok({ product_id: PRODUCT_ID, code: "A-1", sizing_mode: "free_size", variant_count: 1, physical_piece_count: 1, status: "draft" }) }],
        },
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    const created = await createRows(
      client as never,
      [row],
      DEFAULT_IMPORT_DEFAULTS,
      new Map([["gowns", "44444444-4444-4444-8444-444444444445"]]),
      GUIDE_ID,
      false,
      vi.fn(),
      wait
    );

    expect(created).toBe(1);
    expect(wait).toHaveBeenCalledTimes(1);
    const keys = client.createImportClothing.mock.calls.map((call) => call[0].items[0].idempotency_key);
    expect(keys).toEqual([row.createKey, row.createKey]);
  });
});

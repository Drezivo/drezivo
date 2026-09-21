import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReplaceClothingImagesRequest } from "@drezivo/contracts";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const productId = "00000000-0000-4000-8000-000000000100";
const variantId = "00000000-0000-4000-8000-000000000101";
const assetId = "00000000-0000-4000-8000-000000000102";
const branchId = "00000000-0000-4000-8000-000000000103";
const fileId = "00000000-0000-4000-8000-000000000104" as ReplaceClothingImagesRequest["file_ids"][number];
const instant = "2026-09-21T08:00:00.000Z";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "00000000-0000-4000-8000-000000000199" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo Phase 3 API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("clerk-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("sends CLT-030 product and variant edits to the real Phase 3 routes", async () => {
    const intentKey = crypto.randomUUID();
    fetchMock
      .mockResolvedValueOnce(
        success({
          product_id: productId,
          name: "Updated Gown",
          description: "Updated description",
          category: null,
          status: "active",
          updated_at: instant,
        })
      )
      .mockResolvedValueOnce(
        success({
          variant_id: variantId,
          product_id: productId,
          size_label: "M",
          color_label: "Emerald",
          measurement_mode: "none",
          measurement_guide_id: null,
          measurement_unit: "cm",
          measurements: {},
          rental_price_minor: "150000",
          security_deposit_minor: "50000",
          currency: "PHP",
          pricing_mode: "daily",
          included_duration_minutes: 1440,
          extra_day_price_minor: "150000",
          prep_minutes: 60,
          turnaround_minutes: 1440,
          status: "active",
          updated_at: instant,
        })
      );

    const client = createDrezivoApiClient(getToken);
    await client.updateClothingProduct(
      productId,
      { expected_updated_at: instant, name: "Updated Gown" },
      `${intentKey}-product`
    );
    await client.updateClothingVariant(
      productId,
      variantId,
      { expected_updated_at: instant, color_label: "Emerald" },
      `${intentKey}-variant`
    );

    const [productUrl, productInit] = fetchMock.mock.calls[0]!;
    expect(productUrl).toBe(`https://api.example.test/api/v1/catalogue/clothing/${productId}`);
    expect(productInit?.method).toBe("PATCH");
    expect(JSON.parse(String(productInit?.body))).toEqual({
      expected_updated_at: instant,
      name: "Updated Gown",
    });
    expect((productInit?.headers as Headers).get("Idempotency-Key")).toBe(`${intentKey}-product`);

    const [variantUrl, variantInit] = fetchMock.mock.calls[1]!;
    expect(variantUrl).toBe(
      `https://api.example.test/api/v1/catalogue/clothing/${productId}/variants/${variantId}`
    );
    expect(variantInit?.method).toBe("PATCH");
    expect((variantInit?.headers as Headers).get("Idempotency-Key")).toBe(`${intentKey}-variant`);
  });

  it("sends photo replacement and archive to their canonical backend routes", async () => {
    const imageIntent = crypto.randomUUID();
    const archiveIntent = crypto.randomUUID();
    fetchMock
      .mockResolvedValueOnce(
        success({
          images: [{ file_id: fileId, display_order: 0, image_url: null }],
          cover_file_id: fileId,
        })
      )
      .mockResolvedValueOnce(
        success({
          product_id: productId,
          status: "archived",
          archived_variant_count: 1,
          retired_asset_count: 1,
          pending_asset_resolution_count: 0,
          updated_at: instant,
        })
      );

    const client = createDrezivoApiClient(getToken);
    await client.replaceClothingImages(productId, { file_ids: [fileId] }, imageIntent);
    await client.archiveClothing(productId, { expected_updated_at: instant }, archiveIntent);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://api.example.test/api/v1/catalogue/clothing/${productId}/images`
    );
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `https://api.example.test/api/v1/catalogue/clothing/${productId}/archive`
    );
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      expected_updated_at: instant,
    });
  });

  it("keeps the CLT-031 asset-state client tenant-safe by sending only asset state fields", async () => {
    const intentKey = crypto.randomUUID();
    fetchMock.mockResolvedValueOnce(
      success({
        asset: {
          id: assetId,
          branch_id: branchId,
          variant_id: variantId,
          asset_code: "AST-001",
          lifecycle_status: "active",
          readiness: "needs_cleaning",
          custody_kind: "at_branch",
          condition_note: null,
          measurement_overrides: null,
          alteration_note: null,
          version: 2,
          created_at: instant,
          updated_at: instant,
        },
        blocking_allocation_count: 1,
        disruptions_created: 1,
      })
    );

    const client = createDrezivoApiClient(getToken);
    await client.updatePhysicalAssetState(
      assetId,
      { expected_version: 1, readiness: "needs_cleaning" },
      intentKey
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.example.test/api/v1/catalogue/assets/${assetId}/state`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_version: 1,
      readiness: "needs_cleaning",
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("custody_kind");
  });
});

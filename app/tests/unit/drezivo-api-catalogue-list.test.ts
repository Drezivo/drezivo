import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const productId = "00000000-0000-4000-8000-000000000100";
const start = "2026-10-10T00:00:00.000Z";
const end = "2026-10-11T00:00:00.000Z";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "00000000-0000-4000-8000-000000000199" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo catalogue list API client", () => {
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

  it("serializes a bounded availability window and preserves the canonical summary", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        items: [
          {
            product_id: productId,
            code: "GWN-001",
            name: "Emerald Gown",
            category: null,
            product_status: "active",
            size_labels: ["M"],
            price_from_minor: "150000",
            currency: "PHP",
            primary_image_url: null,
            readiness: {
              active_assets: 2,
              ready: 2,
              needs_cleaning: 0,
              needs_repair: 0,
              unready: 0,
            },
            availability: {
              window: { start, end },
              active_assets: 2,
              available_assets: 1,
              unavailable_assets: 1,
              reserved_assets: 1,
              rented_assets: 0,
              cleaning_assets: 0,
              maintenance_assets: 0,
              manual_blocked_assets: 0,
            },
            created_at: "2026-09-20T08:00:00.000Z",
            updated_at: "2026-09-20T08:00:00.000Z",
          },
        ],
        page_meta: { next_cursor: null, has_more: false },
      })
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.getCatalogueClothing({
      limit: 10,
      sort: "name_asc",
      availability_start: start,
      availability_end: end,
    });

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/api/v1/catalogue/clothing");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("sort")).toBe("name_asc");
    expect(url.searchParams.get("availability_start")).toBe(start);
    expect(url.searchParams.get("availability_end")).toBe(end);
    expect(init?.method).toBe("GET");
    expect(result.data.items[0]?.availability).toMatchObject({
      available_assets: 1,
      unavailable_assets: 1,
      reserved_assets: 1,
      window: { start, end },
    });
  });
});

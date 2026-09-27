import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerId, ProductVariantId } from "@drezivo/contracts";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const fittingId = "00000000-0000-4000-8000-000000003001";
const branchId = "00000000-0000-4000-8000-000000003002";
const customerId = "00000000-0000-4000-8000-000000003003" as CustomerId;
const lineId = "00000000-0000-4000-8000-000000003004";
const variantId = "00000000-0000-4000-8000-000000003005" as ProductVariantId;

function success(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "00000000-0000-4000-8000-000000003099" }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function listItem() {
  return {
    id: fittingId,
    status: "pending",
    period: {
      start: "2026-10-05T02:00:00.000Z",
      end: "2026-10-05T03:00:00.000Z",
    },
    customer: { id: customerId, full_name: "API Fitting Customer" },
    garments: [
      {
        id: lineId,
        variant: {
          variant_id: variantId,
          product_name: "API Gown",
          sku: "API-M",
          size_label: "Medium",
          color_label: "Gold",
        },
        garment_mode: "preference",
      },
    ],
    fee: { fee_minor: "50000", currency: "PHP", payment: null },
    attention: "none",
    version: 1,
    created_at: "2026-09-27T01:00:00.000Z",
  };
}

function detail(status: "pending" | "confirmed" = "pending", version = 1) {
  return {
    ...listItem(),
    branch_id: branchId,
    booking_channel: "staff",
    status,
    timezone_snapshot: "Asia/Manila",
    customer: {
      id: customerId,
      full_name: "API Fitting Customer",
      phone: "09171234567",
      email: null,
    },
    garments: [{ ...listItem().garments[0], assigned_asset: null }],
    internal_note: null,
    terminal_reason: null,
    allowed_actions:
      status === "pending"
        ? ["confirm", "reject", "cancel", "reschedule", "update_garments", "update_note"]
        : ["cancel", "reschedule", "update_garments", "update_note"],
    version,
  };
}

describe("Drezivo fittings API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("test-clerk-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("serializes bounded fitting list filters and validates the response", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ items: [listItem()], page_meta: { next_cursor: "next", has_more: true } })
    );

    const result = await createDrezivoApiClient(getToken).getFittings({
      cursor: "current",
      limit: 10,
      search: "API Gown",
      status: "pending",
      period_start: "2026-10-01T00:00:00.000Z",
      period_end: "2026-10-10T00:00:00.000Z",
      sort: "starts_at_asc",
    });

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/api/v1/fittings");
    expect(url.searchParams.get("cursor")).toBe("current");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("search")).toBe("API Gown");
    expect(url.searchParams.get("status")).toBe("pending");
    expect(url.searchParams.get("period_start")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("period_end")).toBe("2026-10-10T00:00:00.000Z");
    expect(url.searchParams.get("sort")).toBe("starts_at_asc");
    expect(init?.method).toBe("GET");
    expect(result.data.items[0]).toMatchObject({ id: fittingId, status: "pending" });
    expect(result.data.page_meta).toEqual({ next_cursor: "next", has_more: true });
  });

  it("creates a fitting with an idempotency key and only canonical client-owned input", async () => {
    fetchMock.mockResolvedValueOnce(success({ fitting: detail() }, 201));

    const result = await createDrezivoApiClient(getToken).createFitting(
      {
        customer: { source: "existing", customer_id: customerId },
        starts_at: "2026-10-05T02:00:00.000Z",
        garments: [{ variant_id: variantId, garment_mode: "guaranteed" }],
      },
      "fit-create-test-key"
    );

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(rawUrl)).pathname).toBe("/api/v1/fittings");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("fit-create-test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      customer: { source: "existing", customer_id: customerId },
      starts_at: "2026-10-05T02:00:00.000Z",
      garments: [{ variant_id: variantId, garment_mode: "guaranteed" }],
    });
    expect(result.data.fitting).toMatchObject({ id: fittingId, version: 1 });
  });

  it("uses the guarded lifecycle endpoint and returns the authoritative updated detail", async () => {
    fetchMock.mockResolvedValueOnce(success({ fitting: detail("confirmed", 2) }));

    const result = await createDrezivoApiClient(getToken).confirmFitting(
      fittingId,
      { version: 1 },
      "fit-confirm-test-key"
    );

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(rawUrl)).pathname).toBe(`/api/v1/fittings/${fittingId}/confirm`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("fit-confirm-test-key");
    expect(JSON.parse(String(init?.body))).toEqual({ version: 1 });
    expect(result.data.fitting).toMatchObject({ status: "confirmed", version: 2 });
  });
});

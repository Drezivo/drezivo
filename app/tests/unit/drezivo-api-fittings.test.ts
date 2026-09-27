import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fittingClosure,
  fittingSettings,
  type CustomerId,
  type ProductVariantId,
} from "@drezivo/contracts";

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

function scheduleSettings(version = 1) {
  return fittingSettings.parse({
    branch_id: branchId,
    enabled: true,
    capacity: 2,
    duration_minutes: 60,
    fee_minor: "50000",
    currency: "PHP",
    timezone: "Asia/Manila",
    weekly_hours: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ].map((weekday) => ({ weekday, windows: [{ starts_local: "09:00", ends_local: "17:00" }] })),
    version,
    updated_at: "2026-09-27T00:00:00.000Z",
  });
}

const closure = fittingClosure.parse({
  id: "00000000-0000-4000-8000-000000003006",
  period: { start: "2026-10-05T02:00:00.000Z", end: "2026-10-05T03:00:00.000Z" },
  timezone_snapshot: "Asia/Manila",
  reason: "Holiday closure",
  created_at: "2026-09-27T01:00:00.000Z",
});

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

  it("serializes settings, weekly-hours, and closure operations with guarded contract payloads", async () => {
    fetchMock
      .mockResolvedValueOnce(success({ settings: scheduleSettings(2) }))
      .mockResolvedValueOnce(success({ settings: scheduleSettings(3) }))
      .mockResolvedValueOnce(
        success({ items: [closure], page_meta: { next_cursor: null, has_more: false } })
      )
      .mockResolvedValueOnce(success({ closure, settings_version: 4 }, 201))
      .mockResolvedValueOnce(success({ closure, settings_version: 5 }))
      .mockResolvedValueOnce(success({ closure_id: closure.id, settings_version: 6 }));

    const client = createDrezivoApiClient(getToken);
    await client.updateFittingSettings(
      { version: 1, enabled: true, capacity: 3, duration_minutes: 60, fee_minor: "12500" },
      "fit-settings-test-key"
    );
    await client.updateFittingWeeklyHours(
      { version: 2, weekly_hours: scheduleSettings().weekly_hours },
      "fit-hours-test-key"
    );
    await client.getFittingClosures({
      limit: 100,
      period_start: "2026-10-01T00:00:00.000Z",
      period_end: "2026-11-01T00:00:00.000Z",
    });
    await client.createFittingClosure(
      { settings_version: 3, period: closure.period, reason: closure.reason },
      "fit-closure-create-test-key"
    );
    await client.updateFittingClosure(
      closure.id,
      { settings_version: 4, period: closure.period, reason: "Updated closure" },
      "fit-closure-update-test-key"
    );
    await client.removeFittingClosure(
      closure.id,
      { settings_version: 5 },
      "fit-closure-remove-test-key"
    );

    const settingsUpdate = fetchMock.mock.calls[0];
    expect(new URL(String(settingsUpdate?.[0])).pathname).toBe("/api/v1/fittings/settings");
    expect(settingsUpdate?.[1]?.method).toBe("PUT");
    expect(new Headers(settingsUpdate?.[1]?.headers).get("Idempotency-Key")).toBe(
      "fit-settings-test-key"
    );
    expect(JSON.parse(String(settingsUpdate?.[1]?.body))).toEqual({
      version: 1,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: "12500",
    });

    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe(
      "/api/v1/fittings/settings/hours"
    );
    const closuresUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(closuresUrl.pathname).toBe("/api/v1/fittings/closures");
    expect(closuresUrl.searchParams.get("limit")).toBe("100");
    expect(closuresUrl.searchParams.get("period_start")).toBe("2026-10-01T00:00:00.000Z");
    expect(closuresUrl.searchParams.get("period_end")).toBe("2026-11-01T00:00:00.000Z");
    expect(new URL(String(fetchMock.mock.calls[3]?.[0])).pathname).toBe(
      "/api/v1/fittings/closures"
    );
    expect(new URL(String(fetchMock.mock.calls[4]?.[0])).pathname).toBe(
      `/api/v1/fittings/closures/${closure.id}`
    );
    expect(new URL(String(fetchMock.mock.calls[5]?.[0])).pathname).toBe(
      `/api/v1/fittings/closures/${closure.id}/remove`
    );
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("POST");
  });
});

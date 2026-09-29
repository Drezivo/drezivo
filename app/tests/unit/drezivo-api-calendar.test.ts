import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

const reservationId = "00000000-0000-4000-8000-000000000201";
const fittingId = "00000000-0000-4000-8000-000000000202";
const branchId = "00000000-0000-4000-8000-000000000203";
const categoryId = "00000000-0000-4000-8000-000000000204";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "request-calendar" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo operational Calendar API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("session");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("serializes instants and preserves the authoritative truncated flag", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        window: {
          start: "2026-09-26T16:00:00.000Z",
          end: "2026-09-27T16:00:00.000Z",
        },
        categories: [{ id: categoryId, name: "Gowns", status: "active" }],
        truncated: true,
        events: [
          {
            id: `pickup:${reservationId}`,
            source: "reservation",
            source_id: reservationId,
            event_type: "pickup",
            branch_id: branchId,
            period: {
              start: "2026-09-26T16:15:00.000Z",
              end: "2026-09-26T16:45:00.000Z",
            },
            customer_name: "Calendar Customer",
            item_names: ["Evening Gown"],
            category_ids: [categoryId],
            status: "confirmed",
          },
          {
            id: `fitting:${fittingId}`,
            source: "fitting",
            source_id: fittingId,
            event_type: "fitting",
            branch_id: branchId,
            period: {
              start: "2026-09-27T02:00:00.000Z",
              end: "2026-09-27T03:00:00.000Z",
            },
            customer_name: "Fitting Customer",
            item_names: ["Filipiniana"],
            category_ids: [categoryId],
            status: "pending",
          },
        ],
      })
    );

    const result = await createDrezivoApiClient(getToken).getOperationalCalendar({
      start: "2026-09-27T00:00:00+08:00",
      end: "2026-09-28T00:00:00+08:00",
    });

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/api/v1/calendar");
    expect(url.searchParams.get("start")).toBe("2026-09-27T00:00:00+08:00");
    expect(url.searchParams.get("end")).toBe("2026-09-28T00:00:00+08:00");
    expect(init?.method).toBe("GET");
    expect(result.requestId).toBe("request-calendar");
    expect(result.data.truncated).toBe(true);
    expect(result.data.events).toHaveLength(2);
  });

  it("rejects a response that does not match the shared Calendar contract", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        window: {
          start: "2026-09-27T00:00:00.000Z",
          end: "2026-09-28T00:00:00.000Z",
        },
        categories: [{ id: categoryId, name: "Gowns", status: "active" }],
        truncated: false,
        events: [
          {
            id: `fitting:${fittingId}`,
            source: "fitting",
            source_id: fittingId,
            event_type: "fitting",
            branch_id: branchId,
            period: {
              start: "2026-09-27T02:00:00.000Z",
              end: "2026-09-27T03:00:00.000Z",
            },
            customer_name: "Fitting Customer",
            item_names: ["Filipiniana"],
            category_ids: [categoryId],
            status: "confirmed",
            tenant_id: "not-authority",
          },
        ],
      })
    );

    await expect(
      createDrezivoApiClient(getToken).getOperationalCalendar({
        start: "2026-09-27T00:00:00.000Z",
        end: "2026-09-28T00:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(DrezivoApiError);
  });
});

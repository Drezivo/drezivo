import { beforeEach, describe, expect, it, vi } from "vitest";

import { clothingAvailabilityTimelineQuery } from "@drezivo/contracts";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "req-calendar-availability" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo clothing availability API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("test-session-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("serializes the bounded timeline query and validates the response", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        timezone: "Asia/Manila",
        window: { start_date: "2026-09-27", end_date: "2026-10-10" },
        facets: {
          categories: [
            { id: "00000000-0000-4000-8000-000000000201", name: "Gowns" },
          ],
          size_labels: ["M"],
        },
        rows: [
          {
            product: {
              id: "00000000-0000-4000-8000-000000000202",
              name: "Emerald Evening Gown",
              primary_image_url: "https://images.example.test/emerald.jpg",
            },
            variant: {
              id: "00000000-0000-4000-8000-000000000203",
              size_label: "M",
              color_label: "Emerald",
              rental_price_minor: "150000",
              currency: "PHP",
            },
            asset: { id: "00000000-0000-4000-8000-000000000204" },
            agendas: [
              {
                id: "reservation:calendar-test:scheduled",
                type: "reserved",
                period: {
                  start: "2026-09-27T02:00:00.000Z",
                  end: "2026-10-02T02:00:00.000Z",
                },
                display_lane: 0,
                source_type: "reservation",
                source_id: "00000000-0000-4000-8000-000000000205",
                customer_name: "Maria Santos",
                pickup: { date: "2026-09-27", at: "2026-09-27T02:00:00.000Z" },
                return: { date: "2026-10-02", at: "2026-10-02T02:00:00.000Z" },
                unavailable_reason: null,
              },
            ],
          },
        ],
        page_meta: { next_cursor: "next-page", has_more: true },
      })
    );

    const input = clothingAvailabilityTimelineQuery.parse({
      start_date: "2026-09-27",
      end_date: "2026-10-10",
      search: "emerald",
      category_id: "00000000-0000-4000-8000-000000000201",
      size_label: "M",
      status: "reserved",
      cursor: "current-page",
      limit: 25,
    });

    const result = await createDrezivoApiClient(getToken).getClothingAvailabilityTimeline(input);

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/api/v1/calendar/availability");
    expect(url.searchParams.get("start_date")).toBe("2026-09-27");
    expect(url.searchParams.get("end_date")).toBe("2026-10-10");
    expect(url.searchParams.get("search")).toBe("emerald");
    expect(url.searchParams.get("category_id")).toBe(
      "00000000-0000-4000-8000-000000000201"
    );
    expect(url.searchParams.get("size_label")).toBe("M");
    expect(url.searchParams.get("status")).toBe("reserved");
    expect(url.searchParams.get("cursor")).toBe("current-page");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(init?.method).toBe("GET");
    expect(result.data.rows[0]).toMatchObject({
      product: { name: "Emerald Evening Gown" },
      variant: { size_label: "M" },
      agendas: [{ type: "reserved", customer_name: "Maria Santos" }],
    });
    expect(result.data.page_meta).toEqual({ next_cursor: "next-page", has_more: true });
  });
});

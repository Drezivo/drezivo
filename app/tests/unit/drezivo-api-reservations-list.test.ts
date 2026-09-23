import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const start = "2026-10-10T00:00:00.000Z";
const end = "2026-10-20T00:00:00.000Z";

function success(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "00000000-0000-4000-8000-000000000199" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Drezivo reservations list API client", () => {
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

  it("serializes bounded staff reservation filters and validates the response", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000101",
            reference_code: "RSV-2026-0001",
            status: "confirmed",
            customer: {
              customer_id: "00000000-0000-4000-8000-000000000102",
              snapshot: {
                full_name: "Maria Santos",
                phone: "09171234567",
                email: null,
              },
            },
            line: {
              id: "00000000-0000-4000-8000-000000000103",
              variant_id: "00000000-0000-4000-8000-000000000104",
              name_snapshot: "Emerald Gown",
              rental_minor: "150000",
              deposit_minor: "50000",
              currency: "PHP",
            },
            fulfillment_method: "pickup",
            pickup_at: "2026-10-12T02:00:00.000Z",
            due_at: "2026-10-14T02:00:00.000Z",
            price_snapshot: {
              rental_total_minor: "150000",
              security_required_minor: "50000",
              due_now_minor: "200000",
              currency: "PHP",
            },
            payment: {
              id: "00000000-0000-4000-8000-000000000105",
              payment_method_id: "00000000-0000-4000-8000-000000000106",
              status: "paid",
              evidence_status: "verified",
              amount_minor: "200000",
              currency: "PHP",
              verified_at: "2026-10-10T03:00:00.000Z",
            },
            version: 3,
            created_at: "2026-10-10T02:00:00.000Z",
          },
        ],
        page_meta: { next_cursor: "next-page", has_more: true },
      })
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.getReservations({
      cursor: "current-page",
      limit: 10,
      search: "Maria",
      status: "confirmed",
      pickup_start: start,
      pickup_end: end,
      sort: "pickup_asc",
    });

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe("/api/v1/reservations");
    expect(url.searchParams.get("cursor")).toBe("current-page");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("search")).toBe("Maria");
    expect(url.searchParams.get("status")).toBe("confirmed");
    expect(url.searchParams.get("pickup_start")).toBe(start);
    expect(url.searchParams.get("pickup_end")).toBe(end);
    expect(url.searchParams.get("sort")).toBe("pickup_asc");
    expect(init?.method).toBe("GET");
    expect(result.data.items[0]).toMatchObject({
      reference_code: "RSV-2026-0001",
      status: "confirmed",
      customer: { snapshot: { full_name: "Maria Santos" } },
    });
    expect(result.data.page_meta).toEqual({ next_cursor: "next-page", has_more: true });
  });
});

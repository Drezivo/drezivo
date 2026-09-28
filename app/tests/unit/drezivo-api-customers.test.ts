import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const customerId = "00000000-0000-4000-8000-000000000101";

function success(data: unknown, requestId = "request-customers") {
  return new Response(
    JSON.stringify({ success: true, data, request_id: requestId }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function customer() {
  return {
    id: customerId,
    full_name: "Database Customer",
    phone: "09171234567",
    email: "customer@example.test",
    status: "active",
    reservation_count: 3,
    fitting_count: 1,
    last_activity: { type: "reservation", at: "2026-09-27T02:00:00.000Z" },
    next_activity: null,
    created_at: "2026-08-14T02:00:00.000Z",
  };
}

describe("Drezivo customer API client", () => {
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

  it("fetches the customer directory with contract query parameters and authorization", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        items: [customer()],
        page_meta: { next_cursor: "next-cursor", has_more: true },
      })
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.getCustomers({
      limit: 10,
      search: "  Maria  ",
      status: "active",
    });

    expect(result.data.items[0]?.id).toBe(customerId);
    expect(result.requestId).toBe("request-customers");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.example.test/api/v1/customers?limit=10&status=active&search=Maria"
    );
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer clerk-token");
  });

  it("fetches and parses the customer summary response", async () => {
    fetchMock.mockResolvedValueOnce(
      success({
        all_customers: 42,
        new_this_month: 8,
        returning_customers: 17,
        upcoming_customers: 11,
      }, "request-summary")
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.getCustomerSummary();

    expect(result.data).toEqual({
      all_customers: 42,
      new_this_month: 8,
      returning_customers: 17,
      upcoming_customers: 11,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.example.test/api/v1/customers/summary"
    );
  });

  it("fetches customer detail and sends an idempotent archive command", async () => {
    const updatedAt = "2026-09-27T03:00:00.000Z";
    fetchMock
      .mockResolvedValueOnce(
        success({
          id: customerId,
          full_name: "Database Customer",
          phone: "09171234567",
          email: "customer@example.test",
          address: null,
          social_media: null,
          notes: null,
          status: "active",
          archived_at: null,
          reservation_count: 3,
          fitting_count: 1,
          completed_engagement_count: 0,
          last_activity: { type: "reservation", at: "2026-09-27T02:00:00.000Z" },
          next_activity: null,
          created_at: "2026-08-14T02:00:00.000Z",
          updated_at: updatedAt,
        })
      )
      .mockResolvedValueOnce(
        success({
          id: customerId,
          status: "archived",
          archived_at: "2026-09-27T03:01:00.000Z",
          updated_at: "2026-09-27T03:01:00.000Z",
        })
      );

    const client = createDrezivoApiClient(getToken);
    const detail = await client.getCustomerDetail(customerId);
    const archived = await client.archiveCustomer(
      customerId,
      { expected_updated_at: detail.data.updated_at },
      "archive-intent-1"
    );

    expect(detail.data.updated_at).toBe(updatedAt);
    expect(archived.data.status).toBe("archived");
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `https://api.example.test/api/v1/customers/${customerId}/archive`
    );
    const init = fetchMock.mock.calls[1]![1];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer clerk-token");
    expect((init?.headers as Headers).get("Idempotency-Key")).toBe("archive-intent-1");
    expect(init?.body).toBe(JSON.stringify({ expected_updated_at: updatedAt }));
  });

  it("serializes an opaque cursor without changing the bounded page size", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ items: [], page_meta: { next_cursor: null, has_more: false } })
    );

    const client = createDrezivoApiClient(getToken);
    await client.getCustomers({ limit: 10, cursor: "opaque-cursor", status: "archived" });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.example.test/api/v1/customers?limit=10&status=archived&cursor=opaque-cursor"
    );
  });

  it("fetches independently paginated reservation and fitting histories", async () => {
    fetchMock
      .mockResolvedValueOnce(success({ items: [], page_meta: { next_cursor: "reservation-next", has_more: true } }))
      .mockResolvedValueOnce(success({ items: [], page_meta: { next_cursor: null, has_more: false } }));

    const client = createDrezivoApiClient(getToken);
    await client.getCustomerReservations(customerId, { limit: 10 });
    await client.getCustomerFittings(customerId, { limit: 10, cursor: "fitting-cursor" });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://api.example.test/api/v1/customers/${customerId}/reservations?limit=10`
    );
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `https://api.example.test/api/v1/customers/${customerId}/fittings?limit=10&cursor=fitting-cursor`
    );
    expect((fetchMock.mock.calls[0]![1]?.headers as Headers).get("Authorization")).toBe("Bearer clerk-token");
  });

  it("surfaces safe API errors with their request id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "DEPENDENCY_UNAVAILABLE", message: "Customers are temporarily unavailable." },
          request_id: "request-failure",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    );

    const client = createDrezivoApiClient(getToken);
    const result = client.getCustomerSummary();

    await expect(result).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Customers are temporarily unavailable.",
      requestId: "request-failure",
      status: 503,
    });
  });
});

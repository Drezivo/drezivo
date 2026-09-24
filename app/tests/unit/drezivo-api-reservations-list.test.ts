import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentMethodId, ProductVariantId } from "@drezivo/contracts";

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

  it("fetches and validates one authoritative reservation detail", async () => {
    const reservationId = "00000000-0000-4000-8000-000000000101";
    fetchMock.mockResolvedValueOnce(
      success({
        id: reservationId,
        reference_code: "RSV-2026-0001",
        status: "returned",
        branch_id: "00000000-0000-4000-8000-000000000201",
        storefront_id: "00000000-0000-4000-8000-000000000202",
        customer: {
          customer_id: "00000000-0000-4000-8000-000000000102",
          snapshot: { full_name: "Maria Santos", phone: "09171234567", email: null },
        },
        lines: [
          {
            id: "00000000-0000-4000-8000-000000000103",
            variant_id: "00000000-0000-4000-8000-000000000104",
            line_number: 1,
            name_snapshot: "Emerald Gown",
            measurements_snapshot: { bust_cm: 91 },
            pricing_snapshot: {
              rental_minor: "150000",
              deposit_minor: "50000",
              currency: "PHP",
            },
          },
        ],
        pickup_at: "2026-10-12T02:00:00.000Z",
        due_at: "2026-10-14T02:00:00.000Z",
        timezone_snapshot: "Asia/Manila",
        delivery_snapshot: { fulfillment_method: "pickup" },
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
        hold_acquired_at: "2026-10-10T02:00:00.000Z",
        hold_expires_at: null,
        terms_accepted_at: "2026-10-10T02:02:00.000Z",
        submitted_at: "2026-10-10T02:03:00.000Z",
        confirmed_at: "2026-10-10T03:01:00.000Z",
        completed_at: null,
        custody_timeline: [
          {
            event_kind: "return",
            asset_id: "00000000-0000-4000-8000-000000000401",
            reservation_line_id: "00000000-0000-4000-8000-000000000103",
            occurred_at: "2026-10-14T01:55:00.000Z",
            condition_note: "Returned in good condition.",
          },
        ],
        version: 5,
        created_at: "2026-10-10T02:00:00.000Z",
      })
    );

    const client = createDrezivoApiClient(getToken);
    const result = await client.getReservationDetail(reservationId);

    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(rawUrl)).pathname).toBe(`/api/v1/reservations/${reservationId}`);
    expect(init?.method).toBe("GET");
    expect(result.data).toMatchObject({
      id: reservationId,
      status: "returned",
      customer: { snapshot: { full_name: "Maria Santos" } },
      custody_timeline: [{ event_kind: "return", condition_note: "Returned in good condition." }],
    });
  });

  it("loads safe New Reservation intake options and creates a customer-less staff hold", async () => {
    const paymentMethodId = "00000000-0000-4000-8000-000000000106" as PaymentMethodId;
    const customerId = "00000000-0000-4000-8000-000000000107";
    const variantId = "00000000-0000-4000-8000-000000000104" as ProductVariantId;

    fetchMock.mockResolvedValueOnce(
      success({
        payment_methods: [{ id: paymentMethodId, name: "Cash", rail: "cash" }],
        customers: [
          {
            id: customerId,
            full_name: "Maria Santos",
            phone: "09171234567",
            email: null,
          },
        ],
      })
    );

    const client = createDrezivoApiClient(getToken);
    const options = await client.getStaffReservationIntakeOptions({ customer_search: "Maria" });
    const [optionsUrl, optionsInit] = fetchMock.mock.calls[0]!;
    expect(new URL(String(optionsUrl)).pathname).toBe("/api/v1/reservations/intake-options");
    expect(new URL(String(optionsUrl)).searchParams.get("customer_search")).toBe("Maria");
    expect(optionsInit?.method).toBe("GET");
    expect(options.data.payment_methods[0]).toEqual({
      id: paymentMethodId,
      name: "Cash",
      rail: "cash",
    });

    fetchMock.mockResolvedValueOnce(
      success({
        reservation: {
          id: "00000000-0000-4000-8000-000000000101",
          reference_code: "RSV-WALKIN-001",
          status: "held",
          branch_id: "00000000-0000-4000-8000-000000000201",
          storefront_id: "00000000-0000-4000-8000-000000000202",
          variant_id: variantId,
          payment_method_id: paymentMethodId,
          fulfillment_method: "pickup",
          pickup_at: "2026-10-12T02:00:00.000Z",
          due_at: "2026-10-14T02:00:00.000Z",
          timezone_snapshot: "Asia/Manila",
          price_snapshot: {
            rental_total_minor: "150000",
            security_required_minor: "50000",
            due_now_minor: "200000",
            currency: "PHP",
          },
          hold_expires_at: "2026-10-10T02:15:00.000Z",
          version: 1,
          created_at: "2026-10-10T02:00:00.000Z",
        },
        payment_instructions: {
          method_name: "Cash",
          rail: "cash",
          destination_note: "Pay at the counter.",
        },
      })
    );

    await client.createStaffReservation(
      {
        variant_id: variantId,
        requested_interval: {
          start: "2026-10-12T02:00:00.000Z",
          end: "2026-10-14T02:00:00.000Z",
        },
        fulfillment_method: "pickup",
        payment_method_id: paymentMethodId,
      },
      "walkin-hold-key"
    );

    const [createUrl, createInit] = fetchMock.mock.calls[1]!;
    expect(new URL(String(createUrl)).pathname).toBe("/api/v1/reservations");
    expect(createInit?.method).toBe("POST");
    expect(new Headers(createInit?.headers).get("Idempotency-Key")).toBe("walkin-hold-key");
    expect(JSON.parse(String(createInit?.body))).toEqual({
      variant_id: variantId,
      requested_interval: {
        start: "2026-10-12T02:00:00.000Z",
        end: "2026-10-14T02:00:00.000Z",
      },
      fulfillment_method: "pickup",
      payment_method_id: paymentMethodId,
    });
  });

  it("sends strict versioned reservation mutation bodies with the supplied idempotency key", async () => {
    const reservationId = "00000000-0000-4000-8000-000000000101";
    const summary = {
      id: reservationId,
      reference_code: "RSV-2026-0001",
      status: "confirmed",
      branch_id: "00000000-0000-4000-8000-000000000201",
      storefront_id: "00000000-0000-4000-8000-000000000202",
      variant_id: "00000000-0000-4000-8000-000000000104",
      payment_method_id: "00000000-0000-4000-8000-000000000106",
      fulfillment_method: "pickup",
      pickup_at: "2026-10-12T02:00:00.000Z",
      due_at: "2026-10-14T02:00:00.000Z",
      timezone_snapshot: "Asia/Manila",
      price_snapshot: {
        rental_total_minor: "150000",
        security_required_minor: "50000",
        due_now_minor: "200000",
        currency: "PHP",
      },
      hold_expires_at: null,
      version: 4,
      created_at: "2026-10-10T02:00:00.000Z",
    };
    const key = "reservation-intent-key";
    const client = createDrezivoApiClient(getToken);

    const cases = [
      {
        call: () =>
          client.completeStaffReservation(reservationId, { version: 3, terms_accepted: true }, key),
        path: `/api/v1/reservations/${reservationId}/complete-booking`,
        body: { version: 3, terms_accepted: true },
        response: {
          reservation: { ...summary, status: "confirmed" },
          completion_state: "confirmed",
          next_action: "none",
        },
      },
      {
        call: () =>
          client.cancelReservation(reservationId, { version: 3, reason: "Customer request" }, key),
        path: `/api/v1/reservations/${reservationId}/cancel`,
        body: { version: 3, reason: "Customer request" },
        response: { reservation: { ...summary, status: "cancelled" } },
      },
      {
        call: () =>
          client.pickupReservation(reservationId, { version: 3, condition_note: "Clean" }, key),
        path: `/api/v1/reservations/${reservationId}/pickup`,
        body: { version: 3, condition_note: "Clean" },
        response: { reservation: { ...summary, status: "picked_up" } },
      },
      {
        call: () =>
          client.returnReservation(reservationId, { version: 4, condition_note: "Returned" }, key),
        path: `/api/v1/reservations/${reservationId}/return`,
        body: { version: 4, condition_note: "Returned" },
        response: { reservation: { ...summary, status: "returned", version: 5 } },
      },
      {
        call: () =>
          client.inspectReservationReturn(
            reservationId,
            { version: 5, readiness: "needs_cleaning", condition_note: "Clean before reuse" },
            key
          ),
        path: `/api/v1/reservations/${reservationId}/inspection`,
        body: { version: 5, readiness: "needs_cleaning", condition_note: "Clean before reuse" },
        response: {
          reservation: { ...summary, status: "returned", version: 5 },
          asset_readiness: "needs_cleaning",
        },
      },
      {
        call: () => client.completeRentalReservation(reservationId, { version: 5 }, key),
        path: `/api/v1/reservations/${reservationId}/complete-rental`,
        body: { version: 5 },
        response: { reservation: { ...summary, status: "completed", version: 6 } },
      },
      {
        call: () =>
          client.rejectReservation(
            reservationId,
            { version: 2, reason: "Payment review failed" },
            key
          ),
        path: `/api/v1/reservations/${reservationId}/reject`,
        body: { version: 2, reason: "Payment review failed" },
        response: { reservation: { ...summary, status: "rejected", version: 3 } },
      },
    ];

    for (const testCase of cases) {
      fetchMock.mockResolvedValueOnce(success(testCase.response));
      await testCase.call();
      const [rawUrl, init] = fetchMock.mock.calls.at(-1)!;
      expect(new URL(String(rawUrl)).pathname).toBe(testCase.path);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(key);
      expect(JSON.parse(String(init?.body))).toEqual(testCase.body);
    }
  });
});

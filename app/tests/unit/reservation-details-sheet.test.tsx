import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reservationDetail, type PermissionCode, type ReservationDetail } from "@drezivo/contracts";

import { ReservationDetailsSheet } from "@/components/reservations/reservation-details-sheet";
import { buildEditBody } from "@/components/reservations/reservation-edit-form";

// A stable token getter: a new function per render would re-run every effect that depends on it.
const auth = vi.hoisted(() => ({ value: { getToken: () => Promise.resolve("token") } }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth.value }));
const api = vi.hoisted(() => ({ editReservation: vi.fn() }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    requestId: string | null = null;
    status: number;
    constructor(message: string, options: { code?: string; status?: number } = {}) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const MANAGE: PermissionCode[] = ["reservations.manage"];

function detailWith(overrides: Record<string, unknown>): ReservationDetail {
  return reservationDetail.parse({
    id: "00000000-0000-4000-8000-000000000101",
    reference_code: "RSV-CONT-001",
    status: "cancelled",
    branch_id: "00000000-0000-4000-8000-000000000201",
    storefront_id: "00000000-0000-4000-8000-000000000301",
    customer: {
      customer_id: "00000000-0000-4000-8000-000000000102",
      snapshot: { full_name: "Bea Santiago", phone: "09171234801", email: "bea@example.test", address: "12 Mabini St, Quezon City" },
    },
    lines: [
      {
        id: "00000000-0000-4000-8000-000000000103",
        variant_id: "00000000-0000-4000-8000-000000000104",
        product_id: "00000000-0000-4000-8000-000000000107",
        variant: { sku: "CEL-FREE", size_label: null, color_label: "Ivory", image_url: null },
        current_asset_readiness: "ready",
        line_number: 1,
        name_snapshot: "Celestine",
        measurements_snapshot: {},
        pricing_snapshot: { rental_minor: "550000", deposit_minor: "500000", currency: "PHP" },
      },
    ],
    pickup_at: "2026-10-17T02:00:00.000Z",
    due_at: "2026-10-20T02:00:00.000Z",
    timezone_snapshot: "Asia/Manila",
    event_date: "2026-10-18",
    delivery_snapshot: { fulfillment_method: "pickup" },
    price_snapshot: { rental_total_minor: "550000", security_required_minor: "500000", due_now_minor: "1050000", currency: "PHP" },
    payment: null,
    hold_acquired_at: "2026-10-10T02:00:00.000Z",
    hold_expires_at: null,
    terms_accepted_at: null,
    submitted_at: null,
    confirmed_at: null,
    completed_at: null,
    custody_timeline: [],
    version: 2,
    created_at: "2026-10-10T02:00:00.000Z",
    ...overrides,
  });
}

function renderSheet(detail: ReservationDetail, permissionCodes: PermissionCode[] = MANAGE) {
  const onContinue = vi.fn();
  const onMutationSuccess = vi.fn();
  render(
    <ReservationDetailsSheet
      reservationId={detail.id}
      detail={detail}
      error={null}
      isLoading={false}
      permissionCodes={permissionCodes}
      timeZone="Asia/Manila"
      onContinue={onContinue}
      onOpenChange={vi.fn()}
      onMutationSuccess={onMutationSuccess}
      onRefreshRequired={vi.fn()}
      onRetry={vi.fn()}
    />
  );
  return { onContinue, onMutationSuccess };
}

describe("ReservationDetailsSheet", () => {
  it("continues a cancelled reservation as a new booking with the same details", () => {
    const { onContinue } = renderSheet(detailWith({}));

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith({
      referenceCode: "RSV-CONT-001",
      productId: "00000000-0000-4000-8000-000000000107",
      variantId: "00000000-0000-4000-8000-000000000104",
      additionalGarments: [],
      pickupAt: "2026-10-17T02:00:00.000Z",
      dueAt: "2026-10-20T02:00:00.000Z",
      eventDate: "2026-10-18",
      fulfillmentMethod: "pickup",
      paymentMethodId: null,
      customer: {
        customerId: "00000000-0000-4000-8000-000000000102",
        fullName: "Bea Santiago",
        phone: "09171234801",
        email: "bea@example.test",
        address: "12 Mabini St, Quezon City",
      },
    });
  });

  it("continues every garment of a multi-garment booking", () => {
    const base = detailWith({});
    const second = {
      ...base.lines[0],
      id: "00000000-0000-4000-8000-000000000113",
      variant_id: "00000000-0000-4000-8000-000000000114",
      product_id: "00000000-0000-4000-8000-000000000117",
      line_number: 2,
      name_snapshot: "Amara",
    };
    const { onContinue } = renderSheet(detailWith({ lines: [base.lines[0], second] }));

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue.mock.calls[0]?.[0]).toMatchObject({
      variantId: "00000000-0000-4000-8000-000000000104",
      additionalGarments: [
        { productId: "00000000-0000-4000-8000-000000000117", variantId: "00000000-0000-4000-8000-000000000114", name: "Amara" },
      ],
    });
  });

  it.each(["expired", "rejected"] as const)("offers Continue on %s reservations", (status) => {
    renderSheet(detailWith({ status }));
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
  });

  it("does not offer Continue on live reservations", () => {
    renderSheet(detailWith({ status: "pending_confirmation" }));
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("hides Continue without reservation management permission", () => {
    renderSheet(detailWith({}), []);
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("shows a delivery request the shop must arrange, with the renter's address and contact actions", () => {
    renderSheet(
      detailWith({ status: "pending_confirmation", delivery_snapshot: { fulfillment_method: "delivery", fee_minor: "0", terms: "to_arrange" } })
    );

    expect(screen.getByText("Delivery requested")).toBeTruthy();
    expect(screen.getByText("The renter asked for delivery")).toBeTruthy();
    expect(screen.getByText("To arrange with the renter")).toBeTruthy();
    expect(screen.getAllByText("12 Mabini St, Quezon City").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /call 09171234801/i }).getAttribute("href")).toBe("tel:09171234801");
    expect(screen.getByRole("link", { name: /email the renter/i }).getAttribute("href")).toContain("mailto:bea@example.test");
  });

  it("shows the charged delivery fee when the shop offers delivery", () => {
    renderSheet(
      detailWith({ status: "confirmed", delivery_snapshot: { fulfillment_method: "delivery", fee_minor: "15000", terms: "set_fee" } })
    );

    expect(screen.getByText("The renter chose delivery")).toBeTruthy();
    expect(screen.getByText(/150/)).toBeTruthy();
  });

  it("offers Edit before pickup only", () => {
    renderSheet(detailWith({ status: "picked_up" }));
    expect(screen.queryByRole("button", { name: /edit details/i })).toBeNull();
  });

  it("switches a paid delivery booking to pickup after staff accept the lower price, sending one request per press", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.editReservation.mockReset();
    api.editReservation
      .mockRejectedValueOnce(
        new (DrezivoApiError as unknown as new (message: string, options: object) => Error)(
          "This change lowers the amount due to ₱10,250.00 from ₱10,500.00, and the renter already paid or sent a receipt. Confirm the price change to save it, then refund the difference.",
          { code: "PRICE_CHANGE_NOT_ACCEPTED", status: 409 }
        )
      )
      .mockResolvedValueOnce({
        data: {
          price_changed: true,
          previous_due_now_minor: "1050000",
          reservation: { price_snapshot: { due_now_minor: "1025000" } },
        },
      });
    const paid = detailWith({
      status: "confirmed",
      delivery_snapshot: { fulfillment_method: "delivery", fee_minor: "25000", terms: "set_fee" },
      payment: {
        id: "00000000-0000-4000-8000-000000000105",
        payment_method_id: "00000000-0000-4000-8000-000000000106",
        method_name: "GCash",
        rail: "manual_qr",
        status: "paid",
        evidence_status: "verified",
        amount_minor: "1050000",
        currency: "PHP",
        verified_at: "2026-10-10T03:00:00.000Z",
      },
    });
    const { onMutationSuccess } = renderSheet(paid);

    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Pickup" }));
    const save = screen.getByRole("button", { name: "Save changes" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(await screen.findByText(/Confirm the price change to save it/)).toBeTruthy();
    expect(api.editReservation).toHaveBeenCalledTimes(1);
    expect(api.editReservation.mock.calls[0]?.[1]).toEqual({ version: 2, fulfillment_method: "pickup" });

    fireEvent.click(screen.getByRole("button", { name: "Save with the new price" }));
    await waitFor(() => expect(onMutationSuccess).toHaveBeenCalledTimes(1));
    expect(api.editReservation.mock.calls[1]?.[1]).toEqual({ version: 2, fulfillment_method: "pickup", accept_price_change: true });
    // A new intent gets a new idempotency key; the refused one is not replayed.
    expect(api.editReservation.mock.calls[1]?.[2]).not.toBe(api.editReservation.mock.calls[0]?.[2]);
  });

  it("tells staff to refund the difference when the total dropped after payment", () => {
    renderSheet(
      detailWith({
        status: "confirmed",
        price_snapshot: { rental_total_minor: "550000", security_required_minor: "500000", due_now_minor: "1025000", currency: "PHP" },
        payment: {
          id: "00000000-0000-4000-8000-000000000105",
          payment_method_id: "00000000-0000-4000-8000-000000000106",
          method_name: "GCash",
          rail: "manual_qr",
          status: "paid",
          evidence_status: "verified",
          amount_minor: "1050000",
          currency: "PHP",
          verified_at: "2026-10-10T03:00:00.000Z",
        },
      })
    );
    expect(screen.getByText(/Refund .*250.* to the renter/)).toBeTruthy();
  });
});

describe("buildEditBody", () => {
  const original = {
    fullName: "Bea Santiago",
    phone: "09171234801",
    email: "",
    address: "12 Mabini St",
    eventDate: "",
    fulfillment: "pickup" as const,
    pickupDate: "2026-10-17",
    pickupTime: "10:00",
    dueDate: "2026-10-20",
    dueTime: "10:00",
  };

  it("sends nothing when nothing changed", () => {
    expect(buildEditBody(original, original, "Asia/Manila", true)).toEqual({ ok: true, body: {} });
  });

  it("sends new dates as branch-time instants", () => {
    expect(buildEditBody(original, { ...original, dueDate: "2026-10-21" }, "Asia/Manila", true)).toEqual({
      ok: true,
      body: { requested_interval: { start: "2026-10-17T02:00:00.000Z", end: "2026-10-21T02:00:00.000Z" } },
    });
  });

  it("refuses an incomplete phone and a missing contact", () => {
    expect(buildEditBody(original, { ...original, phone: "0917" }, "Asia/Manila", true)).toEqual({
      ok: false,
      problem: "The mobile number must have 11 digits.",
    });
    expect(buildEditBody(original, { ...original, phone: "" }, "Asia/Manila", true)).toEqual({
      ok: false,
      problem: "Keep a mobile number or an email for the customer.",
    });
  });

  it("refuses an event date outside the rental", () => {
    expect(buildEditBody(original, { ...original, eventDate: "2026-10-25" }, "Asia/Manila", true)).toEqual({
      ok: false,
      problem: "The event date must fall within the rental dates.",
    });
  });
});

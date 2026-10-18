import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reservationDetail, type PermissionCode, type ReservationDetail } from "@drezivo/contracts";

import { ReservationDetailsSheet } from "@/components/reservations/reservation-details-sheet";
import { buildEditBody } from "@/components/reservations/reservation-edit-form";

// A stable token getter: a new function per render would re-run every effect that depends on it.
const auth = vi.hoisted(() => ({ value: { getToken: () => Promise.resolve("token") } }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth.value }));
const api = vi.hoisted(() => ({ editReservation: vi.fn(), getReservationPaymentReceipts: vi.fn() }));
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
      snapshot: {
        full_name: "Bea Santiago",
        phone: "09171234801",
        email: "bea@example.test",
        address: "12 Mabini St, Quezon City",
      },
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
      {
        id: "00000000-0000-4000-8000-000000000108",
        variant_id: "00000000-0000-4000-8000-000000000109",
        product_id: "00000000-0000-4000-8000-000000000110",
        variant: { sku: "CEL-M", size_label: "M", color_label: "Ivory", image_url: null },
        current_asset_readiness: "ready",
        line_number: 2,
        name_snapshot: "Celestine Petite",
        measurements_snapshot: {},
        pricing_snapshot: { rental_minor: "550000", deposit_minor: "500000", currency: "PHP" },
      },
    ],
    pickup_at: "2026-10-17T02:00:00.000Z",
    due_at: "2026-10-20T02:00:00.000Z",
    timezone_snapshot: "Asia/Manila",
    event_date: "2026-10-18",
    delivery_snapshot: { fulfillment_method: "pickup" },
    price_snapshot: {
      rental_total_minor: "550000",
      security_required_minor: "500000",
      due_now_minor: "1050000",
      currency: "PHP",
    },
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
  it("omits SKU and lays out the remaining rental details in two columns", () => {
    renderSheet(detailWith({}));

    expect(screen.queryByText("SKU")).not.toBeInTheDocument();
    expect(screen.getAllByText("Variant")).toHaveLength(2);
    expect(screen.getAllByText("Rental")).toHaveLength(2);
    expect(screen.getAllByText("Deposit")).toHaveLength(2);

    const detailsGrid = screen.getAllByText("Variant")[0]?.parentElement?.parentElement;
    expect(detailsGrid).toHaveClass("grid", "grid-cols-2");
  });

  it("starts a replacement reservation with every original line and the same available details", () => {
    const { onContinue } = renderSheet(detailWith({}));

    fireEvent.click(screen.getByRole("button", { name: /create new reservation from this/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith({
      referenceCode: "RSV-CONT-001",
      lines: [
        {
          sourceLineId: "00000000-0000-4000-8000-000000000103",
          productId: "00000000-0000-4000-8000-000000000107",
          variantId: "00000000-0000-4000-8000-000000000104",
          name: "Celestine",
        },
        {
          sourceLineId: "00000000-0000-4000-8000-000000000108",
          productId: "00000000-0000-4000-8000-000000000110",
          variantId: "00000000-0000-4000-8000-000000000109",
          name: "Celestine Petite",
        },
      ],
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

  it.each(["expired", "rejected"] as const)("offers rebooking on %s reservations", (status) => {
    renderSheet(detailWith({ status }));
    expect(screen.getByRole("button", { name: /create new reservation from this/i })).toBeTruthy();
  });

  it("does not offer Continue on live reservations", () => {
    renderSheet(detailWith({ status: "pending_confirmation" }));
    expect(screen.queryByRole("button", { name: /create new reservation from this/i })).toBeNull();
  });

  it("hides Continue without reservation management permission", () => {
    renderSheet(detailWith({}), []);
    expect(screen.queryByRole("button", { name: /create new reservation from this/i })).toBeNull();
  });

  it("shows completed payment receipts only to staff with payment and evidence permissions", async () => {
    api.getReservationPaymentReceipts.mockReset().mockResolvedValue({
      data: {
        receipts: [
          {
            file_id: "00000000-0000-4000-8000-000000000901",
            content_type: "image/png",
            url: "https://files.test/completed-receipt.png",
            submitted_at: "2026-10-10T02:05:00.000Z",
            evidence_status: "verified",
          },
        ],
      },
      requestId: "req-completed-receipts",
    });
    const completed = detailWith({
      status: "completed",
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

    renderSheet(completed, [...MANAGE, "payments.manage", "evidence.verify"]);

    expect(await screen.findByRole("button", { name: "View proof of payment 1 full size" })).toBeTruthy();
    expect(screen.getByText("Payment receipt")).toBeTruthy();
    expect(api.getReservationPaymentReceipts).toHaveBeenCalledWith(completed.id);
  });

  it.each([
    ["without evidence verification", [...MANAGE, "payments.manage"] as PermissionCode[]],
    ["without payment management", [...MANAGE, "evidence.verify"] as PermissionCode[]],
  ])("does not request or display completed payment receipts %s", (_scenario, permissions) => {
    api.getReservationPaymentReceipts.mockReset();
    const completed = detailWith({
      status: "completed",
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

    renderSheet(completed, permissions);

    expect(api.getReservationPaymentReceipts).not.toHaveBeenCalled();
    expect(screen.queryByText("Payment receipt")).toBeNull();
  });

  it("shows a delivery request the shop must arrange, with the renter's address and contact actions", () => {
    renderSheet(
      detailWith({
        status: "pending_confirmation",
        delivery_snapshot: { fulfillment_method: "delivery", fee_minor: "0", terms: "to_arrange" },
      })
    );

    expect(screen.getByText("Delivery requested")).toBeTruthy();
    expect(screen.getByText("The renter asked for delivery")).toBeTruthy();
    expect(screen.getByText("To arrange with the renter")).toBeTruthy();
    expect(screen.getAllByText("12 Mabini St, Quezon City").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /call 09171234801/i }).getAttribute("href")).toBe(
      "tel:09171234801"
    );
    expect(screen.getByRole("link", { name: /email the renter/i }).getAttribute("href")).toContain(
      "mailto:bea@example.test"
    );
  });

  it("shows the charged delivery fee when the shop offers delivery", () => {
    renderSheet(
      detailWith({
        status: "confirmed",
        delivery_snapshot: { fulfillment_method: "delivery", fee_minor: "15000", terms: "set_fee" },
      })
    );

    expect(screen.getByText("The renter chose delivery")).toBeTruthy();
    expect(screen.getByText(/150/)).toBeTruthy();
  });

  it("places Edit between Pick Up and Cancel for confirmed reservations", () => {
    renderSheet(detailWith({ status: "confirmed" }), [
      "reservations.manage",
      "reservations.custody",
    ]);

    const buttons = screen.getAllByRole("button");
    const pickupIndex = buttons.indexOf(screen.getByRole("button", { name: "Pick Up" }));
    const editIndex = buttons.indexOf(screen.getByRole("button", { name: "Edit" }));
    const cancelIndex = buttons.indexOf(screen.getByRole("button", { name: "Cancel" }));

    expect(pickupIndex).toBeLessThan(editIndex);
    expect(editIndex).toBeLessThan(cancelIndex);
  });

  it.each(["held", "pending_confirmation", "picked_up", "returned", "cancelled"] as const)(
    "does not offer Edit for %s reservations",
    (status) => {
      renderSheet(detailWith({ status }));
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    }
  );

  it("hides Edit without reservation management permission", () => {
    renderSheet(detailWith({ status: "confirmed" }), []);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("opens a customer-only form and hides lifecycle actions while editing", () => {
    renderSheet(detailWith({ status: "confirmed" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Customer on this reservation")).toBeTruthy();
    expect(screen.getByLabelText("Full name")).toBeTruthy();
    expect(screen.getByLabelText("Mobile number")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Address")).toBeTruthy();
    expect(screen.queryByText("Pickup date")).toBeNull();
    expect(screen.queryByText("Pickup or delivery")).toBeNull();
    expect(screen.queryByText("Reservation actions")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("saves edited customer facts to this reservation only", async () => {
    api.editReservation.mockReset().mockResolvedValue({
      data: { reservation: {} },
    });
    const { onMutationSuccess } = renderSheet(detailWith({ status: "confirmed" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Bea Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onMutationSuccess).toHaveBeenCalledTimes(1));
    expect(api.editReservation).toHaveBeenCalledTimes(1);
    expect(api.editReservation.mock.calls[0]?.[1]).toEqual({
      version: 2,
      customer: {
        full_name: "Bea Updated",
        phone: "09171234801",
        email: "bea@example.test",
        address: "12 Mabini St, Quezon City",
      },
    });
  });

  it("tells staff to refund the difference when the total dropped after payment", () => {
    renderSheet(
      detailWith({
        status: "confirmed",
        price_snapshot: {
          rental_total_minor: "550000",
          security_required_minor: "500000",
          due_now_minor: "1025000",
          currency: "PHP",
        },
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
    email: "bea@example.test",
    address: "12 Mabini St",
  };

  it("sends nothing when nothing changed", () => {
    expect(buildEditBody(original, original, true)).toEqual({ ok: true, body: {} });
  });

  it("sends only validated customer snapshot fields", () => {
    expect(buildEditBody(original, { ...original, fullName: "Bea Updated" }, true)).toEqual({
      ok: true,
      body: {
        customer: {
          full_name: "Bea Updated",
          phone: "09171234801",
          email: "bea@example.test",
          address: "12 Mabini St",
        },
      },
    });
  });

  it("rejects invalid contact details and missing customer snapshot", () => {
    expect(buildEditBody(original, { ...original, phone: "0917" }, true).ok).toBe(false);
    expect(buildEditBody(original, { ...original, phone: "", email: "" }, true).ok).toBe(false);
    expect(buildEditBody(original, original, false).ok).toBe(false);
  });
});

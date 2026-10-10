import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reservationDetail, type PermissionCode, type ReservationDetail } from "@drezivo/contracts";

import { ReservationDetailsSheet } from "@/components/reservations/reservation-details-sheet";

// A stable token getter: a new function per render would re-run every effect that depends on it.
const auth = vi.hoisted(() => ({ value: { getToken: () => Promise.resolve("token") } }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {},
  createDrezivoApiClient: () => ({}),
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
      onMutationSuccess={vi.fn()}
      onRefreshRequired={vi.fn()}
      onRetry={vi.fn()}
    />
  );
  return { onContinue };
}

describe("ReservationDetailsSheet", () => {
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
});

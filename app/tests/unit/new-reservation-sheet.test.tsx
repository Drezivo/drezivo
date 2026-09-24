import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clothingDetail,
  clothingListItem,
  staffReservationCompleteResponse,
  staffReservationCreateResponse,
} from "@drezivo/contracts";

import { NewReservationSheet } from "@/components/reservations/new-reservation-sheet";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  cancelReservation: vi.fn(),
  completeStaffReservation: vi.fn(),
  createStaffReservation: vi.fn(),
  getCatalogueClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getStaffReservationIntakeOptions: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code: string;
    requestId: string | null;
    status: number;

    constructor(
      message: string,
      options: { code?: string; requestId?: string | null; status?: number } = {}
    ) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const ids = {
  product: "00000000-0000-4000-8000-000000000101",
  variant: "00000000-0000-4000-8000-000000000102",
  asset: "00000000-0000-4000-8000-000000000103",
  paymentMethod: "00000000-0000-4000-8000-000000000104",
  reservation: "00000000-0000-4000-8000-000000000105",
  branch: "00000000-0000-4000-8000-000000000106",
  storefront: "00000000-0000-4000-8000-000000000107",
  customer: "00000000-0000-4000-8000-000000000108",
};

const product = clothingListItem.parse({
  product_id: ids.product,
  code: "EMERALD-GOWN",
  name: "Emerald Gown",
  category: { id: "00000000-0000-4000-8000-000000000109", name: "Gowns" },
  product_status: "active",
  size_labels: ["M"],
  price_from_minor: "150000",
  currency: "PHP",
  primary_image_url: null,
  readiness: {
    active_assets: 1,
    ready: 1,
    needs_cleaning: 0,
    needs_repair: 0,
    unready: 0,
  },
  availability: {
    window: {
      start: "2026-10-09T18:00:00.000Z",
      end: "2026-10-11T18:00:00.000Z",
    },
    active_assets: 1,
    available_assets: 1,
    unavailable_assets: 0,
    reserved_assets: 0,
    rented_assets: 0,
    cleaning_assets: 0,
    maintenance_assets: 0,
    manual_blocked_assets: 0,
  },
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

const detail = clothingDetail.parse({
  product_id: ids.product,
  code: "EMERALD-GOWN",
  name: "Emerald Gown",
  description: "Test gown",
  category: product.category,
  status: "active",
  images: [],
  variants: [
    {
      id: ids.variant,
      sku: "EMERALD-M",
      size_label: "M",
      color_label: "Emerald",
      measurement_mode: "custom",
      measurement_guide_id: null,
      measurement_unit: "cm",
      measurements: { bust: 91, waist: 72 },
      rental_price_minor: "150000",
      security_deposit_minor: "50000",
      currency: "PHP",
      pricing_mode: "fixed_duration",
      included_duration_minutes: 4320,
      extra_day_price_minor: "40000",
      prep_minutes: 60,
      turnaround_minutes: 1440,
      status: "active",
      assets: [
        {
          id: ids.asset,
          branch_id: ids.branch,
          variant_id: ids.variant,
          asset_code: "ASSET-1",
          lifecycle_status: "active",
          readiness: "ready",
          custody_kind: "at_branch",
          condition_note: null,
          measurement_overrides: null,
          alteration_note: null,
          version: 1,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ],
  upcoming_allocations: [],
  has_more_upcoming_allocations: false,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

const heldResponse = staffReservationCreateResponse.parse({
  reservation: {
    id: ids.reservation,
    reference_code: "RSV-WALKIN-001",
    status: "held",
    branch_id: ids.branch,
    storefront_id: ids.storefront,
    variant_id: ids.variant,
    payment_method_id: ids.paymentMethod,
    fulfillment_method: "pickup",
    pickup_at: "2026-10-09T18:00:00.000Z",
    due_at: "2026-10-11T18:00:00.000Z",
    timezone_snapshot: "Asia/Manila",
    event_date: "2026-10-11",
    price_snapshot: {
      rental_total_minor: "150000",
      security_required_minor: "50000",
      due_now_minor: "200000",
      currency: "PHP",
    },
    hold_expires_at: "2099-10-09T18:15:00.000Z",
    version: 1,
    created_at: "2026-10-09T18:00:00.000Z",
  },
  payment_instructions: {
    method_name: "Cash",
    rail: "cash",
    destination_note: "Pay at the counter.",
  },
});

const pendingResponse = staffReservationCompleteResponse.parse({
  reservation: {
    ...heldResponse.reservation,
    status: "pending_confirmation",
    version: 2,
  },
  completion_state: "pending_confirmation",
  next_action: "payment_verification",
});

function listPage(items = [product]) {
  return {
    data: { items, page_meta: { next_cursor: null, has_more: false } },
    requestId: "req-catalogue",
  };
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof NewReservationSheet>> = {}) {
  const props: React.ComponentProps<typeof NewReservationSheet> = {
    open: true,
    onOpenChange: vi.fn(),
    onReservationChanged: vi.fn(),
    onViewReservation: vi.fn(),
    permissionCodes: ["reservations.manage"],
    timeZone: "Asia/Manila",
    ...overrides,
  };
  return { ...render(<NewReservationSheet {...props} />), props };
}

async function fillDatesAndSelectProduct() {
  fireEvent.change(screen.getByLabelText("Pickup date and time"), {
    target: { value: "2026-10-10T02:00" },
  });
  fireEvent.change(screen.getByLabelText("Return date and time"), {
    target: { value: "2026-10-12T02:00" },
  });
  fireEvent.change(screen.getByLabelText("Event date (optional)"), {
    target: { value: "2026-10-11" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
  await screen.findByRole("button", { name: /M · Emerald/i });
}

describe("NewReservationSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStaffReservationIntakeOptions.mockResolvedValue({
      data: {
        payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
        customers: [],
      },
      requestId: "req-intake",
    });
    api.getCatalogueClothing.mockResolvedValue(listPage());
    api.getCatalogueClothingDetail.mockResolvedValue({ data: detail, requestId: "req-detail" });
    api.createStaffReservation.mockResolvedValue({ data: heldResponse, requestId: "req-hold" });
    api.completeStaffReservation.mockResolvedValue({
      data: pendingResponse,
      requestId: "req-complete",
    });
    api.cancelReservation.mockResolvedValue({
      data: { reservation: { ...heldResponse.reservation, status: "cancelled", version: 2 } },
      requestId: "req-cancel",
    });
  });

  it("runs the staff fast path from advisory availability through hold and truthful pending completion", async () => {
    const { props } = renderSheet();
    await fillDatesAndSelectProduct();

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        {
          variant_id: ids.variant,
          requested_interval: {
            start: "2026-10-09T18:00:00.000Z",
            end: "2026-10-11T18:00:00.000Z",
          },
          event_date: "2026-10-11",
          fulfillment_method: "pickup",
          payment_method_id: ids.paymentMethod,
        },
        expect.any(String)
      )
    );
    expect(api.createStaffReservation.mock.calls[0]![0]).not.toHaveProperty("customer");
    expect(await screen.findByText("RSV-WALKIN-001")).toBeVisible();
    expect(screen.getByText(/Garment reserved for/i)).toBeVisible();
    expect(screen.getByText("₱2,000")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Walk-in Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Customer has reviewed and accepted the business rental terms/i,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: {
            source: "new",
            customer: { full_name: "Walk-in Customer", phone: "09171234567" },
          },
        },
        expect.any(String)
      )
    );
    expect(
      await screen.findByText("Reservation saved. Awaiting payment verification.")
    ).toBeVisible();
    expect(props.onReservationChanged).toHaveBeenCalledWith(ids.reservation);
  });

  it("stops before creating a reservation when the availability preview has no free garment", async () => {
    api.getCatalogueClothing.mockResolvedValue(
      listPage([
        clothingListItem.parse({
          ...product,
          availability: { ...product.availability, available_assets: 0, unavailable_assets: 1 },
        }),
      ])
    );
    renderSheet();
    await fillDatesAndSelectProduct();

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The availability preview shows no free garment for this window."
    );
    expect(api.createStaffReservation).not.toHaveBeenCalled();
  });

  it("can attach an existing tenant customer only after the garment hold exists", async () => {
    api.getStaffReservationIntakeOptions.mockImplementation((input: { customer_search?: string }) =>
      Promise.resolve({
        data: {
          payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
          customers: input.customer_search
            ? [
                {
                  id: ids.customer,
                  full_name: "Maria Existing",
                  phone: "09170000000",
                  email: "maria@example.test",
                },
              ]
            : [],
        },
        requestId: "req-intake",
      })
    );
    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    fireEvent.click(screen.getByRole("button", { name: "Existing customer" }));
    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "Maria" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Maria Existing/i }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Customer has reviewed and accepted the business rental terms/i,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: { source: "existing", customer_id: ids.customer },
        },
        expect.any(String)
      )
    );
  });

  it("refreshes advisory availability when Reserve loses the authoritative capacity race", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.createStaffReservation.mockRejectedValueOnce(
      new DrezivoApiError("The last garment was reserved by another staff member.", {
        code: "CAPACITY_CONFLICT",
        status: 409,
        requestId: "req-capacity",
      })
    );
    renderSheet();
    await fillDatesAndSelectProduct();
    const readsBeforeReserve = api.getCatalogueClothing.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The last garment was reserved by another staff member."
    );
    await waitFor(() =>
      expect(api.getCatalogueClothing.mock.calls.length).toBeGreaterThan(readsBeforeReserve)
    );
  });

  it("switches to expiry recovery when database time expires the hold during completion", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.completeStaffReservation.mockRejectedValueOnce(
      new DrezivoApiError("The reservation hold has expired.", {
        code: "HOLD_EXPIRED",
        status: 409,
        requestId: "req-expired",
      })
    );
    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Walk-in Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Customer has reviewed and accepted the business rental terms/i,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete Reservation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/hold has expired/i);
    expect(screen.getByRole("button", { name: "Start over" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Complete Reservation" })).not.toBeInTheDocument();
  });

  it("explicitly cancels an active walk-in hold instead of waiting for expiry", async () => {
    const { props } = renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    fireEvent.click(screen.getByRole("button", { name: "Cancel Hold" }));

    await waitFor(() =>
      expect(api.cancelReservation).toHaveBeenCalledWith(
        ids.reservation,
        { version: 1, reason: "Staff abandoned new reservation flow" },
        expect.any(String)
      )
    );
    expect(await screen.findByText(/garment hold was released/i)).toBeVisible();
    expect(props.onReservationChanged).toHaveBeenCalledWith(ids.reservation);
  });
});

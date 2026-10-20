import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clothingDetail,
  clothingListItem,
  customerDetailResponse,
  staffReservationAvailabilityCalendarResponse,
  staffReservationAvailabilityCheckResponse,
  staffReservationCompleteResponse,
  staffReservationCreateResponse,
} from "@drezivo/contracts";

import { NewReservationSheet } from "@/components/reservations/new-reservation-sheet";
import {
  AdditionalGarments,
  SelectedGarmentCard,
  type AdditionalGarment,
} from "@/components/reservations/additional-garments";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  cancelReservation: vi.fn(),
  completeStaffReservation: vi.fn(),
  attachReservationPaymentReceipt: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  createStaffReservation: vi.fn(),
  getCatalogueClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getBusinessHours: vi.fn(),
  getStaffReservationAvailabilityCalendar: vi.fn(),
  getStaffReservationAvailabilityCheck: vi.fn(),
  getStaffReservationIntakeOptions: vi.fn(),
  getReservationDetail: vi.fn(),
  getCustomerDetail: vi.fn(),
}));

const fileUpload = vi.hoisted(() => ({
  uploadAuthorizedFile: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("@/lib/authorized-file-upload", () => fileUpload);

vi.mock("@/components/reservations/reservation-availability-calendar", () => ({
  ReservationAvailabilityCalendar: ({
    onRangeChange,
    error,
  }: {
    onRangeChange: (range: { pickupDate: string; dueDate: string }) => void;
    error?: string | null;
  }) => (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => onRangeChange({ pickupDate: "2026-10-10", dueDate: "2026-10-13" })}
      >
        Select Oct 10 to Oct 13
      </button>
      <button
        type="button"
        onClick={() => onRangeChange({ pickupDate: "2026-10-10", dueDate: "2026-10-11" })}
      >
        Select short range
      </button>
      <button
        type="button"
        onClick={() => onRangeChange({ pickupDate: "2026-10-10", dueDate: "2026-10-12" })}
      >
        Select pickup-day-one range
      </button>
      <button
        type="button"
        onClick={() => onRangeChange({ pickupDate: "2026-10-20", dueDate: "2026-10-23" })}
      >
        Select later range
      </button>
    </div>
  ),
  availabilityWindow: () => ({ startDate: "2026-10-01", endDate: "2026-10-31" }),
  parseCalendarDate: (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return year && month && day ? new Date(year, month - 1, day) : null;
  },
  todayInTimeZone: () => "2026-10-01",
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
  secondVariant: "00000000-0000-4000-8000-000000000111",
  asset: "00000000-0000-4000-8000-000000000103",
  paymentMethod: "00000000-0000-4000-8000-000000000104",
  gcashPaymentMethod: "00000000-0000-4000-8000-000000000110",
  reservation: "00000000-0000-4000-8000-000000000105",
  branch: "00000000-0000-4000-8000-000000000106",
  storefront: "00000000-0000-4000-8000-000000000107",
  customer: "00000000-0000-4000-8000-000000000108",
};

const customerProfile = (overrides: Record<string, unknown> = {}) =>
  customerDetailResponse.parse({
    id: ids.customer,
    full_name: "Maria Existing",
    phone: "09170000000",
    email: "maria@example.test",
    address: "1 Existing Street",
    social_media: null,
    notes: null,
    status: "active",
    archived_at: null,
    reservation_count: 0,
    fitting_count: 0,
    completed_engagement_count: 0,
    last_activity: null,
    next_activity: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });

const product = clothingListItem.parse({
  product_id: ids.product,
  code: "EMERALD-GOWN",
  name: "Emerald Gown",
  category: { id: "00000000-0000-4000-8000-000000000109", name: "Gowns" },
  product_status: "active",
  sizing_mode: "sized",
  has_free_size: false,
  size_labels: ["M", "L"],
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
  sizing_mode: "sized",
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

const secondVariant = {
  ...detail.variants[0]!,
  id: ids.secondVariant,
  sku: "EMERALD-L",
  size_label: "L",
  assets: [],
};
const multiSizeDetail = clothingDetail.parse({
  ...detail,
  variants: [...detail.variants, secondVariant],
});

const sizedVariant = detail.variants[0];
if (!sizedVariant) throw new Error("The test detail must include a variant.");

const freeSizeDetail = clothingDetail.parse({
  ...detail,
  sizing_mode: "free_size",
  variants: [{ ...sizedVariant, size_label: null }],
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
    pickup_at: "2026-10-10T02:00:00.000Z",
    due_at: "2026-10-13T02:00:00.000Z",
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

const heldDetailResponse = {
  data: {
    lines: [
      {
        id: "00000000-0000-4000-8000-000000000120",
        variant_id: ids.variant,
        variant: { sku: "EMERALD-M", size_label: "M", color_label: "Emerald", image_url: null },
        line_number: 1,
        name_snapshot: "Emerald Gown",
        pricing_snapshot: { rental_minor: "150000", deposit_minor: "50000", currency: "PHP" },
      },
      {
        id: "00000000-0000-4000-8000-000000000121",
        variant_id: ids.secondVariant,
        variant: { sku: "EMERALD-L", size_label: "L", color_label: "Emerald", image_url: null },
        line_number: 2,
        name_snapshot: "Emerald Gown",
        pricing_snapshot: { rental_minor: "150000", deposit_minor: "50000", currency: "PHP" },
      },
    ],
  },
  requestId: "req-reservation-detail",
};

const confirmedResponse = staffReservationCompleteResponse.parse({
  reservation: {
    ...heldResponse.reservation,
    status: "confirmed",
    version: 3,
  },
  completion_state: "confirmed",
  next_action: "none",
});

const completedResponse = staffReservationCompleteResponse.parse({
  reservation: {
    ...heldResponse.reservation,
    status: "completed",
    version: 3,
  },
  completion_state: "completed",
  next_action: "payment_verification",
});

const gcashHeldResponse = staffReservationCreateResponse.parse({
  reservation: {
    ...heldResponse.reservation,
    payment_method_id: ids.gcashPaymentMethod,
  },
  payment_instructions: {
    method_name: "GCash",
    rail: "manual_qr",
    destination_note: "Scan the merchant QR.",
  },
});

const gcashPendingResponse = staffReservationCompleteResponse.parse({
  reservation: {
    ...gcashHeldResponse.reservation,
    status: "pending_confirmation",
    version: 2,
  },
  completion_state: "pending_confirmation",
  next_action: "payment_verification",
});

const calendarResponse = staffReservationAvailabilityCalendarResponse.parse({
  variant_id: ids.variant,
  timezone: "Asia/Manila",
  window: { start_date: "2026-10-01", end_date: "2026-10-31" },
  active_assets: 1,
  ready_assets: 1,
  pricing: {
    pricing_mode: "fixed_duration",
    rental_price_minor: "150000",
    security_deposit_minor: "50000",
    currency: "PHP",
    included_duration_minutes: 4320,
    minimum_duration_minutes: 4320,
    extra_day_price_minor: "40000",
    recovery_minutes: 1440,
  },
  days: [
    {
      date: "2026-10-10",
      state: "available",
      active_assets: 1,
      ready_assets: 1,
      available_assets: 1,
      reserved_assets: 0,
      rented_assets: 0,
      fitting_assets: 0,
      maintenance_assets: 0,
      transfer_assets: 0,
    },
  ],
});

const exactResponse = staffReservationAvailabilityCheckResponse.parse({
  variant_id: ids.variant,
  requested_interval: {
    start: "2026-10-10T02:00:00.000Z",
    end: "2026-10-13T02:00:00.000Z",
  },
  blocked_interval: {
    start: "2026-10-10T02:00:00.000Z",
    end: "2026-10-14T02:00:00.000Z",
  },
  available: true,
  available_assets: 1,
  guaranteed: false,
  pricing: calendarResponse.pricing,
  rental_preview: {
    rental_total_minor: "150000",
    extra_day_count: 0,
    currency: "PHP",
  },
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

async function selectProductVariantAndRentalPeriod() {
  fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
  const variant = await screen.findByRole("button", { name: /M · Emerald/i });
  fireEvent.click(variant);
  fireEvent.click(await screen.findByRole("button", { name: "Select Oct 10 to Oct 13" }));
  setPickerTime("Pickup time", "10", "00", "AM");
  setPickerTime("Return time", "10", "00", "AM");
  fireEvent.click(screen.getByRole("button", { name: "Event date (optional)" }));
  fireEvent.click(screen.getByRole("button", { name: /October 11/i }));
  await waitFor(() => expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalled());
}

function setPickerTime(label: string, hour: string, minute: string, period: "AM" | "PM") {
  const hourInput = screen.getByRole("textbox", { name: `${label} hour` });
  const minuteInput = screen.getByRole("textbox", { name: `${label} minute` });
  const periodInput = screen.getByRole("combobox", { name: `${label} period` });
  fireEvent.change(hourInput, { target: { value: hour } });
  fireEvent.change(minuteInput, { target: { value: minute } });
  fireEvent.change(periodInput, { target: { value: period } });
}

const fillDatesAndSelectProduct = selectProductVariantAndRentalPeriod;

describe("NewReservationSheet", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    let receiptPreviewCounter = 0;
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:receipt-${++receiptPreviewCounter}`),
      revokeObjectURL: vi.fn(),
    });
    fileUpload.uploadAuthorizedFile.mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStaffReservationIntakeOptions.mockResolvedValue({
      data: {
        payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
        customers: [],
      },
      requestId: "req-intake",
    });
    api.getCustomerDetail.mockResolvedValue({
      data: customerProfile(),
      requestId: "req-customer-detail",
    });
    api.getCatalogueClothing.mockResolvedValue(listPage());
    api.getBusinessHours.mockResolvedValue({
      data: {
        branch_id: ids.branch,
        branch_name: "Main Branch",
        timezone: "Asia/Manila",
        opens_local: "08:00",
        closes_local: "20:00",
        closed_weekdays: [],
        version: 1,
        updated_at: "2026-10-01T00:00:00.000Z",
      },
      requestId: "req-business-hours",
    });
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: multiSizeDetail,
      requestId: "req-detail",
    });
    api.getStaffReservationAvailabilityCalendar.mockResolvedValue({
      data: calendarResponse,
      requestId: "req-calendar",
    });
    api.getStaffReservationAvailabilityCheck.mockResolvedValue({
      data: exactResponse,
      requestId: "req-exact",
    });
    api.getReservationDetail.mockResolvedValue(heldDetailResponse);
    api.createStaffReservation.mockResolvedValue({ data: heldResponse, requestId: "req-hold" });
    api.completeStaffReservation.mockResolvedValue({
      data: confirmedResponse,
      requestId: "req-complete",
    });
    api.cancelReservation.mockResolvedValue({
      data: { reservation: { ...heldResponse.reservation, status: "cancelled", version: 2 } },
      requestId: "req-cancel",
    });
  });

  it("selects distinct sizes of one style, highlights the style, and reserves each variant once", async () => {
    renderSheet();
    await fillDatesAndSelectProduct();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reserve" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: /Choose Emerald Gown/i }).textContent).toContain(
      "1 selected"
    );
    fireEvent.click(screen.getByRole("button", { name: /Add another size of Emerald Gown/i }));
    const extraSizes = await screen.findByRole("group", { name: "Emerald Gown size" });
    expect(within(extraSizes).getByRole("button", { name: /M · Emerald/i })).toBeDisabled();
    fireEvent.click(within(extraSizes).getByRole("button", { name: /L · Emerald/i }));
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalledWith(
        expect.objectContaining({ variant_id: ids.secondVariant })
      )
    );
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCalendar).toHaveBeenCalledWith(
        expect.objectContaining({ variant_id: ids.secondVariant })
      )
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Reserve" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          variant_id: ids.variant,
          additional_variant_ids: [ids.secondVariant],
        }),
        expect.any(String)
      )
    );
    expect(api.createStaffReservation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Garments in this reservation")).toBeTruthy();
    expect(await screen.findAllByText("Emerald Gown")).toHaveLength(2);
    expect(await screen.findAllByText(/Rental ₱1,500/)).toHaveLength(2);
  });

  it("renders Bianca's sizes as equal selected-garment cards with independent removal", async () => {
    const biancaProduct = clothingListItem.parse({
      ...product,
      name: "Bianca",
      code: "BIANCA",
      size_labels: ["Small", "Medium"],
    });
    const biancaDetail = clothingDetail.parse({
      ...multiSizeDetail,
      name: "Bianca",
      code: "BIANCA",
      variants: multiSizeDetail.variants.map((variant, index) => ({
        ...variant,
        size_label: index === 0 ? "Small" : "Medium",
      })),
    });
    api.getCatalogueClothing.mockResolvedValue(listPage([biancaProduct]));
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: biancaDetail,
      requestId: "req-bianca-detail",
    });
    renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: /Choose Bianca/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Small · Emerald/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Add another size of Bianca/i }));
    const sizeGroup = await screen.findByRole("group", { name: "Bianca size" });
    fireEvent.click(within(sizeGroup).getByRole("button", { name: /Medium · Emerald/i }));

    const smallRemove = await screen.findByRole("button", {
      name: /Remove Bianca · Small · Emerald from this booking/,
    });
    const mediumRemove = screen.getByRole("button", {
      name: /Remove Bianca · Medium · Emerald from this booking/,
    });
    const smallCard = smallRemove.closest("div.rounded-lg");
    const mediumCard = mediumRemove.closest("div.rounded-lg");
    expect(smallCard).not.toBeNull();
    expect(mediumCard).not.toBeNull();
    expect(smallCard!.className).toBe(mediumCard!.className);
    expect(smallCard).toHaveTextContent("Small · Emerald");
    expect(mediumCard).toHaveTextContent("Medium · Emerald");
    expect(smallCard).toHaveTextContent(/Rental ₱1,500/);
    expect(mediumCard).toHaveTextContent(/Rental ₱1,500/);

    fireEvent.click(smallRemove);
    expect(
      screen.queryByRole("button", { name: /Remove Bianca · Small · Emerald from this booking/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove Bianca · Medium · Emerald from this booking/ })
    ).toBeVisible();
  });

  it("keeps a removed flexible-fit card out of the selection until the catalogue adds it again", async () => {
    const rosalieProductId = "00000000-0000-4000-8000-000000000121";
    const rosalieVariantId = "00000000-0000-4000-8000-000000000122";
    const rosalieProduct = clothingListItem.parse({
      ...product,
      product_id: rosalieProductId,
      code: "ROSALIE-FS",
      name: "Rosalie",
      sizing_mode: "free_size",
      has_free_size: true,
      size_labels: [],
    });
    const rosalieDetail = clothingDetail.parse({
      ...freeSizeDetail,
      product_id: rosalieProductId,
      code: "ROSALIE-FS",
      name: "Rosalie",
      variants: freeSizeDetail.variants.map((variant) => ({
        ...variant,
        id: rosalieVariantId,
        sku: "ROSALIE-FS",
        assets: variant.assets.map((asset) => ({ ...asset, variant_id: rosalieVariantId })),
      })),
    });
    api.getCatalogueClothing.mockResolvedValue(listPage([product, rosalieProduct]));
    api.getCatalogueClothingDetail.mockImplementation((productId: string) =>
      Promise.resolve({
        data: productId === rosalieProductId ? rosalieDetail : multiSizeDetail,
        requestId: `req-detail-${productId}`,
      })
    );

    renderSheet();
    await selectProductVariantAndRentalPeriod();
    fireEvent.click(await screen.findByRole("button", { name: "Add Rosalie" }));

    const rosalieRemove = await screen.findByRole("button", {
      name: /Remove Rosalie.*from this booking/,
    });
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalledWith({
        variant_id: rosalieVariantId,
        pickup_at: exactResponse.requested_interval.start,
        due_at: exactResponse.requested_interval.end,
      })
    );
    fireEvent.click(rosalieRemove);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Remove Rosalie.*from this booking/ })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Remove Emerald Gown · M · Emerald/i })
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Reserve" })).toBeEnabled();
    });
    expect(
      screen.queryByText("Select a variant to view its rental calendar.")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Rosalie" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add Rosalie" }));
    expect(
      await screen.findByRole("button", { name: /Remove Rosalie.*from this booking/ })
    ).toBeVisible();
  });

  it("pre-fills rebooking from a finished reservation and re-checks every copied line", async () => {
    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-001",
        lines: [
          {
            sourceLineId: "source-line-1",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Amara",
          },
        ],
        pickupAt: "2027-03-12T02:00:00.000Z",
        dueAt: "2027-03-15T02:00:00.000Z",
        eventDate: "2027-03-13",
        fulfillmentMethod: "delivery",
        paymentMethodId: ids.paymentMethod as never,
        customer: {
          customerId: ids.customer as never,
          fullName: "Bea Santiago",
          phone: null,
          email: null,
          address: null,
        },
      },
    });

    expect(
      await screen.findByText(
        /Copied from RSV-OLD-001\. Dates, availability, and prices are checked again/
      )
    ).toBeTruthy();
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(ids.product));
    // The original size and dates are re-checked against live availability before anything is reserved.
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalledWith({
        variant_id: ids.variant,
        pickup_at: "2027-03-12T02:00:00.000Z",
        due_at: "2027-03-15T02:00:00.000Z",
      })
    );
    expect(api.createStaffReservation).not.toHaveBeenCalled();
  });

  it("hides the flexible-fit card when that item is copied into a rebooking", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: freeSizeDetail,
      requestId: "req-free-size-rebook",
    });

    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-FLEXIBLE",
        lines: [
          {
            sourceLineId: "source-line-flexible",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Emerald Gown",
          },
        ],
        pickupAt: "2027-03-12T02:00:00.000Z",
        dueAt: "2027-03-15T02:00:00.000Z",
        eventDate: null,
        fulfillmentMethod: "pickup",
        paymentMethodId: ids.paymentMethod as never,
        customer: {
          customerId: ids.customer as never,
          fullName: "Bea Santiago",
          phone: null,
          email: null,
          address: null,
        },
      },
    });

    expect(
      await screen.findByRole("button", { name: "Variant already in replacement" })
    ).toBeDisabled();
    const copiedItems = screen.getByText("Items in the new reservation").closest("section");
    expect(copiedItems).not.toBeNull();
    expect(within(copiedItems!).getByText("Emerald Gown")).toBeVisible();
    expect(screen.queryByText("This clothing item has one rentable size.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select flexible fit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Emerald Gown" })).toHaveClass(
      "border-dashboard-accent/60",
      "bg-dashboard-active/40",
      "ring-1",
      "ring-dashboard-accent/30"
    );
    expect(screen.queryByText("Already selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Already selected" })).not.toBeInTheDocument();
  });

  it("keeps the add-to-rebooking action for a newly chosen flexible-fit item without the card", async () => {
    const rosalieProductId = "00000000-0000-4000-8000-000000000121";
    const rosalieVariantId = "00000000-0000-4000-8000-000000000122";
    const rosalieProduct = clothingListItem.parse({
      ...product,
      product_id: rosalieProductId,
      code: "ROSALIE-FS",
      name: "Rosalie",
      sizing_mode: "free_size",
      has_free_size: true,
      size_labels: [],
    });
    const rosalieDetail = clothingDetail.parse({
      ...freeSizeDetail,
      product_id: rosalieProductId,
      code: "ROSALIE-FS",
      name: "Rosalie",
      variants: freeSizeDetail.variants.map((variant) => ({
        ...variant,
        id: rosalieVariantId,
        sku: "ROSALIE-FS",
        assets: variant.assets.map((asset) => ({ ...asset, variant_id: rosalieVariantId })),
      })),
    });
    api.getCatalogueClothing.mockResolvedValue(listPage([product, rosalieProduct]));
    api.getCatalogueClothingDetail.mockImplementation((productId: string) =>
      Promise.resolve({
        data: productId === rosalieProductId ? rosalieDetail : multiSizeDetail,
        requestId: `req-detail-${productId}`,
      })
    );

    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-ADDING-FLEXIBLE",
        lines: [
          {
            sourceLineId: "source-line-sized",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Emerald Gown",
          },
        ],
        pickupAt: "2027-03-12T02:00:00.000Z",
        dueAt: "2027-03-15T02:00:00.000Z",
        eventDate: null,
        fulfillmentMethod: "pickup",
        paymentMethodId: ids.paymentMethod as never,
        customer: null,
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Choose Rosalie" }));

    const addFlexibleFit = await screen.findByRole("button", {
      name: "Add selected item to replacement",
    });
    expect(screen.queryByText("This clothing item has one rentable size.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select flexible fit" })).not.toBeInTheDocument();
    expect(addFlexibleFit).toBeEnabled();
    fireEvent.click(addFlexibleFit);
    const replacementItems = screen.getByText("Items in the new reservation").closest("section");
    expect(replacementItems).not.toBeNull();
    expect(within(replacementItems!).getByText("Rosalie")).toBeVisible();
  });

  it("uses the source reservation as a fallback only for blank fields on the current profile", async () => {
    api.getStaffReservationAvailabilityCheck.mockImplementation(
      ({
        variant_id,
        pickup_at,
        due_at,
      }: {
        variant_id: string;
        pickup_at: string;
        due_at: string;
      }) =>
        Promise.resolve({
          data: {
            ...exactResponse,
            variant_id,
            requested_interval: { start: pickup_at, end: due_at },
          },
          requestId: "req-rebook-profile-fallback-availability",
        })
    );
    api.getStaffReservationIntakeOptions.mockImplementation((input: { customer_search?: string }) =>
      Promise.resolve({
        data: {
          payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
          customers: input.customer_search
            ? [
                {
                  id: ids.customer,
                  full_name: "Bea Santiago",
                  phone: null,
                  email: null,
                  has_address: false,
                },
              ]
            : [],
        },
        requestId: "req-rebook-profile-fallback-customer",
      })
    );
    api.getCustomerDetail.mockResolvedValueOnce({
      data: customerProfile({
        full_name: "Bea Santiago",
        phone: null,
        email: null,
        address: null,
        social_media: "@bea-current",
        notes: "Current profile note",
      }),
      requestId: "req-rebook-profile-fallback-detail",
    });

    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-FALLBACK",
        lines: [
          {
            sourceLineId: "source-line-fallback",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Amara",
          },
        ],
        pickupAt: "2027-03-12T02:00:00.000Z",
        dueAt: "2027-03-15T02:00:00.000Z",
        eventDate: "2027-03-13",
        fulfillmentMethod: "delivery",
        paymentMethodId: ids.paymentMethod as never,
        customer: {
          customerId: ids.customer as never,
          fullName: "Bea Santiago",
          phone: "09179998888",
          email: "beasaved@example.test",
          address: "Old reservation address",
        },
      },
    });

    const reserve = await screen.findByRole("button", { name: "Reserve" });
    await waitFor(() => expect(reserve).toBeEnabled());
    fireEvent.click(reserve);
    await screen.findByText("RSV-WALKIN-001");
    await waitFor(() => expect(screen.getByLabelText("Phone")).toHaveValue("09179998888"));
    expect(screen.getByLabelText("Email")).toHaveValue("beasaved@example.test");
    expect(screen.getByLabelText("Address")).toHaveValue("Old reservation address");
    expect(screen.getByLabelText("Social media (optional)")).toHaveValue("@bea-current");
    expect(screen.getByLabelText("Customer notes (optional)")).toHaveValue("Current profile note");
  });

  it("submits every selected source line as one replacement reservation", async () => {
    const secondVariant = "00000000-0000-4000-8000-000000000112";
    api.getStaffReservationAvailabilityCheck.mockImplementation(
      ({ variant_id }: { variant_id: string }) =>
        Promise.resolve({
          data: {
            ...exactResponse,
            variant_id,
            requested_interval: {
              start: "2027-03-12T02:00:00.000Z",
              end: "2027-03-15T02:00:00.000Z",
            },
          },
          requestId: `req-exact-${variant_id}`,
        })
    );
    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-MULTI",
        lines: [
          {
            sourceLineId: "source-line-1",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Amara",
          },
          {
            sourceLineId: "source-line-2",
            productId: ids.product as never,
            variantId: secondVariant as never,
            name: "Camille",
          },
        ],
        pickupAt: "2027-03-12T02:00:00.000Z",
        dueAt: "2027-03-15T02:00:00.000Z",
        eventDate: "2027-03-13",
        fulfillmentMethod: "delivery",
        paymentMethodId: ids.paymentMethod as never,
        customer: null,
      },
    });

    expect(screen.queryByRole("button", { name: /add another dress/i })).toBeNull();

    await waitFor(() => expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "Reserve" }));

    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          variant_id: ids.variant,
          lines: [{ variant_id: ids.variant }, { variant_id: secondVariant }],
          fulfillment_method: "delivery",
          event_date: "2027-03-13",
        }),
        expect.any(String)
      )
    );
  });

  it("drops copied dates that have already passed and asks for new ones", async () => {
    renderSheet({
      rebookFrom: {
        referenceCode: "RSV-OLD-002",
        lines: [
          {
            sourceLineId: "source-line-2",
            productId: ids.product as never,
            variantId: ids.variant as never,
            name: "Amara",
          },
        ],
        pickupAt: "2025-01-10T02:00:00.000Z",
        dueAt: "2025-01-13T02:00:00.000Z",
        eventDate: null,
        fulfillmentMethod: "pickup",
        paymentMethodId: null,
        customer: null,
      },
    });

    expect(
      await screen.findByText(
        "Copied from RSV-OLD-002. Its dates have passed, so choose new dates."
      )
    ).toBeTruthy();
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(ids.product));
    expect(api.getStaffReservationAvailabilityCheck).not.toHaveBeenCalled();
  });

  it("shows only five recent clothing items by default and tells staff to search for more", async () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      clothingListItem.parse({
        ...product,
        product_id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
        code: `LOOK-${index + 1}`,
        name: `Recent Look ${index + 1}`,
      })
    );
    api.getCatalogueClothing.mockResolvedValue(listPage(items));

    renderSheet();

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenCalledWith({
        limit: 5,
        sort: "newest",
        product_status: "active",
      })
    );
    expect(await screen.findByRole("button", { name: /Recent Look 1/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Recent Look 5/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Recent Look 6/i })).not.toBeInTheDocument();
    expect(
      screen.getByText("Showing up to 5 recent clothing items. Search to find more clothing.")
    ).toBeVisible();
  });

  it("requires clothing and an explicit variant before showing the rental calendar", async () => {
    renderSheet();

    expect(screen.queryByText("Rental period")).not.toBeInTheDocument();
    expect(api.getStaffReservationAvailabilityCalendar).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    const variant = await screen.findByRole("button", { name: /M · Emerald/i });
    expect(screen.queryByText("Rental period")).not.toBeInTheDocument();

    fireEvent.click(variant);
    expect(await screen.findByText("Rental period")).toBeVisible();
    expect(screen.getByRole("button", { name: "Select Oct 10 to Oct 13" })).toBeVisible();
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCalendar).toHaveBeenCalledWith({
        variant_id: ids.variant,
        start_date: "2026-10-01",
        end_date: "2026-10-31",
      })
    );
  });

  it("keeps Reserve blocked when any selected-variant calendar request fails", async () => {
    api.getStaffReservationAvailabilityCalendar.mockRejectedValue(
      new Error("Calendar unavailable")
    );
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Choose Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select Oct 10 to Oct 13" }));
    setPickerTime("Pickup time", "10", "00", "AM");
    setPickerTime("Return time", "10", "00", "AM");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not complete this reservation action. Please try again."
    );
    await waitFor(() => expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Reserve" })).toBeDisabled();
    expect(api.createStaffReservation).not.toHaveBeenCalled();
  });

  it("uses segmented time inputs and business-hours quick times without a Set time step", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select Oct 10 to Oct 13" }));

    const pickupHour = screen.getByRole("textbox", { name: "Pickup time hour" });
    const pickupMinute = screen.getByRole("textbox", { name: "Pickup time minute" });
    const pickupPeriod = screen.getByRole("combobox", { name: "Pickup time period" });
    const returnHour = screen.getByRole("textbox", { name: "Return time hour" });
    const returnMinute = screen.getByRole("textbox", { name: "Return time minute" });
    expect(pickupHour).toHaveAttribute("placeholder", "hh");
    expect(pickupMinute).toHaveAttribute("placeholder", "mm");
    expect(screen.queryByRole("button", { name: "Set time" })).not.toBeInTheDocument();

    fireEvent.change(pickupHour, { target: { value: "3" } });
    fireEvent.change(pickupMinute, { target: { value: "15" } });
    fireEvent.change(pickupPeriod, { target: { value: "PM" } });
    expect(pickupHour).toHaveValue("03");
    expect(pickupMinute).toHaveValue("15");

    fireEvent.click(screen.getByRole("button", { name: "Choose return time" }));
    expect(await screen.findByRole("button", { name: "08:00 AM" })).toBeVisible();
    expect(screen.getByRole("button", { name: "08:30 AM" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "08:00 PM" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "03:30 PM" }));
    expect(returnHour).toHaveValue("03");
    expect(returnMinute).toHaveValue("30");
  });

  it("renders flexible-fit and sized selections as peer cards and removes only the chosen item", async () => {
    const ros = "00000000-0000-4000-8000-000000000201";
    const rosVariant = "00000000-0000-4000-8000-000000000202";
    const rosDetail = clothingDetail.parse({
      ...freeSizeDetail,
      product_id: ros,
      name: "Rosalie",
      code: "ROSALIE-FS",
      variants: freeSizeDetail.variants.map((variant) => ({
        ...variant,
        id: rosVariant,
        sku: "ROSALIE-FS",
        assets: variant.assets.map((asset) => ({ ...asset, variant_id: rosVariant })),
      })),
    });
    const primary: AdditionalGarment = {
      key: "emerald-primary",
      productId: ids.product as never,
      name: "Emerald Gown",
      imageUrl: null,
      detail: multiSizeDetail,
      variantId: ids.variant as never,
      availableAssets: 1,
      availabilityCheck: null,
      checkedFor: null,
      error: null,
    };
    const flexible: AdditionalGarment = {
      key: "rosalie-flexible",
      productId: ros as never,
      name: "Rosalie",
      imageUrl: null,
      detail: rosDetail,
      variantId: rosVariant as never,
      availableAssets: 1,
      availabilityCheck: null,
      checkedFor: null,
      error: null,
    };
    function CardsHarness() {
      const [primaryGarment, setPrimaryGarment] = useState<AdditionalGarment | null>(primary);
      const [extraGarments, setExtraGarments] = useState([flexible]);
      return (
        <>
          {primaryGarment ? (
            <SelectedGarmentCard
              garment={primaryGarment}
              disabled={false}
              onRemove={() => setPrimaryGarment(null)}
              status={<p className="mt-2 text-xs text-dashboard-green-text">Available</p>}
            />
          ) : null}
          <AdditionalGarments
            disabled={false}
            garments={extraGarments}
            onChange={(update) => setExtraGarments(update)}
            onRemoveGarment={(key) =>
              setExtraGarments((current) => current.filter((garment) => garment.key !== key))
            }
            primaryVariantId={primaryGarment?.variantId ?? ""}
            requestedInterval={null}
            calendarAvailabilityByVariant={{}}
            timeZone="Asia/Manila"
          />
        </>
      );
    }
    render(<CardsHarness />);

    const primaryRemove = screen.getByRole("button", {
      name: /Remove Emerald Gown · M · Emerald from this booking/,
    });
    const rosRemove = screen.getByRole("button", {
      name: /Remove Rosalie · Flexible fit · Emerald from this booking/,
    });
    expect(primaryRemove.closest("div.rounded-lg")?.className).toBe(
      rosRemove.closest("div.rounded-lg")?.className
    );
    expect(screen.getAllByText(/Rental ₱1,500/)).toHaveLength(2);
    expect(screen.getByText("One flexible-fit garment")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Add another size of Rosalie/i })
    ).not.toBeInTheDocument();

    fireEvent.click(rosRemove);
    expect(screen.queryByRole("button", { name: /Remove Rosalie/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove Emerald Gown/i })).toBeVisible();
    expect(screen.queryByText("One flexible-fit garment")).not.toBeInTheDocument();
  });

  it("shows a recovery explanation on an additional garment card when calendar data isolates it", async () => {
    const exactUnavailable = staffReservationAvailabilityCheckResponse.parse({
      ...exactResponse,
      available: false,
      available_assets: 0,
    });
    const calendarWithRecoveryConflict = staffReservationAvailabilityCalendarResponse.parse({
      ...calendarResponse,
      window: { start_date: "2026-10-01", end_date: "2026-10-31" },
      days: ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((date) => ({
        ...calendarResponse.days[0]!,
        date,
        state: date === "2026-10-14" ? "unavailable" : "available",
        ready_assets: date === "2026-10-14" ? 0 : 1,
        available_assets: date === "2026-10-14" ? 0 : 1,
      })),
    });
    api.getStaffReservationAvailabilityCheck.mockResolvedValue({
      data: exactUnavailable,
      requestId: "req-exact-unavailable",
    });

    const garment: AdditionalGarment = {
      key: "recovery-garment",
      productId: ids.product as never,
      name: "Emerald Gown",
      imageUrl: null,
      detail,
      variantId: ids.variant as never,
      availableAssets: null,
      availabilityCheck: null,
      checkedFor: null,
      error: null,
    };
    function GarmentHarness() {
      const [items, setItems] = useState([garment]);
      return (
        <AdditionalGarments
          disabled={false}
          garments={items}
          onChange={(update) => setItems(update)}
          onRemoveGarment={(key) =>
            setItems((current) => current.filter((item) => item.key !== key))
          }
          primaryVariantId=""
          requestedInterval={exactUnavailable.requested_interval}
          calendarAvailabilityByVariant={{ [ids.variant]: calendarWithRecoveryConflict }}
          timeZone="Asia/Manila"
        />
      );
    }

    render(<GarmentHarness />);
    expect(
      await screen.findByText(
        "Emerald Gown · M · Emerald is unavailable: its 1-day recovery after return extends into Oct 14, when no pieces are free."
      )
    ).toBeVisible();
  });

  it("keeps a three-day fixed rental from progressing when the return date is only Day 2", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select short range" }));
    setPickerTime("Pickup time", "10", "00", "AM");
    setPickerTime("Return time", "10", "00", "AM");

    expect(
      await screen.findByText(
        /This is a 3-day rental\. The pickup date counts as Day 1, so for a pickup on Oct 10, 2026 the earliest return date is Oct 12, 2026\./
      )
    ).toBeVisible();
    expect(screen.getAllByText(/stays unavailable for 1 day of recovery/i).length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText(/preparation/i)).not.toBeInTheDocument();
    expect(api.getStaffReservationAvailabilityCheck).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reserve" })).toBeDisabled();
  });

  it("accepts the owner's example: pickup on Day 1, return on Day 3 is a 3-day rental", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select pickup-day-one range" }));
    // A late-afternoon pickup and a morning return still count Oct 10 to Oct 12 as three days.
    setPickerTime("Pickup time", "4", "00", "PM");
    setPickerTime("Return time", "9", "00", "AM");

    await waitFor(() => expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalled());
    expect(screen.queryByText(/This is a 3-day rental\./)).not.toBeInTheDocument();
  });

  it("holds a Pickup booking without times from opening on the pickup date to closing on the return date", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Select Oct 10 to Oct 13" }));

    expect(screen.getByText(/Pickup time \(optional\)/)).toBeVisible();
    expect(await screen.findByText(/Pickup and return times are not set\. Availability still blocks the garment from 8:00\sAM on .+ until 8:00\sPM on/i)).toBeVisible();
    // Branch hours 08:00–20:00 in Asia/Manila (UTC+8).
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalledWith(
        expect.objectContaining({ pickup_at: "2026-10-10T00:00:00.000Z", due_at: "2026-10-13T12:00:00.000Z" })
      )
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Fulfillment" }), { target: { value: "delivery" } });
    expect(screen.queryByText(/No exact time needed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pickup time \(optional\)/)).not.toBeInTheDocument();
  });

  it("bounds event date to the selected rental dates and clears it when the range changes", async () => {
    renderSheet();
    await fillDatesAndSelectProduct();

    expect(screen.getByRole("button", { name: "Event date (optional)" })).toHaveTextContent(
      "Oct 11, 2026"
    );

    fireEvent.click(screen.getByRole("button", { name: "Select later range" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Event date (optional)" })).toHaveTextContent(
        "Select event date"
      )
    );
  });

  it("runs the staff fast path from advisory availability through cash collection and confirmation", async () => {
    const { props } = renderSheet();
    await fillDatesAndSelectProduct();

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        {
          variant_id: ids.variant,
          requested_interval: {
            start: "2026-10-10T02:00:00.000Z",
            end: "2026-10-13T02:00:00.000Z",
          },
          event_date: "2026-10-11",
          fulfillment_method: "pickup",
          pickup_time_unspecified: false,
          return_time_unspecified: false,
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
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Test Street" } });
    const confirm = screen.getByRole("button", { name: "Confirm Reservation" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid-email" } });
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "walkin@example.test" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Reservation" }));

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: {
            source: "new",
            customer: {
              full_name: "Walk-in Customer",
              phone: "09171234567",
              email: "walkin@example.test",
              address: "123 Test Street",
            },
          },
          cash_collection: { amount_tendered_minor: "200000" },
        },
        expect.any(String)
      )
    );
    expect(
      await screen.findByText("Reservation confirmed. Cash payment of ₱2,000 was recorded.")
    ).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Cash received" })).not.toBeInTheDocument();
    expect(props.onReservationChanged).toHaveBeenCalledWith(ids.reservation);
  });

  it("marks only the blank Pickup milestone as time-unspecified", async () => {
    api.getStaffReservationAvailabilityCheck.mockImplementation(
      ({
        variant_id,
        pickup_at,
        due_at,
      }: {
        variant_id: string;
        pickup_at: string;
        due_at: string;
      }) =>
        Promise.resolve({
          data: {
            ...exactResponse,
            variant_id,
            requested_interval: { start: pickup_at, end: due_at },
          },
          requestId: "req-partial-time-availability",
        })
    );
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Emerald Gown/i }));
    fireEvent.click(await screen.findByRole("button", { name: /M · Emerald/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select Oct 10 to Oct 13" }));
    setPickerTime("Pickup time", "10", "00", "AM");
    await waitFor(() => expect(api.getStaffReservationAvailabilityCheck).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Reserve" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          fulfillment_method: "pickup",
          pickup_time_unspecified: false,
          return_time_unspecified: true,
        }),
        expect.any(String)
      )
    );
  });

  it("requires the full cash tendered before recording an unpaid past cash booking as Completed", async () => {
    api.createStaffReservation.mockResolvedValueOnce({
      data: staffReservationCreateResponse.parse({
        ...heldResponse,
        reservation: {
          ...heldResponse.reservation,
          due_at: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
      requestId: "req-past-due-hold",
    });
    api.completeStaffReservation.mockResolvedValueOnce({
      data: completedResponse,
      requestId: "req-past-due-complete",
    });
    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    expect(
      await screen.findByText(
        "This reservation is in the past. Submitting will record it as a Completed reservation."
      )
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Record as Completed" })).toBeDisabled();
    expect(
      screen.queryByRole("checkbox", {
        name: /past|completed/i,
      })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Past Customer" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "past@example.test" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Past Street" } });
    // No separate tick boxes: confirming records the terms and the cash tendered.
    expect(screen.queryByRole("checkbox", { name: /accepted|Cash received/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Enter the cash tendered before recording this past booking/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Cash tendered"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Record as Completed" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Cash tendered"), { target: { value: "1000" } });
    expect(screen.getByRole("button", { name: "Record as Completed" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Cash tendered"), { target: { value: "2000" } });
    expect(screen.getByRole("button", { name: "Record as Completed" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Record as Completed" }));

    expect(
      await screen.findByText("Reservation recorded as completed. Payment remains to be verified.")
    ).toBeVisible();
    expect(api.completeStaffReservation).toHaveBeenCalledWith(
      ids.reservation,
      expect.objectContaining({
        version: 1,
        terms_accepted: true,
        cash_collection: { amount_tendered_minor: "200000" },
      }),
      expect.any(String)
    );
  });

  it("keeps new-customer phone input numeric and capped at exactly 11 digits", async () => {
    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    const phoneInput = screen.getByLabelText("Phone");
    expect(phoneInput).toHaveAttribute("maxlength", "11");
    expect(phoneInput).toHaveAttribute("inputmode", "numeric");

    fireEvent.change(phoneInput, { target: { value: "09ab321-234567890" } });
    expect(phoneInput).toHaveValue("09321234567");
  });

  it("lets staff choose any active tenant payment method returned by intake options", async () => {
    api.getStaffReservationIntakeOptions.mockResolvedValue({
      data: {
        payment_methods: [
          { id: ids.paymentMethod, name: "Cash", rail: "cash" },
          { id: ids.gcashPaymentMethod, name: "GCash", rail: "manual_qr" },
        ],
        customers: [],
      },
      requestId: "req-intake",
    });
    renderSheet();
    await fillDatesAndSelectProduct();

    fireEvent.click(screen.getByRole("button", { name: /GCash/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() =>
      expect(api.createStaffReservation).toHaveBeenCalledWith(
        expect.objectContaining({ payment_method_id: ids.gcashPaymentMethod }),
        expect.any(String)
      )
    );
  });

  it("lets staff replace or remove an optional receipt locally, then submit without one", async () => {
    api.getStaffReservationIntakeOptions.mockResolvedValue({
      data: {
        payment_methods: [
          { id: ids.paymentMethod, name: "Cash", rail: "cash" },
          { id: ids.gcashPaymentMethod, name: "GCash", rail: "manual_qr" },
        ],
        customers: [],
      },
      requestId: "req-intake",
    });
    api.createStaffReservation.mockResolvedValueOnce({
      data: gcashHeldResponse,
      requestId: "req-hold-gcash",
    });
    api.completeStaffReservation.mockResolvedValueOnce({
      data: gcashPendingResponse,
      requestId: "req-complete-gcash",
    });

    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: /GCash/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    expect(
      screen.getByText(/Receipts are optional/i)
    ).toBeVisible();
    const receiptInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(receiptInput).not.toBeNull();
    fireEvent.change(receiptInput!, {
      target: { files: [new File(["first receipt"], "first.png", { type: "image/png" })] },
    });
    expect(screen.getByText("Replace receipt")).toBeVisible();
    expect(screen.getByRole("img", { name: "first.png" })).toHaveAttribute(
      "src",
      "blob:receipt-1"
    );
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: {
        files: [new File(["replacement receipt"], "replacement.png", { type: "image/png" })],
      },
    });
    expect(screen.queryByRole("img", { name: "first.png" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "replacement.png" })).toHaveAttribute(
      "src",
      "blob:receipt-2"
    );
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receipt-1"));
    fireEvent.click(screen.getByRole("button", { name: "Remove receipt" }));
    expect(screen.queryByText("replacement.png")).not.toBeInTheDocument();
    expect(screen.getByText("Choose receipt")).toBeVisible();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receipt-2"));

    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(["pdf receipt"], "receipt.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByText("receipt.pdf")).toBeVisible();
    expect(screen.queryByRole("img", { name: "receipt.pdf" })).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove receipt" }));
    expect(screen.getByText("Choose receipt")).toBeVisible();
    expect(api.authorizeUpload).not.toHaveBeenCalled();
    expect(fileUpload.uploadAuthorizedFile).not.toHaveBeenCalled();
    expect(api.finalizeUpload).not.toHaveBeenCalled();
    expect(api.attachReservationPaymentReceipt).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Walk-in GCash Customer" },
    });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "walkin-gcash@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Test Street" } });

    const submit = screen.getByRole("button", { name: "Submit for Verification" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: {
            source: "new",
            customer: {
              full_name: "Walk-in GCash Customer",
              phone: "09171234567",
              email: "walkin-gcash@example.test",
              address: "123 Test Street",
            },
          },
        },
        expect.any(String)
      )
    );
    expect(api.authorizeUpload).not.toHaveBeenCalled();
    expect(api.attachReservationPaymentReceipt).not.toHaveBeenCalled();
    expect(fileUpload.uploadAuthorizedFile).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Reservation saved. Payment verification required.")
    ).toBeVisible();
  });

  it("uploads a staged receipt on submit, keeps it after failures, and avoids duplicate uploads", async () => {
    const fileId = "00000000-0000-4000-8000-000000000120";
    api.getStaffReservationIntakeOptions.mockResolvedValue({
      data: {
        payment_methods: [
          { id: ids.paymentMethod, name: "Cash", rail: "cash" },
          { id: ids.gcashPaymentMethod, name: "GCash", rail: "manual_qr" },
        ],
        customers: [],
      },
      requestId: "req-intake",
    });
    api.createStaffReservation.mockResolvedValueOnce({
      data: gcashHeldResponse,
      requestId: "req-hold-gcash",
    });
    api.completeStaffReservation.mockRejectedValueOnce(new Error("Temporary completion failure"));
    api.completeStaffReservation.mockResolvedValue({
      data: gcashPendingResponse,
      requestId: "req-complete-gcash",
    });
    api.authorizeUpload.mockResolvedValue({
      data: {
        file_id: fileId,
        upload_url: "https://uploads.example.test/receipt",
        upload_method: "PUT",
        required_headers: {},
        expires_at: "2026-10-01T00:10:00.000Z",
      },
      requestId: "req-authorize-receipt",
    });
    api.finalizeUpload.mockResolvedValue({
      data: { file: { file_id: fileId } },
      requestId: "req-finalize-receipt",
    });
    api.attachReservationPaymentReceipt.mockResolvedValue({
      data: {},
      requestId: "req-attach-receipt",
    });
    fileUpload.uploadAuthorizedFile.mockRejectedValueOnce(new Error("Upload interrupted"));

    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: /GCash/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Walk-in GCash Customer" },
    });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "walkin-gcash@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Test Street" } });

    const receiptInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(receiptInput).not.toBeNull();
    fireEvent.change(receiptInput!, {
      target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] },
    });
    expect(screen.getByText("receipt.png")).toBeVisible();
    expect(api.authorizeUpload).not.toHaveBeenCalled();
    expect(fileUpload.uploadAuthorizedFile).not.toHaveBeenCalled();

    const submit = screen.getByRole("button", { name: "Submit for Verification" });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(fileUpload.uploadAuthorizedFile).toHaveBeenCalledTimes(1)
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not complete this reservation action");
    expect(api.completeStaffReservation).not.toHaveBeenCalled();
    expect(screen.getByText("receipt.png")).toBeVisible();

    fireEvent.click(submit);
    await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Receipt attached: receipt\.png/)).toBeVisible();
    expect(api.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(api.attachReservationPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(api.completeStaffReservation).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receipt-1");
    expect(api.authorizeUpload.mock.invocationCallOrder[1]).toBeLessThan(
      fileUpload.uploadAuthorizedFile.mock.invocationCallOrder[1] ?? Infinity
    );
    expect(fileUpload.uploadAuthorizedFile.mock.invocationCallOrder[1]).toBeLessThan(
      api.finalizeUpload.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(api.finalizeUpload.mock.invocationCallOrder[0]).toBeLessThan(
      api.attachReservationPaymentReceipt.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(api.attachReservationPaymentReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      api.completeStaffReservation.mock.invocationCallOrder[0] ?? Infinity
    );

    fireEvent.click(submit);
    await waitFor(() => expect(api.completeStaffReservation).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Reservation saved. Payment verification required.")).toBeVisible();
    expect(api.authorizeUpload).toHaveBeenCalledTimes(2);
    expect(fileUpload.uploadAuthorizedFile).toHaveBeenCalledTimes(2);
    expect(api.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(api.attachReservationPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(api.completeStaffReservation).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Receipt attached: receipt\.png/)).toBeVisible();
  });

  it("stops before creating a reservation when no single physical piece is free for the exact times", async () => {
    api.getStaffReservationAvailabilityCheck.mockResolvedValue({
      data: staffReservationAvailabilityCheckResponse.parse({
        ...exactResponse,
        available: false,
        available_assets: 0,
      }),
      requestId: "req-exact-unavailable",
    });
    renderSheet();
    await fillDatesAndSelectProduct();

    expect(
      await screen.findByText(
        /Emerald Gown · M · Emerald is not available for the exact pickup and return times/i
      )
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reserve" })).toBeDisabled();
    expect(api.createStaffReservation).not.toHaveBeenCalled();
  });

  it("prefills and saves all editable existing-customer fields only after the garment hold exists", async () => {
    api.getCustomerDetail.mockResolvedValueOnce({
      data: customerProfile({ social_media: "@maria", notes: "Call before arrival" }),
      requestId: "req-customer-detail-editable",
    });
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
                  has_address: true,
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
    await screen.findByRole("button", { name: /Maria Existing/i });

    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "Another" },
    });
    expect(screen.queryByRole("button", { name: /Maria Existing/i })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting to search customers…")).toBeVisible();
    await waitFor(() =>
      expect(api.getStaffReservationIntakeOptions).toHaveBeenLastCalledWith({
        customer_search: "Another",
      })
    );
    await screen.findByRole("button", { name: /Maria Existing/i });

    const requestCountBeforeShortQuery = api.getStaffReservationIntakeOptions.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "A" },
    });
    expect(screen.queryByRole("button", { name: /Maria Existing/i })).not.toBeInTheDocument();
    expect(
      screen.getByText("Type at least 2 characters to find an existing customer.")
    ).toBeVisible();
    expect(screen.queryByText("Waiting to search customers…")).not.toBeInTheDocument();
    expect(api.getStaffReservationIntakeOptions).toHaveBeenCalledTimes(
      requestCountBeforeShortQuery
    );

    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "Another" },
    });
    await waitFor(() =>
      expect(api.getStaffReservationIntakeOptions).toHaveBeenLastCalledWith({
        customer_search: "Another",
      })
    );
    const refreshedCustomer = await screen.findByRole("button", { name: /Maria Existing/i });
    fireEvent.click(refreshedCustomer);
    expect(refreshedCustomer).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Selected customer")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Address")).toHaveValue("1 Existing Street"));
    expect(screen.getByLabelText("Full name")).toHaveValue("Maria Existing");
    expect(screen.getByLabelText("Phone")).toHaveValue("09170000000");
    expect(screen.getByLabelText("Email")).toHaveValue("maria@example.test");
    expect(screen.getByLabelText("Social media (optional)")).toHaveValue("@maria");
    expect(screen.getByLabelText("Customer notes (optional)")).toHaveValue("Call before arrival");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Maria Updated" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09171112222" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "updated@example.test" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "2 Updated Street" } });
    fireEvent.change(screen.getByLabelText("Social media (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Customer notes (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Reservation" }));

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: {
            source: "existing",
            customer_id: ids.customer,
            profile: {
              full_name: "Maria Updated",
              phone: "09171112222",
              email: "updated@example.test",
              address: "2 Updated Street",
              social_media: null,
              notes: null,
              expected_updated_at: "2026-09-01T00:00:00.000Z",
            },
          },
          cash_collection: { amount_tendered_minor: "200000" },
        },
        expect.any(String)
      )
    );
  });

  it("requires an inline address before an addressless existing customer can complete a reservation", async () => {
    api.getCustomerDetail.mockResolvedValueOnce({
      data: customerProfile({
        full_name: "Addressless Existing",
        phone: "09170000000",
        email: "addressless@example.test",
        address: null,
      }),
      requestId: "req-customer-detail-addressless",
    });
    api.getStaffReservationIntakeOptions.mockImplementation((input: { customer_search?: string }) =>
      Promise.resolve({
        data: {
          payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
          customers: input.customer_search
            ? [
                {
                  id: ids.customer,
                  full_name: "Addressless Existing",
                  phone: "09170000000",
                  email: "addressless@example.test",
                  has_address: false,
                },
              ]
            : [],
        },
        requestId: "req-intake-addressless",
      })
    );
    renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    fireEvent.click(screen.getByRole("button", { name: "Existing customer" }));
    fireEvent.change(screen.getByLabelText("Search existing customer"), {
      target: { value: "Addressless" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Addressless Existing/i }));
    const complete = screen.getByRole("button", { name: "Confirm Reservation" });
    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveValue("addressless@example.test")
    );
    expect(screen.getByLabelText("Address")).toBeVisible();
    expect(complete).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "123 Test Street" },
    });
    expect(complete).toBeEnabled();
    fireEvent.click(complete);

    await waitFor(() =>
      expect(api.completeStaffReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          terms_accepted: true,
          customer: {
            source: "existing",
            customer_id: ids.customer,
            profile: {
              full_name: "Addressless Existing",
              phone: "09170000000",
              email: "addressless@example.test",
              address: "123 Test Street",
              social_media: null,
              notes: null,
              expected_updated_at: "2026-09-01T00:00:00.000Z",
            },
          },
          cash_collection: { amount_tendered_minor: "200000" },
        },
        expect.any(String)
      )
    );
  });

  it.each([
    {
      missing: "Email",
      fill: "rebooked@example.test",
      savedPhone: "09170000000",
      savedEmail: null,
      expectedCustomer: {
        source: "existing",
        customer_id: ids.customer,
        profile: {
          full_name: "Contact Missing Customer",
          phone: "09170000000",
          email: "rebooked@example.test",
          address: "123 Test Street",
          social_media: null,
          notes: null,
          expected_updated_at: "2026-09-01T00:00:00.000Z",
        },
      },
    },
    {
      missing: "Phone",
      fill: "09173334444",
      savedPhone: null,
      savedEmail: "phone-missing@example.test",
      expectedCustomer: {
        source: "existing",
        customer_id: ids.customer,
        profile: {
          full_name: "Contact Missing Customer",
          phone: "09173334444",
          email: "phone-missing@example.test",
          address: "123 Test Street",
          social_media: null,
          notes: null,
          expected_updated_at: "2026-09-01T00:00:00.000Z",
        },
      },
    },
  ])(
    "shows the missing $missing field when continuing with a saved customer",
    async ({ missing, fill, savedPhone, savedEmail, expectedCustomer }) => {
      api.getCustomerDetail.mockResolvedValueOnce({
        data: customerProfile({
          full_name: "Contact Missing Customer",
          phone: savedPhone,
          email: savedEmail,
          address: null,
        }),
        requestId: `req-customer-detail-missing-${missing.toLowerCase()}`,
      });
      api.getStaffReservationIntakeOptions.mockImplementation(
        (input: { customer_search?: string }) =>
          Promise.resolve({
            data: {
              payment_methods: [{ id: ids.paymentMethod, name: "Cash", rail: "cash" }],
              customers: input.customer_search
                ? [
                    {
                      id: ids.customer,
                      full_name: "Contact Missing Customer",
                      phone: savedPhone,
                      email: savedEmail,
                      has_address: false,
                    },
                  ]
                : [],
            },
            requestId: "req-intake-missing-contact",
          })
      );

      renderSheet();
      await fillDatesAndSelectProduct();
      fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
      await screen.findByText("RSV-WALKIN-001");
      fireEvent.click(screen.getByRole("button", { name: "Existing customer" }));
      fireEvent.change(screen.getByLabelText("Search existing customer"), {
        target: { value: "Contact" },
      });
      fireEvent.click(await screen.findByRole("button", { name: /Contact Missing Customer/i }));

      expect(await screen.findByLabelText(missing)).toBeVisible();
      expect(screen.getByLabelText("Address")).toBeVisible();
      const confirm = screen.getByRole("button", { name: "Confirm Reservation" });
      expect(confirm).toBeDisabled();
      fireEvent.change(screen.getByLabelText(missing), { target: { value: fill } });
      fireEvent.change(screen.getByLabelText("Address"), {
        target: { value: "123 Test Street" },
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      fireEvent.click(confirm);

      await waitFor(() =>
        expect(api.completeStaffReservation).toHaveBeenCalledWith(
          ids.reservation,
          {
            version: 1,
            terms_accepted: true,
            customer: expectedCustomer,
            cash_collection: { amount_tendered_minor: "200000" },
          },
          expect.any(String)
        )
      );
    }
  );

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
    const readsBeforeReserve = api.getStaffReservationAvailabilityCalendar.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The last garment was reserved by another staff member."
    );
    await waitFor(() =>
      expect(api.getStaffReservationAvailabilityCalendar.mock.calls.length).toBeGreaterThan(
        readsBeforeReserve
      )
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
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "walkin@example.test" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Test Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Reservation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/hold (has )?expired/i);
    expect(screen.getByRole("button", { name: "Start over" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Confirm Reservation" })).not.toBeInTheDocument();
  });

  it("explicitly cancels an active walk-in hold instead of waiting for expiry", async () => {
    const { props } = renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");

    fireEvent.click(screen.getByRole("button", { name: "Cancel Hold" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this hold?" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText(/customer details already entered above/i)).toBeVisible();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save customer and cancel hold" })
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save customer and cancel hold" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /name and at least one contact method/i
    );
    expect(api.cancelReservation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel hold without saving" }));

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

  it("saves the entered customer with hold cancellation", async () => {
    const { props } = renderSheet();
    await fillDatesAndSelectProduct();
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    await screen.findByText("RSV-WALKIN-001");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Saved Walk-in" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "saved-walkin@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel Hold" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this hold?" });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save customer and cancel hold" }));

    await waitFor(() =>
      expect(api.cancelReservation).toHaveBeenCalledWith(
        ids.reservation,
        {
          version: 1,
          reason: "Staff abandoned new reservation flow",
          customer: {
            source: "new",
            customer: { full_name: "Saved Walk-in", email: "saved-walkin@example.test" },
          },
        },
        expect.any(String)
      )
    );
    expect(await screen.findByText(/garment hold was released/i)).toBeVisible();
    expect(props.onReservationChanged).toHaveBeenCalledWith(ids.reservation);
  });
});

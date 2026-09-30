import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  reservationDetail,
  reservationListItem,
  type ReservationListItem,
} from "@drezivo/contracts";

import { ReservationsPage } from "@/components/reservations/reservations-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  cancelReservation: vi.fn(),
  completeRentalReservation: vi.fn(),
  completeStaffReservation: vi.fn(),
  getActorContext: vi.fn(),
  getReservationDetail: vi.fn(),
  getReservations: vi.fn(),
  inspectReservationReturn: vi.fn(),
  pickupReservation: vi.fn(),
  rejectReservation: vi.fn(),
  returnReservation: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/reservations",
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
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

const reservation = reservationListItem.parse({
  id: "00000000-0000-4000-8000-000000000101",
  reference_code: "RSV-REAL-001",
  status: "confirmed" as const,
  customer: {
    customer_id: "00000000-0000-4000-8000-000000000102",
    snapshot: {
      full_name: "Real Customer",
      phone: "09171234567",
      email: null,
    },
  },
  line: {
    id: "00000000-0000-4000-8000-000000000103",
    variant_id: "00000000-0000-4000-8000-000000000104",
    name_snapshot: "Real Emerald Gown",
    image_url: "https://reads.example.test/catalogue%2Femerald-gown.webp?version=list-cover-v1",
    rental_minor: "150000",
    deposit_minor: "50000",
    currency: "PHP",
  },
  fulfillment_method: "pickup" as const,
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
    method_name: "Cash",
    rail: "cash" as const,
    status: "paid" as const,
    evidence_status: "verified" as const,
    amount_minor: "200000",
    currency: "PHP",
    verified_at: "2026-10-10T03:00:00.000Z",
  },
  version: 3,
  created_at: "2026-10-10T02:00:00.000Z",
});

const anonymousHold = reservationListItem.parse({
  ...reservation,
  id: "00000000-0000-4000-8000-000000000111",
  reference_code: "RSV-HOLD-002",
  status: "held" as const,
  customer: { customer_id: null, snapshot: null },
  payment: {
    ...reservation.payment,
    id: "00000000-0000-4000-8000-000000000112",
    status: "pending" as const,
    evidence_status: "not_required" as const,
    verified_at: null,
  },
});

const reservationDetailRecord = reservationDetail.parse({
  id: reservation.id,
  reference_code: reservation.reference_code,
  status: "confirmed",
  branch_id: "00000000-0000-4000-8000-000000000203",
  storefront_id: "00000000-0000-4000-8000-000000000301",
  customer: {
    customer_id: reservation.customer.customer_id,
    snapshot: { ...reservation.customer.snapshot!, address: "123 Test Street" },
  },
  lines: [
    {
      id: reservation.line.id,
      variant_id: reservation.line.variant_id,
      variant: {
        sku: "EMERALD-M",
        size_label: "Medium",
        color_label: "Emerald",
        image_url: "https://reads.example.test/catalogue%2Femerald-gown.webp?version=cover-v1",
      },
      current_asset_readiness: "ready",
      line_number: 1,
      name_snapshot: reservation.line.name_snapshot,
      measurements_snapshot: { bust_cm: 91, waist_cm: 72 },
      pricing_snapshot: {
        rental_minor: reservation.line.rental_minor,
        deposit_minor: reservation.line.deposit_minor,
        currency: reservation.line.currency,
      },
    },
  ],
  pickup_at: reservation.pickup_at,
  due_at: reservation.due_at,
  timezone_snapshot: "Asia/Manila",
  event_date: "2026-10-13",
  delivery_snapshot: { fulfillment_method: "pickup" },
  price_snapshot: reservation.price_snapshot,
  payment: reservation.payment,
  hold_acquired_at: "2026-10-10T02:00:00.000Z",
  hold_expires_at: null,
  terms_accepted_at: "2026-10-10T02:02:00.000Z",
  submitted_at: "2026-10-10T02:03:00.000Z",
  confirmed_at: "2026-10-10T03:01:00.000Z",
  completed_at: null,
  custody_timeline: [],
  version: reservation.version,
  created_at: reservation.created_at,
});

const returnedReservation = reservationListItem.parse({
  ...reservation,
  status: "returned",
  version: 5,
});

const secondReservation = reservationListItem.parse({
  ...reservation,
  id: "00000000-0000-4000-8000-000000000121",
  reference_code: "RSV-REAL-002",
  customer: {
    customer_id: "00000000-0000-4000-8000-000000000122",
    snapshot: { full_name: "Second Customer", phone: "09170000002", email: null },
  },
  line: {
    ...reservation.line,
    id: "00000000-0000-4000-8000-000000000123",
    variant_id: "00000000-0000-4000-8000-000000000124",
    name_snapshot: "Second Gown",
  },
});

const secondDetailRecord = reservationDetail.parse({
  ...reservationDetailRecord,
  id: secondReservation.id,
  reference_code: secondReservation.reference_code,
  customer: {
    customer_id: secondReservation.customer.customer_id,
    snapshot: { ...secondReservation.customer.snapshot!, address: "456 Test Street" },
  },
  lines: [
    {
      ...reservationDetailRecord.lines[0],
      id: secondReservation.line.id,
      variant_id: secondReservation.line.variant_id,
      name_snapshot: secondReservation.line.name_snapshot,
    },
  ],
});

const returnedDetailRecord = reservationDetail.parse({
  ...reservationDetailRecord,
  status: "returned",
  version: 5,
  lines: reservationDetailRecord.lines.map((line) => ({
    ...line,
    current_asset_readiness: "unready" as const,
  })),
  custody_timeline: [
    {
      event_kind: "pickup",
      asset_id: "00000000-0000-4000-8000-000000000401",
      reservation_line_id: reservation.line.id,
      occurred_at: "2026-10-12T02:05:00.000Z",
      condition_note: "Clean at handover.",
    },
    {
      event_kind: "return",
      asset_id: "00000000-0000-4000-8000-000000000401",
      reservation_line_id: reservation.line.id,
      occurred_at: "2026-10-14T01:55:00.000Z",
      condition_note: "Returned with light dust on hem.",
    },
  ],
});

const actorContext = {
  tenant: {
    id: "00000000-0000-4000-8000-000000000201",
    name: "Drezivo Test Rental",
    slug: "drezivo-test-rental",
    status: "active" as const,
    currency: "PHP",
    timezone: "Asia/Manila",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  },
  membership: {
    id: "00000000-0000-4000-8000-000000000202",
    role: "owner" as const,
    status: "active" as const,
    updated_at: "2026-09-01T00:00:00.000Z",
  },
  branches: [
    {
      id: "00000000-0000-4000-8000-000000000203",
      name: "Main Branch",
      code: "MAIN",
      is_default: true,
      timezone: "Asia/Manila",
      status: "active" as const,
    },
  ],
  active_branch_id: "00000000-0000-4000-8000-000000000203",
  branch_grants: [
    {
      branch_id: "00000000-0000-4000-8000-000000000203",
      permission_codes: [
        "reservations.manage" as const,
        "reservations.custody" as const,
        "assets.manage" as const,
        "payments.manage" as const,
        "evidence.verify" as const,
      ],
    },
  ],
  subscription: {
    plan_code: "starter",
    plan_version: 1,
    status: "active" as const,
    trial_ends_at: null,
    grace_ends_at: null,
    current_period_start: "2026-09-01T00:00:00.000Z",
    current_period_end: "2026-10-01T00:00:00.000Z",
  },
  entitlements: {
    physical_assets_max: 125,
    frontdesk_seats_max: 0,
  },
};

function page(items: ReservationListItem[] = [reservation], nextCursor: string | null = null) {
  return {
    data: {
      items,
      page_meta: { next_cursor: nextCursor, has_more: nextCursor !== null },
    },
    requestId: "req-reservations",
  };
}

describe("ReservationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.cancelReservation.mockReset();
    api.completeRentalReservation.mockReset();
    api.completeStaffReservation.mockReset();
    api.getActorContext.mockReset();
    api.getReservationDetail.mockReset();
    api.getReservations.mockReset();
    api.inspectReservationReturn.mockReset();
    api.pickupReservation.mockReset();
    api.rejectReservation.mockReset();
    api.returnReservation.mockReset();
    navigation.search = "";
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getActorContext.mockResolvedValue({ data: actorContext, requestId: "req-context" });
    api.getReservationDetail.mockResolvedValue({
      data: reservationDetailRecord,
      requestId: "req-reservation-detail",
    });
    api.getReservations.mockResolvedValue(page());
  });

  it("renders authoritative reservation rows and customer-less short holds instead of mock data", async () => {
    api.getReservations.mockResolvedValue(page([reservation, anonymousHold]));

    render(<ReservationsPage />);

    expect(await screen.findByText("RSV-REAL-001")).toBeVisible();
    expect(screen.getByText("Real Customer")).toBeVisible();
    expect(screen.getAllByText("Real Emerald Gown")).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: "Real Emerald Gown cover image" })).toHaveLength(2);
    expect(screen.queryByText("RC")).not.toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeVisible();
    expect(screen.getByText("Verified")).toBeVisible();
    expect(screen.getByText("Customer not added yet")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Reservations")).not.toBeInTheDocument();

    expect(api.getReservations).toHaveBeenCalledWith({
      limit: 10,
      sort: "created_desc",
    });
  });

  it("sends search and status filters to the reservations endpoint instead of filtering rows in memory", async () => {
    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");

    fireEvent.change(screen.getByLabelText("Search reservations"), {
      target: { value: "Emerald" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Confirmed" }));

    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "created_desc",
        search: "Emerald",
        status: "confirmed",
      })
    );
    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining("q=Emerald"), {
      scroll: false,
    });
  });

  it("treats the first pickup-date selection as an exact day and the second as an inclusive range", async () => {
    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");
    await waitFor(() => expect(api.getActorContext).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Pickup date" }));
    fireEvent.click(screen.getByRole("button", { name: /October 10/i }));

    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "created_desc",
        pickup_start: "2026-10-09T16:00:00.000Z",
        pickup_end: "2026-10-10T16:00:00.000Z",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /October 12/i }));

    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "created_desc",
        pickup_start: "2026-10-09T16:00:00.000Z",
        pickup_end: "2026-10-12T16:00:00.000Z",
      })
    );
  });

  it("rejects pickup ranges over 31 days", async () => {
    navigation.search = "from=2026-10-01&to=2026-11-15";

    render(<ReservationsPage />);

    expect(await screen.findByText("Check the pickup date range")).toBeVisible();
    expect(screen.getByText("Pickup date filters can cover at most 31 days.")).toBeVisible();
    expect(api.getReservations).not.toHaveBeenCalled();
  });

  it("uses opaque next cursors and remembered prior cursors for stable pagination", async () => {
    api.getReservations
      .mockResolvedValueOnce(page([reservation], "cursor-page-2"))
      .mockResolvedValueOnce(page([anonymousHold]))
      .mockResolvedValue(page([reservation], "cursor-page-2"));

    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");

    fireEvent.click(screen.getByRole("button", { name: "Next reservations page" }));
    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        cursor: "cursor-page-2",
        limit: 10,
        sort: "created_desc",
      })
    );
    expect(await screen.findByText("RSV-HOLD-002")).toBeVisible();
    expect(screen.getByText("Page 2 · 1 reservation loaded")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Previous reservations page" }));
    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "created_desc",
      })
    );
  });

  it("opens the authoritative details sheet from a row and renders snapshots, payment, and permission-derived actions", async () => {
    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");

    fireEvent.click(screen.getByRole("button", { name: "Open reservation RSV-REAL-001" }));

    await waitFor(() => expect(api.getReservationDetail).toHaveBeenCalledWith(reservation.id));
    expect(await screen.findByRole("heading", { name: "Reservation RSV-REAL-001" })).toBeVisible();
    expect(screen.getAllByText("Real Customer").length).toBeGreaterThanOrEqual(1);
    const detailSheet = screen.getByRole("dialog");
    const garmentImage = within(detailSheet).getByRole("img", {
      name: "Real Emerald Gown cover image",
    });
    expect(garmentImage).toBeVisible();
    expect(garmentImage.parentElement).toHaveClass("h-20", "w-20");
    expect(screen.getByText("123 Test Street")).toBeVisible();
    expect(screen.getByText("Medium · Emerald")).toBeVisible();
    expect(screen.getByText("EMERALD-M")).toBeVisible();
    expect(screen.getByText("Bust Cm: 91")).toBeVisible();
    expect(screen.getByText("Waist Cm: 72")).toBeVisible();
    expect(screen.getAllByText("Verified").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Pick Up")).toBeVisible();
    expect(screen.getByText("Cancel")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });

  it("refetches the authoritative list and detail after a successful lifecycle mutation", async () => {
    api.pickupReservation.mockResolvedValueOnce({
      data: { reservation: { status: "picked_up" } },
      requestId: "req-pickup",
    });

    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");
    fireEvent.click(screen.getByRole("button", { name: "Open reservation RSV-REAL-001" }));
    await screen.findByRole("heading", { name: "Reservation RSV-REAL-001" });

    fireEvent.click(screen.getByRole("button", { name: "Pick Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Pick Up" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Pickup recorded.");
    await waitFor(() => expect(api.getReservationDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getReservations).toHaveBeenCalledTimes(2));
  });

  it("renders the real custody timeline and returned-state actions", async () => {
    api.getReservations.mockResolvedValue(page([returnedReservation]));
    api.getReservationDetail.mockResolvedValue({
      data: returnedDetailRecord,
      requestId: "req-returned-detail",
    });

    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");
    fireEvent.keyDown(screen.getByRole("button", { name: "Open reservation RSV-REAL-001" }), {
      key: "Enter",
    });

    expect(await screen.findByText("Clean at handover.")).toBeVisible();
    expect(screen.getByText("Returned with light dust on hem.")).toBeVisible();
    expect(screen.getByText("Inspect Return")).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete Rental" })).toBeDisabled();
    expect(
      screen.getByText(
        "Inspect the returned garment and mark it Ready before completing the rental."
      )
    ).toBeVisible();
  });

  it("ignores an older detail response after O/S selects a different reservation", async () => {
    api.getReservations.mockResolvedValue(page([reservation, secondReservation]));
    let resolveFirst:
      ((value: { data: typeof reservationDetailRecord; requestId: string }) => void) | undefined;
    api.getReservationDetail
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce({ data: secondDetailRecord, requestId: "req-second-detail" });

    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");

    fireEvent.click(screen.getByRole("button", { name: "Open reservation RSV-REAL-001" }));
    expect(await screen.findByRole("heading", { name: "Loading reservation…" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open reservation RSV-REAL-002" })).toBeVisible()
    );
    fireEvent.click(screen.getByRole("button", { name: "Open reservation RSV-REAL-002" }));

    expect(await screen.findByRole("heading", { name: "Reservation RSV-REAL-002" })).toBeVisible();
    expect(screen.getAllByText("Second Customer").length).toBeGreaterThanOrEqual(1);

    resolveFirst?.({ data: reservationDetailRecord, requestId: "req-first-detail" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Reservation RSV-REAL-002" })).toBeVisible()
    );
    expect(
      screen.queryByRole("heading", { name: "Reservation RSV-REAL-001" })
    ).not.toBeInTheDocument();
  });

  it("keeps the list intact when detail loading fails and retries only the selected reservation", async () => {
    const ApiError = (await import("@/lib/drezivo-api")).DrezivoApiError;
    api.getReservationDetail
      .mockRejectedValueOnce(
        new ApiError("Reservation detail is temporarily unavailable.", {
          status: 503,
          requestId: "req-detail-failed",
        })
      )
      .mockResolvedValueOnce({ data: reservationDetailRecord, requestId: "req-detail-retry" });

    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");
    fireEvent.click(screen.getByRole("button", { name: "Open reservation RSV-REAL-001" }));

    expect(await screen.findByText("Could not load reservation")).toBeVisible();
    expect(screen.getByText("Reservation detail is temporarily unavailable.")).toBeVisible();
    expect(screen.getByText("Request ID: req-detail-failed")).toBeVisible();
    expect(screen.getByText("RSV-REAL-001")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Reservation RSV-REAL-001" })).toBeVisible();
    expect(api.getReservationDetail).toHaveBeenCalledTimes(2);
    expect(api.getReservations).toHaveBeenCalledTimes(1);
  });

  it("shows bounded loading, empty, and retryable error states", async () => {
    let resolveRequest: ((value: ReturnType<typeof page>) => void) | undefined;
    api.getReservations.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const firstRender = render(<ReservationsPage />);
    expect(screen.getByText("Loading reservations…")).toBeVisible();
    resolveRequest?.(page([]));
    expect(await screen.findByText("No reservations yet")).toBeVisible();
    firstRender.unmount();

    const ApiError = (await import("@/lib/drezivo-api")).DrezivoApiError;
    api.getReservations.mockRejectedValueOnce(
      new ApiError("Reservation service is temporarily unavailable.", {
        status: 503,
        requestId: "req-failed",
      })
    );
    api.getReservations.mockResolvedValueOnce(page());

    render(<ReservationsPage />);
    expect(await screen.findByText("Could not load reservations")).toBeVisible();
    expect(screen.getByText("Reservation service is temporarily unavailable.")).toBeVisible();
    expect(screen.getByText("Request ID: req-failed")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("RSV-REAL-001")).toBeVisible();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reservationListItem, type ReservationListItem } from "@drezivo/contracts";

import { ReservationsPage } from "@/components/reservations/reservations-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getReservations: vi.fn(),
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
      permission_codes: ["reservations.manage" as const],
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
    physical_assets_max: 75,
    frontdesk_seats_max: 1,
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
    navigation.search = "";
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getActorContext.mockResolvedValue({ data: actorContext, requestId: "req-context" });
    api.getReservations.mockResolvedValue(page());
  });

  it("renders authoritative reservation rows and customer-less short holds instead of mock data", async () => {
    api.getReservations.mockResolvedValue(page([reservation, anonymousHold]));

    render(<ReservationsPage />);

    expect(await screen.findByText("RSV-REAL-001")).toBeVisible();
    expect(screen.getByText("Real Customer")).toBeVisible();
    expect(screen.getAllByText("Real Emerald Gown")).toHaveLength(2);
    expect(screen.getByText("Paid")).toBeVisible();
    expect(screen.getByText("Verified")).toBeVisible();
    expect(screen.getByText("Customer not added yet")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Reservations")).not.toBeInTheDocument();

    expect(api.getReservations).toHaveBeenCalledWith({
      limit: 10,
      sort: "pickup_asc",
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
        sort: "pickup_asc",
        search: "Emerald",
        status: "confirmed",
      })
    );
    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining("q=Emerald"), {
      scroll: false,
    });
  });

  it("converts inclusive pickup dates using the active branch timezone and rejects windows over 31 days", async () => {
    render(<ReservationsPage />);
    await screen.findByText("RSV-REAL-001");
    await waitFor(() => expect(api.getActorContext).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Pickup from"), {
      target: { value: "2026-10-10" },
    });
    fireEvent.change(screen.getByLabelText("Pickup through"), {
      target: { value: "2026-10-12" },
    });

    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "pickup_asc",
        pickup_start: "2026-10-09T16:00:00.000Z",
        pickup_end: "2026-10-12T16:00:00.000Z",
      })
    );

    const callCount = api.getReservations.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Pickup through"), {
      target: { value: "2026-11-15" },
    });

    expect(await screen.findByText("Check the pickup date range")).toBeVisible();
    expect(screen.getByText("Pickup date filters can cover at most 31 days.")).toBeVisible();
    expect(api.getReservations.mock.calls.length).toBe(callCount);
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
        sort: "pickup_asc",
      })
    );
    expect(await screen.findByText("RSV-HOLD-002")).toBeVisible();
    expect(screen.getByText("Page 2 · 1 reservation loaded")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Previous reservations page" }));
    await waitFor(() =>
      expect(api.getReservations).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "pickup_asc",
      })
    );
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

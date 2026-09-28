import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerListItem, customerSummaryResponse } from "@drezivo/contracts";

import { CustomersPage } from "@/components/customers/customers-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  archiveCustomer: vi.fn(),
  getCustomerFittings: vi.fn(),
  getCustomerDetail: vi.fn(),
  getCustomerReservations: vi.fn(),
  getCustomerSummary: vi.fn(),
  getCustomers: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));

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
      this.name = "DrezivoApiError";
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status ?? 500;
    }
  },
  createDrezivoApiClient: () => api,
}));

const firstCustomer = customerListItem.parse({
  id: "00000000-0000-4000-8000-000000000101",
  full_name: "Real Database Customer",
  phone: "09171234567",
  email: "real.customer@example.test",
  status: "active",
  reservation_count: 4,
  fitting_count: 2,
  last_activity: { type: "reservation", at: "2026-09-27T02:00:00.000Z" },
  next_activity: { type: "fitting", at: "2026-10-02T02:00:00.000Z" },
  created_at: "2026-08-14T02:00:00.000Z",
});

const secondCustomer = customerListItem.parse({
  id: "00000000-0000-4000-8000-000000000102",
  full_name: "Second Database Customer",
  phone: null,
  email: "second.customer@example.test",
  status: "active",
  reservation_count: 1,
  fitting_count: 0,
  last_activity: null,
  next_activity: null,
  created_at: "2026-09-01T02:00:00.000Z",
});

const summary = customerSummaryResponse.parse({
  all_customers: 42,
  new_this_month: 8,
  returning_customers: 17,
  upcoming_customers: 11,
});

function page(items = [firstCustomer], nextCursor: string | null = null) {
  return {
    data: {
      items,
      page_meta: { next_cursor: nextCursor, has_more: Boolean(nextCursor) },
    },
    requestId: "request-customers",
  };
}

function installDefaults() {
  clerk.useAuth.mockReturnValue({
    getToken: clerk.getToken,
    isLoaded: true,
    isSignedIn: true,
  });
  clerk.getToken.mockResolvedValue("test-token");
  api.getCustomerSummary.mockResolvedValue({ data: summary, requestId: "request-summary" });
  api.getCustomers.mockResolvedValue(page());
  api.getCustomerDetail.mockResolvedValue({
    data: {
      id: firstCustomer.id,
      full_name: firstCustomer.full_name,
      phone: firstCustomer.phone,
      email: firstCustomer.email,
      address: "24 Sampaguita Street",
      social_media: "@real.customer",
      notes: "Staff-only note",
      status: "active",
      archived_at: null,
      reservation_count: 4,
      fitting_count: 2,
      completed_engagement_count: 3,
      last_activity: firstCustomer.last_activity,
      next_activity: firstCustomer.next_activity,
      created_at: firstCustomer.created_at,
      updated_at: "2026-09-27T03:00:00.000Z",
    },
    requestId: "request-detail",
  });
  api.getCustomerReservations.mockResolvedValue({
    data: { items: [], page_meta: { next_cursor: null, has_more: false } },
    requestId: "request-reservations",
  });
  api.getCustomerFittings.mockResolvedValue({
    data: { items: [], page_meta: { next_cursor: null, has_more: false } },
    requestId: "request-fittings",
  });
  api.archiveCustomer.mockResolvedValue({
    data: {
      id: firstCustomer.id,
      status: "archived",
      archived_at: "2026-09-27T03:00:00.000Z",
      updated_at: "2026-09-27T03:00:00.000Z",
    },
    requestId: "request-archive",
  });
}

describe("CustomersPage production wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaults();
  });

  it("renders database-backed customers and summary values", async () => {
    render(<CustomersPage />);

    expect(await screen.findByText("Real Database Customer")).toBeVisible();
    expect(screen.getByText("real.customer@example.test")).toBeVisible();
    expect(screen.getByText("42")).toBeVisible();
    expect(screen.getByText("8")).toBeVisible();
    expect(screen.getByText("17")).toBeVisible();
    expect(screen.getByText("11")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
    expect(api.getCustomers).toHaveBeenCalledWith({ limit: 10, status: "active" });
    expect(api.getCustomerDetail).not.toHaveBeenCalled();
    expect(api.getCustomerReservations).not.toHaveBeenCalled();
    expect(api.getCustomerFittings).not.toHaveBeenCalled();
  });

  it("serializes search and status filters for the server and resets pagination", async () => {
    api.getCustomers.mockImplementation(async (input: { cursor?: string; search?: string; status: string }) => {
      if (input.search === "second") return page([secondCustomer]);
      if (input.cursor === "next-cursor") return page([secondCustomer]);
      return page([firstCustomer], "next-cursor");
    });

    render(<CustomersPage />);
    await screen.findByText("Real Database Customer");

    fireEvent.click(screen.getByRole("button", { name: "Next customers page" }));
    await waitFor(() =>
      expect(api.getCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "next-cursor", limit: 10, status: "active" })
      )
    );
    expect(screen.getByText("Page 2 · 1 customer loaded")).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Search customers" }), {
      target: { value: "second" },
    });
    await waitFor(() =>
      expect(api.getCustomers).toHaveBeenCalledWith({
        limit: 10,
        search: "second",
        status: "active",
      })
    );
    expect(screen.getByText("Page 1 · 1 customer loaded")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Status: Active" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archived" }));
    await waitFor(() =>
      expect(api.getCustomers).toHaveBeenCalledWith({
        limit: 10,
        search: "second",
        status: "archived",
      })
    );
  });

  it("falls back to the previous page when a later page becomes empty", async () => {
    api.getCustomers.mockImplementation(async (input: { cursor?: string }) => {
      if (input.cursor === "next-cursor") return page([]);
      return page([firstCustomer], "next-cursor");
    });

    render(<CustomersPage />);
    await screen.findByText("Real Database Customer");
    fireEvent.click(screen.getByRole("button", { name: "Next customers page" }));

    await waitFor(() => expect(api.getCustomers).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Page 1 · 1 customer loaded")).toBeVisible();
    expect(screen.getByText("Real Database Customer")).toBeVisible();
  });

  it("renders empty and permission states from API responses", async () => {
    api.getCustomers.mockResolvedValueOnce(page([]));
    const empty = render(<CustomersPage />);
    expect(await screen.findByText("No active customers yet")).toBeVisible();
    empty.unmount();

    vi.clearAllMocks();
    installDefaults();
    api.getCustomers.mockRejectedValueOnce(
      new (await import("@/lib/drezivo-api")).DrezivoApiError("Customer access denied", {
        code: "FORBIDDEN",
        requestId: "request-forbidden",
        status: 403,
      })
    );
    render(<CustomersPage />);
    expect(await screen.findByText("Customer access restricted")).toBeVisible();
    expect(screen.getByText("Request ID: request-forbidden")).toBeVisible();
  });

  it("shows a safe retryable error and preserves its request id", async () => {
    api.getCustomers.mockRejectedValueOnce(
      new (await import("@/lib/drezivo-api")).DrezivoApiError("Temporary customer failure", {
        requestId: "request-error",
        status: 503,
      })
    );
    render(<CustomersPage />);

    expect(await screen.findByText("Temporary customer failure")).toBeVisible();
    expect(screen.getByText("Request ID: request-error")).toBeVisible();

    api.getCustomers.mockResolvedValueOnce(page());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Real Database Customer")).toBeVisible();
  });

  it("keeps summary failures independent from a healthy customer directory", async () => {
    api.getCustomerSummary.mockRejectedValueOnce(
      new (await import("@/lib/drezivo-api")).DrezivoApiError("Summary temporarily unavailable", {
        requestId: "request-summary-error",
        status: 503,
      })
    );
    render(<CustomersPage />);

    expect(await screen.findByText("Summary temporarily unavailable")).toBeVisible();
    expect(screen.getByText("Request ID: request-summary-error")).toBeVisible();
    expect(await screen.findByText("Real Database Customer")).toBeVisible();
  });

  it("renders independent loading states while API requests are pending", async () => {
    let releaseSummary: (() => void) | undefined;
    let releaseCustomers: (() => void) | undefined;
    api.getCustomerSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSummary = () => resolve({ data: summary, requestId: "request-summary" });
        })
    );
    api.getCustomers.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCustomers = () => resolve(page());
        })
    );
    render(<CustomersPage />);

    expect(screen.getByLabelText("Loading All Customers")).toBeVisible();
    expect(screen.getByLabelText("Loading customers")).toHaveAttribute("aria-busy", "true");

    releaseSummary?.();
    releaseCustomers?.();
    await waitFor(() => expect(screen.queryByLabelText("Loading customers")).not.toBeInTheDocument());
  });

  it("opens live details while keeping edit unavailable and archive enabled", async () => {
    render(<CustomersPage />);
    await screen.findByText("Real Database Customer");
    const actions = screen.getByRole("button", { name: "Actions for Real Database Customer" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "Enter", code: "Enter" });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "View details" })).not.toHaveAttribute("data-disabled");
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-disabled");
    expect(within(menu).getByRole("menuitem", { name: "Archive" })).not.toHaveAttribute("data-disabled");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "View details" }));
    expect(await screen.findByText("Contact Information")).toBeVisible();
    expect(api.getCustomerDetail).toHaveBeenCalledWith(firstCustomer.id);
    expect(api.getCustomerReservations).toHaveBeenCalledWith(firstCustomer.id, { limit: 10 });
    expect(api.getCustomerFittings).toHaveBeenCalledWith(firstCustomer.id, { limit: 10 });
    expect(screen.getByText("24 Sampaguita Street")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Contact Information")).not.toBeInTheDocument();
    return;
  });

  it("archives a customer with concurrency data and refreshes the list and summary", async () => {
    render(<CustomersPage />);
    await screen.findByText("Real Database Customer");
    const actions = screen.getByRole("button", { name: "Actions for Real Database Customer" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive Customer" }));

    await waitFor(() =>
      expect(api.archiveCustomer).toHaveBeenCalledWith(
        firstCustomer.id,
        { expected_updated_at: "2026-09-27T03:00:00.000Z" },
        expect.any(String)
      )
    );
    await waitFor(() => {
      expect(api.getCustomers).toHaveBeenCalledTimes(2);
      expect(api.getCustomerSummary).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Real Database Customer was archived.");
  });
});

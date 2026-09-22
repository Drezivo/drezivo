import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClothingPage } from "@/components/inventory/clothing-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  archiveClothing: vi.fn(),
  getCatalogueCategories: vi.fn(),
  getCatalogueClothing: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
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

const category = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Gowns",
  status: "active" as const,
  display_order: 10,
};

const firstItem = {
  product_id: "00000000-0000-4000-8000-000000000010",
  code: "GWN-001",
  name: "Real Black Satin Gown",
  category: { id: category.id, name: category.name },
  product_status: "active" as const,
  size_labels: ["S", "M"],
  price_from_minor: "150000",
  currency: "PHP",
  primary_image_url: "https://reads.example.test/catalogue%2Fblack-satin-gown.webp?version=cover-v1",
  readiness: {
    active_assets: 2,
    ready: 2,
    needs_cleaning: 0,
    needs_repair: 0,
    unready: 0,
  },
  availability: {
    window: {
      start: "2026-09-22T12:00:00.000Z",
      end: "2026-09-23T12:00:00.000Z",
    },
    active_assets: 2,
    available_assets: 2,
    unavailable_assets: 0,
    reserved_assets: 0,
    rented_assets: 0,
    cleaning_assets: 0,
    maintenance_assets: 0,
    manual_blocked_assets: 0,
  },
  created_at: "2026-09-20T08:00:00.000Z",
  updated_at: "2026-09-20T08:00:00.000Z",
};

const secondItem = {
  ...firstItem,
  product_id: "00000000-0000-4000-8000-000000000011",
  code: "DRS-002",
  name: "Real Red Dress",
  size_labels: ["L"],
  readiness: {
    active_assets: 1,
    ready: 0,
    needs_cleaning: 1,
    needs_repair: 0,
    unready: 0,
  },
  availability: {
    ...firstItem.availability,
    active_assets: 1,
    available_assets: 0,
    unavailable_assets: 1,
    cleaning_assets: 1,
  },
};

describe("ClothingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "";
    sessionStorage.clear();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getCatalogueCategories.mockResolvedValue({
      data: { items: [category] },
      requestId: "req-categories",
    });
    api.getCatalogueClothing.mockResolvedValue({
      data: {
        items: [firstItem],
        page_meta: { next_cursor: null, has_more: false },
      },
      requestId: "req-clothing",
    });
    api.archiveClothing.mockResolvedValue({
      data: {
        product_id: firstItem.product_id,
        status: "archived",
        archived_variant_count: 1,
        retired_asset_count: 2,
        pending_asset_resolution_count: 0,
        updated_at: "2026-09-21T00:00:00.000Z",
      },
      requestId: "req-archive",
    });
  });

  it("shows a one-time draft-saved notice that can be dismissed", async () => {
    sessionStorage.setItem("drezivo:inventory-notice", "draft-saved");

    render(<ClothingPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved");
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss inventory message" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a one-time clothing-added notice and refreshes real inventory state", async () => {
    sessionStorage.setItem("drezivo:inventory-notice", "clothing-added");

    render(<ClothingPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Clothing added");
    expect(await screen.findByText("Real Black Satin Gown")).toBeVisible();
    expect(api.getCatalogueClothing).toHaveBeenCalledWith({ limit: 10, sort: "name_asc" });
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBeNull();
  });

  it("automatically hides the draft-saved notice after three seconds", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("drezivo:inventory-notice", "draft-saved");

    render(<ClothingPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Draft saved");

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders clothing returned by GET catalogue/clothing instead of mock inventory data", async () => {
    render(<ClothingPage />);

    expect(screen.getByRole("heading", { name: "Clothing" })).toBeVisible();
    expect(await screen.findByText("Real Black Satin Gown")).toBeVisible();
    expect(screen.getByText("GWN-001")).toBeVisible();
    expect(screen.getAllByText("₱1,500").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("S · M").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Black Satin Gown")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Real Black Satin Gown catalogue photo" })).toHaveAttribute(
      "loading",
      "lazy"
    );
    expect(screen.getByRole("img", { name: "Real Black Satin Gown catalogue photo" })).toHaveAttribute(
      "decoding",
      "async"
    );

    expect(api.getCatalogueClothing).toHaveBeenCalledWith({
      limit: 10,
      sort: "name_asc",
    });
  });

  it("renders canonical operational signals separately from windowed availability capacity", async () => {
    api.getCatalogueClothing.mockResolvedValueOnce({
      data: {
        items: [
          {
            ...firstItem,
            availability: {
              ...firstItem.availability,
              active_assets: 5,
              available_assets: 0,
              unavailable_assets: 5,
              reserved_assets: 1,
              rented_assets: 1,
              cleaning_assets: 1,
              maintenance_assets: 1,
              manual_blocked_assets: 1,
            },
          },
        ],
        page_meta: { next_cursor: null, has_more: false },
      },
      requestId: "req-canonical-availability",
    });

    render(<ClothingPage />);
    await screen.findByText("Real Black Satin Gown");

    expect(screen.getAllByText("1 Reserved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 Rented").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 Cleaning").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 Maintenance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 Unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0/5 available").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next 24 hours").length).toBeGreaterThan(0);
  });

  it("renders the backend cover image and falls back to initials when none is available", async () => {
    render(<ClothingPage />);

    const image = await screen.findByRole("img", { name: "Real Black Satin Gown catalogue photo" });
    expect(image).toHaveAttribute(
      "src",
      "https://reads.example.test/catalogue%2Fblack-satin-gown.webp?version=cover-v1",
    );

    api.getCatalogueClothing.mockResolvedValue({
      data: {
        items: [{ ...secondItem, primary_image_url: null }],
        page_meta: { next_cursor: null, has_more: false },
      },
      requestId: "req-no-cover",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Search clothing" }), {
      target: { value: "DRS-002" },
    });

    expect(await screen.findByText("Real Red Dress")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Real Red Dress catalogue photo" })).not.toBeInTheDocument();
    expect(screen.getByText("RR")).toBeVisible();
  });

  it("sends search text to the backend instead of filtering a local mock array", async () => {
    api.getCatalogueClothing.mockImplementation(async (input: { search?: string }) => ({
      data: {
        items: input.search ? [secondItem] : [firstItem],
        page_meta: { next_cursor: null, has_more: false },
      },
      requestId: "req-search",
    }));

    render(<ClothingPage />);
    await screen.findByText("Real Black Satin Gown");

    fireEvent.change(screen.getByRole("textbox", { name: "Search clothing" }), {
      target: { value: "DRS-002" },
    });

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "name_asc",
        search: "DRS-002",
      })
    );
    expect(await screen.findByText("Real Red Dress")).toBeVisible();
  });

  it("wires Edit and Archive actions to Phase 3 routes and backend archive command", async () => {
    api.getCatalogueClothing
      .mockResolvedValueOnce({
        data: { items: [firstItem], page_meta: { next_cursor: null, has_more: false } },
        requestId: "req-active",
      })
      .mockResolvedValue({
        data: {
          items: [{ ...firstItem, product_status: "archived" as const }],
          page_meta: { next_cursor: null, has_more: false },
        },
        requestId: "req-archived",
      });

    render(<ClothingPage />);
    await screen.findByText("Real Black Satin Gown");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open actions for Real Black Satin Gown" }),
      { button: 0, ctrlKey: false }
    );
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toHaveAttribute(
      "href",
      `/inventory/${firstItem.product_id}/edit`
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive Clothing" }));

    await waitFor(() => expect(api.archiveClothing).toHaveBeenCalledTimes(1));
    expect(api.archiveClothing).toHaveBeenCalledWith(
      firstItem.product_id,
      { expected_updated_at: firstItem.updated_at },
      expect.any(String)
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Clothing archived.");

    await waitFor(() => expect(api.getCatalogueClothing).toHaveBeenCalledTimes(2));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open actions for Real Black Satin Gown" }),
      { button: 0, ctrlKey: false }
    );
    expect(screen.queryByRole("menuitem", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("hydrates shareable search/category/size/status URL state and sends only catalogue filters to the API", async () => {
    navigation.search = `q=red&category=${category.id}&size=L&status=draft&tenant_id=do-not-trust`;

    render(<ClothingPage />);

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenCalledWith({
        limit: 10,
        sort: "name_asc",
        search: "red",
        category_id: category.id,
        size_label: "L",
        product_status: "draft",
      })
    );
    expect(screen.getByRole("textbox", { name: "Search clothing" })).toHaveValue("red");
    expect(screen.getByRole("button", { name: "L" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Draft" })).toBeVisible();
    expect(navigation.replace).toHaveBeenCalledWith(
      `/inventory?q=red&category=${category.id}&size=L&status=draft`,
      { scroll: false }
    );
  });

  it("resets cursor pagination when the server-side status filter changes", async () => {
    api.getCatalogueClothing.mockImplementation(async (input: { cursor?: string; product_status?: string }) => {
      if (input.product_status === "draft") {
        return {
          data: { items: [{ ...secondItem, product_status: "draft" as const }], page_meta: { next_cursor: null, has_more: false } },
          requestId: "req-draft",
        };
      }
      if (input.cursor === "cursor-page-2") {
        return {
          data: { items: [secondItem], page_meta: { next_cursor: null, has_more: false } },
          requestId: "req-page-2",
        };
      }
      return {
        data: { items: [firstItem], page_meta: { next_cursor: "cursor-page-2", has_more: true } },
        requestId: "req-page-1",
      };
    });

    render(<ClothingPage />);
    await screen.findByText("Real Black Satin Gown");
    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));
    await screen.findByText("Real Red Dress");

    fireEvent.pointerDown(screen.getByRole("button", { name: "All Statuses" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Draft" }));

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "name_asc",
        product_status: "draft",
      })
    );
    expect(screen.getByText("Page 1 · 1 style loaded")).toBeVisible();
  });

  it("renders designed permission, empty, and mobile-detail states", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.getCatalogueClothing.mockRejectedValueOnce(
      new DrezivoApiError("This branch does not grant clothing management access.", {
        code: "FORBIDDEN",
        status: 403,
      })
    );

    const { rerender } = render(<ClothingPage />);
    expect(await screen.findByText("Clothing access is restricted")).toBeVisible();
    expect(screen.getByText(/Ask a workspace owner to update your access/)).toBeVisible();

    api.getCatalogueClothing.mockResolvedValue({
      data: { items: [], page_meta: { next_cursor: null, has_more: false } },
      requestId: "req-empty",
    });
    rerender(<ClothingPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search clothing" }), {
      target: { value: "nothing" },
    });
    expect(await screen.findByText("No clothing matches these filters")).toBeVisible();

    api.getCatalogueClothing.mockResolvedValue({
      data: { items: [firstItem], page_meta: { next_cursor: null, has_more: false } },
      requestId: "req-mobile",
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Real Black Satin Gown");
    expect(screen.getByRole("table", { name: "Clothing catalogue" })).toBeVisible();
    expect(screen.getByText("Category", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("Availability", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("Operational status", { selector: "dt" })).toBeInTheDocument();
  });

  it("uses the backend next cursor for catalogue pagination", async () => {
    api.getCatalogueClothing.mockImplementation(async (input: { cursor?: string }) =>
      input.cursor === "cursor-page-2"
        ? {
            data: {
              items: [secondItem],
              page_meta: { next_cursor: null, has_more: false },
            },
            requestId: "req-page-2",
          }
        : {
            data: {
              items: [firstItem],
              page_meta: { next_cursor: "cursor-page-2", has_more: true },
            },
            requestId: "req-page-1",
          }
    );

    render(<ClothingPage />);
    await screen.findByText("Real Black Satin Gown");

    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));

    expect(await screen.findByText("Real Red Dress")).toBeVisible();
    expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
      limit: 10,
      sort: "name_asc",
      cursor: "cursor-page-2",
    });
    expect(screen.getByText("Page 2 · 1 style loaded")).toBeVisible();
  });
});

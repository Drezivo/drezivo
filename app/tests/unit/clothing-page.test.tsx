import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  getCatalogueImportCapabilities: vi.fn(),
  restoreClothing: vi.fn(),
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
  subcategory: "LONG",
  category: { id: category.id, name: category.name },
  product_status: "active" as const,
  sizing_mode: "sized" as const,
  has_free_size: false,
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

const defaultSummary = {
  total_products: 2,
  active_rental_items: 3,
  active_categories: 1,
  archived_products: 0,
  matching_products: 1,
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

const getClothingCard = async (name: string) =>
  within(await screen.findByRole("listitem", { name }));

describe("ClothingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "";
    sessionStorage.clear();
    api.getCatalogueImportCapabilities.mockResolvedValue({
      data: { photo_extraction: false, max_batch_items: 25, batch_add: false },
    });
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
        summary: defaultSummary,
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
    api.restoreClothing.mockResolvedValue({
      data: {
        product_id: firstItem.product_id,
        status: "draft",
        restored_variant_count: 1,
        updated_at: "2026-09-22T00:00:00.000Z",
      },
      requestId: "req-restore",
    });
  });

  it("shows summary and catalogue skeletons until the first request resolves", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    api.getCatalogueClothing.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    render(<ClothingPage />);

    expect(screen.getByRole("status", { name: "Loading clothing summary" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Loading clothing" })).toBeVisible();
    expect(screen.queryByText("Real Black Satin Gown")).not.toBeInTheDocument();

    resolveRequest?.({
      data: {
        items: [firstItem],
        page_meta: { next_cursor: null, has_more: false },
        summary: defaultSummary,
      },
    });
    expect(await screen.findByRole("listitem", { name: "Real Black Satin Gown" })).toBeVisible();
    expect(screen.queryByRole("status", { name: "Loading clothing" })).not.toBeInTheDocument();
  });

  it("shows a one-time draft-saved notice that can be dismissed", async () => {
    sessionStorage.setItem("drezivo:inventory-notice", "draft-saved");

    render(<ClothingPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved");
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss inventory message" }));
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
  });

  it("shows flexible-fit clothing as one explicit size instead of zero sizes", async () => {
    api.getCatalogueClothing.mockResolvedValue({
      data: {
        items: [{ ...firstItem, sizing_mode: "free_size", has_free_size: true, size_labels: [] }],
        page_meta: { next_cursor: null, has_more: false },
      },
      requestId: "req-free-size",
    });

    render(<ClothingPage />);

    expect((await screen.findAllByText("Flexible fit")).length).toBeGreaterThan(0);
    expect(await screen.findByText("1 size")).toBeVisible();
    expect(screen.queryByText("0 sizes")).not.toBeInTheDocument();
  });

  it("shows a one-time clothing-added notice and refreshes real inventory state", async () => {
    sessionStorage.setItem("drezivo:inventory-notice", "clothing-added");

    render(<ClothingPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Clothing added");
    expect(await screen.findByRole("listitem", { name: "Real Black Satin Gown" })).toBeVisible();
    expect(screen.getAllByText("LONG").length).toBeGreaterThan(0);
    expect(api.getCatalogueClothing).toHaveBeenCalledWith({ limit: 10, sort: "newest", product_status: "active" });
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBeNull();
  });

  it("automatically hides the draft-saved notice after three seconds", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("drezivo:inventory-notice", "draft-saved");

    render(<ClothingPage />);
    expect(screen.getByText("Draft saved")).toBeVisible();

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows Batch Add only when the API allows it for this account", async () => {
    const { unmount } = render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });
    await waitFor(() => expect(api.getCatalogueImportCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Batch Add" })).not.toBeInTheDocument();
    unmount();

    api.getCatalogueImportCapabilities.mockResolvedValue({
      data: { photo_extraction: false, max_batch_items: 25, batch_add: true },
    });
    render(<ClothingPage />);
    expect(await screen.findByRole("link", { name: "Batch Add" })).toHaveAttribute("href", "/inventory/import");
  });

  it("shows a primary Add Clothing action with compact category and batch actions", async () => {
    const { unmount } = render(<ClothingPage />);

    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.queryByRole("button", { name: "Export inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore backup" })).not.toBeInTheDocument();
    const addClothing = screen.getByRole("link", { name: "Add Clothing" });
    const manageCategories = screen.getByRole("link", { name: "Manage Categories" });
    expect(addClothing).toHaveAttribute("href", "/inventory/new");
    expect(addClothing).toHaveClass("dashboard-button-default", "w-full", "sm:w-auto");
    expect(manageCategories).toHaveAttribute("href", "/inventory/categories");
    expect(manageCategories).toHaveClass("dashboard-button-secondary", "flex-1", "sm:flex-none");
    expect(screen.queryByRole("link", { name: "Batch Add" })).not.toBeInTheDocument();

    unmount();
    api.getCatalogueImportCapabilities.mockResolvedValue({
      data: { photo_extraction: false, max_batch_items: 25, batch_add: true },
    });
    render(<ClothingPage />);
    const batchAdd = await screen.findByRole("link", { name: "Batch Add" });
    expect(batchAdd).toHaveAttribute("href", "/inventory/import");
    expect(batchAdd).toHaveClass("dashboard-button-secondary", "flex-1", "sm:flex-none");
  });

  it("renders clothing returned by GET catalogue/clothing instead of mock inventory data", async () => {
    render(<ClothingPage />);

    expect(screen.getByRole("heading", { name: "Clothing" })).toBeVisible();
    const clothingCard = await getClothingCard("Real Black Satin Gown");
    expect(clothingCard.getByText("GWN-001")).toBeVisible();
    expect(screen.getAllByText("₱1,500").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("S · M").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Black Satin Gown")).not.toBeInTheDocument();
    expect(
      clothingCard.getByRole("img", { name: "Real Black Satin Gown catalogue photo" })
    ).toHaveAttribute("loading", "lazy");
    expect(
      clothingCard.getByRole("img", { name: "Real Black Satin Gown catalogue photo" })
    ).toHaveAttribute("decoding", "async");

    expect(api.getCatalogueClothing).toHaveBeenCalledWith({ limit: 10, sort: "newest", product_status: "active" });
  });

  it("uses authoritative workspace totals, Active by default, and clear pagination states", async () => {
    api.getCatalogueClothing.mockResolvedValue({
      data: {
        items: [firstItem],
        page_meta: { next_cursor: null, has_more: false },
        summary: {
          total_products: 27,
          active_rental_items: 42,
          active_categories: 6,
          archived_products: 3,
          matching_products: 24,
        },
      },
      requestId: "req-summary",
    });

    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.getByRole("button", { name: "Status Active" })).toBeVisible();
    expect(api.getCatalogueClothing).toHaveBeenCalledWith({
      limit: 10,
      sort: "newest",
      product_status: "active",
    });
    expect(screen.getByText("Total Clothing").parentElement).toHaveTextContent("27");
    expect(screen.getByText("Active Rental Items").parentElement).toHaveTextContent("42");
    expect(screen.getByText("Categories").parentElement).toHaveTextContent("6");
    expect(screen.getByText("Archived Clothing").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Showing 1–1 of 24")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous clothing page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next clothing page" })).toBeDisabled();
  });

  it("renders visible labels associated with each clothing filter", async () => {
    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.getByLabelText("Search")).toBeVisible();
    expect(screen.getByText("Category", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Size", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Status", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Sort", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Category All Categories" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Size All Sizes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Status Active" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sort New" })).toBeVisible();
  });

  it("defaults sorting to New and changes server-side ordering with URL-backed sort state", async () => {
    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.getByRole("button", { name: "Sort New" })).toHaveTextContent("New");
    expect(screen.getByRole("button", { name: "Status Active" })).toBeVisible();
    expect(api.getCatalogueClothing).toHaveBeenCalledWith({ limit: 10, sort: "newest", product_status: "active" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort New" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Oldest" }));

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({ limit: 10, sort: "oldest", product_status: "active" })
    );
    expect(navigation.replace).toHaveBeenCalledWith("/inventory?sort=oldest", { scroll: false });
    expect(screen.getByRole("button", { name: "Sort Oldest" })).toHaveTextContent("Oldest");
  });

  it("shows windowed availability without implying a global clothing status", async () => {
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
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByText("Operational status", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.getAllByText("0/5 available").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next 24 hours").length).toBeGreaterThan(0);
    expect(screen.queryByText("Available", { selector: "span" })).not.toBeInTheDocument();
  });

  it("renders the backend cover image and falls back to initials when none is available", async () => {
    render(<ClothingPage />);

    const clothingCard = await getClothingCard("Real Black Satin Gown");
    const image = clothingCard.getByRole("img", { name: "Real Black Satin Gown catalogue photo" });
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
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "DRS-002" },
    });

    const redDressCard = await getClothingCard("Real Red Dress");
    expect(
      redDressCard.queryByRole("img", { name: "Real Red Dress catalogue photo" })
    ).not.toBeInTheDocument();
    expect(redDressCard.getByText("RR")).toBeVisible();
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
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    const requestCountBeforeSearch = api.getCatalogueClothing.mock.calls.length;
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "DRS-002" },
    });
    expect(api.getCatalogueClothing).toHaveBeenCalledTimes(requestCountBeforeSearch);

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "newest",
        search: "DRS-002",
        product_status: "active",
      })
    );
    expect(await screen.findByRole("listitem", { name: "Real Red Dress" })).toBeVisible();
  });

  it("wires Edit and Archive actions to Phase 3 routes and backend archive command", async () => {
    api.getCatalogueClothing
      .mockResolvedValueOnce({
        data: { items: [firstItem], page_meta: { next_cursor: null, has_more: false }, summary: defaultSummary },
        requestId: "req-active",
      })
      .mockResolvedValue({
        data: {
          items: [],
          page_meta: { next_cursor: null, has_more: false },
          summary: { ...defaultSummary, archived_products: 1, matching_products: 0 },
        },
        requestId: "req-archived",
      });

    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    fireEvent.pointerDown(
      (await getClothingCard("Real Black Satin Gown")).getByRole("button", {
        name: "Open actions for Real Black Satin Gown",
      }),
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
    expect(screen.queryByText("Real Black Satin Gown")).not.toBeInTheDocument();
  });

  it("restores an archived row to draft with the row concurrency token and refreshes inventory", async () => {
    navigation.search = "status=archived";
    const archivedItem = { ...firstItem, product_status: "archived" as const };
    api.getCatalogueClothing
      .mockResolvedValueOnce({
        data: {
          items: [archivedItem],
          page_meta: { next_cursor: null, has_more: false },
          summary: { ...defaultSummary, archived_products: 1, matching_products: 1 },
        },
        requestId: "req-archived-row",
      })
      .mockResolvedValue({
        data: {
          items: [],
          page_meta: { next_cursor: null, has_more: false },
          summary: { ...defaultSummary, archived_products: 0, matching_products: 0 },
        },
        requestId: "req-restored-row",
      });

    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });
    fireEvent.pointerDown(
      (await getClothingCard("Real Black Satin Gown")).getByRole("button", {
        name: "Open actions for Real Black Satin Gown",
      }),
      { button: 0, ctrlKey: false }
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restore to Draft" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore to Draft" }));

    await waitFor(() => expect(api.restoreClothing).toHaveBeenCalledTimes(1));
    expect(api.restoreClothing).toHaveBeenCalledWith(
      firstItem.product_id,
      { expected_updated_at: firstItem.updated_at },
      expect.any(String)
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clothing restored to Draft. Review the clothing and publish it when ready."
    );
    await waitFor(() => expect(api.getCatalogueClothing).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Real Black Satin Gown")).not.toBeInTheDocument();
  });

  it("hydrates shareable search/category/size/status/sort URL state and sends only catalogue filters to the API", async () => {
    navigation.search = `q=red&category=${category.id}&size=L&status=draft&sort=name_desc&tenant_id=do-not-trust`;

    render(<ClothingPage />);

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenCalledWith({
        limit: 10,
        sort: "name_desc",
        search: "red",
        category_id: category.id,
        size_label: "L",
        product_status: "draft",
      })
    );
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("red");
    expect(screen.getByRole("button", { name: "Size L" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Status Draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sort Name Z–A" })).toHaveTextContent("Name Z–A");
    expect(navigation.replace).toHaveBeenCalledWith(
      `/inventory?q=red&category=${category.id}&size=L&status=draft&sort=name_desc`,
      { scroll: false }
    );
  });

  it("resets cursor pagination when the server-side status filter changes", async () => {
    api.getCatalogueClothing.mockImplementation(async (input: { cursor?: string; product_status?: string }) => {
      if (input.product_status === "draft") {
        return {
          data: {
            items: [{ ...secondItem, product_status: "draft" as const }],
            page_meta: { next_cursor: null, has_more: false },
            summary: { ...defaultSummary, matching_products: 1 },
          },
          requestId: "req-draft",
        };
      }
      if (input.cursor === "cursor-page-2") {
        return {
          data: {
            items: [secondItem],
            page_meta: { next_cursor: null, has_more: false },
            summary: { ...defaultSummary, matching_products: 11 },
          },
          requestId: "req-page-2",
        };
      }
      return {
        data: {
          items: [firstItem],
          page_meta: { next_cursor: "cursor-page-2", has_more: true },
          summary: { ...defaultSummary, matching_products: 11 },
        },
        requestId: "req-page-1",
      };
    });

    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });
    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));
    await screen.findByRole("listitem", { name: "Real Red Dress" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Status Active" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Draft" }));

    await waitFor(() =>
      expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
        limit: 10,
        sort: "newest",
        product_status: "draft",
      })
    );
    expect(screen.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  it("renders designed permission and empty states", async () => {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "nothing" },
    });
    expect(await screen.findByText("No clothing matches these filters")).toBeVisible();

    api.getCatalogueClothing.mockResolvedValue({
      data: { items: [firstItem], page_meta: { next_cursor: null, has_more: false } },
      requestId: "req-mobile",
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const clothingCard = await getClothingCard("Real Black Satin Gown");
    const mobileList = screen.getByRole("list", { name: "Clothing catalogue" });
    const desktopTable = screen.getByRole("table", { name: "Clothing catalogue" });
    expect(mobileList).toHaveClass("md:hidden");
    expect(desktopTable.parentElement?.parentElement).toHaveClass("hidden", "md:block");
    expect(
      within(desktopTable).getByRole("columnheader", { name: "Clothing" })
    ).toBeInTheDocument();
    expect(clothingCard.getByText("Category", { selector: "dt" })).toBeInTheDocument();
    expect(clothingCard.getByText("Availability", { selector: "dt" })).toBeInTheDocument();
    expect(
      clothingCard.queryByText("Operational status", { selector: "dt" })
    ).not.toBeInTheDocument();
  });

  it("renders balanced mobile cards with aligned details and the existing actions", async () => {
    api.getCatalogueClothing.mockResolvedValue({
      data: {
        items: [{ ...firstItem, product_status: "draft" }],
        page_meta: { next_cursor: null, has_more: false },
        summary: defaultSummary,
      },
      requestId: "req-mobile-card",
    });

    render(<ClothingPage />);

    const card = await screen.findByRole("listitem", { name: "Real Black Satin Gown" });
    const details = within(card).getByLabelText("Clothing details");
    expect(card).toHaveClass("bg-dashboard-surface", "border-dashboard-border", "rounded-xl");
    expect(card).toHaveAttribute("data-mobile-card", "keep");
    expect(within(card).getByText("GWN-001")).toBeVisible();
    expect(within(card).getByText("LONG")).toBeVisible();
    expect(within(card).getByText("Draft")).toBeVisible();
    expect(details).toHaveClass("grid", "grid-cols-2");
    expect(within(details).getByText("Gowns")).toBeVisible();
    expect(within(details).getByText("S · M")).toBeVisible();
    expect(within(details).getByText("₱1,500")).toBeVisible();
    expect(within(details).getByText("2/2 available")).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Open actions for Real Black Satin Gown" })
    ).toBeVisible();
  });

  it("uses the backend next cursor for catalogue pagination", async () => {
    api.getCatalogueClothing.mockImplementation(async (input: { cursor?: string }) =>
      input.cursor === "cursor-page-2"
        ? {
            data: {
              items: [secondItem],
              page_meta: { next_cursor: null, has_more: false },
              summary: { ...defaultSummary, matching_products: 11 },
            },
            requestId: "req-page-2",
          }
        : {
            data: {
              items: [firstItem],
              page_meta: { next_cursor: "cursor-page-2", has_more: true },
              summary: { ...defaultSummary, matching_products: 11 },
            },
            requestId: "req-page-1",
          }
    );

    render(<ClothingPage />);
    await screen.findByRole("listitem", { name: "Real Black Satin Gown" });

    expect(screen.getByRole("button", { name: "Previous clothing page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next clothing page" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));

    expect(await screen.findByRole("listitem", { name: "Real Red Dress" })).toBeVisible();
    expect(api.getCatalogueClothing).toHaveBeenLastCalledWith({
      limit: 10,
      sort: "newest",
      product_status: "active",
      cursor: "cursor-page-2",
    });
    expect(screen.getByText("Showing 11–11 of 11")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous clothing page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next clothing page" })).toBeDisabled();
  });
});

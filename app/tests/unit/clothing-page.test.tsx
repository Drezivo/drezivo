import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClothingPage } from "@/components/inventory/clothing-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getCatalogueCategories: vi.fn(),
  getCatalogueClothing: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
    requestId: string | null = null;
    status = 500;
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
};

describe("ClothingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("shows a one-time draft-saved notice that can be dismissed", async () => {
    sessionStorage.setItem("drezivo:inventory-notice", "draft-saved");

    render(<ClothingPage />);

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved");
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss draft saved message" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    expect(screen.getByText("₱1,500")).toBeVisible();
    expect(screen.getByText("S · M")).toBeVisible();
    expect(screen.queryByText("Black Satin Gown")).not.toBeInTheDocument();

    expect(api.getCatalogueClothing).toHaveBeenCalledWith({
      limit: 10,
      sort: "name_asc",
    });
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

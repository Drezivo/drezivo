import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoriesPage } from "@/components/inventory/categories-page";
import { ClothingPage } from "@/components/inventory/clothing-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  createCatalogueCategory: vi.fn(),
  getCatalogueCategories: vi.fn(),
  getCatalogueClothing: vi.fn(),
  removeCatalogueCategory: vi.fn(),
  updateCatalogueCategory: vi.fn(),
  updateCatalogueCategoryStatus: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
    requestId: string | null = null;
    status = 500;
  },
  createDrezivoApiClient: () => api,
}));

const categories = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Gowns",
    status: "active" as const,
    display_order: 10,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Costumes",
    status: "inactive" as const,
    display_order: 50,
  },
];

describe("CategoriesPage", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getCatalogueCategories.mockResolvedValue({
      data: { items: categories },
      requestId: "req-categories",
    });
    api.getCatalogueClothing.mockResolvedValue({
      data: { items: [], page_meta: { next_cursor: null, has_more: false } },
      requestId: "req-clothing",
    });
  });

  it("renders real category states and their storefront actions", async () => {
    render(<CategoriesPage />);

    expect(await screen.findByRole("heading", { name: "Categories" })).toBeVisible();
    expect(screen.getByText("Gowns")).toBeVisible();
    expect(screen.getByText("Costumes")).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide Gowns on storefront" })).toHaveTextContent(
      "Set inactive"
    );
    expect(screen.getByRole("button", { name: "Show Costumes on storefront" })).toHaveTextContent(
      "Set active"
    );
  });

  it("adds a category from the modal and renders it immediately", async () => {
    api.createCatalogueCategory.mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Formal Wear",
        status: "active",
        display_order: 15,
      },
      requestId: "req-category-create",
    });

    render(<CategoriesPage />);
    await screen.findByText("Gowns");
    fireEvent.click(screen.getByRole("button", { name: "Add Category" }));
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Formal Wear" } });
    fireEvent.change(screen.getByLabelText("Display order"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Category" }));

    await waitFor(() => expect(api.createCatalogueCategory).toHaveBeenCalledTimes(1));
    expect(api.createCatalogueCategory).toHaveBeenCalledWith(
      { name: "Formal Wear", display_order: 15 },
      expect.any(String)
    );
    expect(await screen.findByText("Formal Wear")).toBeVisible();
  });

  it("edits a category from the modal", async () => {
    api.updateCatalogueCategory.mockResolvedValue({
      data: { ...categories[0], name: "Evening Gowns", display_order: 3 },
      requestId: "req-category-edit",
    });

    render(<CategoriesPage />);
    await screen.findByText("Gowns");
    fireEvent.click(screen.getByRole("button", { name: "Edit Gowns" }));
    const name = screen.getByLabelText("Category name");
    fireEvent.change(name, { target: { value: "Evening Gowns" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateCatalogueCategory).toHaveBeenCalledTimes(1));
    expect(api.updateCatalogueCategory).toHaveBeenCalledWith(
      categories[0]?.id,
      { name: "Evening Gowns", display_order: 10 },
      expect.any(String)
    );
    expect(await screen.findByText("Evening Gowns")).toBeVisible();
  });

  it("removes an unused category and deactivates a referenced category safely", async () => {
    api.removeCatalogueCategory
      .mockResolvedValueOnce({
        data: { category_id: categories[1]?.id, outcome: "deleted" },
        requestId: "req-category-delete",
      })
      .mockResolvedValueOnce({
        data: { category_id: categories[0]?.id, outcome: "deactivated" },
        requestId: "req-category-deactivate",
      });

    render(<CategoriesPage />);
    await screen.findByText("Gowns");

    fireEvent.click(screen.getByRole("button", { name: "Remove Costumes" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Category" }));
    await waitFor(() => expect(api.removeCatalogueCategory).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Costumes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Gowns" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Category" }));
    await waitFor(() => expect(api.removeCatalogueCategory).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Show Gowns on storefront" })).toBeVisible();
    expect(screen.getByText(/retained for history/i)).toBeVisible();
  });

  it("guards a duplicate category toggle and updates the rendered state after success", async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined;
    api.updateCatalogueCategoryStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );

    render(<CategoriesPage />);
    const button = await screen.findByRole("button", { name: "Hide Gowns on storefront" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(api.updateCatalogueCategoryStatus).toHaveBeenCalledTimes(1);
    expect(api.updateCatalogueCategoryStatus).toHaveBeenCalledWith(
      categories[0]?.id,
      { status: "inactive" },
      expect.any(String)
    );

    resolveUpdate({
      data: { ...categories[0], status: "inactive" },
      requestId: "req-toggle",
    });

    expect(
      await screen.findByRole("button", { name: "Show Gowns on storefront" })
    ).toHaveTextContent("Set active");
  });

  it("reuses one idempotency key when a failed toggle is retried", async () => {
    api.updateCatalogueCategoryStatus
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        data: { ...categories[0], status: "inactive" },
        requestId: "req-retry",
      });

    render(<CategoriesPage />);
    const button = await screen.findByRole("button", { name: "Hide Gowns on storefront" });
    fireEvent.click(button);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Hide Gowns on storefront" }));

    await waitFor(() => expect(api.updateCatalogueCategoryStatus).toHaveBeenCalledTimes(2));
    const firstKey = api.updateCatalogueCategoryStatus.mock.calls[0]?.[2];
    const secondKey = api.updateCatalogueCategoryStatus.mock.calls[1]?.[2];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });
});

describe("Clothing category entry point", () => {
  afterEach(() => cleanup());

  it("exposes Manage Categories from Clothing without adding a sidebar destination", () => {
    render(<ClothingPage />);
    expect(screen.getByRole("link", { name: "Manage Categories" })).toHaveAttribute(
      "href",
      "/inventory/categories"
    );
  });
});

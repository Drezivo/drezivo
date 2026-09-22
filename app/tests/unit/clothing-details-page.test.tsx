import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClothingDetailsPage } from "@/components/inventory/clothing-details-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  archiveClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
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
      options: { code?: string; requestId?: string | null; status: number }
    ) {
      super(message);
      this.code = options.code ?? "INTERNAL_ERROR";
      this.requestId = options.requestId ?? null;
      this.status = options.status;
    }
  },
  createDrezivoApiClient: () => api,
}));

const productId = "00000000-0000-4000-8000-000000000010";

const detail = {
  product_id: productId,
  code: "GWN-001",
  name: "Emerald Evening Gown",
  description: "Elegant emerald gown from the real catalogue response.",
  category: {
    id: "00000000-0000-4000-8000-000000000011",
    name: "Gowns",
  },
  status: "active" as const,
  images: [],
  variants: [
    {
      id: "00000000-0000-4000-8000-000000000012",
      sku: "GWN-001-M",
      size_label: "M",
      color_label: "Emerald",
      measurement_mode: "custom" as const,
      measurement_guide_id: null,
      measurement_unit: "cm" as const,
      measurements: { bust: 90, waist: 72 },
      rental_price_minor: "150000",
      security_deposit_minor: "50000",
      currency: "PHP",
      pricing_mode: "daily" as const,
      included_duration_minutes: 1440,
      extra_day_price_minor: "150000",
      prep_minutes: 60,
      turnaround_minutes: 1440,
      status: "active" as const,
      assets: [
        {
          id: "00000000-0000-4000-8000-000000000013",
          branch_id: "00000000-0000-4000-8000-000000000014",
          variant_id: "00000000-0000-4000-8000-000000000012",
          asset_code: "AST-GWN-001-M-01",
          lifecycle_status: "active" as const,
          readiness: "needs_cleaning" as const,
          custody_kind: "at_branch" as const,
          condition_note: "Post-rental cleaning required",
          measurement_overrides: { waist: 71 },
          alteration_note: null,
          version: 2,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-20T00:00:00.000Z",
        },
      ],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-20T00:00:00.000Z",
    },
  ],
  upcoming_allocations: [
    {
      asset_id: "00000000-0000-4000-8000-000000000013",
      reservation_line_id: "00000000-0000-4000-8000-000000000015",
      kind: "reservation_confirmed" as const,
      starts_at: "2026-09-25T02:00:00.000Z",
      ends_at: "2026-09-27T02:00:00.000Z",
    },
  ],
  has_more_upcoming_allocations: false,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
};

describe("ClothingDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: detail,
      requestId: "req-detail",
    });
    api.archiveClothing.mockResolvedValue({
      data: {
        product_id: productId,
        status: "archived",
        archived_variant_count: 1,
        retired_asset_count: 0,
        pending_asset_resolution_count: 1,
        updated_at: "2026-09-21T00:00:00.000Z",
      },
      requestId: "req-archive",
    });
  });

  it("loads and renders the real clothing detail endpoint response", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Emerald Evening Gown" })).toBeVisible();
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(productId);
    expect(screen.getByRole("heading", { name: "Variants & Pricing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Serialized Pieces" })).toBeVisible();
    expect(screen.getByText("GWN-001-M")).toBeVisible();
    expect(screen.getByText("AST-GWN-001-M-01")).toBeVisible();
    expect(screen.getByText("Needs Cleaning")).toBeVisible();
    expect(screen.getByText("Confirmed reservation")).toBeVisible();
  });

  it.each([
    ["draft", "Draft"],
    ["active", "Active"],
    ["archived", "Archived"],
  ] as const)("renders the backend %s lifecycle as a %s status badge", async (status, label) => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: { ...detail, status },
      requestId: `req-detail-${status}`,
    });

    render(<ClothingDetailsPage productId={productId} />);

    const badge = await screen.findByLabelText(`Clothing lifecycle: ${label}`);
    expect(badge).toBeVisible();
    expect(badge).toHaveTextContent(label);
  });

  it("renders variants without a color as optional metadata", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{ ...detail.variants[0]!, color_label: null }],
      },
      requestId: "req-detail-no-color",
    });

    render(<ClothingDetailsPage productId={productId} />);

    const sku = await screen.findByText("GWN-001-M");
    const row = sku.closest("tr");
    if (!row) throw new Error("Expected variant to render in a table row.");
    expect(within(row).getByText("—")).toBeVisible();
  });

  it("surfaces CLT-031 readiness, custody, and blocking-allocation state", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Operational Status" })).toBeVisible();
    expect(screen.getByText("Needs Cleaning")).toBeVisible();
    expect(screen.getByText("At Branch")).toBeVisible();
    expect(screen.getByText("Confirmed reservation")).toBeVisible();
  });

  it("archives from detail using the backend updated_at token and then reloads authoritative detail", async () => {
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: detail, requestId: "req-detail-active" })
      .mockResolvedValueOnce({ data: { ...detail, status: "archived" as const }, requestId: "req-detail-archived" });

    render(<ClothingDetailsPage productId={productId} />);

    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive Clothing" }));

    await waitFor(() => expect(api.archiveClothing).toHaveBeenCalledTimes(1));
    expect(api.archiveClothing).toHaveBeenCalledWith(
      productId,
      { expected_updated_at: detail.updated_at },
      expect.any(String)
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clothing archived. 1 physical piece still requires operational resolution."
    );
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("shows a clean stale-version conflict instead of archiving outdated detail state", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.archiveClothing.mockRejectedValueOnce(
      new DrezivoApiError("This clothing changed since you opened it.", {
        code: "STALE_VERSION",
        status: 409,
      })
    );

    render(<ClothingDetailsPage productId={productId} />);
    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive Clothing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This clothing changed since you opened it. Refresh the latest version before archiving."
    );
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(1);
  });

  it("does not render the old fabricated rental or maintenance histories", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    expect(screen.queryByRole("heading", { name: "Rental History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Maintenance & Cleaning" })).not.toBeInTheDocument();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });
});

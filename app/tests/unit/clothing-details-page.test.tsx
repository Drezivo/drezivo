import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClothingDetailsPage } from "@/components/inventory/clothing-details-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
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
  });

  it("loads and renders the real clothing detail endpoint response", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Emerald Evening Gown" })).toBeVisible();
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(productId);
    expect(screen.getByText("GWN-001-M")).toBeVisible();
    expect(screen.getByText("AST-GWN-001-M-01")).toBeVisible();
    expect(screen.getByText("Needs Cleaning")).toBeVisible();
    expect(screen.getByText("Confirmed reservation")).toBeVisible();
  });

  it("does not render the old fabricated rental or maintenance histories", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    expect(screen.queryByRole("heading", { name: "Rental History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Maintenance & Cleaning" })).not.toBeInTheDocument();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });
});

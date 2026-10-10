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
  publishClothing: vi.fn(),
  restoreClothing: vi.fn(),
  updatePhysicalAssetState: vi.fn(),
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
  subcategory: "MINI",
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
      measurements: { bust: { type: "fit_note", text: "Flexible fit" }, waist: 72, length: 61, hips: 96 },
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
    api.publishClothing.mockResolvedValue({
      data: {
        product_id: productId,
        status: "active",
        activated_variant_count: 1,
        updated_at: "2026-09-21T00:01:00.000Z",
      },
      requestId: "req-publish",
    });
    api.restoreClothing.mockResolvedValue({
      data: {
        product_id: productId,
        status: "draft",
        restored_variant_count: 1,
        updated_at: "2026-09-22T00:00:00.000Z",
      },
      requestId: "req-restore",
    });
    api.updatePhysicalAssetState.mockResolvedValue({
      data: {
        asset: {
          ...detail.variants[0]!.assets[0]!,
          readiness: "ready",
          condition_note: "Cleaned, steamed, and ready for pickup.",
          version: 3,
          updated_at: "2026-09-25T03:00:00.000Z",
        },
        blocking_allocation_count: 1,
        disruptions_created: 0,
      },
      requestId: "req-asset-state",
    });
  });

  it("loads and renders the real clothing detail endpoint response", async () => {
    render(<ClothingDetailsPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Emerald Evening Gown" })).toBeVisible();
    expect(screen.getAllByText("MINI")).toHaveLength(2);
    for (const subcategoryLabel of screen.getAllByText("MINI")) {
      expect(subcategoryLabel).toBeVisible();
    }
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledWith(productId);
    expect(screen.getByRole("heading", { name: "Variants & Pricing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Serialized Pieces" })).toBeVisible();
    expect(screen.getByText("GWN-001-M")).toBeVisible();
    expect(screen.getByText("AST-GWN-001-M-01")).toBeVisible();
    expect(screen.getByText("Needs Cleaning")).toBeVisible();
    expect(screen.getByText("Confirmed reservation")).toBeVisible();
    expect(screen.getByText(/Bust: Flexible fit · Waist: 72 cm · Length: 61 cm · Hips \(legacy, read-only\): 96 cm/)).toBeVisible();
  });

  it("renders legacy fit ranges with a single Fits label", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{ ...detail.variants[0]!, fit_range: "Fits Small to Large" }],
      },
      requestId: "req-detail-legacy-fit-range",
    });

    render(<ClothingDetailsPage productId={productId} />);

    const fitRange = await screen.findByText(/Fits Small to Large/);
    expect(fitRange).toHaveTextContent(/^Fits Small to Large · Bust:/);
    expect(screen.queryByText(/Fits Fits Small to Large/)).not.toBeInTheDocument();
  });

  it("renders signed product images, switches gallery photos, and falls back when an image fails", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        images: [
          {
            file_id: "00000000-0000-4000-8000-000000000020",
            display_order: 0,
            image_url: "https://images.example.test/cover.webp",
          },
          {
            file_id: "00000000-0000-4000-8000-000000000021",
            display_order: 1,
            image_url: "https://images.example.test/secondary.webp",
          },
        ],
      },
      requestId: "req-detail-images",
    });

    render(<ClothingDetailsPage productId={productId} />);

    const primary = await screen.findByRole("img", {
      name: "Emerald Evening Gown catalogue photo",
    });
    expect(primary).toHaveAttribute("src", "https://images.example.test/cover.webp");
    expect(screen.getByLabelText("Catalogue photo gallery")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show catalogue photo 2" }));
    expect(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo" })).toHaveAttribute(
      "src",
      "https://images.example.test/secondary.webp"
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Emerald Evening Gown image preview" }));
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo 2" })).toHaveAttribute(
      "src",
      "https://images.example.test/secondary.webp"
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo 1" })).toHaveAttribute(
      "src",
      "https://images.example.test/cover.webp"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Show catalogue photo 2" }));

    fireEvent.error(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo" }));
    expect(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo" })).toHaveAttribute(
      "src",
      "https://images.example.test/cover.webp"
    );

    fireEvent.error(screen.getByRole("img", { name: "Emerald Evening Gown catalogue photo" }));
    expect(await screen.findByText("No catalogue photo available")).toBeVisible();
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

  it("publishes a persisted draft with the current concurrency token and reloads active detail", async () => {
    const draft = { ...detail, status: "draft" as const };
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: draft, requestId: "req-draft" })
      .mockResolvedValueOnce({ data: detail, requestId: "req-active" });

    render(<ClothingDetailsPage productId={productId} />);

    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    fireEvent.click(screen.getByRole("button", { name: "Publish Clothing" }));

    await waitFor(() => expect(api.publishClothing).toHaveBeenCalledTimes(1));
    expect(api.publishClothing).toHaveBeenCalledWith(
      productId,
      { expected_updated_at: detail.updated_at },
      expect.any(String)
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Clothing published");
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Publish Clothing" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Clothing lifecycle: Active")).toBeVisible();
  });

  it("keeps an incomplete draft on screen and shows the publish validation error", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: { ...detail, status: "draft" as const },
      requestId: "req-draft-invalid",
    });
    api.publishClothing.mockRejectedValueOnce(
      new DrezivoApiError("Add at least one accepted clothing photo before publishing.", {
        code: "STATE_CONFLICT",
        status: 409,
      })
    );

    render(<ClothingDetailsPage productId={productId} />);
    await screen.findByRole("button", { name: "Publish Clothing" });
    fireEvent.click(screen.getByRole("button", { name: "Publish Clothing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add at least one accepted clothing photo before publishing."
    );
    expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Publish Clothing" })).toBeVisible();
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

  it("lets staff update the readiness of a serialized physical piece and reloads authoritative detail", async () => {
    const updatedAsset = {
      ...detail.variants[0]!.assets[0]!,
      readiness: "ready" as const,
      condition_note: "Cleaned, steamed, and ready for pickup.",
      version: 3,
      updated_at: "2026-09-25T03:00:00.000Z",
    };
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: detail, requestId: "req-detail-before-readiness" })
      .mockResolvedValueOnce({
        data: {
          ...detail,
          variants: [
            {
              ...detail.variants[0]!,
              assets: [updatedAsset],
            },
          ],
        },
        requestId: "req-detail-after-readiness",
      });
    api.updatePhysicalAssetState.mockResolvedValueOnce({
      data: {
        asset: updatedAsset,
        blocking_allocation_count: 1,
        disruptions_created: 0,
      },
      requestId: "req-update-readiness",
    });

    render(<ClothingDetailsPage productId={productId} />);
    await screen.findByText("AST-GWN-001-M-01");

    fireEvent.click(screen.getByRole("button", { name: "Manage AST-GWN-001-M-01" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage physical piece" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Readiness" }), {
      target: { value: "ready" },
    });
    fireEvent.change(within(dialog).getByLabelText("Condition note"), {
      target: { value: "Cleaned, steamed, and ready for pickup." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updatePhysicalAssetState).toHaveBeenCalledTimes(1));
    expect(api.updatePhysicalAssetState).toHaveBeenCalledWith(
      detail.variants[0]!.assets[0]!.id,
      {
        expected_version: 2,
        readiness: "ready",
        condition_note: "Cleaned, steamed, and ready for pickup.",
      },
      expect.any(String)
    );
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("AST-GWN-001-M-01 is now Ready.");
    for (const readyLabel of screen.getAllByText("Ready")) {
      expect(readyLabel).toBeVisible();
    }
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

  it("restores archived clothing to draft from detail and reloads authoritative state", async () => {
    const archived = { ...detail, status: "archived" as const };
    const restored = { ...detail, status: "draft" as const };
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: archived, requestId: "req-detail-archived" })
      .mockResolvedValueOnce({ data: restored, requestId: "req-detail-restored" });

    render(<ClothingDetailsPage productId={productId} />);

    await screen.findByRole("heading", { name: "Emerald Evening Gown" });
    fireEvent.click(screen.getByRole("button", { name: "Restore to Draft" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore to Draft" }));

    await waitFor(() => expect(api.restoreClothing).toHaveBeenCalledTimes(1));
    expect(api.restoreClothing).toHaveBeenCalledWith(
      productId,
      { expected_updated_at: detail.updated_at },
      expect.any(String)
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clothing restored to Draft. Review the clothing and publish it when ready."
    );
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Clothing lifecycle: Draft")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish Clothing" })).toBeVisible();
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

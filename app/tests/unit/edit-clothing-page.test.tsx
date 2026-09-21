import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditClothingPage } from "@/components/inventory/edit-clothing-page";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const api = vi.hoisted(() => ({
  archiveClothing: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  getCatalogueCategories: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getDefaultMeasurementGuide: vi.fn(),
  replaceClothingImages: vi.fn(),
  updateClothingProduct: vi.fn(),
  updateClothingVariant: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
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

const productId = "00000000-0000-4000-8000-000000000050";
const categoryId = "00000000-0000-4000-8000-000000000051";
const variantId = "00000000-0000-4000-8000-000000000052";
const assetId = "00000000-0000-4000-8000-000000000053";
const fileId = "00000000-0000-4000-8000-000000000054";
const productUpdatedAt = "2026-09-21T08:00:00.000Z";
const variantUpdatedAt = "2026-09-21T08:01:00.000Z";

const detail = {
  product_id: productId,
  code: "GWN-023",
  name: "Emerald Evening Gown",
  description: "Floor-length formal gown with fitted bodice.",
  category: { id: categoryId, name: "Gowns" },
  status: "active" as const,
  images: [
    {
      file_id: fileId,
      display_order: 0,
      image_url: "https://images.example.test/emerald-cover.webp",
    },
  ],
  variants: [
    {
      id: variantId,
      sku: "GWN-023-M",
      size_label: "M",
      color_label: "Emerald Green",
      measurement_mode: "custom" as const,
      measurement_guide_id: null,
      measurement_unit: "cm" as const,
      measurements: { bust: 90, waist: 72, hips: 96 },
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
          id: assetId,
          branch_id: "00000000-0000-4000-8000-000000000055",
          variant_id: variantId,
          asset_code: "AST-GWN-023-M-01",
          lifecycle_status: "active" as const,
          readiness: "ready" as const,
          custody_kind: "at_branch" as const,
          condition_note: null,
          measurement_overrides: null,
          alteration_note: null,
          version: 1,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-21T08:01:00.000Z",
        },
      ],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: variantUpdatedAt,
    },
  ],
  upcoming_allocations: [],
  has_more_upcoming_allocations: false,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: productUpdatedAt,
};

describe("EditClothingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getCatalogueClothingDetail.mockResolvedValue({ data: detail, requestId: "req-detail" });
    api.getCatalogueCategories.mockResolvedValue({
      data: {
        items: [{ id: categoryId, name: "Gowns", status: "active", display_order: 10 }],
      },
      requestId: "req-categories",
    });
    api.getDefaultMeasurementGuide.mockResolvedValue({ data: { guide: null }, requestId: "req-guide" });
    api.archiveClothing.mockResolvedValue({
      data: {
        product_id: productId,
        status: "archived",
        archived_variant_count: 1,
        retired_asset_count: 1,
        pending_asset_resolution_count: 0,
        updated_at: "2026-09-21T10:00:00.000Z",
      },
      requestId: "req-archive",
    });
    api.updateClothingProduct.mockResolvedValue({
      data: {
        product_id: productId,
        name: detail.name,
        description: detail.description,
        category: detail.category,
        status: "active",
        updated_at: "2026-09-21T09:00:00.000Z",
      },
      requestId: "req-product-update",
    });
    api.updateClothingVariant.mockResolvedValue({
      data: {
        variant_id: variantId,
        product_id: productId,
        size_label: "M",
        color_label: "Emerald Green",
        measurement_mode: "custom",
        measurement_guide_id: null,
        measurement_unit: "cm",
        measurements: { bust: 90, waist: 72, hips: 96 },
        rental_price_minor: "150000",
        security_deposit_minor: "50000",
        currency: "PHP",
        pricing_mode: "daily",
        included_duration_minutes: 1440,
        extra_day_price_minor: "150000",
        prep_minutes: 60,
        turnaround_minutes: 1440,
        status: "active",
        updated_at: "2026-09-21T09:01:00.000Z",
      },
      requestId: "req-variant-update",
    });
    api.replaceClothingImages.mockResolvedValue({
      data: {
        images: detail.images,
        cover_file_id: fileId,
      },
      requestId: "req-images",
    });
  });

  it("prefills the edit form from the authoritative clothing detail response", async () => {
    render(<EditClothingPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Edit Clothing" })).toBeVisible();
    expect(screen.getByLabelText("Clothing Name")).toHaveValue("Emerald Evening Gown");
    expect(screen.getByLabelText("Clothing Code")).toHaveValue("GWN-023");
    expect(screen.getByLabelText("Description")).toHaveValue(detail.description);
    expect(screen.getByLabelText("GWN-023-M Size Label")).toHaveValue("M");
    expect(screen.getByLabelText("GWN-023-M Color")).toHaveValue("Emerald Green");
    expect(screen.getByLabelText("GWN-023-M bust")).toHaveValue("90");
    expect(screen.getByLabelText("Daily Rate")).toHaveValue("1500");
    expect(screen.getByRole("img", { name: "Current cover photo" })).toHaveAttribute(
      "src",
      detail.images[0]!.image_url
    );
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("saves changed product and variant fields with backend concurrency tokens and one intent family", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    fireEvent.change(screen.getByLabelText("Clothing Name"), {
      target: { value: "Emerald Gala Gown" },
    });
    fireEvent.change(screen.getByLabelText("GWN-023-M Color"), {
      target: { value: "Forest Emerald" },
    });
    fireEvent.change(screen.getByLabelText("Daily Rate"), {
      target: { value: "1750" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateClothingProduct).toHaveBeenCalledTimes(1));
    expect(api.updateClothingProduct).toHaveBeenCalledWith(
      productId,
      {
        expected_updated_at: productUpdatedAt,
        name: "Emerald Gala Gown",
      },
      expect.stringMatching(/-product$/)
    );

    await waitFor(() => expect(api.updateClothingVariant).toHaveBeenCalledTimes(1));
    const variantCall = api.updateClothingVariant.mock.calls[0]!;
    expect(variantCall[0]).toBe(productId);
    expect(variantCall[1]).toBe(variantId);
    expect(variantCall[2]).toMatchObject({
      expected_updated_at: variantUpdatedAt,
      color_label: "Forest Emerald",
      pricing: {
        mode: "daily",
        rental_price_minor: "175000",
        security_deposit_minor: "50000",
        prep_minutes: 60,
        turnaround_minutes: 1440,
      },
    });
    const productKey = api.updateClothingProduct.mock.calls[0]![2] as string;
    const variantKey = variantCall[3] as string;
    expect(productKey.replace(/-product$/, "")).toBe(variantKey.replace(/-variant-1$/, ""));

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(`/inventory/${productId}`)
    );
    expect(sessionStorage.getItem("drezivo:clothing-detail-notice")).toBe("Changes saved");
  });

  it("guards a rapid double submit so one save intent produces one product mutation", async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined;
    api.updateClothingProduct.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    fireEvent.change(screen.getByLabelText("Clothing Name"), {
      target: { value: "One Intent Gown" },
    });

    const save = screen.getByRole("button", { name: "Save Changes" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(api.updateClothingProduct).toHaveBeenCalledTimes(1));
    expect(api.updateClothingVariant).not.toHaveBeenCalled();

    resolveUpdate({
      data: {
        product_id: productId,
        name: "One Intent Gown",
        description: detail.description,
        category: detail.category,
        status: "active",
        updated_at: "2026-09-21T09:00:00.000Z",
      },
      requestId: "req-product-update",
    });

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(`/inventory/${productId}`)
    );
  });

  it("archives a clean edit page with the loaded product concurrency token", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    fireEvent.click(screen.getByRole("button", { name: "Archive Clothing" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive Clothing" }));

    await waitFor(() => expect(api.archiveClothing).toHaveBeenCalledTimes(1));
    expect(api.archiveClothing).toHaveBeenCalledWith(
      productId,
      { expected_updated_at: productUpdatedAt },
      expect.any(String)
    );
    expect(sessionStorage.getItem("drezivo:clothing-detail-notice")).toBe("Clothing archived.");
    expect(navigation.replace).toHaveBeenCalledWith(`/inventory/${productId}`);
  });

  it("disables archive while there are unsaved edits", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    fireEvent.change(screen.getByLabelText("Clothing Name"), {
      target: { value: "Unsaved Emerald Gown" },
    });

    expect(screen.getByRole("button", { name: "Archive Clothing" })).toBeDisabled();
    expect(screen.getByText("Save or discard your edits before archiving this clothing.")).toBeVisible();
  });

  it("keeps archived clothing historical and does not expose an edit form", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: { ...detail, status: "archived" as const },
      requestId: "req-archived",
    });

    render(<EditClothingPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "This clothing is archived" })).toBeVisible();
    expect(screen.queryByLabelText("Clothing Name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View clothing details" })).toHaveAttribute(
      "href",
      `/inventory/${productId}`
    );
  });
});

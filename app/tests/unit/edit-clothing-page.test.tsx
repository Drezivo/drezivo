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
  createClothingVariant: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  getCatalogueCategories: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getDefaultMeasurementGuide: vi.fn(),
  removeClothingVariant: vi.fn(),
  replaceClothingImages: vi.fn(),
  updateClothingProduct: vi.fn(),
  updateClothingVariant: vi.fn(),
  changeClothingSizingMode: vi.fn(),
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
  subcategory: "Tea Length",
  category: { id: categoryId, name: "Gowns" },
  status: "active" as const,
  sizing_mode: "sized" as const,
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
      measurements: { bust: 90, waist: 72, length: 60, hips: 96 },
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
    api.createClothingVariant.mockResolvedValue({
      data: {
        variant: {
          ...detail.variants[0]!,
          id: "00000000-0000-4000-8000-000000000099",
          sku: "SKU-NEW-XL",
          size_label: "XL",
          color_label: "Emerald Green",
          status: "active",
          assets: [
            {
              id: "00000000-0000-4000-8000-000000000199",
              branch_id: "00000000-0000-4000-8000-000000000120",
              asset_code: "AST-NEW-XL",
              lifecycle_status: "active",
              readiness: "ready",
              custody_kind: "at_branch",
              condition_note: null,
              measurement_overrides: null,
              alteration_note: null,
              version: 1,
              created_at: "2026-09-23T05:00:00.000Z",
              updated_at: "2026-09-23T05:00:00.000Z",
            },
          ],
          created_at: "2026-09-23T05:00:00.000Z",
          updated_at: "2026-09-23T05:00:00.000Z",
        },
      },
      requestId: "req-create-variant",
    });
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
    api.removeClothingVariant.mockResolvedValue({
      data: {
        variant_id: variantId,
        product_id: productId,
        status: "archived",
        outcome: "updated",
        updated_at: "2026-09-21T09:03:00.000Z",
      },
      requestId: "req-variant-remove",
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
        measurements: { bust: 90, waist: 72, length: 60, hips: 96 },
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
    api.changeClothingSizingMode.mockResolvedValue({
      data: {
        product_id: productId,
        sizing_mode: "free_size",
        active_variant_count: 1,
        archived_variant_count: 1,
        free_size_variant_id: "00000000-0000-4000-8000-000000000099",
      },
      requestId: "req-sizing-mode",
    });
  });

  it("prefills the edit form from the authoritative clothing detail response", async () => {
    render(<EditClothingPage productId={productId} />);

    expect(await screen.findByRole("heading", { name: "Edit Clothing" })).toBeVisible();
    expect(screen.getByLabelText("Clothing Name")).toHaveValue("Emerald Evening Gown");
    expect(screen.getByLabelText("Clothing Code")).toHaveValue("GWN-023");
    expect(screen.getByLabelText("Description")).toHaveValue(detail.description);
    expect(screen.getByLabelText("Subcategory")).toHaveValue("custom");
    expect(screen.getByLabelText("Custom subcategory")).toHaveValue("Tea Length");
    expect(screen.getByLabelText("GWN-023-M Size Label")).toHaveValue("M");
    expect(screen.getByLabelText("GWN-023-M Color")).toHaveValue("Emerald Green");
    expect(screen.getByLabelText("GWN-023-M bust")).toHaveValue("90");
    expect(screen.getByLabelText("GWN-023-M length")).toHaveValue("60");
    expect(screen.getByText(/Legacy Hips \(read-only\)/)).toBeVisible();
    expect(screen.queryByLabelText("GWN-023-M hips")).not.toBeInTheDocument();
    const measurementSource = screen.getByText("Measurement Source", { exact: true });
    const measurementGrid = measurementSource.parentElement;
    expect(measurementGrid).toHaveClass("lg:grid-cols-[14rem_repeat(var(--measurement-count),minmax(0,1fr))]");
    expect(measurementGrid).toHaveClass("gap-y-1");
    expect(measurementGrid).toHaveClass("lg:items-end");
    expect(measurementGrid).toContainElement(screen.getByRole("button", { name: "Measurement Source" }));
    for (const field of ["bust", "waist", "length"]) {
      const labels = measurementGrid?.querySelectorAll(`label[for="${variantId}-${field}-measurement"]`);
      expect(labels).toHaveLength(2);
    }
    expect(screen.queryByText("Custom measurements", { selector: "span", exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Daily Rate")).toHaveValue("1500");
    expect(screen.getByRole("img", { name: "Current cover photo" })).toHaveAttribute(
      "src",
      detail.images[0]!.image_url
    );
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Clothing" })).toHaveAttribute("href", "/inventory");
    expect(within(breadcrumb).getByText("Edit Emerald Evening Gown")).toHaveAttribute("aria-current", "page");
  });

  it("keeps legacy Hips read-only when a variant uses a reusable guide", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{
          ...detail.variants[0]!,
          measurement_mode: "default_guide",
          measurement_guide_id: "00000000-0000-4000-8000-000000000098",
        }],
      },
      requestId: "req-guide-with-legacy-hips",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    expect(screen.getByText(/Legacy Hips \(read-only\)/)).toBeVisible();
    expect(screen.queryByLabelText("GWN-023-M hips")).not.toBeInTheDocument();
  });

  it("edits Length while sending legacy Hips through unchanged", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    fireEvent.change(screen.getByLabelText("GWN-023-M length"), { target: { value: "61" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateClothingVariant).toHaveBeenCalledTimes(1));
    expect(api.updateClothingVariant.mock.calls[0]?.[2]).toMatchObject({
      expected_updated_at: variantUpdatedAt,
      measurement: {
        measurement_mode: "custom",
        measurement_unit: "cm",
        measurements: { bust: 90, waist: 72, length: 61, hips: 96 },
      },
    });
  });

  it("displays a legacy range cleanly and canonicalizes edited flexible-fit values", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        sizing_mode: "free_size",
        variants: [{
          ...detail.variants[0]!,
          sku: "GWN-023-FS",
          size_label: null,
          fit_range: "Fits Small to Large",
        }],
      },
      requestId: "req-free-size-legacy-range",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    const fitRange = screen.getByLabelText("GWN-023-FS Fits sizes");
    expect(fitRange).toHaveValue("Small to Large");
    fireEvent.change(fitRange, { target: { value: "Fits Medium to XL" } });
    fireEvent.blur(fitRange);
    expect(fitRange).toHaveValue("Medium to XL");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateClothingVariant).toHaveBeenCalledTimes(1));
    expect(api.updateClothingVariant.mock.calls[0]?.[2]).toMatchObject({ fit_range: "Medium to XL" });
  });

  it("clears an existing subcategory when None is selected", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    fireEvent.change(screen.getByLabelText("Subcategory"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateClothingProduct).toHaveBeenCalledTimes(1));
    expect(api.updateClothingProduct.mock.calls[0]?.[1]).toEqual({
      expected_updated_at: productUpdatedAt,
      subcategory: null,
    });
  });

  it("migrates a sized clothing item to flexible fit without changing legacy Hips", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    expect(screen.getByText("Multiple labeled sizes", { selector: "span" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change sizing mode" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Flexible fit uses one variant without a size label/i)).toBeVisible();
    expect(within(dialog).getByLabelText("Sizing transition fit range")).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText("Sizing transition fit range"), {
      target: { value: "Fits Small to Large" },
    });
    expect(within(dialog).queryByLabelText("Sizing transition 1 bust type")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Legacy Hips \(read-only\)/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Change sizing mode" }));

    await waitFor(() => expect(api.changeClothingSizingMode).toHaveBeenCalledTimes(1));
    expect(api.changeClothingSizingMode).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({
        mode: "free_size",
        variant: expect.objectContaining({
          size_label: null,
          fit_range: "Small to Large",
          color_label: "Emerald Green",
          measurement_mode: "custom",
          measurements: { bust: 90, waist: 72, length: 60, hips: 96 },
        }),
      }),
      expect.any(String)
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sizing mode changed to one flexible-fit variant (1 active variant; 1 archived)."));
  });

  it("can migrate a Free size clothing item back to a labelled size", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        sizing_mode: "free_size",
        variants: [{ ...detail.variants[0]!, sku: "GWN-023-FS", size_label: null }],
      },
      requestId: "req-free-size-detail",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    fireEvent.click(screen.getByRole("button", { name: "Change sizing mode" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Sizing transition size 1")).toHaveValue("S");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change sizing mode" }));

    await waitFor(() => expect(api.changeClothingSizingMode).toHaveBeenCalledTimes(1));
    expect(api.changeClothingSizingMode).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({
        mode: "sized",
        variants: [expect.objectContaining({ size_label: "S" })],
      }),
      expect.any(String)
    );
  });

  it("requires saved edits before changing sizing mode and blocks adding variants in Free size mode", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        sizing_mode: "free_size",
        variants: [{ ...detail.variants[0]!, sku: "GWN-023-FS", size_label: null }],
      },
      requestId: "req-free-size-detail",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    expect(screen.getByRole("button", { name: "Add Variant" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Clothing Name"), { target: { value: "Unsaved Cape" } });
    expect(screen.getByRole("button", { name: "Change sizing mode" })).toBeDisabled();
  });

  it("adds a new active variant without draft/publish controls and stays on the edit page", async () => {
    const createdVariant = {
      ...detail.variants[0]!,
      id: "00000000-0000-4000-8000-000000000099",
      sku: "SKU-NEW-XL",
      size_label: "XL",
      color_label: "Emerald Green",
      status: "active" as const,
      assets: [],
      created_at: "2026-09-23T05:00:00.000Z",
      updated_at: "2026-09-23T05:00:00.000Z",
    };
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: detail, requestId: "req-before-add-variant" })
      .mockResolvedValue({
        data: { ...detail, variants: [...detail.variants, createdVariant] },
        requestId: "req-after-add-variant",
      });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    fireEvent.click(screen.getByRole("button", { name: "Add Variant" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/draft/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    fireEvent.pointerDown(within(dialog).getByRole("button", { name: "Measurement Source" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Custom measurements" }));
    fireEvent.change(within(dialog).getByLabelText("New Variant Size Label"), { target: { value: "XL" } });
    fireEvent.change(within(dialog).getByLabelText("New Variant Color"), { target: { value: "Emerald Green" } });
    fireEvent.change(within(dialog).getByLabelText("New Variant bust"), { target: { value: "Flexible fit" } });
    fireEvent.change(within(dialog).getByLabelText("New Variant length"), { target: { value: "61" } });
    expect(within(dialog).queryByLabelText("New Variant bust type")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("New Variant hips")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Package Price"), { target: { value: "1800" } });
    fireEvent.change(within(dialog).getByLabelText("Security Deposit"), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByLabelText("Extra Day Price"), { target: { value: "600" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Variant" }));

    await waitFor(() => expect(api.createClothingVariant).toHaveBeenCalledTimes(1));
    expect(api.createClothingVariant).toHaveBeenCalledWith(
      productId,
      {
        size_label: "XL",
        fit_range: null,
        color_label: "Emerald Green",
        measurement_mode: "custom",
        measurement_guide_id: null,
        measurement_unit: "cm",
        measurements: { bust: { type: "fit_note", text: "Flexible fit" }, length: 61 },
        pricing: {
          mode: "fixed_duration",
          rental_price_minor: "180000",
          security_deposit_minor: "50000",
          included_days: 3,
          extra_day_price_minor: "60000",
          prep_minutes: 0,
          turnaround_minutes: 1440,
        },
      },
      expect.any(String)
    );
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Variant added")).toBeVisible();
    expect(screen.getByText("XL · SKU-NEW-XL")).toBeVisible();
    expect(navigation.replace).not.toHaveBeenCalled();
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
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
    });
    const productKey = api.updateClothingProduct.mock.calls[0]![2] as string;
    const variantKey = variantCall[3] as string;
    expect(productKey.replace(/-product$/, "")).toBe(variantKey.replace(/-variant-1$/, ""));

    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Changes saved");
    expect(screen.getByRole("heading", { name: "Edit Clothing" })).toBeVisible();
  });

  it("preserves an untouched fit note when another variant field changes", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{
          ...detail.variants[0]!,
          measurements: { bust: { type: "fit_note", text: "Flexible fit" }, waist: 72, length: 60, hips: 96 },
        }],
      },
      requestId: "req-fit-note-detail",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    expect(screen.getByLabelText("GWN-023-M bust")).toHaveValue("Flexible fit");
    expect(screen.queryByLabelText("GWN-023-M bust type")).not.toBeInTheDocument();
    const waistInput = screen.getByLabelText("GWN-023-M waist");
    expect(waistInput).toHaveValue("72");
    expect(waistInput.parentElement).toHaveTextContent("cm");
    expect(screen.getByLabelText("GWN-023-M bust").parentElement).not.toHaveTextContent("cm");
    fireEvent.change(screen.getByLabelText("GWN-023-M Color"), { target: { value: "Forest Green" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateClothingVariant).toHaveBeenCalledTimes(1));
    expect(api.updateClothingVariant.mock.calls[0]?.[2]).not.toHaveProperty("measurement");
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

    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Changes saved");
  });

  it("does not expose draft/publish/archive lifecycle controls for variants", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{ ...detail.variants[0]!, status: "draft" as const }],
      },
      requestId: "req-draft-variant",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    expect(screen.getByLabelText("GWN-023-M Size Label")).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove GWN-023-M" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Publish GWN-023-M" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive GWN-023-M" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore GWN-023-M" })).not.toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("keeps safe removal as the only variant-level destructive action", async () => {
    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    expect(screen.queryByRole("button", { name: "Archive GWN-023-M" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove GWN-023-M" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/removes the variant from normal clothing management/i)).toBeVisible();
    expect(within(dialog).getByText(/keeps that historical data intact/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Variant" }));

    await waitFor(() => expect(api.removeClothingVariant).toHaveBeenCalledTimes(1));
    expect(api.removeClothingVariant).toHaveBeenCalledWith(
      productId,
      variantId,
      { expected_updated_at: variantUpdatedAt },
      expect.any(String)
    );
    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
  });

  it("moves a referenced removed variant out of the normal editor after authoritative reload", async () => {
    const archivedVariant = { ...detail.variants[0]!, status: "archived" as const };
    api.getCatalogueClothingDetail
      .mockResolvedValueOnce({ data: detail, requestId: "req-before-remove" })
      .mockResolvedValue({
        data: { ...detail, variants: [archivedVariant] },
        requestId: "req-after-remove",
      });
    api.removeClothingVariant.mockResolvedValueOnce({
      data: {
        variant_id: variantId,
        product_id: productId,
        status: "archived",
        outcome: "updated",
        updated_at: "2026-09-21T09:03:00.000Z",
      },
      requestId: "req-remove-archive-fallback",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });
    expect(screen.getByLabelText("GWN-023-M Size Label")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove GWN-023-M" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove Variant" }));

    await waitFor(() => expect(api.getCatalogueClothingDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("GWN-023-M Size Label")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Variant removed. Existing physical-piece and rental history was preserved."
    );
    expect(screen.queryByText(/Archived variants/i)).not.toBeInTheDocument();
  });

  it("keeps internally archived variants out of normal O/S variant management", async () => {
    api.getCatalogueClothingDetail.mockResolvedValueOnce({
      data: {
        ...detail,
        variants: [{ ...detail.variants[0]!, status: "archived" as const }],
      },
      requestId: "req-archived-variant",
    });

    render(<EditClothingPage productId={productId} />);
    await screen.findByRole("heading", { name: "Edit Clothing" });

    expect(screen.queryByLabelText("GWN-023-M Size Label")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore GWN-023-M" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived variants/i)).not.toBeInTheDocument();
    expect(screen.getByText("No variants remain. Add a variant to continue setting up this clothing.")).toBeVisible();
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

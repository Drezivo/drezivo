import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddClothingPage } from "@/components/inventory/add-clothing-page";
import { MeasurementGuideProvider } from "@/components/settings/measurement-guide-context";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  authorizeUpload: vi.fn(),
  createClothing: vi.fn(),
  finalizeUpload: vi.fn(),
  getCatalogueCategories: vi.fn(),
  getDefaultMeasurementGuide: vi.fn(),
  saveMeasurementGuide: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
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

function renderPage() {
  return render(
    <MeasurementGuideProvider>
      <AddClothingPage />
    </MeasurementGuideProvider>
  );
}

describe("AddClothingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
    });
    api.getDefaultMeasurementGuide.mockResolvedValue({
      data: {
        guide: {
          id: "00000000-0000-4000-8000-000000000099",
          file_id: "00000000-0000-4000-8000-000000000098",
          name: "Default Size Guide",
          image_url: "https://images.example.test/default-size-guide.png",
          status: "active",
          is_default: true,
          created_at: "2026-09-21T00:00:00.000Z",
          updated_at: "2026-09-21T00:00:00.000Z",
        },
      },
      requestId: "req-guide",
    });
    api.saveMeasurementGuide.mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000097",
        file_id: "00000000-0000-4000-8000-000000000096",
        name: "Luna Standard Size Guide",
        status: "active",
        is_default: true,
        created_at: "2026-09-21T01:45:00.000Z",
        updated_at: "2026-09-21T01:45:00.000Z",
      },
      requestId: "req-save-guide",
    });
    api.createClothing.mockResolvedValue({
      data: {
        product_id: "00000000-0000-4000-8000-000000000050",
        code: "GOWN-001",
        variant_count: 4,
        physical_piece_count: 4,
        status: "active",
      },
      requestId: "req-create",
    });
    api.getCatalogueCategories.mockResolvedValue({
      data: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Gowns",
            status: "active",
            display_order: 10,
          },
        ],
      },
      requestId: "req-categories",
    });
  });

  it("shows an optional clothing code field", () => {
    renderPage();

    expect(screen.getByLabelText("Clothing Code")).toBeVisible();
    expect(screen.getByText(/Leave blank and Drezivo will generate one for you/)).toBeVisible();
  });

  it("uses selected sizes to generate one piece per size", () => {
    renderPage();

    expect(screen.getByText(/4 selected · 4 Total Pieces/)).toBeVisible();
    const selectedSizes = screen.getByText("Selected sizes").parentElement;
    if (!selectedSizes) throw new Error("Expected selected-size summary.");
    expect(within(selectedSizes).getByText("S")).toBeVisible();
    expect(within(selectedSizes).getByText("XL")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "XL" }));

    expect(screen.getByText(/3 selected · 3 Total Pieces/)).toBeVisible();
    expect(within(selectedSizes).queryByText("XL")).not.toBeInTheDocument();
  });

  it("uses the default guide until a size opts into custom measurements", async () => {
    renderPage();

    expect(screen.queryByLabelText("S bust")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Default guide" })).toHaveLength(4);

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Default guide" })[0]!, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Custom measurements" }));

    expect(screen.getByLabelText("S bust")).toBeVisible();
    expect(screen.queryByLabelText("M bust")).not.toBeInTheDocument();
  });

  it("opens the shared default measurement guide without duplicating it per size", async () => {
    renderPage();

    expect(await screen.findByText("Default Size Guide")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View Measurement" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("img", { name: "Default Size Guide preview" })).toHaveAttribute(
      "src",
      "https://images.example.test/default-size-guide.png"
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Default Size Guide image preview" }));
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Default Size Guide full-size preview" })).toHaveAttribute(
      "src",
      "https://images.example.test/default-size-guide.png"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    expect(screen.queryByText("Default measurement image preview")).not.toBeInTheDocument();
  });

  it("lets a first-time user create and immediately use a persisted default size guide", async () => {
    api.getDefaultMeasurementGuide
      .mockResolvedValueOnce({
        data: { guide: null },
        requestId: "req-no-guide",
      })
      .mockResolvedValueOnce({
        data: {
          guide: {
            id: "00000000-0000-4000-8000-000000000097",
            file_id: "00000000-0000-4000-8000-000000000096",
            name: "Luna Standard Size Guide",
            image_url: "https://images.example.test/luna-size-guide.png",
            status: "active",
            is_default: true,
            created_at: "2026-09-21T01:45:00.000Z",
            updated_at: "2026-09-21T01:45:00.000Z",
          },
        },
        requestId: "req-saved-guide",
      });

    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000777",
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:guide.png"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    if (!("arrayBuffer" in File.prototype)) {
      Object.defineProperty(File.prototype, "arrayBuffer", {
        configurable: true,
        value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      });
    }

    api.authorizeUpload.mockResolvedValue({
      data: {
        file_id: "00000000-0000-4000-8000-000000000096",
        upload_url: "https://uploads.example/guide",
        upload_method: "PUT",
        required_headers: {
          "Content-Type": "image/png",
          "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
        expires_at: "2026-09-21T02:00:00.000Z",
      },
      requestId: "req-authorize-guide",
    });
    api.finalizeUpload.mockResolvedValue({
      data: {
        file: {
          file_id: "00000000-0000-4000-8000-000000000096",
          purpose: "measurement_guide",
          lifecycle_status: "accepted",
          content_type: "image/png",
          byte_size: 3,
          sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          frozen_at: "2026-09-21T01:45:00.000Z",
        },
      },
      requestId: "req-finalize-guide",
    });

    renderPage();

    expect(await screen.findByText("No default measurement guide")).toBeVisible();
    expect(screen.queryByText("Change Default")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add Default Size Guide" })[0]!);

    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Guide Name"), {
      target: { value: "Luna Standard Size Guide" },
    });
    const guideFile = new File([new Uint8Array([1, 2, 3])], "guide.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Default size guide image"), {
      target: { files: [guideFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Default Size Guide" }));

    await waitFor(() => expect(api.authorizeUpload).toHaveBeenCalledTimes(1));
    expect(api.authorizeUpload.mock.calls[0]?.[0]).toMatchObject({
      purpose: "measurement_guide",
      content_type: "image/png",
      byte_size: 3,
    });
    await waitFor(() => expect(api.finalizeUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.saveMeasurementGuide).toHaveBeenCalledTimes(1));
    expect(api.saveMeasurementGuide.mock.calls[0]?.[0]).toEqual({
      name: "Luna Standard Size Guide",
      file_id: "00000000-0000-4000-8000-000000000096",
      make_default: true,
    });

    expect(await screen.findByText("Luna Standard Size Guide")).toBeVisible();
    expect(screen.getByRole("button", { name: "Use default for all" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Add Default Size Guide" })).not.toBeInTheDocument();
  });

  it("uses one whole-day recovery setting after return", async () => {
    renderPage();
    await screen.findByText("Default Size Guide");

    expect(screen.getByText("1 day recovery after return")).toBeVisible();
    expect(screen.getByRole("button", { name: /Rental Timing/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByLabelText("Prep Days Before Rental")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Recovery Days After Return")).toHaveValue("1");
  });

  it("switches pricing between fixed package and daily pricing", () => {
    renderPage();

    expect(screen.getByLabelText("Included Duration")).toBeVisible();
    expect(screen.getByText("₱300 for 3 days · ₱100/additional day")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Per Day/ }));

    expect(screen.queryByLabelText("Included Duration")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Daily Rate")).toBeVisible();
    expect(screen.getByText("₱300 / day")).toBeVisible();
  });

  it("requires a photo to activate clothing while still allowing an image-less draft", async () => {
    renderPage();
    await screen.findByText("Default Size Guide");

    expect(screen.getByRole("button", { name: "Add Clothing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save as Draft" })).toBeEnabled();
    expect(
      screen.getByText("Add at least 1 photo to activate this clothing. You can still save it as a draft.")
    ).toBeVisible();
  });

  it("guards internal navigation with a Drezivo discard dialog once the form is dirty", async () => {
    renderPage();
    await screen.findByText("Default Size Guide");

    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Unsaved Gown" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Clothing" }));

    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByText("Discard unsaved changes?")).toBeVisible();
    expect(
      screen.getByText("You have changes that haven't been saved as a draft. Leaving this page will discard them.")
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Stay on page" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(navigation.replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "Clothing" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(navigation.replace).toHaveBeenCalledWith("/inventory");
  });

  it("uses the native beforeunload guard for reload or tab close when dirty", async () => {
    renderPage();
    await screen.findByText("Default Size Guide");

    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Unsaved Gown" },
    });

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(false);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it("guards browser Back with the same discard dialog", async () => {
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    renderPage();
    await screen.findByText("Default Size Guide");

    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Unsaved Gown" },
    });
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(historyBack).toHaveBeenCalledTimes(1);
    historyBack.mockRestore();
  });

  it("submits real draft variants with stable default-guide references and custom measurements", async () => {
    renderPage();
    expect(await screen.findByText("Default Size Guide")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Emerald Evening Gown" },
    });
    fireEvent.change(screen.getByLabelText("Clothing Code"), {
      target: { value: "GOWN-001" },
    });
    expect(screen.getByRole("button", { name: /Rental Timing/ })).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("Recovery Days After Return"), {
      target: { value: "2" },
    });

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Default guide" })[0]!, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Custom measurements" }));
    fireEvent.change(screen.getByLabelText("S bust"), { target: { value: "34" } });
    fireEvent.change(screen.getByLabelText("S waist"), { target: { value: "28" } });
    fireEvent.change(screen.getByLabelText("S hips"), { target: { value: "36" } });

    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));

    await waitFor(() => expect(api.createClothing).toHaveBeenCalledTimes(1));
    const [requestBody, idempotencyKey] = api.createClothing.mock.calls[0]!;
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(requestBody).toMatchObject({
      name: "Emerald Evening Gown",
      code: "GOWN-001",
      category_id: "00000000-0000-4000-8000-000000000001",
      color_label: null,
      image_file_ids: [],
      pricing: {
        mode: "fixed_duration",
        rental_price_minor: "30000",
        security_deposit_minor: "50000",
        extra_day_price_minor: "10000",
        included_days: 3,
        prep_minutes: 0,
        turnaround_minutes: 2880,
      },
      activate: false,
    });
    expect(requestBody.sizes).toHaveLength(4);
    expect(requestBody.sizes[0]).toMatchObject({
      size_label: "S",
      measurement_mode: "custom",
      measurement_unit: "in",
      measurements: { bust: 34, waist: 28, hips: 36 },
    });
    expect(requestBody.sizes[1]).toMatchObject({
      size_label: "M",
      measurement_mode: "default_guide",
      measurement_guide_id: "00000000-0000-4000-8000-000000000099",
      measurements: {},
    });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inventory"));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBe("draft-saved");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(true);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it("prevents rapid double submit with the shared guard", async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    api.createClothing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );

    renderPage();
    await screen.findByText("Default Size Guide");
    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Single Intent Draft" },
    });

    const saveDraft = screen.getByRole("button", { name: "Save as Draft" });
    fireEvent.click(saveDraft);
    fireEvent.click(saveDraft);

    await waitFor(() => expect(api.createClothing).toHaveBeenCalledTimes(1));
    resolveCreate({
      data: {
        product_id: "00000000-0000-4000-8000-000000000050",
        code: "GOWN-001",
        variant_count: 4,
        physical_piece_count: 4,
        status: "draft",
      },
      requestId: "req-create",
    });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inventory"));
  });

  it("reuses one create idempotency key when retrying the same unchanged form intent", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.createClothing
      .mockRejectedValueOnce(
        new DrezivoApiError("The request timed out. Please try again.", {
          code: "DEPENDENCY_UNAVAILABLE",
          status: 503,
        })
      )
      .mockResolvedValueOnce({
        data: {
          product_id: "00000000-0000-4000-8000-000000000050",
          code: "GOWN-001",
          variant_count: 4,
          physical_piece_count: 4,
          status: "draft",
        },
        requestId: "req-retry",
      });

    renderPage();
    await screen.findByText("Default Size Guide");
    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Retry Draft" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The request timed out. Please try again.");
    const firstKey = api.createClothing.mock.calls[0]?.[1];

    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));
    await waitFor(() => expect(api.createClothing).toHaveBeenCalledTimes(2));
    expect(api.createClothing.mock.calls[1]?.[1]).toBe(firstKey);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inventory"));
  });

  it("gives an archive recovery path when the physical-asset entitlement is full", async () => {
    const { DrezivoApiError } = await import("@/lib/drezivo-api");
    api.createClothing.mockRejectedValueOnce(
      new DrezivoApiError("The workspace plan limit would be exceeded.", {
        code: "CAPACITY_CONFLICT",
        status: 409,
      })
    );

    renderPage();
    await screen.findByText("Default Size Guide");
    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Capacity Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as Draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your workspace has reached its active clothing-piece limit."
    );
    expect(screen.getByRole("link", { name: "Review clothing to archive" })).toHaveAttribute(
      "href",
      "/inventory?status=active"
    );
  });

  it("accepts at most 10 photos, uploads/finalizes them, and submits their file ids in order", async () => {
    let sequence = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    if (!("arrayBuffer" in File.prototype)) {
      Object.defineProperty(File.prototype, "arrayBuffer", {
        configurable: true,
        value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      });
    }

    let fileSequence = 0;
    api.authorizeUpload.mockImplementation(() => {
      const fileId = `00000000-0000-4000-8000-${String(++fileSequence).padStart(12, "0")}`;
      return Promise.resolve({
        data: {
          file_id: fileId,
          upload_url: `https://uploads.example/${fileId}`,
          upload_method: "PUT",
          required_headers: {
            "Content-Type": "image/png",
            "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          },
          expires_at: "2026-09-21T02:00:00.000Z",
        },
        requestId: `req-upload-${fileSequence}`,
      });
    });
    api.finalizeUpload.mockImplementation((fileId: string) =>
      Promise.resolve({
        data: {
          file: {
            file_id: fileId,
            purpose: "catalogue_image",
            lifecycle_status: "accepted",
            content_type: "image/png",
            byte_size: 3,
            sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            frozen_at: "2026-09-21T01:30:00.000Z",
          },
        },
        requestId: `req-finalize-${fileId}`,
      })
    );

    renderPage();
    await screen.findByText("Default Size Guide");
    fireEvent.change(screen.getByLabelText("Clothing Name *"), {
      target: { value: "Photo Gown" },
    });
    fireEvent.change(screen.getByLabelText("Color (optional)"), {
      target: { value: "Gold" },
    });

    const files = Array.from(
      { length: 11 },
      (_, index) => new File([new Uint8Array([1, 2, 3])], `photo-${index + 1}.png`, { type: "image/png" })
    );
    fireEvent.change(screen.getByLabelText("Clothing photos"), {
      target: { files },
    });

    expect(screen.getAllByRole("button", { name: /^Remove photo-/ })).toHaveLength(10);
    expect(screen.queryByText("10/10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Clothing" }));

    await waitFor(() => expect(api.authorizeUpload).toHaveBeenCalledTimes(10));
    await waitFor(() => expect(api.finalizeUpload).toHaveBeenCalledTimes(10));
    await waitFor(() => expect(api.createClothing).toHaveBeenCalledTimes(1));
    const [requestBody] = api.createClothing.mock.calls[0]!;
    expect(requestBody.activate).toBe(true);
    expect(requestBody.image_file_ids).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      )
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inventory"));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("drezivo:inventory-notice")).toBe("clothing-added");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(true);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });
});

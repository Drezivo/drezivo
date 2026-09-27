import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fittingDetail, fittingSettings } from "@drezivo/contracts";

import { NewFittingSheet } from "@/components/fittings/new-fitting-sheet";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  createFitting: vi.fn(),
  getCatalogueClothing: vi.fn(),
  getCatalogueClothingDetail: vi.fn(),
  getFittingIntakeOptions: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
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

const branchId = "00000000-0000-4000-8000-000000002001";
const customerId = "00000000-0000-4000-8000-000000002002";
const fittingId = "00000000-0000-4000-8000-000000002003";
const lineId = "00000000-0000-4000-8000-000000002004";
const variantId = "00000000-0000-4000-8000-000000002005";
const assetId = "00000000-0000-4000-8000-000000002006";
const productId = "00000000-0000-4000-8000-000000002007";

const settings = fittingSettings.parse({
  branch_id: branchId,
  enabled: true,
  capacity: 2,
  duration_minutes: 60,
  fee_minor: "50000",
  currency: "PHP",
  timezone: "Asia/Manila",
  weekly_hours: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
    (weekday) => ({ weekday, windows: [{ starts_local: "09:00", ends_local: "17:00" }] })
  ),
  version: 1,
  updated_at: "2026-09-27T00:00:00.000Z",
});

const createdFitting = fittingDetail.parse({
  id: fittingId,
  branch_id: branchId,
  booking_channel: "staff",
  status: "pending",
  period: { start: "2026-10-05T02:00:00.000Z", end: "2026-10-05T03:00:00.000Z" },
  timezone_snapshot: "Asia/Manila",
  customer: {
    id: customerId,
    full_name: "Walk-in Customer",
    phone: "09171234567",
    email: null,
  },
  garments: [
    {
      id: lineId,
      variant: {
        variant_id: variantId,
        product_name: "Test Gown",
        sku: "TEST-M",
        size_label: "Medium",
        color_label: "Gold",
      },
      garment_mode: "guaranteed",
      assigned_asset: { id: assetId, asset_code: "GWN-2006" },
    },
  ],
  fee: { fee_minor: "50000", currency: "PHP", payment: null },
  internal_note: null,
  terminal_reason: null,
  attention: "none",
  allowed_actions: ["confirm", "reject", "cancel", "reschedule", "update_garments", "update_note"],
  version: 1,
  created_at: "2026-09-27T01:00:00.000Z",
});

const catalogueList = {
  items: [
    {
      product_id: productId,
      name: "Test Gown",
      size_labels: ["Medium"],
    },
  ],
  page_meta: { next_cursor: null, has_more: false },
};

const catalogueDetail = {
  product_id: productId,
  name: "Test Gown",
  variants: [
    {
      id: variantId,
      sku: "TEST-M",
      size_label: "Medium",
      color_label: "Gold",
      status: "active",
    },
  ],
};

describe("NewFittingSheet production cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    clerk.getToken.mockResolvedValue("test-token");
    api.getFittingIntakeOptions.mockResolvedValue({
      data: {
        customers: [
          {
            id: customerId,
            full_name: "Existing Customer",
            phone: "09170000001",
            email: null,
          },
        ],
      },
      requestId: "request-customer",
    });
    api.getCatalogueClothing.mockResolvedValue({ data: catalogueList, requestId: "request-list" });
    api.getCatalogueClothingDetail.mockResolvedValue({
      data: catalogueDetail,
      requestId: "request-detail",
    });
    api.createFitting.mockResolvedValue({
      data: { fitting: createdFitting },
      requestId: "request-create",
    });
  });

  it("reads strict duration and fee from branch settings with no per-fitting overrides", () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByText("60 minutes")).toBeVisible();
    expect(screen.queryByLabelText("Fitting duration")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fitting fee (PHP)")).not.toBeInTheDocument();
    expect(screen.queryByText("Guaranteed intent")).not.toBeInTheDocument();
  });

  it("searches existing customers through the fitting intake API", async () => {
    render(<NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Name, email, or phone..."), {
      target: { value: "Ex" },
    });

    await waitFor(() =>
      expect(api.getFittingIntakeOptions).toHaveBeenCalledWith({ customer_search: "Ex" })
    );
    expect(await screen.findByRole("radio", { name: /Existing Customer/ })).toBeVisible();
  });

  it("requires walk-in contact and creates a guaranteed fitting from canonical API input", async () => {
    const onCreated = vi.fn();
    render(
      <NewFittingSheet open settings={settings} onOpenChange={vi.fn()} onCreated={onCreated} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Walk-in customer" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), {
      target: { value: "Walk-in Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("Enter a phone number or email for the walk-in customer.")
    ).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("09XXXXXXXXX"), {
      target: { value: "09171234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: /Test Gown/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Test Gown/ }));
    expect(await screen.findByText("SKU TEST-M")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Guarantee garment" }));
    expect(screen.getByText("Guaranteed garment")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("₱500")).toBeVisible();
    expect(
      screen.getByText(/server selects and claims an eligible physical asset atomically/i)
    ).toBeVisible();
    expect(screen.queryByText(/capacity slot #/i)).not.toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: "Create fitting" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => expect(api.createFitting).toHaveBeenCalledTimes(1));
    const [request, idempotencyKey] = api.createFitting.mock.calls[0]!;
    expect(request).toMatchObject({
      customer: {
        source: "new",
        customer: { full_name: "Walk-in Customer", phone: "09171234567" },
      },
      garments: [{ variant_id: variantId, garment_mode: "guaranteed" }],
    });
    expect(request).toHaveProperty("starts_at");
    expect(request).not.toHaveProperty("duration_minutes");
    expect(request).not.toHaveProperty("fee_minor");
    expect(request).not.toHaveProperty("payment");
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(onCreated).toHaveBeenCalledWith(createdFitting);
  });
});

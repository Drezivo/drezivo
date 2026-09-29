import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStorefrontDocument, type StorefrontSettings } from "@drezivo/contracts";

import { BusinessSettingsPage } from "@/components/settings/business-settings-page";
import { StorefrontDetailsPage } from "@/components/storefront/storefront-details-page";
import { StorefrontEditorProvider } from "@/components/storefront/storefront-editor";
import { StorefrontOverviewPage } from "@/components/storefront/storefront-overview-page";
import { minorToPesos, pesosToMinor } from "@/components/storefront/storefront-policy-pages";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  getStorefront: vi.fn(),
  updateStorefront: vi.fn(),
  setStorefrontPublished: vi.fn(),
  getBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/storefront" }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
  },
  createDrezivoApiClient: () => api,
}));

function settings(overrides: Partial<StorefrontSettings> = {}): StorefrontSettings {
  return {
    slug: "luna-gowns",
    status: "draft",
    version: 3,
    published_at: null,
    updated_at: "2026-09-29T02:00:00.000Z",
    public_path: "/s/luna-gowns",
    document: defaultStorefrontDocument("Luna Gown Rentals"),
    media: { logo_url: null, cover_url: null, hero_image_url: null, about_image_url: null },
    policy: { version: 1, effective_at: "2026-09-29T02:00:00.000Z", rules: null },
    readiness: { has_policy: false, has_active_clothing: true, has_storefront_payment_method: true, has_contact: false, ready: false },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("storefront CMS pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStorefront.mockResolvedValue({ data: settings(), requestId: "r" });
  });

  it("saves store details once even when Save is clicked twice", async () => {
    const pending = deferred<{ data: StorefrontSettings }>();
    api.updateStorefront.mockReturnValue(pending.promise);
    render(
      <StorefrontEditorProvider>
        <StorefrontDetailsPage />
      </StorefrontEditorProvider>,
    );
    const name = await screen.findByLabelText("Store name");
    fireEvent.change(name, { target: { value: "Luna Rentals QC" } });
    const save = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(api.updateStorefront).toHaveBeenCalledTimes(1));
    const [body, key] = api.updateStorefront.mock.calls[0] as [{ version: number; document: { branding: { display_name: string } } }, string];
    expect(body.version).toBe(3);
    expect(body.document.branding.display_name).toBe("Luna Rentals QC");
    expect(key).toMatch(/.+/);
    pending.resolve({ data: settings({ version: 4 }) });
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("blocks an invalid email before calling the API and says why", async () => {
    render(
      <StorefrontEditorProvider>
        <StorefrontDetailsPage />
      </StorefrontEditorProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Fix the highlighted fields.")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(api.updateStorefront).not.toHaveBeenCalled();
  });

  it("keeps Publish disabled until every readiness item is done", async () => {
    render(
      <StorefrontEditorProvider>
        <StorefrontOverviewPage />
      </StorefrontEditorProvider>,
    );
    expect(await screen.findByRole("button", { name: "Publish storefront" })).toBeDisabled();
    expect(screen.getByText("Rental policy written")).toBeVisible();
  });

  it("publishes once when ready", async () => {
    api.getStorefront.mockResolvedValue({
      data: settings({ readiness: { has_policy: true, has_active_clothing: true, has_storefront_payment_method: true, has_contact: true, ready: true } }),
      requestId: "r",
    });
    api.setStorefrontPublished.mockResolvedValue({ data: settings({ status: "published", version: 4 }) });
    render(
      <StorefrontEditorProvider>
        <StorefrontOverviewPage />
      </StorefrontEditorProvider>,
    );
    const publish = await screen.findByRole("button", { name: "Publish storefront" });
    fireEvent.click(publish);
    fireEvent.click(publish);
    await waitFor(() => expect(api.setStorefrontPublished).toHaveBeenCalledTimes(1));
    expect(api.setStorefrontPublished.mock.calls[0]?.slice(0, 2)).toEqual([true, 3]);
    expect(await screen.findByRole("button", { name: "Unpublish storefront" })).toBeEnabled();
  });

  it("converts peso amounts to exact centavos and back", () => {
    expect(pesosToMinor("150")).toBe("15000");
    expect(pesosToMinor("150.5")).toBe("15050");
    expect(pesosToMinor("0.05")).toBe("5");
    expect(pesosToMinor("")).toBe("0");
    expect(pesosToMinor("-1")).toBeNull();
    expect(pesosToMinor("1.234")).toBeNull();
    expect(minorToPesos("15050")).toBe("150.50");
    expect(minorToPesos("15000")).toBe("150");
  });
});

describe("business settings page", () => {
  const business = {
    business_name: "Luna Gown Rentals",
    business_email: null,
    business_phone: null,
    business_address: null,
    version: 2,
    timezone: "Asia/Manila",
    currency: "PHP",
    updated_at: "2026-09-29T02:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getBusinessSettings.mockResolvedValue({ data: business, requestId: "r" });
  });

  it("shows fixed regional settings and disables save for an invalid phone", async () => {
    render(<BusinessSettingsPage />);
    expect(await screen.findByText("Asia/Manila (GMT+8)")).toBeVisible();
    expect(screen.getByText("Philippine peso (₱)")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Business phone"), { target: { value: "call me" } });
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("saves business information once with the loaded version", async () => {
    api.updateBusinessSettings.mockResolvedValue({ data: { ...business, business_email: "owner@luna.test", version: 3 } });
    render(<BusinessSettingsPage />);
    fireEvent.change(await screen.findByLabelText("Business email"), { target: { value: "owner@luna.test" } });
    const save = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(api.updateBusinessSettings).toHaveBeenCalledTimes(1));
    expect(api.updateBusinessSettings.mock.calls[0]?.[0]).toMatchObject({ version: 2, business_email: "owner@luna.test" });
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStorefrontDocument, type StorefrontPolicyRules, type StorefrontSettings } from "@drezivo/contracts";

import { PlanUpgradeProvider } from "@/components/billing/plan-upgrade-dialog";
import { StorefrontEditorProvider } from "@/components/storefront/storefront-editor";
import { StorefrontOverviewPage } from "@/components/storefront/storefront-overview-page";
import { StorefrontBookingSettingsPage, StorefrontPoliciesPage, StorefrontRequirementsPage } from "@/components/storefront/storefront-policy-pages";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const access = vi.hoisted(() => ({ free: true }));
const api = vi.hoisted(() => ({
  getStorefront: vi.fn(),
  updateStorefront: vi.fn(),
  publishStorefrontPolicy: vi.fn(),
  setStorefrontPublished: vi.fn(),
  getPublicPlanCatalog: vi.fn(),
  getBilling: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/storefront" }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
  },
  createDrezivoApiClient: () => api,
}));
vi.mock("@/components/shell/dashboard-access-gate", () => ({
  useVerifiedActorContext: () => ({
    entitlements: {
      features: {
        fittings: !access.free,
        storefront_reservations: !access.free,
        storefront_payments: !access.free,
      },
    },
  }),
}));

const deliveryPolicy: StorefrontPolicyRules = {
  format: "text",
  image_file_ids: [],
  rental: "Three-day rentals from pickup.",
  deposit: "Refundable deposit at pickup.",
  cancellation: "Cancel at least 48 hours before pickup.",
  damage: null,
  delivery: { enabled: true, fee_minor: "15000", notes: "Metro Manila only." },
  privacy_notice: "We use your details only to handle this rental.",
};

function settings(overrides: Partial<StorefrontSettings> = {}): StorefrontSettings {
  return {
    slug: "free-shop",
    status: "draft",
    version: 3,
    published_at: null,
    updated_at: "2026-10-15T00:00:00.000Z",
    public_path: "/s/free-shop",
    document: defaultStorefrontDocument("Free Shop"),
    media: { logo_url: null, cover_url: null, hero_image_url: null, about_image_url: null },
    policy: { version: 1, effective_at: "2026-10-15T00:00:00.000Z", rules: null, image_urls: {} },
    readiness: { has_policy: true, has_active_clothing: true, has_storefront_payment_method: false, has_contact: true, ready: true },
    ...overrides,
  };
}

function renderPage(page: React.ReactNode) {
  return render(
    <PlanUpgradeProvider onChanged={vi.fn()}>
      <StorefrontEditorProvider>{page}</StorefrontEditorProvider>
    </PlanUpgradeProvider>,
  );
}

async function expectUpgradeDialog(feature: string) {
  expect(await screen.findByRole("heading", { name: "Upgrade to unlock" })).toBeVisible();
  expect(await screen.findByText(`${feature} is not included in the Free plan.`)).toBeVisible();
}

describe("Free storefront feature gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.free = true;
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStorefront.mockResolvedValue({ data: settings(), requestId: "r" });
    api.updateStorefront.mockResolvedValue({ data: settings(), requestId: "r" });
    api.publishStorefrontPolicy.mockResolvedValue({ data: settings(), requestId: "r" });
    api.setStorefrontPublished.mockResolvedValue({ data: settings({ status: "published" }), requestId: "r" });
    api.getPublicPlanCatalog.mockResolvedValue({ data: { plans: [] } });
    api.getBilling.mockResolvedValue({
      data: {
        plan: { code: "free", name: "Free", monthly_minor: "0", currency: "PHP", physical_assets_max: 20, frontdesk_seats_max: 0, trial_days: 0 },
        subscription: { status: "active", trial_ends_at: null, read_only_until: null, current_period_end: null },
        access: { level: "full", reason: "free", ends_at: null, days_left: null, pending_payment: false, storefront_online: true, storefront_offline_at: null, read_only_until: null },
        can_pay: true,
        can_start_trial: false,
        payment_methods: [],
        payments: [],
      },
    });
  });

  it("publishes without an online payment method and opens upgrade from Customer requirements", async () => {
    renderPage(<StorefrontOverviewPage />);

    const publish = await screen.findByRole("button", { name: "Publish storefront" });
    expect(publish).toBeEnabled();
    expect(screen.queryByText("An online payment method is ready")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Customer requirements.*Upgrade to unlock/ }));
    await expectUpgradeDialog("customer requirements");
  });

  it("keeps saved delivery settings inactive and opens upgrade when the locked control is activated", async () => {
    api.getStorefront.mockResolvedValue({
      data: settings({ policy: { version: 2, effective_at: "2026-10-15T00:00:00.000Z", rules: deliveryPolicy, image_urls: {} } }),
      requestId: "r",
    });
    renderPage(<StorefrontPoliciesPage />);

    expect(await screen.findByText("Your saved delivery settings are inactive on Free and will return if you upgrade.")).toBeVisible();
    const delivery = await screen.findByRole("switch", { name: "Offer delivery" });
    expect(delivery).toHaveAttribute("aria-disabled", "true");
    expect(delivery).not.toBeChecked();
    fireEvent.click(delivery);

    await expectUpgradeDialog("storefront delivery");
    expect(api.publishStorefrontPolicy).not.toHaveBeenCalled();
  });

  it("keeps customer requirements unchanged when a locked radio option is clicked", async () => {
    const document = defaultStorefrontDocument("Free Shop");
    document.checkout.requirements = { phone: "required", social_handle: "optional", event_date: "optional" };
    api.getStorefront.mockResolvedValue({ data: settings({ document }), requestId: "r" });
    renderPage(<StorefrontRequirementsPage />);

    const phoneOptions = await screen.findByRole("radiogroup", { name: "Mobile number" });
    const optional = phoneOptions.querySelector<HTMLButtonElement>('button[aria-checked="false"]');
    expect(optional).not.toBeNull();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    optional?.focus();
    expect(optional).toHaveFocus();
    fireEvent.click(optional as HTMLButtonElement);

    await expectUpgradeDialog("customer requirements");
    expect(phoneOptions.querySelector('button[aria-checked="true"]')).toHaveTextContent("Required");
    expect(api.updateStorefront).not.toHaveBeenCalled();
  });

  it("opens upgrade prompts for online reservations and fittings", async () => {
    renderPage(<StorefrontBookingSettingsPage />);

    const reservations = await screen.findByRole("switch", { name: /Take reservations online/ });
    expect(reservations).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(reservations);
    await expectUpgradeDialog("online storefront reservations");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    const fittings = await screen.findByRole("switch", { name: /Take fitting requests online/ });
    expect(fittings).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(fittings);
    await expectUpgradeDialog("storefront fitting requests");
  });

  it("keeps Delivery editable on paid plans", async () => {
    access.free = false;
    api.getStorefront.mockResolvedValue({
      data: settings({ policy: { version: 2, effective_at: "2026-10-15T00:00:00.000Z", rules: { ...deliveryPolicy, delivery: { enabled: false, fee_minor: "0", notes: null } }, image_urls: {} } }),
      requestId: "r",
    });
    renderPage(<StorefrontPoliciesPage />);

    const delivery = await screen.findByRole("switch", { name: "Offer delivery" });
    fireEvent.click(delivery);
    expect(delivery).toBeChecked();
    expect(screen.queryByRole("heading", { name: "Upgrade to unlock" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Publish new version" })).toBeEnabled();
  });
});

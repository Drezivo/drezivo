import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingOverview, SubscriptionAccess } from "@drezivo/contracts";

const mocks = vi.hoisted(() => ({
  getBilling: vi.fn(),
  getPublicPlanCatalog: vi.fn(),
  changeSubscriptionPlan: vi.fn(),
  getToken: vi.fn(),
  role: "owner" as "owner" | "frontdesk",
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: mocks.getToken }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/billing" }));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({
    getBilling: mocks.getBilling,
    getPublicPlanCatalog: mocks.getPublicPlanCatalog,
    changeSubscriptionPlan: mocks.changeSubscriptionPlan,
  }),
  DrezivoApiError: class DrezivoApiError extends Error {},
}));
vi.mock("@/components/shell/dashboard-access-gate", () => ({
  useVerifiedActorContext: () => ({
    membership: { role: mocks.role },
    subscription: { plan_code: "free", status: "active" },
    access: { reason: "free", pending_payment: false },
  }),
}));

const { SubscriptionBanner, SubscriptionProvider } = await import("@/components/billing/subscription-status");
const { BillingSettingsPage } = await import("@/components/settings/billing-settings-page");

const freeAccess: SubscriptionAccess = {
  level: "full",
  reason: "free",
  ends_at: null,
  days_left: null,
  pending_payment: false,
  storefront_online: true,
  storefront_offline_at: null,
  read_only_until: null,
};

function freeBilling(overrides: Partial<BillingOverview> = {}): BillingOverview {
  return {
    plan: { code: "free", name: "Free", monthly_minor: "0", currency: "PHP", physical_assets_max: 20, frontdesk_seats_max: 0, trial_days: 0 },
    subscription: { status: "active", trial_ends_at: null, read_only_until: null, current_period_end: null },
    access: freeAccess,
    usage: { active_garments: 20, frontdesk_seats_used: 0 },
    can_pay: true,
    can_start_trial: true,
    payment_methods: [],
    payments: [],
    ...overrides,
  };
}

const themes = ["ivory", "sage", "blush", "noir"] as const;
const catalog = {
  plans: [
    { code: "free", name: "Free", monthly_price_minor: 0, currency: "PHP", trial_days: 0, limits: { active_garments: 20, frontdesk_seats: 0 }, features: { fittings: false, storefront_reservations: false, storefront_payments: false, storefront_themes: ["ivory", "sage"] } },
    { code: "starter", name: "Starter", monthly_price_minor: 14900, currency: "PHP", trial_days: 14, limits: { active_garments: 125, frontdesk_seats: 0 }, features: { fittings: true, storefront_reservations: true, storefront_payments: true, storefront_themes: themes } },
    { code: "standard", name: "Standard", monthly_price_minor: 29900, currency: "PHP", trial_days: 14, limits: { active_garments: 300, frontdesk_seats: 3 }, features: { fittings: true, storefront_reservations: true, storefront_payments: true, storefront_themes: themes } },
  ],
};

function renderShell(children: React.ReactNode, onChanged = vi.fn()) {
  return render(
    <SubscriptionProvider access={freeAccess} onChanged={onChanged}>
      <SubscriptionBanner access={freeAccess} />
      {children}
    </SubscriptionProvider>
  );
}

describe("Free plan upgrade in the workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.getToken.mockResolvedValue("token");
    mocks.getPublicPlanCatalog.mockResolvedValue({ data: catalog });
    mocks.getBilling.mockResolvedValue({ data: freeBilling() });
  });

  it("opens the plan picker from the Free banner instead of a payment for Free", async () => {
    renderShell(null);

    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    expect(await screen.findByRole("heading", { name: "Choose a plan" })).toBeVisible();
    expect(await screen.findByRole("radio", { name: /Starter/ })).toBeChecked();
    expect(screen.queryByText(/Pay ₱0/)).toBeNull();
  });

  it("starts the chosen plan's trial once and confirms when it ends", async () => {
    const onChanged = vi.fn();
    let resolve: (value: unknown) => void = () => undefined;
    mocks.changeSubscriptionPlan.mockReturnValue(new Promise((done) => (resolve = done)));
    renderShell(null, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Standard/ }));

    const start = screen.getByRole("button", { name: /Start 14-day Standard trial/ });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(start).toBeDisabled();
    resolve({
      data: { id: "00000000-0000-4000-8000-000000000001", plan_code: "standard", status: "trialing", trial_ends_at: "2026-10-29T08:00:00.000Z", grace_ends_at: null },
    });

    expect(await screen.findByRole("heading", { name: "Your trial has started" })).toBeVisible();
    expect(screen.getByText(/Standard is yours to try until October 29, 2026/)).toBeVisible();
    expect(mocks.changeSubscriptionPlan).toHaveBeenCalledTimes(1);
    expect(mocks.changeSubscriptionPlan.mock.calls[0]?.[0]).toEqual({ plan_code: "standard" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("sends an owner whose trial is used to payment for the chosen plan", async () => {
    mocks.getBilling.mockResolvedValue({ data: freeBilling({ can_start_trial: false }) });
    renderShell(null);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    expect(await screen.findByText(/already used your free trial, so Starter opens once Drezivo approves/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Start 14-day/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));

    expect(await screen.findByText("Starter plan: ₱149 a month, up to 125 active garments.")).toBeVisible();
  });

  it("shows the plan, its usage, and the owner's upgrade on Settings, Plan & billing", async () => {
    renderShell(<BillingSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Free plan" })).toBeVisible();
    expect(screen.getByText("20 of 20")).toBeVisible();
    expect(screen.getByText("Owner only")).toBeVisible();
    expect(screen.getByText(/reached the Free limit of 20 active garments/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try a paid plan free for 14 days" }));
    expect(await screen.findByRole("heading", { name: "Choose a plan" })).toBeVisible();
  });

  it("gives Front Desk the plan without owner actions", async () => {
    mocks.role = "frontdesk";
    mocks.getBilling.mockResolvedValue({ data: freeBilling({ can_pay: false, can_start_trial: false }) });
    renderShell(<BillingSettingsPage />);

    expect(await screen.findByText("Only the business owner can change the plan or pay for it.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Try a paid plan|Compare plans|Pay for/ })).toBeNull();
  });
});

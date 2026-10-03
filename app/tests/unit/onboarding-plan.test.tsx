import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { organizationOnboarding, type OrganizationOnboarding } from "@drezivo/contracts";
import { OnboardingPlan } from "@/components/onboarding/onboarding-plan";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getCurrentOnboarding: vi.fn(),
  getWorkspaces: vi.fn(),
  startOnboardingTrial: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
  useClerk: clerk.useClerk,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
    requestId: string | null = null;
    status: number;

    constructor(message: string, options: { status: number }) {
      super(message);
      this.status = options.status;
    }
  },
  createDrezivoApiClient: () => api,
}));

const onboarding: OrganizationOnboarding = organizationOnboarding.parse({
  id: "9fbd891f-cab6-48a9-a965-e84deea05df6",
  clerk_org_id: "org_123",
  organization_name: "Luna Rentals",
  status: "incomplete",
  selected_plan_code: null,
  is_trial_eligible: true,
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
});

const bootstrap = {
  tenant: {
    id: "tenant_123",
    name: "Luna Rentals",
    slug: "luna-rentals",
    status: "active" as const,
    currency: "PHP",
    timezone: "Asia/Manila",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  },
  default_branch: {
    id: "branch_123",
    name: "Main Branch",
    code: "main",
    is_default: true,
    timezone: "Asia/Manila",
    status: "active" as const,
  },
  membership: {
    id: "membership_123",
    role: "owner" as const,
    status: "active" as const,
    updated_at: "2026-09-19T00:00:00.000Z",
  },
  branch_grants: [{ branch_id: "branch_123", permission_codes: ["assets.manage"] }],
  subscription: {
    id: "subscription_123",
    plan_code: "starter" as const,
    status: "trialing" as const,
    trial_ends_at: "2026-09-26T00:00:00.000Z",
    grace_ends_at: null,
  },
};

const workspace = {
  tenant: bootstrap.tenant,
  clerk_org_id: "org_123",
  role: "owner" as const,
  membership_updated_at: "2026-09-19T00:00:00.000Z",
};

function renderPlan() {
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true });
  clerk.useClerk.mockReturnValue({ setActive: clerk.setActive });
  return render(<OnboardingPlan />);
}

function mockCurrent(currentOnboarding: OrganizationOnboarding = onboarding) {
  api.getCurrentOnboarding.mockResolvedValue({
    data: {
      onboarding: currentOnboarding,
      has_current_owned_tenant: false,
      has_consumed_lifetime_trial: false,
    },
    requestId: "req-current",
  });
}

describe("OnboardingPlan", () => {
  const locationReplace = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.setActive.mockResolvedValue(undefined);
    mockCurrent();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace: locationReplace } });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  function mockWorkspaceHandoff() {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [workspace], page_meta: { next_cursor: null, has_more: false } },
      requestId: "req-workspaces",
    });
    api.getActorContext.mockResolvedValue({
      data: {
        tenant: bootstrap.tenant,
        membership: bootstrap.membership,
        branches: [bootstrap.default_branch],
        active_branch_id: bootstrap.default_branch.id,
        branch_grants: bootstrap.branch_grants,
        subscription: bootstrap.subscription,
        entitlements: { physical_assets_max: 1000, frontdesk_seats_max: 10 },
      },
      requestId: "req-actor",
    });
  }

  it("asks to start the trial on arrival and shows the one Standard plan, with no plan to choose", async () => {
    renderPlan();

    const dialog = await screen.findByRole("dialog", { name: "Start your 14-day trial?" });
    expect(dialog).toHaveTextContent("₱300 a month");
    expect(dialog).toHaveTextContent("Up to 125 garments");
    expect(dialog).toHaveTextContent("For the shop owner only");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(api.startOnboardingTrial).not.toHaveBeenCalled();
  });

  it("closes on Not yet without starting anything, and the trial button reopens it", async () => {
    renderPlan();
    await screen.findByRole("dialog", { name: "Start your 14-day trial?" });

    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "Start your free trial" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Start 14-day trial/ }));
    expect(await screen.findByRole("dialog", { name: "Start your 14-day trial?" })).toBeVisible();
    expect(api.startOnboardingTrial).not.toHaveBeenCalled();
  });

  it("starts the trial once for a double click and opens the new workspace", async () => {
    api.startOnboardingTrial.mockResolvedValue({ data: bootstrap, requestId: "req-trial" });
    mockWorkspaceHandoff();

    renderPlan();
    await screen.findByRole("dialog", { name: "Start your 14-day trial?" });
    const confirm = screen.getByRole("button", { name: "Start 14-day trial" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/"));
    expect(api.startOnboardingTrial).toHaveBeenCalledTimes(1);
    expect(api.startOnboardingTrial).toHaveBeenCalledWith(onboarding.id, expect.any(String));
    expect(clerk.setActive).toHaveBeenCalledWith({ organization: "org_123" });
    expect(api.getActorContext).toHaveBeenCalledTimes(1);
  });

  it("reuses the same idempotency key when the owner retries after a failure", async () => {
    api.startOnboardingTrial.mockRejectedValueOnce(new Error("network failure"));
    api.startOnboardingTrial.mockResolvedValueOnce({ data: bootstrap, requestId: "req-trial" });
    mockWorkspaceHandoff();

    renderPlan();
    await screen.findByRole("dialog", { name: "Start your 14-day trial?" });
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day trial" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day trial" }));

    await waitFor(() => expect(api.startOnboardingTrial).toHaveBeenCalledTimes(2));
    expect(api.startOnboardingTrial.mock.calls[0]?.[1]).toBe(api.startOnboardingTrial.mock.calls[1]?.[1]);
  });

  it("retries only workspace loading after the trial has started", async () => {
    api.startOnboardingTrial.mockResolvedValue({ data: bootstrap, requestId: "req-trial" });
    mockWorkspaceHandoff();
    api.getWorkspaces.mockRejectedValueOnce(new Error("temporary workspace read failure"));

    renderPlan();
    await screen.findByRole("dialog", { name: "Start your 14-day trial?" });
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day trial" }));

    expect(await screen.findByRole("heading", { name: "Your workspace was created" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try loading workspace again" }));

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/"));
    expect(api.getWorkspaces).toHaveBeenCalledTimes(2);
    expect(api.startOnboardingTrial).toHaveBeenCalledTimes(1);
  });

  it("sends an owner who already finished onboarding back to the onboarding router", async () => {
    mockCurrent({ ...onboarding, status: "provisioned" as const });
    renderPlan();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
    expect(api.startOnboardingTrial).not.toHaveBeenCalled();
  });
});

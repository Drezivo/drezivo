import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationOnboarding, type OrganizationOnboarding } from "@drezivo/contracts";
import { OnboardingPlan } from "@/components/onboarding/onboarding-plan";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));

const api = vi.hoisted(() => ({
  bootstrapOnboarding: vi.fn(),
  getActorContext: vi.fn(),
  getCurrentOnboarding: vi.fn(),
  getWorkspaces: vi.fn(),
  selectOnboardingPlan: vi.fn(),
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

const professionalOnboarding = {
  ...onboarding,
  selected_plan_code: "professional" as const,
};

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
    plan_code: "professional" as const,
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
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.setActive.mockResolvedValue(undefined);
    mockCurrent();
  });

  it("renders the three authoritative plan options and defaults to Professional", async () => {
    renderPlan();

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Starter/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Professional/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Business/ })).not.toBeChecked();
    expect(screen.getByText("₱300")).toBeVisible();
    expect(screen.getByText("₱499")).toBeVisible();
    expect(screen.getByText("₱1,299")).toBeVisible();
    expect(screen.getByText("1,000 active assets")).toBeVisible();
  });

  it("persists only plan_code and moves to launch review", async () => {
    api.selectOnboardingPlan.mockResolvedValue({
      data: { ...onboarding, selected_plan_code: "starter" as const },
      requestId: "req-plan",
    });

    renderPlan();
    await screen.findByRole("heading", { name: "Choose your plan" });

    fireEvent.click(screen.getByRole("radio", { name: /Starter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(api.selectOnboardingPlan).toHaveBeenCalledTimes(1));
    expect(api.selectOnboardingPlan).toHaveBeenCalledWith(
      onboarding.id,
      { plan_code: "starter" },
      expect.any(String)
    );
    expect(await screen.findByRole("heading", { name: "Review and launch" })).toBeVisible();
    expect(screen.getByText("Starter")).toBeVisible();
  });

  it("guards duplicate submits while the first plan request is pending", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    api.selectOnboardingPlan.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    renderPlan();
    await screen.findByRole("heading", { name: "Choose your plan" });
    fireEvent.click(screen.getByRole("radio", { name: /Starter/ }));

    const button = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(api.selectOnboardingPlan).toHaveBeenCalledTimes(1);

    resolveRequest({
      data: { ...onboarding, selected_plan_code: "starter" },
      requestId: "req-plan",
    });
  });

  it("reuses the same idempotency key when retrying the same plan selection", async () => {
    api.selectOnboardingPlan.mockRejectedValueOnce(new Error("network failure"));
    api.selectOnboardingPlan.mockResolvedValueOnce({
      data: { ...onboarding, selected_plan_code: "starter" },
      requestId: "req-plan",
    });

    renderPlan();
    await screen.findByRole("heading", { name: "Choose your plan" });
    fireEvent.click(screen.getByRole("radio", { name: /Starter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(api.selectOnboardingPlan).toHaveBeenCalledTimes(2));
    expect(api.selectOnboardingPlan.mock.calls[0]?.[2]).toBe(api.selectOnboardingPlan.mock.calls[1]?.[2]);
  });

  it("loads a persisted plan directly into review without starting the trial", async () => {
    mockCurrent(professionalOnboarding);

    renderPlan();

    expect(await screen.findByRole("heading", { name: "Review and launch" })).toBeVisible();
    expect(screen.getByText("Professional")).toBeVisible();
    expect(screen.getByText("300 active assets", { exact: false })).toBeVisible();
    expect(api.bootstrapOnboarding).not.toHaveBeenCalled();
  });

  it("requires trial confirmation before bootstrap and completes workspace handoff once", async () => {
    mockCurrent(professionalOnboarding);
    api.bootstrapOnboarding.mockResolvedValue({ data: bootstrap, requestId: "req-bootstrap" });
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
        entitlements: { physical_assets_max: 300, frontdesk_seats_max: 2 },
      },
      requestId: "req-actor",
    });

    renderPlan();
    fireEvent.click(await screen.findByRole("button", { name: /Launch Workspace/i }));

    expect(screen.getByRole("dialog", { name: "Start your 14-day trial?" })).toBeVisible();
    expect(screen.getByText(/No credit card is required during the trial period/i)).toBeVisible();
    expect(api.bootstrapOnboarding).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "Start 14-day trial" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.bootstrapOnboarding).toHaveBeenCalledTimes(1));
    expect(api.bootstrapOnboarding).toHaveBeenCalledWith(onboarding.id, {}, expect.any(String));
    await waitFor(() => expect(api.getWorkspaces).toHaveBeenCalledTimes(1));
    expect(clerk.setActive).toHaveBeenCalledWith({ organization: "org_123" });
    expect(api.getActorContext).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("retries only workspace loading after bootstrap succeeds", async () => {
    mockCurrent(professionalOnboarding);
    api.bootstrapOnboarding.mockResolvedValue({ data: bootstrap, requestId: "req-bootstrap" });
    api.getWorkspaces
      .mockRejectedValueOnce(new Error("temporary workspace read failure"))
      .mockResolvedValueOnce({
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
        entitlements: { physical_assets_max: 300, frontdesk_seats_max: 2 },
      },
      requestId: "req-actor",
    });

    renderPlan();
    fireEvent.click(await screen.findByRole("button", { name: /Launch Workspace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day trial" }));

    expect(await screen.findByRole("heading", { name: "Your workspace was created" })).toBeVisible();
    expect(api.bootstrapOnboarding).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try loading workspace again" }));

    await waitFor(() => expect(api.getWorkspaces).toHaveBeenCalledTimes(2));
    expect(api.bootstrapOnboarding).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});

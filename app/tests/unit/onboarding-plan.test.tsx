import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingPlan } from "@/components/onboarding/onboarding-plan";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  useAuth: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getCurrentOnboarding: vi.fn(),
  selectOnboardingPlan: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
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

const onboarding = {
  id: "9fbd891f-cab6-48a9-a965-e84deea05df6",
  clerk_org_id: "org_123",
  organization_name: "Luna Rentals",
  requested_slug: "luna-rentals",
  status: "incomplete" as const,
  selected_plan_code: null,
  is_trial_eligible: true,
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
};

function renderPlan() {
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true });
  return render(<OnboardingPlan />);
}

describe("OnboardingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    api.getCurrentOnboarding.mockResolvedValue({
      data: {
        onboarding,
        has_current_owned_tenant: false,
        has_consumed_lifetime_trial: false,
      },
      requestId: "req-current",
    });
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

  it("submits only plan_code through the API client", async () => {
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
    expect(await screen.findByText("Plan saved.")).toBeVisible();
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

  it("reuses the same idempotency key when retrying the same selection", async () => {
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

  it("resumes a saved plan selection instead of overwriting it", async () => {
    api.getCurrentOnboarding.mockResolvedValue({
      data: {
        onboarding: { ...onboarding, selected_plan_code: "business" },
        has_current_owned_tenant: false,
        has_consumed_lifetime_trial: false,
      },
      requestId: "req-current",
    });

    renderPlan();

    expect(await screen.findByRole("radio", { name: /Business/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Plan saved" })).toBeDisabled();
    expect(api.selectOnboardingPlan).not.toHaveBeenCalled();
  });
});

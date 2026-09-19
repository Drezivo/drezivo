import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));

const api = vi.hoisted(() => ({
  abandonOnboarding: vi.fn(),
  createOnboarding: vi.fn(),
  getCurrentOnboarding: vi.fn(),
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
    status = 500;
  },
  createDrezivoApiClient: () => api,
}));

const noOnboardingContext = {
  onboarding: null,
  has_current_owned_tenant: false,
  has_consumed_lifetime_trial: false,
};

function renderEntry() {
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true });
  clerk.useClerk.mockReturnValue({ setActive: clerk.setActive, signOut: clerk.signOut });
  return render(<OnboardingEntry />);
}

describe("OnboardingEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.setActive.mockResolvedValue(undefined);
    clerk.signOut.mockResolvedValue(undefined);
    api.getCurrentOnboarding.mockResolvedValue({
      data: noOnboardingContext,
      requestId: "req-current",
    });
  });

  it("renders the initial organization setup state", async () => {
    renderEntry();

    expect(await screen.findByRole("heading", { name: "Set up your business" })).toBeVisible();
    expect(screen.getByLabelText("Business name")).toBeVisible();
    expect(screen.getByLabelText(/Slug/)).toBeVisible();
  });

  it("creates an organization with only the allowed fields and activates the returned organization", async () => {
    api.createOnboarding.mockResolvedValue({
      data: {
        id: "onboarding_123",
        clerk_org_id: "org_123",
        organization_name: "Luna Rentals",
        requested_slug: "luna-rentals",
        status: "incomplete",
        selected_plan_code: null,
        is_trial_eligible: true,
        created_at: "2026-09-19T00:00:00.000Z",
        updated_at: "2026-09-19T00:00:00.000Z",
      },
      requestId: "req-create",
    });

    renderEntry();
    await screen.findByRole("heading", { name: "Set up your business" });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: " Luna Rentals " },
    });
    fireEvent.change(screen.getByLabelText(/Slug/), {
      target: { value: "luna-rentals" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);

    await waitFor(() => expect(api.createOnboarding).toHaveBeenCalledTimes(1));
    expect(api.createOnboarding).toHaveBeenCalledWith(
      { organization_name: "Luna Rentals", slug: "luna-rentals" },
      expect.any(String)
    );
    expect(clerk.setActive).toHaveBeenCalledWith({ organization: "org_123" });
    expect(router.replace).toHaveBeenCalledWith("/onboarding/plan");
  });

  it("guards duplicate organization submissions while the first request is pending", async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    api.createOnboarding.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    renderEntry();
    await screen.findByRole("heading", { name: "Set up your business" });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: "Luna Rentals" },
    });
    const form = screen.getByRole("button", { name: "Continue" }).closest("form");
    if (!form) throw new Error("Expected organization form");

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.createOnboarding).toHaveBeenCalledTimes(1);
    resolveCreate({ data: { clerk_org_id: "org_123" }, requestId: "req-create" });
  });

  it("reuses the idempotency key and keeps provider details out of retry errors", async () => {
    api.createOnboarding.mockRejectedValue(new Error("provider secret details"));

    renderEntry();
    await screen.findByRole("heading", { name: "Set up your business" });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: "Luna Rentals" },
    });
    const form = screen.getByRole("button", { name: "Continue" }).closest("form");
    if (!form) throw new Error("Expected organization form");

    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("We could not complete that request.")
    );
    fireEvent.submit(form);
    await waitFor(() => expect(api.createOnboarding).toHaveBeenCalledTimes(2));

    expect(api.createOnboarding.mock.calls[0]?.[1]).toBe(api.createOnboarding.mock.calls[1]?.[1]);
    expect(screen.getByRole("alert")).not.toHaveTextContent("provider secret details");
  });

  it("renders continue and restart actions for saved incomplete onboarding", async () => {
    api.getCurrentOnboarding.mockResolvedValue({
      data: {
        ...noOnboardingContext,
        onboarding: {
          id: "onboarding_123",
          clerk_org_id: "org_123",
          organization_name: "Luna Rentals",
          requested_slug: null,
          status: "incomplete",
          selected_plan_code: null,
          is_trial_eligible: true,
          created_at: "2026-09-19T00:00:00.000Z",
          updated_at: "2026-09-19T00:00:00.000Z",
        },
      },
      requestId: "req-current",
    });

    renderEntry();

    expect(
      await screen.findByRole("heading", { name: "Continue setting up Luna Rentals" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute(
      "href",
      "/onboarding/plan"
    );
    expect(screen.getByRole("button", { name: "Restart setup" })).toBeVisible();
  });

  it("confirms restart, abandons the unfinished onboarding once, and returns to organization setup", async () => {
    const incompleteContext = {
      ...noOnboardingContext,
      onboarding: {
        id: "onboarding_123",
        clerk_org_id: "org_123",
        organization_name: "Luna Rentals",
        requested_slug: null,
        status: "incomplete",
        selected_plan_code: null,
        is_trial_eligible: true,
        created_at: "2026-09-19T00:00:00.000Z",
        updated_at: "2026-09-19T00:00:00.000Z",
      },
    };
    api.getCurrentOnboarding
      .mockResolvedValueOnce({ data: incompleteContext, requestId: "req-current" })
      .mockResolvedValueOnce({ data: noOnboardingContext, requestId: "req-current-after-restart" });
    api.abandonOnboarding.mockResolvedValue({
      data: { ...incompleteContext.onboarding, status: "abandoned" },
      requestId: "req-abandon",
    });

    renderEntry();
    fireEvent.click(await screen.findByRole("button", { name: "Restart setup" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/current setup for Luna Rentals will be archived/i)).toBeVisible();

    const restartButtons = screen.getAllByRole("button", { name: "Restart setup" });
    fireEvent.click(restartButtons[restartButtons.length - 1]!);
    fireEvent.click(restartButtons[restartButtons.length - 1]!);

    await waitFor(() => expect(api.abandonOnboarding).toHaveBeenCalledTimes(1));
    expect(clerk.setActive).toHaveBeenCalledWith({ organization: null });
    expect(api.abandonOnboarding).toHaveBeenCalledWith(
      "onboarding_123",
      { reason_code: "not_now" },
      expect.any(String)
    );
    expect(await screen.findByRole("heading", { name: "Set up your business" })).toBeVisible();
  });

  it("confirms leaving before an organization exists and signs out without abandoning", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: "Set up your business" });

    fireEvent.click(screen.getByRole("button", { name: "Leave setup" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/signed out and can return later/i)).toBeVisible();

    const leaveButtons = screen.getAllByRole("button", { name: "Leave setup" });
    fireEvent.click(leaveButtons[leaveButtons.length - 1]!);

    await waitFor(() => expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
    expect(api.abandonOnboarding).not.toHaveBeenCalled();
  });

  it("abandons an incomplete setup before signing out", async () => {
    const onboarding = {
      id: "onboarding_exit",
      clerk_org_id: "org_exit",
      organization_name: "Exit Rentals",
      requested_slug: null,
      status: "incomplete",
      selected_plan_code: null,
      is_trial_eligible: true,
      created_at: "2026-09-19T00:00:00.000Z",
      updated_at: "2026-09-19T00:00:00.000Z",
    } as const;
    api.getCurrentOnboarding.mockResolvedValue({
      data: { ...noOnboardingContext, onboarding },
      requestId: "req-current-exit",
    });
    api.abandonOnboarding.mockResolvedValue({
      data: { ...onboarding, status: "abandoned" },
      requestId: "req-abandon-exit",
    });

    renderEntry();
    await screen.findByRole("heading", { name: "Continue setting up Exit Rentals" });
    fireEvent.click(screen.getByRole("button", { name: "Leave setup" }));
    const leaveButtons = screen.getAllByRole("button", { name: "Leave setup" });
    fireEvent.click(leaveButtons[leaveButtons.length - 1]!);

    await waitFor(() => expect(api.abandonOnboarding).toHaveBeenCalledTimes(1));
    expect(api.abandonOnboarding).toHaveBeenCalledWith(
      "onboarding_exit",
      { reason_code: "not_now" },
      expect.any(String)
    );
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" });
  });
});

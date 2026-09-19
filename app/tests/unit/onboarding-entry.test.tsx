import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));

const api = vi.hoisted(() => ({
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
  clerk.useClerk.mockReturnValue({ setActive: clerk.setActive });
  return render(<OnboardingEntry />);
}

describe("OnboardingEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("clerk-token");
    clerk.setActive.mockResolvedValue(undefined);
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

  it("renders the saved incomplete onboarding state", async () => {
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
    expect(
      screen.getByText("Your organization is saved. Plan selection will be the next step.")
    ).toBeVisible();
  });
});

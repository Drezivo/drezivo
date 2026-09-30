import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PostAuthResolver } from "@/components/auth/post-auth-resolver";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const resolver = vi.hoisted(() => ({ resolveStaffLanding: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth, useClerk: clerk.useClerk }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/resolve-staff-landing", () => ({ resolveStaffLanding: resolver.resolveStaffLanding }));

describe("PostAuthResolver", () => {
  const locationReplace = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken, isLoaded: true, isSignedIn: true, orgId: null });
    clerk.useClerk.mockReturnValue({ setActive: clerk.setActive });
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace: locationReplace } });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("resolves once and leaves with a full navigation, even when Clerk updates the active org mid-way", async () => {
    let finish: (value: unknown) => void = () => undefined;
    resolver.resolveStaffLanding.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const { rerender } = render(<PostAuthResolver />);
    // setActive changes orgId while the first resolution is still running.
    clerk.useAuth.mockReturnValue({ getToken: vi.fn(), isLoaded: true, isSignedIn: true, orgId: "org_new" });
    rerender(<PostAuthResolver />);
    finish({ kind: "workspace", workspace: {}, actor: {} });

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/calendar"));
    expect(resolver.resolveStaffLanding).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a user without a workspace to onboarding", async () => {
    resolver.resolveStaffLanding.mockResolvedValue({ kind: "onboarding" });
    render(<PostAuthResolver />);
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/onboarding"));
  });

  it("shows a retryable error instead of an endless spinner when resolution never finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resolver.resolveStaffLanding.mockReturnValue(new Promise(() => undefined));
    render(<PostAuthResolver />);
    expect(screen.getByText("Opening your workspace")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(20_000);

    await waitFor(() => expect(screen.getByText("We could not resolve your workspace")).toBeTruthy());
    expect(screen.getByText("Opening your workspace took too long. Please try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(locationReplace).not.toHaveBeenCalled();
  });
});

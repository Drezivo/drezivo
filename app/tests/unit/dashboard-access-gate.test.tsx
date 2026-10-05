import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardAccessGate } from "@/components/shell/dashboard-access-gate";

const clerk = vi.hoisted(() => ({
  getToken: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const resolver = vi.hoisted(() => ({ resolveStaffLanding: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
  useClerk: clerk.useClerk,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/resolve-staff-landing", () => ({
  invitationStateOf: () => undefined, resolveStaffLanding: resolver.resolveStaffLanding,
}));

describe("DashboardAccessGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.useAuth.mockReturnValue({
      getToken: clerk.getToken,
      isLoaded: true,
      isSignedIn: true,
      orgId: null,
    });
    clerk.useClerk.mockReturnValue({ setActive: clerk.setActive });
  });

  it("redirects authenticated users without a workspace to onboarding instead of rendering the dashboard", async () => {
    resolver.resolveStaffLanding.mockResolvedValue({ kind: "onboarding" });

    render(
      <DashboardAccessGate>
        <div>Private dashboard</div>
      </DashboardAccessGate>
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
  });

  it("renders the dashboard only after a workspace resolves successfully", async () => {
    resolver.resolveStaffLanding.mockResolvedValue({
      kind: "workspace",
      workspace: { clerk_org_id: "org_123", tenant: { id: "tenant_123" } },
    });

    render(
      <DashboardAccessGate>
        <div>Private dashboard</div>
      </DashboardAccessGate>
    );

    expect(await screen.findByText("Private dashboard")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalledWith("/onboarding");
  });

  it("does not restart the access check when Clerk returns new function references on render", async () => {
    clerk.useAuth.mockImplementation(() => ({
      getToken: () => clerk.getToken(),
      isLoaded: true,
      isSignedIn: true,
      orgId: "org_123",
    }));
    clerk.useClerk.mockImplementation(() => ({
      setActive: (params: { organization: string | null }) => clerk.setActive(params),
    }));
    resolver.resolveStaffLanding.mockResolvedValue({
      kind: "workspace",
      workspace: { clerk_org_id: "org_123", tenant: { id: "tenant_123" } },
    });

    render(
      <DashboardAccessGate>
        <div>Private dashboard</div>
      </DashboardAccessGate>
    );

    expect(await screen.findByText("Private dashboard")).toBeVisible();
    await waitFor(() => expect(resolver.resolveStaffLanding).toHaveBeenCalledTimes(1));
  });
});

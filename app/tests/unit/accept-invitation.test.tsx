import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { DrezivoApiError } from "@/lib/drezivo-api";

const invitationId = "11111111-1111-4111-8111-111111111111";
const clerk = vi.hoisted(() => ({
  claimMembershipInvitation: vi.fn(),
  create: vi.fn(),
  getActorContext: vi.fn(),
  getWorkspaces: vi.fn(),
  setActive: vi.fn(),
  useAuth: vi.fn(),
  useClerk: vi.fn(),
  useSignIn: vi.fn(),
  useSignUp: vi.fn(),
}));
const location = vi.hoisted(() => ({ replace: vi.fn() }));
const workspaces = vi.hoisted(() => ({ listAllAccessibleWorkspaces: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: clerk.useAuth,
  useClerk: clerk.useClerk,
  useSignIn: clerk.useSignIn,
  useSignUp: clerk.useSignUp,
}));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({
    claimMembershipInvitation: clerk.claimMembershipInvitation,
    getActorContext: clerk.getActorContext,
    getWorkspaces: clerk.getWorkspaces,
  }),
  DrezivoApiError: class DrezivoApiError extends Error {
    readonly status: number;
    constructor(message: string, options: { status: number }) {
      super(message);
      this.status = options.status;
    }
  },
}));
vi.mock("@/lib/workspace-access", () => ({
  listAllAccessibleWorkspaces: workspaces.listAllAccessibleWorkspaces,
}));

describe("AcceptInvitation", () => {
  const originalLocation = window.location;
  const originalRandomUuid = globalThis.crypto.randomUUID;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window.history, "replaceState");
    window.history.replaceState(
      null,
      "",
      `/accept-invitation/${invitationId}?__clerk_ticket=one-time-ticket&__clerk_status=sign_up&organization_id=org_staff`
    );
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: location.replace },
    });
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    clerk.useAuth.mockReturnValue({
      getToken: vi.fn().mockResolvedValue("token"),
      isLoaded: true,
      isSignedIn: false,
    });
    clerk.setActive.mockResolvedValue(undefined);
    clerk.useClerk.mockReturnValue({ setActive: clerk.setActive });
    clerk.useSignIn.mockReturnValue({ isLoaded: true, signIn: { create: clerk.create } });
    clerk.create.mockResolvedValue({ status: "complete", createdSessionId: "session_1" });
    clerk.useSignUp.mockReturnValue({ isLoaded: true, signUp: { create: clerk.create } });
    clerk.claimMembershipInvitation.mockResolvedValue({
      data: { tenant: { id: "tenant_staff" }, membership: { role: "frontdesk" } },
    });
    workspaces.listAllAccessibleWorkspaces.mockResolvedValue([
      { clerk_org_id: "org_staff", role: "frontdesk", tenant: { id: "tenant_staff" } },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: originalRandomUuid,
    });
    window.history.replaceState(null, "", "/");
  });

  it("strips the ticket from the address bar, completes sign-up, and claims only the linked invitation", async () => {
    render(<AcceptInvitation invitationId={invitationId} />);

    await waitFor(() => expect(location.replace).toHaveBeenCalledWith("/calendar"));
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      `/accept-invitation/${invitationId}?organization_id=org_staff`
    );
    expect(clerk.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "one-time-ticket" });
    expect(clerk.setActive).toHaveBeenCalledWith(
      expect.objectContaining({ session: "session_1", organization: "org_staff" })
    );
    expect(clerk.claimMembershipInvitation).toHaveBeenCalledWith(
      invitationId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    expect(clerk.claimMembershipInvitation.mock.calls[0]).toHaveLength(2);
  });

  it("shows a terminal safe error for an invitation that cannot be claimed by this account", async () => {
    clerk.claimMembershipInvitation.mockRejectedValue(
      new DrezivoApiError("private backend detail", { status: 404 })
    );

    render(<AcceptInvitation invitationId={invitationId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not valid for this account or workspace"
    );
    expect(screen.queryByRole("button", { name: "Check access again" })).not.toBeInTheDocument();
    expect(location.replace).not.toHaveBeenCalled();
  });
});

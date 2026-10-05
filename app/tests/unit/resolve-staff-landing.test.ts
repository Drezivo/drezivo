import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getActorContext: vi.fn(),
  getCurrentOnboarding: vi.fn(),
  getWorkspaces: vi.fn(),
}));

vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => api,
  DrezivoApiError: class DrezivoApiError extends Error {
    readonly status: number;

    constructor(message: string, options: { status: number }) {
      super(message);
      this.status = options.status;
    }
  },
}));

const { invitationStateOf, resolveStaffLanding } = await import("@/lib/resolve-staff-landing");

const workspaceA = {
  clerk_org_id: "org_a",
  role: "owner",
  membership_updated_at: "2026-09-20T00:00:00.000Z",
  tenant: { id: "11111111-1111-4111-8111-111111111111" },
};

const workspaceB = {
  clerk_org_id: "org_b",
  role: "frontdesk",
  membership_updated_at: "2026-09-20T00:00:00.000Z",
  tenant: { id: "22222222-2222-4222-8222-222222222222" },
};

describe("resolveStaffLanding", () => {
  const getToken = vi.fn().mockResolvedValue("token");
  const setActive = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue("token");
    setActive.mockResolvedValue(undefined);
  });

  it("routes an account with no workspaces back to onboarding and clears a stale Clerk organization", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [], page_meta: { next_cursor: null, has_more: false } },
    });
    api.getCurrentOnboarding.mockResolvedValue({
      data: {
        onboarding: null,
        has_current_owned_tenant: false,
        has_consumed_lifetime_trial: false,
      },
    });

    await expect(
      resolveStaffLanding({ activeOrganizationId: "org_abandoned", getToken, setActive })
    ).resolves.toEqual({ kind: "onboarding" });

    expect(setActive).toHaveBeenCalledWith({ organization: null });
    expect(api.getActorContext).not.toHaveBeenCalled();
  });

  it("keeps an accessible active workspace and verifies actor context before allowing dashboard access", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [workspaceA, workspaceB], page_meta: { next_cursor: null, has_more: false } },
    });
    api.getActorContext.mockResolvedValue({
      data: { tenant: { id: workspaceB.tenant.id }, membership: { role: "frontdesk" } },
    });

    const result = await resolveStaffLanding({
      activeOrganizationId: "org_b",
      getToken,
      setActive,
    });

    // The verified actor is returned too, so the dashboard shell can reuse it instead of refetching.
    expect(result).toEqual({
      kind: "workspace",
      workspace: workspaceB,
      actor: {
        tenant: { id: workspaceB.tenant.id },
        membership: { role: "frontdesk" },
      },
    });
    expect(setActive).not.toHaveBeenCalled();
    expect(api.getActorContext).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit workspace choice after sign-in when multiple businesses are accessible", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [workspaceA, workspaceB], page_meta: { next_cursor: null, has_more: false } },
    });

    await expect(
      resolveStaffLanding({
        activeOrganizationId: "org_b",
        getToken,
        setActive,
        requireWorkspaceChoice: true,
      })
    ).resolves.toEqual({ kind: "workspaces", workspaces: [workspaceA, workspaceB] });

    expect(api.getActorContext).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it("switches from a stale Clerk organization to the first accessible Drezivo workspace", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [workspaceA], page_meta: { next_cursor: null, has_more: false } },
    });
    api.getActorContext.mockResolvedValue({
      data: { tenant: { id: workspaceA.tenant.id }, membership: { role: "owner" } },
    });

    await expect(
      resolveStaffLanding({ activeOrganizationId: "org_stale", getToken, setActive })
    ).resolves.toMatchObject({ kind: "workspace", workspace: workspaceA });

    expect(setActive).toHaveBeenCalledWith({ organization: "org_a" });
  });

  it("fails closed when the account claims an owned tenant but no accessible workspace exists", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [], page_meta: { next_cursor: null, has_more: false } },
    });
    api.getCurrentOnboarding.mockResolvedValue({
      data: {
        onboarding: null,
        has_current_owned_tenant: true,
        has_consumed_lifetime_trial: true,
      },
    });

    await expect(
      resolveStaffLanding({ activeOrganizationId: null, getToken, setActive })
    ).rejects.toThrow(/no accessible workspace membership/i);
  });

  describe("invited front-desk members", () => {
    const empty = { data: { items: [], page_meta: { next_cursor: null, has_more: false } } };

    it("never accepts invitations automatically and routes pending invitation accounts to the invitation link", async () => {
      const accept = vi.fn().mockResolvedValue(undefined);
      api.getWorkspaces.mockResolvedValue(empty);

      const result = await resolveStaffLanding({
        activeOrganizationId: null,
        getToken,
        setActive,
        invitations: { loadPending: async () => [{ accept }], isInvitedMember: false },
      });

      expect(result).toEqual({ kind: "invitation-required" });
      expect(accept).not.toHaveBeenCalled();
      expect(api.getCurrentOnboarding).not.toHaveBeenCalled();
    });

    it("does not send an invited member with a delayed claim to owner onboarding", async () => {
      api.getWorkspaces.mockResolvedValue(empty);

      await expect(
        resolveStaffLanding({
          activeOrganizationId: "org_b",
          getToken,
          setActive,
          invitations: { loadPending: async () => [], isInvitedMember: true },
        })
      ).resolves.toEqual({ kind: "invitation-required" });

      expect(api.getCurrentOnboarding).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
    });

    it("still sends an owner with no invitation to onboarding", async () => {
      api.getWorkspaces.mockResolvedValue(empty);
      api.getCurrentOnboarding.mockResolvedValue({
        data: {
          onboarding: null,
          has_current_owned_tenant: false,
          has_consumed_lifetime_trial: false,
        },
      });

      await expect(
        resolveStaffLanding({
          activeOrganizationId: null,
          getToken,
          setActive,
          invitations: { loadPending: async () => [], isInvitedMember: false },
        })
      ).resolves.toEqual({ kind: "onboarding" });
      expect(api.getWorkspaces).toHaveBeenCalledTimes(1);
    });

    it("reads Clerk's user: pending invitations, and plain-member organization roles only", async () => {
      const accept = vi.fn();
      const user = {
        organizationMemberships: [{ role: "org:admin" }],
        getOrganizationInvitations: vi.fn().mockResolvedValue({ data: [{ accept }] }),
      };

      const state = invitationStateOf(user);
      expect(state?.isInvitedMember).toBe(false);
      await expect(state?.loadPending()).resolves.toEqual([{ accept }]);
      expect(user.getOrganizationInvitations).toHaveBeenCalledWith({ status: "pending" });
      expect(
        invitationStateOf({ ...user, organizationMemberships: [{ role: "org:member" }] })
          ?.isInvitedMember
      ).toBe(true);
      expect(invitationStateOf(null)).toBeUndefined();
    });
  });
});

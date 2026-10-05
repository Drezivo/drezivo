import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getActorContext: vi.fn(), getWorkspaces: vi.fn() }));

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

const { activateAccessibleWorkspace, listAllAccessibleWorkspaces } =
  await import("@/lib/workspace-access");

const ownerWorkspace = {
  clerk_org_id: "org_owner",
  role: "owner" as const,
  membership_updated_at: "2026-10-05T00:00:00.000Z",
  tenant: { id: "11111111-1111-4111-8111-111111111111", name: "Owner business" },
};
const frontDeskWorkspace = {
  clerk_org_id: "org_staff",
  role: "frontdesk" as const,
  membership_updated_at: "2026-10-05T00:00:00.000Z",
  tenant: { id: "22222222-2222-4222-8222-222222222222", name: "Staff business" },
};

describe("workspace access", () => {
  const getToken = vi.fn().mockResolvedValue("token");
  const setActive = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue("token");
    setActive.mockResolvedValue(undefined);
  });

  it("reads every API page when building the workspace chooser", async () => {
    api.getWorkspaces
      .mockResolvedValueOnce({
        data: { items: [ownerWorkspace], page_meta: { next_cursor: "next", has_more: true } },
      })
      .mockResolvedValueOnce({
        data: { items: [frontDeskWorkspace], page_meta: { next_cursor: null, has_more: false } },
      });

    await expect(listAllAccessibleWorkspaces(api as never)).resolves.toEqual([
      ownerWorkspace,
      frontDeskWorkspace,
    ]);
    expect(api.getWorkspaces).toHaveBeenNthCalledWith(1, { limit: 50 });
    expect(api.getWorkspaces).toHaveBeenNthCalledWith(2, { limit: 50, cursor: "next" });
  });

  it("refuses a workspace absent from the current API projection", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [ownerWorkspace], page_meta: { next_cursor: null, has_more: false } },
    });

    await expect(
      activateAccessibleWorkspace({ organizationId: "org_other", getToken, setActive })
    ).rejects.toMatchObject({ status: 403 });
    expect(setActive).not.toHaveBeenCalled();
    expect(api.getActorContext).not.toHaveBeenCalled();
  });

  it("activates the selected accessible workspace and verifies tenant and role in actor context", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: {
        items: [ownerWorkspace, frontDeskWorkspace],
        page_meta: { next_cursor: null, has_more: false },
      },
    });
    const actor = {
      tenant: { id: frontDeskWorkspace.tenant.id },
      membership: { role: "frontdesk" },
    };
    api.getActorContext.mockResolvedValue({ data: actor });

    await expect(
      activateAccessibleWorkspace({ organizationId: "org_staff", getToken, setActive })
    ).resolves.toEqual({
      workspace: frontDeskWorkspace,
      actor,
    });
    expect(setActive).toHaveBeenCalledWith(expect.objectContaining({ organization: "org_staff" }));
    expect(api.getActorContext).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the selected organization's resulting actor differs from the listed role", async () => {
    api.getWorkspaces.mockResolvedValue({
      data: { items: [frontDeskWorkspace], page_meta: { next_cursor: null, has_more: false } },
    });
    api.getActorContext.mockResolvedValue({
      data: { tenant: { id: frontDeskWorkspace.tenant.id }, membership: { role: "owner" } },
    });

    await expect(
      activateAccessibleWorkspace({ organizationId: "org_staff", getToken, setActive })
    ).rejects.toMatchObject({ status: 409 });
  });
});

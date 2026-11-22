import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceChooser } from "@/components/auth/workspace-chooser";

const mocks = vi.hoisted(() => ({
  user: { primaryEmailAddress: { emailAddress: "drezivoshop@gmail.com", verification: { status: "verified" } } },
  getCurrentOnboarding: vi.fn(),
  list: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  getToken: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: mocks.getToken }),
  useClerk: () => ({ user: mocks.user, setActive: mocks.setActive }),
}));
const router = { push: mocks.push, replace: mocks.replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({ getCurrentOnboarding: mocks.getCurrentOnboarding }),
  DrezivoApiError: class DrezivoApiError extends Error {},
}));
vi.mock("@/lib/workspace-access", () => ({
  listAllAccessibleWorkspaces: mocks.list,
  activateAccessibleWorkspace: vi.fn(),
}));

describe("workspace creation shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.primaryEmailAddress.emailAddress = "drezivoshop@gmail.com";
    mocks.user.primaryEmailAddress.verification.status = "verified";
    mocks.getCurrentOnboarding.mockResolvedValue({ data: { has_current_owned_tenant: false } });
    mocks.list.mockResolvedValue([]);
  });

  it.each([0, 1, 2])("offers creation with %i accessible workspaces", async (count) => {
    mocks.list.mockResolvedValue(Array.from({ length: count }, (_, index) => ({
      clerk_org_id: `org_${index}`,
      tenant: { name: `Shop ${index}` },
      role: "frontdesk",
    })));
    render(<WorkspaceChooser />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Workspace" }));
    expect(mocks.push).toHaveBeenCalledWith("/onboarding");
    if (count === 0) expect(screen.getByText("You have no workspaces yet.")).toBeVisible();
  });

  it("hides creation for a different account", async () => {
    mocks.user.primaryEmailAddress.emailAddress = "staff@example.com";
    mocks.list.mockResolvedValue([0, 1].map((index) => ({ clerk_org_id: `org_${index}`, tenant: { name: `Shop ${index}` }, role: "frontdesk" })));
    render(<WorkspaceChooser />);
    await screen.findByText("Shop 0");
    expect(screen.queryByRole("button", { name: "Create Workspace" })).not.toBeInTheDocument();
    expect(mocks.getCurrentOnboarding).not.toHaveBeenCalled();
  });

  it("does not offer creation for an unverified email", async () => {
    mocks.user.primaryEmailAddress.verification.status = "unverified";
    mocks.list.mockResolvedValue([0, 1].map((index) => ({ clerk_org_id: `org_${index}`, tenant: { name: `Shop ${index}` }, role: "frontdesk" })));
    render(<WorkspaceChooser />);
    await screen.findByText("Shop 0");
    expect(screen.queryByRole("button", { name: "Create Workspace" })).not.toBeInTheDocument();
  });

  it("hides creation when the account already owns a workspace", async () => {
    mocks.getCurrentOnboarding.mockResolvedValue({ data: { has_current_owned_tenant: true } });
    mocks.list.mockResolvedValue([0, 1].map((index) => ({ clerk_org_id: `org_${index}`, tenant: { name: `Shop ${index}` }, role: "frontdesk" })));
    render(<WorkspaceChooser />);
    await screen.findByText("Shop 0");
    expect(screen.queryByRole("button", { name: "Create Workspace" })).not.toBeInTheDocument();
  });

  it("fails closed if eligibility cannot be loaded", async () => {
    mocks.getCurrentOnboarding.mockRejectedValue(new Error("unavailable"));
    render(<WorkspaceChooser />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your workspaces");
    expect(screen.queryByRole("button", { name: "Create Workspace" })).not.toBeInTheDocument();
  });
});

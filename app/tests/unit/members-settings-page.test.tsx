import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembersSettingsPage } from "@/components/settings/members-settings-page";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const actorState = vi.hoisted(() => ({ role: "owner" as "owner" | "frontdesk" }));
const api = vi.hoisted(() => ({
  getMemberRoster: vi.fn(),
  getMembershipInvitations: vi.fn(),
  createMembershipInvitation: vi.fn(),
  resendMembershipInvitation: vi.fn(),
  cancelMembershipInvitation: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/components/shell/dashboard-access-gate", () => ({
  useVerifiedActorContext: () => ({ membership: { role: actorState.role } }),
}));
vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => api,
  DrezivoApiError: class DrezivoApiError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

const owner = {
  id: "00000000-0000-4000-8000-000000008001",
  name: "Riley Owner",
  email: "owner@example.test",
  role: "owner",
};
const frontDesk = {
  id: "00000000-0000-4000-8000-000000008002",
  name: "Sam Staff",
  email: "staff@example.test",
  role: "frontdesk",
};
const roster = {
  members: [owner, frontDesk],
  frontdesk_seats: { used: 2, max: 5 },
};
const invitations = [
  invitation("00000000-0000-4000-8000-000000008101", "pending@example.test", "pending"),
  invitation("00000000-0000-4000-8000-000000008102", "expired@example.test", "expired"),
  invitation("00000000-0000-4000-8000-000000008103", "revoked@example.test", "revoked"),
  invitation("00000000-0000-4000-8000-000000008104", "accepted@example.test", "accepted"),
];

function invitation(
  id: string,
  email: string,
  status: "pending" | "expired" | "revoked" | "accepted"
) {
  return {
    id,
    email,
    status,
    expires_at: "2026-10-12T00:00:00.000Z",
    created_at: "2026-10-05T00:00:00.000Z",
  };
}

function installDefaults() {
  clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
  clerk.getToken.mockResolvedValue("test-token");
  api.getMemberRoster.mockResolvedValue({ data: roster });
  api.getMembershipInvitations.mockResolvedValue({
    data: { items: invitations, page_meta: { next_cursor: null, has_more: false } },
  });
  api.createMembershipInvitation.mockResolvedValue({
    data: invitation("00000000-0000-4000-8000-000000008105", "new@example.test", "pending"),
  });
  api.resendMembershipInvitation.mockResolvedValue({ data: invitations[1] });
  api.cancelMembershipInvitation.mockResolvedValue({ data: invitations[0] });
}

describe("MembersSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorState.role = "owner";
    installDefaults();
  });

  it("denies direct Front Desk access without requesting roster or invitation data", () => {
    actorState.role = "frontdesk";
    render(<MembersSettingsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Owner access required");
    expect(api.getMemberRoster).not.toHaveBeenCalled();
    expect(api.getMembershipInvitations).not.toHaveBeenCalled();
  });

  it("shows a loading state until both owner data requests complete", async () => {
    let finishRoster: ((value: unknown) => void) | undefined;
    api.getMemberRoster.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRoster = resolve;
        })
    );
    render(<MembersSettingsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading team members");
    finishRoster?.({ data: roster });
    expect(await screen.findByText("Riley Owner")).toBeVisible();
  });

  it("shows the roster, seat usage, and owner-only invitation identities and actions", async () => {
    render(<MembersSettingsPage />);

    expect(await screen.findByText("Riley Owner")).toBeVisible();
    expect(screen.getByText("Sam Staff")).toBeVisible();
    expect(screen.getByLabelText("2 of 5 Front Desk seats used")).toHaveTextContent("2 / 5 used");
    expect(screen.getByText("pending@example.test")).toBeVisible();
    expect(screen.getByText("expired@example.test")).toBeVisible();

    expect(screen.getAllByRole("button", { name: "Resend" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Invite Front Desk" })).toBeEnabled();
  });

  it("disables invites at the seat limit while still showing the roster", async () => {
    api.getMemberRoster.mockResolvedValueOnce({
      data: { ...roster, frontdesk_seats: { used: 5, max: 5 } },
    });
    render(<MembersSettingsPage />);

    expect(await screen.findByText("The Front Desk seat limit has been reached.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Invite Front Desk" })).toBeDisabled();
    expect(screen.getByText("Riley Owner")).toBeVisible();
  });

  it("creates a fixed-role Front Desk invitation once with an idempotency key", async () => {
    let finishRequest: ((value: unknown) => void) | undefined;
    api.createMembershipInvitation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        })
    );
    render(<MembersSettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Invite Front Desk" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "new@example.test" },
    });
    const form = screen.getByRole("button", { name: "Invite staff" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(api.createMembershipInvitation).toHaveBeenCalledTimes(1));
    expect(api.createMembershipInvitation).toHaveBeenCalledWith(
      { email: "new@example.test" },
      expect.any(String)
    );
    const idempotencyKey = api.createMembershipInvitation.mock.calls[0]?.[1];
    expect(idempotencyKey).toEqual(expect.any(String));

    finishRequest?.({ data: invitations[0] });
    expect(await screen.findByText(/Delivery is handled in the background/)).toBeVisible();
  });

  it("resends expired invitations and refreshes server state", async () => {
    render(<MembersSettingsPage />);
    await screen.findByText("expired@example.test");
    const expiredRow = screen.getByText("expired@example.test").closest("li");
    expect(expiredRow).not.toBeNull();
    fireEvent.click(within(expiredRow!).getByRole("button", { name: "Resend" }));

    await waitFor(() =>
      expect(api.resendMembershipInvitation).toHaveBeenCalledWith(
        invitations[1]!.id,
        expect.any(String)
      )
    );
    await waitFor(() => expect(api.getMemberRoster).toHaveBeenCalledTimes(2));
  });

  it("cancels pending invitations with an idempotency key", async () => {
    render(<MembersSettingsPage />);
    await screen.findByText("pending@example.test");
    const pendingRow = screen.getByText("pending@example.test").closest("li");
    expect(pendingRow).not.toBeNull();
    fireEvent.click(within(pendingRow!).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(api.cancelMembershipInvitation).toHaveBeenCalledWith(
        invitations[0]!.id,
        expect.any(String)
      )
    );
    await waitFor(() => expect(api.getMemberRoster).toHaveBeenCalledTimes(2));
  });

  it("loads additional invitation pages using the server cursor", async () => {
    api.getMembershipInvitations
      .mockResolvedValueOnce({
        data: {
          items: [invitations[0]],
          page_meta: { next_cursor: "next-page", has_more: true },
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            invitation("00000000-0000-4000-8000-000000008106", "older@example.test", "revoked"),
          ],
          page_meta: { next_cursor: null, has_more: false },
        },
      });
    render(<MembersSettingsPage />);

    expect(await screen.findByText("pending@example.test")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more invitations" }));

    expect(await screen.findByText("older@example.test")).toBeVisible();
    expect(api.getMembershipInvitations).toHaveBeenLastCalledWith({
      limit: 50,
      cursor: "next-page",
    });
  });

  it("shows a retryable roster load error", async () => {
    api.getMemberRoster.mockRejectedValueOnce(new Error("offline"));
    render(<MembersSettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your team");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Riley Owner")).toBeVisible();
  });

  it("shows the empty state when there are no invitations", async () => {
    api.getMembershipInvitations.mockResolvedValueOnce({
      data: { items: [], page_meta: { next_cursor: null, has_more: false } },
    });
    render(<MembersSettingsPage />);

    expect(await screen.findByText("No invitations yet.")).toBeVisible();
  });
});

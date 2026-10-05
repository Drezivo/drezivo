import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const ownerId = "00000000-0000-4000-8000-000000008001";
const invitationId = "00000000-0000-4000-8000-000000008101";
const requestId = "00000000-0000-4000-8000-000000008199";

function success(data: unknown) {
  return new Response(JSON.stringify({ success: true, data, request_id: requestId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Drezivo Members API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("test-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("reads roster and owner invitation pages with response validation", async () => {
    fetchMock
      .mockResolvedValueOnce(
        success({
          members: [
            { id: ownerId, name: "Riley Owner", email: "owner@example.test", role: "owner" },
          ],
          frontdesk_seats: { used: 0, max: 5 },
        })
      )
      .mockResolvedValueOnce(
        success({
          items: [
            {
              id: invitationId,
              email: "staff@example.test",
              status: "pending",
              expires_at: "2026-10-12T00:00:00.000Z",
              created_at: "2026-10-05T00:00:00.000Z",
            },
          ],
          page_meta: { next_cursor: "next-cursor", has_more: true },
        })
      );
    const client = createDrezivoApiClient(getToken);

    const roster = await client.getMemberRoster();
    const page = await client.getMembershipInvitations({ limit: 25, cursor: "current-cursor" });

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/api/v1/members");
    const invitationsUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(invitationsUrl.pathname).toBe("/api/v1/membership-invitations");
    expect(invitationsUrl.searchParams.get("limit")).toBe("25");
    expect(invitationsUrl.searchParams.get("cursor")).toBe("current-cursor");
    expect(roster.data.frontdesk_seats).toEqual({ used: 0, max: 5 });
    expect(page.data.items[0]).toMatchObject({ email: "staff@example.test", status: "pending" });
  });

  it("uses idempotency keys for create, resend, and cancel invitation commands", async () => {
    const invitation = {
      id: invitationId,
      status: "pending",
      expires_at: "2026-10-12T00:00:00.000Z",
      created_at: "2026-10-05T00:00:00.000Z",
    };
    fetchMock
      .mockResolvedValueOnce(success(invitation))
      .mockResolvedValueOnce(success(invitation))
      .mockResolvedValueOnce(success(invitation));
    const client = createDrezivoApiClient(getToken);

    const created = await client.createMembershipInvitation(
      { email: "staff@example.test" },
      "invite-key"
    );
    const resent = await client.resendMembershipInvitation(invitationId, "resend-key");
    const cancelled = await client.cancelMembershipInvitation(invitationId, "cancel-key");

    expect(created.data).toEqual(invitation);
    expect(resent.data).toEqual(invitation);
    expect(cancelled.data).toEqual(invitation);
    expect(created.data).not.toHaveProperty("email");

    const create = fetchMock.mock.calls[0]!;
    expect(new URL(String(create[0])).pathname).toBe("/api/v1/membership-invitations");
    expect(create[1]?.method).toBe("POST");
    expect(new Headers(create[1]?.headers).get("Idempotency-Key")).toBe("invite-key");
    expect(JSON.parse(String(create[1]?.body))).toEqual({ email: "staff@example.test" });

    const resend = fetchMock.mock.calls[1]!;
    expect(new URL(String(resend[0])).pathname).toBe(
      `/api/v1/membership-invitations/${invitationId}/resend`
    );
    expect(new Headers(resend[1]?.headers).get("Idempotency-Key")).toBe("resend-key");
    expect(JSON.parse(String(resend[1]?.body))).toEqual({});

    const cancel = fetchMock.mock.calls[2]!;
    expect(new URL(String(cancel[0])).pathname).toBe(
      `/api/v1/membership-invitations/${invitationId}/cancel`
    );
    expect(new Headers(cancel[1]?.headers).get("Idempotency-Key")).toBe("cancel-key");
    expect(JSON.parse(String(cancel[1]?.body))).toEqual({});
  });
});

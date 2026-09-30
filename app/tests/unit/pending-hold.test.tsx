import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimHoldOwner,
  clearPendingHold,
  isHoldOwned,
  readHoldDraft,
  readPendingHold,
  saveHoldDraft,
  savePendingHold,
} from "@/lib/pending-hold";

const TENANT = "11111111-1111-4111-8111-111111111111";
const HOLD = "22222222-2222-4222-8222-222222222222";

const actor = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/components/shell/dashboard-access-gate", () => ({ useVerifiedActorContext: () => actor.value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/reservations/new-reservation-sheet", () => ({
  NewReservationSheet: ({ resumeReservationId }: { resumeReservationId: string | null }) => <div data-testid="resumed-sheet">{resumeReservationId}</div>,
}));

describe("pending hold store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("remembers a live hold per workspace and forgets it with its draft when it ends", () => {
    savePendingHold(TENANT, HOLD);
    saveHoldDraft(HOLD, { fullName: "Ana Cruz" });
    expect(readPendingHold(TENANT)).toEqual({ reservationId: HOLD });
    expect(readPendingHold("33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(readHoldDraft<{ fullName: string }>(HOLD)).toEqual({ fullName: "Ana Cruz" });

    clearPendingHold(TENANT, HOLD);
    expect(readPendingHold(TENANT)).toBeNull();
    expect(readHoldDraft(HOLD)).toBeNull();
  });

  it("ignores a malformed pointer instead of trusting it", () => {
    window.localStorage.setItem(`drezivo:pending-hold:${TENANT}`, JSON.stringify({ reservationId: "../../etc" }));
    expect(readPendingHold(TENANT)).toBeNull();
  });

  it("tracks ownership so only one sheet shows a hold", () => {
    expect(isHoldOwned()).toBe(false);
    const release = claimHoldOwner();
    expect(isHoldOwned()).toBe(true);
    release();
    release();
    expect(isHoldOwned()).toBe(false);
  });
});

describe("PendingHoldGuard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    actor.value = {
      tenant: { id: TENANT, timezone: "Asia/Manila" },
      active_branch_id: "b1",
      branches: [{ id: "b1", timezone: "Asia/Manila" }],
      branch_grants: [{ branch_id: "b1", permission_codes: ["reservations.manage"] }],
    };
  });

  it("reopens the sheet on a live hold after a refresh", async () => {
    savePendingHold(TENANT, HOLD);
    const { PendingHoldGuard } = await import("@/components/reservations/pending-hold-guard");
    render(<PendingHoldGuard />);
    expect(screen.getByTestId("resumed-sheet").textContent).toBe(HOLD);
  });

  it("stays out of the way while another sheet owns the hold, and takes over when it is released", async () => {
    const release = claimHoldOwner();
    savePendingHold(TENANT, HOLD);
    const { PendingHoldGuard } = await import("@/components/reservations/pending-hold-guard");
    render(<PendingHoldGuard />);
    expect(screen.queryByTestId("resumed-sheet")).toBeNull();

    act(() => release());
    expect(screen.getByTestId("resumed-sheet").textContent).toBe(HOLD);
  });
});

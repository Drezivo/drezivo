import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBilling: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));

vi.mock("@/lib/drezivo-api", () => ({
  createDrezivoApiClient: () => ({ getBilling: mocks.getBilling }),
  DrezivoApiError: class DrezivoApiError extends Error {},
}));

import { SubscribeDialog } from "@/components/billing/subscribe-dialog";

function billingFor(code: "starter" | "standard") {
  const starter = code === "starter";
  return {
    plan: {
      code,
      name: starter ? "Starter" : "Standard",
      monthly_minor: starter ? "14900" : "29900",
      currency: "PHP",
      physical_assets_max: starter ? 125 : 300,
      frontdesk_seats_max: starter ? 0 : 3,
      trial_days: 14,
    },
    subscription: {
      status: "trialing",
      trial_ends_at: "2026-10-22T00:00:00.000Z",
      read_only_until: null,
      current_period_end: "2026-10-22T00:00:00.000Z",
    },
    access: {
      level: "full",
      reason: "trial",
      ends_at: "2026-10-22T00:00:00.000Z",
      days_left: 14,
      pending_payment: false,
      storefront_online: true,
      storefront_offline_at: null,
      read_only_until: null,
    },
    can_pay: true,
    payment_methods: [],
    payments: [],
  };
}

describe("SubscribeDialog plan details", () => {
  beforeEach(() => {
    mocks.getBilling.mockReset();
  });

  it("shows Starter billing details without Front Desk seats", async () => {
    mocks.getBilling.mockResolvedValue({ data: billingFor("starter") });

    render(<SubscribeDialog open onOpenChange={vi.fn()} onSubmitted={vi.fn()} />);

    expect(
      await screen.findByText("Starter plan: ₱149 a month, up to 125 active garments.")
    ).toBeTruthy();
    expect(screen.queryByText(/Front Desk staff/)).toBeNull();
  });

  it("shows Standard billing details from the same response", async () => {
    mocks.getBilling.mockResolvedValue({ data: billingFor("standard") });

    render(<SubscribeDialog open onOpenChange={vi.fn()} onSubmitted={vi.fn()} />);

    expect(
      await screen.findByText(
        "Standard plan: ₱299 a month, up to 300 active garments and 3 Front Desk staff."
      )
    ).toBeTruthy();
  });
});

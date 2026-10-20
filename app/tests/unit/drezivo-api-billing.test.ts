import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const requestId = "00000000-0000-4000-8000-000000009199";

describe("Drezivo billing API client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("starts a trial at the API's plan-change route and reads the subscription it returns", async () => {
    const summary = {
      id: "00000000-0000-4000-8000-000000009001",
      plan_code: "starter",
      status: "trialing",
      trial_ends_at: "2026-10-29T08:00:00.000Z",
      grace_ends_at: null,
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: summary, request_id: requestId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await createDrezivoApiClient(vi.fn().mockResolvedValue("token")).changeSubscriptionPlan(
      { plan_code: "starter" },
      "trial-intent-0001"
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe("/api/v1/subscription/plan");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("trial-intent-0001");
    expect(result.data).toEqual(summary);
  });
});

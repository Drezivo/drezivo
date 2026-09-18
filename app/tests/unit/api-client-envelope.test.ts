import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const clerkState = vi.hoisted(() => {
  process.env["NEXT_PUBLIC_API_BASE_URL"] = "https://api.test";
  return {
    getToken: vi.fn(async () => "token_123"),
    orgId: "org_123" as string | null,
    organization: { id: "org_123" },
  };
});

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: clerkState.getToken, orgId: clerkState.orgId }),
  useOrganization: () => ({ organization: clerkState.organization }),
}));

import { ApiError, useApiClient } from "@/lib/api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("app API envelope handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clerkState.getToken.mockClear();
    clerkState.orgId = "org_123";
  });

  it("unwraps a valid success envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ success: true, data: { branchId: "branch_123" }, request_id: "req_123" })
    );

    const { result } = renderHook(() => useApiClient());

    await expect(result.current.get<{ branchId: string }>("/branches")).resolves.toEqual({
      branchId: "branch_123",
    });
  });

  it("rejects a success envelope without request_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ success: true, data: { branchId: "branch_123" } })
    );

    const { result } = renderHook(() => useApiClient());

    await expect(result.current.get("/branches")).rejects.toMatchObject({
      code: "unknown_error",
      status: 200,
    });
  });

  it("rejects a failure envelope with an unknown error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "SERVER_CHANGED", message: "Unexpected failure." },
          request_id: "req_123",
        },
        409
      )
    );

    const { result } = renderHook(() => useApiClient());

    await expect(result.current.get("/branches")).rejects.toMatchObject({
      code: "unknown_error",
      status: 409,
    });
  });

  it("maps a valid nested failure envelope to ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: "STATE_CONFLICT",
            message: "The reservation has already moved on.",
            fields: [{ field: "status", message: "must be held" }],
          },
          request_id: "req_123",
        },
        409
      )
    );

    const { result } = renderHook(() => useApiClient());

    const failure = result.current.get("/branches");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: "STATE_CONFLICT",
      requestId: "req_123",
      fields: [{ field: "status", message: "must be held" }],
    });
  });

  it("allows pre-tenant onboarding mutations without an active organization", async () => {
    clerkState.orgId = null;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ success: true, data: { id: "onboarding_123" }, request_id: "req_123" }, 201)
    );

    const { result } = renderHook(() => useApiClient());

    await expect(
      result.current.post(
        "/onboarding",
        { organization_name: "Drezivo Formalwear" },
        "idem_12345678"
      )
    ).resolves.toEqual({ id: "onboarding_123" });
  });
});

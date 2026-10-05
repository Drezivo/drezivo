import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...actual, clerkMiddleware: (handler: unknown) => handler };
});

const { routeAccess } = await import("@/middleware");

describe("staff app middleware", () => {
  it("keeps invitation tickets uncached and suppresses referrers", async () => {
    const request = new NextRequest(
      "http://localhost:3000/accept-invitation/11111111-1111-4111-8111-111111111111?__clerk_ticket=secret"
    );
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: null }), {
      protect: vi.fn(),
    });

    const response = await routeAccess(auth, request);

    expect(response?.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(auth.protect).not.toHaveBeenCalled();
  });

  it("sends signed-in visitors from auth pages through the access resolver", async () => {
    const request = new NextRequest("http://localhost:3000/sign-in");
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: "user_123" }), {
      protect: vi.fn(),
    });

    const response = await routeAccess(auth, request);

    expect(response?.headers.get("location")).toBe("http://localhost:3000/auth/resolve");
    expect(auth.protect).not.toHaveBeenCalled();
  });
});

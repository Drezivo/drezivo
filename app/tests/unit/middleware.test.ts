import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...actual, clerkMiddleware: (handler: unknown) => handler };
});

const { routeAccess } = await import("@/middleware");

describe("staff app middleware", () => {
  it.each(["GET", "HEAD"])("redirects an unauthenticated root %s to sign-in without caching", async (method) => {
    const request = new NextRequest("https://app-preview.drezivo.shop/", { method });
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: null }), { protect: vi.fn() });
    const response = await routeAccess(auth, request);
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://app-preview.drezivo.shop/sign-in");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(auth.protect).not.toHaveBeenCalled();
  });

  it("keeps the signed-in root protected", async () => {
    const request = new NextRequest("https://app-preview.drezivo.shop/");
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: "user_123" }), { protect: vi.fn() });
    expect(await routeAccess(auth, request)).toBeUndefined();
    expect(auth.protect).toHaveBeenCalledOnce();
  });

  it("still protects other staff pages for signed-out visitors", async () => {
    const request = new NextRequest("https://app-preview.drezivo.shop/customers");
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: null }), { protect: vi.fn() });
    expect(await routeAccess(auth, request)).toBeUndefined();
    expect(auth.protect).toHaveBeenCalledOnce();
  });

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

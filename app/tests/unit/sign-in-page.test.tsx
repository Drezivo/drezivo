import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/staff-auth-page", () => ({
  StaffAuthPage: () => <div>Sign in form</div>,
}));

const { default: SignInPage } = await import("../../src/app/(auth)/sign-in/[[...sign-in]]/page");
const { routeAccess } = await import("../../src/middleware");

function authAs(userId: string | null) {
  return Object.assign(vi.fn(async () => ({ userId })), { protect: vi.fn(async () => undefined) });
}

describe("SignInPage", () => {
  it("renders the sign-in form without any server-side session work", () => {
    render(<SignInPage />);
    expect(screen.getByText("Sign in form")).toBeVisible();
  });
});

describe("routeAccess (middleware)", () => {
  it("sends an already signed-in user from the sign-in page to the dashboard", async () => {
    const response = await routeAccess(authAs("user_123"), new NextRequest("http://localhost:3000/sign-in"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("lets a signed-out visitor see the sign-in page", async () => {
    const auth = authAs(null);
    expect(await routeAccess(auth, new NextRequest("http://localhost:3000/sign-in/factor-one"))).toBeUndefined();
    expect(auth.protect).not.toHaveBeenCalled();
  });

  it("protects every other page and leaves sign-up public", async () => {
    const auth = authAs(null);
    await routeAccess(auth, new NextRequest("http://localhost:3000/customers"));
    expect(auth.protect).toHaveBeenCalledTimes(1);
    await routeAccess(auth, new NextRequest("http://localhost:3000/sign-up"));
    expect(auth.protect).toHaveBeenCalledTimes(1);
  });
});

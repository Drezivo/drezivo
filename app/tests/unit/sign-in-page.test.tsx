import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerk.auth,
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
}));

vi.mock("@/components/auth/staff-auth-page", () => ({
  StaffAuthPage: () => <div>Sign in form</div>,
}));

const { default: SignInPage } = await import(
  "../../src/app/(auth)/sign-in/[[...sign-in]]/page"
);

describe("SignInPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("renders the sign-in form when there is no active Clerk session", async () => {
    clerk.auth.mockResolvedValue({ userId: null });

    render(await SignInPage());

    expect(screen.getByText("Sign in form")).toBeVisible();
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("redirects an already signed-in user to the dashboard", async () => {
    clerk.auth.mockResolvedValue({ userId: "user_123" });

    await expect(SignInPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenCalledWith("/");
  });
});

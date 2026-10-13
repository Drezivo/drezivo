import { test, expect } from "@playwright/test";

test.describe("staff sign-in", () => {
  test("renders the branded shell and headless sign-in form anonymously", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByTestId("staff-sign-in-form")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drezivo for professionals" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /WhatsApp|Apple/i })).toHaveCount(0);
    await expect(page.locator(".cl-card, #clerk-components, .cl-rootBox")).toHaveCount(0);
  });

  test("shows the desktop image panel without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/sign-in");

    await expect(page.getByRole("img", { name: "Woman wearing a cream dress in a fashion showroom" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("uses a single-column mobile layout without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");

    await expect(page.getByTestId("staff-sign-in-form")).toBeVisible();
    await expect(page.locator(".auth-image")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("defers Terms acceptance until after email verification", async ({ page }) => {
    await page.goto("/sign-up");

    const form = page.getByTestId("staff-sign-in-form");
    const createAccount = form.getByRole("button", { name: "Create account" });
    await expect(form.getByRole("checkbox")).toHaveCount(0);
    await expect(form.getByRole("link", { name: "Terms of Service" })).toHaveCount(0);
    await expect(createAccount).toBeEnabled();
  });

  test("keeps the SSO callback route public", async ({ page }) => {
    await page.goto("/sso-callback");

    await expect(page).toHaveURL(/\/sso-callback(?:\?|$)/);
  });
});

import { test, expect } from "@playwright/test";

/**
 * These are the only E2E tests that don't need a signed-in fixture: they verify the
 * middleware boundary itself (TRD §3 staff request path) holds for an anonymous visitor.
 * Authenticated flows (confirming a reservation, reviewing payment evidence) need a real
 * Clerk test session/organization and belong in a follow-up suite once staging Clerk
 * credentials exist — asserting against unauthenticated redirects is the honest thing this
 * repo can verify without them.
 */
test.describe("dashboard route protection", () => {
  test("visiting the dashboard root while signed out redirects to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("visiting a deep dashboard route while signed out redirects to sign-in", async ({ page }) => {
    await page.goto("/reservations");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the health check stays public and never requires sign-in", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

import { test, expect } from "@playwright/test";

test("the sign-in page renders Clerk's sign-in form", async ({ page }) => {
  await page.goto("/sign-in");
  // Clerk mounts its widget inside a recognizable root; assert on that rather than
  // Clerk-internal class names, which are not a stable contract across versions.
  await expect(page.locator("#clerk-components, .cl-rootBox").first()).toBeVisible();
});

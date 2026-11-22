import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { CURRENT_TERMS_VERSION } from "@drezivo/contracts";

// Use real Clerk sessions saved outside the repository; the API responses below are synthetic.
const ownerState = process.env["DREZIVO_E2E_CREATOR_STORAGE_STATE"];
const staffState = process.env["DREZIVO_E2E_STAFF_STORAGE_STATE"];
const exists = (path: string | undefined) => Boolean(path && existsSync(resolve(path)));
const timestamp = "2026-10-01T00:00:00.000Z";
const workspaces = [1, 2].map((number) => ({
  clerk_org_id: `org_test_${number}`,
  role: "frontdesk",
  membership_updated_at: timestamp,
  tenant: {
    id: `00000000-0000-4000-8000-00000000000${number}`,
    name: `Test shop ${number}`,
    slug: `test-shop-${number}`,
    status: "active",
    currency: "PHP",
    timezone: "Asia/Manila",
    created_at: timestamp,
    updated_at: timestamp,
  },
}));

async function mockWorkspaceReads(page: Page, hasOwner: boolean) {
  await page.route("**/api/v1/workspaces?**", (route) => route.fulfill({
    json: { success: true, data: { items: workspaces, page_meta: { next_cursor: null, has_more: false } }, request_id: "e2e-workspaces" },
  }));
  await page.route("**/api/v1/onboarding/current", (route) => route.fulfill({
    json: { success: true, data: { onboarding: null, has_current_owned_tenant: hasOwner, has_consumed_lifetime_trial: false, required_terms_version: CURRENT_TERMS_VERSION, accepted_terms_version: CURRENT_TERMS_VERSION }, request_id: "e2e-onboarding" },
  }));
}

test.describe("workspace creation for the designated account", () => {
  test.skip(!exists(ownerState), "Set DREZIVO_E2E_CREATOR_STORAGE_STATE to the designated account's local Clerk session.");
  test.use({ storageState: exists(ownerState) ? resolve(ownerState!) : undefined, video: "on" });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`opens workspace setup from the selector at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockWorkspaceReads(page, false);
      await page.goto("/workspaces/select");
      await expect(page.getByRole("button", { name: /Test shop 1/ })).toBeVisible();
      await page.getByRole("button", { name: "Create Workspace" }).click();
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
      await expect(page.getByLabel("Business name")).toBeVisible();
    });
  }

  test("does not offer creation when the account already owns a workspace", async ({ page }) => {
    await mockWorkspaceReads(page, true);
    await page.goto("/workspaces/select");
    await expect(page.getByRole("button", { name: /Test shop 1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Workspace" })).toHaveCount(0);
  });
});

test.describe("workspace selection for staff", () => {
  test.skip(!exists(staffState), "Set DREZIVO_E2E_STAFF_STORAGE_STATE to a separate staff account's local Clerk session.");
  test.use({ storageState: exists(staffState) ? resolve(staffState!) : undefined, video: "on" });
  test("shows accessible shops without the creation shortcut", async ({ page }) => {
    await mockWorkspaceReads(page, false);
    await page.goto("/workspaces/select");
    await expect(page.getByRole("button", { name: /Test shop 1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Test shop 2/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Workspace" })).toHaveCount(0);
  });
});

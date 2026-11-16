import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Use only a dedicated local test tenant with a customer-less hold and synthetic customer.
const state = process.env["DREZIVO_PLAYWRIGHT_STORAGE_STATE"];
const garment = process.env["DREZIVO_E2E_HELD_GARMENT"];
const customerName = process.env["DREZIVO_E2E_CUSTOMER_NAME"];
const productName = process.env["DREZIVO_E2E_PRODUCT_NAME"];
const pickupLabel = process.env["DREZIVO_E2E_PICKUP_LABEL"];
const returnLabel = process.env["DREZIVO_E2E_RETURN_LABEL"];
const baseURL = process.env["DREZIVO_E2E_BASE_URL"] ?? "http://localhost:3000";
let isLocal = false;
try { isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname); } catch { /* Invalid test URL remains blocked. */ }
const ready = isLocal && process.env["DREZIVO_E2E_ISOLATED"] === "1" && Boolean(state && existsSync(resolve(state))) && Boolean(garment && customerName);
test.use({ baseURL, channel: process.env["DREZIVO_PLAYWRIGHT_CHANNEL"] || undefined, storageState: state && existsSync(resolve(state)) ? resolve(state) : undefined, video: "on", screenshot: "on", trace: "off" });

test.describe("reservation customer entry", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ready, "Requires a verified isolated local test tenant, Clerk test session, a customer-less hold, and a synthetic saved customer.");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`suggests an existing customer on a held reservation at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reservations");
      await page.getByRole("button").filter({ hasText: garment! }).filter({ hasText: "Customer not added yet" }).click();
      await page.getByRole("button", { name: "Complete Reservation" }).first().click();
      await expect(page.getByRole("button", { name: "New customer" })).toHaveCount(0);
      await page.getByLabel("Full name").fill(customerName!);
      const suggestion = page.getByRole("button", { name: new RegExp(customerName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      await expect(suggestion).toBeVisible();
      await suggestion.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Selected customer")).toBeVisible();
      await page.getByRole("button", { name: "Use a different customer" }).click();
      await page.getByLabel("Full name").fill("Unique Synthetic Name No Match");
      await expect(page.getByText(/No matching customers/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("completes an existing hold with a selected customer", async ({ page }) => {
    await page.goto("/reservations");
    await page.getByRole("button").filter({ hasText: garment! }).filter({ hasText: "Customer not added yet" }).click();
    await page.getByRole("button", { name: "Complete Reservation" }).first().click();
    await page.getByLabel("Full name").fill(customerName!);
    await page.getByRole("button", { name: new RegExp(customerName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    await page.getByRole("checkbox", { name: "Customer accepted the rental terms." }).check();
    const completion = page.waitForResponse((value) => value.request().method() === "POST" && /\/reservations\/[^/]+\/complete-booking(?:\?|$)/.test(value.url()));
    await page.getByRole("button", { name: "Complete Reservation" }).last().click();
    expect((await completion).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("button").filter({ hasText: garment! }).filter({ hasText: customerName! })).toBeVisible();
  });

  test("shows customer suggestions after creating a reservation hold", async ({ page }) => {
    test.skip(!productName || !pickupLabel || !returnLabel, "Requires an available synthetic product and two available next-month calendar dates.");
    await page.goto("/reservations");
    await page.getByRole("button", { name: "New Reservation" }).click();
    await page.getByRole("button", { name: `Add ${productName}` }).click();
    await page.getByRole("button", { name: "Go to the Next Month" }).click();
    await page.getByRole("button", { name: pickupLabel! }).click();
    await page.getByRole("button", { name: returnLabel! }).click();
    for (const label of ["Pickup time", "Return time"]) {
      await page.getByRole("textbox", { name: `${label} hour` }).fill("10");
      await page.getByRole("textbox", { name: `${label} minute` }).fill("00");
      await page.getByRole("combobox", { name: `${label} period` }).selectOption("AM");
    }
    const response = page.waitForResponse((value) => value.request().method() === "POST" && /\/api\/v1\/reservations(?:\?|$)/.test(value.url()));
    await page.getByRole("button", { name: "Reserve", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await page.getByLabel("Full name").fill(customerName!);
    const suggestion = page.getByRole("button", { name: new RegExp(customerName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(page.getByText("Selected customer")).toBeVisible();
    await page.getByLabel("Cash received").fill("1");
    await expect(page.getByRole("button", { name: "Confirm Reservation" })).toBeDisabled();
    await page.getByLabel("Cash received").fill("1000");
    await expect(page.getByText(/Change due:/)).toBeVisible();
    const completion = page.waitForResponse((value) => value.request().method() === "POST" && /\/reservations\/[^/]+\/complete-booking(?:\?|$)/.test(value.url()));
    await page.getByRole("button", { name: "Confirm Reservation" }).click();
    expect((await completion).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("button").filter({ hasText: productName! }).filter({ hasText: customerName! }).first()).toBeVisible();
  });
});

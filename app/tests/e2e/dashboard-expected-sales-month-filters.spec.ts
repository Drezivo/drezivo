import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { DashboardOverviewResponse } from "@drezivo/contracts";

const storageStatePath = process.env["DREZIVO_PLAYWRIGHT_STORAGE_STATE"];
const hasRealStorageState = Boolean(storageStatePath && existsSync(resolve(storageStatePath)));

const fixedOverview: DashboardOverviewResponse = {
  window: {
    timezone: "America/Los_Angeles",
    as_of: "2026-10-21T12:00:00.000Z",
    today: { start: "2026-10-21T07:00:00.000Z", end: "2026-10-22T07:00:00.000Z" },
    upcoming_rentals: { start: "2026-10-21T12:00:00.000Z", end: "2026-10-28T07:00:00.000Z" },
    upcoming_fittings: { start: "2026-10-21T12:00:00.000Z", end: "2026-10-24T07:00:00.000Z" },
    current_month: { start: "2026-10-01T07:00:00.000Z", end: "2026-11-01T07:00:00.000Z" },
    previous_month: { start: "2026-09-01T07:00:00.000Z", end: "2026-10-01T07:00:00.000Z" },
  },
  metrics: {
    active_rentals: 0,
    confirmed_rental_items_current_month: 0,
    pickups_today: 0,
    returns_today: 0,
    fittings_today: 0,
    payments_to_review: 0,
  },
  today_schedule: { items: [], total: 0, truncated: false },
  upcoming_rentals: { items: [], total: 0, truncated: false },
  upcoming_fitting_appointments: { items: [], total: 0, truncated: false },
  business_performance: {
    currency: "PHP",
    completed_rental_value: { current_minor: "20000", previous_minor: "60000" },
    completed_rentals: { current: 3, previous: 2 },
    average_rental_value: { current_minor: "23333", previous_minor: "30000" },
    projected_sales_current_month: { current_minor: "50000", reservations: 1 },
    new_customers: { current: 7, previous: 5 },
    projected_rental_value: { current_minor: "50000", reservations: 0 },
  },
};

function expectedSalesFor(url: URL): { current_minor: string; reservations: number } {
  const start = url.searchParams.get("start_month");
  const end = url.searchParams.get("end_month");
  if (url.searchParams.get("all_time") === "true")
    return { current_minor: "500000", reservations: 2 };
  if (start === "2026-09" && end === "2026-11") return { current_minor: "250000", reservations: 1 };
  if (start === "2026-09" && end === "2026-10") return { current_minor: "200000", reservations: 0 };
  if (start === "2026-10" && end === "2026-11") return { current_minor: "150000", reservations: 1 };
  if (start === "2026-10" && end === "2026-10") return { current_minor: "50000", reservations: 1 };
  if (start === "2026-10") return { current_minor: "350000", reservations: 2 };
  if (end === "2026-10") return { current_minor: "200000", reservations: 0 };
  if (end === "2026-08") return { current_minor: "0", reservations: 0 };
  if (start === "2026-09") return { current_minor: "500000", reservations: 2 };
  if (start === "2026-11" && end === "2026-11") return { current_minor: "100000", reservations: 1 };
  return { current_minor: "50000", reservations: 0 };
}

async function mockOverview(page: Page): Promise<URL[]> {
  const requests: URL[] = [];
  await page.route("**/api/v1/dashboard/overview**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          ...fixedOverview,
          business_performance: {
            ...fixedOverview.business_performance,
            projected_rental_value: expectedSalesFor(url),
          },
        },
        request_id: "expected-sales-e2e",
      }),
    });
  });
  return requests;
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Business Performance" })).toBeVisible();
  await expect(page.getByLabel("Start month")).toContainText("Select month");
  await expect(page.getByLabel("End month")).toContainText("Select month");
}

async function chooseMonth(
  page: Page,
  label: "Start month" | "End month",
  month: string,
  year = 2026
): Promise<void> {
  await page.getByLabel(label).click();
  await page.getByRole("button", { name: `${month} ${year}`, exact: true }).click();
}

test.describe("dashboard Expected Total Sales month filters", () => {
  test.skip(
    !hasRealStorageState,
    "Set DREZIVO_PLAYWRIGHT_STORAGE_STATE to a real Clerk test-account storageState outside Git."
  );
  test.use({ storageState: hasRealStorageState ? resolve(storageStatePath!) : undefined });

  test("defaults to all time and recalculates totals for open and bounded month filters", async ({
    page,
  }) => {
    const requests = await mockOverview(page);
    await openDashboard(page);
    await expect(page.getByText("₱5,000.00", { exact: true })).toBeVisible();
    expect(requests[0]?.searchParams.get("all_time")).toBe("true");
    await expect(page.getByRole("button", { name: "Clear month filters" })).toBeDisabled();

    await page.getByRole("button", { name: "Clear month filters" }).click();
    await expect(page.getByText("₱5,000.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("all_time")).toBe("true");

    await chooseMonth(page, "End month", "October");
    await expect(page.getByText("₱2,000.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("end_month")).toBe("2026-10");
    expect(requests.at(-1)?.searchParams.has("start_month")).toBe(false);

    await page.getByRole("button", { name: "Clear month filters" }).click();
    await chooseMonth(page, "Start month", "October");
    await expect(page.getByText("₱3,500.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("start_month")).toBe("2026-10");
    await chooseMonth(page, "End month", "October");
    await expect(page.getByText("₱500.00", { exact: true })).toHaveCount(2);
    await expect(
      page.getByText("Expected Total Sales", { exact: true }).locator("..")
    ).toContainText("₱500.00");
    await expect(
      page.getByText("Projected Sales This Month", { exact: true }).locator("..")
    ).toContainText("₱500.00");

    await chooseMonth(page, "End month", "November");
    await expect(page.getByText("₱1,500.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("start_month")).toBe("2026-10");
    expect(requests.at(-1)?.searchParams.get("end_month")).toBe("2026-11");
    for (const [label, value] of [
      ["Completed Rental Value", "₱200.00"],
      ["Completed Rentals", "3"],
      ["Projected Sales This Month", "₱500.00"],
      ["New Customers", "7"],
    ] as const) {
      await expect(page.getByText(label, { exact: true }).locator("..")).toContainText(value);
    }
  });

  test("keeps the last total and sends no request for reversed bounds", async ({ page }) => {
    const requests = await mockOverview(page);
    await openDashboard(page);
    await expect(page.getByText("₱5,000.00", { exact: true })).toBeVisible();
    await chooseMonth(page, "End month", "October");
    await expect(page.getByText("₱2,000.00", { exact: true })).toBeVisible();
    const requestCount = requests.length;

    await chooseMonth(page, "Start month", "November");
    await expect(page.getByRole("alert")).toHaveText("Start month must be on or before End month.");
    await expect(page.getByText("₱2,000.00", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(requestCount);

    await chooseMonth(page, "End month", "November");
    await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("start_month")).toBe("2026-11");
    expect(requests.at(-1)?.searchParams.get("end_month")).toBe("2026-11");
  });

  test("clears Start month when End month moves before it", async ({ page }) => {
    const requests = await mockOverview(page);
    await openDashboard(page);

    await chooseMonth(page, "Start month", "September");
    await chooseMonth(page, "End month", "October");
    await expect(page.getByText("₱2,000.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("start_month")).toBe("2026-09");
    expect(requests.at(-1)?.searchParams.get("end_month")).toBe("2026-10");
    await expect(page.getByRole("alert")).not.toBeVisible();

    await chooseMonth(page, "End month", "August");
    await expect(page.getByLabel("Start month")).toContainText("Select month");
    await expect(page.getByText("₱0.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.has("start_month")).toBe(false);
    expect(requests.at(-1)?.searchParams.get("end_month")).toBe("2026-08");
    await expect(page.getByRole("alert")).not.toBeVisible();
  });

  test("opens the phone month picker as a bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await mockOverview(page);
    await openDashboard(page);

    await page.getByLabel("Start month").click();
    const picker = page.getByRole("dialog", { name: "Select start month" });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute("data-side", "bottom");
    await picker.getByRole("button", { name: "October 2026" }).click();

    await expect(page.getByLabel("Start month")).toContainText("October 2026");
    await expect(page.getByText("₱3,500.00", { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("start_month")).toBe("2026-10");
  });
});

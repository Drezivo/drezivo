import { test, expect } from '@playwright/test';

/**
 * The storefront is intentionally local-only during the current design phase.
 * These browser tests verify the visual customer flow without a seeded tenant,
 * API process, capability cookie, or database. Reintroduce API-backed E2E tests
 * when the storefront is approved and reconnected to the production contract.
 */
test.describe('marketing site', () => {
  test('landing page renders the hero and links to pricing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Run your clothing rental business effortlessly',
    );
    await page.getByRole('link', { name: 'See Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test('pricing page shows the three authoritative PHP plans', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('₱300.00 / month')).toBeVisible();
    await expect(page.getByText('₱499.00 / month')).toBeVisible();
    await expect(page.getByText('₱1,299.00 / month')).toBeVisible();
    // The outdated screenshot pricing must never resurface on this page.
    await expect(page.getByText('₱999')).toHaveCount(0);
  });

  test('faq page lists guest-booking questions', async ({ page }) => {
    await page.goto('/faq');
    await expect(
      page.getByText('Do customers need to create an account to book?'),
    ).toBeVisible();
  });
});

test.describe('static tenant storefront', () => {
  test('customer can walk from storefront to reservation confirmation without an API', async ({
    page,
  }) => {
    await page.goto('/s/luxe-rentals');
    await expect(page.getByRole('heading', { name: 'Luxe Rental Studio' })).toBeVisible();

    await page.getByRole('link', { name: /Browse Collection/i }).click();
    await expect(page).toHaveURL(/\/s\/luxe-rentals\/catalog/);

    await page.getByRole('link', { name: /Emerald Evening Gown/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Emerald Evening Gown' })).toBeVisible();

    await page.getByRole('button', { name: 'M' }).click();
    await page.getByRole('button', { name: 'Reserve This Item' }).click();
    await expect(page.getByRole('heading', { name: 'Select Rental Dates' })).toBeVisible();

    await page.getByRole('button', { name: 'Next month' }).click();
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 2);
    const nextMonthDateLabel = new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(nextMonth);
    await page.getByRole('button', { name: nextMonthDateLabel }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Reservation Details' })).toBeVisible();
    await page.locator('input[name="fullName"]').fill('Ava Cruz');
    await page.locator('input[name="phone"]').fill('09171234567');
    await page.locator('input[name="email"]').fill('ava@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Review Your Reservation' })).toBeVisible();
    await expect(page.getByText('Ava Cruz')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Reservation' }).click();

    await expect(page.getByRole('heading', { name: 'Reservation Received' })).toBeVisible();
    await expect(page.getByText('Ava Cruz')).toBeVisible();
  });
});

test.describe('unknown tenant storefront', () => {
  test('a nonexistent store slug renders the generic not-found page, not an error', async ({
    page,
  }) => {
    const response = await page.goto('/s/this-slug-does-not-exist-12345');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});

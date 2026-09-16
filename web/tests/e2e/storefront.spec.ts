import { test, expect } from '@playwright/test';

/**
 * These smoke tests exercise the public marketing surface, which needs no
 * backend fixture data. Storefront/booking e2e coverage (catalog → item →
 * dates → hold) requires a seeded tenant + running API and belongs in a
 * separate suite wired to that fixture — it is intentionally not stubbed
 * out here with a fake network layer, since a green test against a mock
 * would not prove the real hold/idempotency contract in TRD §5 actually
 * holds end to end.
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

test.describe('unknown tenant storefront', () => {
  test('a nonexistent store slug renders the generic not-found page, not an error', async ({
    page,
  }) => {
    const response = await page.goto('/s/this-slug-does-not-exist-12345');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});

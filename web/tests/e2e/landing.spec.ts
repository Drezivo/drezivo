import { expect, test } from '@playwright/test';

test.describe('marketing landing page', () => {
  test('shows the full-viewport hero and scroll-reactive navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const header = page.locator('header.marketing-header');
    const hero = page.locator('.marketing-hero');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Run your clothing rental business effortlessly');
    await expect(hero).toBeVisible();
    await expect(page.getByTestId('hero-background')).toBeVisible();
    await expect(page.getByTestId('hero-dashboard')).toBeVisible();
    await expect(header).toHaveAttribute('data-state', 'overlay');
    await expect(header).toHaveCSS('position', 'fixed');

    const heroHeight = await hero.evaluate((element) => element.getBoundingClientRect().height);
    expect(heroHeight).toBeGreaterThanOrEqual(900);

    await page.evaluate(() => window.scrollTo(0, 41));
    await expect(header).toHaveAttribute('data-state', 'scrolled');

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute('data-state', 'overlay');

    await expect(page.getByRole('link', { name: 'Get Started Free' }).first()).toHaveAttribute(
      'href',
      'https://app.drezivo.com/sign-up',
    );
    await expect(page.getByRole('link', { name: 'Sign In' }).first()).toHaveAttribute(
      'href',
      'https://app.drezivo.com/sign-in',
    );
    await expect(page.locator('#pricing')).toContainText('300.00 / month');
    await expect(page.locator('#pricing')).toContainText('499.00 / month');
    await expect(page.locator('#pricing')).toContainText('1,299.00 / month');

    const faq = page.locator('#faq details').first();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(faq).toContainText('customers book as guests');
  });

  test('uses an opaque header on dedicated marketing pages', async ({ page }) => {
    for (const route of ['/pricing', '/faq']) {
      await page.goto(route);
      await expect(page.locator('header.marketing-header')).toHaveAttribute('data-state', 'scrolled');
    }
  });

  test('renders a spread problem image with six floating labels on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const problem = page.locator('#features');
    const image = problem.locator('img[alt^="A clothing rental owner"]');
    const imageBox = await image.boundingBox();
    const imageFilter = await image.evaluate((element) => getComputedStyle(element).filter);
    const leftPills = problem.locator('.problem-pill-left');
    const rightPills = problem.locator('.problem-pill-right');

    await expect(problem.locator('.problem-pill')).toHaveCount(6);
    await expect(leftPills).toHaveCount(3);
    await expect(rightPills).toHaveCount(3);
    await expect(problem.locator('article')).toHaveCount(0);
    expect(imageBox).not.toBeNull();
    expect(imageFilter).toContain('grayscale');

    const leftBox = await leftPills.first().boundingBox();
    const rightBox = await rightPills.first().boundingBox();
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect(leftBox!.x).toBeLessThan(imageBox!.x + imageBox!.width / 2);
    expect(rightBox!.x).toBeGreaterThan(imageBox!.x + imageBox!.width / 2);
  });

  test('uses a text-only full-height hero and accessible mobile menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const heroHeight = await page.locator('.marketing-hero').evaluate((element) => element.getBoundingClientRect().height);
    expect(heroHeight).toBeGreaterThanOrEqual(844);
    await expect(page.getByTestId('hero-background')).toBeHidden();
    await expect(page.getByTestId('hero-dashboard')).toBeHidden();

    const problem = page.locator('#features');
    const problemImage = problem.locator('img[alt^="A clothing rental owner"]');
    const problemImageBox = await problemImage.boundingBox();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const problemHeadingBox = await problem.getByRole('heading', { level: 2 }).boundingBox();
    expect(problemImageBox).not.toBeNull();
    expect(problemHeadingBox).not.toBeNull();
    expect(problemHeadingBox!.y).toBeLessThan(problemImageBox!.y);
    expect(problemImageBox!.width).toBeLessThan(viewportWidth - 40);
    await expect(problem.locator('.problem-pill')).toHaveCount(6);

    const pillBoxes = (await problem.locator('.problem-pill').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }))) as Array<{ left: number; right: number; top: number; bottom: number }>;
    for (const pill of pillBoxes) {
      expect(pill.left).toBeGreaterThanOrEqual(0);
      expect(pill.right).toBeLessThanOrEqual(viewportWidth);
      expect(pill.top).toBeGreaterThanOrEqual(problemImageBox!.y - 8);
      expect(pill.bottom).toBeLessThanOrEqual(problemImageBox!.y + problemImageBox!.height + 8);
    }

    const menu = page.locator('summary').filter({ hasText: 'Menu' });
    await menu.click();
    await expect(page.getByRole('link', { name: 'Pricing' }).last()).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

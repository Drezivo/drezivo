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
    await expect(page.locator('#pricing')).toContainText('₱299');
    await expect(page.locator('#pricing')).toContainText('Standard');
    await expect(page.locator('#pricing')).toContainText('Up to 300 active garments');
    await expect(page.locator('#pricing')).toContainText('Up to 3 Front Desk staff');

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

  test('renders the reference-style solution section on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const solution = page.getByTestId('solution-section');
    const backdrop = solution.getByTestId('solution-backdrop');
    const firstFeature = solution.locator('.solution-feature').first();
    const dashboard = solution.getByTestId('solution-dashboard');
    const phone = solution.getByTestId('solution-phone');

    await expect(solution.getByRole('heading', { level: 2 })).toContainText(
      'Everything you need, in one place.',
    );
    await expect(solution).toContainText('Drezivo gives you a complete, easy-to-use system');
    await expect(solution.locator('.solution-feature')).toHaveCount(4);
    await expect(solution.getByTestId('solution-backdrop')).toBeVisible();
    await expect(dashboard).toBeVisible();
    await expect(phone).toBeVisible();
    await expect(solution).not.toContainText('Rentivo');

    const featureBox = await firstFeature.boundingBox();
    const dashboardBox = await dashboard.boundingBox();
    const phoneBox = await phone.boundingBox();
    expect(featureBox).not.toBeNull();
    expect(dashboardBox).not.toBeNull();
    expect(phoneBox).not.toBeNull();
    const sectionBox = await solution.boundingBox();
    const backdropBox = await backdrop.boundingBox();
    expect(sectionBox).not.toBeNull();
    expect(backdropBox).not.toBeNull();
    expect(sectionBox!.height).toBeCloseTo(900, 0);
    expect(backdropBox!.x).toBeCloseTo(sectionBox!.x, 0);
    expect(backdropBox!.y).toBeCloseTo(sectionBox!.y, 0);
    expect(backdropBox!.width).toBeCloseTo(sectionBox!.width, 0);
    expect(backdropBox!.height).toBeCloseTo(sectionBox!.height, 0);
    expect(dashboardBox!.x).toBeGreaterThan(featureBox!.x + featureBox!.width);
    expect(phoneBox!.x).toBeGreaterThan(dashboardBox!.x + dashboardBox!.width / 2);
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

    const solution = page.getByTestId('solution-section');
    const solutionVisual = solution.getByTestId('solution-visual');
    const solutionDashboard = solution.getByTestId('solution-dashboard');
    const solutionPhone = solution.getByTestId('solution-phone');
    await expect(solution.getByRole('heading', { level: 2 })).toContainText('Everything you need');
    await expect(solution.getByTestId('solution-backdrop')).toBeVisible();
    await expect(solutionDashboard).toBeVisible();
    await expect(solutionPhone).toBeVisible();
    await expect(solution).not.toContainText('Rentivo');

    const solutionVisualBox = await solutionVisual.boundingBox();
    const solutionDashboardBox = await solutionDashboard.boundingBox();
    const solutionPhoneBox = await solutionPhone.boundingBox();
    expect(solutionVisualBox).not.toBeNull();
    expect(solutionDashboardBox).not.toBeNull();
    expect(solutionPhoneBox).not.toBeNull();
    expect(solutionVisualBox!.x).toBeGreaterThanOrEqual(0);
    expect(solutionVisualBox!.x + solutionVisualBox!.width).toBeLessThanOrEqual(viewportWidth);
    expect(solutionDashboardBox!.x).toBeGreaterThanOrEqual(solutionVisualBox!.x);
    expect(solutionPhoneBox!.x + solutionPhoneBox!.width).toBeLessThanOrEqual(
      solutionVisualBox!.x + solutionVisualBox!.width,
    );

    const menu = page.locator('summary').filter({ hasText: 'Menu' });
    await menu.click();
    await expect(page.getByRole('link', { name: 'Pricing' }).last()).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

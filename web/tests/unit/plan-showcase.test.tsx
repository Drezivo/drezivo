import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { formatPlanPrice, PUBLIC_MARKETING_PLANS, type PublicPlan } from '@/lib/plans';

// web resolves its own vitest copy, which the root jest-dom typings do not augment, so these tests
// use plain matchers on text content instead of the jest-dom ones.
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

const plan = (code: string, price: string, highlighted = false): PublicPlan => ({
  code,
  name: code[0]!.toUpperCase() + code.slice(1),
  tagline: `The ${code} plan.`,
  price,
  interval: 'month',
  trialDays: 14,
  features: [`${code} feature one`, `${code} feature two`],
  highlighted,
});

describe('plan showcase', () => {
  it('gives a single plan the whole stage, with its price as the headline', () => {
    render(
      <PlanShowcase
        plans={[plan('standard', '299.00', true)]}
        signUpUrl="https://partners.example/sign-up"
      />,
    );

    expect(text(screen.getByRole('heading', { level: 2 }))).toBe('One plan. Everything in it.');
    expect(screen.getByText('₱299')).toBeTruthy();
    expect(screen.getByText('a month, after your 14-day free trial')).toBeTruthy();
    const methods = within(
      screen.getByRole('list', { name: 'Accepted payment methods' }),
    ).getAllByRole('listitem');
    expect(methods.map(text)).toEqual(['GCash', 'Maya', 'Bank transfer']);
    expect(screen.queryByRole('link', { name: /Start with/ })).toBeNull();
  });

  it.each([2, 3, 4])('lays out %i plans as comparable cards, one sign-up link each', (count) => {
    const plans = ['starter', 'standard', 'growth', 'branches']
      .slice(0, count)
      .map((code, index) => plan(code, `${300 * (index + 1)}.00`, index === 1));
    render(<PlanShowcase plans={plans} signUpUrl="https://partners.example/sign-up" />);

    expect(text(screen.getByRole('heading', { level: 2 }))).toBe('Plans that grow with your shop.');
    const links = screen.getAllByRole('link', { name: /Start with/ });
    expect(links).toHaveLength(count);
    for (const link of links)
      expect(link.getAttribute('href')).toBe('https://partners.example/sign-up');
    const highlighted = links[1]!.closest('li')!;
    expect(highlighted.className).toContain('bg-atelier-night');
    expect(within(highlighted).getByText('₱600')).toBeTruthy();
  });

  it('renders nothing when there is no plan to sell', () => {
    const { container } = render(
      <PlanShowcase plans={[]} signUpUrl="https://partners.example/sign-up" />,
    );
    expect(container.childElementCount).toBe(0);
  });
});

describe('public plans', () => {
  it('keeps the marketing snapshot aligned with the current public offers', () => {
    expect(PUBLIC_MARKETING_PLANS).toEqual([
      expect.objectContaining({
        code: 'free',
        name: 'Free',
        price: '0.00',
        trialDays: 0,
        highlighted: false,
        features: expect.arrayContaining([
          'Up to 20 active garments',
          'Owner-only access (no Front Desk accounts)',
          'Availability-only storefront with contact links',
          'No fittings on the business app or storefront',
          'No online storefront payment methods',
          '2 storefront designs',
        ]),
      }),
      expect.objectContaining({
        code: 'starter',
        name: 'Starter',
        price: '149.00',
        trialDays: 14,
        highlighted: false,
        features: expect.arrayContaining(['Up to 125 active garments']),
      }),
      expect.objectContaining({
        code: 'standard',
        name: 'Standard',
        price: '299.00',
        trialDays: 14,
        highlighted: true,
        features: expect.arrayContaining(['Up to 300 active garments', 'Up to 3 Front Desk staff']),
      }),
    ]);
    expect(PUBLIC_MARKETING_PLANS).toHaveLength(3);
    expect(PUBLIC_MARKETING_PLANS[1]?.features.some((feature) => feature.includes('Front Desk staff'))).toBe(false);
  });

  it('renders all offers immediately with the correct cards and links', () => {
    render(<PlanShowcase plans={PUBLIC_MARKETING_PLANS} signUpUrl="https://partners.example/sign-up" />);

    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText('₱0')).toBeTruthy();
    expect(screen.getByText('₱149')).toBeTruthy();
    expect(screen.getByText('₱299')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Start with/ })).toHaveLength(3);
    const standardCard = screen.getByRole('link', { name: 'Start with Standard' }).closest('li');
    expect(standardCard?.className).toContain('bg-atelier-night');
    const freeCard = screen.getByRole('link', { name: 'Start with Free' }).closest('li');
    expect(text(freeCard!)).toContain('Free forever');
    expect(text(freeCard!)).not.toContain('14-day free trial');
  });

  it('formats whole pesos without centavos and keeps real centavos', () => {
    expect(formatPlanPrice('299.00')).toBe('₱299');
    expect(formatPlanPrice('1299.00')).toBe('₱1,299');
    expect(formatPlanPrice('499.50')).toBe('₱499.50');
  });
});

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { formatPlanPrice, toPublicPlans, MAX_PUBLIC_PLANS, type PublicPlan } from '@/lib/plans';

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
  const catalog = {
    plans: [
      {
        code: 'starter' as const,
        name: 'Starter' as const,
        monthly_price_minor: 14900,
        currency: 'PHP' as const,
        trial_days: 14,
        limits: { active_garments: 125, frontdesk_seats: 0 },
      },
      {
        code: 'standard' as const,
        name: 'Standard' as const,
        monthly_price_minor: 29900,
        currency: 'PHP' as const,
        trial_days: 14,
        limits: { active_garments: 300, frontdesk_seats: 3 },
      },
    ],
  };

  it('maps server-owned prices and limits into both pricing cards', () => {
    const plans = toPublicPlans(catalog);

    expect(
      plans.map(({ name, price, features, highlighted }) => ({
        name,
        price,
        features,
        highlighted,
      })),
    ).toEqual([
      {
        name: 'Starter',
        price: '149.00',
        features: expect.arrayContaining([
          'Up to 125 active garments',
          'Owner-only access (no Front Desk accounts)',
        ]),
        highlighted: false,
      },
      {
        name: 'Standard',
        price: '299.00',
        features: expect.arrayContaining(['Up to 300 active garments', 'Up to 3 Front Desk staff']),
        highlighted: true,
      },
    ]);
    expect(plans[0]?.features.filter((feature) => feature.includes('Front Desk staff'))).toEqual([]);
  });

  it('caps the number of catalog entries to the layout capacity', () => {
    const plans = toPublicPlans({
      plans: Array.from({ length: MAX_PUBLIC_PLANS + 1 }, (_, index) => ({
        ...catalog.plans[index % catalog.plans.length]!,
      })),
    });
    expect(plans).toHaveLength(MAX_PUBLIC_PLANS);
  });

  it('formats whole pesos without centavos and keeps real centavos', () => {
    expect(formatPlanPrice('299.00')).toBe('₱299');
    expect(formatPlanPrice('1299.00')).toBe('₱1,299');
    expect(formatPlanPrice('499.50')).toBe('₱499.50');
  });
});

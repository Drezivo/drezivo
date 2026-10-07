import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PricingPage from '@/app/(marketing)/pricing/page';
import TermsPage from '@/app/(marketing)/terms/page';
import { MARKETING_FAQ_GROUPS } from '@/lib/marketing-content';

const planApi = vi.hoisted(() => ({ getPublicPlanCatalog: vi.fn() }));
vi.mock('@/lib/storefront-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storefront-api')>()),
  getPublicPlanCatalog: planApi.getPublicPlanCatalog,
}));

const planCatalog = {
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

function answerFor(question: string): string {
  const faq = MARKETING_FAQ_GROUPS.flatMap((group) => group.faqs).find(
    (entry) => entry.question === question,
  );
  if (!faq) throw new Error(`FAQ not found: ${question}`);
  return faq.answer;
}

describe('marketing FAQ, pricing, and terms', () => {
  beforeEach(() => {
    planApi.getPublicPlanCatalog.mockReset().mockResolvedValue(planCatalog);
  });

  it('shows both catalog-backed offers in the pricing section', async () => {
    render(<PricingPage />);

    await screen.findByText('Starter');
    const pricing = screen.getByRole('heading', { level: 1 }).closest('#pricing');
    expect(pricing).not.toBeNull();
    const pricingText = pricing?.textContent ?? '';
    expect(pricingText).toContain('₱149');
    expect(pricingText).toContain('Up to 125 active garments');
    expect(pricingText).toContain('Standard');
    expect(pricingText).toContain('₱299');
    expect(pricingText).toContain('Up to 300 active garments');
    expect(pricingText).toContain('Up to 3 Front Desk staff');
    const starterCard = screen.getByText('Starter').closest('li');
    expect(starterCard?.textContent).not.toContain('Front Desk');
  });

  it('moves billing-detail explanations to the FAQ instead of the pricing page', async () => {
    render(<PricingPage />);

    await screen.findByText('Starter');
    expect(screen.queryByText('How billing works')).toBeNull();
    expect(answerFor('Do I need a credit card to start?')).toContain(
      'GCash, Maya, or bank-transfer',
    );
    expect(answerFor('What happens if I do not renew after the trial or a paid month?')).toContain(
      'retains the workspace data for 30 days',
    );
  });

  it('does not promise guest reservation cancellation or rescheduling in V1', () => {
    const answer = answerFor('Can a customer cancel or change their reservation?');

    expect(answer).toContain('Not through the guest link in V1.');
    expect(answer).toContain('contact the rental business directly');
    expect(answer).toContain('does not automatically issue a refund');
  });

  it('describes the current Standard staff allowance and quotas', () => {
    const answer = answerFor('Can staff access everything in my account?');

    expect(answer).toContain('up to 3 Front Desk staff accounts');
    expect(answer).toContain('role-limited');
    expect(answerFor('How much does Drezivo cost?')).toContain('up to 300 active garments');
  });

  it('keeps the terms aligned with the current pilot subscription lifecycle', () => {
    render(<TermsPage />);

    expect(screen.getByText('Last updated: October 2, 2026')).toBeTruthy();
    expect(screen.getByText(/14-day free trial/)).toBeTruthy();
    expect(screen.getByText(/read-only for up to/).textContent).toContain('30 days');
    expect(screen.getByText(/public storefront may remain online/).textContent).toContain('3 days');
    expect(screen.getByText(/30-day retention period/)).toBeTruthy();
  });

  it('shows the finalized support address and has no unfinished template placeholders', () => {
    render(<TermsPage />);

    const supportLinks = screen.getAllByRole('link', { name: 'drezivoshop@gmail.com' });
    expect(supportLinks.length).toBeGreaterThan(1);
    expect(
      supportLinks.every((link) => link.getAttribute('href') === 'mailto:drezivoshop@gmail.com'),
    ).toBe(true);
    expect(screen.queryByText(/\[INSERT/i)).toBeNull();
  });
});

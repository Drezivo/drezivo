import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PricingPage from '@/app/(marketing)/pricing/page';
import TermsPage from '@/app/(marketing)/terms/page';
import { PublicPlanShowcase } from '@/components/marketing/public-plan-showcase';
import { MARKETING_FAQ_GROUPS } from '@/lib/marketing-content';

function answerFor(question: string): string {
  const faq = MARKETING_FAQ_GROUPS.flatMap((group) => group.faqs).find(
    (entry) => entry.question === question,
  );
  if (!faq) throw new Error(`FAQ not found: ${question}`);
  return faq.answer;
}

describe('marketing FAQ, pricing, and terms', () => {
  it('shows all static offers and Free limitations in the pricing section', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<PricingPage />);

    expect(screen.getByText('Starter')).toBeTruthy();
    const pricing = screen.getByRole('heading', { level: 1 }).closest('#pricing');
    expect(pricing).not.toBeNull();
    const pricingText = pricing?.textContent ?? '';
    expect(pricingText).toContain('Free');
    expect(pricingText).toContain('₱0');
    expect(pricingText).toContain('Up to 20 active garments');
    expect(pricingText).toContain('Free forever');
    expect(pricingText).toContain('Availability-only storefront with contact links');
    expect(pricingText).toContain('No fittings on the business app or storefront');
    expect(pricingText).toContain('No online storefront payment methods');
    expect(pricingText).toContain('2 storefront designs');
    expect(pricingText).toContain('₱149');
    expect(pricingText).toContain('Up to 125 active garments');
    expect(pricingText).toContain('Owner-only access (no Front Desk accounts)');
    expect(pricingText).toContain('Standard');
    expect(pricingText).toContain('₱299');
    expect(pricingText).toContain('Up to 300 active garments');
    expect(pricingText).toContain('Up to 3 Front Desk staff');
    const starterCard = screen.getByText('Starter').closest('li');
    expect(starterCard?.textContent).not.toContain('Front Desk staff');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('renders static offers in the shared showcase used by the landing page', () => {
    const { container } = render(<PublicPlanShowcase signUpUrl="/sign-up" />);
    const pricing = container.querySelector('#pricing');

    expect(pricing?.textContent).toContain('Starter');
    expect(pricing?.textContent).toContain('₱149');
    expect(pricing?.textContent).toContain('Up to 125 active garments');
    expect(pricing?.textContent).toContain('Standard');
    expect(pricing?.textContent).toContain('₱299');
    expect(pricing?.textContent).toContain('Up to 300 active garments');
  });

  it('moves billing-detail explanations to the FAQ instead of the pricing page', () => {
    render(<PricingPage />);

    expect(screen.getByText('Starter')).toBeTruthy();
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

  it('describes Free and paid plan access, prices, and quotas', () => {
    const answer = answerFor('Can staff access everything in my account?');

    expect(answer).toContain('Free and Starter are for the shop owner only');
    expect(answer).toContain('do not include Front Desk accounts');
    expect(answer).toContain('up to 3 Front Desk staff accounts');
    expect(answer).toContain('role-limited');
    const pricingAnswer = answerFor('How much does Drezivo cost?');
    expect(pricingAnswer).toContain('Starter is ₱149 a month');
    expect(pricingAnswer).toContain('up to 125 active garments');
    expect(pricingAnswer).toContain('Standard is ₱299 a month');
    expect(pricingAnswer).toContain('up to 300 active garments');
    expect(pricingAnswer).toContain('Starter and Standard include a 14-day trial');
    const trialAnswer = answerFor('What happens when my paid-plan trial ends? Will I lose my data?');
    expect(trialAnswer).toContain('Free has no trial or expiry');
    expect(trialAnswer).toContain('read-only for up to 30 days');
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

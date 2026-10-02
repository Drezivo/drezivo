import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PricingPage from '@/app/(marketing)/pricing/page';
import TermsPage from '@/app/(marketing)/terms/page';
import { MARKETING_FAQ_GROUPS } from '@/lib/marketing-content';

function answerFor(question: string): string {
  const faq = MARKETING_FAQ_GROUPS.flatMap((group) => group.faqs).find(
    (entry) => entry.question === question,
  );
  if (!faq) throw new Error(`FAQ not found: ${question}`);
  return faq.answer;
}

describe('marketing FAQ, pricing, and terms', () => {
  it('moves billing-detail explanations to the FAQ instead of the pricing page', () => {
    render(<PricingPage />);

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

  it('keeps the current Standard plan owner-only', () => {
    const answer = answerFor('Can staff access everything in my account?');

    expect(answer).toContain('shop owner only');
    expect(answer).toContain('does not include staff accounts');
    expect(answerFor('How much does Drezivo cost?')).toContain('up to 125 active physical garments');
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

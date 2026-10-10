import type { Metadata } from 'next';

import { PublicPlanShowcase } from '@/components/marketing/public-plan-showcase';
import { buildMarketingMetadata } from '@/lib/seo';
import { SIGN_UP_URL } from '@/lib/site-urls';

export const metadata: Metadata = buildMarketingMetadata(
  'Pricing',
  'Simple, transparent pricing for Philippine clothing rental businesses. No hidden fees.',
);

/**
 * The same plan showcase as the landing page, as a page of its own. Billing details that need more
 * explanation live in the FAQ so the pricing page stays focused on the current offer.
 */
export default function PricingPage() {
  return <PublicPlanShowcase signUpUrl={SIGN_UP_URL} headingLevel="h1" />;
}

import type { Metadata } from 'next';

import { AtelierHero } from '@/components/marketing/atelier/hero/atelier-hero';
import { BeforeAfter } from '@/components/marketing/atelier/sections/before-after';
import { ClosingCall, FaqTeaser } from '@/components/marketing/atelier/sections/closing';
import { HowItWorks } from '@/components/marketing/atelier/sections/how-it-works';
import { ShopMarquee } from '@/components/marketing/atelier/sections/marquee';
import { PublicPlanShowcase } from '@/components/marketing/public-plan-showcase';
import { ProductBento } from '@/components/marketing/atelier/sections/product-bento';
import { MARKETING_FAQS, MARKETING_TRIAL_DAYS } from '@/lib/marketing-content';
import { buildMarketingMetadata } from '@/lib/seo';
import { SIGN_UP_URL } from '@/lib/site-urls';

export const metadata: Metadata = buildMarketingMetadata(
  'Clothing Rental Management Software',
  'Drezivo runs the busy side of a Philippine clothing rental shop: availability, reservations, deposits, payments, and returns, with a storefront renters book from.',
);

const FEATURED_FAQ_COUNT = 5;

export default function LandingPage() {
  const trialDays = MARKETING_TRIAL_DAYS;

  return (
    <>
      <AtelierHero signUpUrl={SIGN_UP_URL} priceLabel={null} trialDays={trialDays} />
      <BeforeAfter />
      <ShopMarquee />
      <ProductBento />
      <HowItWorks />
      <PublicPlanShowcase signUpUrl={SIGN_UP_URL} />
      <FaqTeaser faqs={MARKETING_FAQS.slice(0, FEATURED_FAQ_COUNT)} />
      <ClosingCall signUpUrl={SIGN_UP_URL} trialDays={trialDays} />
    </>
  );
}

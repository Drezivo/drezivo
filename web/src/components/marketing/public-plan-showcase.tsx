import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { PUBLIC_MARKETING_PLANS } from '@/lib/plans';

export function PublicPlanShowcase({
  signUpUrl,
  headingLevel = 'h2',
}: {
  signUpUrl: string;
  headingLevel?: 'h1' | 'h2';
}) {
  return (
    <PlanShowcase
      plans={PUBLIC_MARKETING_PLANS}
      signUpUrl={signUpUrl}
      headingLevel={headingLevel}
    />
  );
}

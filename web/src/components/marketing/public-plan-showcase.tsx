import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { PUBLIC_MARKETING_PLANS } from '@/lib/plans';
import { CONTACT_EMAIL } from '@/lib/site-urls';

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
      customPlanContactHref={`mailto:${CONTACT_EMAIL}?subject=Custom%20Drezivo%20plan%20inquiry`}
      headingLevel={headingLevel}
    />
  );
}

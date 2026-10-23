import { formatPlanPrice, type PublicPlan } from '@/lib/plans';

import { TapeMeasure } from '../art/tape-measure';

const PAY_WITH = ['GCash', 'Maya', 'Bank transfer'];

function Features({
  featureIntro,
  features,
  onDark = false,
}: {
  featureIntro?: string;
  features: readonly string[];
  onDark?: boolean;
}) {
  return (
    <div>
      {featureIntro ? (
        <p className={`mb-2 text-at-small font-medium ${onDark ? 'text-atelier-paper' : 'text-atelier-ink'}`}>
          {featureIntro}
        </p>
      ) : null}
      <ul className="grid gap-1">
        {features.map((feature) => (
          <li key={feature} className="flex gap-3 py-1 text-at-body leading-[1.5]">
            <span aria-hidden="true" className="mt-[0.55em] h-px w-4 shrink-0 bg-atelier-gold" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One plan: no comparison to make, so the plan gets the whole stage. */
function SinglePlan({ plan, signUpUrl }: { plan: PublicPlan; signUpUrl: string }) {
  return (
    <div className="mt-at-stack grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <div data-at-reveal="up" className="relative">
        <p className="at-eyebrow text-atelier-gold-ink">{plan.name}</p>
        <p className="mt-6 flex items-start font-[family-name:var(--font-atelier-display)] leading-[0.85] tracking-[-0.03em]">
          <span className="text-at-price tabular-nums">{formatPlanPrice(plan.price)}</span>
        </p>
        <p className="mt-4 text-at-lead text-atelier-muted">
          {plan.trialDays === 0 ? 'Free forever' : `a month, after your ${plan.trialDays}-day free trial`}
        </p>
        <div className="at-cta-row mt-10">
          <a href={signUpUrl} className="at-button at-button-dark">
            {plan.trialDays === 0 ? `Start with ${plan.name}` : 'Start your free trial'}
          </a>
          <p className="text-at-small text-atelier-muted">
            {plan.trialDays === 0 ? 'No payment needed.' : 'No credit card needed.'}
          </p>
        </div>
      </div>
      <div data-at-reveal="up">
        <p className="max-w-[30rem] font-[family-name:var(--font-atelier-display)] text-at-subhead leading-[1.3]">{plan.tagline}</p>
        <div className="mt-8"><Features featureIntro={plan.featureIntro} features={plan.features} /></div>
        <div className="mt-10 rounded-[1rem] border border-atelier-paper-line bg-atelier-paper-2 p-6">
          <p className="text-at-small font-medium">Paying is as simple as your renters paying you.</p>
          <p className="mt-2 text-at-small leading-[1.7] text-atelier-muted">
            Send ₱{Number(plan.price).toLocaleString('en-PH')} by {PAY_WITH.slice(0, -1).join(', ')} or {PAY_WITH.at(-1)?.toLowerCase()}, upload the receipt
            in the app, and we confirm it. No card, no automatic charges.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Accepted payment methods">
            {PAY_WITH.map((method) => (
              <li key={method} className="rounded-full border border-atelier-paper-line px-3 py-1 text-at-micro font-medium">{method}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Plan cards side by side, with the highlighted fixed plan on the night ground. */
function PlanCards({
  plans,
  signUpUrl,
  customPlanContactHref,
}: {
  plans: readonly PublicPlan[];
  signUpUrl: string;
  customPlanContactHref?: string;
}) {
  const layout = customPlanContactHref
    ? 'md:grid-cols-2 xl:grid-cols-4'
    : plans.length === 2
      ? 'md:grid-cols-2 max-w-[60rem]'
      : plans.length === 3
        ? 'lg:grid-cols-3'
        : 'md:grid-cols-2 xl:grid-cols-4';
  return (
    <ul data-at-stagger className={`mx-auto mt-12 grid items-stretch gap-4 sm:gap-6 lg:mt-16 xl:gap-5 ${layout}`}>
      {plans.map((plan) => (
        <li
          key={plan.code}
          data-at-item
          className={`flex min-w-0 flex-col rounded-[1.25rem] border p-6 xl:p-7 2xl:p-8 ${
            plan.highlighted ? 'relative z-10 border-atelier-night bg-atelier-night text-atelier-paper lg:-my-4 lg:py-12' : 'border-atelier-paper-line bg-atelier-paper-2'
          }`}
        >
          <p className={`at-eyebrow ${plan.highlighted ? 'text-atelier-champagne' : 'text-atelier-gold-ink'}`}>{plan.name}</p>
          <p className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display leading-none tabular-nums">{formatPlanPrice(plan.price)}</p>
          <p className={`mt-2 text-at-small ${plan.highlighted ? 'text-atelier-mist' : 'text-atelier-muted'}`}>
            {plan.trialDays === 0 ? 'Free forever' : `a month · ${plan.trialDays}-day free trial`}
          </p>
          <p className={`mt-6 text-at-body leading-[1.6] ${plan.highlighted ? 'text-atelier-mist' : 'text-atelier-muted'}`}>{plan.tagline}</p>
          <div className="mt-6 flex-1"><Features featureIntro={plan.featureIntro} features={plan.features} onDark={plan.highlighted} /></div>
          <a href={signUpUrl} className={`at-button mt-8 w-full justify-center ${plan.highlighted ? 'at-button-light' : 'at-button-dark'}`}>Start with {plan.name}</a>
        </li>
      ))}
      {customPlanContactHref ? (
        <li data-at-item className="flex min-w-0 flex-col rounded-[1.25rem] border border-atelier-paper-line bg-atelier-paper-2 p-6 xl:p-7 2xl:p-8">
          <p className="at-eyebrow text-atelier-gold-ink">Custom</p>
          <p className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-subhead leading-[1.2]">
            A monthly quote shaped around your shop.
          </p>
          <p className="mt-6 flex-1 text-at-body leading-[1.6] text-atelier-muted">
            Need more capacity, such as 500 active garments or 10 Front Desk seats, or a different mix of features Drezivo already offers? Talk with us about what fits.
          </p>
          <p className="mt-6 text-at-small text-atelier-muted">
            Custom terms are discussed with our team and are not available for self-service signup.
          </p>
          <a href={customPlanContactHref} className="at-button at-button-dark mt-8 w-full justify-center">
            Talk to us
          </a>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Pricing as its own chapter. With a single plan there is nothing to compare, so the price is the
 * headline; when multiple plans are offered, the same section becomes cards.
 */
export function PlanShowcase({
  plans,
  signUpUrl,
  customPlanContactHref,
  headingLevel = 'h2',
}: {
  plans: readonly PublicPlan[];
  signUpUrl: string;
  customPlanContactHref?: string;
  /** `h1` when the showcase is the page itself (/pricing) rather than a landing section. */
  headingLevel?: 'h1' | 'h2';
}) {
  if (plans.length === 0) return null;
  const single = plans.length === 1 && !customPlanContactHref;
  const Heading = headingLevel;
  return (
    <section id="pricing" data-header="light" className="relative isolate overflow-hidden bg-atelier-paper py-at-section text-atelier-ink">
      <TapeMeasure className="at-art bottom-8 left-[-12%] h-auto w-[130%] -rotate-[5deg] md:bottom-auto md:left-auto md:right-[-10%] md:top-40 md:w-[58%] md:-rotate-[6deg]" />
      <div className="at-container">
        <div className="mx-auto max-w-[46rem] text-center" data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-gold-ink">Pricing</p>
          <Heading className="mt-6 font-[family-name:var(--font-atelier-display)] text-at-display font-normal">
            {single ? (
              <>
                <span className="block overflow-hidden"><span data-at-line className="block">One plan.{' '}</span></span>
                <span className="block overflow-hidden"><span data-at-line className="block italic">Everything in it.{' '}</span></span>
              </>
            ) : (
              <>
                <span className="block overflow-hidden"><span data-at-line className="block">Plans that grow{' '}</span></span>
                <span className="block overflow-hidden"><span data-at-line className="block italic">with your shop.{' '}</span></span>
              </>
            )}
          </Heading>
        </div>
        {single ? (
          <SinglePlan plan={plans[0]!} signUpUrl={signUpUrl} />
        ) : (
          <PlanCards plans={plans} signUpUrl={signUpUrl} customPlanContactHref={customPlanContactHref} />
        )}
      </div>
    </section>
  );
}

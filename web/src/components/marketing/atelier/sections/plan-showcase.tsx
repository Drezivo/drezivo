import { formatPlanPrice, type PublicPlan } from '@/lib/plans';

import { TapeMeasure } from '../art/tape-measure';

const PAY_WITH = ['GCash', 'Maya', 'Bank transfer'];

function Features({ features, onDark = false }: { features: readonly string[]; onDark?: boolean }) {
  return (
    <ul className="grid">
      {features.map((feature) => (
        <li key={feature} className={`flex gap-4 border-t py-4 text-[1rem] leading-[1.5] ${onDark ? 'border-atelier-night-line' : 'border-atelier-paper-line'}`}>
          <span aria-hidden="true" className="mt-[0.55em] h-px w-4 shrink-0 bg-atelier-gold" />
          {feature}
        </li>
      ))}
    </ul>
  );
}

/** One plan: no comparison to make, so the plan gets the whole stage. */
function SinglePlan({ plan, signUpUrl }: { plan: PublicPlan; signUpUrl: string }) {
  return (
    <div className="mt-16 grid gap-14 lg:mt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <div data-at-reveal="up" className="relative">
        <p className="at-eyebrow text-atelier-gold-ink">{plan.name}</p>
        <p className="mt-6 flex items-start font-[family-name:var(--font-atelier-display)] leading-[0.85] tracking-[-0.03em]">
          <span className="text-[clamp(6rem,15vw,12.5rem)] tabular-nums">{formatPlanPrice(plan.price)}</span>
        </p>
        <p className="mt-4 text-[1.0625rem] text-atelier-muted">a month, after your {plan.trialDays}-day free trial</p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a href={signUpUrl} className="at-button at-button-dark">Start your free trial</a>
          <p className="text-sm text-atelier-muted">No credit card needed.</p>
        </div>
      </div>
      <div data-at-reveal="up">
        <p className="max-w-[30rem] font-[family-name:var(--font-atelier-display)] text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.3]">{plan.tagline}</p>
        <div className="mt-8"><Features features={plan.features} /></div>
        <div className="mt-10 rounded-[1rem] border border-atelier-paper-line bg-atelier-paper-2 p-6">
          <p className="text-sm font-medium">Paying is as simple as your renters paying you.</p>
          <p className="mt-2 text-sm leading-[1.7] text-atelier-muted">
            Send ₱{Number(plan.price).toLocaleString('en-PH')} by {PAY_WITH.slice(0, -1).join(', ')} or {PAY_WITH.at(-1)?.toLowerCase()}, upload the receipt
            in the app, and we confirm it. No card, no automatic charges.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Accepted payment methods">
            {PAY_WITH.map((method) => (
              <li key={method} className="rounded-full border border-atelier-paper-line px-3 py-1 text-xs font-medium">{method}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Two to four plans: cards side by side, the highlighted one on the night ground. */
function PlanCards({ plans, signUpUrl }: { plans: readonly PublicPlan[]; signUpUrl: string }) {
  const layout = plans.length === 2 ? 'md:grid-cols-2 max-w-[60rem]' : plans.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-4';
  return (
    <ul data-at-stagger className={`mx-auto mt-16 grid gap-6 lg:mt-24 ${layout}`}>
      {plans.map((plan) => (
        <li
          key={plan.code}
          data-at-item
          className={`flex flex-col rounded-[1.25rem] border p-8 ${
            plan.highlighted ? 'border-atelier-night bg-atelier-night text-atelier-paper lg:-my-4 lg:py-12' : 'border-atelier-paper-line bg-atelier-paper-2'
          }`}
        >
          <p className={`at-eyebrow ${plan.highlighted ? 'text-atelier-champagne' : 'text-atelier-gold-ink'}`}>{plan.name}</p>
          <p className="mt-6 font-[family-name:var(--font-atelier-display)] text-[3.5rem] leading-none tracking-[-0.02em] tabular-nums">{formatPlanPrice(plan.price)}</p>
          <p className={`mt-2 text-sm ${plan.highlighted ? 'text-atelier-mist' : 'text-atelier-muted'}`}>a month · {plan.trialDays}-day free trial</p>
          <p className={`mt-6 text-[0.975rem] leading-[1.6] ${plan.highlighted ? 'text-atelier-mist' : 'text-atelier-muted'}`}>{plan.tagline}</p>
          <div className="mt-6 flex-1"><Features features={plan.features} onDark={plan.highlighted} /></div>
          <a href={signUpUrl} className={`at-button mt-8 justify-center ${plan.highlighted ? 'at-button-light' : 'at-button-dark'}`}>Start with {plan.name}</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pricing as its own chapter. With a single plan there is nothing to compare, so the price is the
 * headline; when the operator console publishes two to four plans, the same section becomes cards.
 */
export function PlanShowcase({
  plans,
  signUpUrl,
  headingLevel = 'h2',
}: {
  plans: readonly PublicPlan[];
  signUpUrl: string;
  /** `h1` when the showcase is the page itself (/pricing) rather than a landing section. */
  headingLevel?: 'h1' | 'h2';
}) {
  if (plans.length === 0) return null;
  const single = plans.length === 1;
  const Heading = headingLevel;
  return (
    <section id="pricing" data-header="light" className="relative isolate overflow-hidden bg-atelier-paper py-28 text-atelier-ink lg:py-40">
      <TapeMeasure className="at-art bottom-8 left-[-12%] h-auto w-[130%] -rotate-[5deg] md:bottom-auto md:left-auto md:right-[-10%] md:top-40 md:w-[58%] md:-rotate-[6deg]" />
      <div className="at-container">
        <div className="max-w-[46rem]" data-at-reveal="lines">
          <p className="at-eyebrow text-atelier-gold-ink">Pricing</p>
          <Heading className="mt-6 font-[family-name:var(--font-atelier-display)] text-[clamp(2.5rem,5vw,4.5rem)] font-normal leading-[1.02] tracking-[-0.02em]">
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
        {single ? <SinglePlan plan={plans[0]!} signUpUrl={signUpUrl} /> : <PlanCards plans={plans} signUpUrl={signUpUrl} />}
      </div>
    </section>
  );
}

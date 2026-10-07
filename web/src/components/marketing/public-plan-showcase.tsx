'use client';

import { useEffect, useState } from 'react';

import { PlanShowcase } from '@/components/marketing/atelier/sections/plan-showcase';
import { toPublicPlans } from '@/lib/plans';
import { getPublicPlanCatalog, StorefrontApiError } from '@/lib/storefront-api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plans: ReturnType<typeof toPublicPlans> };

export function PublicPlanShowcase({
  signUpUrl,
  headingLevel = 'h2',
}: {
  signUpUrl: string;
  headingLevel?: 'h1' | 'h2';
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void getPublicPlanCatalog()
      .then((catalog) => {
        if (active) setState({ kind: 'ready', plans: toPublicPlans(catalog) });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof StorefrontApiError
            ? error.message
            : 'We could not load current plan details. Please try again.';
        setState({ kind: 'error', message });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.kind === 'ready') {
    return <PlanShowcase plans={state.plans} signUpUrl={signUpUrl} headingLevel={headingLevel} />;
  }

  return (
    <section
      id="pricing"
      data-header="light"
      aria-busy={state.kind === 'loading'}
      className="bg-atelier-paper py-at-section text-atelier-ink"
    >
      <div className="at-container">
        <p className="at-eyebrow text-atelier-gold-ink">Pricing</p>
        {state.kind === 'loading' ? (
          <p className="mt-6 text-at-lead text-atelier-muted" role="status">
            Loading current plans…
          </p>
        ) : (
          <div className="mt-6 max-w-xl" role="alert">
            <p className="text-at-lead">We could not load current plans.</p>
            <p className="mt-2 text-at-small text-atelier-muted">{state.message}</p>
            <button
              type="button"
              className="at-button at-button-dark mt-6"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

import type { PublicPlanCatalogResponse } from '@drezivo/contracts';

/** A subscription plan as the marketing site shows it. */
export interface PublicPlan {
  readonly code: string;
  readonly name: string;
  readonly tagline: string;
  /** Pesos with centavos, e.g. "299.00". */
  readonly price: string;
  readonly interval: 'month';
  readonly trialDays: number;
  readonly features: readonly string[];
  readonly highlighted: boolean;
}

/** The marketing site lays out between one and four plans; more would need a different page. */
export const MAX_PUBLIC_PLANS = 4;

/** Builds marketing cards from the validated, server-owned catalog response. */
export function toPublicPlans(catalog: PublicPlanCatalogResponse): readonly PublicPlan[] {
  return catalog.plans.slice(0, MAX_PUBLIC_PLANS).map((plan) => {
    const features = [`Up to ${plan.limits.active_garments} active garments`];
    if (plan.limits.frontdesk_seats > 0) {
      features.push(`Up to ${plan.limits.frontdesk_seats} Front Desk staff`);
    }
    features.push(
      'Online storefront with bookings and fittings',
      'Reservations, calendar & availability',
      'Customers, payments, returns & exports',
    );
    return {
      code: plan.code,
      name: plan.name,
      tagline:
        plan.code === 'starter'
          ? 'The essentials to keep a clothing rental shop organized and bookable.'
          : 'More room for a growing rental shop and a small front-desk team.',
      price: (plan.monthly_price_minor / 100).toFixed(2),
      interval: 'month',
      trialDays: plan.trial_days,
      features,
      highlighted: plan.code === 'standard',
    };
  });
}

/** Formats whole pesos without centavos and preserves non-zero centavos. */
export function formatPlanPrice(price: string): string {
  const value = Number(price);
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

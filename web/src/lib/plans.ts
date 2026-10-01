import { MARKETING_PLANS, MARKETING_TRIAL_DAYS } from './marketing-content';

/** A subscription plan as the marketing site shows it. */
export interface PublicPlan {
  readonly code: string;
  readonly name: string;
  readonly tagline: string;
  /** Pesos with centavos, e.g. "300.00". */
  readonly price: string;
  readonly interval: 'month';
  readonly trialDays: number;
  readonly features: readonly string[];
  readonly highlighted: boolean;
}

/** The marketing site lays out between one and four plans; more would need a different page. */
export const MAX_PUBLIC_PLANS = 4;

/**
 * Plans to show. During the pilot there is one plan and the copy lives in marketing-content;
 * the operator-managed plan catalogue replaces this source without changing the shape.
 */
export function getPublicPlans(): readonly PublicPlan[] {
  return MARKETING_PLANS.slice(0, MAX_PUBLIC_PLANS).map((plan, index) => ({
    code: plan.name.toLowerCase(),
    name: plan.name,
    tagline: plan.blurb,
    price: plan.price,
    interval: 'month',
    trialDays: MARKETING_TRIAL_DAYS,
    features: plan.features,
    highlighted: plan.highlighted ?? index === 0,
  }));
}

/** "₱300" for whole pesos, "₱300.50" otherwise. */
export function formatPlanPrice(price: string): string {
  const value = Number(price);
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

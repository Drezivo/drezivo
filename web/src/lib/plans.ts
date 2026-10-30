/** A subscription plan as the marketing site shows it. */
export interface PublicPlan {
  readonly code: string;
  readonly name: string;
  readonly tagline: string;
  /** Pesos with centavos, e.g. "299.00". */
  readonly price: string;
  readonly interval: 'month';
  readonly trialDays: number;
  readonly featureIntro?: string;
  readonly features: readonly string[];
  readonly highlighted: boolean;
}

/**
 * Code-owned marketing snapshot. The API catalog remains authoritative for onboarding, billing,
 * and enforcement; update this snapshot in the same release whenever those public offers change.
 */
export const PUBLIC_MARKETING_PLANS: readonly PublicPlan[] = [
  {
    code: 'free',
    name: 'Free',
    tagline: 'Organize your shop and let renters check availability.',
    price: '0.00',
    interval: 'month',
    trialDays: 0,
    features: [
      'Up to 20 active garments',
      'Owner-only access (no Front Desk accounts)',
      'Availability-only storefront with contact links; 2 storefront designs',
      'Reservations, calendar & availability; customers and staff payment records',
      'Returns & exports; no fittings on the business app or storefront; no online storefront payment methods',
    ],
    highlighted: false,
  },
  {
    code: 'starter',
    name: 'Starter',
    tagline: 'The essentials to keep a clothing rental shop organized and bookable.',
    price: '149.00',
    interval: 'month',
    trialDays: 14,
    featureIntro: 'All Free plan features, plus these upgrades:',
    features: [
      'Up to 125 active garments',
      'Online storefront with bookings and fittings',
      'Online storefront payment methods',
      'All 4 storefront designs',
    ],
    highlighted: false,
  },
  {
    code: 'standard',
    name: 'Standard',
    tagline: 'More room for a growing rental shop and a small front-desk team.',
    price: '299.00',
    interval: 'month',
    trialDays: 14,
    featureIntro: 'All Starter plan features, plus these upgrades:',
    features: [
      'Up to 300 active garments',
      'Up to 3 Front Desk staff',
    ],
    highlighted: true,
  },
];

/** Formats whole pesos without centavos and preserves non-zero centavos. */
export function formatPlanPrice(price: string): string {
  const value = Number(price);
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

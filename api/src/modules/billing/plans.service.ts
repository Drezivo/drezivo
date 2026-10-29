import { publicPlanCatalogResponse, type PlanCode, type PublicPlanCatalogResponse } from '@drezivo/contracts';

import { DependencyUnavailableError } from '../../shared/errors.js';
import { TRIAL_DURATION_DAYS } from './billing.constants.js';
import { listActivePlanRows, PLAN_CAPABILITIES } from './plans.repository.js';

const PLAN_CODES: readonly PlanCode[] = ['free', 'starter', 'standard', 'growth', 'scale'];
const PLAN_NAME: Record<PlanCode, 'Free' | 'Starter' | 'Standard' | 'Growth' | 'Scale'> = {
  free: 'Free',
  starter: 'Starter',
  standard: 'Standard',
  growth: 'Growth',
  scale: 'Scale',
};
const BOOLEAN_FEATURES = [
  'fittings.enabled',
  'storefront_reservations.enabled',
  'storefront_payments.enabled',
] as const;
const STOREFRONT_THEMES = ['ivory', 'sage', 'blush', 'noir'] as const;

export async function getPublicPlanCatalog(): Promise<PublicPlanCatalogResponse> {
  const rows = await listActivePlanRows();
  const plans = PLAN_CODES.map((code) => {
    const planRows = rows.filter((row) => row.code === code);
    const byCapability = new Map(planRows.map((row) => [row.capability, row]));
    const garmentLimit = byCapability.get('physical_assets.max');
    const frontdeskLimit = byCapability.get('frontdesk_seats.max');
    const plan = planRows[0];
    if (
      !plan ||
      planRows.length !== PLAN_CAPABILITIES.length ||
      PLAN_CAPABILITIES.some((capability) => {
        const row = byCapability.get(capability);
        return !row || !row.enabled || row.limit_value === null;
      }) ||
      !garmentLimit ||
      !frontdeskLimit ||
      garmentLimit.limit_value === null ||
      garmentLimit.limit_value < 1 ||
      frontdeskLimit.limit_value === null ||
      frontdeskLimit.limit_value < 0 ||
      plan.currency !== 'PHP' ||
      plan.monthly_minor < 0 ||
      planRows.some(
        (row) => row.monthly_minor !== plan.monthly_minor || row.currency !== plan.currency,
      )
    ) {
      throw new DependencyUnavailableError('The plan catalog is temporarily unavailable.');
    }
    const booleanFeature = (capability: string): boolean => {
      const value = byCapability.get(capability)?.limit_value;
      if (value !== 0 && value !== 1) {
        throw new DependencyUnavailableError('The plan catalog is temporarily unavailable.');
      }
      return value === 1;
    };
    const features = {
      fittings: booleanFeature(BOOLEAN_FEATURES[0]),
      storefront_reservations: booleanFeature(BOOLEAN_FEATURES[1]),
      storefront_payments: booleanFeature(BOOLEAN_FEATURES[2]),
      storefront_themes: STOREFRONT_THEMES.filter((theme) =>
        booleanFeature(`storefront_theme.${theme}`),
      ),
    };
    const isFree = code === 'free';
    return {
      code,
      name: PLAN_NAME[code],
      monthly_price_minor: plan.monthly_minor,
      currency: 'PHP' as const,
      trial_days: isFree ? 0 : TRIAL_DURATION_DAYS,
      limits: {
        active_garments: garmentLimit.limit_value,
        frontdesk_seats: frontdeskLimit.limit_value,
      },
      features,
    };
  });

  const parsed = publicPlanCatalogResponse.safeParse({ plans });
  if (!parsed.success) {
    throw new DependencyUnavailableError('The plan catalog is temporarily unavailable.');
  }
  return parsed.data;
}

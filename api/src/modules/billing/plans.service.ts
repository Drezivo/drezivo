import { publicPlanCatalogResponse, type PublicPlanCatalogResponse } from '@drezivo/contracts';

import { DependencyUnavailableError } from '../../shared/errors.js';
import { TRIAL_DURATION_DAYS } from './billing.constants.js';
import { listActivePlanRows } from './plans.repository.js';

const PUBLIC_PLAN_CODES = ['starter', 'standard'] as const;

export async function getPublicPlanCatalog(): Promise<PublicPlanCatalogResponse> {
  const rows = await listActivePlanRows();
  const plans = PUBLIC_PLAN_CODES.map((code) => {
    const planRows = rows.filter((row) => row.code === code);
    const garmentLimit = planRows.find((row) => row.capability === 'physical_assets.max');
    const frontdeskLimit = planRows.find((row) => row.capability === 'frontdesk_seats.max');
    const plan = planRows[0];
    if (
      !plan ||
      planRows.length !== 2 ||
      !garmentLimit ||
      !frontdeskLimit ||
      !garmentLimit.enabled ||
      !frontdeskLimit.enabled ||
      garmentLimit.limit_value === null ||
      frontdeskLimit.limit_value === null ||
      planRows.some(
        (row) => row.monthly_minor !== plan.monthly_minor || row.currency !== plan.currency,
      )
    ) {
      throw new DependencyUnavailableError('The plan catalog is temporarily unavailable.');
    }
    return {
      code,
      name: code === 'starter' ? 'Starter' : 'Standard',
      monthly_price_minor: plan.monthly_minor,
      currency: plan.currency,
      trial_days: TRIAL_DURATION_DAYS,
      limits: {
        active_garments: garmentLimit.limit_value,
        frontdesk_seats: frontdeskLimit.limit_value,
      },
    };
  });

  const parsed = publicPlanCatalogResponse.safeParse({ plans });
  if (!parsed.success) {
    throw new DependencyUnavailableError('The plan catalog is temporarily unavailable.');
  }
  return parsed.data;
}

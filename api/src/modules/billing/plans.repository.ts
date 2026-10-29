import { pool } from '../../db/client.js';

export const PLAN_CAPABILITIES = [
  'physical_assets.max',
  'frontdesk_seats.max',
  'fittings.enabled',
  'storefront_reservations.enabled',
  'storefront_payments.enabled',
  'storefront_theme.ivory',
  'storefront_theme.sage',
  'storefront_theme.blush',
  'storefront_theme.noir',
] as const;

export interface PlanCatalogRow {
  code: string;
  monthly_minor: number;
  currency: string;
  capability: string;
  limit_value: number | null;
  enabled: boolean;
}

export async function listActivePlanRows(): Promise<PlanCatalogRow[]> {
  const result = await pool.query<PlanCatalogRow>(
    `SELECT p.code, p.monthly_minor, p.currency,
            e.capability, e.limit_value, e.enabled
       FROM plan p
       JOIN plan_entitlement e ON e.plan_id = p.id
      WHERE p.active IS TRUE
        AND p.version = 1
        AND p.code IN ('free', 'starter', 'standard', 'growth', 'scale')
        AND e.capability = ANY($1::text[])
      ORDER BY CASE p.code
                 WHEN 'free' THEN 1
                 WHEN 'starter' THEN 2
                 WHEN 'standard' THEN 3
                 WHEN 'growth' THEN 4
                 WHEN 'scale' THEN 5
               END,
               e.capability`,
    [[...PLAN_CAPABILITIES]],
  );
  return result.rows;
}

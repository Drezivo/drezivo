import { pool } from '../../db/client.js';

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
        AND p.code IN ('starter', 'standard')
        AND e.capability IN ('physical_assets.max', 'frontdesk_seats.max')
      ORDER BY CASE p.code WHEN 'starter' THEN 1 WHEN 'standard' THEN 2 END,
               e.capability`,
  );
  return result.rows;
}

import type { PoolClient } from 'pg';

export interface FittingSettingsReadModel {
  branch_id: string;
  enabled: boolean;
  capacity: number;
  duration_minutes: number;
  fee_minor: string | number;
  currency: string;
  timezone: string;
  version: string | number;
  updated_at: Date;
}

export async function readFittingSettingsModel(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<FittingSettingsReadModel | null> {
  const result = await client.query<FittingSettingsReadModel>(
    `SELECT fs.branch_id,
            fs.enabled,
            fs.capacity,
            fs.duration_minutes,
            fs.fee_minor,
            fs.currency,
            b.timezone,
            fs.version,
            fs.updated_at
       FROM fitting_settings fs
       JOIN branch b
         ON b.tenant_id = fs.tenant_id
        AND b.id = fs.branch_id
      WHERE fs.tenant_id = $1
        AND fs.branch_id = $2
      LIMIT 1`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

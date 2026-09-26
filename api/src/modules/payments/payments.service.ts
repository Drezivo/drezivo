import {
  centralPaymentsQuery,
  centralPaymentsResponse,
  type CentralPaymentsQuery,
  type CentralPaymentsResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { listCentralPayments } from './payments.repository.js';

export interface CentralPaymentsContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
}

export async function getCentralPayments(
  context: CentralPaymentsContext,
  queryInput: CentralPaymentsQuery,
): Promise<CentralPaymentsResponse> {
  const parsed = centralPaymentsQuery.safeParse(queryInput);
  if (!parsed.success) throw new ValidationError('Payments query is invalid.');
  if (!context.permissionCodes.includes('payments.view')) {
    throw new ForbiddenError('This branch does not grant payment visibility.');
  }
  const query = parsed.data;

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const rows = await listCentralPayments(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      query,
    });
    return centralPaymentsResponse.parse({
      window: { start: query.start, end: query.end },
      items: rows.map((row) => ({
        id: row.payment_id,
        source: row.source,
        reservation_id: row.reservation_id,
        fitting_id: row.fitting_id,
        customer_name: row.customer_name,
        payment_method_name: row.payment_method_name,
        rail: row.rail,
        amount_minor: String(row.amount_minor),
        currency: row.currency,
        status: row.status,
        evidence_status: row.evidence_status,
        latest_refund_status: row.latest_refund_status,
        active_refund_minor: String(row.active_refund_minor),
        completed_refund_minor: String(row.completed_refund_minor),
        verified_at: row.verified_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
      })),
    });
  });
}

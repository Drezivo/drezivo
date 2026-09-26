import type { PoolClient } from 'pg';

import type { CentralPaymentsQuery } from '@drezivo/contracts';

export interface CentralPaymentRow {
  payment_id: string;
  reservation_id: string | null;
  fitting_id: string | null;
  source: 'reservation' | 'fitting';
  customer_name: string;
  payment_method_name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  amount_minor: string | number;
  currency: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
  evidence_status:
    | 'not_required'
    | 'awaiting_upload'
    | 'uploaded'
    | 'under_review'
    | 'verified'
    | 'rejected'
    | 'superseded';
  latest_refund_status: 'requested' | 'processing' | 'completed' | 'failed' | 'cancelled' | null;
  active_refund_minor: string | number;
  completed_refund_minor: string | number;
  verified_at: Date | null;
  created_at: Date;
}

export async function listCentralPayments(
  client: PoolClient,
  input: { tenantId: string; branchId: string; query: CentralPaymentsQuery },
): Promise<CentralPaymentRow[]> {
  const values: unknown[] = [input.tenantId, input.branchId, input.query.start, input.query.end];
  const where = [
    'p.tenant_id = $1::uuid',
    'p.created_at >= $3::timestamptz',
    'p.created_at < $4::timestamptz',
    `(
      (p.reservation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM reservation r_scope
        WHERE r_scope.tenant_id = p.tenant_id AND r_scope.id = p.reservation_id AND r_scope.branch_id = $2::uuid
      ))
      OR
      (p.fitting_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM fitting_appointment f_scope
        WHERE f_scope.tenant_id = p.tenant_id AND f_scope.id = p.fitting_id AND f_scope.branch_id = $2::uuid
      ))
    )`,
  ];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (input.query.source === 'reservation') where.push('p.reservation_id IS NOT NULL');
  if (input.query.source === 'fitting') where.push('p.fitting_id IS NOT NULL');
  if (input.query.status) where.push(`p.status = ${bind(input.query.status)}`);
  const limit = bind(input.query.limit);

  const result = await client.query<CentralPaymentRow>(
    `SELECT
       p.id AS payment_id,
       p.reservation_id,
       p.fitting_id,
       CASE WHEN p.fitting_id IS NOT NULL THEN 'fitting' ELSE 'reservation' END AS source,
       COALESCE(fc.full_name, rc.full_name, r.customer_snapshot->>'full_name', 'Customer') AS customer_name,
       pm.name AS payment_method_name,
       pm.rail,
       p.amount_minor,
       p.currency,
       p.status,
       CASE
         WHEN receipt.evidence_status IS NOT NULL THEN receipt.evidence_status
         WHEN pm.rail = 'cash' THEN 'not_required'
         ELSE 'awaiting_upload'
       END AS evidence_status,
       refund_summary.latest_refund_status,
       COALESCE(refund_summary.active_refund_minor, 0) AS active_refund_minor,
       COALESCE(refund_summary.completed_refund_minor, 0) AS completed_refund_minor,
       p.verified_at,
       p.created_at
     FROM payment p
     JOIN payment_method pm ON pm.tenant_id = p.tenant_id AND pm.id = p.payment_method_id
     LEFT JOIN reservation r ON r.tenant_id = p.tenant_id AND r.id = p.reservation_id
     LEFT JOIN customer rc ON rc.tenant_id = r.tenant_id AND rc.id = r.customer_id
     LEFT JOIN fitting_appointment fa ON fa.tenant_id = p.tenant_id AND fa.id = p.fitting_id
     LEFT JOIN customer fc ON fc.tenant_id = fa.tenant_id AND fc.id = fa.customer_id
     LEFT JOIN LATERAL (
       SELECT pr.evidence_status
         FROM payment_receipt pr
        WHERE pr.tenant_id = p.tenant_id AND pr.payment_id = p.id
        ORDER BY pr.submitted_at DESC, pr.id DESC
        LIMIT 1
     ) receipt ON true
     LEFT JOIN LATERAL (
       SELECT
         (array_agg(ref.status ORDER BY ref.created_at DESC, ref.id DESC))[1] AS latest_refund_status,
         COALESCE(sum(ref.amount_minor) FILTER (WHERE ref.status IN ('requested','processing','completed')), 0) AS active_refund_minor,
         COALESCE(sum(ref.amount_minor) FILTER (WHERE ref.status = 'completed'), 0) AS completed_refund_minor
       FROM refund ref
       WHERE ref.tenant_id = p.tenant_id AND ref.payment_id = p.id
     ) refund_summary ON true
     WHERE ${where.join('\n       AND ')}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ${limit}`,
    values,
  );
  return result.rows;
}

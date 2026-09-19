import { z } from 'zod';

import { auditEventId, outboxEventId, supportGrantId, tenantId } from '../common/ids';
import { isoInstant } from '../common/time';

const safeText = (max: number) => z.string().trim().min(1).max(max);
const permissionCode = z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9._:-]*$/);

export const operatorActivityQuery = z.object({
  tenant_id: tenantId.optional(),
  support_grant_id: supportGrantId.optional(),
  actor_kind: z.enum(['staff', 'operator', 'system']).optional(),
  action: safeText(120).optional(),
  entity_type: safeText(120).optional(),
  outcome: z.enum(['succeeded', 'rejected', 'failed']).optional(),
  occurred_from: isoInstant.optional(),
  occurred_to: isoInstant.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor_occurred_at: isoInstant.optional(),
  cursor_event_id: auditEventId.optional(),
}).strict();
export type OperatorActivityQuery = z.infer<typeof operatorActivityQuery>;

export const operatorActivity = z.object({
  event_id: auditEventId,
  tenant_id: tenantId,
  actor_kind: z.enum(['staff', 'operator', 'system']),
  actor_key: safeText(200),
  action: safeText(120),
  entity_type: safeText(120),
  entity_id: z.string().uuid().nullable(),
  support_grant_id: supportGrantId.nullable(),
  outcome: z.enum(['succeeded', 'rejected', 'failed']),
  redacted_summary: z.string().nullable(),
  request_id: safeText(255),
  occurred_at: isoInstant,
}).strict();
export type OperatorActivity = z.infer<typeof operatorActivity>;

export const operatorActivityResponse = z.object({
  items: z.array(operatorActivity),
  next_cursor: z.object({ occurredAt: isoInstant, eventId: auditEventId }).nullable(),
}).strict();
export type OperatorActivityResponse = z.infer<typeof operatorActivityResponse>;

export const createSupportGrantRequest = z.object({
  tenant_id: tenantId,
  permission_codes: z.array(permissionCode).min(1).max(20),
  reason: safeText(500),
  starts_at: isoInstant,
  expires_at: isoInstant,
}).strict().refine((value) => value.starts_at < value.expires_at, {
  message: 'starts_at must be before expires_at', path: ['expires_at'],
});
export type CreateSupportGrantRequest = z.infer<typeof createSupportGrantRequest>;

export const supportGrantParams = z.object({ grant_id: supportGrantId }).strict();
export const retryCommandParams = z.object({ resource_id: outboxEventId }).strict();

export const supportGrant = z.object({
  grant_id: supportGrantId,
  tenant_id: tenantId,
  operator_subject: safeText(200),
  permission_codes: z.array(permissionCode),
  starts_at: isoInstant,
  expires_at: isoInstant,
  revoked_at: isoInstant.nullable(),
  created_at: isoInstant,
}).strict();
export type SupportGrant = z.infer<typeof supportGrant>;

export const revokeSupportGrantRequest = z.object({ reason: safeText(500) }).strict();
export type RevokeSupportGrantRequest = z.infer<typeof revokeSupportGrantRequest>;

export const retryCommandRequest = z.object({
  reason: safeText(500),
  operator_subject: safeText(200),
}).strict();
export type RetryCommandRequest = z.infer<typeof retryCommandRequest>;

export const supportGrantResponse = z.object({ grant_id: supportGrantId, tenant_id: tenantId, expires_at: isoInstant }).strict();
export const retryCommandResponse = z.object({ commandId: outboxEventId, status: z.literal('queued') }).strict();

export const operatorCommandResponse = z.object({
  command_id: outboxEventId,
  status: z.enum(['accepted', 'already_pending', 'already_terminal']),
  recorded_at: isoInstant,
}).strict();
export type OperatorCommandResponse = z.infer<typeof operatorCommandResponse>;

import type { PoolClient } from 'pg';

import { ValidationError } from '../../shared/errors.js';
import { serializeBoundedJson } from '../../shared/safe-json.js';

export type GlobalAuditActorKind = 'account' | 'operator' | 'system';
export type GlobalAuditOutcome = 'succeeded' | 'rejected' | 'failed';

export interface AppendGlobalAuditEventInput {
  accountId: string | null;
  actorKind: GlobalAuditActorKind;
  actorKey: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome: GlobalAuditOutcome;
  redactedSummary: unknown;
  requestId: string;
}

export interface GlobalAuditEventRecord {
  id: string;
  accountId: string | null;
  actorKind: GlobalAuditActorKind;
  actorKey: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: GlobalAuditOutcome;
  redactedSummary: unknown;
  requestId: string;
  createdAt: Date;
}

export interface ReadGlobalAuditEventsFilter {
  accountId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}

interface GlobalAuditEventRow {
  id: string;
  account_id: string | null;
  actor_kind: GlobalAuditActorKind;
  actor_key: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  outcome: GlobalAuditOutcome;
  redacted_summary: unknown;
  request_id: string;
  created_at: Date;
}

/** Appends one immutable, caller-redacted global event using the caller's existing transaction. */
export async function appendGlobalAuditEvent(
  client: PoolClient,
  input: AppendGlobalAuditEventInput,
): Promise<GlobalAuditEventRecord> {
  validateAppendInput(input);
  const serialized = serializeBoundedJson(input.redactedSummary, 'Audit redacted summary');
  const result = await client.query<GlobalAuditEventRow>(
    `INSERT INTO global_audit_event
       (account_id, actor_kind, actor_key, action, entity_type, entity_id,
        outcome, redacted_summary, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, account_id, actor_kind, actor_key, action, entity_type, entity_id,
               outcome, redacted_summary, request_id, created_at`,
    [
      input.accountId,
      input.actorKind,
      input.actorKey,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.outcome,
      serialized,
      input.requestId,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Global audit insert returned no row');
  }
  return toRecord(row);
}

/**
 * Reads only an explicitly account/entity-filtered slice. RLS further narrows owner reads to
 * their account and permits operator/system contexts only after the caller selected them.
 */
export async function readGlobalAuditEvents(
  client: PoolClient,
  filter: ReadGlobalAuditEventsFilter,
): Promise<GlobalAuditEventRecord[]> {
  if (!filter.accountId && !filter.entityType) {
    throw new ValidationError('Global audit reads require an account or entity filter.');
  }
  const limit = filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ValidationError('Global audit read limit must be between 1 and 500.');
  }

  const values: unknown[] = [];
  const predicates: string[] = [];
  if (filter.accountId) {
    values.push(filter.accountId);
    predicates.push(`account_id = $${values.length}`);
  }
  if (filter.entityType) {
    values.push(filter.entityType);
    predicates.push(`entity_type = $${values.length}`);
  }
  if (filter.entityId) {
    values.push(filter.entityId);
    predicates.push(`entity_id = $${values.length}`);
  }
  values.push(limit);
  const result = await client.query<GlobalAuditEventRow>(
    `SELECT id, account_id, actor_kind, actor_key, action, entity_type, entity_id,
            outcome, redacted_summary, request_id, created_at
     FROM global_audit_event
     WHERE ${predicates.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toRecord);
}

function validateAppendInput(input: AppendGlobalAuditEventInput): void {
  if (input.actorKind === 'account' && !input.accountId) {
    throw new ValidationError('Account audit events require an account ID.');
  }
  if (typeof input.actorKey !== 'string' || input.actorKey.length < 1 || input.actorKey.length > 200) {
    throw new ValidationError('Audit actor key must be 1-200 characters.');
  }
  if (
    typeof input.action !== 'string' ||
    input.action.length < 1 ||
    input.action.length > 100 ||
    typeof input.entityType !== 'string' ||
    input.entityType.length < 1 ||
    input.entityType.length > 100
  ) {
    throw new ValidationError('Audit action and entity type must be 1-100 characters.');
  }
  if (typeof input.requestId !== 'string' || input.requestId.length < 1 || input.requestId.length > 200) {
    throw new ValidationError('Audit request ID must be 1-200 characters.');
  }
}

function toRecord(row: GlobalAuditEventRow): GlobalAuditEventRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    actorKind: row.actor_kind,
    actorKey: row.actor_key,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    outcome: row.outcome,
    redactedSummary: row.redacted_summary,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

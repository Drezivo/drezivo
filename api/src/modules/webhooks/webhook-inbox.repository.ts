import type { ClerkWebhookEventType } from '@drezivo/contracts';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { ValidationError } from '../../shared/errors.js';
import { withSystemGlobalTransaction } from '../../db/client.js';

export type WebhookInboxStatus = 'received' | 'processed' | 'rejected';

export interface InsertWebhookInboxInput {
  providerEventId: string;
  eventType: ClerkWebhookEventType;
  payloadDigest: string;
  safePayload: Record<string, unknown>;
}

export interface WebhookInboxRow {
  id: string;
  provider: 'clerk';
  provider_event_id: string;
  event_type: ClerkWebhookEventType | null;
  payload_digest: string;
  safe_payload: Record<string, unknown>;
  status: WebhookInboxStatus;
  processed_at: Date | null;
  created_at: Date;
}

export type InsertWebhookInboxResult = 'inserted' | 'duplicate';

/** API-side persistence boundary; the route never reads the inbox after inserting. */
export async function persistClerkWebhookInbox(
  input: InsertWebhookInboxInput,
): Promise<InsertWebhookInboxResult> {
  return withSystemGlobalTransaction('clerk:webhook', (client) =>
    insertClerkWebhookInbox(client, input),
  );
}

const insertInput = z.object({
  providerEventId: z.string().trim().min(1).max(255),
  eventType: z.enum([
    'organization.created',
    'organization.updated',
    'organization.deleted',
    'organization_invitation.created',
    'organization_invitation.accepted',
    'organization_invitation.revoked',
    'organization_membership.created',
    'organization_membership.updated',
    'organization_membership.deleted',
  ]),
  payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
  safePayload: z.record(z.unknown()),
});

/**
 * Inserts a verified event using only the API role's INSERT privilege. The row count, rather
 * than a follow-up SELECT, distinguishes a new event from a provider retry, so the HTTP path
 * cannot read the global inbox.
 */
export async function insertClerkWebhookInbox(
  client: PoolClient,
  input: InsertWebhookInboxInput,
): Promise<InsertWebhookInboxResult> {
  const parsed = insertInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Webhook inbox record is invalid.');
  }

  const result = await client.query<{ inserted: boolean }>(
    `SELECT ingest_clerk_webhook_inbox($1, $2, $3, $4) AS inserted`,
    [parsed.data.providerEventId, parsed.data.eventType, parsed.data.payloadDigest, parsed.data.safePayload],
  );
  return result.rows[0]?.inserted ? 'inserted' : 'duplicate';
}

/** Worker-side read path; callers run this inside a transaction and process rows before commit. */
export async function claimReceivedClerkWebhookRows(
  client: PoolClient,
  limit = 50,
): Promise<WebhookInboxRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('Webhook inbox claim limit must be between 1 and 100.');
  }
  const result = await client.query<WebhookInboxRow>(
    `SELECT id, provider, provider_event_id, event_type, payload_digest, safe_payload,
            status, processed_at, created_at
     FROM webhook_inbox
     WHERE provider = 'clerk' AND status = 'received'
     ORDER BY created_at ASC, id ASC
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function markClerkWebhookProcessed(
  client: PoolClient,
  inboxId: string,
  status: Extract<WebhookInboxStatus, 'processed' | 'rejected'>,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(inboxId)) {
    throw new ValidationError('Webhook inbox ID is invalid.');
  }
  const result = await client.query(
    `UPDATE webhook_inbox
     SET status = $2, processed_at = now()
     WHERE id = $1 AND provider = 'clerk' AND status = 'received'`,
    [inboxId, status],
  );
  return result.rowCount === 1;
}

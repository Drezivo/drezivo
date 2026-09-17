import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  claimReceivedClerkWebhookRows,
  insertClerkWebhookInbox,
  markClerkWebhookProcessed,
} from '../webhook-inbox.repository.js';

const validInput = {
  providerEventId: 'evt_123',
  eventType: 'organization.created' as const,
  payloadDigest: 'a'.repeat(64),
  safePayload: { organization_id: 'org_123' },
};

function clientWith(...responses: unknown[]) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return { client: { query } as unknown as PoolClient, query };
}

describe('webhook inbox repository', () => {
  it('uses insert-only conflict handling so the API never reads inbox rows', async () => {
    const { client, query } = clientWith({ rows: [{ inserted: true }] });
    await expect(insertClerkWebhookInbox(client, validInput)).resolves.toBe('inserted');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('ingest_clerk_webhook_inbox');

    const duplicate = clientWith({ rows: [{ inserted: false }] });
    await expect(insertClerkWebhookInbox(duplicate.client, validInput)).resolves.toBe('duplicate');
    expect(duplicate.query).toHaveBeenCalledTimes(1);
  });

  it('claims received rows with a bounded worker batch and transitions them once', async () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'clerk',
      provider_event_id: 'evt_123',
      event_type: 'organization.created',
      payload_digest: 'a'.repeat(64),
      safe_payload: { organization_id: 'org_123' },
      status: 'received',
      processed_at: null,
      created_at: new Date(),
    };
    const { client, query } = clientWith({ rows: [row] }, { rowCount: 1 });
    await expect(claimReceivedClerkWebhookRows(client, 10)).resolves.toEqual([row]);
    await expect(
      markClerkWebhookProcessed(client, row.id, 'processed'),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[1]?.[0]).toContain("status = 'received'");
  });
});

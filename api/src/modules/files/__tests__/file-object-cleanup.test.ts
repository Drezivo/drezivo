import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DeferredOutboxError, PermanentOutboxError, type OutboxRow } from '../../../worker/runner.js';
import { createFileObjectCleanupHandler } from '../file-object-cleanup.js';

const tenantId = '00000000-0000-4000-8000-000000000002';
const fileId = '00000000-0000-4000-8000-000000000001';
const storageKey = 'private/tenant/file/object';

function row(payload: Record<string, unknown> = { file_id: fileId }): OutboxRow {
  return {
    id: 'outbox-id',
    tenant_id: tenantId,
    dedupe_key: `file-object-cleanup:${fileId}`,
    event_type: 'file.object_cleanup.requested',
    payload,
    attempts: 0,
    max_attempts: 8,
  };
}

function cleanupClient(): { client: PoolClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: [{ storage_key: storageKey, lifecycle_status: 'accepted', legal_hold: false, retention_seconds: 0 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ has_references: false }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ storage_key: storageKey }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  return { client: { query } as unknown as PoolClient, query };
}

describe('file object cleanup handler', () => {
  it('deletes the object between the committed barrier and tombstone transactions', async () => {
    const { client, query } = cleanupClient();
    let transactionCalls = 0;
    const transaction = async <T>(_tenantId: string, _systemKey: string, callback: (client: PoolClient) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      return callback(client);
    };
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const handle = createFileObjectCleanupHandler({ deleteObject }, transaction);

    await handle(row());

    expect(deleteObject).toHaveBeenCalledWith(storageKey);
    expect(transactionCalls).toBe(2);
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(query.mock.calls[2]?.[0]).toContain("lifecycle_status = 'deletion_pending'");
    expect(query.mock.calls[3]?.[0]).toContain("lifecycle_status = 'deleted'");
  });

  it('keeps a candidate pending when deletion is unsupported or storage fails', async () => {
    const noDelete = createFileObjectCleanupHandler({}, vi.fn());
    await expect(noDelete(row())).rejects.toBeInstanceOf(DeferredOutboxError);

    const { client, query } = cleanupClient();
    let transactionCalls = 0;
    const transaction = async <T>(_tenantId: string, _systemKey: string, callback: (client: PoolClient) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      return callback(client);
    };
    const deleteObject = vi.fn().mockRejectedValue(new Error(`provider error for ${storageKey}`));
    const handle = createFileObjectCleanupHandler({ deleteObject }, transaction);
    await expect(handle(row())).rejects.toThrow('Object storage deletion failed.');
    expect(transactionCalls).toBe(1);
    expect(query.mock.calls.some(([statement]) => String(statement).includes("lifecycle_status = 'deleted'"))).toBe(false);
  });

  it('rejects malformed event payloads before database or storage access', async () => {
    const transaction = vi.fn();
    const deleteObject = vi.fn();
    const handle = createFileObjectCleanupHandler({ deleteObject }, transaction);

    await expect(handle(row({ file_id: '../storage-key' }))).rejects.toBeInstanceOf(PermanentOutboxError);
    expect(transaction).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

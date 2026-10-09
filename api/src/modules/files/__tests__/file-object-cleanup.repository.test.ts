import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: { FILE_OBJECT_CLEANUP_ENABLED: true } }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  Object.defineProperty(actual.config, 'FILE_OBJECT_CLEANUP_ENABLED', {
    configurable: true,
    get: () => mocks.config.FILE_OBJECT_CLEANUP_ENABLED,
  });
  return actual;
});
vi.mock('../../../shared/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));

import { DeferredOutboxError } from '../../../worker/runner.js';
import { DependencyUnavailableError } from '../../../shared/errors.js';
import {
  enqueueReplacedFileObjectCleanup,
  enqueueReplacedFileObjectSetCleanup,
  prepareFileObjectCleanup,
} from '../file-object-cleanup.repository.js';

const fileId = '00000000-0000-4000-8000-000000000001';
const tenantId = '00000000-0000-4000-8000-000000000002';
const storageKey = 'private/tenant/file/object';

function clientFor(...results: Array<{ rows: unknown[]; rowCount?: number | null }>): {
  client: PoolClient;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce({ rowCount: 0, ...result });
  return { client: { query } as unknown as PoolClient, query };
}

describe('file object cleanup repository', () => {
  afterEach(() => {
    mocks.config.FILE_OBJECT_CLEANUP_ENABLED = true;
  });

  it('refuses a displaced-file replacement while the producer rollout gate is off', async () => {
    mocks.config.FILE_OBJECT_CLEANUP_ENABLED = false;
    const { client, query } = clientFor();

    await expect(
      enqueueReplacedFileObjectCleanup(
        client,
        tenantId,
        fileId,
        '00000000-0000-4000-8000-000000000003',
      ),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(query).not.toHaveBeenCalled();
  });

  it('queues a displaced file but not unchanged or clear-only fields', async () => {
    const { client, query } = clientFor({ rows: [], rowCount: 1 });

    await enqueueReplacedFileObjectCleanup(client, tenantId, fileId, null);
    await enqueueReplacedFileObjectCleanup(client, tenantId, fileId, fileId);
    await enqueueReplacedFileObjectCleanup(client, tenantId, fileId, '00000000-0000-4000-8000-000000000003');

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("'file.object_cleanup.requested'");
    expect(query.mock.calls[0]?.[1]).toEqual([
      tenantId,
      `file-object-cleanup:${fileId}`,
      JSON.stringify({ file_id: fileId }),
    ]);
  });

  it('queues set members only when the replacement introduces at least one new file', async () => {
    const { client, query } = clientFor({ rows: [], rowCount: 1 }, { rows: [], rowCount: 1 });
    const retained = '00000000-0000-4000-8000-000000000003';
    const displaced = '00000000-0000-4000-8000-000000000004';
    const replacement = '00000000-0000-4000-8000-000000000005';

    await enqueueReplacedFileObjectSetCleanup(client, tenantId, [retained, displaced], [retained]);
    await enqueueReplacedFileObjectSetCleanup(client, tenantId, [retained, displaced], [retained, replacement]);

    expect(query).toHaveBeenCalledOnce();
    const queryCalls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(queryCalls[0]?.[1]?.[1]).toBe(`file-object-cleanup:${displaced}`);
  });

  it('defers a still-referenced file without entering deletion_pending', async () => {
    const { client, query } = clientFor(
      { rows: [{ storage_key: storageKey, lifecycle_status: 'accepted', legal_hold: false, retention_seconds: 0 }] },
      { rows: [{ has_references: true }] },
    );

    await expect(prepareFileObjectCleanup(client, tenantId, fileId)).rejects.toMatchObject({
      name: 'DeferredOutboxError',
      retryAfterSeconds: 86_400,
    } satisfies Partial<DeferredOutboxError>);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('transitions to deletion_pending only after the reference and protection checks pass', async () => {
    const { client, query } = clientFor(
      { rows: [{ storage_key: storageKey, lifecycle_status: 'accepted', legal_hold: false, retention_seconds: 0 }] },
      { rows: [{ has_references: false }] },
      { rows: [{ storage_key: storageKey }], rowCount: 1 },
    );

    await expect(prepareFileObjectCleanup(client, tenantId, fileId)).resolves.toEqual({
      kind: 'delete',
      storageKey,
    });
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(query.mock.calls[2]?.[0]).toContain("lifecycle_status = 'deletion_pending'");
  });

  it('defers legal holds and future retention instead of transitioning the file', async () => {
    const { client: heldClient, query: heldQuery } = clientFor(
      { rows: [{ storage_key: storageKey, lifecycle_status: 'accepted', legal_hold: true, retention_seconds: 0 }] },
      { rows: [{ has_references: false }] },
    );
    const { client: retainedClient, query: retainedQuery } = clientFor(
      { rows: [{ storage_key: storageKey, lifecycle_status: 'accepted', legal_hold: false, retention_seconds: 3600 }] },
      { rows: [{ has_references: false }] },
    );

    await expect(prepareFileObjectCleanup(heldClient, tenantId, fileId)).rejects.toBeInstanceOf(DeferredOutboxError);
    await expect(prepareFileObjectCleanup(retainedClient, tenantId, fileId)).rejects.toMatchObject({ retryAfterSeconds: 3600 });
    expect(heldQuery).toHaveBeenCalledTimes(2);
    expect(retainedQuery).toHaveBeenCalledTimes(2);
  });
});

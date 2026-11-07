import { pool, withOperatorGlobalTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import { DependencyUnavailableError } from '../../shared/errors.js';

/** Claim one due object under a row lock; writers must hold the same lock before referencing it. */
export async function sweepPlatformQrObject(
  storage: Pick<ObjectStorage, 'deleteObject'> = objectStorage,
  database: Pick<typeof pool, 'connect'> = pool,
): Promise<void> {
  if (!storage.deleteObject) throw new DependencyUnavailableError('Platform QR cleanup is unavailable.');
  const client = await database.connect();
  let claimedKey: string | undefined;
  try {
    await client.query('BEGIN');
    const queued = await client.query<{ storage_key: string }>(
      `SELECT storage_key FROM platform_payment_qr_object
        WHERE state IN ('uploading', 'delete_pending') AND available_at <= now()
        ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const key = queued.rows[0]?.storage_key;
    claimedKey = key;
    if (key) {
      const referenced = await client.query<{ found: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM platform_payment_method WHERE qr_object_key = $1) AS found',
        [key],
      );
      if (referenced.rows[0]?.found) {
        await client.query("UPDATE platform_payment_qr_object SET state = 'referenced' WHERE storage_key = $1", [key]);
      } else {
        await storage.deleteObject(key, AbortSignal.timeout(20_000));
        await client.query('DELETE FROM platform_payment_qr_object WHERE storage_key = $1', [key]);
      }
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    if (claimedKey) {
      await client.query(
        `UPDATE platform_payment_qr_object SET attempts = attempts + 1,
          state = CASE WHEN attempts + 1 >= 10 THEN 'failed' ELSE state END,
          available_at = now() + make_interval(secs => LEAST(3600, (60 * power(2, LEAST(attempts, 6)))::int))
          WHERE storage_key = $1 AND state IN ('uploading', 'delete_pending')`,
        [claimedKey],
      ).catch(() => undefined);
    }
    throw new DependencyUnavailableError('Platform QR cleanup failed and will be retried.');
  } finally {
    client.release();
  }
}

/** Explicit operator recovery after the storage dependency has been repaired. */
export async function retryFailedPlatformQrCleanup(): Promise<number> {
  return withOperatorGlobalTransaction('platform-qr-cleanup-retry', async (client) => {
    const result = await client.query("UPDATE platform_payment_qr_object SET state = 'delete_pending', attempts = 0, available_at = now() WHERE state = 'failed'");
    return result.rowCount ?? 0;
  });
}

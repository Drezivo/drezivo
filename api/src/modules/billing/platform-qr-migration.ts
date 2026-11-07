import { createHash, randomUUID } from 'node:crypto';
import { withOperatorGlobalTransaction } from '../../db/client.js';
import { config } from '../../config/index.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import { DependencyUnavailableError } from '../../shared/errors.js';
import { platformQrMime, readPlatformQrBytes } from './platform-qr-read.js';

type LegacyQr = { id: string; version: number; qr_image: Buffer; qr_mime: string; qr_object_key: string | null; qr_size_bytes: number | null; qr_sha256: string | null };
const principal = 'platform-qr-migration';
const sha = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

/** Restartable bounded batches; database bytes remain authoritative until finalize. */
export async function migratePlatformQrs(mode: 'copy' | 'finalize'): Promise<{ scanned: number; changed: number }> {
  if (mode === 'copy' && !config.OBJECT_STORAGE_UPLOADS_ENABLED) throw new DependencyUnavailableError('QR uploads are temporarily unavailable.');
  let cursor: string | null = null; let scanned = 0; let changed = 0;
  for (;;) {
    const rows = await withOperatorGlobalTransaction(principal, async (client) => (await client.query<LegacyQr>(
      `SELECT id, version, qr_image, qr_mime, qr_object_key, qr_size_bytes, qr_sha256
         FROM platform_payment_method WHERE qr_image IS NOT NULL AND ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT 25`, [cursor],
    )).rows);
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id; scanned++;
      const hash = sha(row.qr_image);
      if (platformQrMime(row.qr_image) !== row.qr_mime) throw new DependencyUnavailableError('A legacy QR image has invalid metadata.');
      if (mode === 'finalize') {
        if (!row.qr_object_key || row.qr_size_bytes !== row.qr_image.length || row.qr_sha256 !== hash) throw new DependencyUnavailableError('A legacy QR image has not been copied and verified.');
        await readPlatformQrBytes({ ...row, qr_image: null }, objectStorage, AbortSignal.timeout(20_000));
        const finalized = await withOperatorGlobalTransaction(principal, async (client) => client.query(
          `UPDATE platform_payment_method SET qr_image = NULL
            WHERE id=$1 AND version=$2 AND qr_image=$3 AND qr_mime=$4 AND qr_object_key=$5 AND qr_sha256=$6`,
          [row.id, row.version, row.qr_image, row.qr_mime, row.qr_object_key, hash],
        ));
        if (!finalized.rowCount) throw new DependencyUnavailableError('A QR changed during finalization; rerun the migration.');
        changed++;
        continue;
      }
      if (row.qr_object_key && row.qr_size_bytes === row.qr_image.length && row.qr_sha256 === hash) {
        try {
          await readPlatformQrBytes({ ...row, qr_image: null }, objectStorage, AbortSignal.timeout(20_000));
          continue;
        } catch {
          // The database copy remains authoritative; retry the upload if the stored copy is missing or damaged.
        }
      }
      const putObject = objectStorage.putObject?.bind(objectStorage);
      if (!putObject) throw new DependencyUnavailableError('QR uploads are unavailable.');
      const key = `platform-files/payment-methods/${row.id}/${randomUUID()}`;
      await withOperatorGlobalTransaction(principal, async (client) => {
        await client.query("INSERT INTO platform_payment_qr_object (storage_key, state) VALUES ($1, 'uploading')", [key]);
      });
      const copied = await withOperatorGlobalTransaction(principal, async (client) => {
        const queue = await client.query("SELECT storage_key FROM platform_payment_qr_object WHERE storage_key=$1 AND state='uploading' FOR UPDATE", [key]);
        if (!queue.rowCount) throw new DependencyUnavailableError('The QR migration upload expired.');
        const current = await client.query<LegacyQr>('SELECT id, version, qr_image, qr_mime, qr_object_key, qr_size_bytes, qr_sha256 FROM platform_payment_method WHERE id=$1 FOR UPDATE', [row.id]);
        const value = current.rows[0];
        if (!value?.qr_image || value.version !== row.version || !value.qr_image.equals(row.qr_image) || value.qr_mime !== row.qr_mime) {
          await client.query("UPDATE platform_payment_qr_object SET state='delete_pending', available_at=now() WHERE storage_key=$1", [key]);
          return false;
        }
        const signal = AbortSignal.timeout(20_000);
        await putObject({ storageKey: key, body: row.qr_image, contentType: row.qr_mime, signal });
        await readPlatformQrBytes({ ...row, qr_image: null, qr_object_key: key, qr_size_bytes: row.qr_image.length, qr_sha256: hash }, objectStorage, signal);
        await client.query('UPDATE platform_payment_method SET qr_object_key=$2, qr_size_bytes=$3, qr_sha256=$4 WHERE id=$1', [row.id, key, row.qr_image.length, hash]);
        await client.query("UPDATE platform_payment_qr_object SET state='referenced' WHERE storage_key=$1", [key]);
        if (value.qr_object_key) await client.query(`INSERT INTO platform_payment_qr_object (storage_key,state,available_at) VALUES ($1,'delete_pending',now())
          ON CONFLICT (storage_key) DO UPDATE SET state='delete_pending', available_at=now()`, [value.qr_object_key]);
        return true;
      });
      if (copied) changed++;
    }
  }
  return { scanned, changed };
}

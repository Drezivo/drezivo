import { createHash, randomUUID } from 'node:crypto';
import { withOperatorGlobalTransaction } from '../../db/client.js';
import { config } from '../../config/index.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import { readPlatformQrBytes, platformQrMime, type PlatformQrRecord } from '../billing/platform-qr-read.js';
import { DependencyUnavailableError, IdempotencyKeyReusedError, NotFoundError, PaymentMethodLimitError, StateConflictError, ValidationError } from '../../shared/errors.js';
import type { CreatePlatformMethod, UpdatePlatformMethod } from './platform-payment-methods.schema.js';

type Context = { subject: string; requestId: string; idempotencyKey: string };
type Input = CreatePlatformMethod | UpdatePlatformMethod;
type Method = { id: string; label: string; account_name: string | null; account_number: string | null; instructions: string | null; has_qr: boolean; active: boolean; sort_order: number; version: number; updated_at: Date };
type CommandResult = { method: Omit<Method, 'updated_at'> & { updated_at: string }; changed: boolean; replayed: boolean };
const columns = `id, label, account_name, account_number, instructions,
  (qr_image IS NOT NULL OR qr_object_key IS NOT NULL) AS has_qr, active, sort_order, version, updated_at`;
const digest = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

function imageOf(input: Input): { bytes: Buffer; mime: string; hash: string } | null | undefined {
  if (input.qr === undefined || input.qr === null) return input.qr;
  const bytes = Buffer.from(input.qr.data_base64, 'base64');
  if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') !== input.qr.data_base64) throw new ValidationError('The QR image is invalid.');
  let mime: string;
  try { mime = platformQrMime(bytes); } catch { throw new ValidationError('The QR image must be a PNG, JPEG, or WebP file.'); }
  return { bytes, mime, hash: digest(bytes) };
}

/** The queue is committed before R2 is contacted, so a process crash cannot lose cleanup work. */
export async function writePlatformMethod(id: string | null, input: Input, ctx: Context): Promise<CommandResult> {
  const qr = imageOf(input);
  const methodId = id ?? randomUUID();
  const objectKey = qr ? `platform-files/payment-methods/${methodId}/${randomUUID()}` : null;
  const action = id ? 'updated' : 'created';
  const { label, account_name, account_number, instructions, sort_order, reason } = input;
  const version = 'version' in input ? input.version : undefined;
  const fingerprint = digest(JSON.stringify({ action, targetId: id, ...(id ? { version } : {}), label, account_name, account_number, instructions, sort_order, qr: qr === undefined ? 'keep' : qr === null ? 'none' : qr.hash }));
  if (objectKey) {
    await withOperatorGlobalTransaction(ctx.subject, async (client) => {
      await client.query("INSERT INTO platform_payment_qr_object (storage_key, state) VALUES ($1, 'uploading')", [objectKey]);
    });
  }
  return withOperatorGlobalTransaction(ctx.subject, async (client) => {
    await client.query("SELECT set_config('statement_timeout', '25s', true), set_config('lock_timeout', '3s', true)");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['platform_payment_method_write']);
    if (objectKey) {
      const pending = await client.query("SELECT storage_key FROM platform_payment_qr_object WHERE storage_key = $1 AND state = 'uploading' FOR UPDATE", [objectKey]);
      if (!pending.rowCount) throw new DependencyUnavailableError('The QR upload expired; retry the request.');
    }
    const previous = await client.query<{ platform_payment_method_id: string; hash: string | null }>(
      `SELECT platform_payment_method_id, redacted_summary ->> 'payload_hash' AS hash
         FROM platform_payment_method_change WHERE operator_subject = $1 AND intent_key = $2`,
      [ctx.subject, ctx.idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].hash !== fingerprint) throw new IdempotencyKeyReusedError('This idempotency key was already used for a different change.');
      if (objectKey) await client.query("UPDATE platform_payment_qr_object SET state = 'delete_pending', available_at = now() WHERE storage_key = $1", [objectKey]);
      const current = await client.query<Method>(`SELECT ${columns} FROM platform_payment_method WHERE id = $1`, [previous.rows[0].platform_payment_method_id]);
      if (!current.rows[0]) throw new NotFoundError('The payment method was not found.');
      return { method: { ...current.rows[0], updated_at: current.rows[0].updated_at.toISOString() }, changed: false, replayed: true };
    }
    let oldKey: string | null = null;
    if (id) {
      const current = await client.query<{ version: number; qr_object_key: string | null }>('SELECT version, qr_object_key FROM platform_payment_method WHERE id = $1 FOR UPDATE', [id]);
      if (!current.rows[0]) throw new NotFoundError('The payment method was not found.');
      if (current.rows[0].version !== version) throw new StateConflictError('This payment method changed since you opened it. Refresh and try again.');
      oldKey = current.rows[0].qr_object_key;
    } else {
      const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM platform_payment_method WHERE active');
      if ((count.rows[0]?.count ?? 0) >= 10) throw new PaymentMethodLimitError('At most 10 payment methods can be active. Turn one off first.');
    }
    if (qr && objectKey) {
      if (!config.OBJECT_STORAGE_UPLOADS_ENABLED) throw new DependencyUnavailableError('QR uploads are temporarily unavailable.');
      if (!objectStorage.putObject) throw new DependencyUnavailableError('QR uploads are unavailable.');
      const signal = AbortSignal.timeout(20_000);
      await objectStorage.putObject({ storageKey: objectKey, body: qr.bytes, contentType: qr.mime, signal });
      await readPlatformQrBytes({ qr_image: null, qr_mime: qr.mime, qr_object_key: objectKey, qr_size_bytes: qr.bytes.length, qr_sha256: qr.hash }, objectStorage, signal);
    }
    if (id) {
      const keep = qr === undefined;
      await client.query(`UPDATE platform_payment_method SET label=$2, account_name=$3, account_number=$4, instructions=$5, sort_order=$6,
        qr_image=CASE WHEN $7 THEN qr_image ELSE NULL END, qr_mime=CASE WHEN $7 THEN qr_mime ELSE $8 END,
        qr_object_key=CASE WHEN $7 THEN qr_object_key ELSE $9 END, qr_size_bytes=CASE WHEN $7 THEN qr_size_bytes ELSE $10 END,
        qr_sha256=CASE WHEN $7 THEN qr_sha256 ELSE $11 END, version=version+1, updated_at=now() WHERE id=$1`,
      [id, label, account_name, account_number, instructions, sort_order, keep, qr?.mime ?? null, objectKey, qr?.bytes.length ?? null, qr?.hash ?? null]);
    } else {
      await client.query(`INSERT INTO platform_payment_method (id,label,account_name,account_number,instructions,sort_order,qr_mime,qr_object_key,qr_size_bytes,qr_sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [methodId, label, account_name, account_number, instructions, sort_order, qr?.mime ?? null, objectKey, qr?.bytes.length ?? null, qr?.hash ?? null]);
    }
    if (objectKey) await client.query("UPDATE platform_payment_qr_object SET state='referenced' WHERE storage_key=$1", [objectKey]);
    if (oldKey && qr !== undefined) {
      await client.query(`INSERT INTO platform_payment_qr_object (storage_key,state,available_at) VALUES ($1,'delete_pending',now())
        ON CONFLICT (storage_key) DO UPDATE SET state='delete_pending', available_at=now()`, [oldKey]);
    }
    await client.query(`INSERT INTO platform_payment_method_change (platform_payment_method_id,operator_subject,action,intent_key,reason,redacted_summary,request_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [methodId, ctx.subject, action, ctx.idempotencyKey, reason, JSON.stringify({ payload_hash: fingerprint, changed: true }), ctx.requestId]);
    const result = await client.query<Method>(`SELECT ${columns} FROM platform_payment_method WHERE id = $1`, [methodId]);
    if (!result.rows[0]) throw new DependencyUnavailableError('The payment method could not be saved.');
    return { method: { ...result.rows[0], updated_at: result.rows[0].updated_at.toISOString() }, changed: true, replayed: false };
  });
}

export async function readOperatorPlatformQr(id: string, subject: string): Promise<{ method_id: string; data_base64: string; mime: string }> {
  const qr = await withOperatorGlobalTransaction(subject, async (client) => {
    const result = await client.query<PlatformQrRecord>('SELECT qr_image, qr_mime, qr_object_key, qr_size_bytes, qr_sha256 FROM platform_payment_method WHERE id = $1 AND qr_mime IS NOT NULL', [id]);
    return result.rows[0];
  });
  if (!qr) throw new NotFoundError('This payment method has no QR image.');
  const bytes = await readPlatformQrBytes(qr, objectStorage, AbortSignal.timeout(20_000));
  if (platformQrMime(bytes) !== qr.qr_mime) throw new NotFoundError('This QR code is not available.');
  return { method_id: id, data_base64: bytes.toString('base64'), mime: qr.qr_mime };
}

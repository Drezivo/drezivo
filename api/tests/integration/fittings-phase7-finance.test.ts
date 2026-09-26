import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '12';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

interface Seed {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  customerId: string;
  variantId: string;
  cashMethodId: string;
  manualMethodId: string;
}

function requireId(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedTenant(label: string, feeMinor = 500): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `fit7-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone)
           VALUES ($1,'Main','MAIN',true,'Asia/Manila') RETURNING id`,
          [tenantId],
        )
      ).rows,
      'branch',
    );
    const principalId = `user_${suffix}`;
    const membershipId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO membership (tenant_id,clerk_user_id,role,status)
           VALUES ($1,$2,'owner','active') RETURNING id`,
          [tenantId, principalId],
        )
      ).rows,
      'membership',
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Phase 7 Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Phase 7 Gown','active') RETURNING id`,
          [tenantId, `P-${suffix}`],
        )
      ).rows,
      'product',
    );
    const variantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product_variant
             (tenant_id,product_id,sku,size_label,color_label,measurements,measurement_unit,
              measurement_mode,rental_price_minor,security_deposit_minor,currency,pricing_mode,
              included_duration_minutes,extra_day_price_minor,prep_minutes,turnaround_minutes,status)
           VALUES ($1,$2,$3,'M','Ivory','{}','cm','none',1000,0,'PHP','fixed_duration',1440,0,0,0,'active')
           RETURNING id`,
          [tenantId, productId, `SKU-${suffix}`],
        )
      ).rows,
      'variant',
    );
    const cashMethodId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment_method
             (tenant_id,name,rail,destination_snapshot,active,storefront_enabled,version)
           VALUES ($1,'Cash','cash','{}'::jsonb,true,false,1) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'cash payment method',
    );
    const manualMethodId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment_method
             (tenant_id,name,rail,destination_snapshot,active,storefront_enabled,version)
           VALUES ($1,'GCash','manual_qr','{}'::jsonb,true,false,1) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'manual payment method',
    );

    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,3,60,$3,'PHP',1)`,
      [tenantId, branchId, feeMinor],
    );
    await client.query(
      `INSERT INTO fitting_hours (tenant_id,branch_id,weekday,starts_local,ends_local)
       SELECT $1,$2,weekday,'09:00'::time,'17:00'::time
         FROM generate_series(1,7) AS weekday`,
      [tenantId, branchId],
    );

    return {
      tenantId,
      branchId,
      membershipId,
      principalId,
      customerId,
      variantId,
      cashMethodId,
      manualMethodId,
    };
  });
}

function createContext(seed: Seed) {
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId: seed.membershipId,
    principalId: seed.principalId,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
}

function financeContext(
  seed: Seed,
  fittingId: string,
  permissions: Array<'reservations.manage' | 'payments.manage' | 'evidence.verify'> = [
    'reservations.manage',
  ],
) {
  return {
    ...createContext(seed),
    fittingId,
    permissionCodes: permissions,
    role: 'owner' as const,
    effectiveTenantStatus: 'active' as const,
  };
}

async function acceptedReceiptFile(seed: Seed, label: string): Promise<string> {
  return withAdmin(async (client) => {
    return requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO file_object
             (tenant_id,purpose,storage_key,version_id,sha256,mime_type,byte_size,
              lifecycle_status,is_private,upload_expires_at,frozen_at)
           VALUES ($1,'payment_receipt',$2,'version-1',$3,'image/png',128,
                   'accepted',true,statement_timestamp()+interval '1 hour',statement_timestamp())
           RETURNING id`,
          [seed.tenantId, `tests/fitting7/${label}`, 'a'.repeat(64)],
        )
      ).rows,
      'receipt file',
    );
  });
}

describe('FIT-BE-070..072 fitting finance integration', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const {
    cancelFittingCommand,
    confirmFittingCommand,
    markFittingNoShowCommand,
    rejectFittingCommand,
  } = await import('../../src/modules/fittings/fittings.mutation.service.js');
  const {
    attachFittingPaymentReceiptCommand,
    createFittingPaymentIntentCommand,
    requestFittingFeeRefundCommand,
    resolveFittingFeeRefundCommand,
    verifyFittingPaymentCommand,
  } = await import('../../src/modules/fittings/fittings.finance.service.js');
  const { getFittingDetail } = await import('../../src/modules/fittings/fittings.service.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  async function createFitting(seed: Seed, startsAt = '2099-01-09T02:00:00.000Z') {
    const response = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: startsAt,
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    if (!response.body.success) throw new Error('Expected fitting create success.');
    return response.body.data.fitting;
  }

  async function verifyCashFittingFee(seed: Seed, fittingId: string): Promise<string> {
    const intent = await createFittingPaymentIntentCommand(financeContext(seed, fittingId), {
      payment_method_id: seed.cashMethodId as never,
    });
    if (!intent.body.success) throw new Error('Expected fitting payment intent success.');
    const paymentId = intent.body.data.fitting.fee.payment?.id;
    if (!paymentId) throw new Error('Expected fitting payment id.');
    const verified = await verifyFittingPaymentCommand(
      financeContext(seed, fittingId, [
        'reservations.manage',
        'payments.manage',
        'evidence.verify',
      ]),
      { verified_amount_minor: '500', cash_tendered_minor: '500' },
    );
    if (!verified.body.success) throw new Error('Expected fitting payment verification success.');
    return paymentId;
  }

  it('creates an immutable fitting_fee charge for a positive snapshot and no payment until an explicit intent is created', async () => {
    const seed = await seedTenant('charge');
    const fitting = await createFitting(seed);

    await withAdmin(async (client) => {
      const state = await client.query<{ charges: string; payments: string; amount_minor: number }>(
        `SELECT
           (SELECT count(*)::text FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid AND kind='fitting_fee') AS charges,
           (SELECT count(*)::text FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS payments,
           (SELECT amount_minor FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid AND kind='fitting_fee' LIMIT 1) AS amount_minor`,
        [seed.tenantId, fitting.id],
      );
      expect(state.rows[0]).toEqual({ charges: '1', payments: '0', amount_minor: 500 });
    });

    const payment = await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.manualMethodId as never,
    });
    expect(payment.status).toBe(201);
    if (!payment.body.success) throw new Error('Expected payment intent success.');
    expect(payment.body.data.fitting.status).toBe('pending');
    expect(payment.body.data.fitting.version).toBe(fitting.version);
    expect(payment.body.data.fitting.fee.payment).toMatchObject({
      status: 'pending',
      evidence_status: 'awaiting_upload',
      amount_minor: '500',
      currency: 'PHP',
    });
  });

  it('creates no charge/payment obligation for a zero-fee fitting', async () => {
    const seed = await seedTenant('zero', 0);
    const fitting = await createFitting(seed);
    expect(fitting.fee.fee_minor).toBe('0');
    expect(fitting.fee.payment).toBeNull();

    const payment = await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.cashMethodId as never,
    });
    expect(payment.status).toBe(409);
    expect(payment.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });

    await withAdmin(async (client) => {
      const state = await client.query<{ charges: string; payments: string }>(
        `SELECT
           (SELECT count(*)::text FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS charges,
           (SELECT count(*)::text FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS payments`,
        [seed.tenantId, fitting.id],
      );
      expect(state.rows[0]).toEqual({ charges: '0', payments: '0' });
    });
  });

  it('attaches manual receipt evidence without fabricating verified money or changing fitting lifecycle', async () => {
    const seed = await seedTenant('receipt');
    const fitting = await createFitting(seed);
    const intent = await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.manualMethodId as never,
    });
    expect(intent.status).toBe(201);
    const fileId = await acceptedReceiptFile(seed, 'manual.png');

    const receiptContext = {
      ...financeContext(seed, fitting.id),
      idempotencyKey: randomUUID(),
    };
    const receiptRequest = { file_id: fileId as never };
    const [attached, replay] = await Promise.all([
      attachFittingPaymentReceiptCommand(receiptContext, receiptRequest),
      attachFittingPaymentReceiptCommand(
        { ...receiptContext, requestId: randomUUID() },
        receiptRequest,
      ),
    ]);
    expect([attached.status, replay.status]).toEqual([200, 200]);
    if (!attached.body.success || !replay.body.success)
      throw new Error('Expected receipt attachment success.');
    expect(attached.body.data.evidence_status).toBe('uploaded');
    expect(attached.body.data.fitting.status).toBe('pending');
    expect(attached.body.data.fitting.version).toBe(fitting.version);
    expect(attached.body.data.fitting.fee.payment).toMatchObject({
      status: 'pending',
      evidence_status: 'uploaded',
      verified_at: null,
    });

    await withAdmin(async (client) => {
      const payment = await client.query<{
        status: string;
        verified_at: Date | null;
        verifications: string;
        receipts: string;
        receipt_audits: string;
      }>(
        `SELECT p.status, p.verified_at,
                (SELECT count(*)::text FROM payment_verification pv WHERE pv.tenant_id=p.tenant_id AND pv.payment_id=p.id) AS verifications,
                (SELECT count(*)::text FROM payment_receipt pr WHERE pr.tenant_id=p.tenant_id AND pr.payment_id=p.id) AS receipts,
                (SELECT count(*)::text FROM audit_event ae WHERE ae.tenant_id=p.tenant_id AND ae.entity_id=p.id AND ae.action='payment.receipt_attached') AS receipt_audits
           FROM payment p
          WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid`,
        [seed.tenantId, fitting.id],
      );
      expect(payment.rows[0]).toEqual({
        status: 'pending',
        verified_at: null,
        verifications: '0',
        receipts: '1',
        receipt_audits: '1',
      });
    });
  });

  it('requires finance verification authority and atomically verifies/allocates manual fitting payment without changing fitting state/version', async () => {
    const seed = await seedTenant('verify-manual');
    const fitting = await createFitting(seed);
    await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.manualMethodId as never,
    });
    const fileId = await acceptedReceiptFile(seed, 'verified.png');
    await attachFittingPaymentReceiptCommand(financeContext(seed, fitting.id), {
      file_id: fileId as never,
    });

    await expect(
      verifyFittingPaymentCommand(financeContext(seed, fitting.id), {
        verified_amount_minor: '500',
        merchant_reference: 'gcash-ref-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const verified = await verifyFittingPaymentCommand(
      financeContext(seed, fitting.id, [
        'reservations.manage',
        'payments.manage',
        'evidence.verify',
      ]),
      { verified_amount_minor: '500', merchant_reference: 'gcash-ref-1' },
    );
    expect(verified.status).toBe(200);
    if (!verified.body.success) throw new Error('Expected payment verification success.');
    expect(verified.body.data.fitting.status).toBe('pending');
    expect(verified.body.data.fitting.version).toBe(fitting.version);
    expect(verified.body.data.fitting.fee.payment).toMatchObject({
      status: 'paid',
      evidence_status: 'verified',
      amount_minor: '500',
    });

    await withAdmin(async (client) => {
      const posting = await client.query<{
        verifications: string;
        allocations: string;
        allocated_minor: number;
        receipt_status: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM payment_verification pv JOIN payment p ON p.id=pv.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid) AS verifications,
           (SELECT count(*)::text FROM payment_allocation pa JOIN payment p ON p.id=pa.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid AND pa.direction='apply') AS allocations,
           (SELECT pa.amount_minor FROM payment_allocation pa JOIN payment p ON p.id=pa.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid AND pa.direction='apply' LIMIT 1) AS allocated_minor,
           (SELECT pr.evidence_status FROM payment_receipt pr JOIN payment p ON p.id=pr.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid ORDER BY pr.submitted_at DESC LIMIT 1) AS receipt_status`,
        [seed.tenantId, fitting.id],
      );
      expect(posting.rows[0]).toEqual({
        verifications: '1',
        allocations: '1',
        allocated_minor: 500,
        receipt_status: 'verified',
      });
    });
  });

  it('allows fitting confirmation without payment and keeps later finance verification independent from lifecycle state', async () => {
    const seed = await seedTenant('independent');
    const fitting = await createFitting(seed);

    const confirmed = await confirmFittingCommand(
      {
        ...createContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: fitting.version },
    );
    expect(confirmed.status).toBe(200);
    if (!confirmed.body.success) throw new Error('Expected fitting confirmation success.');
    expect(confirmed.body.data.fitting.status).toBe('confirmed');
    expect(confirmed.body.data.fitting.fee.payment).toBeNull();
    const confirmedVersion = confirmed.body.data.fitting.version;

    await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.manualMethodId as never,
    });
    const verified = await verifyFittingPaymentCommand(
      financeContext(seed, fitting.id, [
        'reservations.manage',
        'payments.manage',
        'evidence.verify',
      ]),
      { verified_amount_minor: '500', merchant_reference: 'manual-reviewed' },
    );
    expect(verified.status).toBe(200);
    if (!verified.body.success) throw new Error('Expected manual verification success.');
    expect(verified.body.data.fitting.status).toBe('confirmed');
    expect(verified.body.data.fitting.version).toBe(confirmedVersion);
    expect(verified.body.data.fitting.fee.payment?.status).toBe('paid');
  });

  it('supports cash verification without receipt and records tender/change separately from verified fitting fee', async () => {
    const seed = await seedTenant('cash');
    const fitting = await createFitting(seed);
    await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.cashMethodId as never,
    });

    const fileId = await acceptedReceiptFile(seed, 'cash.png');
    const receiptAttempt = await attachFittingPaymentReceiptCommand(
      financeContext(seed, fitting.id),
      {
        file_id: fileId as never,
      },
    );
    expect(receiptAttempt.status).toBe(409);

    const verified = await verifyFittingPaymentCommand(
      financeContext(seed, fitting.id, [
        'reservations.manage',
        'payments.manage',
        'evidence.verify',
      ]),
      { verified_amount_minor: '500', cash_tendered_minor: '700' },
    );
    expect(verified.status).toBe(200);
    if (!verified.body.success) throw new Error('Expected cash verification success.');
    expect(verified.body.data.fitting.fee.payment).toMatchObject({
      status: 'paid',
      evidence_status: 'not_required',
    });

    await withAdmin(async (client) => {
      const verification = await client.query<{
        verified_amount_minor: number;
        cash_tendered_minor: number;
        change_due_minor: number;
      }>(
        `SELECT pv.verified_amount_minor, pv.cash_tendered_minor, pv.change_due_minor
           FROM payment_verification pv
           JOIN payment p ON p.tenant_id=pv.tenant_id AND p.id=pv.payment_id
          WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid
          LIMIT 1`,
        [seed.tenantId, fitting.id],
      );
      expect(verification.rows[0]).toEqual({
        verified_amount_minor: 500,
        cash_tendered_minor: 700,
        change_due_minor: 200,
      });
    });
  });

  it('database guard rejects payment allocations that cross fitting booking sources', async () => {
    const seed = await seedTenant('allocation-guard');
    const first = await createFitting(seed, '2099-01-09T02:00:00.000Z');
    const second = await createFitting(seed, '2099-01-09T04:00:00.000Z');
    await createFittingPaymentIntentCommand(financeContext(seed, first.id), {
      payment_method_id: seed.cashMethodId as never,
    });

    const result = await withAdmin(async (client) => {
      const payment = await client.query<{ id: string }>(
        `SELECT id FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid LIMIT 1`,
        [seed.tenantId, first.id],
      );
      const charge = await client.query<{ id: string }>(
        `SELECT id FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid AND kind='fitting_fee' LIMIT 1`,
        [seed.tenantId, second.id],
      );
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO payment_allocation
             (tenant_id,payment_id,charge_id,amount_minor,direction,business_key)
           VALUES ($1,$2,$3,500,'apply',$4)`,
          [
            seed.tenantId,
            requireId(payment.rows, 'payment'),
            requireId(charge.rows, 'charge'),
            `bad-allocation:${randomUUID()}`,
          ],
        );
        await client.query('COMMIT');
        return { code: 'inserted', constraint: undefined };
      } catch (error) {
        await client.query('ROLLBACK');
        const pgError = error as { code?: string; constraint?: string };
        return { code: pgError.code, constraint: pgError.constraint };
      }
    });

    expect(result).toMatchObject({
      code: '23514',
      constraint: 'payment_allocation_booking_source_match',
    });
  });

  it('coalesces concurrent identical payment-intent and verification deliveries into one finance effect', async () => {
    const seed = await seedTenant('double-fire');
    const fitting = await createFitting(seed);
    const paymentContext = {
      ...financeContext(seed, fitting.id),
      idempotencyKey: randomUUID(),
    };
    const paymentRequest = { payment_method_id: seed.cashMethodId as never };

    const intents = await Promise.all([
      createFittingPaymentIntentCommand(paymentContext, paymentRequest),
      createFittingPaymentIntentCommand(
        { ...paymentContext, requestId: randomUUID() },
        paymentRequest,
      ),
    ]);
    expect(intents.map((result) => result.status)).toEqual([201, 201]);

    const verifyContext = {
      ...financeContext(seed, fitting.id, [
        'reservations.manage',
        'payments.manage',
        'evidence.verify',
      ]),
      idempotencyKey: randomUUID(),
    };
    const verifyRequest = { verified_amount_minor: '500', cash_tendered_minor: '500' } as const;
    const verifications = await Promise.all([
      verifyFittingPaymentCommand(verifyContext, verifyRequest),
      verifyFittingPaymentCommand({ ...verifyContext, requestId: randomUUID() }, verifyRequest),
    ]);
    expect(verifications.map((result) => result.status)).toEqual([200, 200]);

    await withAdmin(async (client) => {
      const state = await client.query<{
        payments: string;
        verifications: string;
        allocations: string;
        payment_audits: string;
        verification_audits: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS payments,
           (SELECT count(*)::text FROM payment_verification pv JOIN payment p ON p.id=pv.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid) AS verifications,
           (SELECT count(*)::text FROM payment_allocation pa JOIN payment p ON p.id=pa.payment_id WHERE p.tenant_id=$1 AND p.fitting_id=$2::uuid AND pa.direction='apply') AS allocations,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND action='fitting.payment_created' AND redacted_summary->>'fitting_id'=$2::text) AS payment_audits,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND action='payment.verified' AND redacted_summary->>'fitting_id'=$2::text) AS verification_audits`,
        [seed.tenantId, fitting.id],
      );
      expect(state.rows[0]).toEqual({
        payments: '1',
        verifications: '1',
        allocations: '1',
        payment_audits: '1',
        verification_audits: '1',
      });
    });
  });

  it('lifecycle responses continue exposing finance state without using payment as a confirmation gate', async () => {
    const seed = await seedTenant('projection');
    const fitting = await createFitting(seed);
    await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.cashMethodId as never,
    });

    const confirmed = await confirmFittingCommand(
      {
        ...createContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: fitting.version },
    );
    expect(confirmed.status).toBe(200);
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');
    expect(confirmed.body.data.fitting.status).toBe('confirmed');
    expect(confirmed.body.data.fitting.fee.payment).toMatchObject({
      status: 'pending',
      evidence_status: 'not_required',
    });

    const readback = await getFittingDetail(
      {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        membershipId: seed.membershipId,
        principalId: seed.principalId,
        permissionCodes: ['reservations.manage'],
        effectiveTenantStatus: 'active',
      },
      fitting.id,
    );
    expect(readback.status).toBe('confirmed');
    expect(readback.fee.payment?.status).toBe('pending');
  });

  it('reject, cancel, and no-show never auto-create refunds or allocation reversals', async () => {
    const seed = await seedTenant('terminal-no-auto-refund');

    const rejectedFitting = await createFitting(seed, '2099-01-10T02:00:00.000Z');
    await verifyCashFittingFee(seed, rejectedFitting.id);
    const rejected = await rejectFittingCommand(
      {
        ...createContext(seed),
        fittingId: rejectedFitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: rejectedFitting.version, reason: 'Unable to accommodate fitting.' },
    );
    expect(rejected.status).toBe(200);

    const cancelledFitting = await createFitting(seed, '2099-01-10T04:00:00.000Z');
    await verifyCashFittingFee(seed, cancelledFitting.id);
    const confirmedForCancel = await confirmFittingCommand(
      {
        ...createContext(seed),
        fittingId: cancelledFitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: cancelledFitting.version },
    );
    if (!confirmedForCancel.body.success) throw new Error('Expected fitting confirmation success.');
    const cancelled = await cancelFittingCommand(
      {
        ...createContext(seed),
        fittingId: cancelledFitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: confirmedForCancel.body.data.fitting.version, reason: 'Customer cancelled.' },
    );
    expect(cancelled.status).toBe(200);

    const noShowFitting = await createFitting(seed, '2099-01-10T06:00:00.000Z');
    await verifyCashFittingFee(seed, noShowFitting.id);
    await withAdmin(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE fitting_appointment
              SET period=tstzrange('2000-01-01T02:00:00Z','2000-01-01T03:00:00Z','[)')
            WHERE tenant_id=$1 AND id=$2::uuid`,
          [seed.tenantId, noShowFitting.id],
        );
        await client.query(
          `UPDATE fitting_slot_allocation
              SET period=tstzrange('2000-01-01T02:00:00Z','2000-01-01T03:00:00Z','[)')
            WHERE tenant_id=$1 AND fitting_id=$2::uuid AND is_blocking`,
          [seed.tenantId, noShowFitting.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    const confirmedForNoShow = await confirmFittingCommand(
      {
        ...createContext(seed),
        fittingId: noShowFitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: noShowFitting.version },
    );
    if (!confirmedForNoShow.body.success) throw new Error('Expected late fitting confirmation.');
    const noShow = await markFittingNoShowCommand(
      {
        ...createContext(seed),
        fittingId: noShowFitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: confirmedForNoShow.body.data.fitting.version },
    );
    expect(noShow.status).toBe(200);

    await withAdmin(async (client) => {
      const state = await client.query<{ refunds: string; reversals: string }>(
        `SELECT
           (SELECT count(*)::text FROM refund WHERE tenant_id=$1) AS refunds,
           (SELECT count(*)::text
              FROM payment_allocation pa
              JOIN payment p ON p.tenant_id=pa.tenant_id AND p.id=pa.payment_id
             WHERE p.tenant_id=$1 AND p.fitting_id IS NOT NULL AND pa.direction='reverse') AS reversals`,
        [seed.tenantId],
      );
      expect(state.rows[0]).toEqual({ refunds: '0', reversals: '0' });
    });
  });

  it('denies refund creation for pending/rejected evidence and keeps finance state unchanged', async () => {
    const seed = await seedTenant('refund-unverified');
    const fitting = await createFitting(seed);
    const intent = await createFittingPaymentIntentCommand(financeContext(seed, fitting.id), {
      payment_method_id: seed.manualMethodId as never,
    });
    if (!intent.body.success) throw new Error('Expected payment intent success.');
    const paymentId = intent.body.data.fitting.fee.payment?.id;
    if (!paymentId) throw new Error('Expected payment id.');
    const fileId = await acceptedReceiptFile(seed, 'rejected-refund.png');
    await attachFittingPaymentReceiptCommand(financeContext(seed, fitting.id), {
      file_id: fileId as never,
    });
    await withAdmin(async (client) => {
      await client.query(
        `UPDATE payment_receipt SET evidence_status='rejected'
          WHERE tenant_id=$1 AND payment_id=$2::uuid`,
        [seed.tenantId, paymentId],
      );
    });

    const denied = await requestFittingFeeRefundCommand(
      financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      {
        payment_id: paymentId,
        amount_minor: '500',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'Customer requested refund.',
      },
    );
    expect(denied.status).toBe(409);
    expect(denied.body).toMatchObject({
      success: false,
      error: { code: 'PAYMENT_PREREQUISITE_FAILED' },
    });

    await withAdmin(async (client) => {
      const state = await client.query<{
        refunds: string;
        reversals: string;
        payment_status: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM refund WHERE tenant_id=$1 AND payment_id=$2::uuid) AS refunds,
           (SELECT count(*)::text FROM payment_allocation WHERE tenant_id=$1 AND payment_id=$2::uuid AND direction='reverse') AS reversals,
           (SELECT status FROM payment WHERE tenant_id=$1 AND id=$2::uuid) AS payment_status`,
        [seed.tenantId, paymentId],
      );
      expect(state.rows[0]).toEqual({ refunds: '0', reversals: '0', payment_status: 'pending' });
    });
  });

  it('requires Owner finance authority and caps concurrent fitting refunds at the remaining balance', async () => {
    const seed = await seedTenant('refund-race');
    const fitting = await createFitting(seed);
    const paymentId = await verifyCashFittingFee(seed, fitting.id);
    const request = {
      payment_id: paymentId as never,
      amount_minor: '300',
      currency: 'PHP',
      purpose: 'fitting_fee_refund' as const,
      reason: 'Approved partial fitting-fee refund.',
    };

    await expect(
      requestFittingFeeRefundCommand(
        {
          ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
          role: 'frontdesk',
        },
        request,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const firstContext = {
      ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      idempotencyKey: randomUUID(),
    };
    const secondContext = {
      ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([
      requestFittingFeeRefundCommand(firstContext, request),
      requestFittingFeeRefundCommand(secondContext, request),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body).toMatchObject({
      success: false,
      error: { code: 'CAPACITY_CONFLICT' },
    });

    await withAdmin(async (client) => {
      const state = await client.query<{
        active_refunds: string;
        reversed: string;
        net_allocated: string;
      }>(
        `SELECT
           (SELECT COALESCE(sum(amount_minor),0)::text FROM refund WHERE tenant_id=$1 AND payment_id=$2::uuid AND status IN ('requested','processing','completed')) AS active_refunds,
           (SELECT COALESCE(sum(amount_minor),0)::text FROM payment_allocation WHERE tenant_id=$1 AND payment_id=$2::uuid AND direction='reverse') AS reversed,
           (SELECT COALESCE(sum(CASE WHEN direction='apply' THEN amount_minor ELSE -amount_minor END),0)::text FROM payment_allocation WHERE tenant_id=$1 AND payment_id=$2::uuid) AS net_allocated`,
        [seed.tenantId, paymentId],
      );
      expect(state.rows[0]).toEqual({
        active_refunds: '300',
        reversed: '300',
        net_allocated: '200',
      });
    });
  });

  it('failed manual refund restores allocation balance and permits an explicit new refund instruction', async () => {
    const seed = await seedTenant('refund-failed');
    const fitting = await createFitting(seed);
    const paymentId = await verifyCashFittingFee(seed, fitting.id);
    const requested = await requestFittingFeeRefundCommand(
      financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      {
        payment_id: paymentId as never,
        amount_minor: '200',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'Approved partial refund.',
      },
    );
    if (!requested.body.success) throw new Error('Expected refund request success.');
    const refundId = requested.body.data.refund.id;

    const failed = await resolveFittingFeeRefundCommand(
      {
        ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
        refundId,
      },
      { status: 'failed', resolution_note: 'External cash handoff did not complete.' },
    );
    expect(failed.status).toBe(200);
    if (!failed.body.success) throw new Error('Expected refund failure resolution success.');
    expect(failed.body.data.refund.status).toBe('failed');

    await withAdmin(async (client) => {
      const state = await client.query<{ payment_status: string; net_allocated: string }>(
        `SELECT
           (SELECT status FROM payment WHERE tenant_id=$1 AND id=$2::uuid) AS payment_status,
           (SELECT COALESCE(sum(CASE WHEN direction='apply' THEN amount_minor ELSE -amount_minor END),0)::text FROM payment_allocation WHERE tenant_id=$1 AND payment_id=$2::uuid) AS net_allocated`,
        [seed.tenantId, paymentId],
      );
      expect(state.rows[0]).toEqual({ payment_status: 'paid', net_allocated: '500' });
    });

    const retried = await requestFittingFeeRefundCommand(
      {
        ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
        idempotencyKey: randomUUID(),
      },
      {
        payment_id: paymentId as never,
        amount_minor: '500',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'New explicit refund attempt after failure.',
      },
    );
    expect(retried.status).toBe(201);
  });

  it('manual completion records the refund once, fully refunds payment only after completion, and leaves fitting lifecycle unchanged', async () => {
    const seed = await seedTenant('refund-complete');
    const fitting = await createFitting(seed);
    const paymentId = await verifyCashFittingFee(seed, fitting.id);
    const refundContext = {
      ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      idempotencyKey: randomUUID(),
    };
    const refundRequest = {
      payment_id: paymentId as never,
      amount_minor: '500',
      currency: 'PHP',
      purpose: 'fitting_fee_refund' as const,
      reason: 'Full fitting-fee refund approved.',
    };
    const requestedResults = await Promise.all([
      requestFittingFeeRefundCommand(refundContext, refundRequest),
      requestFittingFeeRefundCommand({ ...refundContext, requestId: randomUUID() }, refundRequest),
    ]);
    expect(requestedResults.map((result) => result.status)).toEqual([201, 201]);
    const requested = requestedResults[0];
    if (!requested?.body.success) throw new Error('Expected refund request success.');
    const refundId = requested.body.data.refund.id;
    expect(requestedResults[1]?.body).toMatchObject({
      success: true,
      data: { refund: { id: refundId } },
    });

    await withAdmin(async (client) => {
      const payment = await client.query<{ status: string }>(
        `SELECT status FROM payment WHERE tenant_id=$1 AND id=$2::uuid`,
        [seed.tenantId, paymentId],
      );
      expect(payment.rows[0]?.status).toBe('paid');
    });

    const resolutionContext = {
      ...financeContext(seed, fitting.id, ['reservations.manage', 'payments.manage']),
      refundId,
      idempotencyKey: randomUUID(),
    };
    const resolutionRequest = {
      status: 'completed' as const,
      merchant_reference: 'manual-refund-001',
      resolution_note: 'Owner verified that the refund was returned to the customer.',
    };
    const completed = await Promise.all([
      resolveFittingFeeRefundCommand(resolutionContext, resolutionRequest),
      resolveFittingFeeRefundCommand(
        { ...resolutionContext, requestId: randomUUID() },
        resolutionRequest,
      ),
    ]);
    expect(completed.map((result) => result.status)).toEqual([200, 200]);

    await withAdmin(async (client) => {
      const state = await client.query<{
        payment_status: string;
        refund_status: string;
        completed_at: Date | null;
        refund_audits: string;
        net_allocated: string;
        fitting_status: string;
      }>(
        `SELECT
           (SELECT status FROM payment WHERE tenant_id=$1 AND id=$2::uuid) AS payment_status,
           (SELECT status FROM refund WHERE tenant_id=$1 AND id=$3::uuid) AS refund_status,
           (SELECT completed_at FROM refund WHERE tenant_id=$1 AND id=$3::uuid) AS completed_at,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND entity_type='refund' AND entity_id=$3::uuid AND action='refund.completed') AS refund_audits,
           (SELECT COALESCE(sum(CASE WHEN direction='apply' THEN amount_minor ELSE -amount_minor END),0)::text FROM payment_allocation WHERE tenant_id=$1 AND payment_id=$2::uuid) AS net_allocated,
           (SELECT status FROM fitting_appointment WHERE tenant_id=$1 AND id=$4::uuid) AS fitting_status`,
        [seed.tenantId, paymentId, refundId, fitting.id],
      );
      expect(state.rows[0]).toMatchObject({
        payment_status: 'refunded',
        refund_status: 'completed',
        refund_audits: '1',
        net_allocated: '0',
        fitting_status: 'pending',
      });
      expect(state.rows[0]?.completed_at).toBeInstanceOf(Date);
    });
  });

  it('conceals foreign-tenant fitting payments and database constraints reject cross-tenant refund links', async () => {
    const tenantA = await seedTenant('refund-tenant-a');
    const tenantB = await seedTenant('refund-tenant-b');
    const fittingA = await createFitting(tenantA);
    const fittingB = await createFitting(tenantB);
    const paymentA = await verifyCashFittingFee(tenantA, fittingA.id);
    await verifyCashFittingFee(tenantB, fittingB.id);

    const concealed = await requestFittingFeeRefundCommand(
      financeContext(tenantB, fittingB.id, ['reservations.manage', 'payments.manage']),
      {
        payment_id: paymentA as never,
        amount_minor: '100',
        currency: 'PHP',
        purpose: 'fitting_fee_refund',
        reason: 'Foreign payment must stay concealed.',
      },
    );
    expect(concealed.status).toBe(404);

    const violation = await withAdmin(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO refund
             (tenant_id,payment_id,amount_minor,currency,purpose,status,requested_by,business_key)
           VALUES ($1,$2::uuid,100,'PHP','fitting_fee_refund','requested',$3::uuid,$4)`,
          [tenantB.tenantId, paymentA, tenantB.membershipId, `cross-tenant:${randomUUID()}`],
        );
        await client.query('COMMIT');
        return { code: 'inserted', constraint: undefined };
      } catch (error) {
        await client.query('ROLLBACK');
        const pgError = error as { code?: string; constraint?: string };
        return { code: pgError.code, constraint: pgError.constraint };
      }
    });
    expect(violation).toMatchObject({
      code: '23503',
      constraint: 'refund_payment_same_tenant_fk',
    });
  });
});

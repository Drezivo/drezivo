import type { PoolClient } from 'pg';

import type { StorefrontDocument } from '@drezivo/contracts';

import type { PolicySnapshotColumns } from '../storefront/storefront-policy.js';

export interface StorefrontRow {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'suspended';
  version: number;
  published_at: Date | null;
  updated_at: Date;
  branding: Record<string, unknown>;
  contact: Record<string, unknown>;
  content: Record<string, unknown>;
  checkout: Record<string, unknown>;
  tenant_name: string;
}

export interface PolicyRow extends PolicySnapshotColumns {
  id: string;
  version: number;
  effective_at: Date;
}

export interface ReadinessRow {
  has_active_clothing: boolean;
  has_storefront_payment_method: boolean;
}

const STOREFRONT_COLUMNS = `s.id, s.slug, s.status, s.version, s.published_at, s.updated_at,
  s.branding, s.contact, s.content, s.checkout, t.name AS tenant_name`;

/** V1 has one storefront per workspace, created at bootstrap for the default branch. */
export async function readStorefront(client: PoolClient, tenantId: string, forUpdate = false): Promise<StorefrontRow | null> {
  const result = await client.query<StorefrontRow>(
    `SELECT ${STOREFRONT_COLUMNS}
       FROM storefront s
       JOIN tenant t ON t.id = s.tenant_id
      WHERE s.tenant_id = $1
      ORDER BY s.created_at, s.id
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function readCurrentPolicy(client: PoolClient, tenantId: string, storefrontId: string): Promise<PolicyRow | null> {
  const result = await client.query<PolicyRow>(
    `SELECT id, version, effective_at, rental_rules, deposit_rules, cancellation_rules, delivery_rules, privacy_notice
       FROM policy_snapshot
      WHERE tenant_id = $1 AND storefront_id = $2 AND effective_at <= statement_timestamp()
      ORDER BY version DESC
      LIMIT 1`,
    [tenantId, storefrontId],
  );
  return result.rows[0] ?? null;
}

export async function readReadiness(client: PoolClient, tenantId: string): Promise<ReadinessRow> {
  const result = await client.query<ReadinessRow>(
    `SELECT
       EXISTS (
         SELECT 1
           FROM product p
           JOIN product_variant pv ON pv.tenant_id = p.tenant_id AND pv.product_id = p.id AND pv.status = 'active'
           LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
          WHERE p.tenant_id = $1 AND p.status = 'active' AND (p.category_id IS NULL OR c.status = 'active')
       ) AS has_active_clothing,
       EXISTS (
         SELECT 1
           FROM payment_method pm
           LEFT JOIN file_object qr ON qr.tenant_id = pm.tenant_id AND qr.id = pm.qr_file_id
          WHERE pm.tenant_id = $1
            AND pm.active AND pm.storefront_enabled AND pm.rail <> 'cash'
            AND (
              (pm.rail = 'manual_qr' AND qr.lifecycle_status = 'accepted')
              OR (pm.rail = 'manual_transfer' AND NULLIF(btrim(pm.destination_snapshot ->> 'account_number'), '') IS NOT NULL)
            )
       ) AS has_storefront_payment_method`,
    [tenantId],
  );
  return result.rows[0] ?? { has_active_clothing: false, has_storefront_payment_method: false };
}

/** Returns the subset of `fileIds` that are accepted storefront images owned by this workspace. */
export async function findAcceptedStorefrontAssets(client: PoolClient, tenantId: string, fileIds: string[]): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set();
  const result = await client.query<{ id: string }>(
    `SELECT id FROM file_object
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])
        AND purpose = 'storefront_asset' AND lifecycle_status = 'accepted'
        AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')`,
    [tenantId, fileIds],
  );
  return new Set(result.rows.map((row) => row.id));
}

export async function findActiveProducts(client: PoolClient, tenantId: string, productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const result = await client.query<{ id: string }>(
    `SELECT id FROM product WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [tenantId, productIds],
  );
  return new Set(result.rows.map((row) => row.id));
}

/** Conditional write: returns false when another edit already moved the version on. */
export async function updateStorefrontDocument(
  client: PoolClient,
  input: { tenantId: string; storefrontId: string; expectedVersion: number; document: StorefrontDocument },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE storefront
        SET branding = $4::jsonb, contact = $5::jsonb, content = $6::jsonb, checkout = $7::jsonb,
            version = version + 1, updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND id = $2 AND version = $3`,
    [
      input.tenantId,
      input.storefrontId,
      input.expectedVersion,
      JSON.stringify(input.document.branding),
      JSON.stringify(input.document.contact),
      JSON.stringify(input.document.content),
      JSON.stringify(input.document.checkout),
    ],
  );
  return result.rowCount === 1;
}

export async function updateStorefrontSlug(
  client: PoolClient,
  input: { tenantId: string; storefrontId: string; expectedVersion: number; slug: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE storefront
        SET slug = $4, version = version + 1, updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND id = $2 AND version = $3`,
    [input.tenantId, input.storefrontId, input.expectedVersion, input.slug],
  );
  return result.rowCount === 1;
}

/** Owner-driven draft <-> published only. A suspended storefront is an operator decision. */
export async function transitionStorefront(
  client: PoolClient,
  input: { tenantId: string; storefrontId: string; expectedVersion: number; from: 'draft' | 'published'; to: 'draft' | 'published' },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE storefront
        SET status = $5,
            published_at = CASE WHEN $5 = 'published' THEN statement_timestamp() ELSE published_at END,
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = $4`,
    [input.tenantId, input.storefrontId, input.expectedVersion, input.from, input.to],
  );
  return result.rowCount === 1;
}

/** Appends the next policy version. The unique (storefront_id, version) key rejects a concurrent duplicate. */
export async function insertPolicyVersion(
  client: PoolClient,
  input: { tenantId: string; storefrontId: string; version: number; columns: PolicySnapshotColumns },
): Promise<void> {
  await client.query(
    `INSERT INTO policy_snapshot
       (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
        delivery_rules, privacy_notice, effective_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, statement_timestamp())`,
    [
      input.tenantId,
      input.storefrontId,
      input.version,
      JSON.stringify(input.columns.rental_rules),
      JSON.stringify(input.columns.deposit_rules),
      JSON.stringify(input.columns.cancellation_rules),
      JSON.stringify(input.columns.delivery_rules),
      input.columns.privacy_notice,
    ],
  );
}

export async function appendStorefrontAudit(
  client: PoolClient,
  input: { tenantId: string; actorKey: string; storefrontId: string; action: string; summary: Record<string, unknown>; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'storefront', $4, $5::jsonb, $6, statement_timestamp(), 'succeeded')`,
    [input.tenantId, input.actorKey, input.action, input.storefrontId, JSON.stringify(input.summary), input.requestId],
  );
}

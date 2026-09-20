import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { CreateClothingRequest, MeasurementMap } from '@drezivo/contracts';

export interface CategoryRow {
  id: string;
  name: string;
  visible: boolean;
  display_order: number;
}

export interface MeasurementGuideRow {
  id: string;
  file_id: string;
  name: string;
  status: 'active' | 'archived';
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

interface FileRow {
  id: string;
  purpose: string;
  mime_type: string;
  lifecycle_status: string;
  frozen_at: Date | null;
  version_id: string | null;
  sha256: string | null;
}

export interface CreatedClothingGraph {
  productId: string;
  variantCount: number;
  physicalPieceCount: number;
}

export async function listCategories(client: PoolClient, tenantId: string): Promise<CategoryRow[]> {
  const result = await client.query<CategoryRow>(
    `SELECT id, name, visible, display_order
       FROM category
      WHERE tenant_id = $1
      ORDER BY display_order ASC, name ASC, id ASC`,
    [tenantId],
  );
  return result.rows;
}

export async function categoryExists(
  client: PoolClient,
  tenantId: string,
  categoryId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM category WHERE tenant_id = $1 AND id = $2
     ) AS exists`,
    [tenantId, categoryId],
  );
  return result.rows[0]?.exists === true;
}

export async function readDefaultMeasurementGuide(
  client: PoolClient,
  tenantId: string,
): Promise<MeasurementGuideRow | null> {
  const result = await client.query<MeasurementGuideRow>(
    `SELECT id, file_id, name, status, is_default, created_at, updated_at
       FROM measurement_guide
      WHERE tenant_id = $1 AND status = 'active' AND is_default = true
      LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function validateMeasurementGuideFile(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<boolean> {
  const result = await client.query<FileRow>(
    `SELECT id, purpose, mime_type, lifecycle_status, frozen_at, version_id, sha256
       FROM file_object
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, fileId],
  );
  const row = result.rows[0];
  return Boolean(
    row &&
      row.purpose === 'measurement_guide' &&
      row.mime_type.startsWith('image/') &&
      row.lifecycle_status === 'accepted' &&
      row.frozen_at &&
      (row.version_id || row.sha256),
  );
}

export async function replaceDefaultMeasurementGuide(
  client: PoolClient,
  input: {
    tenantId: string;
    fileId: string;
    name: string;
    makeDefault: boolean;
  },
): Promise<MeasurementGuideRow> {
  if (input.makeDefault) {
    await client.query(
      `UPDATE measurement_guide
          SET is_default = false, updated_at = now()
        WHERE tenant_id = $1 AND is_default = true`,
      [input.tenantId],
    );
  }

  const result = await client.query<MeasurementGuideRow>(
    `INSERT INTO measurement_guide
       (id, tenant_id, file_id, name, status, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, now(), now())
     RETURNING id, file_id, name, status, is_default, created_at, updated_at`,
    [randomUUID(), input.tenantId, input.fileId, input.name, input.makeDefault],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Measurement guide insert did not return a row.');
  return row;
}

export async function validateCatalogueImageFiles(
  client: PoolClient,
  tenantId: string,
  fileIds: string[],
): Promise<boolean> {
  if (fileIds.length === 0) return true;
  const result = await client.query<FileRow>(
    `SELECT id, purpose, mime_type, lifecycle_status, frozen_at, version_id, sha256
       FROM file_object
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, fileIds],
  );
  if (result.rows.length !== fileIds.length) return false;
  return result.rows.every(
    (row) =>
      row.purpose === 'catalogue_image' &&
      row.mime_type.startsWith('image/') &&
      row.lifecycle_status === 'accepted' &&
      Boolean(row.frozen_at && (row.version_id || row.sha256)),
  );
}

export async function createClothingGraph(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    request: CreateClothingRequest;
    defaultGuideId: string | null;
    status: 'draft' | 'active';
    rentalPriceMinor: number;
    securityDepositMinor: number;
    extraDayPriceMinor: number;
    includedDurationMinutes: number;
  },
): Promise<CreatedClothingGraph> {
  const productId = randomUUID();
  await client.query(
    `INSERT INTO product
       (id, tenant_id, category_id, name, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
    [
      productId,
      input.tenantId,
      input.request.category_id,
      input.request.name,
      input.request.description,
      input.status,
    ],
  );

  for (const [displayOrder, fileId] of input.request.image_file_ids.entries()) {
    await client.query(
      `INSERT INTO product_image
         (id, tenant_id, product_id, file_id, display_order, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [randomUUID(), input.tenantId, productId, fileId, displayOrder],
    );
  }

  for (const [index, size] of input.request.sizes.entries()) {
    const variantId = randomUUID();
    const sku = generatedCode('SKU', productId, size.size_label, index);
    const measurementGuideId =
      size.measurement_mode === 'default_guide' ? input.defaultGuideId : null;
    const measurements: MeasurementMap =
      size.measurement_mode === 'custom' ? size.measurements : {};

    await client.query(
      `INSERT INTO product_variant
         (id, tenant_id, product_id, sku, size_label, color_label,
          measurements, measurement_unit, measurement_mode, measurement_guide_id,
          rental_price_minor, security_deposit_minor, currency, pricing_mode,
          included_duration_minutes, extra_day_price_minor, prep_minutes,
          turnaround_minutes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
               $11, $12, 'PHP', $13, $14, $15, $16, $17, $18, now(), now())`,
      [
        variantId,
        input.tenantId,
        productId,
        sku,
        size.size_label,
        input.request.color_label,
        JSON.stringify(measurements),
        size.measurement_unit,
        size.measurement_mode,
        measurementGuideId,
        input.rentalPriceMinor,
        input.securityDepositMinor,
        input.request.pricing.mode,
        input.includedDurationMinutes,
        input.extraDayPriceMinor,
        input.request.pricing.prep_minutes,
        input.request.pricing.turnaround_minutes,
        input.status,
      ],
    );

    await client.query(
      `INSERT INTO physical_asset
         (id, tenant_id, branch_id, variant_id, asset_code, lifecycle_status,
          readiness, custody_kind, measurement_overrides, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', 'ready', 'at_branch', '{}'::jsonb, 1, now(), now())`,
      [
        randomUUID(),
        input.tenantId,
        input.branchId,
        variantId,
        generatedCode('AST', productId, size.size_label, index),
      ],
    );
  }

  return {
    productId,
    variantCount: input.request.sizes.length,
    physicalPieceCount: input.request.sizes.length,
  };
}

export async function appendCatalogueAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    entityType: 'measurement_guide' | 'product';
    entityId: string;
    redactedSummary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, $4, $5, $6::jsonb, $7, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.redactedSummary),
      input.requestId,
    ],
  );
}

function generatedCode(prefix: string, productId: string, sizeLabel: string, index: number): string {
  const safeSize = sizeLabel
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 10)
    .toUpperCase() || 'SIZE';
  const productPart = productId.replaceAll('-', '').slice(0, 8).toUpperCase();
  const randomPart = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  return `${prefix}-${productPart}-${safeSize}-${index + 1}-${randomPart}`;
}

import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type {
  CreateClothingRequest,
  MeasurementMap,
  UpdateClothingProductRequest,
  UpdateClothingVariantRequest,
} from '@drezivo/contracts';

import { DuplicateClothingCodeError, StateConflictError } from '../../shared/errors.js';

export interface CategoryRow {
  id: string;
  name: string;
  status: 'active' | 'inactive';
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

export interface CatalogueFileRow {
  id: string;
  purpose: string;
  mime_type: string;
  byte_size: number;
  lifecycle_status: string;
  frozen_at: Date | null;
  version_id: string | null;
  sha256: string | null;
}

export interface MeasurementGuideFileViewRow {
  storage_key: string;
  version_id: string | null;
  mime_type: string;
  lifecycle_status: string;
  frozen_at: Date | null;
}

export interface ProductImageRow {
  file_id: string;
  display_order: number;
}

export interface CreatedClothingGraph {
  productId: string;
  code: string;
  variantCount: number;
  physicalPieceCount: number;
}

export interface EditableProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  updated_at: Date;
}

export interface EditableVariantRow {
  id: string;
  product_id: string;
  size_label: string;
  color_label: string | null;
  measurement_mode: 'default_guide' | 'custom' | 'none';
  measurement_guide_id: string | null;
  measurement_unit: 'cm' | 'in';
  measurements: MeasurementMap;
  rental_price_minor: number;
  security_deposit_minor: number;
  currency: string;
  pricing_mode: 'fixed_duration' | 'daily';
  included_duration_minutes: number;
  extra_day_price_minor: number;
  prep_minutes: number;
  turnaround_minutes: number;
  status: 'draft' | 'active' | 'archived';
  updated_at: Date;
}

export async function listCategories(client: PoolClient, tenantId: string): Promise<CategoryRow[]> {
  const result = await client.query<CategoryRow>(
    `SELECT id, name, status, display_order
       FROM category
      WHERE tenant_id = $1
      ORDER BY display_order ASC, name ASC, id ASC`,
    [tenantId],
  );
  return result.rows;
}

export async function updateCategoryStatus(
  client: PoolClient,
  tenantId: string,
  categoryId: string,
  status: CategoryRow['status'],
): Promise<CategoryRow | null> {
  const result = await client.query<CategoryRow>(
    `UPDATE category
        SET status = $3
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, name, status, display_order`,
    [tenantId, categoryId, status],
  );
  return result.rows[0] ?? null;
}

export async function readCategoryForCreate(
  client: PoolClient,
  tenantId: string,
  categoryId: string,
): Promise<CategoryRow | null> {
  const result = await client.query<CategoryRow>(
    `SELECT id, name, status, display_order
       FROM category
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, categoryId],
  );
  return result.rows[0] ?? null;
}

export async function readMeasurementGuidesForCreate(
  client: PoolClient,
  tenantId: string,
  guideIds: string[],
): Promise<MeasurementGuideRow[]> {
  if (guideIds.length === 0) return [];
  const result = await client.query<MeasurementGuideRow>(
    `SELECT id, file_id, name, status, is_default, created_at, updated_at
       FROM measurement_guide
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
      ORDER BY id ASC
      FOR SHARE`,
    [tenantId, guideIds],
  );
  return result.rows;
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

export async function readMeasurementGuideFileForView(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<MeasurementGuideFileViewRow | null> {
  const result = await client.query<MeasurementGuideFileViewRow>(
    `SELECT storage_key, version_id, mime_type, lifecycle_status, frozen_at
       FROM file_object
      WHERE tenant_id = $1 AND id = $2 AND purpose = 'measurement_guide'
      LIMIT 1`,
    [tenantId, fileId],
  );
  return result.rows[0] ?? null;
}

export async function validateMeasurementGuideFile(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<boolean> {
  const result = await client.query<CatalogueFileRow>(
    `SELECT id, purpose, mime_type, byte_size, lifecycle_status, frozen_at, version_id, sha256
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

export async function readCatalogueImageFiles(
  client: PoolClient,
  tenantId: string,
  fileIds: string[],
): Promise<CatalogueFileRow[]> {
  if (fileIds.length === 0) return [];
  const result = await client.query<CatalogueFileRow>(
    `SELECT id, purpose, mime_type, byte_size, lifecycle_status, frozen_at, version_id, sha256
       FROM file_object
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id ASC
      FOR SHARE`,
    [tenantId, fileIds],
  );
  return result.rows;
}

export async function readProductForEdit(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<EditableProductRow | null> {
  const result = await client.query<EditableProductRow>(
    `SELECT id, category_id, name, description, status, updated_at
       FROM product
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [tenantId, productId],
  );
  return result.rows[0] ?? null;
}

export async function updateProductForEdit(
  client: PoolClient,
  input: {
    tenantId: string;
    productId: string;
    current: EditableProductRow;
    request: UpdateClothingProductRequest;
  },
): Promise<EditableProductRow> {
  const result = await client.query<EditableProductRow>(
    `UPDATE product
        SET name = $3,
            description = $4,
            category_id = $5,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, category_id, name, description, status, updated_at`,
    [
      input.tenantId,
      input.productId,
      input.request.name ?? input.current.name,
      input.request.description !== undefined ? input.request.description : input.current.description,
      input.request.category_id ?? input.current.category_id,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('The clothing item could not be updated. Refresh and try again.');
  return row;
}

export async function readVariantForEdit(
  client: PoolClient,
  tenantId: string,
  productId: string,
  variantId: string,
): Promise<EditableVariantRow | null> {
  const result = await client.query<EditableVariantRow>(
    `SELECT id, product_id, size_label, color_label, measurement_mode, measurement_guide_id,
            measurement_unit, measurements, rental_price_minor, security_deposit_minor, currency,
            pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
            turnaround_minutes, status, updated_at
       FROM product_variant
      WHERE tenant_id = $1 AND product_id = $2 AND id = $3
      LIMIT 1
      FOR UPDATE`,
    [tenantId, productId, variantId],
  );
  return result.rows[0] ?? null;
}

export async function updateVariantForEdit(
  client: PoolClient,
  input: {
    tenantId: string;
    variantId: string;
    current: EditableVariantRow;
    request: UpdateClothingVariantRequest;
    pricing: {
      rentalPriceMinor: number;
      securityDepositMinor: number;
      extraDayPriceMinor: number;
      includedDurationMinutes: number;
    } | null;
  },
): Promise<EditableVariantRow> {
  const measurement = input.request.measurement;
  const result = await client.query<EditableVariantRow>(
    `UPDATE product_variant
        SET size_label = $3,
            color_label = $4,
            measurement_mode = $5,
            measurement_guide_id = $6,
            measurement_unit = $7,
            measurements = $8::jsonb,
            rental_price_minor = $9,
            security_deposit_minor = $10,
            pricing_mode = $11,
            included_duration_minutes = $12,
            extra_day_price_minor = $13,
            prep_minutes = $14,
            turnaround_minutes = $15,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, product_id, size_label, color_label, measurement_mode, measurement_guide_id,
                measurement_unit, measurements, rental_price_minor, security_deposit_minor, currency,
                pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
                turnaround_minutes, status, updated_at`,
    [
      input.tenantId,
      input.variantId,
      input.request.size_label ?? input.current.size_label,
      input.request.color_label !== undefined ? input.request.color_label : input.current.color_label,
      measurement?.measurement_mode ?? input.current.measurement_mode,
      measurement
        ? measurement.measurement_mode === 'default_guide'
          ? (measurement.measurement_guide_id ?? null)
          : null
        : input.current.measurement_guide_id,
      measurement?.measurement_unit ?? input.current.measurement_unit,
      JSON.stringify(measurement ? measurement.measurements : input.current.measurements),
      input.pricing?.rentalPriceMinor ?? input.current.rental_price_minor,
      input.pricing?.securityDepositMinor ?? input.current.security_deposit_minor,
      input.request.pricing?.mode ?? input.current.pricing_mode,
      input.pricing?.includedDurationMinutes ?? input.current.included_duration_minutes,
      input.pricing?.extraDayPriceMinor ?? input.current.extra_day_price_minor,
      input.request.pricing?.prep_minutes ?? input.current.prep_minutes,
      input.request.pricing?.turnaround_minutes ?? input.current.turnaround_minutes,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('The clothing variant could not be updated. Refresh and try again.');
  return row;
}

export async function readProductForImageMutation(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM product
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [tenantId, productId],
  );
  return result.rows[0] ?? null;
}

export async function replaceProductImages(
  client: PoolClient,
  input: { tenantId: string; productId: string; fileIds: string[] },
): Promise<ProductImageRow[]> {
  await client.query(
    `DELETE FROM product_image
      WHERE tenant_id = $1 AND product_id = $2`,
    [input.tenantId, input.productId],
  );

  const rows: ProductImageRow[] = [];
  for (const [displayOrder, fileId] of input.fileIds.entries()) {
    const result = await client.query<ProductImageRow>(
      `INSERT INTO product_image
         (id, tenant_id, product_id, file_id, display_order, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING file_id, display_order`,
      [randomUUID(), input.tenantId, input.productId, fileId, displayOrder],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Product image insert did not return a row.');
    rows.push(row);
  }
  return rows;
}

export async function createClothingGraph(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    request: CreateClothingRequest;
    status: 'draft' | 'active';
    rentalPriceMinor: number;
    securityDepositMinor: number;
    extraDayPriceMinor: number;
    includedDurationMinutes: number;
  },
): Promise<CreatedClothingGraph> {
  const productId = randomUUID();
  const productCode = await insertProductWithCode(client, {
    productId,
    tenantId: input.tenantId,
    categoryId: input.request.category_id,
    requestedCode: input.request.code,
    name: input.request.name,
    description: input.request.description,
    status: input.status,
  });

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
      size.measurement_mode === 'default_guide' ? (size.measurement_guide_id ?? null) : null;
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
    code: productCode,
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
    entityType: 'category' | 'measurement_guide' | 'product' | 'product_variant';
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

async function insertProductWithCode(
  client: PoolClient,
  input: {
    productId: string;
    tenantId: string;
    categoryId: string;
    requestedCode: string | undefined;
    name: string;
    description: string;
    status: 'draft' | 'active';
  },
): Promise<string> {
  const attempts = input.requestedCode ? 1 : 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = input.requestedCode?.trim() || generatedStyleCode();
    const result = await client.query<{ code: string }>(
      `INSERT INTO product
         (id, tenant_id, category_id, code, name, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING code`,
      [
        input.productId,
        input.tenantId,
        input.categoryId,
        code,
        input.name,
        input.description,
        input.status,
      ],
    );
    const inserted = result.rows[0]?.code;
    if (inserted) return inserted;
    if (input.requestedCode) break;
  }
  if (input.requestedCode) {
    throw new DuplicateClothingCodeError('That clothing code is already in use.');
  }
  throw new StateConflictError('Drezivo could not generate a unique clothing code. Try again.');
}

function generatedStyleCode(): string {
  return `CG-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
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

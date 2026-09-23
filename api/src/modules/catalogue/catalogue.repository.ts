import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type {
  CreateClothingRequest,
  CreateClothingVariantRequest,
  CreatePhysicalAssetRequest,
  MeasurementMap,
  UpdateClothingProductRequest,
  UpdateClothingVariantRequest,
  UpdatePhysicalAssetStateRequest,
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

export interface EditablePhysicalAssetRow {
  id: string;
  branch_id: string;
  variant_id: string;
  asset_code: string;
  lifecycle_status: 'active' | 'retired' | 'lost';
  readiness: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready';
  custody_kind: 'at_branch' | 'with_customer' | 'in_transit';
  condition_note: string | null;
  measurement_overrides: MeasurementMap | null;
  alteration_note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ArchivePhysicalAssetRow extends EditablePhysicalAssetRow {
  blocking_allocation_count: number;
  open_maintenance_count: number;
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

export async function createCategory(
  client: PoolClient,
  input: { tenantId: string; name: string; displayOrder: number },
): Promise<CategoryRow> {
  const result = await client.query<CategoryRow>(
    `INSERT INTO category (tenant_id, name, status, display_order)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT DO NOTHING
     RETURNING id, name, status, display_order`,
    [input.tenantId, input.name, input.displayOrder],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('A clothing category with that name already exists.');
  return row;
}

export async function updateCategory(
  client: PoolClient,
  input: { tenantId: string; categoryId: string; name?: string; displayOrder?: number },
): Promise<CategoryRow | null> {
  const current = await readCategoryForCreate(client, input.tenantId, input.categoryId);
  if (!current) return null;

  const name = input.name ?? current.name;
  const displayOrder = input.displayOrder ?? current.display_order;
  const duplicate = await client.query<{ id: string }>(
    `SELECT id
       FROM category
      WHERE tenant_id = $1
        AND id <> $2
        AND lower(btrim(name)) = lower(btrim($3))
      LIMIT 1`,
    [input.tenantId, input.categoryId, name],
  );
  if (duplicate.rows[0]) {
    throw new StateConflictError('A clothing category with that name already exists.');
  }

  try {
    const result = await client.query<CategoryRow>(
      `UPDATE category
          SET name = $3,
              display_order = $4
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, name, status, display_order`,
      [input.tenantId, input.categoryId, name, displayOrder],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      throw new StateConflictError('A clothing category with that name already exists.');
    }
    throw error;
  }
}

export async function removeCategory(
  client: PoolClient,
  tenantId: string,
  categoryId: string,
): Promise<{ categoryId: string; outcome: 'deleted' | 'deactivated' } | null> {
  const current = await readCategoryForCreate(client, tenantId, categoryId);
  if (!current) return null;

  const references = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM product
      WHERE tenant_id = $1 AND category_id = $2`,
    [tenantId, categoryId],
  );
  const referenced = (references.rows[0]?.count ?? 0) > 0;
  if (referenced) {
    await client.query(
      `UPDATE category
          SET status = 'inactive'
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, categoryId],
    );
    return { categoryId, outcome: 'deactivated' };
  }

  const deleted = await client.query<{ id: string }>(
    `DELETE FROM category
      WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
    [tenantId, categoryId],
  );
  if (!deleted.rows[0]) return null;
  return { categoryId, outcome: 'deleted' };
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

export async function readProductPublishability(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<{ category_status: 'active' | 'inactive' | null; accepted_image_count: number }> {
  const result = await client.query<{ category_status: 'active' | 'inactive' | null; accepted_image_count: number }>(
    `SELECT c.status AS category_status,
            count(DISTINCT pi.file_id) FILTER (
              WHERE f.lifecycle_status = 'accepted' AND f.frozen_at IS NOT NULL
            )::int AS accepted_image_count
       FROM product p
       LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
       LEFT JOIN product_image pi ON pi.tenant_id = p.tenant_id AND pi.product_id = p.id
       LEFT JOIN file_object f ON f.tenant_id = pi.tenant_id AND f.id = pi.file_id AND f.purpose = 'catalogue_image'
      WHERE p.tenant_id = $1 AND p.id = $2
      GROUP BY c.status`,
    [tenantId, productId],
  );
  return result.rows[0] ?? { category_status: null, accepted_image_count: 0 };
}

export async function publishClothingGraph(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<{ product: EditableProductRow; activatedVariantCount: number }> {
  const activated = await client.query<{ id: string }>(
    `UPDATE product_variant pv
        SET status = 'active',
            updated_at = GREATEST(clock_timestamp(), pv.updated_at + interval '1 millisecond')
      WHERE pv.tenant_id = $1
        AND pv.product_id = $2
        AND pv.status = 'draft'
        AND EXISTS (
          SELECT 1 FROM physical_asset pa
           WHERE pa.tenant_id = pv.tenant_id
             AND pa.variant_id = pv.id
             AND pa.lifecycle_status = 'active'
        )
      RETURNING pv.id`,
    [tenantId, productId],
  );
  const activeCount = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM product_variant
      WHERE tenant_id = $1 AND product_id = $2 AND status = 'active'`,
    [tenantId, productId],
  );
  if ((activeCount.rows[0]?.count ?? 0) === 0) {
    throw new StateConflictError('Publish at least one variant with an active physical piece first.');
  }
  const product = await client.query<EditableProductRow>(
    `UPDATE product
        SET status = 'active',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
      RETURNING id, category_id, name, description, status, updated_at`,
    [tenantId, productId],
  );
  const row = product.rows[0];
  if (!row) throw new StateConflictError('The clothing item could not be published. Refresh and try again.');
  return { product: row, activatedVariantCount: activated.rowCount ?? 0 };
}

export async function restoreClothingGraph(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<{ product: EditableProductRow; restoredVariantCount: number }> {
  const product = await client.query<EditableProductRow>(
    `UPDATE product
        SET status = 'draft',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2 AND status = 'archived'
      RETURNING id, category_id, name, description, status, updated_at`,
    [tenantId, productId],
  );
  const row = product.rows[0];
  if (!row) throw new StateConflictError('The clothing item could not be restored. Refresh and try again.');
  const variants = await client.query(
    `UPDATE product_variant
        SET status = 'draft',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND product_id = $2 AND status = 'archived'`,
    [tenantId, productId],
  );
  return { product: row, restoredVariantCount: variants.rowCount ?? 0 };
}

export async function countActivePhysicalAssetsForVariant(
  client: PoolClient,
  tenantId: string,
  variantId: string,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM physical_asset
      WHERE tenant_id = $1 AND variant_id = $2 AND lifecycle_status = 'active'`,
    [tenantId, variantId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function countActiveVariantsForProduct(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM product_variant
      WHERE tenant_id = $1 AND product_id = $2 AND status = 'active'`,
    [tenantId, productId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function updateVariantLifecycle(
  client: PoolClient,
  input: { tenantId: string; variantId: string; status: EditableVariantRow['status'] },
): Promise<EditableVariantRow> {
  const result = await client.query<EditableVariantRow>(
    `UPDATE product_variant
        SET status = $3,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, product_id, size_label, color_label, measurement_mode, measurement_guide_id,
                measurement_unit, measurements, rental_price_minor, security_deposit_minor, currency,
                pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
                turnaround_minutes, status, updated_at`,
    [input.tenantId, input.variantId, input.status],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('The clothing variant could not be updated. Refresh and try again.');
  return row;
}

export async function removeVariantSafely(
  client: PoolClient,
  tenantId: string,
  productId: string,
  variantId: string,
): Promise<{ outcome: 'deleted' | 'archived'; row: EditableVariantRow | null }> {
  const references = await client.query<{ asset_count: number; reservation_count: number }>(
    `SELECT
       (SELECT count(*)::int FROM physical_asset WHERE tenant_id = $1 AND variant_id = $2) AS asset_count,
       (SELECT count(*)::int FROM reservation_line WHERE tenant_id = $1 AND variant_id = $2) AS reservation_count`,
    [tenantId, variantId],
  );
  const counts = references.rows[0] ?? { asset_count: 0, reservation_count: 0 };
  if (counts.asset_count === 0 && counts.reservation_count === 0) {
    const deleted = await client.query<{ id: string }>(
      `DELETE FROM product_variant
        WHERE tenant_id = $1 AND product_id = $2 AND id = $3 AND status = 'draft'
        RETURNING id`,
      [tenantId, productId, variantId],
    );
    if (deleted.rows[0]) return { outcome: 'deleted', row: null };
  }
  const row = await updateVariantLifecycle(client, { tenantId, variantId, status: 'archived' });
  return { outcome: 'archived', row };
}

export async function createVariantForProduct(
  client: PoolClient,
  input: {
    tenantId: string;
    productId: string;
    request: CreateClothingVariantRequest;
    rentalPriceMinor: number;
    securityDepositMinor: number;
    extraDayPriceMinor: number;
    includedDurationMinutes: number;
  },
): Promise<EditableVariantRow & { sku: string; created_at: Date }> {
  const variantId = randomUUID();
  const sku = input.request.sku?.trim() || `SKU-${input.productId.replaceAll('-', '').slice(0, 8).toUpperCase()}-${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
  const measurementGuideId = input.request.measurement_mode === 'default_guide' ? (input.request.measurement_guide_id ?? null) : null;
  const measurements = input.request.measurement_mode === 'custom' ? input.request.measurements : {};
  const result = await client.query<(EditableVariantRow & { sku: string; created_at: Date })>(
    `INSERT INTO product_variant
       (id, tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
        measurement_mode, measurement_guide_id, rental_price_minor, security_deposit_minor, currency,
        pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes,
        status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,'PHP',$13,$14,$15,$16,$17,'active',now(),now())
     ON CONFLICT DO NOTHING
     RETURNING id, product_id, sku, size_label, color_label, measurement_mode, measurement_guide_id,
               measurement_unit, measurements, rental_price_minor, security_deposit_minor, currency,
               pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
               turnaround_minutes, status, created_at, updated_at`,
    [variantId, input.tenantId, input.productId, sku, input.request.size_label, input.request.color_label,
      JSON.stringify(measurements), input.request.measurement_unit, input.request.measurement_mode, measurementGuideId,
      input.rentalPriceMinor, input.securityDepositMinor, input.request.pricing.mode, input.includedDurationMinutes,
      input.extraDayPriceMinor, input.request.pricing.prep_minutes, input.request.pricing.turnaround_minutes],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('That variant SKU is already in use.');
  return row;
}

export async function createPhysicalAssetForVariant(
  client: PoolClient,
  input: { tenantId: string; branchId: string; variantId: string; request: CreatePhysicalAssetRequest },
): Promise<EditablePhysicalAssetRow> {
  const code = input.request.asset_code?.trim() || `AST-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  const result = await client.query<EditablePhysicalAssetRow>(
    `INSERT INTO physical_asset
       (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
        condition_note, measurement_overrides, alteration_note, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'active','ready','at_branch',$5,$6::jsonb,$7,1,now(),now())
     ON CONFLICT DO NOTHING
     RETURNING id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
               condition_note, measurement_overrides, alteration_note, version, created_at, updated_at`,
    [input.tenantId, input.branchId, input.variantId, code, input.request.condition_note,
      JSON.stringify(input.request.measurement_overrides), input.request.alteration_note],
  );
  const row = result.rows[0];
  if (!row) throw new StateConflictError('That physical asset code is already in use.');
  return row;
}

export async function readPhysicalAssetForStateMutation(
  client: PoolClient,
  tenantId: string,
  branchId: string,
  assetId: string,
): Promise<EditablePhysicalAssetRow | null> {
  const result = await client.query<EditablePhysicalAssetRow>(
    `SELECT id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
            condition_note, measurement_overrides, alteration_note, version, created_at, updated_at
       FROM physical_asset
      WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
      LIMIT 1
      FOR UPDATE`,
    [tenantId, branchId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function updatePhysicalAssetState(
  client: PoolClient,
  input: {
    tenantId: string;
    assetId: string;
    expectedVersion: number;
    current: EditablePhysicalAssetRow;
    request: UpdatePhysicalAssetStateRequest;
    forcedReadiness?: EditablePhysicalAssetRow['readiness'];
  },
): Promise<EditablePhysicalAssetRow> {
  const result = await client.query<EditablePhysicalAssetRow>(
    `UPDATE physical_asset
        SET lifecycle_status = $4,
            readiness = $5,
            condition_note = $6,
            version = version + 1,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
                condition_note, measurement_overrides, alteration_note, version, created_at, updated_at`,
    [
      input.tenantId,
      input.assetId,
      input.expectedVersion,
      input.request.lifecycle_status ?? input.current.lifecycle_status,
      input.forcedReadiness ?? input.request.readiness ?? input.current.readiness,
      input.request.condition_note !== undefined
        ? input.request.condition_note
        : input.current.condition_note,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new StateConflictError('The physical asset changed before this update could be applied.');
  }
  return row;
}

export async function readPhysicalAssetsForArchive(
  client: PoolClient,
  tenantId: string,
  productId: string,
): Promise<ArchivePhysicalAssetRow[]> {
  const result = await client.query<ArchivePhysicalAssetRow>(
    `SELECT
       pa.id,
       pa.branch_id,
       pa.variant_id,
       pa.asset_code,
       pa.lifecycle_status,
       pa.readiness,
       pa.custody_kind,
       pa.condition_note,
       pa.measurement_overrides,
       pa.alteration_note,
       pa.version,
       pa.created_at,
       pa.updated_at,
       (
         SELECT count(*)::int
           FROM asset_allocation aa
          WHERE aa.tenant_id = pa.tenant_id
            AND aa.asset_id = pa.id
            AND aa.is_blocking = true
       ) AS blocking_allocation_count,
       (
         SELECT count(*)::int
           FROM maintenance_work_order mwo
          WHERE mwo.tenant_id = pa.tenant_id
            AND mwo.asset_id = pa.id
            AND mwo.status = 'open'
       ) AS open_maintenance_count
     FROM physical_asset pa
     JOIN product_variant pv
       ON pv.tenant_id = pa.tenant_id
      AND pv.id = pa.variant_id
    WHERE pa.tenant_id = $1
      AND pv.product_id = $2
    ORDER BY pa.id ASC
    FOR UPDATE OF pa`,
    [tenantId, productId],
  );
  return result.rows;
}

export async function archiveClothingGraph(
  client: PoolClient,
  input: {
    tenantId: string;
    productId: string;
    retireAssetIds: string[];
  },
): Promise<{
  product: EditableProductRow;
  archivedVariantCount: number;
  retiredAssetCount: number;
}> {
  const product = await client.query<EditableProductRow>(
    `UPDATE product
        SET status = 'archived',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1
        AND id = $2
        AND status <> 'archived'
      RETURNING id, category_id, name, description, status, updated_at`,
    [input.tenantId, input.productId],
  );
  const productRow = product.rows[0];
  if (!productRow) {
    throw new StateConflictError('The clothing item could not be archived. Refresh and try again.');
  }

  const variants = await client.query(
    `UPDATE product_variant
        SET status = 'archived',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE tenant_id = $1
        AND product_id = $2
        AND status <> 'archived'`,
    [input.tenantId, input.productId],
  );

  let retiredAssetCount = 0;
  if (input.retireAssetIds.length > 0) {
    const retired = await client.query(
      `UPDATE physical_asset
          SET lifecycle_status = 'retired',
              readiness = 'unready',
              version = version + 1,
              updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
          AND lifecycle_status = 'active'`,
      [input.tenantId, input.retireAssetIds],
    );
    retiredAssetCount = retired.rowCount ?? 0;
  }

  return {
    product: productRow,
    archivedVariantCount: variants.rowCount ?? 0,
    retiredAssetCount,
  };
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
    entityType: 'category' | 'measurement_guide' | 'product' | 'product_variant' | 'physical_asset';
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

function isPostgresUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
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

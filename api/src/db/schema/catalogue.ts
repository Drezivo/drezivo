import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branch } from './tenancy.js';
import { file } from './files.js';
import { idColumn, timestamps, updatableTimestamps } from './_shared.js';

/**
 * Owns: styles (product), variants (product_variant), individually tracked physical garments
 * (physical_asset), and catalogue imagery. Governed by TRD §2 (Catalogue/assets row);
 * Data-Model §5 "Three identities" (product / variant / physical asset are distinct rows —
 * never model rental stock as a quantity counter on the variant).
 *
 * This module must never write to `asset_allocation` directly — planned unavailability is
 * owned exclusively by the availability module (see db/schema/availability.ts).
 */

export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'archived']);
export const pricingModeEnum = pgEnum('pricing_mode', ['fixed_duration', 'daily']);
export const measurementModeEnum = pgEnum('measurement_mode', ['default_guide', 'custom', 'none']);
export const measurementGuideStatusEnum = pgEnum('measurement_guide_status', ['active', 'archived']);
export const assetLifecycleEnum = pgEnum('asset_lifecycle_status', ['active', 'retired', 'lost']);
export const assetReadinessEnum = pgEnum('asset_readiness', ['ready', 'needs_cleaning', 'needs_repair', 'unready']);
export const assetCustodyKindEnum = pgEnum('asset_custody_kind', ['at_branch', 'with_customer', 'in_transit']);

export const category = pgTable(
  'category',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    visible: boolean('visible').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('category_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('category_tenant_name_ci_key').on(table.tenantId, sql`lower(btrim(${table.name}))`),
    index('category_tenant_visible_order_idx').on(
      table.tenantId,
      table.visible,
      table.displayOrder,
      table.id,
    ),
    check('category_name_not_blank', sql`length(btrim(${table.name})) BETWEEN 1 AND 120`),
    check('category_display_order_nonnegative', sql`${table.displayOrder} >= 0`),
  ],
);

export const product = pgTable(
  'product',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    categoryId: uuid('category_id').references(() => category.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: productStatusEnum('status').notNull().default('draft'),
    ...updatableTimestamps,
  },
  (table) => [
    unique('product_tenant_id_id_key').on(table.tenantId, table.id),
    index('product_tenant_status_idx').on(table.tenantId, table.status),
    index('product_tenant_category_status_created_idx').on(
      table.tenantId,
      table.categoryId,
      table.status,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('product_tenant_code_ci_key').on(table.tenantId, sql`lower(${table.code})`),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [category.tenantId, category.id],
      name: 'product_category_same_tenant_fk',
    }).onDelete('restrict'),
    check('product_name_not_blank', sql`length(btrim(${table.name})) BETWEEN 1 AND 200`),
  ],
);

export const measurementGuide = pgTable(
  'measurement_guide',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    fileId: uuid('file_id').notNull(),
    name: text('name').notNull(),
    status: measurementGuideStatusEnum('status').notNull().default('active'),
    isDefault: boolean('is_default').notNull().default(false),
    ...updatableTimestamps,
  },
  (table) => [
    unique('measurement_guide_tenant_id_id_key').on(table.tenantId, table.id),
    index('measurement_guide_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
    foreignKey({
      columns: [table.tenantId, table.fileId],
      foreignColumns: [file.tenantId, file.id],
      name: 'measurement_guide_file_fk',
    }).onDelete('restrict'),
    check('measurement_guide_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * Units are cm/in; `measurements` is a validated numeric map at the Zod boundary, not free-form
 * JSON from the client. `measurementMode` makes an empty map unambiguous: it can mean either the
 * selected reusable guide or intentionally no measurements, rather than silently overloading `{}`.
 */
export const productVariant = pgTable(
  'product_variant',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    sku: text('sku').notNull(),
    sizeLabel: text('size_label').notNull(),
    colorLabel: text('color_label').notNull(),
    measurements: jsonb('measurements').$type<Record<string, number>>().notNull().default({}),
    measurementUnit: text('measurement_unit').notNull().default('cm'),
    measurementMode: measurementModeEnum('measurement_mode').notNull().default('none'),
    measurementGuideId: uuid('measurement_guide_id'),
    rentalPriceMinor: integer('rental_price_minor').notNull(),
    securityDepositMinor: integer('security_deposit_minor').notNull().default(0),
    currency: text('currency').notNull().default('PHP'),
    pricingMode: pricingModeEnum('pricing_mode').notNull().default('fixed_duration'),
    includedDurationMinutes: integer('included_duration_minutes').notNull(),
    extraDayPriceMinor: integer('extra_day_price_minor').notNull().default(0),
    prepMinutes: integer('prep_minutes').notNull().default(0),
    turnaroundMinutes: integer('turnaround_minutes').notNull().default(0),
    status: productStatusEnum('status').notNull().default('draft'),
    ...updatableTimestamps,
  },
  (table) => [
    unique('product_variant_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('product_variant_tenant_sku_key').on(table.tenantId, table.sku),
    uniqueIndex('product_variant_tenant_sku_ci_key').on(table.tenantId, sql`lower(btrim(${table.sku}))`),
    index('product_variant_tenant_product_size_idx').on(
      table.tenantId,
      table.productId,
      sql`lower(${table.sizeLabel})`,
      table.status,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'product_variant_product_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.measurementGuideId],
      foreignColumns: [measurementGuide.tenantId, measurementGuide.id],
      name: 'product_variant_measurement_guide_fk',
    }).onDelete('restrict'),
    check('product_variant_sku_not_blank', sql`length(btrim(${table.sku})) BETWEEN 1 AND 120`),
    check('product_variant_size_not_blank', sql`length(btrim(${table.sizeLabel})) BETWEEN 1 AND 40`),
    check('product_variant_color_not_blank', sql`length(btrim(${table.colorLabel})) BETWEEN 1 AND 80`),
  ],
);

/** `branch_id` is the administrative home/holding branch; actual custody can be with a customer or in transit (see custody_kind). */
export const physicalAsset = pgTable(
  'physical_asset',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariant.id),
    assetCode: text('asset_code').notNull(),
    lifecycleStatus: assetLifecycleEnum('lifecycle_status').notNull().default('active'),
    readiness: assetReadinessEnum('readiness').notNull().default('ready'),
    custodyKind: assetCustodyKindEnum('custody_kind').notNull().default('at_branch'),
    conditionNote: text('condition_note'),
    measurementOverrides: jsonb('measurement_overrides').$type<Record<string, number>>(),
    alterationNote: text('alteration_note'),
    // `version` guards concurrent readiness/custody writes with a conditional UPDATE — see
    // the reservations module's confirm handler for the same optimistic-concurrency pattern.
    version: integer('version').notNull().default(1),
    ...updatableTimestamps,
  },
  (table) => [
    unique('physical_asset_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('physical_asset_tenant_code_key').on(table.tenantId, table.assetCode),
    uniqueIndex('physical_asset_tenant_code_ci_key').on(
      table.tenantId,
      sql`lower(btrim(${table.assetCode}))`,
    ),
    index('physical_asset_tenant_variant_state_idx').on(
      table.tenantId,
      table.variantId,
      table.lifecycleStatus,
      table.readiness,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branch.tenantId, branch.id],
      name: 'physical_asset_branch_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariant.tenantId, productVariant.id],
      name: 'physical_asset_variant_same_tenant_fk',
    }).onDelete('restrict'),
    check('physical_asset_code_not_blank', sql`length(btrim(${table.assetCode})) BETWEEN 1 AND 120`),
    check('physical_asset_version_positive', sql`${table.version} > 0`),
  ],
);

export const productImage = pgTable(
  'product_image',
  {
    ...idColumn,
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => file.id),
    displayOrder: smallint('display_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('product_image_product_order_key').on(table.productId, table.displayOrder),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'product_image_product_same_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.fileId],
      foreignColumns: [file.tenantId, file.id],
      name: 'product_image_file_same_tenant_fk',
    }).onDelete('restrict'),
  ],
);

import type { PermissionCode } from '@drezivo/contracts';

import { withTenantTransaction } from '../../../src/db/client.js';
import type { StaffContext } from '../../../src/middleware/staff-command.js';
import { createTestMembership, createTestTenant } from './factories.js';

/**
 * One realistic storefront workspace: default branch, draft storefront with the empty bootstrap
 * policy, one active gown in two sizes with ready garments, one image, and an online payment method
 * enabled for the storefront. Import dynamically, after the test pins DATABASE_URL.
 */
export interface StorefrontWorkspace {
  tenantId: string;
  clerkOrgId: string;
  branchId: string;
  storefrontId: string;
  slug: string;
  productId: string;
  variantIds: { m: string; l: string };
  imageFileId: string;
  paymentMethodId: string;
  owner: StaffContext;
  frontDesk: StaffContext;
}

const OWNER_PERMISSIONS: PermissionCode[] = ['assets.manage', 'reservations.manage', 'payments.manage', 'policies.manage'];
const FRONT_DESK_PERMISSIONS: PermissionCode[] = ['reservations.manage'];

export async function createStorefrontWorkspace(label: string): Promise<StorefrontWorkspace> {
  const tenant = await createTestTenant({ clerkOrgId: `org_${label}` });
  const ownerPrincipal = `user_${label}_owner`;
  const deskPrincipal = `user_${label}_desk`;
  const ownerMembership = await createTestMembership(tenant.id, ownerPrincipal, 'owner');
  const deskMembership = await createTestMembership(tenant.id, deskPrincipal, 'frontdesk');
  const slug = `shop-${label}`.replace(/[^a-z0-9-]/g, '-').slice(0, 40);

  const seeded = await withTenantTransaction(tenant.id, ownerPrincipal, async (client) => {
    const one = async (sql: string, params: unknown[]): Promise<string> => {
      const result = await client.query<{ id: string }>(sql, params);
      const id = result.rows[0]?.id;
      if (!id) throw new Error(`fixture insert returned no row: ${sql.slice(0, 40)}`);
      return id;
    };
    const branchId = await one(
      `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
       VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
      [tenant.id],
    );
    await client.query(
      `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
       SELECT $1, id, 'active', now(), now() + interval '30 days'
         FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
      [tenant.id],
    );
    const storefrontId = await one(
      `INSERT INTO storefront (tenant_id, branch_id, slug, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
      [tenant.id, branchId, slug],
    );
    await client.query(
      `INSERT INTO policy_snapshot (tenant_id, storefront_id, version, rental_rules, deposit_rules,
         cancellation_rules, delivery_rules, privacy_notice, effective_at)
       VALUES ($1, $2, 1, '{}', '{}', '{}', '{}', '', now() - interval '1 minute')`,
      [tenant.id, storefrontId],
    );
    const categoryId = await one(
      `INSERT INTO category (tenant_id, name, status, display_order) VALUES ($1, 'Gowns', 'active', 1) RETURNING id`,
      [tenant.id],
    );
    const productId = await one(
      `INSERT INTO product (tenant_id, category_id, code, name, description, status)
       VALUES ($1, $2, 'GWN-1', 'Emerald Gown', 'Floor-length satin gown.', 'active') RETURNING id`,
      [tenant.id, categoryId],
    );
    const variant = async (size: string, price: number): Promise<string> =>
      one(
        `INSERT INTO product_variant (tenant_id, product_id, sku, size_label, color_label, measurements,
           measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor, currency,
           pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, $3, $4, 'Emerald', '{"bust": 86, "waist": 66}', 'cm', 'custom', $5, 200000, 'PHP',
                 'fixed_duration', 4320, 50000, 0, 1440, 'active') RETURNING id`,
        [tenant.id, productId, `GWN-1-${size}`, size, price],
      );
    const m = await variant('M', 180000);
    const l = await variant('L', 190000);
    await client.query(
      `INSERT INTO physical_asset (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
       VALUES ($1, $2, $3, 'GWN-1-M-A', 'active', 'ready', 'at_branch'),
              ($1, $2, $4, 'GWN-1-L-A', 'active', 'ready', 'at_branch')`,
      [tenant.id, branchId, m, l],
    );
    const imageFileId = await one(
      `INSERT INTO file_object (tenant_id, purpose, storage_key, version_id, mime_type, byte_size,
         lifecycle_status, is_private, upload_expires_at, frozen_at)
       VALUES ($1, 'catalogue_image', $2, 'v1', 'image/png', 512, 'accepted', true, now(), now()) RETURNING id`,
      [tenant.id, `tenant-files/${tenant.id}/gown/source`],
    );
    await client.query(
      `INSERT INTO product_image (tenant_id, product_id, file_id, display_order) VALUES ($1, $2, $3, 0)`,
      [tenant.id, productId, imageFileId],
    );
    const paymentMethodId = await one(
      `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, storefront_enabled)
       VALUES ($1, 'Bank transfer', 'manual_transfer',
               '{"account_name": "Luna Rentals", "account_number": "001234567890"}', true, true) RETURNING id`,
      [tenant.id],
    );
    await client.query(
      `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
       VALUES ($1, $2, $3, $4::jsonb), ($1, $2, $5, $6::jsonb)`,
      [tenant.id, branchId, ownerMembership, JSON.stringify(OWNER_PERMISSIONS), deskMembership, JSON.stringify(FRONT_DESK_PERMISSIONS)],
    );
    return { branchId, storefrontId, productId, variantIds: { m, l }, imageFileId, paymentMethodId };
  });

  const staff = (membershipId: string, principalId: string, permissionCodes: PermissionCode[]): StaffContext => ({
    tenantId: tenant.id,
    branchId: seeded.branchId,
    membershipId,
    principalId,
    permissionCodes,
    effectiveTenantStatus: 'active',
    requestId: `req-${label}`,
  });

  return {
    tenantId: tenant.id,
    clerkOrgId: tenant.clerkOrgId,
    slug,
    ...seeded,
    owner: staff(ownerMembership, ownerPrincipal, OWNER_PERMISSIONS),
    frontDesk: staff(deskMembership, deskPrincipal, FRONT_DESK_PERMISSIONS),
  };
}

/** Accepted storefront image owned by the workspace, as the upload flow would leave it. */
export async function createStorefrontAsset(tenantId: string, principalId: string, name: string): Promise<string> {
  return withTenantTransaction(tenantId, principalId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO file_object (tenant_id, purpose, storage_key, version_id, mime_type, byte_size,
         lifecycle_status, is_private, upload_expires_at, frozen_at)
       VALUES ($1, 'storefront_asset', $2, 'v1', 'image/webp', 2048, 'accepted', true, now(), now()) RETURNING id`,
      [tenantId, `tenant-files/${tenantId}/${name}/source`],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('storefront asset insert returned no row');
    return id;
  });
}

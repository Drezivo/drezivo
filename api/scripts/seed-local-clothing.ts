import { randomUUID } from 'node:crypto';

import {
  permissionCode,
  tenantStatus,
  type PermissionCode,
  type TenantStatus,
} from '@drezivo/contracts';

import {
  LOCAL_CLOTHING_SEED,
  buildLocalClothingRequest,
  canRunLocalClothingSeed,
  parseLocalSeedArguments,
} from './seed-local-clothing-data.js';

class LocalSeedError extends Error {}

const usage = `Seed 20 synthetic draft clothing styles into a local Drezivo workspace.

Usage:
  npm run seed:clothing:local -- --storefront-slug <slug> [--apply]

Without --apply, this command prints a preview and makes no changes. With --apply, it creates
missing draft styles only; existing LOCAL-SEED-* codes are left untouched. Photos are not
created or uploaded, so images can be attached later in the app.

The command only accepts NODE_ENV=development and the local Compose drezivo database/admin role.
`;

interface TargetRow {
  tenant_id: string;
  tenant_status: string;
  branch_id: string;
  branch_name: string;
  branch_status: string;
}

interface MembershipRow {
  membership_id: string;
  principal_id: string;
  permission_codes: unknown;
  role: string;
}

function getEffectiveTenantStatus(tenant: TenantStatus, subscription: string): TenantStatus {
  if (tenant === 'cancelled' || subscription === 'cancelled') return 'cancelled';
  if (tenant === 'restricted' || subscription === 'restricted') return 'restricted';
  if (['active', 'trialing', 'past_due'].includes(subscription)) return 'active';
  throw new LocalSeedError('The selected workspace has an unknown subscription state.');
}

function parsePermissionCodes(value: unknown): PermissionCode[] {
  if (!Array.isArray(value)) {
    throw new LocalSeedError(
      'The selected branch has an invalid permission grant; no changes were made.',
    );
  }
  return value.map((code) => permissionCode.parse(code));
}

async function main(): Promise<void> {
  const args = parseLocalSeedArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const { config } = await import('../src/config/index.js');
  if (!canRunLocalClothingSeed(config.NODE_ENV, config.DATABASE_URL)) {
    throw new LocalSeedError(
      'Refusing to run: this seeder only supports a loopback database in NODE_ENV=development.',
    );
  }

  const [{ pool, closePool }, catalogue] = await Promise.all([
    import('../src/db/client.js'),
    import('../src/modules/catalogue/catalogue.service.js'),
  ]);

  try {
    const localRole = await pool.query<{
      database_name: string;
      role_name: string;
      is_superuser: boolean;
    }>(
      `SELECT current_database() AS database_name, current_user AS role_name, r.rolsuper AS is_superuser
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    );
    const role = localRole.rows[0];
    if (
      !role ||
      role.database_name !== 'drezivo' ||
      role.role_name !== 'drezivo' ||
      !role.is_superuser
    ) {
      throw new LocalSeedError(
        'Refusing to run: connect with the local Compose drezivo admin role to the drezivo database.',
      );
    }

    const targetResult = await pool.query<TargetRow>(
      `SELECT t.id AS tenant_id, t.status AS tenant_status,
              b.id AS branch_id, b.name AS branch_name, b.status AS branch_status
         FROM storefront s
         JOIN tenant t ON t.id = s.tenant_id
         JOIN branch b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
        WHERE s.slug = $1
        LIMIT 1`,
      [args.storefrontSlug],
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw new LocalSeedError(`No local storefront was found for slug "${args.storefrontSlug}".`);
    }
    if (target.branch_status !== 'active') {
      throw new LocalSeedError('The storefront branch is not active; no changes were made.');
    }

    const subscriptionResult = await pool.query<{ status: string }>(
      `SELECT status
         FROM subscription
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [target.tenant_id],
    );
    const subscription = subscriptionResult.rows[0]?.status;
    if (!subscription)
      throw new LocalSeedError(
        'The selected workspace has no subscription state; no changes were made.',
      );

    const effectiveTenantStatus = getEffectiveTenantStatus(
      tenantStatus.parse(target.tenant_status),
      subscription,
    );
    if (effectiveTenantStatus !== 'active') {
      throw new LocalSeedError(
        `The selected workspace is ${effectiveTenantStatus}; no changes were made.`,
      );
    }

    const membershipsResult = await pool.query<MembershipRow>(
      `SELECT m.id AS membership_id, m.clerk_user_id AS principal_id,
              m.role, bm.permission_codes
         FROM membership m
         JOIN branch_membership bm
           ON bm.membership_id = m.id AND bm.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1
          AND m.status = 'active'
          AND bm.branch_id = $2
        ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at ASC, m.id ASC`,
      [target.tenant_id, target.branch_id],
    );

    const authorizedMembership = membershipsResult.rows
      .map((row) => ({ ...row, permissionCodes: parsePermissionCodes(row.permission_codes) }))
      .find((row) => row.permissionCodes.includes('assets.manage'));
    if (!authorizedMembership) {
      throw new LocalSeedError(
        'No active member with clothing-management access was found for this branch.',
      );
    }

    const context = {
      tenantId: target.tenant_id,
      branchId: target.branch_id,
      membershipId: authorizedMembership.membership_id,
      principalId: authorizedMembership.principal_id,
      permissionCodes: authorizedMembership.permissionCodes,
      effectiveTenantStatus,
    };
    const [categoryList, existingCodes] = await Promise.all([
      catalogue.getCatalogueCategories(context),
      (async () => {
        const { withTenantTransaction } = await import('../src/db/client.js');
        return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
          const result = await client.query<{ code: string }>(
            `SELECT code FROM product WHERE tenant_id = $1 AND code = ANY($2::text[])`,
            [context.tenantId, LOCAL_CLOTHING_SEED.map((item) => item.code)],
          );
          return new Set(result.rows.map((row) => row.code));
        });
      })(),
    ]);

    const activeCategoryByName = new Map(
      categoryList.items
        .filter((category) => category.status === 'active')
        .map((category) => [category.name.trim().toLowerCase(), category]),
    );
    const missingCategories = Array.from(
      new Set(LOCAL_CLOTHING_SEED.map((item) => item.categoryName)),
    ).filter((name) => !activeCategoryByName.has(name.toLowerCase()));
    if (missingCategories.length > 0) {
      throw new LocalSeedError(
        `Required active clothing categories are missing: ${missingCategories.join(', ')}. Apply migrations and add or activate these categories in the app first.`,
      );
    }

    const itemsToCreate = LOCAL_CLOTHING_SEED.filter((item) => !existingCodes.has(item.code));
    process.stdout.write(
      `Target: ${args.storefrontSlug} / ${target.branch_name}\n` +
        `Plan: ${LOCAL_CLOTHING_SEED.length} draft clothing styles; ${itemsToCreate.length} new, ${LOCAL_CLOTHING_SEED.length - itemsToCreate.length} already present and will be skipped.\n` +
        `Photos: none (attach them later in the app).\n`,
    );
    for (const item of LOCAL_CLOTHING_SEED) {
      const exists = existingCodes.has(item.code);
      process.stdout.write(
        `${exists ? 'SKIP' : args.apply ? 'CREATE' : 'PREVIEW'}  ${item.code}  ${item.name}  [${item.categoryName}]\n`,
      );
    }

    if (!args.apply) {
      process.stdout.write('\nPreview only. Add --apply to create the missing draft styles.\n');
      return;
    }

    let created = 0;
    for (const item of itemsToCreate) {
      const category = activeCategoryByName.get(item.categoryName.toLowerCase());
      if (!category)
        throw new LocalSeedError(`Category ${item.categoryName} could not be resolved.`);
      const response = await catalogue.createClothing({
        ...context,
        requestId: `local-clothing-seed-${randomUUID()}`,
        idempotencyKey: `local-clothing-seed-${item.code.toLowerCase()}`,
        request: buildLocalClothingRequest(item, category.id),
      });
      if (!response.body.success) {
        throw new LocalSeedError(`${item.code} was not created: ${response.body.error.message}`);
      }
      created += 1;
      process.stdout.write(`Created ${item.code}.\n`);
    }
    process.stdout.write(
      `\nDone: created ${created} draft styles; ${existingCodes.size} seed codes were already present.\n`,
    );
  } finally {
    await closePool();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof LocalSeedError
      ? error.message
      : 'Seed failed. Check the local database connection and migration state; connection details are not printed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

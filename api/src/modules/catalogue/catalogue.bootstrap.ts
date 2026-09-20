import type { PoolClient } from 'pg';

export const DEFAULT_CATEGORIES = [
  { name: 'Gowns', displayOrder: 10 },
  { name: 'Dresses', displayOrder: 20 },
  { name: 'Filipiniana', displayOrder: 30 },
  { name: 'Barong', displayOrder: 40 },
  { name: 'Costumes', displayOrder: 50 },
  { name: 'Formal Wear', displayOrder: 60 },
] as const;

/**
 * Catalogue-owned tenant bootstrap hook. The caller must already be inside the winning tenant
 * bootstrap transaction with tenant RLS context established. A new workspace is incomplete if
 * its starter catalogue categories cannot be created, so any failure aborts the whole bootstrap.
 */
export async function seedDefaultCatalogueCategories(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  const result = await client.query<{ name: string }>(
    `INSERT INTO category (tenant_id, name, status, display_order)
     VALUES
       ($1, 'Gowns', 'active', 10),
       ($1, 'Dresses', 'active', 20),
       ($1, 'Filipiniana', 'active', 30),
       ($1, 'Barong', 'active', 40),
       ($1, 'Costumes', 'active', 50),
       ($1, 'Formal Wear', 'active', 60)
     RETURNING name`,
    [tenantId],
  );

  if (result.rowCount !== DEFAULT_CATEGORIES.length) {
    throw new Error('Tenant bootstrap did not create the complete default category set.');
  }
}

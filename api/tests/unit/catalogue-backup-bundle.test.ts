import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createCatalogueBackup,
  parseCatalogueBackup,
  type BackupRows,
} from '../../src/modules/catalogue-import/catalogue-backup.bundle.js';

const emptyRows: BackupRows = {
  categories: [], products: [], variants: [], pieces: [], guides: [], images: [],
};

describe('catalogue backup bundle', () => {
  it('round-trips stable CSV data and escapes spreadsheet formulas without changing restored text', () => {
    const rows: BackupRows = {
      ...emptyRows,
      categories: [{
        id: '00000000-0000-4000-8000-000000000001',
        name: '=IMPORTXML("https://example.test", "//x")',
        status: 'active',
        display_order: '3',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      }],
    };
    const bytes = createCatalogueBackup({
      manifest: {
        format: 'drezivo-inventory-backup',
        version: 1,
        tenant_id: '00000000-0000-4000-8000-000000000002',
        branch_id: '00000000-0000-4000-8000-000000000003',
        exported_at: '2026-10-01T00:00:00.000Z',
        counts: { categories: 1, products: 0, variants: 0, pieces: 0, measurement_guides: 0, product_images: 0 },
      },
      rows,
      media: [],
    });

    const parsed = parseCatalogueBackup(bytes);
    expect(parsed.rows.categories).toEqual(rows.categories);
    expect(parsed.manifest.branch_id).toBe('00000000-0000-4000-8000-000000000003');
  });

  it('rejects malformed archives before any restore can be attempted', () => {
    expect(() => parseCatalogueBackup(new Uint8Array([1, 2, 3]))).toThrow(/ZIP is empty or exceeds/);
  });

  it('rejects duplicate or mismatched media metadata', () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff]);
    const media = {
      path: 'media/product-images/00000000-0000-4000-8000-000000000010.jpg',
      contentType: 'image/jpeg' as const,
      sha256: createHash('sha256').update(image).digest('hex'),
      bytes: image,
    };
    const make = () => createCatalogueBackup({
      manifest: {
        format: 'drezivo-inventory-backup', version: 1,
        tenant_id: '00000000-0000-4000-8000-000000000002',
        branch_id: '00000000-0000-4000-8000-000000000003',
        exported_at: '2026-10-01T00:00:00.000Z',
        counts: { categories: 0, products: 0, variants: 0, pieces: 0, measurement_guides: 0, product_images: 0 },
      },
      rows: emptyRows,
      media: [media, media],
    });

    expect(make).toThrow(/media metadata is invalid/);
  });

  it('preserves private media bytes and stable product-image relationships in the archive', () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imageId = '00000000-0000-4000-8000-000000000010';
    const productId = '00000000-0000-4000-8000-000000000011';
    const path = `media/product-images/${imageId}.png`;
    const rows: BackupRows = {
      ...emptyRows,
      products: [{ id: productId, category_id: '', code: 'GOWN-1', name: 'Gown' }],
      images: [{ id: imageId, product_id: productId, display_order: '0', created_at: '2026-10-01T00:00:00.000Z', media_path: path, media_content_type: 'image/png', media_sha256: createHash('sha256').update(imageBytes).digest('hex') }],
    };
    const backup = createCatalogueBackup({
      manifest: {
        format: 'drezivo-inventory-backup', version: 1,
        tenant_id: '00000000-0000-4000-8000-000000000002',
        branch_id: '00000000-0000-4000-8000-000000000003',
        exported_at: '2026-10-01T00:00:00.000Z',
        counts: { categories: 0, products: 1, variants: 0, pieces: 0, measurement_guides: 0, product_images: 1 },
      },
      rows,
      media: [{ path, contentType: 'image/png', sha256: createHash('sha256').update(imageBytes).digest('hex'), bytes: imageBytes }],
    });

    expect(parseCatalogueBackup(backup).media.get(path)?.bytes).toEqual(imageBytes);
  });
});

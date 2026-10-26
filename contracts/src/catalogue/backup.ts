import { z } from 'zod';

import { branchId, fileObjectId } from '../common/ids';
import { isoInstant } from '../common/time';

export const catalogueBackupJobId = z.string().uuid();

export const catalogueBackupExportStatus = z.object({
  job_id: catalogueBackupJobId,
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  available_at: isoInstant.nullable(),
  expires_at: isoInstant.nullable(),
});
export type CatalogueBackupExportStatus = z.infer<typeof catalogueBackupExportStatus>;

export const catalogueBackupExportStartResponse = z.object({
  job: catalogueBackupExportStatus,
});

export const catalogueBackupImportPreviewRequest = z.object({
  file_id: fileObjectId,
}).strict();
export type CatalogueBackupImportPreviewRequest = z.infer<typeof catalogueBackupImportPreviewRequest>;

export const catalogueBackupPreviewConflict = z.object({
  entity: z.enum(['category', 'product', 'variant', 'piece', 'measurement_guide', 'image']),
  id: z.string().uuid(),
  reason: z.string().max(160),
});

export const catalogueBackupImportPreview = z.object({
  import_id: z.string().uuid(),
  branch_id: branchId,
  counts: z.object({
    categories_to_create: z.number().int().nonnegative(),
    products_to_create: z.number().int().nonnegative(),
    variants_to_create: z.number().int().nonnegative(),
    pieces_to_create: z.number().int().nonnegative(),
    guides_to_create: z.number().int().nonnegative(),
    images_to_restore: z.number().int().nonnegative(),
  }).strict(),
  conflicts: z.array(catalogueBackupPreviewConflict).max(100),
  conflicts_truncated: z.boolean(),
  expires_at: isoInstant,
}).strict();
export type CatalogueBackupImportPreview = z.infer<typeof catalogueBackupImportPreview>;

export const catalogueBackupImportCommitRequest = z.object({}).strict();
export const catalogueBackupImportCommitResponse = z.object({
  import_id: z.string().uuid(),
  status: z.literal('committed'),
  created: catalogueBackupImportPreview.shape.counts,
}).strict();
export type CatalogueBackupImportCommitResponse = z.infer<typeof catalogueBackupImportCommitResponse>;


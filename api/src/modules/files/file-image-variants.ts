import type { PoolClient } from 'pg';

import type { FileObjectRow } from './files.repository.js';
import { supportsImageVariants } from './files.storage-keys.js';

export const FILE_IMAGE_VARIANTS_EVENT_TYPE = 'file.image_variants.generate_requested';

/** Queue image derivatives atomically with file acceptance; evidence and PDFs never qualify. */
export async function enqueueAcceptedFileImageVariants(
  client: PoolClient,
  file: FileObjectRow,
): Promise<void> {
  if (!supportsImageVariants(file.purpose, file.mime_type)) return;
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      file.tenant_id,
      `file-image-variants:${file.id}`,
      FILE_IMAGE_VARIANTS_EVENT_TYPE,
      JSON.stringify({ file_id: file.id }),
    ],
  );
}

-- Product archive may temporarily retire safe physical pieces. Track that provenance so restore can
-- reactivate only pieces retired by the product archive, never pieces staff retired intentionally.
ALTER TABLE physical_asset
  ADD COLUMN retired_by_product_archive boolean NOT NULL DEFAULT false;

ALTER TABLE physical_asset
  ADD CONSTRAINT physical_asset_archive_retirement_consistency
  CHECK (NOT retired_by_product_archive OR lifecycle_status = 'retired');

-- Backfill the most recent pre-fix archive transaction narrowly. The old archive audit stored only
-- the number of auto-retired pieces, not their ids. Auto-retirement updated those rows immediately
-- before the archive audit event, so take at most that recorded count from the 30-second window.
WITH latest_archive AS (
  SELECT tenant_id,
         entity_id AS product_id,
         occurred_at,
         COALESCE((redacted_summary ->> 'retired_asset_count')::integer, 0) AS retired_asset_count,
         row_number() OVER (
           PARTITION BY tenant_id, entity_id
           ORDER BY occurred_at DESC, id DESC
         ) AS archive_rank
    FROM audit_event
   WHERE action = 'catalogue.clothing.archived'
     AND entity_type = 'product'
     AND entity_id IS NOT NULL
),
archive_candidates AS (
  SELECT pa.id,
         a.tenant_id,
         a.product_id,
         a.occurred_at AS archived_at,
         a.retired_asset_count,
         row_number() OVER (
           PARTITION BY a.tenant_id, a.product_id
           ORDER BY pa.updated_at DESC, pa.id DESC
         ) AS candidate_rank
    FROM latest_archive a
    JOIN product_variant pv
      ON pv.tenant_id = a.tenant_id
     AND pv.product_id = a.product_id
    JOIN physical_asset pa
      ON pa.tenant_id = pv.tenant_id
     AND pa.variant_id = pv.id
   WHERE a.archive_rank = 1
     AND a.retired_asset_count > 0
     AND pa.lifecycle_status = 'retired'
     AND pa.readiness = 'unready'
     AND pa.custody_kind = 'at_branch'
     AND pa.updated_at <= a.occurred_at
     AND pa.updated_at >= a.occurred_at - interval '30 seconds'
)
UPDATE physical_asset pa
   SET retired_by_product_archive = true
  FROM archive_candidates c
 WHERE pa.id = c.id
   AND pa.tenant_id = c.tenant_id
   AND c.candidate_rank <= c.retired_asset_count;

-- If that archived product had already been restored before this migration, complete the missing
-- half of the old restore operation now. Products still archived keep the marker for normal restore.
WITH latest_archive AS (
  SELECT tenant_id,
         entity_id AS product_id,
         occurred_at,
         row_number() OVER (
           PARTITION BY tenant_id, entity_id
           ORDER BY occurred_at DESC, id DESC
         ) AS archive_rank
    FROM audit_event
   WHERE action = 'catalogue.clothing.archived'
     AND entity_type = 'product'
     AND entity_id IS NOT NULL
),
latest_restore AS (
  SELECT tenant_id,
         entity_id AS product_id,
         max(occurred_at) AS restored_at
    FROM audit_event
   WHERE action = 'catalogue.clothing.restored_to_draft'
     AND entity_type = 'product'
     AND entity_id IS NOT NULL
   GROUP BY tenant_id, entity_id
)
UPDATE physical_asset pa
   SET lifecycle_status = 'active',
       readiness = 'ready',
       retired_by_product_archive = false,
       version = version + 1,
       updated_at = GREATEST(clock_timestamp(), pa.updated_at + interval '1 millisecond')
  FROM product_variant pv
  JOIN latest_archive a
    ON a.tenant_id = pv.tenant_id
   AND a.product_id = pv.product_id
   AND a.archive_rank = 1
  JOIN latest_restore r
    ON r.tenant_id = a.tenant_id
   AND r.product_id = a.product_id
 WHERE pa.tenant_id = pv.tenant_id
   AND pa.variant_id = pv.id
   AND pa.retired_by_product_archive = true
   AND r.restored_at > a.occurred_at;

-- CLT-061: enable the scalar equality operator class needed by the tenant-aware GIN search index.
-- Keeping extension enablement separate makes the following index migration straightforward and
-- idempotent on environments that already provide btree_gin.
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- The sizing mode is part of the product state, but catalogue reads do not filter or sort on it.
-- Keeping this tenant-prefix index lets PostgreSQL choose a bitmap scan for keyset list queries
-- instead of the dedicated name/created sort indexes. The sizing-mode constraints remain the
-- authoritative integrity boundary; remove only the redundant access path.
DROP INDEX IF EXISTS product_tenant_sizing_mode_idx;

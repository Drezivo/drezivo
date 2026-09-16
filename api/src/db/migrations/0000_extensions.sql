-- Invariant: the availability module's capacity-claim correctness (0003) depends on a GiST
-- exclusion constraint that mixes an equality-comparable scalar (asset_id, tenant_id) with a
-- range overlap (period). Native GiST only understands range/geometric operator classes; without
-- btree_gist's operator class registrations for uuid/boolean equality, `EXCLUDE USING gist
-- (asset_id WITH =, ...)` cannot be created at all. This cannot be worked around in application
-- code: there is no way to make "check then insert" atomic under concurrent requests without a
-- database-level constraint (TRD §5, Data-Model §5).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Used by _shared.ts idColumn default and every table's primary key default.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

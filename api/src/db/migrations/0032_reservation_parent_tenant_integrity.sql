-- RSV-002 follow-up — parent tenant integrity for reservation dependencies.
--
-- A reservation can only be as tenant-safe as the storefront and policy rows it references.
-- These composite FKs prevent privileged/admin paths from constructing a storefront whose branch
-- belongs to another tenant or a policy snapshot whose storefront belongs to another tenant.

ALTER TABLE storefront
  ADD CONSTRAINT storefront_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE policy_snapshot
  ADD CONSTRAINT policy_snapshot_storefront_same_tenant_fk
    FOREIGN KEY (tenant_id, storefront_id)
    REFERENCES storefront (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE storefront VALIDATE CONSTRAINT storefront_branch_same_tenant_fk;
ALTER TABLE policy_snapshot VALIDATE CONSTRAINT policy_snapshot_storefront_same_tenant_fk;

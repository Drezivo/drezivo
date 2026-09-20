-- Category visibility is an explicit lifecycle projection rather than a boolean flag.
-- `active` means the category may be offered in customer-facing catalogue navigation;
-- `inactive` keeps the category and all historical product references intact while hiding it
-- from new public discovery. Existing workspaces receive only missing starter categories;
-- an existing category with the same name is never renamed, duplicated, or reactivated.

ALTER TABLE category
  ADD COLUMN status text;

UPDATE category
   SET status = CASE WHEN visible THEN 'active' ELSE 'inactive' END
 WHERE status IS NULL;

ALTER TABLE category
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT category_status_check CHECK (status IN ('active', 'inactive'));

DROP INDEX IF EXISTS category_tenant_visible_order_idx;
CREATE INDEX category_tenant_status_order_idx
  ON category (tenant_id, status, display_order, id);

-- `status` is now the sole category visibility authority. Remove the old boolean so future
-- writers cannot accidentally maintain two contradictory fields.
ALTER TABLE category DROP COLUMN visible;

-- One-time backfill for workspaces provisioned before category defaults became part of tenant
-- bootstrap. Preserve any existing case-insensitive name match and its current status/order.
INSERT INTO category (tenant_id, name, status, display_order)
SELECT
  t.id,
  defaults.name,
  'active',
  defaults.display_order
FROM tenant t
CROSS JOIN (
  VALUES
    ('Gowns', 10),
    ('Dresses', 20),
    ('Filipiniana', 30),
    ('Barong', 40),
    ('Costumes', 50),
    ('Formal Wear', 60)
) AS defaults(name, display_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM category c
  WHERE c.tenant_id = t.id
    AND lower(btrim(c.name)) = lower(defaults.name)
);

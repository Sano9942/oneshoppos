-- Read-only: SanoPOS stock for the iPOS catch-up (ipos_catchup.py input).
-- Same toys a new stock count snapshots: live (not deleted), status active.
-- Replace tenant_onetoystore with the local shop's schema when trying it locally.
SELECT COALESCE(json_agg(t ORDER BY t.sku), '[]'::json) AS rows
  FROM (
    SELECT p.sku, p.name, COALESCE(os.quantity, 0)::numeric AS qty, p.price::numeric AS price
      FROM tenant_onetoystore.products p
      LEFT JOIN tenant_onetoystore.outlet_stock os
        ON os.product_id = p.id
       AND os.outlet_id = (SELECT id FROM tenant_onetoystore.outlets WHERE name = 'Packages Mall')
     WHERE p.deleted_at IS NULL AND p.status = 'active'
  ) t;

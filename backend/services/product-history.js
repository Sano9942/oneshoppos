// Product History tab (One Toy Store pilot, Phase B step 7; owner decisions
// 2026-09-27, docs/onetoystore-pilot/PROGRESS.md).
//
// Stock ledger and price/cost history are recorded by the DATABASE, like
// "Labels to reprint" (v141): triggers on outlet_stock / variant_outlet_stock
// write one stock_movements row per quantity change, and triggers on
// products / product_variants write one price_changes row per price or cost
// change, whichever of the many writers made it. So the running balance always
// matches on-hand, from the day this went live (existing stock gets an
// "opening" line at migration time; nothing earlier is reconstructed).
//
// Who and why: each row records the transaction id. A writer that knows what
// it is doing (a sale, a delivery, an adjustment...) calls tagChanges() at the
// end of its transaction, which labels that transaction's untagged rows. Rows
// no writer tagged show as "Other change". Bill / GRN numbers are looked up at
// read time from ref_type + ref_id (a sale's invoice number is assigned after
// the sale's own transaction commits).
//
// The same DDL is in schema-pg.sql (fresh schemas and tests) and migration
// v143 (existing tenants). Keep them identical.

const PRODUCT_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER,
  outlet_id INTEGER NOT NULL,
  qty_change NUMERIC(12,3) NOT NULL,
  balance_after NUMERIC(12,3) NOT NULL,
  kind TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  ref_no TEXT,
  note TEXT,
  employee_id INTEGER,
  txid BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_stock_movements_item
  ON stock_movements (product_id, (COALESCE(variant_id, 0)), outlet_id, id);
CREATE INDEX IF NOT EXISTS ix_stock_movements_untagged
  ON stock_movements (txid) WHERE kind IS NULL;

CREATE TABLE IF NOT EXISTS price_changes (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER,
  field TEXT NOT NULL CHECK (field IN ('price', 'cost_price')),
  old_value NUMERIC(12,2),
  new_value NUMERIC(12,2),
  kind TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  ref_no TEXT,
  note TEXT,
  employee_id INTEGER,
  txid BIGINT NOT NULL DEFAULT txid_current(),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_price_changes_item ON price_changes (product_id, id);
CREATE INDEX IF NOT EXISTS ix_price_changes_untagged ON price_changes (txid) WHERE kind IS NULL;

CREATE OR REPLACE FUNCTION stock_movement_note(p_product INTEGER, p_variant INTEGER, p_outlet INTEGER,
                                               p_change NUMERIC, p_balance NUMERIC)
RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF p_product IS NULL OR p_change IS NULL OR p_change = 0 THEN RETURN; END IF;
  INSERT INTO stock_movements (product_id, variant_id, outlet_id, qty_change, balance_after)
  VALUES (p_product, p_variant, p_outlet, p_change, COALESCE(p_balance, 0));
END
$fn$;

CREATE OR REPLACE FUNCTION stock_movements_outlet_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM stock_movement_note(NEW.product_id, NULL, NEW.outlet_id, NEW.quantity, NEW.quantity);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM stock_movement_note(NEW.product_id, NULL, NEW.outlet_id, NEW.quantity - OLD.quantity, NEW.quantity);
  ELSE
    PERFORM stock_movement_note(OLD.product_id, NULL, OLD.outlet_id, -OLD.quantity, 0);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION stock_movements_variant_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
DECLARE pid INTEGER;
BEGIN
  -- A variant deleted with its stock rows (ON DELETE CASCADE) is already gone:
  -- nothing to record.
  SELECT product_id INTO pid FROM product_variants
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.variant_id ELSE NEW.variant_id END;
  IF TG_OP = 'INSERT' THEN
    PERFORM stock_movement_note(pid, NEW.variant_id, NEW.outlet_id, NEW.quantity, NEW.quantity);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM stock_movement_note(pid, NEW.variant_id, NEW.outlet_id, NEW.quantity - OLD.quantity, NEW.quantity);
  ELSE
    PERFORM stock_movement_note(pid, OLD.variant_id, OLD.outlet_id, -OLD.quantity, 0);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION price_change_note(p_product INTEGER, p_variant INTEGER, p_field TEXT,
                                             p_old NUMERIC, p_new NUMERIC)
RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF p_old IS NOT DISTINCT FROM p_new THEN RETURN; END IF;
  INSERT INTO price_changes (product_id, variant_id, field, old_value, new_value)
  VALUES (p_product, p_variant, p_field, p_old, p_new);
END
$fn$;

CREATE OR REPLACE FUNCTION price_changes_products_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM price_change_note(NEW.id, NULL, 'price', NULL, NEW.price);
    PERFORM price_change_note(NEW.id, NULL, 'cost_price', NULL, NULLIF(NEW.cost_price, 0));
  ELSE
    PERFORM price_change_note(NEW.id, NULL, 'price', OLD.price, NEW.price);
    PERFORM price_change_note(NEW.id, NULL, 'cost_price', OLD.cost_price, NEW.cost_price);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION price_changes_variants_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM price_change_note(NEW.product_id, NEW.id, 'price', NULL, NEW.price);
    PERFORM price_change_note(NEW.product_id, NEW.id, 'cost_price', NULL, NULLIF(NEW.cost_price, 0));
  ELSE
    PERFORM price_change_note(NEW.product_id, NEW.id, 'price', OLD.price, NEW.price);
    PERFORM price_change_note(NEW.product_id, NEW.id, 'cost_price', OLD.cost_price, NEW.cost_price);
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_stock_movements_outlet ON outlet_stock;
CREATE TRIGGER trg_stock_movements_outlet
  AFTER INSERT OR UPDATE OF quantity OR DELETE ON outlet_stock
  FOR EACH ROW EXECUTE FUNCTION stock_movements_outlet_trg();

DROP TRIGGER IF EXISTS trg_stock_movements_variant ON variant_outlet_stock;
CREATE TRIGGER trg_stock_movements_variant
  AFTER INSERT OR UPDATE OF quantity OR DELETE ON variant_outlet_stock
  FOR EACH ROW EXECUTE FUNCTION stock_movements_variant_trg();

DROP TRIGGER IF EXISTS trg_price_changes_products ON products;
CREATE TRIGGER trg_price_changes_products
  AFTER INSERT OR UPDATE OF price, cost_price ON products
  FOR EACH ROW EXECUTE FUNCTION price_changes_products_trg();

DROP TRIGGER IF EXISTS trg_price_changes_variants ON product_variants;
CREATE TRIGGER trg_price_changes_variants
  AFTER INSERT OR UPDATE OF price, cost_price ON product_variants
  FOR EACH ROW EXECUTE FUNCTION price_changes_variants_trg();
`;

// Existing stock at migration time becomes each item's "opening" line.
const OPENING_BALANCES_SQL = `
INSERT INTO stock_movements (product_id, variant_id, outlet_id, qty_change, balance_after, kind)
SELECT os.product_id, NULL, os.outlet_id, os.quantity, os.quantity, 'opening'
  FROM outlet_stock os
 WHERE os.quantity <> 0
   AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = os.product_id)
UNION ALL
SELECT pv.product_id, vos.variant_id, vos.outlet_id, vos.quantity, vos.quantity, 'opening'
  FROM variant_outlet_stock vos
  JOIN product_variants pv ON pv.id = vos.variant_id
 WHERE vos.quantity <> 0
   AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = pv.product_id)`;

/**
 * Label the current transaction's untagged stock movements and price changes.
 * Call at the END of the writer's transaction (client = the transaction's
 * client). Only rows no one tagged yet are touched, so a transaction that does
 * two things can tag after each.
 */
async function tagChanges(client, { kind, refType = null, refId = null, refNo = null, note = null, employeeId = null }) {
  await client.query(
    `WITH s AS (
       UPDATE stock_movements SET kind = $1, ref_type = $2, ref_id = $3, ref_no = $4, note = $5, employee_id = $6
        WHERE txid = txid_current() AND kind IS NULL RETURNING 1
     ), p AS (
       UPDATE price_changes SET kind = $1, ref_type = $2, ref_id = $3, ref_no = $4, note = $5, employee_id = $6
        WHERE txid = txid_current() AND kind IS NULL RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM s) AS stock, (SELECT COUNT(*) FROM p) AS prices`,
    [kind, refType, refId == null ? null : Number(refId), refNo, note, employeeId == null ? null : Number(employeeId)],
  );
}

// Who is acting: the signed-in employee (JWT, multi-tenant), else the
// x-employee-id header single-tenant/test mode uses.
function actorOf(req) {
  const id = req?.employee?.id ?? req?.headers?.["x-employee-id"];
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The document number a row points at, looked up at read time.
const REF_NO_SQL = (alias) => `
  COALESCE(${alias}.ref_no,
    CASE ${alias}.ref_type
      WHEN 'sale' THEN (SELECT s.invoice_number FROM sales s WHERE s.id = ${alias}.ref_id)
      WHEN 'return' THEN (SELECT os.invoice_number FROM returns r JOIN sales os ON os.id = r.original_sale_id WHERE r.id = ${alias}.ref_id)
      WHEN 'grn' THEN (SELECT g.grn_number FROM goods_received_notes g WHERE g.id = ${alias}.ref_id)
      ELSE NULL
    END)`;

/**
 * Stock ledger, newest first. variantId null = the product-level rows
 * (outlet_stock). outletId null = all branches, with a combined running
 * balance; otherwise that branch's own balance after each line.
 */
async function stockLedger(db, { productId, variantId = null, outletId = null, limit = 200, beforeId = null }) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT m.id, m.product_id, m.variant_id, m.outlet_id, o.name AS outlet_name,
              m.qty_change, m.kind, m.ref_type, m.ref_id, ${REF_NO_SQL("m")} AS ref_no, m.note,
              m.employee_id, e.name AS employee_name, m.created_at,
              CASE WHEN $3::int IS NULL THEN SUM(m.qty_change) OVER (ORDER BY m.id)
                   ELSE m.balance_after END AS balance
         FROM stock_movements m
         LEFT JOIN outlets o ON o.id = m.outlet_id
         LEFT JOIN employees e ON e.id = m.employee_id
        WHERE m.product_id = $1 AND COALESCE(m.variant_id, 0) = COALESCE($2::int, 0)
          AND ($3::int IS NULL OR m.outlet_id = $3::int)
     ) x
     WHERE ($4::bigint IS NULL OR x.id < $4::bigint)
     ORDER BY x.id DESC
     LIMIT $5`,
    [productId, variantId, outletId, beforeId, limit],
  );
  const table = variantId ? "variant_outlet_stock" : "outlet_stock";
  const key = variantId ? "variant_id" : "product_id";
  const { rows: [oh] } = await db.query(
    `SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM ${table}
      WHERE ${key} = $1 AND ($2::int IS NULL OR outlet_id = $2::int)`,
    [variantId || productId, outletId],
  );
  return { items: rows, on_hand: oh.on_hand };
}

// Price and cost changes for the product and its variants, newest first.
async function priceHistory(db, { productId, variantId = null, limit = 500 }) {
  const { rows } = await db.query(
    `SELECT c.id, c.product_id, c.variant_id, pv.sku AS variant_sku, c.field, c.old_value, c.new_value,
            c.kind, c.ref_type, c.ref_id, ${REF_NO_SQL("c")} AS ref_no, c.note,
            c.employee_id, e.name AS employee_name, c.changed_at
       FROM price_changes c
       LEFT JOIN product_variants pv ON pv.id = c.variant_id
       LEFT JOIN employees e ON e.id = c.employee_id
      WHERE c.product_id = $1 AND ($2::int IS NULL OR c.variant_id = $2::int)
      ORDER BY c.id DESC
      LIMIT $3`,
    [productId, variantId, limit],
  );
  return { items: rows };
}

// Sale lines by bill no and return lines (quantity negative) against the
// original bill, newest first. Read from the bills, so it covers the past too.
async function salesHistory(db, { productId, variantId = null, limit = 200, offset = 0 }) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT 'sale' AS line_type, si.id AS line_id, s.id AS sale_id, s.invoice_number, s.timestamp AS at,
              si.variant_id, pv.sku AS variant_sku, si.quantity, si.price_at_sale AS price,
              e.name AS cashier, o.name AS outlet_name, COALESCE(s.voided, false) AS voided
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN product_variants pv ON pv.id = si.variant_id
         LEFT JOIN employees e ON e.id = s.employee_id
         LEFT JOIN outlets o ON o.id = s.outlet_id
        WHERE si.product_id = $1 AND ($2::int IS NULL OR si.variant_id = $2::int)
       UNION ALL
       SELECT 'return', ri.id, r.original_sale_id, os.invoice_number, r.timestamp,
              ri.variant_id, pv.sku, -ri.quantity, ri.refund_price,
              e.name, o.name, false
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         LEFT JOIN sales os ON os.id = r.original_sale_id
         LEFT JOIN product_variants pv ON pv.id = ri.variant_id
         LEFT JOIN employees e ON e.id = COALESCE(r.processed_by_employee_id, r.employee_id)
         LEFT JOIN outlets o ON o.id = r.outlet_id
        WHERE ri.product_id = $1 AND ($2::int IS NULL OR ri.variant_id = $2::int)
     ) x
     ORDER BY x.at DESC, x.line_id DESC
     LIMIT $3 OFFSET $4`,
    [productId, variantId, limit, offset],
  );
  return { items: rows };
}

module.exports = { PRODUCT_HISTORY_DDL, OPENING_BALANCES_SQL, tagChanges, actorOf, stockLedger, priceHistory, salesHistory };

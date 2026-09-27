// "Labels to reprint" (One Toy Store pilot, Phase B step 6; owner decisions
// 2026-09-27, docs/onetoystore-pilot/PROGRESS.md).
//
// Marking is done by the database, not by route code: a trigger on
// products.price and product_variants.price records every change, whichever
// writer made it (product edit, variant edit, Shopify import, scheduled
// changes, imports, and anything added later). The routes only read the list
// and clear it.
//
// label_reprints holds at most one OPEN row per item (product, or product +
// variant). old_price is the price on the last label (NULL = new item, never
// labelled); new_price is the current price. A price moved back to the label's
// price deletes the open row: the label is right again.
//
// The same DDL is in schema-pg.sql (fresh schemas and tests) and migration
// v141 (existing tenants). Keep them identical.

const LABEL_REPRINTS_DDL = `
CREATE TABLE IF NOT EXISTS label_reprints (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  old_price NUMERIC(12,2),
  new_price NUMERIC(12,2),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  cleared_how TEXT CHECK (cleared_how IN ('printed', 'dismissed', 'already_labelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_reprints_open
  ON label_reprints (product_id, (COALESCE(variant_id, 0))) WHERE cleared_at IS NULL;

CREATE OR REPLACE FUNCTION label_reprint_note(p_product INTEGER, p_variant INTEGER, p_old NUMERIC, p_new NUMERIC)
RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  INSERT INTO label_reprints (product_id, variant_id, old_price, new_price)
  VALUES (p_product, p_variant, p_old, p_new)
  ON CONFLICT (product_id, (COALESCE(variant_id, 0))) WHERE cleared_at IS NULL
  DO UPDATE SET new_price = EXCLUDED.new_price, changed_at = NOW();
  DELETE FROM label_reprints
   WHERE product_id = p_product AND COALESCE(variant_id, 0) = COALESCE(p_variant, 0)
     AND cleared_at IS NULL AND old_price IS NOT NULL AND old_price = new_price;
END
$fn$;

CREATE OR REPLACE FUNCTION label_reprints_products_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  -- Packages/services carry no shelf label; a product with variants is
  -- labelled per variant.
  IF COALESCE(NEW.product_type, '') IN ('service', 'package') OR NEW.has_variants IS TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM label_reprint_note(NEW.id, NULL, NULL, NEW.price);
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    PERFORM label_reprint_note(NEW.id, NULL, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION label_reprints_variants_trg() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM label_reprint_note(NEW.product_id, NEW.id, NULL,
      COALESCE(NEW.price, (SELECT price FROM products WHERE id = NEW.product_id)));
    -- The item is now labelled per variant, not as the parent.
    DELETE FROM label_reprints
     WHERE product_id = NEW.product_id AND variant_id IS NULL AND cleared_at IS NULL;
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    PERFORM label_reprint_note(NEW.product_id, NEW.id, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_label_reprints_products ON products;
CREATE TRIGGER trg_label_reprints_products
  AFTER INSERT OR UPDATE OF price ON products
  FOR EACH ROW EXECUTE FUNCTION label_reprints_products_trg();

DROP TRIGGER IF EXISTS trg_label_reprints_variants ON product_variants;
CREATE TRIGGER trg_label_reprints_variants
  AFTER INSERT OR UPDATE OF price ON product_variants
  FOR EACH ROW EXECUTE FUNCTION label_reprints_variants_trg();
`;

// Open rows, newest change first. Archived products drop off.
async function listOpen(db) {
  const { rows } = await db.query(
    `SELECT lr.id, lr.product_id, lr.variant_id, p.name, pv.sku AS variant_sku,
            COALESCE(pv.barcode, p.barcode) AS barcode, COALESCE(pv.sku, p.sku) AS sku,
            b.name AS brand_name, lr.old_price, lr.new_price,
            (lr.old_price IS NULL) AS is_new, lr.changed_at
       FROM label_reprints lr
       JOIN products p ON p.id = lr.product_id
       LEFT JOIN product_variants pv ON pv.id = lr.variant_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE lr.cleared_at IS NULL AND p.deleted_at IS NULL
      ORDER BY lr.changed_at DESC, lr.id DESC`,
  );
  return rows;
}

// A label printed at the item's CURRENT price clears it; one printed at a stale
// price does not (the shelf would still be wrong).
async function clearPrinted(db, { productId, variantId, price }) {
  const { rowCount } = await db.query(
    `UPDATE label_reprints SET cleared_at = NOW(), cleared_how = 'printed'
      WHERE product_id = $1 AND COALESCE(variant_id, 0) = COALESCE($2::int, 0)
        AND cleared_at IS NULL AND new_price = $3`,
    [productId, variantId || null, price],
  );
  return rowCount;
}

async function dismiss(db, ids, how = "dismissed") {
  const { rowCount } = await db.query(
    `UPDATE label_reprints SET cleared_at = NOW(), cleared_how = $2
      WHERE id = ANY($1::int[]) AND cleared_at IS NULL`,
    [ids, how],
  );
  return rowCount;
}

// Spreadsheet import with the "already labelled" tick (the iPOS switchover):
// the imported items' shelf labels are already right.
async function clearAlreadyLabelled(db, productIds) {
  if (!productIds.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE label_reprints SET cleared_at = NOW(), cleared_how = 'already_labelled'
      WHERE product_id = ANY($1::int[]) AND cleared_at IS NULL`,
    [productIds],
  );
  return rowCount;
}

module.exports = { LABEL_REPRINTS_DDL, listOpen, clearPrinted, dismiss, clearAlreadyLabelled };

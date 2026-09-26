'use strict';

/**
 * Kit / BOM / Recipe engine (F01).
 *
 * ONE home for kit component semantics so every sales write path — POS,
 * storefront reservation, holds settle, pay-at-table, quotation convert — and
 * production/disassembly runs resolve components identically. This consolidates
 * the pre-existing `is_bundle` / `product_bundles` handling that previously
 * lived inline in routes/sales.js (POS-only, client-trust, unsorted locks).
 *
 * Product consumption modes live on `products.bom_type`:
 *   standard  — decrement own stock (unchanged)
 *   kit       — decrement COMPONENTS at sale; holds no stock of its own
 *   assembled — holds own stock, created by production runs (sells like standard)
 *
 * Invariants enforced here:
 *  - Component quantities are decimal (NUMERIC 12,4); ALL qty math rounds through
 *    roundQty() — the single rounding point (plan: "define rounding in one place").
 *  - Components are locked in a STABLE order (component_product_id, then
 *    component_variant_id NULLS FIRST) so concurrent sales of overlapping kits
 *    can't deadlock — same discipline services/reservation.js uses.
 *  - Variant components decrement variant_outlet_stock (per-outlet, authoritative)
 *    + product_variants.stock (rollup) — mirroring the non-kit variant path, not
 *    the old bundle code which only touched the global rollup.
 *  - A kit with zero components is NOT sellable (throws empty_kit, never a silent
 *    zero-decrement sale).
 */

const QTY_SCALE = 4;

/** The single rounding point for all component quantity math. */
function roundQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** QTY_SCALE;
  return Math.round(x * f) / f;
}

/**
 * Load a product's component rows in stable lock order. Read-through: pass a
 * transaction client when locking will follow, or the db proxy for reads.
 */
async function loadComponents(runner, productId) {
  const { rows } = await runner.query(
    `SELECT component_product_id, component_variant_id, quantity, unit,
            is_substitutable, modifier_group_id
       FROM product_bundles
      WHERE product_id = $1
      ORDER BY component_product_id ASC, component_variant_id ASC NULLS FIRST`,
    [productId]
  );
  return rows;
}

/**
 * Resolve bom_type + (for kits/assembled) components for a set of product ids
 * in one round-trip. Returns Map(productId -> { bomType, components }).
 * `components` is only populated for kit/assembled rows and is stably sorted.
 */
async function loadKitMap(runner, productIds) {
  const ids = [...new Set((productIds || []).map((n) => Number(n)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const { rows: prods } = await runner.query(
    `SELECT id, COALESCE(bom_type, 'standard') AS bom_type FROM products WHERE id = ANY($1::int[])`,
    [ids]
  );
  for (const p of prods) map.set(Number(p.id), { bomType: p.bom_type, components: [] });

  const kitIds = prods
    .filter((p) => p.bom_type === 'kit' || p.bom_type === 'assembled')
    .map((p) => Number(p.id));
  if (kitIds.length) {
    const { rows: comps } = await runner.query(
      `SELECT product_id, component_product_id, component_variant_id, quantity, unit,
              is_substitutable, modifier_group_id
         FROM product_bundles
        WHERE product_id = ANY($1::int[])
        ORDER BY product_id ASC, component_product_id ASC, component_variant_id ASC NULLS FIRST`,
      [kitIds]
    );
    for (const c of comps) {
      const entry = map.get(Number(c.product_id));
      if (entry) entry.components.push(c);
    }
  }
  return map;
}

function insufficient({ productId, variantId, available, requested }) {
  return Object.assign(
    new Error(
      variantId
        ? `Insufficient stock for kit component variant ${variantId}`
        : `Insufficient stock for kit component ${productId}`
    ),
    {
      statusCode: 400,
      code: 'insufficient_stock',
      product_id: productId || null,
      variant_id: variantId || null,
      available: Number(available || 0),
      requested: Number(requested || 0),
    }
  );
}

/**
 * Lock + verify component stock for selling `saleQty` of one kit at `outletId`,
 * in stable lock order. Does NOT write — call decrementComponents() after all
 * reserve passes for a multi-line sale so every row is locked before any write.
 * Throws on shortfall (code insufficient_stock) or empty kit (code empty_kit).
 * onShortfall (optional): called with the insufficient_stock error instead of
 * throwing it, and the component is still decremented (offline sale replays,
 * which are booked past stock — One Toy Store blocker 3e).
 * Returns [{ component_product_id, component_variant_id, needed, useVariantOutlet }].
 */
async function reserveComponents(client, { productId, outletId, saleQty, components, onShortfall = null }) {
  const comps = components || (await loadComponents(client, productId));
  if (!comps.length) {
    throw Object.assign(
      new Error(`Kit product ${productId} has no components and cannot be sold`),
      { statusCode: 400, code: 'empty_kit', product_id: productId || null }
    );
  }
  const decrements = [];
  for (const comp of comps) {
    const needed = roundQty(Number(comp.quantity) * Number(saleQty));
    if (comp.component_variant_id) {
      // Prefer per-outlet variant stock (authoritative); fall back to the
      // cross-outlet rollup for variants not yet backfilled at this outlet.
      const { rows: [vos] } = await client.query(
        `SELECT COALESCE(quantity, 0) AS available
           FROM variant_outlet_stock
          WHERE variant_id = $1 AND outlet_id = $2
          FOR UPDATE`,
        [comp.component_variant_id, outletId]
      );
      let available;
      let useVariantOutlet;
      if (vos) {
        available = Number(vos.available);
        useVariantOutlet = true;
      } else {
        const { rows: [row] } = await client.query(
          `SELECT COALESCE(stock, 0) AS available FROM product_variants WHERE id = $1 FOR UPDATE`,
          [comp.component_variant_id]
        );
        available = Number(row?.available ?? 0);
        useVariantOutlet = false;
      }
      if (available < needed) {
        const err = insufficient({
          productId: comp.component_product_id,
          variantId: comp.component_variant_id,
          available,
          requested: needed,
        });
        if (onShortfall) onShortfall(err);
        else throw err;
      }
      decrements.push({ ...comp, needed, useVariantOutlet });
    } else {
      const { rows: [row] } = await client.query(
        `SELECT COALESCE(quantity, 0) AS available
           FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
        [comp.component_product_id, outletId]
      );
      const available = Number(row?.available ?? 0);
      if (available < needed) {
        const err = insufficient({
          productId: comp.component_product_id,
          available,
          requested: needed,
        });
        if (onShortfall) onShortfall(err);
        else throw err;
      }
      decrements.push({ ...comp, needed, useVariantOutlet: false });
    }
  }
  return decrements;
}

/** Cheap bom_type lookup for the non-POS writers' expand-or-reject branch. */
async function getBomType(runner, productId) {
  const { rows: [r] } = await runner.query(
    `SELECT COALESCE(bom_type, 'standard') AS bom_type FROM products WHERE id = $1`,
    [productId]
  );
  return r ? r.bom_type : 'standard';
}

/**
 * One-shot reserve + decrement for the non-POS sales writers (holds settle,
 * web-order allocation) that don't need the two-pass check-then-write split.
 * Locks components in stable order, verifies, decrements. Throws on shortfall.
 */
async function reserveAndDecrement(client, { productId, outletId, saleQty, components }) {
  const decrements = await reserveComponents(client, { productId, outletId, saleQty, components });
  await decrementComponents(client, { outletId, decrements });
  return decrements;
}

/** Apply the decrements returned by reserveComponents(), inside the same tx. */
async function decrementComponents(client, { outletId, decrements }) {
  for (const d of decrements) {
    if (d.component_variant_id) {
      // Keep per-outlet variant stock authoritative + product_variants.stock as
      // the cross-outlet rollup, matching the non-kit variant path in sales.js.
      await client.query(
        `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
           VALUES ($1, $2, 0 - $3::numeric)
           ON CONFLICT (variant_id, outlet_id)
           DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
        [d.component_variant_id, outletId, d.needed]
      );
      await client.query(
        `UPDATE product_variants SET stock = stock - $1 WHERE id = $2`,
        [d.needed, d.component_variant_id]
      );
    }
    await client.query(
      `UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3`,
      [d.needed, d.component_product_id, outletId]
    );
  }
}

/**
 * Restock a kit's components for a voided/returned line of `qty` kits. Locks in
 * stable order, upserts outlet_stock (bundle components may have no row yet).
 */
async function restockComponents(client, { productId, outletId, qty, components }) {
  const comps = components || (await loadComponents(client, productId));
  for (const comp of comps) {
    const restore = roundQty(Number(comp.quantity) * Number(qty));
    await client.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
      [comp.component_product_id, outletId, restore, restore]
    );
    if (comp.component_variant_id) {
      await client.query(
        `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (variant_id, outlet_id) DO UPDATE SET quantity = variant_outlet_stock.quantity + $4`,
        [comp.component_variant_id, outletId, restore, restore]
      );
      await client.query(
        `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
        [restore, comp.component_variant_id]
      );
    }
  }
}

/**
 * Sellable quantity of a kit at an outlet: min over components of
 * floor(component_available / qty_per). Zero components → 0 (not sellable).
 * Read-only; safe to call with the db proxy.
 */
async function kitAvailability(runner, { productId, outletId }) {
  const { rows: [row] } = await runner.query(
    `SELECT MIN(FLOOR(avail / qty_per))::int AS available FROM (
       SELECT pb.quantity AS qty_per,
         CASE WHEN pb.component_variant_id IS NOT NULL THEN
           COALESCE(
             (SELECT quantity FROM variant_outlet_stock
               WHERE variant_id = pb.component_variant_id AND outlet_id = $2),
             (SELECT stock FROM product_variants WHERE id = pb.component_variant_id),
             0)
         ELSE
           COALESCE(
             (SELECT quantity FROM outlet_stock
               WHERE product_id = pb.component_product_id AND outlet_id = $2),
             0)
         END AS avail
       FROM product_bundles pb
       WHERE pb.product_id = $1
     ) t`,
    [productId, outletId]
  );
  // No components → MIN over empty set is NULL → not sellable.
  return row && row.available != null ? Number(row.available) : 0;
}

/**
 * Validate a proposed component set for a kit/assembled parent before writing.
 * Rejects: self-reference, missing component product, nested kit/assembled
 * component (no nested BOMs in v1), non-positive quantity. Throws {statusCode:400}.
 */
async function assertValidComponents(client, { parentProductId, components }) {
  const parentId = Number(parentProductId);
  if (!Array.isArray(components)) {
    throw Object.assign(new Error('components must be an array'), { statusCode: 400 });
  }
  const compIds = [];
  for (const c of components) {
    const cpid = Number(c.product_id ?? c.component_product_id);
    const qty = Number(c.quantity ?? 1);
    if (!Number.isInteger(cpid) || cpid <= 0) {
      throw Object.assign(new Error('Each component needs a valid product_id'), { statusCode: 400 });
    }
    if (cpid === parentId) {
      throw Object.assign(new Error('A kit cannot contain itself as a component'), { statusCode: 400 });
    }
    if (!(qty > 0)) {
      throw Object.assign(new Error('Component quantity must be greater than zero'), { statusCode: 400 });
    }
    compIds.push(cpid);
  }
  if (!compIds.length) return; // empty set allowed at CRUD time; sale rejects empty kits.

  const { rows } = await client.query(
    `SELECT id, COALESCE(bom_type, 'standard') AS bom_type FROM products WHERE id = ANY($1::int[])`,
    [[...new Set(compIds)]]
  );
  const found = new Map(rows.map((r) => [Number(r.id), r.bom_type]));
  for (const cpid of compIds) {
    if (!found.has(cpid)) {
      throw Object.assign(new Error(`Component product ${cpid} does not exist`), { statusCode: 400 });
    }
    if (found.get(cpid) !== 'standard') {
      throw Object.assign(
        new Error(`Component product ${cpid} is itself a kit/assembled product — nested BOMs are not supported`),
        { statusCode: 400, code: 'nested_kit' }
      );
    }
  }
}

/**
 * Replace a product's component set (transactional). Validates first, then
 * clears + reinserts. Caller owns the transaction/client and bom_type sync.
 */
async function replaceComponents(client, { parentProductId, components }) {
  await assertValidComponents(client, { parentProductId, components });
  await client.query(`DELETE FROM product_bundles WHERE product_id = $1`, [parentProductId]);
  for (const c of components || []) {
    const cpid = Number(c.product_id ?? c.component_product_id);
    await client.query(
      `INSERT INTO product_bundles
         (product_id, component_product_id, component_variant_id, quantity, unit, is_substitutable, modifier_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (product_id, component_product_id, component_variant_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit,
                     is_substitutable = EXCLUDED.is_substitutable,
                     modifier_group_id = EXCLUDED.modifier_group_id`,
      [
        parentProductId,
        cpid,
        c.variant_id ?? c.component_variant_id ?? null,
        roundQty(c.quantity ?? 1),
        c.unit ?? null,
        c.is_substitutable === true,
        c.modifier_group_id != null ? Number(c.modifier_group_id) : null,
      ]
    );
  }
}

module.exports = {
  QTY_SCALE,
  roundQty,
  loadComponents,
  loadKitMap,
  getBomType,
  reserveComponents,
  reserveAndDecrement,
  decrementComponents,
  restockComponents,
  kitAvailability,
  assertValidComponents,
  replaceComponents,
};

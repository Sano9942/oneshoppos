/**
 * Shared v83 per-line tax snapshot resolution.
 *
 * Single source of truth for the tax cascade every sale writer must apply
 * (extracted verbatim from routes/sales.js P8 3.14 so POS, storefront,
 * layaway settle, pay-at-table, quotation convert, and manual orders all
 * resolve identically):
 *   1. outlet_tax_profiles match (when phase2_outlet_tax flag on and an
 *      outlet is known)
 *   2. products.tax_id → taxes.rate
 *   3. products.gst (legacy direct rate)
 *   4. category-tree inherited tax_id → taxes.rate
 *   5. 0
 * tax_mode='none' overrides everything to 0.
 *
 * Read-only — safe to call outside a transaction.
 */

const { getFeatureFlagsMap } = require("../middleware/feature-flags");

/**
 * @param {object} db    tenant db (proxy or scoped handle) — needs .query
 * @param {object} opts
 * @param {Array}  opts.items        [{ productId, price, quantity }] — productId may be null (custom line → rate 0 unless overridden)
 * @param {string} opts.taxMode      'none' | 'inclusive' | 'exclusive'
 * @param {boolean} [opts.taxInclusive]  override; defaults to taxMode === 'inclusive'
 * @param {number} [opts.outletId]   for outlet tax profiles; profiles skipped when absent
 * @param {*}      [opts.tenantId]   for the feature-flag lookup (outlet profiles)
 * @returns {Promise<{lines: Array<{rate:number, amount:number, hsCode:string|null}>, taxTotal:number, gross:number, subtotal:number, taxInclusive:boolean}>}
 *          lines[i] corresponds to items[i]. Amounts are per-line, rounded to 2dp.
 *          inclusive: subtotal = gross - taxTotal; exclusive: subtotal = gross.
 */
async function resolveTaxSnapshot(db, { items, taxMode, taxInclusive, outletId, tenantId }) {
  const mode = taxMode || "none";
  const inclusiveResolved =
    mode === "none"
      ? false
      : typeof taxInclusive === "boolean"
        ? taxInclusive
        : mode === "inclusive";

  const lines = new Array(items.length).fill(null);

  if (mode === "none") {
    for (let i = 0; i < items.length; i++) {
      lines[i] = { rate: 0, amount: 0, hsCode: null };
    }
  } else {
    // Pre-fetch product rows for all items once.
    const productIds = Array.from(
      new Set(items.map((x) => Number(x.productId)).filter(Boolean))
    );
    let productMap = new Map();
    if (productIds.length) {
      const { rows: pRows } = await db.query(
        `SELECT p.id, p.gst, p.tax_id, p.category_id,
                t.rate AS tax_table_rate
           FROM products p
           LEFT JOIN taxes t ON t.id = p.tax_id
          WHERE p.id = ANY($1::int[])`,
        [productIds]
      );
      for (const r of pRows) productMap.set(Number(r.id), r);
    }

    // Outlet tax profile lookup — only if the flag is on AND an outlet is
    // known AND the table exists.
    let outletProfileLines = [];
    if (outletId) {
      try {
        const flags = await getFeatureFlagsMap(tenantId);
        if (flags.phase2_outlet_tax) {
          const { rows } = await db.query(
            `SELECT otpl.product_id, otpl.category_id, otpl.priority, t.rate
               FROM outlet_tax_profiles otp
               JOIN outlet_tax_profile_lines otpl ON otpl.profile_id = otp.id
               LEFT JOIN taxes t ON t.id = otpl.tax_id
              WHERE otp.outlet_id = $1 AND otp.is_active = TRUE`,
            [Number(outletId)]
          );
          outletProfileLines = rows;
        }
      } catch { /* outlet_tax_profiles table may not exist on older tenants */ }
    }

    // Lazy-load category indexes for resolveInheritedField (only if needed).
    let categoryByIdMap = null;
    const ensureCategoryMap = async () => {
      if (categoryByIdMap) return categoryByIdMap;
      try {
        const { fetchCategoryIndexes } = require("../category-tree");
        const idx = await fetchCategoryIndexes(db);
        categoryByIdMap = idx?.byId || new Map();
      } catch {
        categoryByIdMap = new Map();
      }
      return categoryByIdMap;
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const productId = Number(item.productId) || null;
      const product = productId ? productMap.get(productId) : null;
      const categoryId = product?.category_id || null;

      let rate = null;

      // 1. Outlet tax profile (highest priority match wins)
      if (outletProfileLines.length) {
        const matches = outletProfileLines
          .filter(
            (l) =>
              (l.product_id != null && Number(l.product_id) === productId) ||
              (l.category_id != null && Number(l.category_id) === Number(categoryId)) ||
              (l.product_id == null && l.category_id == null)
          )
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));
        if (matches.length && matches[0].rate != null) {
          rate = Number(matches[0].rate);
        }
      }

      // 2. products.tax_id → taxes.rate
      if (rate == null && product?.tax_table_rate != null) {
        rate = Number(product.tax_table_rate);
      }

      // 3. products.gst direct
      if (rate == null && product?.gst != null) {
        rate = Number(product.gst);
      }

      // 4. Category inheritance via tax_id
      if (rate == null && categoryId) {
        const byId = await ensureCategoryMap();
        const { resolveInheritedField } = require("../category-tree");
        const inheritedTaxId = resolveInheritedField(byId, categoryId, "tax_id");
        if (inheritedTaxId) {
          try {
            const { rows: [tr] } = await db.query(
              "SELECT rate FROM taxes WHERE id = $1",
              [Number(inheritedTaxId)]
            );
            if (tr) rate = Number(tr.rate);
          } catch { /* ignore */ }
        }
      }

      if (rate == null || !isFinite(rate)) rate = 0;

      // HS code: product → category inheritance
      let hsCode = null;
      if (categoryId) {
        const byId = await ensureCategoryMap();
        const { resolveInheritedField } = require("../category-tree");
        hsCode = resolveInheritedField(byId, categoryId, "hs_code") || null;
      }

      // Per-line amount
      const lineGross = Number(item.price) * Number(item.quantity);
      let amount = 0;
      if (rate > 0) {
        if (inclusiveResolved) {
          amount = Math.round((lineGross * rate / (100 + rate)) * 100) / 100;
        } else {
          amount = Math.round((lineGross * rate / 100) * 100) / 100;
        }
      }
      lines[i] = { rate, amount, hsCode };
    }
  }

  // Aggregate totals. Subtotal differs by mode:
  //   inclusive: subtotal = sum(price*qty) - taxTotal (tax was inside)
  //   exclusive: subtotal = sum(price*qty) (tax sits on top)
  const taxTotal = lines.reduce((s, t) => s + Number(t?.amount || 0), 0);
  const gross = items.reduce(
    (s, it) => s + Number(it.price) * Number(it.quantity),
    0
  );
  const subtotal = inclusiveResolved ? gross - taxTotal : gross;

  return { lines, taxTotal, gross, subtotal, taxInclusive: inclusiveResolved };
}

/**
 * Folio-tax resolver (V09/approved folio-tax-proposal). Non-product charges
 * (rental duration, room nights, session fees) resolve tax from an EXPLICIT
 * tax_id on the entity — the product/category cascade doesn't apply — but the
 * mode/inclusive/rounding math is the same single implementation as sales.
 *
 * @param {object} db    tenant db/client — needs .query
 * @param {object} opts
 * @param {number|null} opts.taxId    entity's tax FK; NULL/undefined → untaxed (rate 0)
 * @param {number} opts.price         per-unit charge (pre-tax in exclusive, tax-inclusive in inclusive mode)
 * @param {number} [opts.quantity=1]
 * @param {string} opts.taxMode       'none' | 'inclusive' | 'exclusive'
 * @param {boolean} [opts.taxInclusive]  override; defaults to taxMode === 'inclusive'
 * @returns {Promise<{rate:number, amount:number}>} per-line rate (%) + tax amount (2dp)
 */
async function resolveTaxForExplicitRate(db, { taxId, price, quantity = 1, taxMode, taxInclusive }) {
  const mode = taxMode || "none";
  if (mode === "none" || taxId == null) return { rate: 0, amount: 0 };

  const inclusive = typeof taxInclusive === "boolean" ? taxInclusive : mode === "inclusive";

  let rate = 0;
  try {
    const { rows: [t] } = await db.query("SELECT rate FROM taxes WHERE id = $1", [Number(taxId)]);
    if (t && t.rate != null) rate = Number(t.rate);
  } catch { /* taxes row missing → untaxed */ }
  if (!isFinite(rate) || rate <= 0) return { rate: 0, amount: 0 };

  const gross = Number(price) * Number(quantity);
  const amount = inclusive
    ? Math.round((gross * rate / (100 + rate)) * 100) / 100
    : Math.round((gross * rate / 100) * 100) / 100;
  return { rate, amount };
}

module.exports = { resolveTaxSnapshot, resolveTaxForExplicitRate };

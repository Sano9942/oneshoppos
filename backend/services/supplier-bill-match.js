/**
 * One Toy Store F9 (c1): which of our toys is each supplier bill line?
 * PHASE-F-PLAN F9: a supplier's code is looked up ONLY within that supplier
 * (their 1083 is not our SKU 1083); barcodes are global; one code may point to
 * several toys (an assorted line, owner 2026-10-02).
 *
 *   how            chosen?  from
 *   supplier_code  yes      supplier_item_codes (learned on earlier bills)
 *   barcode        yes      a barcode printed on the bill: products.barcode,
 *                           SKU, product_barcodes
 *   name_code      no       a toy whose name ends in the code (iPOS names:
 *                           "HSB JENGA GAME-53557"); the owner confirms
 *   similar        no       a similar name among this supplier's toys
 *                           (pg_trgm; skipped where it isn't installed)
 */

const TOY_COLS = `p.id AS product_id, p.name, p.sku, p.barcode, p.price::float AS price,
                  p.cost_price::float AS cost_price, p.supplier_id, p.category_id, p.brand_id,
                  (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name`;
// LIKE pattern text with ! as the escape character (a code may hold % or _).
const likeEscape = (s) => String(s).replace(/[!%_]/g, (c) => `!${c}`);

async function matchBillLines(db, supplierId, lines) {
  const out = lines.map((l) => ({
    key: l.key,
    supplier_code: l.supplier_code || null,
    matches: [],
    chosen: [],
  }));
  const add = (o, row, how, extra = {}) => {
    if (o.matches.some((m) => m.product_id === row.product_id)) return;
    o.matches.push({ ...row, how, split_into: 1, ...extra });
  };
  const codeOf = (l) => String(l.supplier_code || "").trim();

  // 1. This supplier's own codes.
  const codes = [...new Set(lines.map(codeOf).filter(Boolean).map((c) => c.toLowerCase()))];
  if (codes.length) {
    const { rows } = await db.query(
      `SELECT LOWER(sc.code) AS code, sc.split_into, ${TOY_COLS}
         FROM supplier_item_codes sc JOIN products p ON p.id = sc.product_id AND p.deleted_at IS NULL
        WHERE sc.supplier_id = $1 AND LOWER(sc.code) = ANY($2::text[])
        ORDER BY sc.id`, [supplierId, codes]);
    lines.forEach((l, i) => {
      const c = codeOf(l).toLowerCase();
      for (const r of rows.filter((x) => x.code === c)) {
        const { code, split_into: split, ...toy } = r;
        add(out[i], toy, "supplier_code", { split_into: split });
      }
    });
  }

  // 2. A barcode printed on the bill.
  const barcodes = [...new Set(lines.map((l) => String(l.barcode || "").trim()).filter(Boolean))];
  if (barcodes.length) {
    const { rows } = await db.query(
      `SELECT b.code, ${TOY_COLS}
         FROM unnest($1::text[]) AS b(code)
         JOIN products p ON p.deleted_at IS NULL
          AND (p.barcode = b.code OR p.sku = b.code
               OR p.id IN (SELECT pb.product_id FROM product_barcodes pb WHERE pb.barcode = b.code))`, [barcodes]);
    lines.forEach((l, i) => {
      for (const r of rows.filter((x) => x.code === String(l.barcode || "").trim())) {
        const { code, ...toy } = r;
        add(out[i], toy, "barcode");
      }
    });
  }

  for (const o of out) o.chosen = o.matches.map((m) => m.product_id);

  // 3. A toy whose name ends in the code (this supplier's toys first).
  const open = lines.map((l, i) => ({ l, i })).filter(({ i, l }) => !out[i].matches.length && codeOf(l).length >= 3);
  if (open.length) {
    const { rows } = await db.query(
      `SELECT c.code, ${TOY_COLS}
         FROM unnest($1::text[], $2::text[]) AS c(code, pat)
         JOIN products p ON p.deleted_at IS NULL
          AND (LOWER(p.name) LIKE '%-' || c.pat ESCAPE '!'
               OR LOWER(p.name) LIKE '% ' || c.pat ESCAPE '!'
               OR LOWER(p.name) LIKE '%(' || c.pat || ')' ESCAPE '!')
        ORDER BY (p.supplier_id = $3) DESC NULLS LAST, p.name`,
      [open.map(({ l }) => codeOf(l).toLowerCase()), open.map(({ l }) => likeEscape(codeOf(l).toLowerCase())), supplierId]);
    for (const { l, i } of open) {
      for (const r of rows.filter((x) => x.code === codeOf(l).toLowerCase()).slice(0, 5)) {
        const { code, ...toy } = r;
        add(out[i], toy, "name_code");
      }
    }
  }

  // 4. A similar name among this supplier's toys.
  const stillOpen = lines.map((l, i) => ({ l, i })).filter(({ i, l }) => !out[i].matches.length && String(l.description || "").trim().length >= 4);
  if (stillOpen.length && supplierId) {
    try {
      const { rows } = await db.query(
        `SELECT d.idx, ${TOY_COLS}
           FROM unnest($1::int[], $2::text[]) AS d(idx, descr)
           CROSS JOIN LATERAL (
             SELECT p.* FROM products p
              WHERE p.deleted_at IS NULL AND p.supplier_id = $3
                AND public.similarity(p.name, d.descr) > 0.4
              ORDER BY public.similarity(p.name, d.descr) DESC
              LIMIT 3) p`,
        [stillOpen.map(({ i }) => i), stillOpen.map(({ l }) => String(l.description)), supplierId]);
      for (const r of rows) {
        const { idx, ...toy } = r;
        add(out[idx], toy, "similar");
      }
    } catch {
      // pg_trgm not installed: no similar-name suggestions
    }
  }

  // 5. Step (d): for a line that may be a new toy, the most similar toy of this
  // supplier (looser than 4.): its category and brand are the new toy's
  // suggestion (owner: "suggested from the most similar existing toy").
  const maybeNew = lines.map((l, i) => ({ l, i })).filter(({ i, l }) => !out[i].chosen.length && String(l.description || "").trim().length >= 3);
  if (maybeNew.length && supplierId) {
    try {
      const { rows } = await db.query(
        `SELECT d.idx, p.name, p.category_id, p.brand_id, (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name
           FROM unnest($1::int[], $2::text[]) AS d(idx, descr)
           CROSS JOIN LATERAL (
             SELECT p.* FROM products p
              WHERE p.deleted_at IS NULL AND p.supplier_id = $3 AND p.category_id IS NOT NULL
                AND public.similarity(p.name, d.descr) > 0.2
              ORDER BY public.similarity(p.name, d.descr) DESC
              LIMIT 1) p`,
        [maybeNew.map(({ i }) => i), maybeNew.map(({ l }) => String(l.description)), supplierId]);
      for (const r of rows) {
        const { idx, ...like } = r;
        out[idx].like = like;
      }
    } catch {
      // pg_trgm not installed: no suggestion, the shop chooses
    }
  }

  return out;
}

module.exports = { matchBillLines };

// Price sheet: update the selling price and cost of EXISTING items from a
// spreadsheet (One Toy Store pilot, Phase B step 6c; owner decisions
// 2026-09-27, see docs/onetoystore-pilot/PROGRESS.md):
//  - a row is matched by SKU, else by barcode, against products and variants;
//    a SKU and a barcode that point at two different items is an error;
//  - only price and cost change; a blank cell keeps the current value;
//  - a row that matches nothing is "not_found" and never creates an item;
//  - the parent of a product with variants is not priced (each variant is).
// Changed selling prices reach "Labels to reprint" through the v141 triggers.

function parseMoney(raw, label, errors) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) { errors.push(`${label} "${s}" is not a number`); return null; }
  if (n < 0) { errors.push(`${label} can't be negative`); return null; }
  return Math.round(n * 100) / 100;
}

async function loadItems(db) {
  const { rows: products } = await db.query(
    `SELECT id, name, sku, barcode, price, cost_price, has_variants,
            EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) AS has_variant_rows
       FROM products p
      WHERE p.deleted_at IS NULL`,
  );
  const { rows: variants } = await db.query(
    `SELECT v.id, v.product_id, v.sku, v.barcode, v.price, v.cost_price, p.name,
            COALESCE(
              (SELECT string_agg(ao.value, ' / ' ORDER BY a.id)
                 FROM variant_option_values vov
                 JOIN attributes a ON a.id = vov.attribute_id
                 JOIN attribute_options ao ON ao.id = vov.attribute_option_id
                WHERE vov.variant_id = v.id),
              ''
            ) AS options_label
       FROM product_variants v
       JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL`,
  );
  const items = [];
  for (const p of products) {
    items.push({
      key: `p${p.id}`, product_id: p.id, variant_id: null, item_name: p.name, variant_label: null,
      sku: p.sku, barcode: p.barcode, price: Number(p.price), cost: Number(p.cost_price || 0),
      is_variant_parent: Boolean(p.has_variants || p.has_variant_rows),
    });
  }
  for (const v of variants) {
    items.push({
      key: `v${v.id}`, product_id: v.product_id, variant_id: v.id, item_name: v.name,
      variant_label: v.options_label || v.sku || `#${v.id}`,
      sku: v.sku, barcode: v.barcode, price: Number(v.price), cost: Number(v.cost_price || 0),
      is_variant_parent: false,
    });
  }
  const index = (field) => {
    const m = new Map();
    for (const it of items) {
      const k = String(it[field] || "").trim().toLowerCase();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  };
  return { bySku: index("sku"), byBarcode: index("barcode") };
}

// rows: normalised sheet rows (lower-case keys). Returns one result per row, in
// file order, with _row = the spreadsheet line number (header is line 1).
async function matchPriceSheet(db, rows) {
  const { bySku, byBarcode } = await loadItems(db);
  const seen = new Map(); // item key -> first row number
  const out = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const sku = String(r.sku ?? "").trim();
    const barcode = String(r.barcode ?? "").trim();
    const errors = [];
    const base = { _row: rowNum, sku, barcode, sheet_name: String(r.name ?? "").trim() };

    const newPriceIn = parseMoney(r.selling_price ?? r.price, "selling_price", errors);
    const newCostIn = parseMoney(r.cost_price ?? r.cost, "cost_price", errors);
    const priceGiven = String(r.selling_price ?? r.price ?? "").trim() !== "";
    const costGiven = String(r.cost_price ?? r.cost ?? "").trim() !== "";
    if (!priceGiven && !costGiven) errors.push("no selling_price or cost_price on this row");
    if (!sku && !barcode) errors.push("needs a SKU or a barcode");

    const skuHits = sku ? bySku.get(sku.toLowerCase()) || [] : [];
    const bcHits = barcode ? byBarcode.get(barcode.toLowerCase()) || [] : [];
    let item = null;
    if (skuHits.length > 1) errors.push(`SKU "${sku}" is on more than one item`);
    else if (skuHits.length === 1) {
      item = skuHits[0];
      if (bcHits.length && !bcHits.some((b) => b.key === item.key)) {
        errors.push(`SKU "${sku}" and barcode "${barcode}" are on different items`);
        item = null;
      }
    } else if (bcHits.length > 1) errors.push(`barcode "${barcode}" is on more than one item`);
    else if (bcHits.length === 1) item = bcHits[0];

    if (!item && !errors.length) { out.push({ ...base, status: "not_found", _errors: [] }); return; }
    if (!item) { out.push({ ...base, status: "error", _errors: errors }); return; }

    const matched = {
      product_id: item.product_id, variant_id: item.variant_id, item_name: item.item_name,
      variant_label: item.variant_label, old_price: item.price, old_cost: item.cost,
    };
    if (item.is_variant_parent) {
      errors.push("this product has variants: put each variant's own SKU or barcode on the sheet");
    }
    const first = seen.get(item.key);
    if (first !== undefined) errors.push(`same item as row ${first}`);
    else seen.set(item.key, rowNum);

    if (errors.length) { out.push({ ...base, ...matched, status: "error", _errors: errors }); return; }

    const new_price = newPriceIn ?? item.price;
    const new_cost = newCostIn ?? item.cost;
    const changed = new_price !== item.price || new_cost !== item.cost;
    out.push({
      ...base, ...matched, new_price, new_cost,
      below_cost: new_cost > 0 && new_price < new_cost,
      status: changed ? "change" : "unchanged",
      _errors: [],
    });
  });
  return out;
}

function summarise(results) {
  const summary = { change: 0, unchanged: 0, not_found: 0, error: 0 };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

// Apply the "change" rows among selectedRows, inside the caller's transaction.
async function applyPriceSheet(client, results, selectedRows) {
  const pick = new Set(selectedRows.map(Number));
  let updated = 0;
  for (const r of results) {
    if (r.status !== "change" || !pick.has(r._row)) continue;
    if (r.variant_id) {
      await client.query(
        "UPDATE product_variants SET price = $1, cost_price = $2 WHERE id = $3 AND product_id = $4",
        [r.new_price, r.new_cost, r.variant_id, r.product_id],
      );
    } else {
      await client.query(
        "UPDATE products SET price = $1, cost_price = $2 WHERE id = $3",
        [r.new_price, r.new_cost, r.product_id],
      );
    }
    updated += 1;
  }
  return updated;
}

module.exports = { matchPriceSheet, applyPriceSheet, summarise };

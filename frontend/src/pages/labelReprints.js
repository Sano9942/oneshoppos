// "Labels to reprint" helpers (One Toy Store pilot, Phase B step 6).
// The backend lists every item whose selling price changed (or that is new)
// since its last label; printing a label at the current price clears it.

// A variant is its own label, so the queue keys on product AND variant.
export function queueKey(item) {
  return `${item.product_id}:${item.variant_id || 0}`;
}

export function reprintRowToQueueItem(row) {
  return {
    product_id: row.product_id,
    variant_id: row.variant_id || null,
    name: row.variant_sku ? `${row.name} – ${row.variant_sku}` : row.name,
    barcode: row.barcode || "",
    sku: row.sku || "",
    price: Number(row.new_price),
    brand: row.brand_name || "",
    copies: 1,
  };
}

// Adding an item already in the queue adds a copy instead of a second line.
export function addToQueue(queue, item) {
  const key = queueKey(item);
  if (queue.some((i) => queueKey(i) === key)) {
    return queue.map((i) => (queueKey(i) === key ? { ...i, copies: i.copies + 1 } : i));
  }
  return [...queue, item];
}

// The label page's product search (step 6b): every item that gets its own
// label. A product with variants is listed per variant (own barcode + price),
// never as the parent; a variant without its own price uses the parent's.
export function buildLabelPickList(products, variants) {
  const byProduct = new Map();
  for (const v of variants || []) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }
  const list = [];
  for (const p of products || []) {
    const vs = byProduct.get(p.id);
    if (!vs?.length) {
      list.push({
        product_id: p.id, variant_id: null, name: p.name,
        barcode: p.barcode || "", sku: p.sku || "", price: Number(p.price),
        brand: p.brand_name || "", copies: 1,
      });
      continue;
    }
    for (const v of vs) {
      const label = (v.options || []).map((o) => o.option_value).filter(Boolean).join(" / ") || v.sku || `#${v.id}`;
      list.push({
        product_id: p.id, variant_id: v.id, name: `${p.name} – ${label}`,
        barcode: v.barcode || "", sku: v.sku || "",
        price: Number(v.price ?? p.price), brand: p.brand_name || "", copies: 1,
      });
    }
  }
  return list;
}

export function searchLabelPickList(list, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((i) =>
    i.name.toLowerCase().includes(q) ||
    i.barcode.toLowerCase().includes(q) ||
    i.sku.toLowerCase().includes(q));
}

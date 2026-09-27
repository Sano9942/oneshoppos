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

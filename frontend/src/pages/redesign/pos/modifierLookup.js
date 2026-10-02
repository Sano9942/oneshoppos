// D62 (One Toy Store pilot): whether adding this item to the cart must first
// ask the server for its restaurant add-ons (GET /api/products/:id/modifier-tree,
// gated by the phase4_restaurant feature). A shop without that feature got a
// refusal on every add, an extra ~0.5 s server trip per item at the till.
// Bundles and items from the offline catalogue copy never ask.
export function needsModifierLookup(product, posFlags = {}) {
  if (!posFlags?.phase4_restaurant) return false;
  return !(product?.is_bundle || product?.stock_unknown);
}

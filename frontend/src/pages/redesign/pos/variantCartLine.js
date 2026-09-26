// Cart line for one variant of a product. Shared by the variant picker
// (POSVariantMatrixModal) and every barcode-scan path, which get a `variant`
// back from /api/products/scan when the scanned code is a variant's own
// barcode/SKU (e.g. one car in a Hot Wheels assortment).
//
// id is the variant id so each variant is its own cart line; the sale route
// books the line against original_product_id.
export function variantCartLine(product, variant, label = "") {
  const parentName = product?.name || "Variant";
  const stock = Number(variant.stock_at_outlet ?? variant.stock ?? 0);
  return {
    id: variant.id,
    original_product_id: product?.id ?? variant.product_id,
    variant_id: variant.id,
    name: label ? `${parentName} (${label})` : parentName,
    price: Number(variant.price ?? product?.price ?? 0),
    cost_price: Number(variant.cost_price ?? product?.cost_price ?? 0),
    barcode: variant.barcode || product?.barcode || null,
    sku: variant.sku || null,
    unit: product?.unit || null,
    stock,
    local_stock: stock,
    tax: product?.tax ?? null,
    gst: product?.gst ?? null,
    // Offline catalogue copy: stock unknown, so the cart doesn't call it out of stock.
    ...(variant.stock_unknown ? { stock_unknown: true } : {}),
  };
}

// Which optional sections the product page shows (One Toy Store pilot,
// 2026-10-21). Each one follows the feature it belongs to, and is also shown
// whenever this product already has something in it, so nothing typed in is
// ever hidden. Pure, so the rules are testable without rendering the page.

const WHOLESALE_FLAGS = [
  "wholesale_credit_controls", "wholesale_field_sales", "wholesale_schemes",
  "wholesale_secondary_sales", "wholesale_backorders", "wholesale_van_sales",
];

const filled = (v) => v !== "" && v != null;
const positive = (v) => Number(v) > 0;

export function productFormSections({ flags, preset, form, isEdit, taxMode, attributeSets, channels, reviews, usage }) {
  const f = flags || {};
  const u = usage || {};
  const wholesaleOn = WHOLESALE_FLAGS.some((k) => f[k]);
  const anyPublished = (channels || []).some((c) => c.is_published);
  const storefrontPublished = (channels || []).some((c) => c.code === "storefront" && c.is_published);
  // marketplace_integrations is ON by default and can't be switched off by
  // the shop, so channel things follow real use (GET /api/sales-channels/usage).
  return {
    compareAt: !!u.in_use || positive(form.compare_at_price),
    gst: taxMode !== "none" || positive(form.gst),
    recipe: !!f.kit_bom_engine || form.bom_type !== "standard",
    // The variants switch is locked once a product exists, and variants need
    // an attribute set, so it only matters on a new product in a shop that has one.
    variants: !!form.has_variants || (!isEdit && (attributeSets || []).length > 0),
    // Only the built-in web store reads these switches; Shopify / the till don't.
    salesChannels: !!isEdit && (channels || []).length > 0 && (!!u.in_use || anyPublished),
    productTypeVendorTags: !!u.marketplace_connected || !!f.phase2_smart_collections
      || filled(form.product_type) || filled(form.vendor) || filled(form.tags),
    // safety_stock_days carries a default (3) on every product, so only the
    // lead-time override counts as "filled in".
    inventoryIntelligence: !!f.phase2g_inventory_intelligence || filled(form.lead_time_days_override),
    wholesale: wholesaleOn || filled(form.min_order_qty) || filled(form.order_increment),
    catalogVisibility: wholesaleOn || form.visibility === "restricted",
    counterLane: !!preset?.pos_search_config?.show_plu || filled(form.plu_code) || !!form.age_restricted,
    reviews: !!isEdit && ((reviews || []).length > 0 || storefrontPublished),
  };
}

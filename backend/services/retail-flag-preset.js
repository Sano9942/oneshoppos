'use strict';

/**
 * services/retail-flag-preset.js
 *
 * Industry flag presets for setup-wizard completion.
 *
 * RETAIL_SEED_FLAGS: 19 flags enabled when `industry_type === 'general_retail'`.
 *   Split into three buckets: core polish, opt-in extras, and integrations.
 *
 * RESTAURANT_SEED_FLAGS: 10 flags enabled when `industry_type === 'restaurant'`
 *   or `'cafe'`. Subset of retail tuned for F&B — keeps loyalty / gift cards /
 *   manager override / risk controls / SMS / digest / delivery integrations,
 *   drops retail-specific flags (variant picker, holds, draft orders,
 *   inventory intelligence, item suggestions, label designer, omni input,
 *   per-line restock, receipt barcode lookup) since restaurants get the same
 *   UX through floor plan / tabs / KDS / menu engineering instead.
 *
 * MULTI_OUTLET_SEED_FLAGS: 5 flags enabled the first time a tenant transitions
 *   from 1 → 2 outlets. `kiosk_context_locked` is intentionally NOT in this
 *   list — it stays opt-in even after the multi-outlet upgrade.
 *
 * All seeders take a transaction client (`client`) so they join the caller's
 * transaction. Pattern matches the existing mode-based seeder in
 * routes/setup.js (1d / 1e).
 */

const RETAIL_SEED_FLAGS = [
  // Core retail polish (8)
  "phase2g_omni_input",
  "phase2g_variant_picker",
  "phase2g_price_override",
  "phase2g_receipt_barcode_lookup",
  "phase2g_per_line_restock",
  "phase2_pos_approvals",
  "phase2g_risk_controls",
  "retail_weekly_digest",

  // Opt-in extras (7)
  "phase2g_gift_cards",
  "phase2g_loyalty",
  "phase2g_holds",
  "phase2g_inventory_intelligence",
  "phase2g_label_designer",
  "phase2_draft_orders",
  "phase2_item_suggestions",

  // Integrations (4)
  "phase5_cod_reconciliation",
  "phase5_shipping_automation",
  "phase5_sms_providers",
  "sms_campaigns",
];

const RESTAURANT_SEED_FLAGS = [
  // Customer engagement (4) — loyalty + gift cards are core F&B revenue
  // levers; SMS pair turns on the Marketing → Campaigns surface (inert
  // until the tenant configures a provider, same as retail).
  "phase2g_loyalty",
  "phase2g_gift_cards",
  "sms_campaigns",
  "phase5_sms_providers",

  // Floor / staff control (3) — comps, void approvals, manager overrides.
  // Pairs with manage_restaurant + override_void_comp + override_price perms
  // already on the Manager role default.
  "phase2g_price_override",
  "phase2_pos_approvals",
  "phase2g_risk_controls",

  // Owner visibility (1) — Monday-morning revenue digest; industry-agnostic
  // despite the "retail_" prefix.
  "retail_weekly_digest",

  // Delivery integrations (2) — for restaurants running their own delivery
  // fleet (cash on delivery + dispatch automation). Inert until the tenant
  // configures couriers, so safe to enable by default.
  "phase5_cod_reconciliation",
  "phase5_shipping_automation",
];

const MULTI_OUTLET_SEED_FLAGS = [
  "context_selection_required",
  "context_header_enforced",
  "phase2_outlet_pricing",
  "phase2_outlet_visibility",
  "phase2g_price_books",
];

async function seedRetailFlags(client) {
  for (const key of RETAIL_SEED_FLAGS) {
    await client.query(
      `INSERT INTO feature_flags (key, enabled)
       VALUES ($1, true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
      [key]
    );
  }
}

async function seedRestaurantFlags(client) {
  for (const key of RESTAURANT_SEED_FLAGS) {
    await client.query(
      `INSERT INTO feature_flags (key, enabled)
       VALUES ($1, true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
      [key]
    );
  }
}

async function seedMultiOutletFlags(client) {
  for (const key of MULTI_OUTLET_SEED_FLAGS) {
    await client.query(
      `INSERT INTO feature_flags (key, enabled)
       VALUES ($1, true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
      [key]
    );
  }
}

module.exports = {
  RETAIL_SEED_FLAGS,
  RESTAURANT_SEED_FLAGS,
  MULTI_OUTLET_SEED_FLAGS,
  seedRetailFlags,
  seedRestaurantFlags,
  seedMultiOutletFlags,
};

'use strict';

/**
 * services/retail-flag-preset.js
 *
 * Retail launch flag presets (PR 2 + PR 5 of the retail launch build plan).
 *
 * RETAIL_SEED_FLAGS: 19 flags enabled at setup-wizard completion when the
 *   merchant picks `industry_type === 'general_retail'`. Split into three
 *   buckets so the intent stays legible: core polish, opt-in extras, and
 *   integrations.
 *
 * MULTI_OUTLET_SEED_FLAGS: 5 flags enabled the first time a tenant transitions
 *   from 1 → 2 outlets. `kiosk_context_locked` is intentionally NOT in this
 *   list — it stays opt-in even after the multi-outlet upgrade.
 *
 * Both seeders take a transaction client (`client`) so they join the caller's
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
  MULTI_OUTLET_SEED_FLAGS,
  seedRetailFlags,
  seedMultiOutletFlags,
};

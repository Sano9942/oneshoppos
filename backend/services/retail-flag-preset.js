'use strict';

/**
 * services/retail-flag-preset.js
 *
 * Industry flag presets for setup-wizard completion.
 *
 * RETAIL_SEED_FLAGS: 19 flags enabled when `industry_type === 'general_retail'`.
 *   Split into three buckets: core polish, opt-in extras, and integrations.
 *
 * RESTAURANT_SEED_FLAGS: 11 flags enabled when `industry_type === 'restaurant'`
 *   or `'cafe'`. Subset of retail tuned for F&B — keeps loyalty / gift cards /
 *   manager override / risk controls / SMS / digest / delivery integrations,
 *   drops retail-specific flags (variant picker, holds, inventory intelligence,
 *   item suggestions, label designer, omni input, per-line restock, receipt
 *   barcode lookup) since restaurants get the same UX through floor plan /
 *   tabs / KDS / menu engineering instead. `phase2_draft_orders` IS included
 *   because POSContext.ensureDraftOrder backs every restaurant check with a
 *   draft_orders row — without the flag, fire-course / send-to-kitchen 403.
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

  // POS plumbing (1) — gates POST /api/draft-orders. The restaurant POS
  // (POSContext.ensureDraftOrder) lazily creates a draft for every check on
  // first kitchen action, so this flag is mandatory for fire-course /
  // send-to-kitchen / pay-at-table flows. Without it the entire restaurant
  // POS path 403s on the first interaction.
  "phase2_draft_orders",
];

// Wholesale-only flags that ship ON for any tenant signing up with
// `industry_type === 'wholesale'`. These layer ON TOP of seedRetailFlags
// (wholesale tenants still use the retail POS + price lists + COD pieces),
// so setup.js calls seedRetailFlags first and then seedWholesaleFlags.
//
// All four feature surfaces are inert until the tenant configures them:
//   - wholesale_credit_controls: shows the "Credit & A/R" SectionCard on
//     Customer detail. No customer has a credit limit by default, so the
//     POS "On Account" tender stays disabled until the admin sets one.
//   - wholesale_field_sales: surfaces /field/* routes and the Field Summary
//     dashboard widget IFF the tenant has an employee with
//     employee_type='field_rep'. New signups have none, so the surface is
//     latent until they add a rep — which is itself an explicit action.
//   - wholesale_schemes: extends the existing /promotions admin page with
//     the slab-tier editor + brand picker + priority field. Owners who
//     don't need schemes just don't open that surface — no POS impact
//     until a slab_percent promotion is actually defined.
//   - wholesale_secondary_sales: enables the /settings/manufacturer-partners
//     admin page. The manufacturer portal is unreachable until an admin
//     invites the first partner. No tenant-side or POS impact until then.
const WHOLESALE_SEED_FLAGS = [
  "wholesale_credit_controls",
  "wholesale_field_sales",
  "wholesale_schemes",
  "wholesale_secondary_sales",
  // V02 wholesale depth — backorders/partial fulfillment + van sales. Like
  // the flags above, both are latent surfaces: no POS impact until a
  // shortfall offer is accepted / a van outlet is created.
  "wholesale_backorders",
  "wholesale_van_sales",
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

async function seedWholesaleFlags(client) {
  for (const key of WHOLESALE_SEED_FLAGS) {
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
  WHOLESALE_SEED_FLAGS,
  MULTI_OUTLET_SEED_FLAGS,
  seedRetailFlags,
  seedRestaurantFlags,
  seedWholesaleFlags,
  seedMultiOutletFlags,
};

"use strict";

/**
 * services/preset-apply.js
 *
 * Single implementation of "apply industry preset X to this tenant" —
 * modes reset + mode-derived flags + preset extra flags, optionally the
 * signup flag bundles too.
 *
 * Call paths (audit them all when changing semantics — parallel-paths rule):
 *   1. routes/tier4/company-profile.js PUT  — tenant-side preset switch
 *      (modes + extras only, bundles deliberately NOT re-run: a preset
 *      switch must not silently re-enable loyalty/SMS the owner turned off).
 *   2. routes/admin/tenants.js reapply-preset — super-admin repair action
 *      (can opt into include_bundles to fix a mis-seeded tenant).
 *   3. routes/setup.js — signup wizard. NOT routed through this service:
 *      it seeds modes/flags inside the provisioning transaction alongside
 *      demo data and country packs; keep it as the reference for bundle
 *      composition.
 *
 * `db` is any query-capable handle scoped to ONE tenant schema (the ALS
 * tenant proxy, a buildTenantScopedDb wrapper, or a transaction client).
 * Cache invalidation is the CALLER's job (invalidateModeCache /
 * invalidateFeatureFlagCache / invalidateCompanyProfileCache).
 */

const { getPreset, VALID_INDUSTRY_TYPES, getExtraFlagsForPreset, ALL_PRESET_EXTRA_FLAGS } = require("../config/industry-config");
const { getFeatureFlagsForModes, VALID_MODES } = require("../config/mode-registry");
const {
  seedRetailFlags,
  seedRestaurantFlags,
  seedWholesaleFlags,
  seedSalonFlags,
  seedRetailSubtypeFlags,
  RETAIL_BUNDLE_INDUSTRIES,
} = require("./retail-flag-preset");

async function applyPreset(db, industryType, { includeBundles = false } = {}) {
  if (!VALID_INDUSTRY_TYPES.includes(industryType)) {
    throw new Error(`Unknown industry_type: ${industryType}`);
  }
  const preset = getPreset(industryType);

  await db.query(
    `UPDATE company_profile SET
       industry_type = $1,
       business_model = $2,
       industry_preset_version = 1
     WHERE id = 1`,
    [preset.industry_type, preset.business_model]
  );

  // Clear old modes and seed new ones.
  await db.query("DELETE FROM tenant_modes");
  for (const mode of preset.modes) {
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled, enabled_at) VALUES ($1, true, NOW()) ON CONFLICT (mode) DO NOTHING`,
      [mode]
    );
  }

  // Disable all mode-derived flags first, then enable the new preset's.
  // Derived from MODE_REGISTRY so adding a new mode auto-extends the reset
  // list (see M7 post-mortem: phase4_rentals missed from a hardcoded array).
  const ALL_MODE_FLAGS = getFeatureFlagsForModes(VALID_MODES);
  for (const flagKey of ALL_MODE_FLAGS) {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, false) ON CONFLICT (key) DO UPDATE SET enabled = false`,
      [flagKey]
    );
  }
  for (const flagKey of getFeatureFlagsForModes(preset.modes)) {
    await db.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [flagKey]);
  }

  // Preset extra flags (V04/V05/V07 …): sub-features modes can't derive.
  // Reset ALL known extras OFF, then flip this preset's ON — symmetric with
  // the mode-flag reset so a preset switch leaves no stale extras.
  for (const flagKey of ALL_PRESET_EXTRA_FLAGS) {
    await db.query(`UPDATE feature_flags SET enabled = false WHERE key = $1`, [flagKey]);
  }
  for (const flagKey of getExtraFlagsForPreset(preset.industry_type)) {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
      [flagKey]
    );
  }

  // Signup flag bundles — mirrors routes/setup.js 1f/1g exactly. Opt-in:
  // only the admin repair action re-runs these (they're additive ONs, so
  // re-running never strips a manual opt-in, but it can re-enable flags an
  // owner deliberately turned off — hence not the default).
  if (includeBundles) {
    if (RETAIL_BUNDLE_INDUSTRIES.includes(industryType)) {
      await seedRetailFlags(db);
      await seedRetailSubtypeFlags(db, industryType);
    } else if (industryType === "restaurant" || industryType === "cafe") {
      await seedRestaurantFlags(db);
    } else if (industryType === "salon") {
      await seedSalonFlags(db);
    }
    if (industryType === "wholesale") {
      await seedWholesaleFlags(db);
    }
  }

  return preset;
}

/**
 * Compute the preset-expected flag set for a tenant without changing
 * anything. Layers (see docs/fable5/admin-refresh/PLAN.md §1.3):
 * mode flags + preset extras + signup bundle (+subtype) + multi-outlet
 * bundle when outletCount > 1. Manual opt-ins are NOT expected-set members —
 * they show up as `extra` in the drift diff, which is informational.
 */
function expectedFlagsForPreset(industryType, { outletCount = 1 } = {}) {
  const { MULTI_OUTLET_SEED_FLAGS, RETAIL_SEED_FLAGS, RESTAURANT_SEED_FLAGS, WHOLESALE_SEED_FLAGS, SALON_SEED_FLAGS, RETAIL_SUBTYPE_FLAGS } = require("./retail-flag-preset");
  const preset = getPreset(industryType);
  const expected = new Set();

  for (const flag of getFeatureFlagsForModes(preset.modes)) expected.add(flag);
  for (const flag of getExtraFlagsForPreset(preset.industry_type)) expected.add(flag);

  if (RETAIL_BUNDLE_INDUSTRIES.includes(preset.industry_type)) {
    for (const flag of RETAIL_SEED_FLAGS) expected.add(flag);
    for (const flag of RETAIL_SUBTYPE_FLAGS[preset.industry_type] || []) expected.add(flag);
  } else if (preset.industry_type === "restaurant" || preset.industry_type === "cafe") {
    for (const flag of RESTAURANT_SEED_FLAGS) expected.add(flag);
  } else if (preset.industry_type === "salon") {
    for (const flag of SALON_SEED_FLAGS) expected.add(flag);
  }
  if (preset.industry_type === "wholesale") {
    for (const flag of WHOLESALE_SEED_FLAGS) expected.add(flag);
  }
  if (outletCount > 1) {
    for (const flag of MULTI_OUTLET_SEED_FLAGS) expected.add(flag);
  }
  return [...expected].sort();
}

module.exports = { applyPreset, expectedFlagsForPreset };

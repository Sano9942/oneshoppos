"use strict";

const MODE_REGISTRY = Object.freeze({
  restaurant: {
    description: "Restaurant floor plans, tables, checks, KDS",
    feature_flags_to_enable: [
      "phase4_restaurant",
      "phase4_restaurant_kds",
      "phase4_restaurant_qr",
      "phase4_restaurant_86",
      "phase4_restaurant_void_comp",
      "phase4_restaurant_pay_at_table",
      "phase4_restaurant_reservations",
      "phase4_restaurant_kds_analytics",
      "phase4_restaurant_day_parting",
      "phase4_restaurant_fire_chits",
      "phase4_restaurant_drive_thru",
      "phase4_restaurant_menu_engineering",
    ],
  },
  appointments: {
    description: "Appointment booking, services calendar, staff scheduling",
    feature_flags_to_enable: [
      "phase4_appointments",
    ],
  },
  commissions: {
    description: "Commission plans and employee commission tracking",
    feature_flags_to_enable: [
      "phase2_commissions",
    ],
  },
  service_projects: {
    description: "Quotations, projects, contracts, milestone invoicing",
    feature_flags_to_enable: [
      "phase4_service_projects",
      "phase4_service_contracts",
    ],
  },
  subscriptions: {
    description: "Recurring billing, memberships, renewal tracking",
    feature_flags_to_enable: [
      "subscription_billing",
    ],
  },
  workflow_tickets: {
    description: "Service tickets, repair/alteration tracking, deposits, final invoicing",
    feature_flags_to_enable: [
      "phase4_workflow_tickets",
    ],
  },
  rentals: {
    description: "Asset/equipment rental with check-out, return, and late-fee tracking",
    feature_flags_to_enable: [
      "phase4_rentals",
    ],
  },
  room_management: {
    description: "Hotel / guesthouse / hostel — room inventory, bookings, folios, housekeeping",
    feature_flags_to_enable: [
      "phase4_room_management",
    ],
  },
  treatment_plans: {
    description: "Multi-visit clinical plans (dental, vet, physio) — charting, lab orders, consent, folios",
    feature_flags_to_enable: [
      "phase4_treatment_plans",
    ],
  },
  wholesale: {
    description: "B2B distribution — credit limits, AR aging, customer statements, payment terms",
    feature_flags_to_enable: [
      "wholesale_credit_controls",
    ],
  },
});

const VALID_MODES = Object.keys(MODE_REGISTRY);

function getModeConfig(modeName) {
  return MODE_REGISTRY[modeName] || null;
}

function getFeatureFlagsForModes(modeNames) {
  const flags = new Set();
  for (const name of modeNames) {
    const config = MODE_REGISTRY[name];
    if (config) {
      for (const flag of config.feature_flags_to_enable) flags.add(flag);
    }
  }
  return [...flags];
}

/**
 * The single "is this mode in use for these flags?" predicate — a mode counts
 * as active when ANY of its registry flags is already on. Extracted so the
 * D5 full-materialization migration (migrate-pg.js v135) and the first-row
 * backfill (services/business-modules.js:backfillModesIfFirstRowTx) share one
 * definition instead of hand-rolling the `.some(...)` check in two places.
 */
function modeActiveForFlags(modeName, flags) {
  const cfg = MODE_REGISTRY[modeName];
  if (!cfg) return false;
  return cfg.feature_flags_to_enable.some((f) => Boolean(flags) && flags[f] === true);
}

/**
 * Return the full explicit mode-row set — every registry mode, enabled iff it
 * appears in enabledModeNames. Used by the provisioning seeders (setup wizard,
 * preset-apply) so a fresh/reset tenant materialises all |VALID_MODES| rows
 * (D5 / PLAN-V2 Step 5) rather than only the enabled ones. Pure — the caller
 * runs the INSERT with whatever ON CONFLICT semantics it needs.
 */
function fullModeRows(enabledModeNames) {
  const enabled = new Set(enabledModeNames || []);
  return VALID_MODES.map((mode) => ({ mode, enabled: enabled.has(mode) }));
}

module.exports = {
  MODE_REGISTRY,
  VALID_MODES,
  getModeConfig,
  getFeatureFlagsForModes,
  modeActiveForFlags,
  fullModeRows,
};

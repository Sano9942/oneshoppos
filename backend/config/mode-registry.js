"use strict";

const MODE_REGISTRY = Object.freeze({
  restaurant: {
    description: "Restaurant floor plans, tables, checks, KDS",
    feature_flags_to_enable: [
      "phase4_restaurant",
      "phase4_restaurant_kds",
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

module.exports = {
  MODE_REGISTRY,
  VALID_MODES,
  getModeConfig,
  getFeatureFlagsForModes,
};

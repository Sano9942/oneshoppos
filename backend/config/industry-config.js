"use strict";

const INDUSTRY_PRESETS = Object.freeze({
  general_retail: {
    industry_type: "general_retail",
    business_model: "buy_sell",
    display_name: "Retail Store",
    modes: [],
    labels: {
      product: "Product",
      products: "Products",
      customer: "Customer",
      customers: "Customers",
      sale: "Sale",
      order: "Order",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "grid",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  },
  restaurant: {
    industry_type: "restaurant",
    business_model: "food_service",
    display_name: "Restaurant / Cafe",
    modes: ["restaurant"],
    labels: {
      product: "Menu Item",
      products: "Menu",
      customer: "Guest",
      customers: "Guests",
      sale: "Order",
      order: "Order",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: true,
      appointments_today: false,
    },
    onboarding_steps: ["store", "menu_item", "floor_plan", "shift", "order"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Inventory", "Operations", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: false },
  },
  salon: {
    industry_type: "salon",
    business_model: "service_appointment",
    display_name: "Salon / Services",
    modes: ["appointments", "commissions"],
    labels: {
      product: "Service",
      products: "Services",
      customer: "Client",
      customers: "Clients",
      sale: "Appointment",
      order: "Booking",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: true,
    },
    onboarding_steps: ["store", "service", "employees", "calendar", "booking"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: true },
  },
  grocery: {
    industry_type: "grocery",
    business_model: "buy_sell",
    display_name: "Grocery / Supermarket",
    modes: [],
    labels: {
      product: "Product",
      products: "Products",
      customer: "Customer",
      customers: "Customers",
      sale: "Sale",
      order: "Order",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "grid",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  },
  cafe: {
    industry_type: "cafe",
    business_model: "food_service",
    display_name: "Cafe / Quick Service",
    modes: ["restaurant"],
    labels: {
      product: "Menu Item",
      products: "Menu",
      customer: "Customer",
      customers: "Customers",
      sale: "Order",
      order: "Order",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "menu_item", "employees", "shift", "order"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Inventory", "Operations", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: false },
  },
  clinic: {
    industry_type: "clinic",
    business_model: "service_appointment",
    display_name: "Clinic / Practice",
    modes: ["appointments"],
    labels: {
      product: "Service",
      products: "Services",
      customer: "Patient",
      customers: "Patients",
      sale: "Visit",
      order: "Appointment",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: true,
    },
    onboarding_steps: ["store", "service", "employees", "calendar", "booking"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: true },
  },
  repair_shop: {
    industry_type: "repair_shop",
    business_model: "service_ticket",
    display_name: "Repair / Service Shop",
    modes: ["workflow_tickets"],
    labels: {
      product: "Service",
      products: "Services",
      customer: "Customer",
      customers: "Customers",
      sale: "Repair",
      order: "Job Ticket",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "service", "employees", "shift", "ticket"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Inventory", "Operations", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: true },
  },
  gym: {
    industry_type: "gym",
    business_model: "subscription_service",
    display_name: "Gym / Fitness Studio",
    modes: ["subscriptions", "appointments"],
    labels: {
      product: "Plan",
      products: "Plans",
      customer: "Member",
      customers: "Members",
      sale: "Enrollment",
      order: "Booking",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: true,
    },
    onboarding_steps: ["store", "service", "employees", "membership", "booking"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: true },
  },
  wholesale: {
    industry_type: "wholesale",
    business_model: "b2b_distribution",
    display_name: "Wholesale / Distribution",
    modes: [],
    labels: {
      product: "Product",
      products: "Products",
      customer: "Buyer",
      customers: "Buyers",
      sale: "Invoice",
      order: "Order",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "grid",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  },
  photography_studio: {
    industry_type: "photography_studio",
    business_model: "project_service",
    display_name: "Photography / Creative Studio",
    modes: ["service_projects", "appointments"],
    labels: {
      product: "Package",
      products: "Packages",
      customer: "Client",
      customers: "Clients",
      sale: "Session",
      order: "Booking",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: true,
    },
    onboarding_steps: ["store", "service", "employees", "calendar", "booking"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: false, show_price: true },
  },
  // --- M5 weight-based selling presets ---
  butcher: {
    industry_type: "butcher",
    business_model: "buy_sell",
    display_name: "Butcher / Meat Shop",
    modes: [],
    labels: {
      product: "Cut",
      products: "Cuts",
      customer: "Customer",
      customers: "Customers",
      sale: "Sale",
      order: "Order",
      quantity_label: "Weight",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "list",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: false, show_price: true, show_tare: true },
    unit_vocabulary: ["kg", "g", "lb", "pcs"],
  },
  sweet_shop: {
    industry_type: "sweet_shop",
    business_model: "buy_sell",
    display_name: "Sweet Shop / Mithai",
    modes: [],
    labels: {
      product: "Sweet",
      products: "Sweets",
      customer: "Customer",
      customers: "Customers",
      sale: "Sale",
      order: "Order",
      quantity_label: "Weight",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "grid",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true, show_tare: true },
    unit_vocabulary: ["kg", "g", "dozen", "pcs", "pack"],
  },
  textile: {
    industry_type: "textile",
    business_model: "buy_sell",
    display_name: "Textile / Fabric",
    modes: [],
    labels: {
      product: "Fabric",
      products: "Fabrics",
      customer: "Customer",
      customers: "Customers",
      sale: "Sale",
      order: "Order",
      quantity_label: "Length",
    },
    dashboard_widgets: {
      inventory_alerts: true,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "product", "employees", "shift", "sale"],
    pos_layout_mode: "grid",
    visible_report_groups: null,
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true, show_tare: false },
    unit_vocabulary: ["m", "cm", "pcs", "pack"],
  },
});

const VALID_INDUSTRY_TYPES = Object.keys(INDUSTRY_PRESETS);
const DEFAULT_INDUSTRY_TYPE = "general_retail";

// Canonical set of units that represent weight or length. Products using any
// of these units are treated as "weighted" (decimal quantity input in POS,
// gross/tare/net support on receipt). Keep aligned with the same constant
// mirrored in frontend/src/contexts/PresetContext.jsx.
const WEIGHTED_UNITS = Object.freeze(["kg", "g", "lb", "oz", "m", "cm"]);

// Default unit vocabulary for presets that don't specify one.
const DEFAULT_UNIT_VOCABULARY = Object.freeze([
  "pcs", "kg", "g", "lb", "oz", "m", "cm", "dozen", "pack",
]);

// Fallback label keys added in M5 — presets may override.
const DEFAULT_EXTENDED_LABELS = Object.freeze({
  quantity_label: "Qty",
  customer_search_placeholder: "Search customer...",
});

function getPreset(industryType) {
  return INDUSTRY_PRESETS[industryType] || INDUSTRY_PRESETS[DEFAULT_INDUSTRY_TYPE];
}

function getPresetLabels(industryType) {
  const preset = getPreset(industryType);
  // Merge defaults for M5-added keys without mutating frozen preset.
  return { ...DEFAULT_EXTENDED_LABELS, ...preset.labels };
}

function getUnitVocabulary(industryType) {
  const preset = getPreset(industryType);
  return preset.unit_vocabulary
    ? [...preset.unit_vocabulary]
    : [...DEFAULT_UNIT_VOCABULARY];
}

function isWeightedUnit(unit) {
  if (!unit) return false;
  return WEIGHTED_UNITS.includes(String(unit).toLowerCase());
}

module.exports = {
  INDUSTRY_PRESETS,
  VALID_INDUSTRY_TYPES,
  DEFAULT_INDUSTRY_TYPE,
  WEIGHTED_UNITS,
  DEFAULT_UNIT_VOCABULARY,
  getPreset,
  getPresetLabels,
  getUnitVocabulary,
  isWeightedUnit,
};

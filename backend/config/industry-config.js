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
    public_booking_labels: {
      booking_cta: "Book an appointment",
      service_singular: "Service",
      staff_singular: "Stylist",
      customer_singular: "Client",
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
    public_booking_labels: {
      booking_cta: "Book a visit",
      service_singular: "Service",
      staff_singular: "Provider",
      customer_singular: "Patient",
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
    public_booking_labels: {
      booking_cta: "Book a session",
      service_singular: "Class",
      staff_singular: "Trainer",
      customer_singular: "Member",
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
    public_booking_labels: {
      booking_cta: "Book a session",
      service_singular: "Package",
      staff_singular: "Photographer",
      customer_singular: "Client",
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
  // --- M7 rentals presets ---
  car_rental: {
    industry_type: "car_rental",
    business_model: "asset_rental",
    display_name: "Car Rental / Vehicle Hire",
    modes: ["rentals"],
    labels: {
      product: "Vehicle",
      products: "Fleet",
      customer: "Renter",
      customers: "Renters",
      sale: "Contract",
      order: "Contract",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "rental_item", "employees", "contract", "checkout"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: false, show_sku: true, show_price: true },
  },
  equipment_hire: {
    industry_type: "equipment_hire",
    business_model: "asset_rental",
    display_name: "Equipment Hire / Tool Rental",
    modes: ["rentals"],
    labels: {
      product: "Equipment",
      products: "Equipment",
      customer: "Customer",
      customers: "Customers",
      sale: "Hire Contract",
      order: "Hire Contract",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "rental_item", "employees", "contract", "checkout"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  },
  furniture_rental: {
    industry_type: "furniture_rental",
    business_model: "asset_rental",
    display_name: "Furniture / Events Rental",
    modes: ["rentals"],
    labels: {
      product: "Item",
      products: "Items",
      customer: "Client",
      customers: "Clients",
      sale: "Rental Order",
      order: "Rental Order",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "rental_item", "employees", "contract", "checkout"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  },
  party_supplies: {
    industry_type: "party_supplies",
    business_model: "asset_rental",
    display_name: "Party Supplies / Event Rental",
    modes: ["rentals"],
    labels: {
      product: "Item",
      products: "Items",
      customer: "Customer",
      customers: "Customers",
      sale: "Rental Order",
      order: "Rental Order",
    },
    dashboard_widgets: {
      inventory_alerts: false,
      top_products: true,
      trends: true,
      attendance: true,
      floor_plan: false,
      appointments_today: false,
    },
    onboarding_steps: ["store", "rental_item", "employees", "contract", "checkout"],
    pos_layout_mode: "list",
    visible_report_groups: ["Sales", "Customers", "Finance", "HR", "Governance"],
    pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
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

// Default labels for the public booking page (M6). Presets that offer
// `appointments` mode override these via `public_booking_labels`.
const DEFAULT_PUBLIC_BOOKING_LABELS = Object.freeze({
  booking_cta: "Book an appointment",
  service_singular: "Service",
  staff_singular: "Staff",
  customer_singular: "Customer",
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

function getPublicBookingLabels(industryType) {
  const preset = getPreset(industryType);
  return { ...DEFAULT_PUBLIC_BOOKING_LABELS, ...(preset.public_booking_labels || {}) };
}

module.exports = {
  INDUSTRY_PRESETS,
  VALID_INDUSTRY_TYPES,
  DEFAULT_INDUSTRY_TYPE,
  WEIGHTED_UNITS,
  DEFAULT_UNIT_VOCABULARY,
  DEFAULT_PUBLIC_BOOKING_LABELS,
  getPreset,
  getPresetLabels,
  getUnitVocabulary,
  isWeightedUnit,
  getPublicBookingLabels,
};

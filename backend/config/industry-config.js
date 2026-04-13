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
  },
});

const VALID_INDUSTRY_TYPES = Object.keys(INDUSTRY_PRESETS);
const DEFAULT_INDUSTRY_TYPE = "general_retail";

function getPreset(industryType) {
  return INDUSTRY_PRESETS[industryType] || INDUSTRY_PRESETS[DEFAULT_INDUSTRY_TYPE];
}

function getPresetLabels(industryType) {
  return { ...getPreset(industryType).labels };
}

module.exports = {
  INDUSTRY_PRESETS,
  VALID_INDUSTRY_TYPES,
  DEFAULT_INDUSTRY_TYPE,
  getPreset,
  getPresetLabels,
};

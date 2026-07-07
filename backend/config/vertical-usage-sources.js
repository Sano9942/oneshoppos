/**
 * vertical-usage-sources.js
 *
 * Which per-tenant table backs each vertical mode. The `table` names are
 * schema-qualified at the call site (tenant_<slug>.<table>) and `where` is an
 * optional raw SQL fragment. Consumed by:
 *   - GET /api/admin/tenants/:id/vertical-usage  (routes/admin/tenants.js)
 *   - the adoption-snapshot worker               (workers/adoption-snapshot-worker-boss.js)
 *
 * `mode` links a source to one of config/mode-registry.js VALID_MODES (null for
 * sources not gated by a single mode, e.g. gift cards).
 */
const VERTICAL_USAGE_SOURCES = [
  { key: "appointments", label: "Appointments", table: "appointments", mode: "appointments" },
  { key: "restaurant_checks", label: "Restaurant checks", table: "draft_orders", mode: "restaurant",
    where: "order_context IS DISTINCT FROM 'retail'" },
  { key: "service_tickets", label: "Service tickets", table: "service_tickets", mode: "workflow_tickets" },
  { key: "projects", label: "Projects", table: "service_projects", mode: "service_projects" },
  { key: "contracts", label: "Contracts", table: "contracts", mode: "service_projects" },
  { key: "rental_contracts", label: "Rental contracts", table: "rental_contracts", mode: "rentals" },
  { key: "room_bookings", label: "Room bookings", table: "room_bookings", mode: "room_management" },
  { key: "treatment_plans", label: "Treatment plans", table: "treatment_plans", mode: "treatment_plans" },
  { key: "subscriptions", label: "Member subscriptions", table: "customer_subscriptions", mode: "subscriptions" },
  { key: "member_checkins", label: "Member check-ins", table: "member_checkins", mode: "subscriptions" },
  { key: "backorders", label: "Backorders", table: "backorders", mode: "wholesale" },
  { key: "field_visits", label: "Field visits", table: "field_visits", mode: "wholesale" },
  { key: "gift_cards", label: "Gift cards", table: "gift_cards", mode: null },
];

module.exports = { VERTICAL_USAGE_SOURCES };

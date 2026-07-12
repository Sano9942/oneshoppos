"use strict";

/**
 * config/permissions-catalog.js — the central registry of every live
 * permission string (docs/fable5/business-modules/PLAN.md Step 7).
 *
 * Sources combined to build this list (2026-07-10):
 *   - DEFAULT_ROLE_PERMISSIONS + PERMISSION_RULES (middleware/permissions.js)
 *   - every requirePerm("...")/requireAnyPerm([...]) call site under
 *     backend/routes/ (grep)
 *   - inline req.employeePerms.includes("...") checks (sales.js price/credit
 *     overrides, customer-invoices.js, report-builder.js)
 *   - tenant-provisioner-pg.js ALL_PERMISSIONS
 *
 * tests/unit/permissions-catalog.test.js enforces this bidirectionally: any
 * new permission string used in a route guard MUST be registered here, and
 * every entry's module_key must agree with the owning card's permissions
 * list in config/business-modules.js.
 *
 * Consumers:
 *   - GET /api/permissions-catalog (routes/roles.js) → the role editor UI
 *   - PUT /api/roles/:id/permissions validates submissions against this list
 *   - GET /api/business-modules derives roles_with_access per card from the
 *     module_key/permissions linkage
 *
 * Entry shape: { id, label, category, module_key?, module_keys? } —
 * module_key links a permission to the business-modules card whose surfaces
 * it gates (absent for spine permissions that aren't module-specific).
 * module_keys (plural) marks a cross-module permission that gates the
 * setup/config surfaces of SEVERAL cards (PLAN-V2 Step 2: manage_integrations
 * spans every integration-connection card).
 *
 * Invariant (PLAN Step 7): a module toggle never grants or revokes any
 * permission — role assignments stay dormant while a module is off.
 */

const PERMISSIONS_CATALOG = Object.freeze([
  // ── System ────────────────────────────────────────────────────────────────
  { id: "all_access", label: "All Access (full administrator)", category: "System" },
  { id: "manage_employees", label: "Manage Employees & Outlets", category: "System" },
  {
    id: "manage_business_modules",
    label: "Manage Business Modules",
    category: "System",
    // Deliberately granted to NO default role — Administrators pass via the
    // all_access bypass; grant this to a custom role to delegate module
    // management without full admin.
  },

  // ── Delegation (PLAN-V2 Step 2 / D7) ──────────────────────────────────────
  // Like manage_business_modules above: granted to NO default role —
  // Administrators pass via the all_access bypass; grant to a custom role to
  // delegate the surface without full admin.
  {
    id: "manage_integrations",
    label: "Manage Integrations & Connections",
    category: "Delegation",
    // Cross-module: gates the credential/config surfaces of every
    // integration-connection card whose setup routes accept it (see
    // MODULE_PERMISSIONS in config/business-modules.js).
    module_keys: [
      "fbr_digital_invoicing",
      "marketplace_channels",
      "woocommerce",
      "shopify",
      "couriers_shipping",
      "sms_provider",
      "delivery_aggregators",
    ],
  },
  {
    id: "manage_roles",
    label: "Manage Roles & Permissions",
    category: "Delegation",
    // Delegable role editing (routes/roles.js). Guard rails stay server-side:
    // a manage_roles holder cannot edit the Administrator role or grant
    // all_access to anyone.
  },
  {
    id: "manage_outlet_modules",
    label: "Manage Per-Outlet Modules",
    category: "Delegation",
    // Reserved (PLAN-V2 Step 2) — no route consumes it yet; Step 10 wires the
    // per-outlet module overrides to it.
  },

  // ── Inventory & Catalog ───────────────────────────────────────────────────
  { id: "manage_inventory", label: "Manage Inventory & Catalog", category: "Inventory" },
  { id: "manage_products", label: "Manage Product Channels", category: "Inventory" },

  // ── Orders & Purchasing ───────────────────────────────────────────────────
  { id: "manage_orders", label: "Manage Orders & Purchasing", category: "Orders" },
  { id: "manage_returns", label: "Manage Returns", category: "Orders" },

  // ── Customers ─────────────────────────────────────────────────────────────
  { id: "manage_customers", label: "Manage Customers", category: "Customers" },

  // ── Reporting ─────────────────────────────────────────────────────────────
  // view_reports is being SPLIT (PLAN-V2 Step 3/4 — D4). The five split
  // permissions below are registered ahead of consumption (Step 3, drift test
  // only enforces call-site → catalog, so registered-but-unused is legal);
  // Step 4 sweeps every call site onto them, migrates role_permissions rows
  // (pristine default Cashiers → view_sales_reports only, everything else
  // grandfathered with all five), and REMOVES view_reports from this catalog
  // so any straggler guard fails CI. Data-class boundaries are defined in
  // docs/fable5/business-modules/REPORT-PERMS.md — read it before mapping a
  // new report route to one of these.
  { id: "view_reports", label: "View Reports (legacy — being split)", category: "Reporting" },
  { id: "view_sales_reports", label: "View Sales & POS Reports", category: "Reporting" },
  { id: "view_inventory_reports", label: "View Inventory Reports", category: "Reporting" },
  { id: "view_financial_reports", label: "View Financial Reports", category: "Reporting" },
  { id: "view_hr_reports", label: "View Staff & Attendance Reports", category: "Reporting" },
  { id: "view_customer_reports", label: "View Customer Reports", category: "Reporting" },

  // ── POS ───────────────────────────────────────────────────────────────────
  { id: "pos_discount", label: "Apply Custom Discounts", category: "POS" },
  { id: "void_sales", label: "Void Sales", category: "POS" },
  { id: "pos_void", label: "Manager Override Void", category: "POS" },
  { id: "pos_park", label: "Park & Restore Sales", category: "POS" },

  // ── Manager Overrides (PIN-authorized floor actions) ──────────────────────
  { id: "override_price", label: "Override Price (manager PIN)", category: "Overrides" },
  { id: "override_void_comp", label: "Authorize Void/Comp (manager PIN)", category: "Overrides" },
  { id: "override_credit_limit", label: "Override Credit Limit (manager PIN)", category: "Overrides" },

  // ── Restaurant ────────────────────────────────────────────────────────────
  { id: "manage_restaurant", label: "Manage Restaurant", category: "Restaurant", module_key: "restaurant" },
  { id: "manage_kds", label: "Manage Kitchen Display", category: "Restaurant", module_key: "restaurant" },
  { id: "manage_tips", label: "Manage Tips & Tip Pools", category: "Restaurant", module_key: "restaurant" },

  // ── Services & Verticals ──────────────────────────────────────────────────
  { id: "manage_bookings", label: "Manage Appointments & Bookings", category: "Services", module_key: "appointments" },
  { id: "manage_projects", label: "Manage Projects", category: "Services", module_key: "projects_contracts" },
  { id: "manage_contracts", label: "Manage Contracts", category: "Services", module_key: "projects_contracts" },
  { id: "manage_tickets", label: "Manage Service Tickets", category: "Services", module_key: "service_tickets" },
  { id: "manage_rentals", label: "Manage Rentals", category: "Services", module_key: "rentals" },
  { id: "manage_rooms", label: "Manage Rooms & Lodging", category: "Services", module_key: "rooms_lodging" },
  { id: "manage_treatment_plans", label: "Manage Treatment Plans", category: "Services", module_key: "clinical" },
  { id: "manage_forms", label: "Manage Forms & Waivers", category: "Services", module_key: "custom_forms" },

  // ── Retail add-ons ────────────────────────────────────────────────────────
  { id: "manage_gift_cards", label: "Manage Gift Cards", category: "Retail", module_key: "gift_cards" },

  // ── Wholesale / B2B ───────────────────────────────────────────────────────
  // S3 split (PLAN-V2 Step 2): manage_field_sales = owner/admin surfaces
  // (all-reps visit log, per-rep summary, route planning);
  // execute_field_sales = rep-self surfaces (own route, check-in, own order
  // capture, own van). The Field Rep default role holds execute only.
  { id: "manage_field_sales", label: "Manage Field Sales (owner/admin)", category: "Wholesale", module_key: "field_sales" },
  { id: "execute_field_sales", label: "Do Field Sales (rep-self)", category: "Wholesale", module_key: "field_sales" },
]);

const PERMISSION_IDS = Object.freeze(
  new Set(PERMISSIONS_CATALOG.map((p) => p.id))
);

function isKnownPermission(id) {
  return PERMISSION_IDS.has(id);
}

module.exports = { PERMISSIONS_CATALOG, PERMISSION_IDS, isKnownPermission };

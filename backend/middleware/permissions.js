/**
 * Permission middleware, role defaults, and declarative permission rules.
 */

function requirePerm(permission) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || perms.includes(permission)) {
      return next();
    }
    return res
      .status(403)
      .json({ error: "Forbidden: insufficient permissions" });
  };
}

function requireAnyPerm(permissions) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    const allowed =
      perms.includes("all_access") ||
      permissions.some((p) => perms.includes(p));
    if (allowed) return next();
    return res
      .status(403)
      .json({ error: "Forbidden: insufficient permissions" });
  };
}

function requireContextOutlet(req, res, next) {
  if (req.context?.outletId && !req.query.outlet_id) {
    req.query.outlet_id = String(req.context.outletId);
  }
  next();
}

const DEFAULT_ROLE_PERMISSIONS = {
  Administrator: ["all_access"],
  Manager: [
    "manage_inventory",
    "manage_orders",
    // D4 split (PLAN-V2 Step 4) — view_reports replaced by the five
    // data-classified report permissions. Manager holds all five.
    "view_sales_reports",
    "view_inventory_reports",
    "view_financial_reports",
    "view_hr_reports",
    "view_customer_reports",
    "manage_employees",
    // C6 split (Step 4) — financial mutations + report governance writes,
    // carved out of manage_employees so custom HR roles stop inheriting
    // financial authority. Default Manager keeps both (no capability change).
    "manage_finance",
    "manage_reports",
    // C2 #1 (Step 4) — guard on customer edit/delete was already
    // manage_customers; the gap was the role. Store managers routinely edit
    // customers.
    "manage_customers",
    "pos_discount",
    "void_sales",
    "pos_park",
    "pos_void",
    "manage_restaurant",
    "manage_kds",
    "manage_bookings",
    "manage_projects",
    "manage_contracts",
    "manage_tickets",
    "manage_rentals",
    "manage_rooms",
    "manage_treatment_plans",
    // Phase 2.1 C — granted alongside manage_restaurant so existing restaurant
    // managers can administer tip pools without a separate role bump.
    "manage_tips",
    // Phase 2-R Wave B (2-R.2) — manager PIN authorization for void/comp.
    "override_void_comp",
    // Phase 2-G Wave 2 (2-G.2) — gift-card admin + POS tender.
    "manage_gift_cards",
    // Phase 2-G Wave 3 (2-G.5) — manager PIN authorization for POS price override.
    "override_price",
    // Tier 0.1 wholesale — manager PIN authorization for pushing a Credit-tender
    // sale past a customer's credit_limit when credit_block_mode='hard'.
    "override_credit_limit",
    // Tier 1.1 wholesale — owner-side field sales visibility + route assignment.
    "manage_field_sales",
    // F03 — form builder (intake/waivers/questionnaires) across verticals.
    "manage_forms",
  ],
  // D4 split (Step 4): pristine Cashiers converge on least-privilege —
  // sales-class reads only. POS keeps working via the POS-adjacency
  // composites (products/customers reads accept view_sales_reports).
  // Migration v134 converts existing pristine Cashier roles; appointments-
  // mode tenants additionally get view_customer_reports there (§8 #2b) —
  // deliberately NOT in this constant, which describes the retail default.
  Cashier: ["view_sales_reports", "pos_discount", "pos_park"],
  // Tier 1.1 wholesale — minimal role for mobile order bookers / DSRs.
  // Only sees their own route, posts check-ins, reads their own visit history.
  // S3 split (PLAN-V2 Step 2): execute_field_sales = rep-self surfaces only;
  // the owner/admin surfaces (all-reps visit log, summary, route planning)
  // require manage_field_sales, which Field Rep deliberately does NOT hold.
  // C4 rule: this constant is the durable source — ensureDefaultRolePermissions
  // re-seeds from it at every boot, so changing role_permissions rows alone
  // would be undone. Migration v133 converts existing pristine Field Rep roles.
  "Field Rep": ["execute_field_sales"],
};

async function ensureDefaultRolePermissions(db) {
  try {
    const { rows: roles } = await db.query("SELECT id, name FROM roles");
    if (!roles?.length) return;
    for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const roleId = roles.find(r => r.name === roleName)?.id;
      if (!roleId) continue;
      for (const perm of perms) {
        await db.query(
          "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [roleId, perm]
        );
      }
    }
  } catch (err) {
    console.error("[ensureDefaultRolePermissions]", err.message);
  }
}

const PERMISSION_RULES = [
  // Reporting and analytics — D4 split (Step 4): this blanket rule is a
  // BACKSTOP only (defense in depth so an unguarded new report route still
  // requires *some* report permission). The per-domain guard inside each
  // routes/reports/* file is what enforces the RIGHT split perm.
  {
    methods: ["GET"],
    path: /^\/api\/reports(\/|$)/,
    anyPerms: [
      "view_sales_reports",
      "view_inventory_reports",
      "view_financial_reports",
      "view_hr_reports",
      "view_customer_reports",
      "manage_reports",
    ],
  },
  {
    methods: ["GET"],
    path: /^\/api\/attendance(\/|$)/,
    anyPerms: ["view_hr_reports", "manage_employees"],
  },
  // Attendance manual edit (manager write)
  {
    methods: ["PUT"],
    path: /^\/api\/attendance\/\d+$/,
    anyPerms: ["manage_employees"],
  },
  // Attendance config on employee record
  {
    methods: ["GET", "PUT"],
    path: /^\/api\/employees\/\d+\/attendance-config$/,
    anyPerms: ["manage_employees"],
  },

  // Setup/config mutation
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/categories(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/brands(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/products(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/products\/bulk-import$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/attribute-sets(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/barcode-templates(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/barcode-print-jobs$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT"],
    path: /^\/api\/expenses(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/expense-categories(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/outlets(\/\d+)?$/,
    anyPerms: ["manage_employees"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/receipt-templates(\/\d+)?$/,
    // C2 #3 (Step 4): template design is store config — manage_inventory
    // holders save templates (the inline PUT guard was relaxed to match).
    anyPerms: ["manage_employees", "manage_inventory"],
  },

  // Orders/procurement mutation
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/suppliers(\/\d+)?$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/supplier-returns$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/supplier-invoices\/\d+\/pay$/,
    anyPerms: ["manage_orders"],
  },
  { methods: ["POST"], path: /^\/api\/returns$/, anyPerms: ["manage_orders"] },

  // Approval workflow
  {
    methods: ["GET"],
    path: /^\/api\/approvals$/,
    anyPerms: ["manage_orders", "manage_employees"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/purchase-orders\/\d+\/submit$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/purchase-orders\/\d+\/approve$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/transfers\/\d+\/submit$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/transfers\/\d+\/approve$/,
    anyPerms: ["manage_orders"],
  },

  // POS-specific restricted flows
  {
    methods: ["POST", "DELETE"],
    path: /^\/api\/parked-sales(\/\d+)?$/,
    anyPerms: ["pos_park"],
  },
  // Phase 4 — New Verticals
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/restaurant(\/|$)/,
    anyPerms: ["manage_restaurant"],
  },
  {
    methods: ["GET", "POST", "PUT"],
    path: /^\/api\/kds(\/|$)/,
    anyPerms: ["manage_kds"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/booking-services(\/|$)/,
    anyPerms: ["manage_bookings"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/appointments(\/|$)/,
    anyPerms: ["manage_bookings"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/projects(\/|$)/,
    anyPerms: ["manage_projects"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/contracts(\/|$)/,
    anyPerms: ["manage_contracts"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/service-tickets(\/|$)/,
    anyPerms: ["manage_tickets"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/rental-items(\/|$)/,
    anyPerms: ["manage_rentals"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/rental-contracts(\/|$)/,
    anyPerms: ["manage_rentals"],
  },
  // M9 — Room management
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/room-types(\/|$)/,
    anyPerms: ["manage_rooms"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/rooms(\/|$)/,
    anyPerms: ["manage_rooms"],
  },
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/room-bookings(\/|$)/,
    anyPerms: ["manage_rooms"],
  },
  // M10 — Treatment plans
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/(treatment-plans|treatment-sessions|treatment-folios|patient-subjects|chart-areas|session-chart-entries|lab-orders|consent-templates|clinical-documents)(\/|$)/,
    anyPerms: ["manage_treatment_plans"],
  },
  // Phase 2.1 C — tip pools and distribution rules.
  {
    methods: ["GET", "POST", "PUT", "DELETE"],
    path: /^\/api\/tips(\/|$)/,
    anyPerms: ["manage_tips"],
  },
  // Business Modules self-service page (PLAN.md Step 7) — delegable without
  // full admin; granted to no default role (Administrators pass via
  // all_access).
  {
    methods: ["GET", "POST"],
    path: /^\/api\/business-modules(\/|$)/,
    anyPerms: ["manage_business_modules"],
  },
];

module.exports = {
  requirePerm,
  requireAnyPerm,
  requireContextOutlet,
  DEFAULT_ROLE_PERMISSIONS,
  ensureDefaultRolePermissions,
  PERMISSION_RULES,
};

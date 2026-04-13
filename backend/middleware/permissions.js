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
    "view_reports",
    "manage_employees",
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
  ],
  Cashier: ["view_reports", "pos_discount", "pos_park"],
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
  // Reporting and analytics
  {
    methods: ["GET"],
    path: /^\/api\/reports(\/|$)/,
    anyPerms: ["view_reports", "manage_employees"],
  },
  {
    methods: ["GET"],
    path: /^\/api\/attendance(\/|$)/,
    anyPerms: ["view_reports", "manage_employees"],
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
    anyPerms: ["manage_employees"],
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
];

module.exports = {
  requirePerm,
  requireAnyPerm,
  requireContextOutlet,
  DEFAULT_ROLE_PERMISSIONS,
  ensureDefaultRolePermissions,
  PERMISSION_RULES,
};

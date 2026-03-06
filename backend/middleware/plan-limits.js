/**
 * middleware/plan-limits.js — Enforce tenant plan limits.
 *
 * Called on creation endpoints (POST /api/employees, POST /api/outlets, POST /api/products)
 * to ensure the tenant hasn't exceeded their plan's caps.
 *
 * Reads limits from master.db tenant row (max_employees, max_outlets, max_products).
 * Counts current resources in the tenant DB.
 *
 * Usage in route files:
 *   app.post("/api/employees", requirePlanLimit("employees"), ...)
 */
const { getMasterDb } = require("../master-db");
const { getCurrentDb } = require("../tenant-db-proxy");

const RESOURCE_CONFIG = {
  employees: {
    limitColumn: "max_employees",
    countSql: "SELECT COUNT(*) AS cnt FROM employees",
    label: "employees",
  },
  outlets: {
    limitColumn: "max_outlets",
    countSql: "SELECT COUNT(*) AS cnt FROM outlets",
    label: "outlets",
  },
  products: {
    limitColumn: "max_products",
    countSql: "SELECT COUNT(*) AS cnt FROM products",
    label: "products",
  },
};

/**
 * Returns Express middleware that checks the tenant's plan limit for `resource`.
 * Passes through silently when MULTI_TENANT is not "1".
 *
 * @param {"employees"|"outlets"|"products"} resource
 */
function requirePlanLimit(resource) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw new Error(`Unknown plan-limit resource: ${resource}`);

  return (req, res, next) => {
    // Skip in single-tenant mode
    if (process.env.MULTI_TENANT !== "1") return next();

    const tenantId = req.tenantId;
    if (!tenantId) return next(); // No tenant context — let downstream auth handle it

    const masterDb = getMasterDb();

    // 1. Read the tenant's limit from master.db
    masterDb.get(
      `SELECT ${config.limitColumn} AS planLimit FROM tenants WHERE id = ?`,
      [tenantId],
      (err, tenant) => {
        if (err || !tenant) return next(); // Best-effort — don't block on lookup failure

        const limit = tenant.planLimit;
        if (limit == null || limit <= 0) return next(); // No limit = unlimited

        // 2. Count current resources in the tenant's DB via AsyncLocalStorage
        let db;
        try {
          db = getCurrentDb();
        } catch {
          return next(); // Not in async context — skip check
        }

        db.get(config.countSql, [], (err2, row) => {
          if (err2) return next(); // Best-effort

          const current = row?.cnt || 0;
          if (current >= limit) {
            return res.status(403).json({
              error: `Plan limit reached: maximum ${limit} ${config.label} allowed`,
              code: "PLAN_LIMIT_REACHED",
              limit,
              current,
            });
          }
          next();
        });
      }
    );
  };
}

module.exports = { requirePlanLimit };

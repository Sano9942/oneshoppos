/**
 * middleware/plan-limits.js — Enforce tenant plan limits (Postgres).
 *
 * Called on creation endpoints (POST /api/employees, POST /api/outlets, POST /api/products)
 * to ensure the tenant hasn't exceeded their plan's caps.
 *
 * Reads limits from public.tenants row (max_employees, max_outlets, max_products).
 * Counts current resources via the ALS-scoped tenant DB proxy.
 *
 * Usage in route files:
 *   app.post("/api/employees", requirePlanLimit("employees"), ...)
 */

// ── Plan defaults ────────────────────────────────────────────────────────
// 0 = unlimited.  These are auto-applied on provision and plan change.
const PLAN_DEFAULTS = {
  free: { max_outlets: 1, max_employees: 3,  max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0,  max_products: 0   },
};

const RESOURCE_CONFIG = {
  employees: {
    limitColumn: "max_employees",
    countSql: "SELECT COUNT(*) AS cnt FROM employees WHERE deleted_at IS NULL",
    label: "employees",
  },
  outlets: {
    limitColumn: "max_outlets",
    countSql: "SELECT COUNT(*) AS cnt FROM outlets",
    label: "outlets",
  },
  products: {
    limitColumn: "max_products",
    countSql: "SELECT COUNT(*) AS cnt FROM products WHERE deleted_at IS NULL",
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

  return async (req, res, next) => {
    // Skip in single-tenant mode
    if (process.env.MULTI_TENANT !== "1") return next();

    const tenantId = req.tenantId;
    if (!tenantId) return next(); // No tenant context — let downstream auth handle it

    try {
      const masterDb = require("../master-db-pg");
      const { rows: [tenant] } = await masterDb.query(
        `SELECT ${config.limitColumn} AS "planLimit" FROM tenants WHERE id = $1`,
        [tenantId]
      );
      if (!tenant) return next();

      const limit = tenant.planLimit;
      if (limit == null || limit <= 0) return next(); // No limit = unlimited

      // Count current resources — use the ALS-proxied DB (already in tenant context at this point)
      const tenantDbMgr = require("../tenant-db-manager-pg");
      const tenantDb = await tenantDbMgr.getDb(tenantId);
      const { rows: [row] } = await tenantDb.query(config.countSql);
      const current = Number(row?.cnt || 0);

      if (current >= limit) {
        return res.status(403).json({
          error: `Plan limit reached: maximum ${limit} ${config.label} allowed`,
          code: "PLAN_LIMIT_REACHED",
          limit,
          current,
        });
      }
      next();
    } catch (err) {
      // Best-effort — don't block on lookup failure
      console.error("[plan-limits]", err.message);
      next();
    }
  };
}

/**
 * Blocks write operations (POST/PUT/DELETE) when tenant subscription is expired.
 * Skipped for: GET requests, non-MT mode, non-API routes.
 * Always allows: auth, billing, support, setup, health, receipts routes.
 */
function requireActiveSubscription(req, res, next) {
  if (process.env.MULTI_TENANT !== "1") return next();
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return next();

  // Allow routes that must always work (auth, billing, support, setup, health, receipts)
  const path = req.path;
  if (
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/billing/") ||
    path.startsWith("/api/support/") ||
    path.startsWith("/api/setup/") ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/receipts/")
  ) {
    return next();
  }

  const tenantId = req.tenantId;
  if (!tenantId) return next();

  const masterDb = require("../master-db-pg");
  masterDb.query("SELECT plan, payment_status FROM tenants WHERE id = $1", [tenantId])
    .then(({ rows }) => {
      // Free-forever: never block writes for Free tenants regardless of payment_status drift.
      if (rows[0]?.plan === "free") return next();
      const status = rows[0]?.payment_status;
      if (status === "expired") {
        return res.status(403).json({
          error: "Your subscription has expired. Please subscribe to continue.",
          code: "SUBSCRIPTION_EXPIRED",
          billing_url: "/billing",
        });
      }
      next();
    })
    .catch(() => next()); // Best-effort — don't block on lookup failure
}

module.exports = { requirePlanLimit, requireActiveSubscription, PLAN_DEFAULTS };

/**
 * Tenant authentication, resolution, and company profile middleware.
 *
 * Call init(deps) once at boot to inject database handles and MT config.
 * Returns middleware functions: loadEmployeePerms, loadTenantAndPerms,
 * resolveTenant, loadCompanyProfile, resolveContext.
 */
const path = require("path");
const crypto = require("crypto");

let db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore;

// Company profile cache — per-tenant Map (MT-safe). Single-tenant uses "_default" key.
const _companyCache = new Map();
const COMPANY_CACHE_MS = 5 * 60 * 1000;

// Context enforcement flag cache — per-tenant Map (MT-safe).
const _contextFlagCache = new Map();
const CONTEXT_FLAG_CACHE_MS = 30000;

// Paths allowed to resolve a tenant via ?tenant=<slug> WITHOUT a JWT.
// Anything else hitting resolveTenant without req.tenantId derived from a
// verified JWT will be ignored — the request continues with no tenant DB
// scope so deps.db (the proxy) throws on first query. Routes mounted
// before loadTenantAndPerms (storefront, public-restaurant, receipts,
// customer portal, etc.) do their own tenant resolution and aren't
// affected by this list.
const PUBLIC_TENANT_PARAM_PATHS = [
  /^\/api\/auth\//,                  // login, mt-login, signup, refresh, forgot/reset password
  /^\/api\/attendance\/pin-/,        // kiosk PIN check-in
  /^\/api\/feature-flags/,           // anonymous bootstrap before auth
  /^\/api\/setup\//,                 // first-run wizard (setup_token-gated)
  /^\/api\/health/,                  // health check
  /^\/api\/company-profile\/currency$/, // CurrencyProvider bootstrap before auth — read-only currency symbol + denominations (anchored: must NOT expose full profile GET/PUT)
  /^\/api\/billing\/pricing$/,       // public plan pricing for the marketing /pricing page — reads public.plan_pricing only, no tenant scope attached (anchored: other /api/billing/* stays authenticated)
];

const CONTEXT_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/context\//,
  /^\/api\/feature-flags/,
  /^\/api\/attendance\/pin-/,
  /^\/api\/roles\/\d+\/permissions/,
  /^\/api\/outlets$/,
];

// Helper: resolve the correct DB for tenant-scoped queries in middleware.
function _getCompanyDb(req) {
  if (IS_MULTI_TENANT && req && req.tenantId) return dbProxy;
  return db;
}

// --- Middleware functions ---

async function loadEmployeePerms(req, res, next) {
  const employeeId = req.headers["x-employee-id"];
  const parsed = parseInt(employeeId, 10);
  if (employeeId !== undefined && (isNaN(parsed) || parsed <= 0 || parsed > 999999)) {
    return res.status(400).json({ error: "Invalid employee ID header" });
  }
  if (!employeeId) {
    req.employeePerms = [];
    return next();
  }
  try {
    const { rows: [emp] } = await db.query(
      "SELECT role_id FROM employees WHERE id = $1", [employeeId]
    );
    if (!emp) {
      req.employeePerms = [];
      return next();
    }
    const { rows } = await db.query(
      "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
    );
    req.employeePerms = rows.map((r) => r.permission);
  } catch {
    req.employeePerms = [];
  }
  next();
}

async function loadTenantAndPerms(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.employeePerms = [];
    return next();
  }

  try {
    const { verifyAccessToken } = require("../jwt-auth");
    const decoded = verifyAccessToken(authHeader.slice(7), process.env.JWT_SECRET);

    req.tenantId = decoded.tid;
    req.employee = { id: decoded.eid, role_id: decoded.rid };
    req.isImpersonating = !!decoded.impersonating;
    if (decoded.impersonating && decoded.realIdentity) {
      req.impersonatedBy = decoded.realIdentity;
    }

    // Bridge: set x-employee-id header so downstream code that reads it still works
    req.headers["x-employee-id"] = String(decoded.eid);

    // Expose the JWT outlet claim for the shared resolver (outlet-context.js).
    // Step 9 (D1c) removed the old x-outlet-id header backfill — the resolver
    // is now the ONLY interpreter of outlet context (precedence: validated
    // header → this claim → none), and resolveContext consumes its result.
    req.jwtOid = decoded.oid || null;

    // Load permissions — in MT mode, query the tenant's DB directly
    const permDb = IS_MULTI_TENANT
      ? await tenantDbManager.getDb(decoded.tid)
      : db;

    // Token revocation checks (jti-based + blanket revocation)
    try {
      if (decoded.jti) {
        const { rows: [revoked] } = await permDb.query(
          "SELECT 1 FROM revoked_tokens WHERE token_jti = $1", [decoded.jti]
        );
        if (revoked) {
          return res.status(401).json({ error: "Token revoked", code: "TOKEN_REVOKED" });
        }

        // Impersonation belt-and-suspenders: ending an impersonation session
        // inserts the jti into the tenant's revoked_tokens table best-effort —
        // that insert can silently fail (logged, not fatal) and leave the token
        // usable for its full 1h TTL. The session's revoked_at (in the public
        // registry) is always stamped, so cross-check it here for impersonation
        // tokens. public.-qualified so it resolves regardless of search_path.
        if (decoded.impersonating) {
          const { rows: [sess] } = await permDb.query(
            "SELECT 1 FROM public.impersonation_sessions WHERE token_jti = $1 AND revoked_at IS NOT NULL",
            [decoded.jti]
          );
          if (sess) {
            return res.status(401).json({ error: "Impersonation session ended", code: "TOKEN_REVOKED" });
          }
        }
      }

      const { rows: [empRevoke] } = await permDb.query(
        "SELECT tokens_revoked_before FROM employees WHERE id = $1", [decoded.eid]
      );
      if (empRevoke && empRevoke.tokens_revoked_before && decoded.iat < Date.parse(empRevoke.tokens_revoked_before) / 1000) {
        return res.status(401).json({ error: "All sessions revoked", code: "ALL_SESSIONS_REVOKED" });
      }
    } catch {
      // table/column may not exist yet — skip revocation checks
    }

    // Load permissions — retry once on transient DB errors. The pre-retry
    // version silently fell through with req.employeePerms = [] on any
    // exception, which masked real backend issues as "403 insufficient
    // permissions" for Admin users whose role_permissions query transiently
    // failed under pool pressure.
    const loadPerms = async () => {
      const { rows: [emp] } = await permDb.query(
        "SELECT role_id, name, email FROM employees WHERE id = $1", [decoded.eid]
      );
      if (!emp) return { empty: true };
      const { rows } = await permDb.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
      );
      return { emp, perms: rows.map(r => r.permission) };
    };

    let result;
    try {
      result = await loadPerms();
    } catch (err1) {
      // One retry with a small delay — covers transient pool exhaustion,
      // connection resets, and query timeouts under concurrent load.
      try {
        await new Promise((r) => setTimeout(r, 100));
        result = await loadPerms();
      } catch (err2) {
        // Both attempts failed — return 503 so the frontend can retry
        // instead of falling through with empty perms (which causes
        // misleading "403 insufficient permissions" for admin users).
        const log = req.log || console;
        log.error && log.error({
          err: err2.message,
          employeeId: decoded.eid,
          tenantId: decoded.tid,
          path: req.path,
        }, "loadTenantAndPerms: both permission load attempts failed");
        return res.status(503).json({ error: "Service temporarily unavailable — please retry", code: "PERM_LOAD_FAILED" });
      }
    }

    if (result.empty) {
      req.employeePerms = [];
      return next();
    }
    req.employee.name = result.emp.name;
    req.employee.email = result.emp.email || null;
    if (req.isImpersonating) {
      req.employee.name = (result.emp.name || "Admin") + " (impersonated by Super-Admin)";
    }
    req.employeePerms = result.perms;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
      return res.status(401).json({ error: "Invalid token", code: "INVALID_TOKEN" });
    }
    // Genuinely unexpected — log + return 401 (not silent fall-through). Falling through
    // to next() with empty perms used to surface as a 500 "[tenant-db-proxy-pg] No tenant
    // DB in async context" downstream because tenant context never got attached.
    const log = req.log || console;
    log.error && log.error({ err: err.message || String(err) }, "loadTenantAndPerms: unexpected auth error");
    return res.status(401).json({ error: "Authentication failed", code: "AUTH_FAILED" });
  }
}

async function resolveTenant(req, res, next) {
  if (!IS_MULTI_TENANT) return next();

  let resolvedTenantId = req.tenantId;
  if (!resolvedTenantId && req.query.tenant) {
    // Only honor ?tenant=<slug> on the explicit public-path allowlist.
    // Without this gate, ANY unauthenticated request to a route that
    // lacks a per-route requirePerm guard (eg GET /api/parked-sales,
    // POST /api/sales) could attach a tenant DB scope just by appending
    // ?tenant=foo, bypassing auth entirely.
    if (PUBLIC_TENANT_PARAM_PATHS.some((rx) => rx.test(req.path))) {
      try {
        const masterMod = require("../master-db-pg");
        const tenant = await masterMod.getTenantBySlug(req.query.tenant);
        if (tenant) resolvedTenantId = tenant.id;
      } catch {
        // ignore — will fall through to next() below
      }
    }
  }

  if (!resolvedTenantId) {
    // For non-public /api/ routes, returning a clean 401 here is friendlier
    // than letting the request crash at the tenant DB proxy with a 500
    // ("[tenant-db-proxy-pg] No tenant DB in async context"). Public
    // routes mounted before this middleware (admin/, webhooks, storefront,
    // receipts, customer-portal, etc.) never reach this line. Anything
    // else under /api/ that arrives here without a tenant context is an
    // unauthenticated caller and should be told so explicitly.
    if (req.path.startsWith("/api/") && !PUBLIC_TENANT_PARAM_PATHS.some((rx) => rx.test(req.path))) {
      return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    }
    return next();
  }

  try {
    const tenantDb = await tenantDbManager.getDb(resolvedTenantId);
    const masterMod = require("../master-db-pg");
    const tenant = await masterMod.getTenantById(resolvedTenantId);
    if (!tenant) {
      return res.status(403).json({ error: "Tenant not found.", code: "TENANT_NOT_FOUND" });
    }

    req.tenantSlug = tenant.slug;
    req.tenantDir = path.join(__dirname, "..", "tenants", `t_${tenant.slug}`);

    asyncStore.run({ db: tenantDb }, () => next());
  } catch (err) {
    if (err.message && err.message.includes("is suspended")) {
      return res.status(403).json({ error: "Account suspended. Contact support.", code: "TENANT_SUSPENDED" });
    }
    if (err.message && err.message.includes("is deleted")) {
      return res.status(403).json({ error: "Account not found.", code: "TENANT_DELETED" });
    }
    console.error("[resolveTenant]", err.message);
    return res.status(500).json({ error: "Failed to resolve tenant database" });
  }
}

async function loadCompanyProfile(req, res, next) {
  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  let entry = _companyCache.get(cacheKey);
  const now = Date.now();

  // Cold start: AWAIT the first load. The placeholder profile lacks
  // `setup_complete`, so the post-wizard auto-login (and any first request
  // after a server restart) would race the fire-and-forget load and 503
  // with SETUP_REQUIRED even though setup is actually complete. The
  // `_placeholder` flag below distinguishes a not-yet-loaded entry from a
  // genuinely-incomplete tenant — only the latter should trip SETUP_REQUIRED.
  if (!entry) {
    entry = { profile: { timezone: "UTC" }, lastCheck: now, _placeholder: true };
    _companyCache.set(cacheKey, entry);
    try {
      const { rows: [row] } = await _getCompanyDb(req).query(
        "SELECT * FROM company_profile WHERE id = 1"
      );
      if (row) {
        entry.profile = row;
        entry._placeholder = false;
      }
    } catch { /* tolerated — fall through with placeholder profile */ }
  } else if (now - entry.lastCheck > COMPANY_CACHE_MS) {
    // Periodic refresh stays async — cache is already warm.
    entry.lastCheck = now;
    _getCompanyDb(req).query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
      if (row) {
        entry.profile = row;
        entry._placeholder = false;
        _companyCache.set(cacheKey, entry);
      }
    }).catch(() => {});
  }
  req.company = entry.profile;

  if (
    entry.profile &&
    !entry._placeholder &&
    !entry.profile.setup_complete &&
    !req.path.startsWith("/api/setup") &&
    !req.path.startsWith("/api/health") &&
    (!IS_MULTI_TENANT || req.tenantId)
  ) {
    return res.status(503).json({ error: "Setup required", code: "SETUP_REQUIRED" });
  }

  next();
}

function resolveContext(req, res, next) {
  req.context = { companyId: null, outletId: null, scopeMode: null };
  const companyId = req.headers["x-company-id"];
  const scopeMode = req.headers["x-scope-mode"];
  if (companyId) req.context.companyId = Number(companyId);
  if (scopeMode) req.context.scopeMode = scopeMode;
  // Outlet context comes from the shared validated resolver (outlet-context.js,
  // mounted just before this middleware). Fall back to the legacy raw header
  // read only when the resolver isn't mounted (standalone/unit-test usage).
  let outletId;
  if (req.outletContext !== undefined) {
    outletId = req.outletContext.outletId || null;
  } else {
    const rawOutlet = req.headers["x-outlet-id"];
    outletId = rawOutlet ? Number(rawOutlet) : null;
  }
  if (outletId) req.context.outletId = outletId;

  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  let flagEntry = _contextFlagCache.get(cacheKey);
  const now = Date.now();

  if (!flagEntry || (now - flagEntry.lastCheck > CONTEXT_FLAG_CACHE_MS)) {
    const newEntry = flagEntry || { enforced: false, loaded: false, lastCheck: now };
    newEntry.lastCheck = now;
    _contextFlagCache.set(cacheKey, newEntry);
    _getCompanyDb(req).query("SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'")
      .then(({ rows: [row] }) => {
        if (row) newEntry.enforced = row.enabled === true;
        newEntry.loaded = true;
      })
      .catch(() => { newEntry.loaded = true; });
    flagEntry = newEntry;
  }

  if (flagEntry.loaded && flagEntry.enforced && req.path.startsWith("/api/")) {
    const exempt = CONTEXT_EXEMPT_PATHS.some((rx) => rx.test(req.path));
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!exempt && !employeeId) return next();
    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");
    if (!exempt && !outletId && !isAdmin) {
      return res.status(428).json({
        error: "Context required: select a branch before using this feature.",
        code: "CONTEXT_REQUIRED",
      });
    }
  }

  next();
}

// Eager startup loads for single-tenant mode
function _warmCaches() {
  if (IS_MULTI_TENANT) return;

  // Company profile
  (async () => {
    try {
      const { rows: [row] } = await db.query("SELECT * FROM company_profile WHERE id = 1");
      if (row) {
        _companyCache.set("_default", { profile: row, lastCheck: Date.now() });
        if (!row.setup_complete) {
          const setupToken = crypto.randomBytes(32).toString("hex");
          await db.query("UPDATE company_profile SET setup_token = $1 WHERE id = 1", [setupToken]);
          _companyCache.set("_default", { profile: { ...row, setup_token: setupToken }, lastCheck: Date.now() });
          const PORT_FOR_LOG = process.env.PORT || 5000;
          console.log(`\n===== SETUP URL: http://localhost:${PORT_FOR_LOG}/setup?token=${setupToken} =====\n`);
        }
      } else {
        _companyCache.set("_default", { profile: { timezone: "UTC" }, lastCheck: Date.now(), _placeholder: true });
      }
    } catch (err) {
      console.error("[loadCompanyProfile startup]", err.message);
      _companyCache.set("_default", { profile: { timezone: "UTC" }, lastCheck: Date.now(), _placeholder: true });
    }
  })();

  // Context flag
  (async () => {
    try {
      const { rows: [row] } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'"
      );
      _contextFlagCache.set("_default", {
        enforced: row ? row.enabled === true : false,
        loaded: true,
        lastCheck: Date.now(),
      });
    } catch {
      _contextFlagCache.set("_default", { enforced: false, loaded: true, lastCheck: Date.now() });
    }
  })();
}

function init(deps) {
  db = deps.db;
  IS_MULTI_TENANT = deps.IS_MULTI_TENANT;
  dbProxy = deps.dbProxy;
  tenantDbManager = deps.tenantDbManager;
  asyncStore = deps.asyncStore;
  _warmCaches();
}

// Lets setup-complete (and admin tooling) blow away a stale company-profile
// entry. Without this, the wizard's mount-time /api/setup/status warms the
// cache with setup_complete=false; the post-wizard auto-login then hits the
// cached row before the 5-min TTL refreshes it and bounces with SETUP_REQUIRED.
function invalidateCompanyProfileCache(tenantIdOrSlug) {
  if (tenantIdOrSlug == null) {
    _companyCache.clear();
    return;
  }
  _companyCache.delete(tenantIdOrSlug);
  _companyCache.delete(String(tenantIdOrSlug));
}

module.exports = {
  init,
  loadEmployeePerms,
  loadTenantAndPerms,
  resolveTenant,
  loadCompanyProfile,
  resolveContext,
  invalidateCompanyProfileCache,
};

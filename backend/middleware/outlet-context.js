/**
 * Shared requested-outlet resolver (Business Modules v2 / D1c, PLAN-V2 Step 9).
 *
 * ONE validated interpreter of "which outlet is this request acting in".
 * Precedence: validated `x-outlet-id` header → JWT `oid` claim → none.
 * Everything that used to read the raw header (resolveContext, the
 * outlet-assignment enforcement, per-route outlet fallbacks) now consumes
 * `req.outletContext` / `req.context.outletId` instead; Step 13's per-outlet
 * role resolution calls resolveRequestedOutlet() directly.
 *
 * Validation rules (owner-approved at the Step 9 pause):
 *  - header must be a positive integer          → 400 INVALID_OUTLET_CONTEXT
 *  - outlet must exist on this tenant           → 403 INVALID_OUTLET_CONTEXT
 *    (same code as malformed so foreign ids don't leak outlet existence)
 *  - non-all_access staff must be assigned to it → 403 OUTLET_NOT_ASSIGNED
 *    (execute_field_sales reps are tenant-scoped and skip the assignment
 *    check, mirroring the outlet-assignment enforcement they already skip)
 *  - a JWT oid that fails validation (outlet deleted / assignment revoked
 *    since login) degrades to "none" instead of rejecting — it is a stale
 *    server-minted claim, not client input; outlet-scoped fail-closed
 *    gating still catches operational routes downstream.
 *
 * Call init(deps) once at boot (same deps shape as tenant-auth/feature-flags).
 */

let db, IS_MULTI_TENANT, dbProxy;

// Per-tenant outlets cache: tenantId|"_default" → { outlets: Map(id → outlet_type), timestamp }
const _outletCache = new Map();
const OUTLET_CACHE_MS = 60_000;

class OutletContextError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function _getDb(req) {
  if (IS_MULTI_TENANT && req && req.tenantId) return dbProxy;
  return db;
}

function _cacheKey(req) {
  return IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
}

async function _loadOutletsMap(dbHandle, cacheKey) {
  const cached = _outletCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < OUTLET_CACHE_MS) return cached.outlets;
  // Inactive outlets are excluded — they are not valid request context.
  const { rows } = await dbHandle.query(
    "SELECT id, outlet_type FROM outlets WHERE COALESCE(is_active, true) = true"
  );
  const outlets = new Map();
  for (const r of rows) outlets.set(Number(r.id), r.outlet_type || "store");
  _outletCache.set(cacheKey, { outlets, timestamp: now });
  return outlets;
}

function invalidateOutletCache(tenantId) {
  if (tenantId) {
    _outletCache.delete(tenantId);
    _outletCache.delete(String(tenantId));
  } else {
    _outletCache.clear();
  }
  // "_default" covers single-tenant mode — a targeted invalidation there
  // must clear it too since ST callers pass no tenant id.
  if (!IS_MULTI_TENANT) _outletCache.delete("_default");
}

async function _isAssigned(dbHandle, employeeId, outletId) {
  const { rows } = await dbHandle.query(
    "SELECT 1 FROM employee_outlets WHERE employee_id = $1 AND outlet_id = $2 LIMIT 1",
    [employeeId, outletId],
  );
  return !!rows[0];
}

/**
 * Pure resolver — no req/res. Throws OutletContextError on invalid explicit
 * header input; stale JWT oids degrade to { outletId: null, source: "none" }.
 * skipAssignment: pass true for all_access / execute_field_sales principals.
 */
async function resolveRequestedOutlet({ db: dbHandle, cacheKey, headerValue, jwtOid, employeeId, skipAssignment }) {
  const raw = headerValue == null ? "" : String(headerValue).trim();
  if (raw !== "") {
    if (!/^\d+$/.test(raw)) {
      throw new OutletContextError(400, "INVALID_OUTLET_CONTEXT", "Invalid outlet context");
    }
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OutletContextError(400, "INVALID_OUTLET_CONTEXT", "Invalid outlet context");
    }
    const outlets = await _loadOutletsMap(dbHandle, cacheKey);
    if (!outlets.has(id)) {
      throw new OutletContextError(403, "INVALID_OUTLET_CONTEXT", "Invalid outlet context");
    }
    if (!skipAssignment && !(await _isAssigned(dbHandle, employeeId, id))) {
      throw new OutletContextError(
        403,
        "OUTLET_NOT_ASSIGNED",
        "Forbidden: outlet is not assigned to this employee account.",
      );
    }
    return { outletId: id, source: "header" };
  }

  const oid = Number(jwtOid || 0);
  if (Number.isSafeInteger(oid) && oid > 0) {
    const outlets = await _loadOutletsMap(dbHandle, cacheKey);
    if (outlets.has(oid) && (skipAssignment || (await _isAssigned(dbHandle, employeeId, oid)))) {
      return { outletId: oid, source: "jwt" };
    }
  }
  return { outletId: null, source: "none" };
}

/**
 * Middleware — mounts after resolveTenant (needs the tenant DB) and before
 * resolveContext (which consumes the result). Skips resolution entirely for
 * unauthenticated requests (public ?tenant= paths do their own resolution
 * and are never outlet-gated through this chain).
 */
function resolveOutletContext() {
  return async (req, res, next) => {
    req.outletContext = { outletId: null, source: "none" };
    if (!req.path.startsWith("/api/")) return next();
    // MT mode without a JWT-derived tenant scope = a public ?tenant= path
    // (auth, kiosk pin-checkin, anonymous feature-flags bootstrap…) — there
    // is no tenant DB to validate an outlet against, so nothing resolves.
    if (IS_MULTI_TENANT && !req.tenantId) return next();
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return next();
    const perms = req.employeePerms || [];
    try {
      req.outletContext = await resolveRequestedOutlet({
        db: _getDb(req),
        cacheKey: _cacheKey(req),
        headerValue: req.headers["x-outlet-id"],
        jwtOid: req.jwtOid || null,
        employeeId,
        skipAssignment: perms.includes("all_access") || perms.includes("execute_field_sales"),
      });
      next();
    } catch (err) {
      if (err instanceof OutletContextError) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err.message });
    }
  };
}

/**
 * Outlet-assignment enforcement for non-admin employees — moved here from
 * registerAllRoutes.js so it can consume the resolver. The resolved context
 * outlet has already passed the assignment check inside the resolver; this
 * middleware keeps independently checking explicit query/body outlet_id
 * params with the same precedence as before (context wins, then query, then
 * body — exactly one id is checked per request, preserving v1 behavior).
 */
function enforceOutletAssignment() {
  return async (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    // Kiosk PIN routes are public (PIN is the auth) — skip session-based outlet check
    if (req.path.startsWith("/api/attendance/pin-")) return next();
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return next();
    const perms = req.employeePerms || [];
    if (perms.includes("all_access")) return next();
    // Tier 1.2 wholesale: field reps are tenant-scoped, not outlet-scoped.
    // They never have employee_outlets rows, so this enforcement would
    // block every API call carrying an outlet_id. Skip for them.
    // S3 split (PLAN-V2 Step 2): keyed on execute_field_sales — the rep-self
    // perm — NOT manage_field_sales.
    if (perms.includes("execute_field_sales")) return next();

    const contextOutletId = Number(req.outletContext?.outletId || 0);
    const queryOutletId = Number(req.query?.outlet_id || 0);
    const bodyOutletId = Number(req.body?.outlet_id || 0);
    const outletId = contextOutletId || queryOutletId || bodyOutletId;

    if (!outletId) return next();
    // The context outlet was validated (existence + assignment) by the resolver.
    if (outletId === contextOutletId) return next();

    try {
      const assigned = await _isAssigned(_getDb(req), employeeId, outletId);
      if (!assigned) {
        return res.status(403).json({
          error: "Forbidden: outlet is not assigned to this employee account.",
        });
      }
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

function init(deps) {
  db = deps.db;
  IS_MULTI_TENANT = deps.IS_MULTI_TENANT;
  dbProxy = deps.dbProxy;
}

module.exports = {
  init,
  resolveOutletContext,
  enforceOutletAssignment,
  resolveRequestedOutlet,
  invalidateOutletCache,
  OutletContextError,
};

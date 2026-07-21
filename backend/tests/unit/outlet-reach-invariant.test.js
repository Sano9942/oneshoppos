/**
 * Outlet-reach invariant drift guard (PLAN-V3 Step W0d).
 *
 * Two halves of ONE security invariant documented in backend/middleware/CLAUDE.md
 * (see "resolveEffectiveRole" and "outlet-context.js") that nothing else enforces:
 *
 *   Outlet REACH — which outlets a principal may act at — keys on
 *   req.baseEmployeePerms. CAPABILITY — what they may do once there — keys on the
 *   effective req.employeePerms. A per-outlet role override grants capability at
 *   an outlet but must NEVER widen which outlets a principal reaches. So a
 *   reach/assignment check that reads the familiar req.employeePerms instead of
 *   req.baseEmployeePerms would silently let an all_access override at outlet B
 *   smuggle a foreign outlet_id past enforcement.
 *
 * (1a) File-allowlist drift guard. The set of production files performing an
 *      outlet reach/assignment check must be exactly the three below; a fourth
 *      joining fails here so a human confirms the new check keys on base perms.
 *      A file allowlist ALONE is not enough — a wrong req.employeePerms read
 *      added INSIDE an already-allowed file passes 1a. That is what 1b covers.
 *
 * (1b) Behavioural guard. Directly exercises enforceOutletAssignment() with a
 *      principal whose BASE perms lack all_access but whose EFFECTIVE (override)
 *      perms carry it, and asserts outlet reach is STILL denied. This is the
 *      exact case a file allowlist can't see: swap outlet-context.js's
 *      `req.baseEmployeePerms || req.employeePerms` reach read to
 *      `req.employeePerms` and this test — not 1a — is what fails.
 *      enforceOutletAssignment is the one reach reader that runs AFTER
 *      resolveEffectiveRole has swapped req.employeePerms; resolveOutletContext
 *      legitimately reads req.employeePerms because it runs BEFORE the swap, so
 *      base == effective there.
 *      A full-chain HTTP complement lives in
 *      tests/integration/pg-step13-outlet-roles.test.js ("widening
 *      containment"); this is the fast, DB-free semantic pin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Paths are relative to backend/ so the allowlist reads like the middleware map.
const BACKEND_DIR = path.join(__dirname, "..", "..");

// The ONLY production files sanctioned to perform an outlet reach/assignment
// check. Adding a 4th means a new place decides "which outlets may this
// principal reach" — it MUST key on req.baseEmployeePerms, never the effective
// req.employeePerms. See backend/middleware/CLAUDE.md → resolveEffectiveRole /
// outlet-context.js for the invariant. If you legitimately add one, update this
// list AND confirm the new check reads base perms.
const REACH_CHECK_ALLOWLIST = [
  "middleware/outlet-context.js",
  "middleware/tenant-auth.js",
  "routes/registerAllRoutes.js",
].sort();

// The assignment-enforcement idiom — anchored on real identifiers as whole
// tokens, not a bare substring. Any production file touching one of these is
// doing reach/assignment work (defining/mounting enforceOutletAssignment,
// reading baseEmployeePerms, or calling the _isAssigned helper).
const REACH_IDIOM =
  /\b(?:baseEmployeePerms|enforceOutletAssignment|_isAssigned)\b/;

const SKIP_DIRS = new Set([
  "node_modules",
  "tests",
  "archive",
  "backups",
  "tenants",
  "exports",
  "uploads_test",
  "uploads_tmp",
  "coverage",
  ".git",
]);

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkJs(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function relPosix(abs) {
  return path.relative(BACKEND_DIR, abs).split(path.sep).join("/");
}

describe("(1a) outlet-reach check file allowlist", () => {
  it("exactly the sanctioned production files perform a reach/assignment check", () => {
    const matched = walkJs(BACKEND_DIR)
      .filter((f) => REACH_IDIOM.test(fs.readFileSync(f, "utf8")))
      .map(relPosix)
      .sort();
    expect(
      matched,
      "Files doing outlet reach/assignment checks drifted from the allowlist.\n" +
        `Expected: ${JSON.stringify(REACH_CHECK_ALLOWLIST)}\n` +
        `Found:    ${JSON.stringify(matched)}\n` +
        "A new file here must key reach on req.baseEmployeePerms, not the " +
        "effective req.employeePerms (see backend/middleware/CLAUDE.md → " +
        "resolveEffectiveRole / outlet-context.js). If intentional, update " +
        "REACH_CHECK_ALLOWLIST."
    ).toEqual(REACH_CHECK_ALLOWLIST);
  });
});

describe("(1b) enforceOutletAssignment keys reach on BASE perms, not effective", () => {
  // outlet-context.js is CJS; require it and re-init() with a fake db per test.
  let outletContext;

  function makeRes() {
    return {
      statusCode: 200,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
  }

  // Fake db in which the employee is NOT assigned to the outlet it is trying to
  // reach: the employee_outlets lookup returns no row, so _isAssigned() → false.
  function fakeUnassignedDb() {
    return {
      query: vi.fn(async (sql) => {
        if (/FROM employee_outlets/.test(sql)) return { rows: [] };
        return { rows: [] };
      }),
    };
  }

  // A principal mid-request AFTER resolveEffectiveRole has run: BASE perms are
  // the un-overridden role (no all_access), effective req.employeePerms carry an
  // all_access override from some assigned outlet. It is trying to reach outlet
  // 3 (foreign / unassigned) via an explicit query outlet_id.
  function reqReachingForeignOutlet() {
    return {
      path: "/api/sales",
      method: "GET",
      headers: { "x-employee-id": "4" },
      query: { outlet_id: "3" },
      body: {},
      outletContext: { outletId: null, source: "none", overrideRoleId: null },
      baseEmployeePerms: ["pos_discount", "pos_park"], // base: NOT all_access
      employeePerms: ["all_access"], // effective override swapped in
    };
  }

  beforeEach(() => {
    delete require.cache[require.resolve("../../middleware/outlet-context")];
    outletContext = require("../../middleware/outlet-context");
    // Single-tenant so _getDb(req) returns the injected fake db directly.
    outletContext.init({ db: fakeUnassignedDb(), IS_MULTI_TENANT: false });
  });

  it("denies reach to an unassigned outlet even though effective perms are all_access", async () => {
    const mw = outletContext.enforceOutletAssignment();
    const req = reqReachingForeignOutlet();
    const res = makeRes();
    const next = vi.fn();

    await mw(req, res, next);

    // Reach is an identity decision on BASE perms. The override grants capability
    // at an assigned outlet, never reach to an unassigned one. If line ~205's
    // reach read is swapped to req.employeePerms, `perms` becomes ["all_access"],
    // the middleware short-circuits with next(), and these assertions fail.
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toMatch(/not assigned/i);
  });

  it("control: skips enforcement when BASE perms themselves carry all_access", async () => {
    // Same request shape, but the base role IS all_access — enforcement is
    // skipped. This proves the only thing separating deny from skip is the
    // BASE-perm content, which is exactly what the guard above pins.
    const mw = outletContext.enforceOutletAssignment();
    const req = reqReachingForeignOutlet();
    req.baseEmployeePerms = ["all_access"];
    const res = makeRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

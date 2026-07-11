#!/usr/bin/env node
/**
 * Role/permission consistency audit.
 * Backend truth: DEFAULT_ROLE_PERMISSIONS + inline requirePerm/requireAnyPerm + PERMISSION_RULES.
 * Frontend: appRoutes perm() gates, nav-config requiredPerm, hasPerm() sites.
 * Directions: A visible-but-forbidden, B hidden-but-allowed, C unguarded backend, D frontend-only.
 * Read-only. Run from repo root: node docs/fable5/role-audit/role-audit.cjs
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const perms = require(path.join(ROOT, "backend/middleware/permissions.js"));
const catalog = require(path.join(ROOT, "backend/config/permissions-catalog.js"));

const ROLES = perms.DEFAULT_ROLE_PERMISSIONS; // { Administrator, Manager, Cashier, "Field Rep" }
const RULES = perms.PERMISSION_RULES;
const CATALOG_IDS = new Set(
  (catalog.PERMISSIONS_CATALOG || catalog.default || []).map((p) => p.id || p)
);

function walk(dir, exts, skip = []) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some((s) => p.replace(/\\/g, "/").includes(s))) continue;
    if (e.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const lineOf = (t, i) => t.slice(0, i).split("\n").length;

// ---------- backend routes + guards ----------
const SEPARATE_AUTH = [
  /^\/api\/admin(\/|$)/, /^\/api\/portal(\/|$)/, /^\/api\/manufacturer-portal(\/|$)/,
  /^\/api\/webhooks(\/|$)/, /^\/api\/public(\/|$)/, /^\/api\/sandbox(\/|$)/,
  /^\/api\/setup(\/|$)/, /^\/api\/country-packs(\/|$)/, /^\/api\/auth(\/|$)/,
  /^\/api\/member-kiosk(\/|$)/, /^\/api\/storefront(\/|$)/, /\/public$/, /^\/(r2|uploads)/,
];
const routes = [];
for (const file of walk(path.join(ROOT, "backend/routes"), [".js"])) {
  const text = fs.readFileSync(file, "utf8");
  const r = rel(file);
  const prefixes = [];
  for (const m of text.matchAll(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,/g)) prefixes.push(m[1]);
  // resolve spread-guard arrays: const gate = [requireFeature("x"), requirePerm("y")]
  const spreadGuards = {};
  // array guards: const gate = [ requireX(...), ... ];
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g)) {
    if (/require(Perm|AnyPerm|Feature|Mode)/.test(m[2])) spreadGuards[m[1]] = m[2];
  }
  // single-var guards: const perm = requirePerm("x");  const feat = requireFeature("y");
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(require(?:Perm|AnyPerm|Feature|Mode)\([^;]*?\));/g)) {
    spreadGuards[m[1]] = (spreadGuards[m[1]] || "") + " " + m[2];
  }
  if (!prefixes.length && r.startsWith("backend/routes/integrations/") && !r.endsWith("index.js"))
    prefixes.push("/api/integrations");
  for (const m of text.matchAll(/\b(app|router)\.(get|post|put|delete|patch)\(\s*(["'`])((?:\\.|(?!\3).)*)\3/g)) {
    let p = m[4];
    if (!p.startsWith("/")) continue;
    const kind = m[1], method = m[2].toUpperCase();
    const crossMounted = r.startsWith("backend/routes/integrations/") && !r.endsWith("index.js");
    let paths = [];
    if (kind === "app" && !(crossMounted && !p.startsWith("/api"))) paths = [p];
    else paths = (prefixes.length ? prefixes : [""]).map((pre) => (pre + (p === "/" ? "" : p)) || "/");
    // guard window: from match to ~600 chars ahead (covers multi-line middleware lists)
    let win = text.slice(m.index, m.index + 600);
    // expand spread guards (...gate) and bare-identifier guards (perm, feat) with their defs.
    // Only look at the middleware list: between the path string and the async handler.
    const headEnd = win.search(/async\s*\(|\(\s*req\s*,/);
    const head = headEnd > 0 ? win.slice(0, headEnd) : win.slice(0, 200);
    for (const sm of head.matchAll(/(?:\.\.\.)?\b(\w+)\b/g)) {
      if (spreadGuards[sm[1]]) win += " " + spreadGuards[sm[1]];
    }
    let guard = { type: "authenticated", perms: [] };
    const rp = win.match(/requirePerm\(\s*["']([^"']+)["']\s*\)/);
    const rap = win.match(/requireAnyPerm\(\s*\[([^\]]*)\]/);
    if (rp) guard = { type: "perm", perms: [rp[1]] };
    else if (rap) guard = { type: "any", perms: [...rap[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) };
    const feat = win.match(/requireFeature\(\s*["']([^"']+)["']\s*\)/);
    for (const fullPath of paths) {
      routes.push({
        method, path: fullPath, file: r, line: lineOf(text, m.index),
        guard, feature: feat ? feat[1] : null,
        separateAuth: SEPARATE_AUTH.some((rx) => rx.test(fullPath)),
      });
    }
  }
}
// apply PERMISSION_RULES to authenticated-only tenant routes
function concretePath(p) { return p.replace(/:[^/]+/g, "1").replace(/\*/g, "1"); }
for (const rt of routes) {
  if (rt.guard.type !== "authenticated" || rt.separateAuth) continue;
  const cp = concretePath(rt.path);
  for (const rule of RULES) {
    const methods = rule.methods || ["GET", "POST", "PUT", "DELETE", "PATCH"];
    if (!methods.includes(rt.method)) continue;
    if (rule.path.test(cp)) {
      rt.guard = { type: rule.anyPerms ? "any" : "perm", perms: rule.anyPerms || [rule.perm], viaRule: true };
      break;
    }
  }
}
function roleAllowed(roleName, guard) {
  const rp = ROLES[roleName] || [];
  if (rp.includes("all_access")) return true;
  if (guard.type === "authenticated") return true;
  if (guard.type === "perm") return guard.perms.every((p) => rp.includes(p));
  return guard.perms.some((p) => rp.includes(p));
}

// ---------- frontend gates ----------
const FE = path.join(ROOT, "frontend/src");
const feFiles = walk(FE, [".js", ".jsx"], ["frontend/src/types"]);
const feTexts = new Map(feFiles.map((f) => [f, fs.readFileSync(f, "utf8")]));

// appRoutes: <Route path="/x" element={perm("y", <Comp/> | wrap(Comp))} /> and ungated routes
const appRoutesFile = path.join(FE, "routes/appRoutes.jsx");
const arText = fs.readFileSync(appRoutesFile, "utf8");
const routeGates = []; // {path, perm|null, comp}
for (const m of arText.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(?:perm\(\s*"([^"]+)"\s*,\s*)?(?:wrap\()?<?(\w+)/g)) {
  routeGates.push({ path: m[1], perm: m[2] || null, comp: m[3] });
}
// import map in appRoutes (static + lazy)
const importMap = {};
for (const m of arText.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["']/g)) importMap[m[1]] = m[2];
for (const m of arText.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(["']([^"']+)["']\)\)/g)) importMap[m[1]] = m[2];

function resolveFe(spec, fromDir) {
  if (!spec) return null;
  let base = spec.startsWith("@/") ? path.join(FE, spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const c of [base, base + ".jsx", base + ".js", path.join(base, "index.jsx")])
    if (feTexts.has(c) || (fs.existsSync(c) && fs.statSync(c).isFile())) return c;
  return null;
}
// component tree calls: BFS depth 3 collecting api calls
const METHOD_MAP = { get: "GET", post: "POST", put: "PUT", del: "DELETE", upload: "POST", raw: null };
function callsOf(text) {
  const out = [];
  for (const m of text.matchAll(/\bapi\.(get|post|put|del|upload|raw)\(\s*(["'`])((?:\\.|(?!\2).)*)\2/g)) {
    let p = m[3].split("?")[0].replace(/\$\{[^}]*\}/g, "*");
    const i = p.indexOf("/api/");
    if (i > 0) p = p.slice(i);
    if (p.startsWith("/api/")) out.push({ method: METHOD_MAP[m[1]], path: p });
  }
  return out;
}
function importsOf(file, text) {
  const specs = [];
  for (const m of text.matchAll(/import\s+(?:[^"'`]*?from\s*)?["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  for (const m of text.matchAll(/export\s+[^"'`;]*?from\s*["']([^"']+)["']/g)) specs.push(m[1]);
  return specs.map((s) => resolveFe(s, path.dirname(file))).filter(Boolean);
}
function treeCalls(entryFile, depth = 3) {
  const seen = new Set(); const calls = []; let frontier = [entryFile];
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) {
      if (seen.has(f) || !f.replace(/\\/g, "/").includes("/src/")) continue;
      seen.add(f);
      const t = feTexts.get(f) ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
      calls.push(...callsOf(t));
      next.push(...importsOf(f, t));
    }
    frontier = next;
  }
  return calls;
}
function segs(p) { return p.split("/").filter(Boolean); }
function matchRoute(method, cpath) {
  const b = segs(cpath);
  return routes.filter((rt) => {
    if (method && rt.method !== method) return false;
    const a = segs(rt.path);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const xw = a[i].startsWith(":"), yw = b[i] === "*" || b[i].includes("*");
      if (!xw && !yw && a[i] !== b[i]) return false;
    }
    return true;
  });
}

// nav entries
const navText = fs.readFileSync(path.join(FE, "ui/nav-config.js"), "utf8");
const navEntries = [];
for (const m of navText.matchAll(/\{[^{}]*?\bpath:\s*"([^"]+)"[^{}]*?\}/gs)) {
  const block = m[0];
  const label = (block.match(/name:\s*"([^"]+)"/) || [])[1];
  const requiredPerm = (block.match(/requiredPerm:\s*"([^"]+)"/) || [])[1] || null;
  const requiredFlag = (block.match(/requiredFlag:\s*"([^"]+)"/) || [])[1] || null;
  navEntries.push({ to: m[1], label, requiredPerm, requiredFlag });
}

// hasPerm sites
const hasPermSites = [];
for (const [f, t] of feTexts) {
  for (const m of t.matchAll(/hasPerm\(\s*["']([^"']+)["']\s*\)/g)) hasPermSites.push({ file: rel(f), line: lineOf(t, m.index), perm: m[1] });
}
// hardcoded role names
const roleHardcodes = [];
for (const [f, t] of feTexts) {
  for (const m of t.matchAll(/(?:role_name|roleName|role)\s*(?:===|==|!==)\s*["'](Administrator|Manager|Cashier|Field Rep)["']/g))
    roleHardcodes.push({ file: rel(f), line: lineOf(t, m.index), match: m[0] });
}

// ---------- cross-products ----------
const tenantRoutes = routes.filter((r) => !r.separateAuth);
const unguardedMut = tenantRoutes.filter((r) => r.guard.type === "authenticated" && ["POST", "PUT", "DELETE", "PATCH"].includes(r.method));
const unguardedGet = tenantRoutes.filter((r) => r.guard.type === "authenticated" && r.method === "GET");

// route-gate ↔ API consistency per role
const AUDIT_ROLES = ["Manager", "Cashier", "Field Rep"];
const pageFindings = [];
for (const rg of routeGates) {
  const compFile = resolveFe(importMap[rg.comp], path.dirname(appRoutesFile));
  if (!compFile) continue;
  const calls = treeCalls(compFile);
  const denials = {};
  for (const role of AUDIT_ROLES) {
    const gateOk = !rg.perm || (ROLES[role] || []).includes(rg.perm) || (ROLES[role] || []).includes("all_access");
    const deniedCalls = [];
    let getAllowed = 0, getTotal = 0;
    for (const c of calls) {
      const matches = matchRoute(c.method, c.path);
      if (!matches.length) continue;
      const anyAllowed = matches.some((rt) => roleAllowed(role, rt.guard));
      if (c.method === "GET" || c.method === null) { getTotal++; if (anyAllowed) getAllowed++; }
      if (!anyAllowed) deniedCalls.push(`${c.method || "?"} ${c.path} [needs ${matches[0].guard.perms.join("|") || "?"}]`);
    }
    denials[role] = { gateOk, deniedCalls: [...new Set(deniedCalls)].slice(0, 8), getTotal, getAllowed };
  }
  pageFindings.push({ route: rg.path, gate: rg.perm, comp: rg.comp, denials, callCount: calls.length });
}

// nav vs route-gate mismatches (nav visible without perm but route gated, or vice versa)
const navMismatch = [];
for (const n of navEntries) {
  const rg = routeGates.find((g) => g.path === n.to || "/" + g.path === n.to || g.path === n.to.slice(1));
  if (!rg) continue;
  if ((n.requiredPerm || null) !== (rg.perm || null)) navMismatch.push({ nav: n.to, label: n.label, navPerm: n.requiredPerm, routePerm: rg.perm });
}

// frontend perm strings not in catalog
const feStrings = new Set([
  ...routeGates.map((g) => g.perm).filter(Boolean),
  ...navEntries.map((n) => n.requiredPerm).filter(Boolean),
  ...hasPermSites.map((h) => h.perm),
]);
const unknownPerms = [...feStrings].filter((p) => !CATALOG_IDS.has(p));

const out = {
  generated: new Date().toISOString(),
  counts: {
    routesTotal: routes.length, tenantRoutes: tenantRoutes.length,
    unguardedMutations: unguardedMut.length, unguardedGets: unguardedGet.length,
    routeGates: routeGates.length, navEntries: navEntries.length,
    hasPermSites: hasPermSites.length, unknownFrontendPerms: unknownPerms.length,
    navRouteGateMismatches: navMismatch.length, roleHardcodes: roleHardcodes.length,
  },
  roles: ROLES,
  unguardedMutations: unguardedMut.map(({ method, path: p, file, line }) => ({ method, path: p, file, line })),
  unguardedGets: unguardedGet.map(({ method, path: p, file, line }) => ({ method, path: p, file, line })),
  pageFindings, navMismatch, unknownPerms, roleHardcodes,
  hasPermSites,
};
fs.writeFileSync(path.join(__dirname, "role-matrix.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.counts, null, 2));

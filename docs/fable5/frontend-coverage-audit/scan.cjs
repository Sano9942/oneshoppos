#!/usr/bin/env node
/**
 * Frontend-coverage audit scanner.
 * Cross-references: backend routes <-> frontend callers <-> page import graph <-> nav/links <-> flags/presets.
 * Read-only. Output: matrix.json + console summary in this folder.
 * Run: node docs/fable5/frontend-coverage-audit/scan.cjs  (from repo root)
 */
const fs = require("fs");
const path = require("path");

// Adapted for CI (PLAN-V2 Step 6b): the whole scan is wrapped in runScan() and
// exported so backend/tests/unit/frontend-coverage-drift.test.js can freeze the
// dead-route set as a baseline and fail only on NEW orphans. Running the file
// directly still writes matrix.json + prints the summary (require.main block).
function runScan() {
const ROOT = path.resolve(__dirname, "../../..");
const BACKEND_ROUTES = path.join(ROOT, "backend", "routes");
const FRONTEND_SRC = path.join(ROOT, "frontend", "src");

function walk(dir, exts, skip = []) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some((s) => p.includes(s))) continue;
    if (e.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

// ---------- 1. Backend routes ----------
const backendRoutes = []; // {method, path, file, line}
for (const file of walk(BACKEND_ROUTES, [".js"])) {
  const text = fs.readFileSync(file, "utf8");
  // mount prefixes for router.* in this file
  const prefixes = [];
  for (const m of text.matchAll(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,/g)) prefixes.push(m[1]);
  // cross-file mounts (verified in source): integrations/* receive the /api/integrations router
  // as their `app` param (integrations/index.js:22); setup.js router factory is mounted at
  // /api/setup (registerAllRoutes.js:230); country-packs at /api/country-packs (:233).
  const r = rel(file);
  if (!prefixes.length) {
    if (r.startsWith("backend/routes/integrations/") && !r.endsWith("index.js")) prefixes.push("/api/integrations");
    else if (r.endsWith("routes/setup.js")) prefixes.push("/api/setup");
    else if (r.endsWith("routes/country-packs.js")) prefixes.push("/api/country-packs");
  }
  // integrations/* define routes via the passed-in router param but the regex sees `router.`
  // only if the local name is `router`; they use the injected name too — also treat `app.<verb>`
  // in these files as router-relative when the path does not start with /api.
  for (const m of text.matchAll(/\b(app|router)\.(get|post|put|delete|patch)\(\s*(["'`])((?:\\.|(?!\3).)*)\3/g)) {
    const kind = m[1], method = m[2].toUpperCase();
    let p = m[4];
    if (!p.startsWith("/")) continue;
    const line = lineOf(text, m.index);
    const crossMounted = r.startsWith("backend/routes/integrations/") && !r.endsWith("index.js");
    if (kind === "app" && !(crossMounted && !p.startsWith("/api"))) {
      backendRoutes.push({ method, path: p, file: rel(file), line });
    } else {
      const pres = prefixes.length ? prefixes : [""];
      for (const pre of pres) {
        const full = (pre + (p === "/" ? "" : p)) || "/";
        backendRoutes.push({ method, path: full, file: rel(file), line });
      }
    }
  }
}

// ---------- 2. Frontend callers ----------
function normPath(p) {
  p = p.split("?")[0].trim();
  const i = p.indexOf("/api/");
  if (i > 0) p = p.slice(i);
  p = p.replace(/\$\{[^}]*\}/g, "*");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}
const SKIP_FE = [path.join("frontend", "src", "types")];
const feFiles = walk(FRONTEND_SRC, [".js", ".jsx"], SKIP_FE);
const structuredCalls = []; // {method|null, path, file, line}
const looseLiterals = []; // {path, file, line}  any string containing /api/
const METHOD_MAP = { get: "GET", post: "POST", put: "PUT", del: "DELETE", upload: "POST", raw: null };
for (const file of feFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\bapi\.(get|post|put|del|upload|raw)\(\s*(["'`])((?:\\.|(?!\2).)*)\2/g)) {
    const p = normPath(m[3]);
    if (!p.startsWith("/")) continue;
    structuredCalls.push({ method: METHOD_MAP[m[1]], path: p, file: rel(file), line: lineOf(text, m.index) });
  }
  for (const m of text.matchAll(/\b(adminFetch|fetch)\(\s*(["'`])((?:\\.|(?!\2).)*)\2/g)) {
    if (!m[3].includes("/api")) continue;
    const p = normPath(m[3]);
    if (!p.startsWith("/")) continue;
    structuredCalls.push({ method: null, path: p, file: rel(file), line: lineOf(text, m.index) });
  }
  // loose: every quoted/template literal containing /api/
  for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1).)*?\/api\/(?:\\.|(?!\1).)*)\1/g)) {
    const p = normPath(m[2]);
    if (p.startsWith("/api/")) looseLiterals.push({ path: p, file: rel(file), line: lineOf(text, m.index) });
  }
}

// ---------- 3. Matching ----------
function segs(p) { return p.split("/").filter(Boolean); }
function segMatch(be, fe) {
  const a = segs(be), b = segs(fe);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    const xw = x.startsWith(":") || x === "*";
    const yw = y === "*" || y.includes("*");
    if (!xw && !yw && x !== y) return false;
  }
  return true;
}
const allFe = structuredCalls.concat(looseLiterals.map((l) => ({ method: null, ...l })));
for (const r of backendRoutes) {
  r.callers = [];
  for (const c of allFe) {
    if (!segMatch(r.path, c.path)) continue;
    if (c.method && c.method !== r.method) continue;
    r.callers.push(`${c.file}:${c.line}`);
    if (r.callers.length >= 5) break;
  }
  // path-only fallback (method mismatch detection)
  r.pathOnlyMatch = r.callers.length > 0 || allFe.some((c) => segMatch(r.path, c.path));
}
const deadRoutes = backendRoutes.filter((r) => r.callers.length === 0);

// Triage: for each dead route, grep the frontend corpus for its most distinctive static
// segment (catches dynamic path construction the call-regexes miss) and the tests corpus.
const feTexts = feFiles.map((f) => ({ file: rel(f), text: fs.readFileSync(f, "utf8") }));
const testFiles = walk(path.join(ROOT, "frontend", "tests"), [".js"]);
const testTexts = testFiles.map((f) => ({ file: rel(f), text: fs.readFileSync(f, "utf8") }));
function fragmentPair(p) {
  const s = segs(p).filter((x) => !x.startsWith(":") && x !== "api" && x !== "*");
  if (!s.length) return [null, null];
  return [s[s.length - 1], s[0] === s[s.length - 1] ? null : s[0]]; // [distinctive, domain]
}
for (const rte of deadRoutes) {
  const [frag, domain] = fragmentPair(rte.path);
  rte.fragment = domain ? `${domain} + ${frag}` : frag;
  rte.fragmentHits = [];
  rte.testHits = [];
  const needle = "/" + frag; // path-like occurrence, not prose
  if (frag && frag.length >= 4) {
    for (const { file, text } of feTexts) {
      if (!text.includes(needle)) continue;
      if (domain && !text.includes(domain)) continue; // require domain co-occurrence
      const i = text.indexOf(needle);
      rte.fragmentHits.push(`${file}:${lineOf(text, i)}`);
      if (rte.fragmentHits.length >= 3) break;
    }
    for (const { file } of testTexts.filter((t) => t.text.includes(needle) && (!domain || t.text.includes(domain))).slice(0, 2)) rte.testHits.push(file);
  }
}

// reverse: structured frontend calls with no backend route (path-level)
const brokenCalls = structuredCalls.filter(
  (c) => c.path.startsWith("/api/") && !c.path.includes("*") === false || true
).filter((c) => c.path.startsWith("/api/") && !backendRoutes.some((r) => segMatch(r.path, c.path)));

// ---------- 4. Page import graph ----------
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(FRONTEND_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const cand of [base, base + ".jsx", base + ".js", path.join(base, "index.jsx"), path.join(base, "index.js")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}
const entryFiles = [path.join(FRONTEND_SRC, "main.jsx"), path.join(FRONTEND_SRC, "App.jsx")].filter(fs.existsSync);
const visited = new Set();
const queue = [...entryFiles];
while (queue.length) {
  const f = queue.pop();
  if (visited.has(f)) continue;
  visited.add(f);
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const specs = [];
  for (const m of text.matchAll(/import\s+(?:[^"'`]*?from\s*)?["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  for (const m of text.matchAll(/export\s+[^"'`;]*?from\s*["']([^"']+)["']/g)) specs.push(m[1]);
  for (const s of specs) {
    const r2 = resolveImport(f, s);
    if (r2 && !visited.has(r2)) queue.push(r2);
  }
}
const pageFiles = walk(path.join(FRONTEND_SRC, "pages"), [".jsx"]);
const orphanPages = pageFiles.filter((f) => !visited.has(f)).map(rel);

// ---------- 5. Route paths vs nav/links ----------
const routeDefFiles = walk(path.join(FRONTEND_SRC, "routes"), [".jsx"]).concat(entryFiles);
const routePaths = new Set();
for (const f of routeDefFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/\bpath\s*[:=]\s*["']([^"']+)["']/g)) {
    if (m[1].startsWith("/") || !m[1].includes("/")) routePaths.add(m[1].startsWith("/") ? m[1] : "/" + m[1]);
  }
}
const navTargets = new Set();
for (const f of feFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/\bto\s*=\s*["']([^"']+)["']/g)) navTargets.add(m[1].split("?")[0]);
  for (const m of text.matchAll(/\bto\s*=\s*\{\s*["']([^"']+)["']\s*\}/g)) navTargets.add(m[1].split("?")[0]);
  for (const m of text.matchAll(/\bnavigate\(\s*["']([^"']+)["']/g)) navTargets.add(m[1].split("?")[0]);
  for (const m of text.matchAll(/\b(?:path|to|href)\s*:\s*["'](\/[^"']*)["']/g)) navTargets.add(m[1].split("?")[0]);
  // template-literal links: navigate(`/x/${id}`), to={`/x/${id}`}, href: `/x/${id}`
  for (const m of text.matchAll(/\b(?:navigate\(|to\s*=\s*\{?|href\s*[:=]\s*)`([^`]*)`/g)) {
    const t = m[1].split("?")[0].replace(/\$\{[^}]*\}/g, "*");
    if (t.startsWith("/")) navTargets.add(t);
  }
}
function navMatch(routePath) {
  if (navTargets.has(routePath)) return true;
  const a = segs(routePath);
  for (const t of navTargets) {
    const b = segs(t);
    if (a.length !== b.length) continue;
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(":") || b[i] === "*") continue;
      if (a[i] !== b[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
const unlinkedRoutes = [...routePaths].filter((p) => !navMatch(p)).sort();

// ---------- 6. Flags ----------
let flagReport = {};
try {
  const ffText = fs.readFileSync(path.join(ROOT, "backend", "middleware", "feature-flags.js"), "utf8");
  const blockM = ffText.match(/DEFAULT_FEATURE_FLAGS\s*=\s*(?:Object\.freeze\()?\{([\s\S]*?)\}\s*\)?;/);
  const defaults = {};
  if (blockM) {
    for (const m of blockM[1].matchAll(/^\s*([a-z0-9_]+)\s*:\s*(true|false)/gim)) defaults[m[1]] = m[2] === "true";
  }
  const bm = require(path.join(ROOT, "backend", "config", "business-modules.js"));
  const modeReg = require(path.join(ROOT, "backend", "config", "mode-registry.js"));
  const indCfg = require(path.join(ROOT, "backend", "config", "industry-config.js"));

  const cardFlags = new Set(), subToggles = new Set();
  const modules = bm.BUSINESS_MODULES || bm.default || {};
  for (const key of Object.keys(modules)) {
    const c = modules[key];
    (c.flags || []).forEach((f) => cardFlags.add(f));
    (c.sub_toggles || []).forEach((s) => subToggles.add(typeof s === "string" ? s : s.key || s.flag));
  }
  const toArr = (x) => Array.isArray(x) ? x : x instanceof Set ? [...x] : x && typeof x === "object" ? Object.keys(x) : [];
  const unmanaged = new Set(toArr(bm.UNMANAGED_FLAGS));
  const modeFlags = new Set();
  const modesObj = modeReg.MODES || modeReg.MODE_REGISTRY || modeReg;
  for (const k of Object.keys(modesObj)) {
    const v = modesObj[k];
    if (v && typeof v === "object") toArr(v.feature_flags_to_enable).forEach((f) => modeFlags.add(f));
  }
  const presetFlags = new Set();
  const scanObj = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "boolean" && k in defaults) presetFlags.add(k);
      else if (Array.isArray(v)) v.forEach((x) => { if (typeof x === "string" && x in defaults) presetFlags.add(x); else scanObj(x); });
      else if (typeof v === "object") scanObj(v);
    }
  };
  scanObj(indCfg);
  flagReport = { defaults, orphanFlags: [], classification: {} };
  for (const [flag, def] of Object.entries(defaults)) {
    const via = [];
    if (def) via.push("default_on");
    if (cardFlags.has(flag)) via.push("module_card");
    if (subToggles.has(flag)) via.push("sub_toggle");
    if (modeFlags.has(flag)) via.push("mode_bundle");
    if (presetFlags.has(flag)) via.push("industry_preset");
    if (unmanaged.has(flag)) via.push("unmanaged_bucketD");
    flagReport.classification[flag] = via;
    if (via.length === 0) flagReport.orphanFlags.push(flag);
  }
} catch (e) {
  flagReport = { error: String(e) };
}

// ---------- output ----------
const out = {
  generated: new Date().toISOString(),
  counts: {
    backendRoutes: backendRoutes.length,
    frontendStructuredCalls: structuredCalls.length,
    deadRouteCandidates: deadRoutes.length,
    brokenFrontendCalls: brokenCalls.length,
    pageFiles: pageFiles.length,
    orphanPages: orphanPages.length,
    routePaths: routePaths.size,
    unlinkedRoutes: unlinkedRoutes.length,
    orphanFlags: (flagReport.orphanFlags || []).length,
  },
  deadRoutes: deadRoutes.map(({ method, path: p, file, line, pathOnlyMatch, fragment, fragmentHits, testHits }) => ({ method, path: p, file, line, pathOnlyMatch, fragment, fragmentHits, testHits })),
  brokenCalls,
  orphanPages,
  unlinkedRoutes,
  flagReport,
};
  return out;
}

module.exports = { runScan };

// ---------- CLI ----------
if (require.main === module) {
  const out = runScan();
  fs.writeFileSync(path.join(__dirname, "matrix.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.counts, null, 2));
  console.log("\nDead-route candidates by file:");
  const byFile = {};
  for (const r of out.deadRoutes) byFile[r.file] = (byFile[r.file] || 0) + 1;
  Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${n}\t${f}`));
}

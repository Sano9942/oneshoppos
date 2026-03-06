const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BACKEND_DIR = path.join(ROOT, "backend", "routes");
const FRONTEND_DIR = path.join(ROOT, "frontend", "src");
const DOCS_DIR = path.join(ROOT, "docs");
const API_PARITY_DIR = path.join(DOCS_DIR, "api-parity");
const REPORT_PATH = path.join(DOCS_DIR, "API_PARITY_AUDIT.md");
const JSON_REPORT_PATH = path.join(API_PARITY_DIR, "audit-latest.json");
const REGISTRY_PATH = path.join(API_PARITY_DIR, "parity-registry.json");
const INTENTIONAL_MD_PATH = path.join(DOCS_DIR, "INTENTIONAL_BACKEND_ONLY_APIS.md");

const ALLOWED_CLASSIFICATIONS = new Set([
  "frontend_mapped",
  "internal_system_only",
  "backend_only_by_design",
  "deprecated_pending_removal",
]);

function parseArgs(argv) {
  const opts = {
    format: "both",
    failOn: null,
    syncRegistry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--format") {
      opts.format = String(argv[i + 1] || "").toLowerCase();
      i += 1;
      continue;
    }
    if (a === "--fail-on") {
      opts.failOn = String(argv[i + 1] || "").toLowerCase();
      i += 1;
      continue;
    }
    if (a === "--sync-registry") {
      opts.syncRegistry = true;
      continue;
    }
  }
  if (!["md", "json", "both"].includes(opts.format)) {
    throw new Error("Invalid --format. Use md|json|both");
  }
  if (opts.failOn && !["frontend-only", "unclassified"].includes(opts.failOn)) {
    throw new Error("Invalid --fail-on. Use frontend-only|unclassified");
  }
  return opts;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

function asPosix(p) {
  return p.replace(/\\/g, "/");
}

function shouldScanFile(p) {
  const s = asPosix(p);
  if (s.includes("/archive/")) return false;
  if (s.includes(".bak.")) return false;
  if (s.endsWith(".bak.js") || s.endsWith(".bak.jsx")) return false;
  return /\.(js|jsx|ts|tsx)$/.test(s);
}

function normalizePath(input) {
  let out = String(input || "").trim();
  if (!out) return "";
  out = out.replace(/^https?:\/\/[^/]+/i, "");
  out = out.replace(/\\/g, "/");
  out = out.replace(/`/g, "");
  out = out.replace(/\?.*$/, "");
  out = out.replace(/\$\{[^}]+\}/g, "__EXPR__");
  out = out.replace(/\/__EXPR__(?=\/|$)/g, "/:param");
  out = out.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, ":param");
  out = out.replace(/__EXPR__/g, "");
  out = out.replace(/\/+/g, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  if (out.length > 1) out = out.replace(/\/$/, "");
  return out;
}

function keyOf(row) {
  return `${row.method} ${row.path}`;
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function extractBackendEndpoints() {
  const files = walk(BACKEND_DIR).filter(shouldScanFile);
  const rows = [];
  const routeRegex =
    /\b(?:app|router)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*([`'"])(\/api\/[^`'"]+)\2/gim;

  for (const file of files) {
    const text = readText(file);
    let m;
    while ((m = routeRegex.exec(text)) !== null) {
      rows.push({
        source: asPosix(path.relative(ROOT, file)),
        method: m[1].toUpperCase(),
        rawPath: m[3],
        path: normalizePath(m[3]),
      });
    }
  }

  return uniqueBy(
    rows.filter((r) => r.path.startsWith("/api/")),
    keyOf,
  );
}

function inferMethodFromContext(text, idx) {
  const forward = text.slice(idx, Math.min(text.length, idx + 400));
  const forwardMatch = forward.match(
    /method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)["'`]/i,
  );
  if (forwardMatch) return forwardMatch[1].toUpperCase();

  const start = Math.max(0, idx - 500);
  const backward = text.slice(start, idx);
  const backwardMatches = [...backward.matchAll(/method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)["'`]/gi)];
  if (backwardMatches.length > 0) {
    const last = backwardMatches[backwardMatches.length - 1];
    return String(last[1] || "GET").toUpperCase();
  }

  return "GET";
}

function cleanFrontendApiCandidate(candidate) {
  let out = String(candidate || "");
  out = out.replace(/[+)]*$/g, "");
  out = out.replace(/\$\{[^}]*$/g, "__EXPR__");
  out = out.replace(/\$\{[^}]+\}/g, "__EXPR__");
  out = out.replace(/\/__EXPR__(?=\/|\?|$)/g, "/:param");
  out = out.replace(/__EXPR__(?=\?|$)/g, "");
  out = out.replace(/__EXPR__/g, "");
  out = normalizePath(out);
  return out;
}

function extractFrontendCalls() {
  const files = walk(FRONTEND_DIR).filter(shouldScanFile);
  const rows = [];
  const warnings = [];
  const apiPathRegex = /\/api\/[^"'`\s)]*/g;
  const nonApiFetchRegex = /fetch\s*\(\s*`[^`]*\$\{API[^}]*\}\/(?!api\/)([^`]+)`/g;

  for (const file of files) {
    const text = readText(file);
    let m;
    while ((m = apiPathRegex.exec(text)) !== null) {
      const raw = m[0];
      const cleaned = cleanFrontendApiCandidate(raw);
      if (!cleaned.startsWith("/api/")) continue;
      if (/\/api\/[^/]+:param$/.test(cleaned)) {
        warnings.push({
          type: "frontend_parser_artifact",
          source: asPosix(path.relative(ROOT, file)),
          detail: raw,
        });
        continue;
      }
      rows.push({
        source: asPosix(path.relative(ROOT, file)),
        method: inferMethodFromContext(text, m.index),
        rawPath: raw,
        path: cleaned,
      });
    }

    while ((m = nonApiFetchRegex.exec(text)) !== null) {
      const suspiciousPath = `/${String(m[1] || "").split("?")[0].replace(/\$\{[^}]+\}/g, ":param")}`;
      if (!/\/(roles|products|employees|outlets|customers|sales|reports|integrations|attendance|shifts|suppliers|taxes)\b/.test(suspiciousPath)) continue;
      warnings.push({
        type: "frontend_non_api_path",
        source: asPosix(path.relative(ROOT, file)),
        detail: suspiciousPath,
      });
    }
  }

  return {
    calls: uniqueBy(
      rows.filter((r) => r.path.startsWith("/api/")),
      keyOf,
    ),
    warnings: uniqueBy(warnings, (w) => `${w.type} ${w.source} ${w.detail}`),
  };
}

function moduleOwner(sourcePath) {
  const src = asPosix(sourcePath || "");
  const rel = src.replace(/^backend\/routes\//, "").replace(/\.(js|ts)$/, "");
  return `${rel.replace(/\//g, "_")}_maintainer`;
}

function classifyHeuristic(endpoint) {
  const k = `${endpoint.method} ${endpoint.path}`.toLowerCase();
  if (
    k.includes("/health") ||
    k.includes("/webhooks") ||
    k.includes("/sync/process-pending") ||
    k.includes("/sync/retry") ||
    k.includes("/backup/") ||
    k.includes("/uploads/")
  ) {
    return {
      classification: "internal_system_only",
      reason: "Operational endpoint for system health, automation, or background processing.",
    };
  }
  return {
    classification: "backend_only_by_design",
    reason: "No direct frontend usage detected; reviewed as backend capability or non-UI operation.",
  };
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return {
      version: 1,
      generated_at: null,
      entries: [],
    };
  }
  const raw = JSON.parse(readText(REGISTRY_PATH));
  return {
    version: Number(raw.version || 1),
    generated_at: raw.generated_at || null,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };
}

function syncRegistry(registry, backendOnly) {
  const byEndpoint = new Map((registry.entries || []).map((e) => [String(e.endpoint || ""), e]));
  const today = new Date().toISOString().slice(0, 10);

  for (const row of backendOnly) {
    const endpoint = keyOf(row);
    if (byEndpoint.has(endpoint)) continue;
    const heuristic = classifyHeuristic(row);
    byEndpoint.set(endpoint, {
      endpoint,
      classification: heuristic.classification,
      frontend_refs: [],
      reason: heuristic.reason,
      owner: moduleOwner(row.source),
      review_date: today,
      source: row.source,
    });
  }

  const entries = [...byEndpoint.values()].sort((a, b) => String(a.endpoint).localeCompare(String(b.endpoint)));
  return {
    version: registry.version || 1,
    generated_at: new Date().toISOString(),
    entries,
  };
}

function validateRegistry(registry) {
  const invalid = [];
  for (const e of registry.entries || []) {
    if (!e || typeof e !== "object") {
      invalid.push({ endpoint: null, reason: "entry is not an object" });
      continue;
    }
    if (!e.endpoint || typeof e.endpoint !== "string") {
      invalid.push({ endpoint: null, reason: "missing endpoint" });
      continue;
    }
    if (!ALLOWED_CLASSIFICATIONS.has(e.classification)) {
      invalid.push({
        endpoint: e.endpoint,
        reason: `invalid classification '${e.classification || ""}'`,
      });
    }
    if (!e.owner || !String(e.owner).trim()) {
      invalid.push({ endpoint: e.endpoint, reason: "missing owner" });
    }
    if (!e.reason || !String(e.reason).trim()) {
      invalid.push({ endpoint: e.endpoint, reason: "missing reason" });
    }
  }
  return invalid;
}

function toRefsMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r.source);
  }
  for (const [k, refs] of map.entries()) {
    map.set(k, [...new Set(refs)].sort());
  }
  return map;
}

function computeMethodMismatches(backend, frontend) {
  const backendByPath = new Map();
  const frontendByPath = new Map();
  for (const b of backend) {
    if (!backendByPath.has(b.path)) backendByPath.set(b.path, new Set());
    backendByPath.get(b.path).add(b.method);
  }
  for (const f of frontend) {
    if (!frontendByPath.has(f.path)) frontendByPath.set(f.path, new Set());
    frontendByPath.get(f.path).add(f.method);
  }

  const out = [];
  for (const [p, fMethodsSet] of frontendByPath.entries()) {
    if (!backendByPath.has(p)) continue;
    const bMethods = [...backendByPath.get(p)].sort();
    const fMethods = [...fMethodsSet].sort();
    const unmatched = fMethods.filter((m) => !backendByPath.get(p).has(m));
    if (unmatched.length === 0) continue;
    out.push({
      path: p,
      backend_methods: bMethods,
      frontend_methods: fMethods,
      unmatched_frontend_methods: unmatched,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function toIntentionalMarkdown(registry) {
  const lines = [];
  lines.push("# Intentional Backend-Only APIs");
  lines.push("");
  lines.push("Generated from `docs/api-parity/parity-registry.json`.");
  lines.push("");
  lines.push("## Legend");
  lines.push("");
  lines.push("- `internal_system_only`: health checks, webhooks, background-job triggers, maintenance.");
  lines.push("- `backend_only_by_design`: used by scripts/integrations/admin tooling, not app UI.");
  lines.push("- `deprecated_pending_removal`: legacy path, kept temporarily.");
  lines.push("");
  lines.push("## Entries");
  lines.push("");
  lines.push("| Endpoint | Classification | Owner | Review Date | Reason |");
  lines.push("|---|---|---|---|---|");
  const rows = (registry.entries || [])
    .filter((e) => e.classification !== "frontend_mapped")
    .sort((a, b) => String(a.endpoint).localeCompare(String(b.endpoint)));
  if (rows.length === 0) {
    lines.push("| _none_ | _none_ | _none_ | _none_ | _none_ |");
  } else {
    for (const e of rows) {
      lines.push(
        `| \`${e.endpoint}\` | \`${e.classification}\` | ${e.owner || ""} | ${e.review_date || ""} | ${String(e.reason || "").replace(/\|/g, "\\|")} |`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function toMarkdown(audit) {
  const lines = [];
  lines.push("# API Parity Audit");
  lines.push("");
  lines.push(`Generated: ${audit.generated_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Backend endpoints (method+path): ${audit.summary.backend_endpoints}`);
  lines.push(`- Frontend API usages (method+path): ${audit.summary.frontend_calls}`);
  lines.push(`- Backend-only endpoints: ${audit.summary.backend_only}`);
  lines.push(`- Frontend-only usages: ${audit.summary.frontend_only}`);
  lines.push(`- Unclassified backend-only endpoints: ${audit.summary.unclassified_backend_only}`);
  lines.push(`- Method mismatch paths: ${audit.summary.method_mismatch_paths}`);
  lines.push("");
  lines.push("## Backend Only");
  lines.push("");
  for (const r of audit.backend_only) {
    lines.push(`- \`${r.endpoint}\` (${r.source})`);
  }
  if (audit.backend_only.length === 0) lines.push("- None");
  lines.push("");
  lines.push("## Frontend Only");
  lines.push("");
  for (const r of audit.frontend_only) {
    lines.push(`- \`${r.endpoint}\` (${r.source})`);
  }
  if (audit.frontend_only.length === 0) lines.push("- None");
  lines.push("");
  lines.push("## Method Mismatches");
  lines.push("");
  for (const m of audit.method_mismatches) {
    lines.push(
      `- \`${m.path}\` backend=${m.backend_methods.join(",")} frontend=${m.frontend_methods.join(",")} unmatched_frontend=${m.unmatched_frontend_methods.join(",")}`,
    );
  }
  if (audit.method_mismatches.length === 0) lines.push("- None");
  lines.push("");
  lines.push("## Confidence Warnings");
  lines.push("");
  for (const w of audit.confidence_warnings) {
    lines.push(`- \`${w.type}\` ${w.detail} (${w.source})`);
  }
  if (audit.confidence_warnings.length === 0) lines.push("- None");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This scan is static analysis; dynamic URL construction may still require manual review.");
  lines.push("- Registry source: `docs/api-parity/parity-registry.json`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildAudit(opts = {}) {
  ensureDir(API_PARITY_DIR);
  const backend = extractBackendEndpoints();
  const frontendExtraction = extractFrontendCalls();
  const frontend = frontendExtraction.calls;
  const confidenceWarnings = frontendExtraction.warnings;
  const methodMismatches = computeMethodMismatches(backend, frontend);

  const backendMap = new Map(backend.map((r) => [keyOf(r), r]));
  const frontendMap = new Map(frontend.map((r) => [keyOf(r), r]));
  const frontendRefsByEndpoint = toRefsMap(frontend);

  const backendOnly = [...backendMap.keys()]
    .filter((k) => !frontendMap.has(k))
    .sort()
    .map((k) => ({
      endpoint: k,
      method: backendMap.get(k).method,
      path: backendMap.get(k).path,
      source: backendMap.get(k).source,
    }));

  let frontendOnly = [...frontendMap.keys()]
    .filter((k) => !backendMap.has(k))
    .sort()
    .map((k) => ({
      endpoint: k,
      method: frontendMap.get(k).method,
      path: frontendMap.get(k).path,
      source: frontendMap.get(k).source,
    }));

  // Ambiguous dynamic segments can point to one of several static backend endpoints.
  const ambiguous = [];
  frontendOnly = frontendOnly.filter((f) => {
    if (!f.path.endsWith("/:param")) return true;
    const prefix = f.path.slice(0, -"/:param".length);
    const candidates = backend.filter(
      (b) =>
        b.method === f.method &&
        b.path.startsWith(`${prefix}/`) &&
        b.path !== `${prefix}/:param`,
    );
    if (candidates.length === 0) return true;
    ambiguous.push({
      type: "frontend_dynamic_path_ambiguous",
      source: f.source,
      detail: `${f.endpoint} -> ${candidates.map((c) => `${c.method} ${c.path}`).join(", ")}`,
    });
    return false;
  });

  // Treat likely method-inference artifacts as warnings, not hard mismatches.
  frontendOnly = frontendOnly.filter((f) => {
    const samePathBackend = backend.filter((b) => b.path === f.path);
    if (samePathBackend.length > 0 && !samePathBackend.some((b) => b.method === f.method)) {
      ambiguous.push({
        type: "frontend_method_ambiguous",
        source: f.source,
        detail: `${f.endpoint} -> backend methods on same path: ${samePathBackend.map((b) => b.method).join(", ")}`,
      });
      return false;
    }

    const paramVariant = `${f.path}/:param`;
    const hasParamVariant = backend.some((b) => b.method === f.method && b.path === paramVariant);
    if (hasParamVariant) {
      ambiguous.push({
        type: "frontend_path_ambiguous",
        source: f.source,
        detail: `${f.endpoint} -> possible ${f.method} ${paramVariant}`,
      });
      return false;
    }
    return true;
  });

  let registry = loadRegistry();
  if (opts.syncRegistry) {
    registry = syncRegistry(registry, backendOnly);
    fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  const registryInvalid = validateRegistry(registry);
  const registryMap = new Map((registry.entries || []).map((e) => [e.endpoint, e]));
  const unclassifiedBackendOnly = backendOnly.filter((b) => !registryMap.has(b.endpoint));

  const generatedAt = new Date().toISOString();
  const audit = {
    generated_at: generatedAt,
    summary: {
      backend_endpoints: backend.length,
      frontend_calls: frontend.length,
      backend_only: backendOnly.length,
      frontend_only: frontendOnly.length,
      unclassified_backend_only: unclassifiedBackendOnly.length + registryInvalid.length,
      method_mismatch_paths: methodMismatches.length,
    },
    backend_endpoints: backend.map((b) => ({
      endpoint: keyOf(b),
      method: b.method,
      path: b.path,
      source: b.source,
      frontend_refs: frontendRefsByEndpoint.get(keyOf(b)) || [],
    })),
    frontend_calls: frontend.map((f) => ({
      endpoint: keyOf(f),
      method: f.method,
      path: f.path,
      source: f.source,
    })),
    backend_only: backendOnly.map((b) => ({
      ...b,
      registry: registryMap.get(b.endpoint) || null,
    })),
    frontend_only: frontendOnly,
    method_mismatches: methodMismatches,
    confidence_warnings: [...confidenceWarnings, ...ambiguous],
    registry_invalid: registryInvalid,
    files: {
      markdown_report: asPosix(path.relative(ROOT, REPORT_PATH)),
      json_report: asPosix(path.relative(ROOT, JSON_REPORT_PATH)),
      registry: asPosix(path.relative(ROOT, REGISTRY_PATH)),
      intentional_markdown: asPosix(path.relative(ROOT, INTENTIONAL_MD_PATH)),
    },
  };

  if (opts.format === "md" || opts.format === "both") {
    fs.writeFileSync(REPORT_PATH, toMarkdown(audit), "utf8");
  }
  if (opts.format === "json" || opts.format === "both") {
    fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(INTENTIONAL_MD_PATH, toIntentionalMarkdown(registry), "utf8");

  return audit;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }

  const audit = buildAudit(opts);

  const summary = {
    generated_at: audit.generated_at,
    backend_endpoints: audit.summary.backend_endpoints,
    frontend_calls: audit.summary.frontend_calls,
    backend_only: audit.summary.backend_only,
    frontend_only: audit.summary.frontend_only,
    unclassified_backend_only: audit.summary.unclassified_backend_only,
    method_mismatch_paths: audit.summary.method_mismatch_paths,
    outputs: audit.files,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (opts.failOn === "frontend-only" && audit.summary.frontend_only > 0) {
    process.exit(2);
  }
  if (opts.failOn === "unclassified" && audit.summary.unclassified_backend_only > 0) {
    process.exit(3);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildAudit };

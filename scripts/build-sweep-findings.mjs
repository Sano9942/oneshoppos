#!/usr/bin/env node
/**
 * Read frontend/test-results/sweep-findings.json and emit a triage punch
 * list at docs/sweep-findings-YYYY-MM-DD.md, grouped by severity.
 *
 * Severity model:
 *   🔴 critical — step failed, OR step had a 5xx response that wasn't allow-listed
 *   🟡 medium   — step had an unexpected 4xx, OR a console error
 *   🟢 ok       — step passed, no errors, no unexpected network problems
 *   ℹ info      — note entries (passive log)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INPUT = resolve(ROOT, "frontend/test-results/sweep-findings.json");

const today = new Date().toISOString().slice(0, 10);
const OUTPUT = resolve(ROOT, `docs/sweep-findings-${today}.md`);

let payload;
try {
  payload = JSON.parse(readFileSync(INPUT, "utf8"));
} catch (err) {
  console.error(`[build-findings] Cannot read ${INPUT}: ${err.message}`);
  console.error(`[build-findings] Run the sweep first.`);
  process.exit(1);
}

const { sweepStartedAt, sweepEndedAt, tenantSlug, findings = [] } = payload;

const realFindings = findings.filter((f) => f.step !== "_note");
const notes = findings.filter((f) => f.step === "_note");

function classify(f) {
  if (f.status === "fail") return "critical";
  const realNet = (f.networkProblems || []).filter((n) => !n.allowed);
  if (realNet.some((n) => n.status >= 500)) return "critical";
  if (realNet.length || (f.consoleErrors || []).length) return "medium";
  return "ok";
}

const buckets = { critical: [], medium: [], ok: [] };
for (const f of realFindings) {
  buckets[classify(f)].push(f);
}

const lines = [];

lines.push(`# Sweep findings — ${today}`);
lines.push("");
lines.push(`Auto-generated from \`frontend/test-results/sweep-findings.json\`.`);
lines.push("");
lines.push("## Run summary");
lines.push("");
lines.push(`- **Tenant slug:** \`${tenantSlug || "(unknown)"}\``);
lines.push(`- **Started:** ${sweepStartedAt || "?"}`);
lines.push(`- **Ended:** ${sweepEndedAt || "?"}`);
lines.push(`- **Total steps:** ${realFindings.length}`);
lines.push(
  `- **Passed:** ${buckets.ok.length}  •  **Medium:** ${buckets.medium.length}  •  **Critical:** ${buckets.critical.length}`,
);
lines.push("");

if (buckets.critical.length) {
  lines.push("## 🔴 Critical — fix before launch");
  lines.push("");
  lines.push(
    "Step failed, OR produced a server 5xx that isn't on the allow list.",
  );
  lines.push("");
  for (const f of buckets.critical) {
    lines.push(`### ${f.step}`);
    lines.push("");
    lines.push(`- **Page:** \`${f.pageUrl || "?"}\``);
    if (f.errorMessage) {
      lines.push(`- **Error:** \`${escapeBackticks(f.errorMessage)}\``);
    }
    const realNet = (f.networkProblems || []).filter(
      (n) => !n.allowed && n.status >= 500,
    );
    if (realNet.length) {
      lines.push(`- **5xx network responses:**`);
      for (const n of realNet) {
        lines.push(`  - \`${n.method} ${n.url} → ${n.status}\``);
      }
    }
    if ((f.consoleErrors || []).length) {
      lines.push(`- **Console errors:**`);
      for (const c of f.consoleErrors.slice(0, 3)) {
        lines.push(`  - \`${escapeBackticks(c.text).slice(0, 200)}\``);
      }
    }
    lines.push("");
  }
}

if (buckets.medium.length) {
  lines.push("## 🟡 Medium — investigate, may or may not be a real bug");
  lines.push("");
  lines.push(
    "Step passed, but produced a 4xx that isn't allow-listed, or console errors.",
  );
  lines.push("");
  for (const f of buckets.medium) {
    const realNet = (f.networkProblems || []).filter((n) => !n.allowed);
    const consoleCount = (f.consoleErrors || []).length;
    lines.push(`### ${f.step}`);
    lines.push("");
    lines.push(`- **Page:** \`${f.pageUrl || "?"}\``);
    if (realNet.length) {
      lines.push(`- **Unexpected 4xx:**`);
      for (const n of realNet) {
        lines.push(`  - \`${n.method} ${n.url} → ${n.status}\``);
      }
    }
    if (consoleCount) {
      lines.push(`- **Console errors (${consoleCount}):**`);
      for (const c of (f.consoleErrors || []).slice(0, 3)) {
        lines.push(`  - \`${escapeBackticks(c.text).slice(0, 200)}\``);
      }
    }
    lines.push("");
  }
}

if (buckets.ok.length) {
  lines.push("## 🟢 Passed");
  lines.push("");
  lines.push(`<details><summary>${buckets.ok.length} steps</summary>`);
  lines.push("");
  for (const f of buckets.ok) {
    lines.push(`- ${f.step} (${f.durationMs}ms)`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

if (notes.length) {
  lines.push("## ℹ Notes");
  lines.push("");
  for (const n of notes) {
    lines.push(`- ${n.note}`);
  }
  lines.push("");
}

lines.push("---");
lines.push("");
lines.push(
  "After triaging, file critical/medium findings as GitHub issues (or a phase doc) and re-run the sweep to verify fixes hold.",
);
lines.push("");

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, lines.join("\n"));
console.log(`[build-findings] Wrote ${OUTPUT}`);
console.log(
  `[build-findings] Critical: ${buckets.critical.length}  •  Medium: ${buckets.medium.length}  •  Passed: ${buckets.ok.length}`,
);

function escapeBackticks(s) {
  return String(s).replace(/`/g, "ʼ");
}

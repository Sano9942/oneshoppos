#!/usr/bin/env node
/**
 * PLAN-V3 regression gate.
 *
 * Diffs a fresh vitest JSON report against baseline-tests.json BY TEST ID and fails
 * on any NEW or CHANGED failure. It deliberately does NOT compare totals: one
 * pre-existing failure can vanish while a new one appears, leaving the total
 * identical — which is exactly how a real regression hides behind "~57 failures".
 *
 * Usage, from backend/ cwd:
 *   npx vitest run --reporter=json --outputFile=/tmp/run.json \
 *     --no-file-parallelism --testTimeout=60000 --hookTimeout=120000
 *   node ../docs/fable5/plan-v3/check-baseline.js /tmp/run.json
 *
 * The vitest command MUST match baseline.run.command. --no-file-parallelism is
 * load-bearing: concurrent vitest processes emit hook-timeout failures that are
 * environmental, not real, and would poison the diff in both directions.
 *
 * Exit 0 = gate green. Exit 1 = gate red (new/changed failures). Exit 2 = bad usage.
 */
const fs = require("fs");
const path = require("path");

const BASELINE = path.join(__dirname, "baseline-tests.json");
const reportPath = process.argv[2];

if (!reportPath) {
  console.error("usage: node check-baseline.js <fresh-vitest-report.json>");
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

// Signature normalization MUST stay identical to the generator's, or every entry
// reads as CHANGED. Kept in sync deliberately; see baseline-tests.json run.note.
function signature(msg) {
  if (!msg) return "(no message)";
  return String(msg)
    .split("\n")[0]
    .replace(/tenant_[a-z0-9_]+/gi, "tenant_<S>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, "<ISO>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<DATE>")
    .replace(/\b\d+\s*ms\b/gi, "<MS>")
    .replace(/\b(localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/gi, "$1:<PORT>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<HEX>")
    .replace(/[A-Za-z]:[\\/][^\s'")]+/g, "<PATH>")
    .replace(/(?<![\w.])\/(?:[\w.-]+\/)+[\w.-]+/g, "<PATH>")
    .replace(/\b\d{10,}\b/g, "<N>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function collect(raw) {
  const out = new Map();
  for (const suite of raw.testResults || []) {
    const file = String(suite.name || "")
      .replace(/\\/g, "/")
      .replace(/^.*\/backend\//, "backend/");
    const asserts = suite.assertionResults || [];
    // File-level failures report ZERO failing tests but are still red — a suite that
    // fails to import would otherwise silently pass the gate.
    if (suite.status === "failed" && asserts.length === 0) {
      out.set(`${file} :: <file-level>`, signature(suite.message));
    }
    for (const a of asserts) {
      if (a.status !== "failed") continue;
      const full = [...(a.ancestorTitles || []), a.title].filter(Boolean).join(" > ");
      const msg = (a.failureMessages && a.failureMessages[0]) || a.failureMessage || "";
      out.set(`${file} :: ${full}`, signature(msg));
    }
  }
  return out;
}

const fresh = collect(JSON.parse(fs.readFileSync(reportPath, "utf8")));
const base = new Map(baseline.failing_tests.map((t) => [t.id, t.signature]));

const added = [];
const changed = [];
const fixed = [];

for (const [id, sig] of fresh) {
  if (!base.has(id)) added.push({ id, sig });
  else if (base.get(id) !== sig) changed.push({ id, was: base.get(id), now: sig });
}
for (const [id] of base) if (!fresh.has(id)) fixed.push(id);

const line = (s) => console.log(s);
line(`baseline: ${base.size} known-red @ ${String(baseline.git_commit).slice(0, 8)}`);
line(`fresh   : ${fresh.size} red`);
line("");

if (added.length) {
  line(`NEW failures (${added.length}) — gate RED:`);
  for (const a of added) line(`  + ${a.id}\n      ${a.sig}`);
  line("");
}
if (changed.length) {
  line(`CHANGED failures (${changed.length}) — gate RED:`);
  for (const c of changed) line(`  ~ ${c.id}\n      was: ${c.was}\n      now: ${c.now}`);
  line("");
}
if (fixed.length) {
  // Not a gate failure — but if it was deliberate, regenerate the artifact so the
  // baseline cannot silently drift into tolerating a re-broken test later.
  line(`NOW PASSING (${fixed.length}) — not a failure; regenerate the baseline if intended:`);
  for (const f of fixed) line(`  - ${f}`);
  line("");
}

const red = added.length + changed.length;
line(red === 0 ? "GATE GREEN — no new or changed failures." : `GATE RED — ${red} new/changed.`);
process.exit(red === 0 ? 0 : 1);

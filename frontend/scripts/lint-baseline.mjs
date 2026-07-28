#!/usr/bin/env node
/**
 * ESLint baseline ratchet.
 *
 * `npm run lint` currently reports ~881 errors, 664 of which are a single
 * in-flight migration (sano/no-raw-interactive: raw <button>/<input> ->
 * ui/primitives). Making lint a hard gate today would block every deploy on
 * work that touches checkout, POS and shift-close paths for no user-visible
 * benefit. Making it advisory means new violations land unnoticed — which is
 * exactly how 13 files ended up on the retired colour palette.
 *
 * So: freeze the current counts and fail only on INCREASES. Same principle the
 * repo already uses for the integration suite (check-baseline.js: NEW/CHANGED
 * id, never totals) and the orphan-endpoint guard (frontend-coverage-drift).
 *
 * Keyed on (file, rule) rather than a global total, so "fixed one in A, added
 * one in B" still fails. A global count would be trivially gameable.
 *
 * Rules sitting at zero — sano/no-raw-palette-color today — become hard gates
 * for free: any new violation is an increase over a baseline of nothing.
 *
 *   node scripts/lint-baseline.mjs            # check (CI)
 *   node scripts/lint-baseline.mjs --update   # re-freeze after fixing things
 */

import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "lint-baseline.json");
const UPDATE = process.argv.includes("--update");

const NO_RULE = "(no-rule)";

/** file::rule -> count, with forward slashes so Windows and CI agree. */
async function collect() {
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(["."]);
  const counts = {};
  for (const res of results) {
    const rel = path.relative(ROOT, res.filePath).split(path.sep).join("/");
    for (const msg of res.messages) {
      const key = `${rel}::${msg.ruleId || NO_RULE}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

const current = await collect();

if (UPDATE) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(
    `Wrote ${path.basename(BASELINE)} — ${Object.keys(sorted).length} (file, rule) entries, ${total(current)} problems.`
  );
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(
    `No ${path.basename(BASELINE)} found. Create it with:\n  npm run lint:baseline:update`
  );
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

const regressions = [];
for (const [key, count] of Object.entries(current)) {
  const was = baseline[key] || 0;
  if (count > was) regressions.push({ key, was, now: count });
}

// Informational only — fixing things must never fail the gate.
let fixed = 0;
for (const [key, was] of Object.entries(baseline)) {
  const now = current[key] || 0;
  if (now < was) fixed += was - now;
}

if (regressions.length) {
  console.error("\nESLint baseline regression — new violations introduced:\n");
  for (const { key, was, now } of regressions.sort((a, b) => b.now - b.was - (a.now - a.was))) {
    const [file, rule] = key.split("::");
    console.error(`  ${file}`);
    console.error(`      ${rule}: ${was} -> ${now}  (+${now - was})`);
  }
  console.error(
    `\n${regressions.length} (file, rule) pair(s) got worse.\n` +
      "Fix them, or — if the new violations are genuinely intended — re-freeze with:\n" +
      "  npm run lint:baseline:update\n"
  );
  process.exit(1);
}

console.log(
  `ESLint baseline OK — ${total(current)} problems, none new.` +
    (fixed ? `\n${fixed} fewer than baseline. Re-freeze with: npm run lint:baseline:update` : "")
);

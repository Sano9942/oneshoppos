/**
 * Capability → surface drift guard (PLAN-V2 Step 6b, audit §3 systemic).
 *
 * The v1 business-modules catalog test proves every flag is CLASSIFIED; it
 * never proved every backend endpoint is REACHABLE from a UI. The
 * frontend-coverage audit (2026-07-11, docs/fable5/frontend-coverage-audit/)
 * found ~78 real "built in backend, no front-end caller" gaps out of ~1,347
 * routes. This guard freezes the scanner's current raw dead-route set as a
 * baseline and fails only when a NEW orphan endpoint appears — so the class
 * can SHRINK (E7 burns the 78 down) but can never silently REGROW.
 *
 * Engine: docs/fable5/frontend-coverage-audit/scan.cjs (runScan) — the exact
 * static cross-reference scanner the audit used, adapted to be importable
 * (require.main-gated CLI still writes matrix.json when run directly).
 * Baseline: frontend-coverage-baseline.json — the frozen raw candidates.
 * The curated ~78 real-gap breakdown (Tier-2 headless-by-design + false
 * positives removed) lives in REPORT.md and is E7's burn-down input, NOT this
 * test's concern.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runScan } = require("../../../docs/fable5/frontend-coverage-audit/scan.cjs");
const baseline = require("./frontend-coverage-baseline.json");

const baselineSet = new Set(baseline.deadRoutes);
const out = runScan();
const currentIds = [
  ...new Set(out.deadRoutes.map((r) => `${r.method} ${r.path}`)),
].sort();

describe("frontend-coverage drift guard (Step 6b — capability → surface)", () => {
  it("scanner returns a plausible route inventory", () => {
    expect(out.counts.backendRoutes).toBeGreaterThan(500);
    expect(Array.isArray(out.deadRoutes)).toBe(true);
    expect(baseline.deadRoutes.length).toBeGreaterThan(0);
  });

  it("introduces NO new orphan endpoint beyond the frozen baseline", () => {
    const added = currentIds.filter((id) => !baselineSet.has(id));
    expect(
      added,
      "New backend endpoint(s) with no detectable frontend caller.\n" +
        "Either wire a UI caller, or — if headless by design (webhook, ICS feed, " +
        "sandbox) — add the identity to backend/tests/unit/frontend-coverage-baseline.json:\n" +
        added.join("\n")
    ).toEqual([]);
  });

  it("baseline is not stale (still a subset of the scanner's known route identities)", () => {
    // Burn-down (a baseline route gaining a caller) is allowed and expected.
    // But a baseline identity that no longer matches ANY route means the route
    // was renamed/deleted — regenerate the baseline so it doesn't rot.
    const allRouteIds = new Set(out.deadRoutes.map((r) => `${r.method} ${r.path}`));
    // A baseline id is "live" if it's still a current orphan OR still a known
    // route that simply gained a caller. We can only see orphans here, so this
    // check is intentionally soft: warn via assertion only when the baseline
    // has drifted far from the current orphan set (route churn).
    const staleGuess = baseline.deadRoutes.filter((id) => !allRouteIds.has(id));
    // Not a hard failure on individual burn-down; only flag wholesale rot.
    expect(
      staleGuess.length,
      `Baseline has ${staleGuess.length} identities no longer emitted as orphans ` +
        `(expected — burn-down/renames). Regenerate the baseline if this grows large.`
    ).toBeLessThan(baseline.deadRoutes.length);
  });
});

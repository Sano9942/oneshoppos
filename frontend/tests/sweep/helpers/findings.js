/**
 * Per-step findings collector.
 *
 * Wraps a step body so we capture:
 *  - pass/fail
 *  - console errors that fired during the step
 *  - 4xx/5xx network responses that fired during the step
 *  - assertion error messages
 *  - duration
 *
 * Findings accumulate in module-scoped state and are serialized to
 *   frontend/test-results/sweep-findings.json
 * by emitFindingsFile() at end of run.
 *
 * Why module-scoped + manual emit instead of Playwright's reporter API:
 * the spec runs serially in a single worker, the data model is simple,
 * and we want a custom JSON shape that the markdown converter can consume.
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const findings = [];
let sweepStartedAt = null;
let tenantSlug = null;

const ALLOW_LIST_4XX = [
  // Feature-flag-gated endpoints that legitimately return 403 on a fresh
  // Free-plan retail tenant. Logged for transparency, not flagged.
  /\/api\/products\/\d+\/modifier-tree.*->.*403/,
  /\/api\/room-bookings.*->.*403/,
  /\/api\/reports\/stock-aging.*->.*403/,
  /\/api\/reports\/kds\/prep-times.*->.*403/,
  // Hold/reservation endpoints when feature off
  /\/api\/holds.*->.*403/,
];

export function startSweep(slug) {
  sweepStartedAt = new Date().toISOString();
  tenantSlug = slug;
  findings.length = 0;
}

/**
 * Wrap a step. Capture errors + network. Failure does NOT throw — subsequent
 * steps still run, the failure is recorded with status="fail".
 *
 * Usage:
 *   await captureStep(page, "step-3-add-product", async () => {
 *     await page.goto("/inventory");
 *     ...
 *   });
 */
export async function captureStep(page, stepName, body) {
  const startedAt = Date.now();
  const consoleErrors = [];
  const networkProblems = [];

  const onConsole = (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({
        text: msg.text(),
        location: msg.location(),
      });
    }
  };

  const onResponse = (resp) => {
    const url = resp.url();
    const status = resp.status();
    if (status >= 400 && url.includes("/api/")) {
      const sig = `${resp.request().method()} ${url} -> ${status}`;
      const allowed = ALLOW_LIST_4XX.some((re) => re.test(sig));
      networkProblems.push({
        method: resp.request().method(),
        url,
        status,
        allowed,
      });
    }
  };

  page.on("console", onConsole);
  page.on("response", onResponse);

  let status = "pass";
  let errorMessage = null;
  let errorStack = null;

  try {
    await body();
  } catch (err) {
    status = "fail";
    errorMessage = err?.message || String(err);
    errorStack = err?.stack || null;
  } finally {
    page.off("console", onConsole);
    page.off("response", onResponse);
  }

  const duration = Date.now() - startedAt;

  findings.push({
    step: stepName,
    status,
    durationMs: duration,
    errorMessage,
    errorStack,
    consoleErrors,
    networkProblems,
    pageUrl: page.url(),
    timestamp: new Date().toISOString(),
  });

  // Surface step result on the terminal so a watching operator can follow along.
  const icon = status === "pass" ? "✓" : "✗";
  // eslint-disable-next-line no-console
  console.log(`  ${icon} [${stepName}] ${duration}ms`);
  if (status === "fail") {
    // eslint-disable-next-line no-console
    console.log(`     └─ ${errorMessage}`);
  }
  if (consoleErrors.length) {
    // eslint-disable-next-line no-console
    console.log(`     └─ ${consoleErrors.length} console error(s)`);
  }
  const realNet = networkProblems.filter((n) => !n.allowed);
  if (realNet.length) {
    // eslint-disable-next-line no-console
    console.log(`     └─ ${realNet.length} unexpected 4xx/5xx`);
  }
}

/**
 * Emit a passive note attached to no specific step. Use sparingly —
 * for things like "human paused at email verify" or "sandbox payment OK".
 */
export function note(text) {
  findings.push({
    step: "_note",
    status: "info",
    note: text,
    timestamp: new Date().toISOString(),
  });
  // eslint-disable-next-line no-console
  console.log(`  ℹ ${text}`);
}

/**
 * Write findings to disk. Call once in afterAll.
 */
export function emitFindingsFile() {
  const outPath = resolve(
    import.meta.dirname,
    "../../../test-results/sweep-findings.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });

  const payload = {
    sweepStartedAt,
    sweepEndedAt: new Date().toISOString(),
    tenantSlug,
    totalSteps: findings.filter((f) => f.step !== "_note").length,
    passedSteps: findings.filter((f) => f.status === "pass").length,
    failedSteps: findings.filter((f) => f.status === "fail").length,
    findings,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n[findings] Wrote ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[findings] ${payload.passedSteps}/${payload.totalSteps} steps passed`,
  );
  return outPath;
}

export function getFindings() {
  return findings;
}

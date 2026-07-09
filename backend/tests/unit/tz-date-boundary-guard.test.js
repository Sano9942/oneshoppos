/**
 * Regression guard for the UTC-vs-tenant-local date-boundary bug CLASS
 * (fixed repo-wide 2026-07 on fix/tz-date-boundary-class).
 *
 * Business "day" logic must never be computed via:
 *   1. `new Date().toISOString().slice(0,10)` as "today" — always the UTC
 *      date, wrong for part of every tenant-local day;
 *   2. SQL `CURRENT_DATE` — the DB SESSION's day (UTC on prod/Supabase,
 *      Asia/Karachi on local dev — results differ by environment);
 *   3. a bare `::date` / `date(col)` cast on a TIMESTAMPTZ business column —
 *      casts in the DB session timezone.
 *
 * Correct patterns (see backend/utils/tz.js):
 *   - JS "today":           tenantToday(req.company?.timezone)
 *   - JS day window:        todayBounds(tz) / toUtcStart+toUtcEnd
 *   - SQL same-day compare: (col AT TIME ZONE $tz)::date = (NOW() AT TIME ZONE $tz)::date
 *   - pg DATE round-trip:   pgDateToStr(row.some_date) — never toISOString()
 *
 * If this test fails on your new code, use one of the patterns above. Only
 * add an allowlist entry when the UTC/session day is genuinely intended
 * (platform cost buckets, dedupe keys, document-number datestamps) — and say
 * why in a comment at the call site.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["routes", "services", "workers", "boot", "utils"];

// TIMESTAMPTZ business columns that must never get a bare ::date cast.
const TSTZ_COLUMNS = [
  "session_start", "check_in", "checked_in_at", "received_at", "paid_at",
  "posted_at", "start_at", "end_at", "delivery_at", "timestamp", "created_at",
  "opened_at", "closed_at", "scheduled_at",
];

// ── Allowlist — every entry is a DELIBERATE UTC/session-day usage ──────────
// file (relative to backend/, forward slashes) → array of substrings; a
// flagged line is allowed if it contains any of them.
const ALLOW = {
  // Platform cost-cap bucket — any consistent 24h bucketing works.
  "routes/ai.js": ["const day = new Date().toISOString().slice(0, 10)"],
  // Backup filename datestamp — cosmetic.
  "routes/barcode-expenses.js": ["backup-${schemaName}"],
  // localDateStr()'s catch-fallback when the tz string is invalid.
  "services/members.js": ["return new Date().toISOString().slice(0, 10)"],
  // Billing-lifecycle dedupe key — a stable 24h bucket, not a business day.
  "workers/email-worker-boss.js": ["return new Date().toISOString().slice(0, 10)"],
  // Anomaly flag period labels — upsert conflict-key stability > local dates.
  "workers/anomaly-worker-boss.js": ["periodStart.toISOString().slice(0, 10)", "periodEnd.toISOString().slice(0, 10)"],
  // Renewal-job dedupe singletonKey — stability > local dates.
  "services/subscriptions.js": ["nextEnd.toISOString().slice(0, 10)"],
  // Admin reference-table "last updated" stamp — platform metadata, no tenant.
  "routes/admin/compliance.js": ["last_updated = CURRENT_DATE"],
  // 7-day-buffered iCal export window — boundary slop is immaterial.
  "services/room-channel-sync.js": ["check_out_date >= CURRENT_DATE - INTERVAL '7 days'"],
  // Platform adoption metric — UTC-day active-days count is fine.
  "workers/adoption-snapshot-worker-boss.js": ['COUNT(DISTINCT ("timestamp")::date)'],
  // ORDER-BY-only day casts — affect tie-break granularity, never row content.
  "routes/reports/finance.js": ["ORDER BY outstanding DESC, COALESCE(si.due_date::timestamptz, si.created_at)::date ASC",
    "ORDER BY COALESCE(si.due_date::timestamptz, si.created_at)::date ASC"],
  "routes/tier4/accounting.js": ["ORDER BY COALESCE(si.due_date::date, si.created_at::date) ASC"],
};

function isAllowed(relFile, line) {
  const subs = ALLOW[relFile];
  return !!subs && subs.some((s) => line.includes(s));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("--");
}

function scan(patternTest, label) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(BACKEND, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(BACKEND, file).replace(/\\/g, "/");
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        if (!patternTest(line)) return;
        if (isAllowed(rel, line)) return;
        violations.push(`${rel}:${i + 1}  [${label}]  ${line.trim().slice(0, 140)}`);
      });
    }
  }
  return violations;
}

describe("tz date-boundary regression guard", () => {
  it("no UTC-'today' via new Date().toISOString().slice/substring/split", () => {
    // Only the now-based form is flagged: `someVar.toISOString().slice(0,10)`
    // is legitimate for Z-anchored pure calendar arithmetic (see
    // services/room-service.js addDaysISO). Document-number datestamps
    // (`.replace(/-/g, ...)` on the same line) are cosmetic and permitted.
    const re = /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*((slice|substring)\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\)\s*\[\s*0\s*\])/;
    const v = scan((l) => re.test(l) && !l.includes(".replace(/-/g"), "UTC-today idiom");
    expect(v, `Use tenantToday(tz) from utils/tz.js instead:\n${v.join("\n")}`).toEqual([]);
  });

  it("no SQL CURRENT_DATE / now()::date in business code", () => {
    const re = /CURRENT_DATE|now\(\)::date|NOW\(\)::date|CURRENT_TIMESTAMP::date/;
    const v = scan((l) => re.test(l), "session-day SQL");
    expect(v, `Pass tenantToday(tz) as a parameter or use (NOW() AT TIME ZONE $tz)::date:\n${v.join("\n")}`).toEqual([]);
  });

  it("no bare ::date / date(col) casts on TIMESTAMPTZ business columns", () => {
    const colAlt = TSTZ_COLUMNS.join("|");
    const castRe = new RegExp(`(?:^|[^\\w"])(?:\\w+\\.)?(?:${colAlt})\\s*(?:::date|\\)::date)|date\\(\\s*(?:\\w+\\.)?(?:${colAlt})\\s*\\)`);
    const v = scan((l) => castRe.test(l) && !l.includes("AT TIME ZONE"), "session-TZ cast");
    expect(v, `Use (col AT TIME ZONE $tz)::date, or filter with toUtcStart/toUtcEnd bounds:\n${v.join("\n")}`).toEqual([]);
  });
});

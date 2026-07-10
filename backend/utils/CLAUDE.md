# backend/utils/ — Claude Guide

Small, dependency-light helper modules. Each file exports pure functions or thin wrappers — no route handlers, no middleware. Imported directly by routes/services (e.g. `require("../utils/tz")`).

---

## `tz.js` — timezone boundary conversion

Exports: `toUtcStart(dateStr, tz)`, `toUtcEnd(dateStr, tz)`, `toLocalDateStr(utcStr, tz)`, `getUtcOffsetMinutes(dateStr, tz)`, `isValidTz(tz)`, `tenantToday(tz, at?)`, `todayBounds(tz, at?)`, `addDaysStr(dateStr, days)`, `pgDateToStr(value)`

- Converts a local `YYYY-MM-DD` date string (in the tenant's IANA timezone) into UTC boundary strings for direct comparison against `TIMESTAMPTZ` columns. Uses only `Intl.DateTimeFormat` + binary search over ms — no external tz library, no network lookups.
- `toUtcStart` → inclusive lower bound. `toUtcEnd` → exclusive upper bound (next local midnight) — always filter with `timestamp < toUtcEnd(...)`, never `<=`.
- `toLocalDateStr` — reverse direction, used for `GROUP BY` local date in reports.
- `getUtcOffsetMinutes` — offset in minutes, for strftime-style SQL grouping.
- Invalid/missing tz strings silently fall back to `"UTC"` (via `isValidTz`, which caches validation results in an in-memory `Map`).
- `tenantToday(tz, at?)` — the canonical "what day is it for this tenant" helper: tenant-local `YYYY-MM-DD`, optionally of an arbitrary instant. Never compute "today" via `new Date().toISOString().slice(0,10)` (always UTC) or SQL `CURRENT_DATE` (the DB *session's* timezone, which differs between prod/Supabase and local dev).
- `todayBounds(tz, at?)` → `{ from, to, today }` — UTC bounds of the tenant-local current day.
- `addDaysStr(dateStr, days)` — pure calendar arithmetic (no timezone involved), for due/expiry dates derived from a tenant-local day.
- `pgDateToStr(value)` — read a Postgres `DATE` column back to `YYYY-MM-DD`. node-postgres parses `DATE` as a **local-process-midnight** JS `Date`, so `value.toISOString().slice(0,10)` returns the *previous* day whenever the process TZ is east of UTC (Railway runs `TZ=Asia/Karachi`). Always round-trip `DATE` columns through this helper instead.
- All business timestamps are `TIMESTAMPTZ` — there are no "already local" timestamp columns anywhere in the schema. SQL same-day checks must use `(col AT TIME ZONE $tz)::date` on both sides, never bare `col::date = CURRENT_DATE`. A source-scanning test guard fails the build on new violations of this rule — check it before adding raw date-boundary SQL.

## `r2.js` — Cloudflare R2 upload/delete

Exports: `uploadToR2(buffer, key, contentType)`, `deleteFromR2(key)`, `r2` (raw `S3Client` instance or `null`), `bucket`

- `uploadToR2` returns an **absolute URL**, never a bare relative path — frontend (Vercel) and backend (Railway) are on different hosts, so a relative `/r2/<key>` would resolve against the wrong origin.
  - If `R2_PUBLIC_URL` is set → `{R2_PUBLIC_URL}/{key}` (custom CDN domain).
  - Else if `APP_PUBLIC_BASE_URL` is set → `{APP_PUBLIC_BASE_URL}/r2/{key}` (proxied through the backend's own `/r2/*key` route).
  - Else throws — surfacing the misconfiguration loudly rather than silently producing a broken relative URL.
- **Local fallback**: when R2 env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are missing, writes to `backend/exports/<key>` on local disk instead — wiped on every Railway deploy, so treat as dev-only, never rely on it in production.
- `deleteFromR2` is a no-op when R2 isn't configured (local fallback files are not cleaned up here).

## `receiptEmail.js` — customer receipt HTML

Exports: `buildReceiptEmailHtml(sale, items, payments, template, currencySymbol = "$", portalUrl = null)`

- Produces a complete, self-contained HTML document (inline styles only, no external assets/scripts) — safe to hand directly to an email send call.
- Mirrors `frontend/src/utils/receipt.js` `buildReceiptSections()` — if you change one, check whether the other needs the same fix. `formatPaymentMethodLabel()` is duplicated inline here on purpose (avoids pulling frontend code into the backend bundle) — keep both copies in sync.
- Per-template toggles (`show_tax_breakdown`, `show_fbr`, `show_qr`, `logo_url`) default to **shown** when the template row is null/absent (legacy tenants without receipt-designer data keep old behavior).
- Renders an FBR IRN + QR block when `sale.fbr_irn` is present and the toggles allow it.
- If `portalUrl` is passed, appends a "View your account" CTA (customer-portal-enabled tenants only).
- Seat chips (`seat_number`) render inline for dine-in items — retail sales are unaffected since `seat_number` is null there.

## `digestEmail.js` — end-of-day digest HTML

Exports: `buildDigestEmailHtml(data, companyName, dateStr)`

- Same self-contained-HTML pattern as `receiptEmail.js`. Consumes the dashboard-shaped `data` object produced by the reports digest builder — expects `zReport`, `topSelling`, `lowStock`, `refundsToday`, `voidsToday`, `discountsToday`, `totalRevenueToday`, `saleCount`, `averageBill`, `todayProfit`, `currency.symbol`.
- All sections degrade gracefully to "No sales today" / "All stock levels healthy" placeholders when arrays are empty — never throws on missing data, just renders defaults.
- Highlights refund/void percentages in red past hardcoded thresholds (5% for refunds, 3% for voids) — inline in this file, not tenant-configurable.

## `backup-pg.js` — pg_dump/pg_restore wrappers

Exports: `backupSchema(schemaName)`, `backupAllSchemas(schemaNames)`, `restoreSchema(schemaName, filePath)`, `listSchemasInBackup(filePath)`, `getSchemaName(tenantSlug)`, `isPgDumpAvailable()`, `MAX_BACKUP_SIZE` (50 MB)

- Thin `child_process.spawn` wrappers around the `pg_dump`/`pg_restore` CLI binaries — requires them on `PATH` (not bundled). `isPgDumpAvailable()` checks this before attempting a backup.
- `backupSchema`/`backupAllSchemas` return `{ stream, process }` — caller pipes `stream` (stdout) to its destination (e.g. R2 upload) and should also watch `process` for exit code.
- Uses `--format custom --no-owner --no-privileges` — output is a `pg_restore`-only binary format, not plain SQL.
- `restoreSchema` uses `--clean --if-exists` (drops existing objects before recreating) and treats exit code `<= 1` as success (1 = warnings, e.g. "object already exists" — expected on partial restores).
- `listSchemasInBackup` parses `pg_restore --list` TOC output with a regex to extract unique schema names — used to validate a backup archive contains the expected schema(s) before trusting it.
- `getSchemaName(tenantSlug)` → `tenant_<slug>` or `"public"` for single-tenant mode — reuse this helper rather than re-deriving the string; it's the same naming convention used everywhere else for tenant schemas.
- This is the **tenant self-export** path (`POST /api/admin/backup`, `POST /api/backup/download`) — supplementary to Supabase's own automated backups/PITR, not the primary DR mechanism.

## `resendEmail.js` — direct Resend calls (system/auth emails)

Exports: `sendPasswordResetEmail({ toEmail, employeeName, resetLink, storeName })`, `sendWelcomeEmail({ toEmail, ownerName, storeName, slug, setupUrl })`, `sendVerifyEmail({ toEmail, ownerName, storeName, verifyUrl })`, `buildWelcomeEmailHtml(...)`, `buildVerifyEmailHtml(...)`

- Lazily constructs a singleton `Resend` client from `RESEND_API_KEY` — **throws** if the key is missing (unlike `alertEmail.js`, which silently no-ops). Only call these when a hard failure on misconfiguration is the desired behavior.
- `FROM` defaults to `SanoPOS <onboarding@resend.dev>` if `RESEND_FROM_EMAIL` unset — production sets `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>`.
- These are **system-level** transactional emails (password reset, tenant welcome, email verification) — distinct from tenant-to-customer emails, which go through `services/email.js` / `email_queue`.
- Errors bubble as `new Error("Resend error: ...")` — callers must catch.

## `alertEmail.js` — ops alerting via Resend

Exports: `sendAlertEmail({ subject, html })`

- **Never throws** — swallows all errors and logs via `services/logger.js` instead. Intentional: alerting must not crash the app it's alerting about.
- Silent no-op if `ALERT_EMAIL` or `RESEND_API_KEY` is unset.
- Subject is auto-prefixed with `[SanoPOS Alert]`.
- Consumed by `services/alerting.js` (error spikes, DB pressure, health check failures) — this file is just the send primitive, not the trigger logic.

## `ics.js` — RFC 5545 iCalendar (.ics) builder

Exports: `buildIcsEvent(opts)`, `buildIcsFeed(opts)`, `escapeIcsText(value)`, `toIcsUtcStamp(input)`, `toIcsDateStamp(input)`

- Zero external dependencies, deliberately minimal.
- `buildIcsEvent(opts)` — one `VEVENT` per call. Requires `uid`, `start`, `end`, `summary` (throws if any missing); optional `description`, `location`, `dtstamp` (defaults to now), `prodId` (defaults to `-//SanoPOS//Bookings//EN`). Used for single calendar invites (bookings, appointments, service tickets).
- `buildIcsFeed(opts)` — a full `VCALENDAR` with **many** `VEVENT`s from `opts.events` (an array), for subscription-style feeds. Optional `opts.calName` sets `X-WR-CALNAME`. Each event supports `ev.allDay` — when true, emits `DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE` (via `toIcsDateStamp`) instead of UTC timestamps, matching checkout-day-exclusive overlap math for date-only bookings (e.g. hotel stays). `DTEND` is exclusive per RFC 5545.
- Timed events are emitted in UTC (`Z` suffix) via `toIcsUtcStamp` — avoids timezone ambiguity regardless of the recipient's calendar client.
- `toIcsDateStamp(input)` — `YYYYMMDD` for `VALUE=DATE` fields; accepts a `'YYYY-MM-DD'` string or a `Date`.
- `escapeIcsText` handles RFC 5545 §3.3.11 escaping (backslash, semicolon, comma, newlines) — `buildIcsEvent`/`buildIcsFeed` already route free-text fields through it internally; only call it directly if hand-assembling extra lines.
- `foldLine` (internal) wraps output at 75 octets per §3.1 — applied automatically to every emitted line.

---

## Cross-cutting notes

- None of these files load dotenv directly — they assume the process has already loaded env vars (same convention as `db-pg.js`).
- `receiptEmail.js` and `digestEmail.js` are pure string builders with no I/O — safe to unit test without mocking anything.
- `resendEmail.js` and `alertEmail.js` both lazily construct their own `Resend` client rather than sharing one — if adding a third Resend-backed util, prefer routing through `services/email.js` instead unless it's genuinely a one-off system email.

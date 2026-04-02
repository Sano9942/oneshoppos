# Architecture Audit Fix — Session Handoff

## Current State (2026-04-02, updated after Phase 5)

**Branch:** `fix/architecture-audit-fixes`
**Latest commit:** `3227600` (pushed to origin)
**Tests:** 357 passing across 10 suites (pg-batch1 through pg-batch9 + pg-tenant-isolation), 0 failures

### Completed Phases

**Phase 1 — Test Baseline** (commit `ce47b5d`)
- Fixed 3 pre-existing test infrastructure bugs in schema-pg.sql and createTestApp-pg.js
- Established 347 test baseline

**Phase 2 — Tier 1 Fixes** (commit `00c241b`)
- Fix 1: `CORS_ORIGIN.split(",")[0]` in auth.js (2 locations) and employees.js (1 location) — was producing malformed password reset URLs in production
- Fix 2: SQL injection guard `/^[a-z0-9_]{3,40}$/` on `tenant_slug` in admin.js tax suggestion approval
- Fix 3: HTML-escape user-controlled fields in support ticket alert email (support.js)
- Fix 4: Removed 6 manual `x-employee-id` header constructions in PrinterSettingsRedesign.jsx — was always sending "1"
- Added pg-batch9-audit-fixes.test.js with 4 tests

**Phase 3 — Tier 2 Fixes** (commit `284b7f8`)
- Fix 5: Stop writing plaintext `pin_code` on employee create/update/change-PIN across employees.js, setup.js, admin.js, tenant-provisioner-pg.js. Migration v14 makes pin_code nullable.
- Fix 6: Replaced unsafe `handleReprint()` in SalesHistoryRedesign.jsx (was using raw HTML string injection into popup) with `buildReceiptHtml()` from utils/receipt.js (safe DOM construction via createElement + textContent)
- Fix 7: Removed authenticated API routes from service worker cache (sw.js) — was caching /api/products, /api/reports/dashboard etc. without session scoping
- Fix 8: Support upload filenames now use `crypto.randomBytes(16).toString("hex")` instead of `file.originalname`
- Fix 9: Feature flag DEFAULT_FLAGS changed from fail-open (true) to fail-closed (false) in useFeatureFlags.js
- Added 6 more tests to pg-batch9 (total 10)

**Phase 4 — Tier 3 Fixes** (commit `f923c8e`)
- Fix 10: Removed duplicate `/api/health` endpoint in registerAllRoutes.js:385 (kept the one at line 52)
- Fix 11: Removed cleanup double-scheduling in index.js — IS_MULTI_TENANT block was running cleanupDeadTenants alongside the CLEANUP_WORKER_ENABLED version
- Fix 12: Added real queueDepth `SELECT COUNT(*)` in email-worker.js and fbr-worker.js (was always 0)
- Fix 13: Unified slug validation in admin.js tenant creation — changed `[a-z0-9-]` to `[a-z0-9_]` to match provisioner
- Fix 14: Deleted dead Login.jsx (zero imports in codebase)

**Phase 5 — Cleanup** (commit `3227600`)
- Deleted 88 files (7,880 lines): 73 SQLite migrations, 10 SQLite infra files, 2 SQLite seed scripts, 3 SQLite test helpers, cleanup-public-schema.js, reset-production.js, test_output.txt, App.css
- Simplified index.js boot: removed `HAS_POSTGRES` conditional, removed all SQLite fallback branches, direct `require("./db-pg")`

## What To Do Next

### Phase 6: Structural Improvements (Tier 4)

See `docs/architecture-audit.md` section "Complete Fix Execution Plan" → Phase 6 for details.

| # | Fix | Effort | Notes |
|---|-----|--------|-------|
| 20 | Add `helmet` middleware to backend | 30 min | `npm install helmet`, add to index.js before routes |
| 21 | Add security headers to `vercel.json` (CSP, X-Frame-Options, Referrer-Policy) | 30 min | Frontend deployment config |
| 22 | Revoke object URLs in SupportWidget cleanup | 15 min | `URL.revokeObjectURL()` in useEffect cleanup |
| 23 | Split `admin.js` (2,208 lines) into 5-6 domain files | Half day | Biggest refactor — careful with route ordering |
| 24 | Create frontend `api.js` service layer (replaces 164 scattered fetch calls) | 1 day | Optional — large scope |
| 25 | Add Zod validation to critical backend routes | 1-2 days | Optional — auth, sales, products, employees, billing |

Fixes 20-22 are quick wins. Fixes 23-25 are larger structural changes that could be done in a separate branch if preferred.

### Phase 7: Wave 2 Tests

Write integration tests for 10+ untested production routes. Priority:
1. admin.js (~15-20 tests)
2. billing.js (~10 tests)
3. support.js (~5 tests)
4. fbr.js + tax-lookup.js (~10 tests)
5. import.js (~5 tests)

### After All Phases

1. Re-run all 357+ integration tests — confirm green
2. Run live E2E suite against staging
3. Manual smoke: password reset, admin tax approval, printer settings, support ticket, POS receipt reprint
4. Push branch, user merges to main when verified

## CRITICAL: Git Workflow Rules

- **NEVER merge to main** — the user merges manually when ready
- **NEVER create a PR** — the user handles that themselves
- **NEVER push to main** — all work stays on `fix/architecture-audit-fixes`
- **DO commit frequently** — one commit per fix or logical group of fixes
- **DO push to the branch** — `git push` (branch is already tracking origin)
- **Commit style:** `fix: short description` or `chore: short description`
- **Co-author line:** Always include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`

## How To Work

1. Read the relevant source file before making any change
2. Make the fix
3. Run the affected test batch: `cd backend && npx jest tests/integration/pg-batchN-name.test.js --no-coverage --forceExit`
4. Commit the fix
5. Move to the next fix
6. After completing a full phase, push all commits to the branch

## Important Context

- **Tests run sequentially** — running multiple batches in parallel exhausts Supabase connection pool. Run one at a time.
- **Test command:** `cd backend && npx jest tests/integration/pg-batchN-name.test.js --no-coverage --forceExit`
- **Full suite verification:** Loop through pg-batch1 through pg-batch9 + pg-tenant-isolation (10 files)
- **architecture-audit.md is the master reference** — all findings, scores, dead file inventory, test gaps, and execution plan
- **schema-pg.sql is the DDL source of truth** — pin_code is now nullable (migration v14)
- **index.js boot is now Postgres-only** — no SQLite conditionals remain
- **Migration version is 14** — v14 made pin_code nullable
- **User preferences:** No trailing summaries, no restating the task, just do the work
- **Tailwind v4 conventions (linter enforced):** `(--css-var)` not `[var(--css-var)]`, `shrink-0` not `flex-shrink-0`
- **Timestamp rules:** UTC columns use `fmtUtcDateTime`, LOCAL columns use `fmtLocalDateTime`
- **Currency:** Never hardcode PKR/Rs — use `useCurrency().fmt`

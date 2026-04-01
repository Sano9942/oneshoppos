# Architecture Audit Fix — Session Handoff

## Current State (2026-04-02)

**Branch:** `fix/architecture-audit-fixes` (created from main, pushed to origin)

**Phase 1 COMPLETE:** Test baseline established
- Fixed 3 pre-existing test infrastructure bugs:
  - `schema-pg.sql`: `idx_sales_created_at` and `idx_returns_created_at` referenced wrong column (`created_at` instead of `timestamp`)
  - `schema-pg.sql`: `tenant_notes.tenant_id REFERENCES tenants(id)` FK removed (tenants table only exists in public schema)
  - `createTestApp-pg.js`: Added missing `requirePlanLimit` and `requireActiveSubscription` stubs to test deps
- **347 tests passing across 9 suites, 0 failures**
- Committed as `ce47b5d`

## What To Do Next

Continue on branch `fix/architecture-audit-fixes`. Follow the execution plan in `docs/architecture-audit.md` (search for "Complete Fix Execution Plan").

### Phase 2: Tier 1 Fixes (start here)

**Fix 1 — CORS_ORIGIN password reset links (actively broken in production)**
- Files: `backend/routes/auth.js:487`, `backend/routes/auth.js:654`, `backend/routes/employees.js:460`
- Problem: Uses raw `process.env.CORS_ORIGIN` as URL base. In production it's comma-separated (`https://sanopos.com,https://www.sanopos.com,https://sanopos.vercel.app`), making links malformed
- Fix: Change to `process.env.CORS_ORIGIN?.split(",")[0]` (this pattern already exists correctly at `auth.js:672` and `billing.js:144`)
- Test: Write 1 test verifying reset link uses first origin only

**Fix 2 — SQL injection in admin tax suggestion approval**
- File: `backend/routes/admin.js:1508-1514`
- Problem: `tenant_slug` from `req.body` interpolated directly into SQL identifier context
- Fix: Validate `tenant_slug` against master DB tenant registry before use, or whitelist with regex `/^[a-z0-9_]{3,40}$/`
- Test: Write 2 tests (malicious slug rejected + valid slug works)

**Fix 3 — Unsanitized HTML in support ticket alert email**
- File: `backend/routes/support.js:53`
- Problem: Raw `${message}` in blockquote — HTML injection into staff inbox
- Fix: HTML-escape before interpolation: `msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")`
- Test: Write 1 test verifying HTML tags are escaped

**Fix 4 — PrinterSettingsRedesign bypasses auth with employee "1"**
- File: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx` (lines 50, 68, 112, 139, 165, 190)
- Problem: Uses `localStorage.getItem("employeeId") || "1"` — no writer for this key exists anywhere in frontend, so "1" is always sent
- Fix: Remove all manual header construction, let the global `AuthProvider` fetch interceptor handle auth headers. The page should use normal `fetch()` without custom headers — the interceptor in `AuthProvider.jsx` auto-injects `x-employee-id`, `Authorization`, etc.
- Test: Manual verification (frontend change)

### Phases 3-7 (after Phase 2)

See `docs/architecture-audit.md` section "Complete Fix Execution Plan" for the full breakdown. Key points:

- **Phase 3 (Tier 2):** Stop writing `pin_code` (backfill hashes first!), replace unsafe receipt reprint with `buildReceiptHtml()`, remove SW API caching, opaque upload filenames, feature flag defaults
- **Phase 4 (Tier 3):** Remove duplicate `/api/health`, fix cleanup double-scheduling, queueDepth telemetry, slug validation, delete Login.jsx
- **Phase 5 (Cleanup):** Delete 73 SQLite migrations + 10 infra files + artifacts, update .gitignore
- **Phase 6 (Structural):** helmet, vercel.json security headers, SupportWidget object URL cleanup, split admin.js, frontend api.js service layer, Zod validation
- **Phase 7 (Tests):** Wave 2 integration tests for untested routes (admin, billing, support, fbr, import, couriers, receipts)

### After All Phases

1. Re-run all 347+ integration tests — confirm green
2. Run live E2E suite against staging
3. Manual smoke test: password reset, admin tax approval, printer settings, support ticket, POS receipt reprint
4. Push branch, merge to main when verified

## Important Context

- **Git workflow:** Always create branches, never create PRs — user merges manually
- **Tests run sequentially:** Running all batches in parallel exhausts Supabase connection pool (`MaxClientsInSessionMode`). Run one batch at a time
- **Test command:** `cd backend && npx jest tests/integration/pg-batchN-name.test.js --no-coverage --forceExit`
- **The architecture-audit.md is the master reference** — contains all findings, scores, dead file inventory, test gaps, and execution plan
- **4 Codex audit files in docs/ are redundant** — everything is already in architecture-audit.md. Can delete them in Phase 5

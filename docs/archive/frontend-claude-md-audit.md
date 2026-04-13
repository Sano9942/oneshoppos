# Frontend CLAUDE.md Deep Audit Plan

**Goal**: For each frontend folder, read every source file line by line, then update the CLAUDE.md to fix
wrong claims and add missing information.

**Why**: The backend audit revealed docs cover ~30-40% of actual code behavior — wrong export counts,
missing gotchas, undocumented security behavior, hidden helpers. The frontend has the same problem:
sub-folder CLAUDE.md files are 5-14 lines covering dozens of files. Three new CLAUDE.md files were
already created (Apr 13 2026) for previously uncovered folders.

**Protocol per session**:
1. You say "Let's do folder X"
2. **Read every single source file in that folder in full, line by line — no skipping, no grepping only, no assuming from filenames.** This is mandatory before forming any opinion on what the CLAUDE.md should say.
3. Read the current CLAUDE.md
4. Report: ✅ correct · ❌ wrong/misleading · 🔍 missing
5. Confirm with you before writing
6. Update the CLAUDE.md
7. Mark done below

**Hard rule**: Do NOT update any CLAUDE.md until every file in that folder has been read in full. Partial reads produce partial docs — that's what we're fixing.

**What to look for** (based on backend audit findings):
- Wrong counts ("7 files" when it's 9)
- Missing exports — hooks, helpers, constants exported but undocumented
- Gotchas — step-skip logic, async patterns, silent failures, fallbacks
- Hidden behavior — auth checks inside components, permission gates, feature flag checks
- API contracts — exact endpoint paths, query params, request/response shapes
- Cross-file dependencies — which files are required by others, provider requirements
- Undocumented props — component props not listed anywhere
- CSS/styling exceptions — files that deviate from standard Tailwind v4 conventions

---

## New CLAUDE.md files created (Apr 13 2026)

These did not exist before — created from scratch after reading all files:

| Folder | Files | Notes |
|--------|-------|-------|
| `frontend/src/` | `App.jsx`, `api.js`, `config.js`, `main.jsx` | api.js export table, config.js env map, provider hierarchy, auth-header gotcha |
| `frontend/public/` | `sw.js`, `manifest.webmanifest`, `vite.svg` | AUTH_LOGOUT hook, cache versioning gotcha, step-skip skip-logic |
| `frontend/src/pages/redesign/cod/` | 7 files | Full module doc: batch lifecycle, 4-step wizard, step-skip, API table |

---

## Group 1 — Small, self-contained (1–3 files each)

| # | Folder | Approx Files | Status |
|---|--------|-------------|--------|
| 1 | `frontend/src/contexts/` | 2 files (CurrencyContext, ToastContext) | [x] |
| 2 | `frontend/src/hooks/` | 2 files (useFeatureFlags, useReportFilters) | [x] |
| 3 | `frontend/src/types/` | 2 TS files (auth.ts, api.ts) | [x] |
| 4 | `frontend/src/routes/` | 4 files (publicRoutes, appRoutes, adminRoutes, RouteLoading) | [x] |
| 5 | `frontend/src/pages/public/` | 2 files (PublicBookingPage, PublicRestaurantMenuPage) | [x] |

---

## Group 2 — Medium complexity (3–10 files each)

| # | Folder | Approx Files | Status |
|---|--------|-------------|--------|
| 6 | `frontend/src/auth/` | 3 files (AuthProvider, authStore, adminAuthStore) | [x] |
| 7 | `frontend/src/components/` | 6 files (AppLayout, ContextSwitcher, NotificationBell, RequireAuth, RequireContext, RequirePerm) | [x] |
| 8 | `frontend/src/ui/` | 9 files (primitives, nav-config, ErrorBoundary, Breadcrumbs, banners ×3, SupportWidget, StarRating, tokens.css) | [x] |
| 9 | `frontend/src/utils/` | 6 files (dates, receipt, categoryTree, offlineQueue, csvExport, theme) | [x] |
| 10 | `frontend/src/pages/storefront/` | 8 files (Home, Products, ProductDetail, Cart, Checkout, OrderStatus, Layout, useStorefrontCart) | [x] |
| 11 | `frontend/src/pages/shopify/` | 7 files (Context, Events, Import, Mappings, Overview, Reconciliation, Settings) | [x] |

---

## Group 3 — Large (10+ files, read carefully)

| # | Folder | Approx Files | Notes | Status |
|---|--------|-------------|-------|--------|
| 12 | `frontend/src/pages/admin/` | 10 files | Separate auth system, adminFetch, InfraPanel | [x] |
| 13 | `frontend/src/pages/dashboard/` | 18 files | 17 widget components + shared — many undocumented | [x] |
| 14 | `frontend/src/pages/reports/` | 25 files | 24 report modules + shared — largest sub-folder | [x] |
| 15 | `frontend/src/pages/redesign/pos/` | 22 files | POSContext ~145 exports, cartMath, 13 modals | [x] |
| 16 | `frontend/src/pages/redesign/` | 89 files | Read key non-Wave-16 pages + spot-check Wave-16 pages | [x] |

---

## Group 4 — Root frontend files + master CLAUDE.md pass

After all sub-folders done, re-read `frontend/CLAUDE.md` and verify every claim against what was found.

**Files to check against root CLAUDE.md** (not re-audit, just verify claims):

| # | File | Current doc coverage | Status |
|---|------|---------------------|--------|
| 17 | `frontend/CLAUDE.md` | Full pass — verify "Where to Look Instead" table, all hook signatures, all API patterns, provider hierarchy, test suite counts | [x] |

---

## Tests — separate audit track

The test suite has its own CLAUDE.md (`frontend/tests/CLAUDE.md`) already thorough. But spot-check:

| # | Folder | Files | Notes | Status |
|---|--------|-------|-------|--------|
| 18 | `frontend/tests/helpers/` | 3 files (auth.js, api.js, nav.js) | Verify helper exports vs what tests actually call | [x] |
| 19 | `frontend/tests/smoke/helpers/` | 4 files | cleanup, featureFlags, mockPaymentGateway, smokeRunId | [x] |
| 20 | `frontend/tests/unit/` | 4 files | auth_guards, contexts, layout, primitives — verify what each actually tests | [x] |

---

## Progress Log

Update this section as each folder is completed.

| Date | Folder | Key findings |
|------|--------|-------------|
| 2026-04-13 | `frontend/src/` root | Created from scratch: api.js 6-export table, config.js env map, main.jsx provider hierarchy, AUTH_LOGOUT hook, step-skip wizard gotcha |
| 2026-04-13 | `frontend/public/` | Created from scratch: sw.js cache strategy, AUTH_LOGOUT integration point, cache versioning gotcha |
| 2026-04-13 | `frontend/src/pages/redesign/cod/` | Created from scratch: batch lifecycle states, 4-step wizard with step-skip logic, config_json TEXT-not-JSONB gotcha, full API endpoint table |
| 2026-04-13 | `frontend/CLAUDE.md` master pass | Fixed: useAuth missing fields (isAuthenticated, isBootstrapping, authHeaders); unit test count 37→35; contexts.test.jsx is cartMath-heavy, no POSContext hooks exist |
| 2026-04-13 | `frontend/tests/helpers/` | Added full export tables: auth.js (6 exports), api.js (6 exports + ensurePOSReady gotcha), nav.js (3 exports) |
| 2026-04-13 | `frontend/tests/smoke/helpers/` | Added full export tables: smokeRunId (2), featureFlags (4), cleanup (3 + 33 DELETERS resource types), mockPaymentGateway (5 stubs) |
| 2026-04-13 | `frontend/tests/unit/` | Added per-file test counts (35 total), named what contexts.test.jsx actually tests (cartMath not POSContext) |

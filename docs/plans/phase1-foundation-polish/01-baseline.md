# Phase 1.1 — Performance & UX Baseline

> **Captured:** 2026-04-17
> **Branch:** `phase1-foundation-polish`
> **Commit:** baseline (no code changes yet)
> **Purpose:** Pre-improvement measurement so "better" is verifiable, not vibes.

---

## 1. Frontend Bundle Baseline

Built with `npm run build` on commit at branch creation. Vite 7, React 19, Tailwind v4.

### Total dist/assets

- **Total size:** 3.5 MB across 139 JS chunks + 1 CSS file (115 KB)
- **CSS:** `index-niGc1Ws4.css` = 115 KB (uncompressed)

### Top 15 chunks (largest first, uncompressed)

| Chunk | Size | gzip | Note |
|-------|------|------|------|
| `reports-DQsX9abu.js` | 429 KB | 85 KB | All report tabs bundled together (manualChunks) |
| `xlsx-CNerDvZX.js` | 429 KB | 143 KB | XLSX parser — only needed by Import + reports export |
| `recharts-BqKjEiZm.js` | 407 KB | 119 KB | Charts — only needed by Dashboard + reports |
| `index-m092pixV.js` | 277 KB | 82 KB | Main entry (router, providers, contexts, primitives) |
| `POSRoute-Bp8kYj4L.js` | 136 KB | 33 KB | POS — single largest route, expected (130+ exports in POSContext) |
| `CustomersRoute-Dq9983A-.js` | 50 KB | 11 KB | |
| `TreatmentPlansRoute-DKoBJlMV.js` | 47 KB | 12 KB | |
| `ShopifyIntegrationRoute-DULj1Nu-.js` | 41 KB | 9 KB | |
| `DashboardRoute-BnVREbV2.js` | 39 KB | 10 KB | |
| `FulfillmentRedesign-zN-9exFD.js` | 36 KB | 8 KB | |
| `PurchaseOrdersRoute-BfrNfSzH.js` | 34 KB | 7 KB | |
| `CODSettlementsRoute-AbhI-5c-.js` | 31 KB | 8 KB | |
| `AdminTenantDetail-CxeZpAGB.js` | 31 KB | 6 KB | |
| `RoomManagementRoute-C-TOWdtZ.js` | 30 KB | 7 KB | |
| `RentalsRoute-B6DIUJz0.js` | 27 KB | 7 KB | |

### Existing optimizations (good)

- ✅ Lazy loading via `React.lazy()` is wired across `appRoutes.jsx` (every route is lazy)
- ✅ `vite.config.js` already extracts `recharts`, `xlsx`, `reports` into manual chunks
- ✅ `RouteLoading.jsx` provides Suspense fallback (centered "Loading..." pill)
- ✅ Service worker caches static assets in production

### Observed issues to fix in Phase 1.1

1. **`xlsx` (429 KB) loads on Reports** — used for export, but probably should defer until user clicks "Export". Dynamic import on the export handler would save 143 KB gzip from initial reports load.
2. **`recharts` (407 KB) loads on Dashboard** — Dashboard uses Recharts directly. Probably can't defer further, but worth confirming nothing else pulls it in.
3. **`reports-DQsX9abu.js` (429 KB)** is one chunk for all report tabs. With 17 deep-link routes (`/reports/sales-summary`, etc.), splitting per-tab could turn this into 17 small chunks loaded only when the tab opens.
4. **`index-m092pixV.js` (277 KB)** — entry chunk. Audit what's pulled in eagerly (CurrencyContext, ToastContext, AuthProvider, ErrorBoundary, primitives, all of `lucide-react`?). `lucide-react` tree-shakes per-icon usually but worth confirming.
5. **`POSRoute` 136 KB** — expected, but `POSContext` has 130+ exports. Could potentially split modal logic out.

### Action items (deferred to Phase 1.1 work, not now)

- [ ] Defer `xlsx` dynamic import in Reports/Import export handlers
- [ ] Audit `index-*.js` entry contents with `vite-bundle-visualizer` (`npx vite-bundle-visualizer`)
- [ ] Try splitting `reports-*.js` per-tab (remove the `manualChunks` rule for `/src/pages/reports/`, let Vite auto-split per `lazy()`)
- [ ] Confirm `lucide-react` is tree-shaken (grep for namespace imports)

---

## 2. Backend Database Baseline

### Schema + index coverage (already strong)

- **Schema indexes** (`backend/schema-pg.sql`): **172 `CREATE INDEX` statements**
- **Migration indexes** (`backend/migrate-pg.js` v1-v49): **170 additional `CREATE INDEX` statements**
- Solid baseline — index coverage is not the obvious low-hanging fruit.

### Query patterns (sampled in `backend/routes/`)

- **No obvious for-loop N+1 patterns** — `for (const x of arr) await db.query(...)` returned 0 hits
- **One async-map case** in `backend/routes/admin/tenants.js` — needs review (could be batch-loadable)
- 269 `await deps.db.*` / `await db.*` calls across the top 20 route files — normal volume

### Heavy route files (sized for review)

| Route | Lines | Notes |
|-------|-------|-------|
| `routes/products.js` | 1579 | Largest route file — variants, pricing, search, image upload. Definitely worth EXPLAIN-ing the list query. |
| `routes/sales.js` | 1035 | POS sale creation (transactional, multi-table writes). Worth profiling the success path latency. |
| `routes/customers.js` | 828 | Customer list + detail + ledger. Potential N+1 on loyalty/wallet enrichment. |
| `routes/inventory.js` | 549 | Outlet stock, adjustments, transfers. |

### Action items (deferred)

- [ ] Stand up a `pg_stat_statements`-based slow-query inspector script (see `tools/inspect-slow-queries.js` shipped in this baseline commit)
- [ ] Capture top-20 slowest queries on production over 24 h, attach to this doc as `02-slow-queries-snapshot.md`
- [ ] Run EXPLAIN ANALYZE on the products list endpoint (filtering by category, search, outlet)
- [ ] Audit any `SELECT *` from large tables (customers, products) — projection trim

---

## 3. Web Vitals Baseline (TODO — needs production capture)

We do **not** have current Lighthouse / Web Vitals numbers captured. To be filled in this phase:

| Page | LCP | INP | CLS | TTFB | Notes |
|------|-----|-----|-----|------|-------|
| `/` (LandingPage) | TBD | TBD | TBD | TBD | |
| `/dashboard` | TBD | TBD | TBD | TBD | Heavy: Recharts, multiple API calls |
| `/pos` | TBD | TBD | TBD | TBD | Single largest route bundle |
| `/products` | TBD | TBD | TBD | TBD | Large list, filters, images |
| `/customers` | TBD | TBD | TBD | TBD | Large list |
| `/sales-history` | TBD | TBD | TBD | TBD | Large list, date filtering |
| `/inventory` | TBD | TBD | TBD | TBD | Large list, multi-outlet |
| `/reports` | TBD | TBD | TBD | TBD | Heaviest tab pre-load |
| `/returns` | TBD | TBD | TBD | TBD | |
| `/bookings` (Appointments) | TBD | TBD | TBD | TBD | |
| `/service-tickets` | TBD | TBD | TBD | TBD | |

### Targets (from plan)

- LCP < 2.5 s
- INP < 200 ms
- CLS = 0
- Lighthouse Performance > 90

### Capture method

Two options. Picking one is the next decision:

- **Option A — Lighthouse CI** against a production tenant. Pros: continuous, baked into CI on PRs. Cons: needs setup, costs CI minutes, single page-load not real session.
- **Option B — Chrome DevTools manual run + screenshot** for each of the 11 pages. Pros: zero infra, captures real interaction. Cons: not continuous, must repeat manually.

Recommendation: **B for the immediate baseline** (fast, real numbers), **A as a follow-up** once the targets are clear and we want guardrails.

---

## 4. Reliability Baseline (TODO — needs Sentry + UptimeRobot pull)

Captured separately:

- [ ] Sentry: top-10 error groups in last 30 days (frequency, affected tenants, stack)
- [ ] UptimeRobot: uptime % for `/api/health` over last 30 days
- [ ] Email queue depth + worker lag from `/api/admin/worker-status`
- [ ] Stuck payment intents from `/api/admin/payment-intents/stuck`

To be added as `03-reliability-snapshot.md`.

---

## 5. Tooling Added in This Commit

- `tools/inspect-slow-queries.js` — connects to `DATABASE_URL`, queries `pg_stat_statements`, prints top-N slowest queries with mean/total time and call count. Run: `node tools/inspect-slow-queries.js [limit]`.

Nothing else changed — this commit is pure measurement infrastructure + this doc.

---

## How "Phase 1.1 done" is verified

1. This baseline doc has all TBDs filled in (Web Vitals + Sentry + slow-query top 20).
2. A second doc `04-improvements.md` lists every change made + before/after measurements.
3. Reductions: bundle initial-load gzip < 110 KB (currently ~82 KB entry + whatever the first route pulls), top-page LCP improvement of ≥ 30%, top-3 slow queries each cut by ≥ 50%.
4. Observable result: a real merchant says "feels faster" without prompting.

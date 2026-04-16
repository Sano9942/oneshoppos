# Phase 1.1 — Tier 1 + Tier 2 Results

> **Captured:** 2026-04-17
> **Branch:** `phase1-foundation-polish`
> **Window:** commits `ee3a5ce` … `12339f6`

---

## Tier 1 — Backend Admin Hot Path (3/3 shipped)

| Commit | Change | Expected impact |
|--------|--------|-----------------|
| `ee3a5ce` | `perf(admin-infra): cache /api/admin/infra results for 5 minutes` | Eliminates ~957 s of DB time across queries #3, #9, #10 from the 2026-04-17 snapshot. `X-Infra-Cache: hit` short-circuits before any DB call. `?force=1` bypasses for manual refresh. 3 unit tests lock the cache behavior. |
| `423df38` | `perf(admin-ui): throttle InfrastructurePanel polling 30s → 60s, pause when hidden` | Halves the call rate, kills polling on hidden tabs. Pairs with the server cache so backend now serves the same payload between refreshes for free. |
| `0be608f` | `perf(admin-orphans): move orphan-schema scan to hourly pg-boss worker` | Worst per-call query (104 s p100, 622 s total) now runs hourly off the request path. Migration v50 adds `public.infra_cache`; `?force=1` still allows live scan when needed. 2 unit tests lock the scan + cache write. |

**Combined expected effect on next prod snapshot:** queries #3, #9, #10 should fall off the top-25 list entirely or drop ≥80% in total time.

---

## Tier 2 — Frontend Bundle (1/3 shipped, 2/3 deferred with reasons)

### Shipped

| Commit | Change | Real impact |
|--------|--------|-------------|
| `12339f6` | `perf(cod-import): lazy-load xlsx in COD ImportWizard` | The only remaining static `import * as XLSX from "xlsx"` was in `ImportWizard.jsx`, eagerly pulling the 429 KB / 143 KB gzip xlsx chunk on every COD page visit. Now loads only inside `handleFile()` when a user actually picks a file. CODSettlementsRoute size unchanged (xlsx was already in its own manualChunk), but network cost moves from "every COD visit" to "actual import attempts". |

### Deferred — entry chunk audit (was Tier 2 #2)

**Investigation result:** the 277 KB entry chunk is dominated by React + ReactDOM + React Router + AuthProvider (463 lines) + tree-shaken `lucide-react` icons used by providers. Extracting `@sentry/react` into its own chunk via `manualChunks` produced an **8 KB sentry chunk** (not the ~100 KB I'd estimated from package size) — meaning the savings to the entry chunk would be ~8 KB / ~3 KB gzip. Not worth the lazy-init complexity in `main.jsx` + `ErrorBoundary`. **Reverted.**

**Honest finding:** the entry chunk is already well-optimized. Further reduction would require swapping React Router for a smaller router or splitting the 463-line AuthProvider, both of which are scope larger than Phase 1.

### Deferred — split `reports-*.js` per-tab (was Tier 2 #3)

**Investigation result:** all ~20 report tabs are static-imported from `pages/Reports.jsx`. To split per-tab requires:
1. Converting every tab import to `React.lazy()`
2. Wrapping each render site in `<Suspense>`
3. Verifying all 17 standalone report deep-link routes (`/reports/sales-summary`, etc.) still work
4. Smoke-testing tab switching for flicker / loading-state regressions

**Real expected win:** ~85 KB gzip savings *per first report visit* (subsequent tabs load on click).

**Why deferred:** it's a real win but requires careful per-tab testing of 17 deep-link routes. Belongs in its own focused PR with a Playwright pass over reports, not bundled into Phase 1.1.

### Net Tier 2 result

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| dist/assets total | 3.5 MB | 3.5 MB | same |
| Entry chunk (gzip) | 82.21 KB | 82.21 KB | same |
| xlsx loaded on COD page visit | yes (eager) | no (on user import action) | **-143 KB gzip** for non-importing COD users |
| Reports chunk | 429 KB / 85 KB gzip | 429 KB / 85 KB gzip | unchanged (deferred) |

The COD lazy-xlsx win is real but narrow. The Tier 2 plan over-estimated the entry chunk problem.

---

## What changed in the priority list

Original Phase 1.1 plan had Tier 2 framed as "obvious bundle wins". Reality: **only one of the three was truly obvious**. The other two were either negligible-impact (entry chunk) or sized like a separate PR (per-tab reports).

This is exactly why measuring before optimizing matters. Two days of speculative bundle work would have produced a 60-byte change.

### Revised next priorities

1. **Tier 3.1** — chunk-load-failure auto-reload handler. Small, high-value (Sentry showed exactly this class of error after deploys).
2. **Tier 3.2** — Playwright smoke tests for top 5 user journeys, in CI.
3. **Tier 3.3** — duplicate-payment / duplicate-sale detector (already on the open-items list).
4. **Per-tab reports split** — its own focused PR, after Phase 1.

5. **Track 1.2** — Design system convergence. Bigger payoff for the user-perceived "feels rough" complaint than micro-bundle work.

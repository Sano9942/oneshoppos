# Phase 1.1 — Production Snapshot

> **Captured:** 2026-04-17 from live prod
> **Sources:** Supabase Management API (pg_stat_statements), Sentry CLI, UptimeRobot API
> **Window:** since stats reset / last 30 days

---

## TL;DR

The product is healthy on the customer-visible axis (100% uptime, zero unresolved Sentry errors in last 30 days). **The largest concentrated source of database load is the super-admin `InfrastructurePanel`**, which polls four expensive cross-schema introspection queries every 30 seconds and accounts for hundreds of seconds of total DB time. This is the cheapest, highest-impact fix in Phase 1.1.

---

## 1. Database Snapshot

| Metric | Value |
|--------|-------|
| Database size | **196 MB** (~39% of Supabase Free 500 MB) |
| Tenant schemas (`tenant_*`) | **6** |
| Total user tables | **2,291** (~380 tables per tenant schema) |
| pg_stat_statements installed | ✅ |
| Connection pool size (Railway → Supabase) | 20 |

**Implication:** with 380 tables/tenant, every cross-schema introspection query (admin monitoring, Supabase Studio dashboards) iterates a lot. This compounds cost linearly with tenant count — at 50 tenants we'd be at ~19,000 tables.

---

## 2. Top Slow Queries — Live `pg_stat_statements`

Filtered to non-trivial entries; full raw data: [`slow-queries-raw-2026-04-17.json`](slow-queries-raw-2026-04-17.json).

| # | Total time | Mean | Max | Calls | Origin | Diagnosis |
|---|-----------|------|-----|-------|--------|-----------|
| 1 | 2131 s | 902 ms | 7.9 s | 2364 | Supabase Studio (PostgREST type introspection) | External (Studio dashboard usage) |
| 2 | 1913 s | 818 ms | 7.1 s | 2338 | `SELECT name FROM pg_timezone_names` | Likely Studio + `SET TIME ZONE` lookup |
| 3 | **622 s** | **1398 ms** | **105 s** | 445 | **`/api/admin/orphaned-schemas`** ([`backend/routes/admin/system.js:65`](../../backend/routes/admin/system.js#L65)) | **Our code — fixable** |
| 4 | 586 s | 250 ms | 7.6 s | 2346 | Supabase Studio (PK/FK introspection) | External |
| 5 | 537 s | 2.7 ms | 5.6 s | 202231 | `pgbouncer.get_auth` | Connection pool internals |
| 6 | 537 s | 0.14 ms | 3.5 s | 3.7M | `pgboss.job_common` SELECT FOR UPDATE | Job queue (expected, high volume) |
| 7 | 319 s | 136 ms | 5.9 s | 2342 | Supabase Studio type introspection | External |
| 8 | 262 s | 430 ms | 14 s | 609 | `schema-pg.sql` apply (migration / tenant provisioner) | Tenant onboarding — expected |
| 9 | **179 s** | **392 ms** | **18 s** | 456 | **`/api/admin/infra` dead-tuples** ([`backend/routes/admin/monitoring.js:209-218`](../../backend/routes/admin/monitoring.js#L209)) | **Our code — fixable** |
| 10 | **156 s** | **342 ms** | **20.7 s** | 457 | **`/api/admin/infra` cache-hit ratio** ([`backend/routes/admin/monitoring.js:201-207`](../../backend/routes/admin/monitoring.js#L201)) | **Our code — fixable** |
| 11 | 103 s | 191 ms | **83 s** | 538 | `CREATE TABLE IF NOT EXISTS announcements` (migration v?) | One-shot per tenant — slow when contended but rare |
| 12 | 99 s | 42 ms | 3.4 s | 2360 | Supabase Studio (PK/FK recursion) | External |
| 13 | 88 s | 5194 ms | 16 s | 17 | `DO $$ ... DROP test_* schemas` | Test cleanup — should not run in prod |
| 14 | 88 s | 10 ms | 6.8 s | 8428 | `setval(pg_get_serial_sequence(...))` | Tenant provisioning — incidental |
| 15 | 86 s | 62 ms | 20 s | 1385 | Schema versioning DDL | Migration runs — expected |

### Hot fixable spots (concentrated impact)

- **Combined `/api/admin/infra` cost: ~957 seconds of total DB time** (queries #3 + #9 + #10) for an admin-only dashboard polling at 30 s.
- **Per-poll cost on prod today**: ~2-3 seconds of DB time per `/api/admin/infra` call. Each panel session = ~4 s/min of DB pressure.
- **Worst case**: a single `/api/admin/infra` call held the DB for **104 seconds** at the p100. That's a Supabase connection-pool-saturation risk.
- **Fix candidates (in order of leverage):**
  1. **Cache `/api/admin/infra` results in-process** with a 5-minute TTL — cuts polling-driven cost ~10×.
  2. **Slow the polling rate** in `frontend/src/pages/admin/InfrastructurePanel.jsx` from 30 s → 60 s (or only refresh on tab focus).
  3. **Run the orphan-schema scan on a worker schedule** (once/hour) instead of on every admin request.
  4. **Cache `pg_timezone_names` at app boot** if our code calls it (verify origin first).

### Non-fixable (but worth knowing)

- Queries #1, #4, #7, #12 are Supabase Studio dashboard activity — they count against our pool because Studio uses the same Postgres. Limit Studio dashboard usage when not actively debugging.
- Queries #5, #6 are pgbouncer + pgboss internals — expected, healthy.

---

## 3. Sentry — Last 30 Days

### Backend (`node-express`)

- **Unresolved (last 30 d): 0**
- 2 historical issues, both resolved:
  - `NODE-EXPRESS-2` `ReferenceError: requireFeature is not defined` (resolved 2026-04-09, fatal)
  - `NODE-EXPRESS-1` `SyntaxError: Bad escaped character in JSON at position 114` (resolved 2026-03-29, error)

### Frontend (`sanopos-frontend`)

- **Unresolved (last 30 d): 0**
- 7 historical issues, all resolved. Notable patterns:
  - Two "Rendered fewer hooks than expected" — accidental early-return bugs (resolved). **Watchpoint** for Phase 1.4 — this is exactly the kind of regression the React rules forbid; consider an eslint-plugin-react-hooks audit.
  - One `Failed to fetch dynamically imported module: .../FulfillmentRedesign-D0gpE-fY.js` (resolved 2026-04-12). Indicates **stale clients holding old chunk hashes after a deploy** — fixable with a service-worker update flow or client-side reload-on-import-failure handler.
  - `TypeError: Cannot read properties of undefined (reading 'admin_reply')` — defensive prop access fix.
  - `ReferenceError: authHeaders is not defined` and `TypeError: n.map is not a function` — straightforward bug fixes that landed.

**Phase 1.3 implication:** the Sentry top-10 list to "fix" is empty — there's nothing burning. Reframe Phase 1.3 to: (a) **prevent** the dynamic-import-failed-after-deploy class of bug with a reload handler, (b) **harden** with the smoke tests in CI, (c) **wire** the duplicate-payment / duplicate-sale detectors that are on the open-items list.

---

## 4. Uptime — UptimeRobot

| Window | Uptime |
|--------|--------|
| Last 1 day | 100.000% |
| Last 7 days | 100.000% |
| Last 30 days | 100.000% |
| Last 90 days | 100.000% |

Single monitor on `oneshoppos-production.up.railway.app/api/health`, 5 min interval.

---

## 5. Revised Phase 1.1 Priority List

Based on data, not hunches. Each is one PR-sized change.

### Tier 1 — biggest known wins, cheap to do

1. **Cache `/api/admin/infra`** in-process (5 min TTL) — kills the biggest concentrated DB load.
2. **Throttle `InfrastructurePanel` polling** 30 s → 60 s + pause when tab not visible.
3. **Move `/api/admin/orphaned-schemas` scan to a pg-boss worker** (once/hour) and read cached result on demand.

### Tier 2 — known frontend wins (from baseline doc §1)

4. **Defer `xlsx` dynamic import** in Reports/Import export handlers (~143 KB gzip off Reports initial).
5. **Audit entry chunk** for eager imports that should be lazy (target: trim 277 KB → <240 KB).
6. **Try removing `reports` manualChunk** so Vite auto-splits per `lazy()` (turns 429 KB into ~17 small chunks).

### Tier 3 — reliability prevention (not reactive — Sentry is empty)

7. **Add a chunk-load-error reload handler** in `index.html` or root error boundary to auto-reload on `Failed to fetch dynamically imported module` after deploy.
8. **Stand up Playwright smoke tests in CI** for the 5 highest-revenue journeys.
9. **Wire duplicate-payment / duplicate-sale detectors** (already on open-items list).

### Skip / defer

- "Fix top 10 Sentry errors" — there are none unresolved. Plan item satisfied automatically.
- Web Vitals manual capture — useful but lower priority than the slow-query fixes; revisit after Tier 1 + 2 land.

---

## 6. What this snapshot proves

- The product is **operationally healthy** — uptime, errors, and customer-visible paths are clean.
- The **scaling cliff** is admin-side cross-schema introspection at 380 tables/tenant. Fix the polling + add caching now and we buy headroom for 50+ tenants without touching the per-tenant query path.
- The "rough" feeling the user described is unlikely to be backend errors (there are none). It's **page weight + perceived speed** (Tier 2) and **design inconsistency** (Track 1.2). Sequence accordingly.

# OneShopPOS - Improvement Plan

Created: 2026-02-26  
Last Updated: 2026-02-25  
Status: In Progress

---

## Overview

This plan tracks delivery in five tiers. Tiers 1 and 4 are complete, Tier 3 is mostly complete, and Tier 2/5 remain open.

---

## Tier 1 - Quick Wins (Completed)

| # | Item | Status | Notes |
|---|---|---|---|
| 1.1 | Dashboard redesign | Done | Recent sales feed, low stock badges, improved layout |
| 1.2 | POS UX improvements | Done | Hotkeys, discount fixes, warnings, quick amounts |
| 1.3 | Centralized API base URL | Done | `frontend/src/config.js` used across frontend |
| 1.4 | Reports visual upgrade | Done | KPI strip, trend visuals, broader CSV exports |
| 1.5 | Low stock alerts | Done | Sidebar indicators and visibility improvements |

---

## Tier 2 - Placeholder Pages (Pending)

| # | Route | Status | Notes |
|---|---|---|---|
| 2.1 | `/lookup` | Pending | Product lookup module |
| 2.2 | `/custom-fields` | Pending | Custom field definitions |
| 2.3 | `/partners` | Pending | Partner account management |
| 2.4 | `/shopcast` | Pending | Broadcast/publishing workflow |

---

## Tier 3 - Enhancements (Mostly Complete)

| # | Item | Status | Notes |
|---|---|---|---|
| 3.1 | Email or SMS receipts | Pending | Requires SMTP/SMS provider setup and endpoint/UI wiring |
| 3.2 | Thermal printer support | Done | Browser print flow supports thermal printers |
| 3.3 | Multi-outlet consolidated reports | Done | Outlet comparison and CSV exports |
| 3.4 | Replenishment suggestions | Done | Reorder quantities and draft PO creation |
| 3.5 | Customer segmentation (RFM) | Done | Segment analytics and export |
| 3.6 | Automated DB backups | Done | Scheduled backups with retention |
| 3.7 | Shopify sync queue cleanup | Done | Scheduled cleanup of stale sync events |

---

## Tier 4 - New Modules (Completed)

| # | Module | Status | Notes |
|---|---|---|---|
| 4.1 | Accounting core | Done | P and L, cashflow, AP, period management |
| 4.2 | CRM and quotations | Done | Lead pipeline, activities, quotation-to-sale conversion |
| 4.3 | Advanced HR | Done | Leave workflow and payroll period generation |
| 4.4 | Notification engine | Done | In-app notification center and triggers |
| 4.5 | Company profile | Done | Profile API, logo upload, branded header/invoice source data |

Validation:
- `npm run test:tier4-smoke`: 53 passed, 0 failed

---

## Tier 5 - Technical Debt and Infrastructure (In Progress, 3 Phases)

### Tier 5-A (Stabilization, low risk)

| # | Item | Status | Owner | Definition of Done | Risk | Rollback |
|---|---|---|---|---|---|---|
| 5.5 | Legacy cleanup and reference deconfliction | Done | Backend + Docs | Legacy artifacts are archived from runtime paths, docs/scripts reference only `backend/oneshop.db`, startup/tests run clean | Path/reference misses after move | Restore archived files to previous location and revert docs/script references |
| 5.2 | Baseline API rate limiting | Done | Backend | `express-rate-limit` integrated with global + strict route policies, standardized 429 contract, diagnostics headers present | False positives on POS burst flows | Disable limiter middleware via config switch and restore previous middleware chain |
| 5.3 | PWA foundations (read-first) | Done | Frontend | Manifest + service worker registration + read-first caching for static/selected GET responses with offline UX for writes | Stale data, cache poisoning, auth-sensitive caching mistakes | Unregister SW, bump cache version, ship no-op SW |

### Tier 5-B (Structural maintainability)

| # | Item | Status | Owner | Definition of Done | Risk | Rollback |
|---|---|---|---|---|---|---|
| 5.1 | Backend route modularization (`index.js` split) | Planned | Backend | Route modules extracted by domain, shared middleware/util layers introduced, no route path changes, all core suites pass | Regression in transaction-heavy flows during extraction | Revert extraction PRs by domain, keep parity checkpoints and route inventory diffs |

### Tier 5-C (Realtime and hardening)

| # | Item | Status | Owner | Definition of Done | Risk | Rollback |
|---|---|---|---|---|---|---|
| 5.4 | SSE realtime channels | Planned | Backend + Frontend | `GET /api/events/stream` live, targeted event types wired, reconnect + polling fallback implemented | Connection churn/load on long-lived streams | Disable SSE endpoint and keep interval polling only |
| 5.2-T | Rate limit tuning + observability pass | Planned | Backend + Ops | Threshold tuning validated against real usage and logs/metrics show 429 hotspots and retry behavior | Under/over-throttling after rollout | Revert policy values to baseline defaults |

### Tier 5 Technical Spec

#### 5.1 Split `backend/index.js` (Route Modules)

- Target structure:
  - `backend/routes/*.js` for domain routes
  - `backend/middleware/*.js` for auth/perm/feature/shared guards
  - `backend/services/*.js` for reusable business helpers
- Keep one Express app and one sqlite connection from `db.js`.
- Migration strategy:
  1. Extract read-only/no-op modules first.
  2. Extract write-heavy modules with transaction parity checks.
  3. Keep route behavior, path contracts, and response shapes unchanged.
- Done criteria:
  - No endpoint path changes.
  - `npm run preflight`, `npm run test:e2e-full`, and `npm run test:tier4-smoke` all pass.

#### 5.2 API Rate Limiting

- Add `express-rate-limit`.
- Initial policy:
  - Global default limiter.
  - Stricter limiter for auth/login and public webhook endpoints.
  - Explicit exemptions or higher thresholds for local POS burst paths.
- Standard 429 JSON contract:
  - `{ "error": "Too many requests", "retry_after_seconds": <n> }`
- Add diagnostics headers for observability and tuning.

#### 5.3 PWA / Offline (Read-First)

- Add:
  - `manifest.webmanifest`
  - service worker registration in frontend entry
  - service worker caching for static assets and selected GET responses
- Scope constraints:
  - No offline write queue in Tier 5.
  - Explicit UX message for write attempts while offline.
- Cache policy:
  - static assets: cache-first
  - critical GET endpoints: stale-while-revalidate
  - auth-sensitive data: short TTL and explicit invalidation on logout

#### 5.4 Realtime Updates (SSE)

- Add SSE endpoint:
  - `GET /api/events/stream`
- Initial event types:
  - `notification:new`
  - `dashboard:kpi_refresh`
  - `shopify:queue_status`
- Frontend behavior:
  - `EventSource` subscription in top-level app context or targeted module contexts
  - fallback to existing polling on disconnect
- Keep write operations HTTP-based; no socket command channel in Tier 5.

#### 5.5 Remove Legacy Files (Archive Policy)

- Move non-runtime artifacts from `backend/` to an archive/tools location.
- Candidate files:
  - `backend/archive/legacy/database.sqlite`
  - `backend/archive/legacy/schema_dump.txt`
  - `backend/archive/legacy/readable_schema.txt`
- Update docs/scripts so runtime DB reference is only `backend/oneshop.db`.
- Add a short legacy artifacts policy note to docs.

Implementation status:
- Completed on 2026-02-25.
- Files moved to `backend/archive/legacy/`.

### Tier 5 Verification Matrix

| Item | Command Checks | Functional Checks | Regression Checks | Rollback Check |
|---|---|---|---|---|
| 5.1 | endpoint inventory diff + suite commands | route parity smoke on migrated domains | `preflight` + full e2e + Tier 4 smoke | domain-by-domain revert preserves old behavior |
| 5.2 | limiter unit/integration checks, 429 contract checks | auth brute-force simulation returns deterministic 429/retry | POS high-frequency flows unaffected | middleware feature switch disables limiter |
| 5.3 | build/preview with SW active, manifest validation | installability + offline reload of app shell + cached reads | no auth/session corruption from cache | SW unregister and cache-bust restore baseline |
| 5.4 | SSE connect/reconnect and heartbeat checks | event delivery for initial event types + polling fallback | no impact on existing HTTP write flows | disable SSE endpoint and rely on polling |
| 5.5 | startup + migration + test scripts from clean clone | no runtime lookups against archived files | docs/scripts paths remain valid | restore archived files + previous refs |

### Public APIs / Interfaces / Types Affected

- Planned new endpoint:
  - `GET /api/events/stream`
- Planned standardized rate-limit contract:
  - `{ "error": "Too many requests", "retry_after_seconds": <n> }`
- Planned frontend interfaces:
  - PWA manifest
  - service worker registration lifecycle
- No breaking changes to Tier 1-4 endpoint paths.

### Test Cases and Scenarios (Tier 5)

1. Rate-limit auth brute-force simulation:
   - exceed threshold, validate deterministic 429 with retry metadata
2. POS burst safety:
   - rapid sale-related calls do not trigger false positives
3. PWA offline read path:
   - load once online, then offline refresh for app shell and selected cached views
4. PWA offline write behavior:
   - write attempts offline show explicit non-destructive UX error
5. Route modularization parity:
   - endpoint inventory parity + full regression suites
6. SSE lifecycle:
   - connect, receive events, drop network, reconnect, continue receiving
7. Legacy cleanup safety:
   - clean clone startup + migration + tests with no path regressions

### Assumptions and Defaults (Locked)

- Tier 5 is planned in 3 phases.
- Backend refactor uses route modules, not a full service/repository rewrite.
- Realtime transport is SSE-first with polling fallback.
- PWA scope is read-first offline, without offline transaction queueing.
- Legacy cleanup uses archive + reference removal, not hard delete.
- Tier 3.1 remains outside Tier 5 and is tracked separately.

---

## Next Recommended Sequence

1. Complete `3.1` email receipt workflow
2. Start Tier 2 route implementations (`/lookup` first)
3. Execute Tier 5-A first (`5.5` -> `5.2` -> `5.3`)
4. Execute Tier 5-B (`5.1` route modularization)
5. Execute Tier 5-C (`5.4` SSE + rate-limit tuning)

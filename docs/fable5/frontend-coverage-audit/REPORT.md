# Frontend Coverage Audit — "Built in backend, not showing on front"

> Owner question (2026-07-11): *"I have a feeling that many things that were built are backend
> only and not showing on front."* Scope agreed: all four gap types (dead endpoints, unreachable
> pages, gated-off features, hidden capabilities), all surfaces (tenant app, POS/kiosks, portals,
> field PWA, admin), automated matrix first, findings report only.
> Method: static cross-reference scanner at [scan.cjs](scan.cjs) (re-runnable:
> `node docs/fable5/frontend-coverage-audit/scan.cjs` from repo root; raw data in `matrix.json`),
> plus manual sample verification of borderline candidates. Read-only — nothing was changed.

## Verdict

**The feeling is correct, but it is concentrated, not pervasive — and it lives at exactly one
layer.** Of 1,347 backend endpoints, **78 (~6%) have no frontend caller anywhere** after removing
external-by-design endpoints and dynamically-built calls. They cluster into ~10 coherent feature
areas — mostly the deep halves of the vertical-depth waves (clinical, rentals, rooms, packages,
approvals, Shopify ops, courier tracking, van reconciliation), where the *primary* flow got UI
and the *secondary* actions didn't. Every other layer checked out clean:

| Layer | Checked | Orphans | Verdict |
|---|---|---|---|
| Feature flags → presets/modules | 106 flags | **0** | Clean — every flag reachable via module card, sub-toggle, mode bundle, industry preset, or the deliberate unmanaged list (the Business Modules bidirectional guard is working) |
| Pages → import graph | 431 page files | **1** | Clean — only `POSApprovalModal.jsx` is truly orphaned (referenced solely in a comment) |
| Frontend calls → backend routes | 1,271 calls | **0** | Clean — all 9 initial suspects were parser artifacts; verified `portal/auth/refresh` etc. exist |
| Backend routes → frontend callers | 1,347 routes | **78** | **The gap is here** — detail below |
| Route paths → nav/links | 223 routes | ~73 flagged, mostly false | Nested-route artifacts; a short eyeball list below |

## Tier 1 — Coherent feature gaps (the real "backend-only" findings)

Each is a feature area where endpoints exist, are perm-gated and (in some cases) E2E-tested, but
no UI ever calls them. File:line references are the backend route definitions.

### 1. Clinical / treatment plans — 11 endpoints (largest gap)
The treatment pages call start/complete/chart-entry-create, but none of these:
`POST /api/treatment-sessions/:id/no-show` (:209), `/cancel` (:217), `PUT/DELETE
/api/session-chart-entries/:id` (:250/:258 — chart entries can be created but never edited or
deleted), `POST /api/lab-orders/:id/result` (:290 — lab orders can be placed, results can never be
recorded), `DELETE /api/clinical-documents/:id` (:384), `POST /api/treatment-sessions/:id/
prescriptions` (:401), `POST /api/treatment-folios/:id/lines` (:418) + `/attach-sale` (:425),
`POST /api/treatment-plans/:id/deposit/preauth` (:450).
**Impact**: clinics can't mark no-shows, record lab results, or issue prescriptions from the UI —
workflow dead-ends on a flagship vertical (V05).

### 2. Rentals asset layer — 7 endpoints
`GET /api/rental-items/:id/availability` (rentals.js:69), asset CRUD (`GET/POST/PUT
/api/rental-items/:id/assets*`, :81-95), `POST .../assets/:assetId/maintenance` (:332),
`GET /api/rental-assets/maintenance-due` (:325), `POST /api/rental-contracts/:id/notes` (:249).
**Impact**: the per-asset tracking + maintenance system built in V09 has no UI at all —
RentalsRedesign works at the item level only.

### 3. Rooms / lodging advanced — 5 endpoints
Group bookings: `GET /api/room-booking-groups/:id` (rooms.js:457) + `POST .../master-folio`
(:472); guest documents upload (:421) and guest removal (:403); deposit pre-auth (:329).
**Impact**: V10's group-booking/master-folio feature is invisible; guest document capture too.

### 4. Packages / prepaid credits — 6 endpoints (F02)
`PUT/DELETE /api/package-templates/:id` (packages.js:120/148 — templates can be created, never
edited or deleted), `GET/POST /api/customers/:id/packages` (:164/:187 — can't sell or view a
customer's package from the customer screen), `POST /api/packages/:id/redeem` (:207) + `/reverse`
(:239 — no manual redemption/correction UI).

### 5. Approval workflows — 4 endpoints + a dead component
`PUT/DELETE /api/approval-policies/:id` (approval-policies.js:54/79 — policies can be created but
never edited/deleted), `POST /api/approvals/evaluate` (:161), and **`POSApprovalModal.jsx` is
built but never imported** (the one true orphan page component — referenced only in a comment at
POSRedesign.jsx:302). Related: `POST /api/transfers/:id/submit` (tier4/approvals.js:119, E2E-tested)
— the transfer-approval submission flow has no button.

### 6. Shopify operations console — 8 endpoints
`POST /api/integrations/shopify/sync/pull-orders`, `retry-event/:id`, `process-pending`,
`retry-failed`, `push-inventory` (shopify/orders.js:8, sync.js:52-152) and mapping bulk actions
`products/auto`, `auto-live`, `apply-suggestions` (mappings.js:69/87/176).
**Impact**: manual sync/retry operations exist server-side; merchants can't trigger them. (The
Shopify tabs use other endpoints; these ops never got buttons.)

### 7. Courier tracking — 4 endpoints
`POST /api/couriers/:id/test-booking` (couriers.js:171), `GET /api/orders/:id/tracking` (:538) +
`POST .../tracking/refresh` (:458). Dispatch/shipping is wired; **viewing tracking is not**.

### 8. Van sales reconciliation — 2 endpoints (V02 wholesale)
`GET /api/van/:outletId/reconcile-preview` (van.js:128), `POST /api/van-reconciliations/:id/confirm`
(:260). Van load-out exists in UI; end-of-day reconciliation doesn't.

### 9. Workflow dead-ends (single endpoints that orphan a whole flow)
- `POST /api/inventory-intelligence/cycle-sessions/:id/complete` (:508) — **cycle count sessions
  can be started but never completed from the UI** (verified: CycleCountsTab only displays
  `completed_at`).
- `PUT /api/shifts/:id/variance-approve` (shifts.js:246) — shift variance approval unreachable.
- `POST /api/draft-orders/:id/claim` + `/complete` (draft-orders.js:217/245, both E2E-tested).
- `POST /api/member-kiosk/lookup` (member-kiosk.js:53) — the kiosk page calls `/check-in` only.
- `POST /api/restaurant/checks/:id/print-bill` (restaurant.js:276, E2E-tested).

### 10. Notable singles (grouped)
- **Security/admin actions with no button**: `POST /api/employees/:id/revoke-token`
  (employees.js:262), `POST /api/customers/:id/wallet/topup-link` (customers.js:843 — payment-link
  generation), `POST /api/members/:id/assign-code` (members.js:111).
- **Analytics/intelligence built headless**: `GET /api/batches/drift` + `/cost-flow`
  (batches.js:103/118), `GET /api/backorders/suggestions` (:93), `DELETE/POST
  /api/product-affinities/*` (item-suggestions.js:110/121), `GET /api/hr/leave/schedule-conflicts`
  (tier4/hr.js:478), `GET /api/reports/schedules/:id/runs` (governance.js:605 — schedule run
  history has no viewer).
- **Photography/projects flows (V08)**: `POST /api/quotations/:id/approve` + `/convert-to-project`
  (projects.js:70/79), `POST /api/customer-invoices/:id/attach-to-project` (:94).
- **Catalog/ops**: `POST /api/price-lists/:id/bulk-items` (products.js:1768), `PUT
  /api/outlet-visibility/bulk` + `GET .../by-outlet/:outletId` (outlet-visibility.js:57/76),
  `POST /api/orders/:id/transactions` + `/fulfillments` (orders.js:563/607), `POST
  /api/modifiers/attach` + `DELETE /api/products/:id/modifier-groups/:groupId` (modifiers.js),
  `DELETE /api/products/:id/media/:mediaId` (orders.js:225), `GET /api/print/status`
  (printer.js:38), `POST /api/loyalty/customers/:id/adjust` (loyalty.js:116 — manual points
  adjustment; the ledger GET does appear to have a caller).
- **Customer portal**: `GET /api/portal/me/classes` (appointments.js:247) + class waitlist POST
  (:323) — portal members can book classes but the class list/waitlist endpoints are uncalled;
  `POST /api/storefront/orders/:orderToken/pay` (storefront.js:1031 — online payment for
  storefront orders has no page invoking it).
- **Attendance**: `POST /api/attendance/:id/checkout` (attendance.js:737) — kiosk uses the PIN
  endpoints instead.

### 11. Documentation contradiction worth deciding
`POST /api/auth/kiosk-login` (auth.js:616) has **zero frontend callers**, yet CLAUDE.md documents
it as the kiosk login. The kiosk pages authenticate differently (PIN endpoints with `?tenant=`).
Either the endpoint is legacy (delete + fix docs) or the kiosk was supposed to use it (wire it).

## Tier 2 — Headless by design (no action needed, 19 endpoints)

External callers, not UI: all `/api/webhooks/*` (xpay HMAC, Meta, WhatsApp, Daraz + generic),
`POST /api/integrations/shopify/webhooks/orders-create`, sandbox gateway endpoints
(`/api/sandbox/pay|tokenize|charge-saved|simulate-webhook` — sandbox-mode only),
`GET /api/public/bookings/employee-feed.ics` (calendar subscription URL), public booking
deposit-intent/waitlist-claim (reached from links in emails/SMS). Listed for completeness.

## Tier 3 — Legacy/superseded (candidates for deletion, not surfacing)

- `POST /api/email/send-receipt` (email.js:123) — superseded by `/api/email/send-receipt-v2`,
  which is what the POS email modal calls.
- `PUT /api/feature-flags/:key` (registerAllRoutes.js:431) — deliberately retained for Bucket D /
  sub_toggle writes (v1 Business Modules decision) but no tenant UI calls it anymore. Keep
  (admin/tests use it) — documented decision, not an accident.
- `POST /api/action-history/log` (receipt-templates.js:194 — odd home for it, too) — no caller.

## Other layers — details

- **Unreachable pages**: only `POSApprovalModal.jsx` (see Tier 1 #5). The 8 reports pages that
  initially flagged were false positives (`export … from` re-exports, now handled by the scanner).
- **Gated-off features**: none. All 106 flags are reachable; every mode/preset/card checks out.
  The v1 catalog test prevents regressions here permanently.
- **Nav/deep-link routes**: 73 route paths lack a statically-detectable link, but most are nested
  children (admin/portal sidebars link absolute paths; children register relative) or deliberate
  URL-entry surfaces (`/receipt/:invoiceNumber`, `/menu/:token`, `/pay/:token`, `/member-checkin`,
  `/customer-display`, `/book/:tenantSlug`). Worth one manual eyeball each: `/retail/home`,
  `/shopcast`, `/custom-fields`, `/adoption`, `/invoice-paid`, `/module-locks` — confirm each has
  a live entry point in its surface's nav.
- **Hidden capabilities inside pages** (gap type 4): the Tier 1 domain narratives ARE this class
  at endpoint granularity (page exists, action missing). A deeper field-level pass (response
  fields the UI drops) was out of scope for the automated pass.

## Method + limitations (for re-running)

Scanner: extracts all `app|router.<verb>()` routes (incl. cross-file mounts for
`routes/integrations/*`, setup, country-packs), all `api.*`/`fetch`/`adminFetch` calls plus every
path-like string literal, normalizes `${…}`/`:param` to wildcards, and cross-matches. Candidates
with no match are triaged by fragment search (`/<segment>` + domain co-occurrence) to catch
dynamically-built paths, and against `frontend/tests/` to mark E2E-only usage. Limitations:
purely static — paths assembled from variables in multiple statements can false-positive as
"dead" (mitigated by the fragment pass + manual sample verification of ~12 borderline cases, all
of which held up); conversely a coincidental fragment can hide a true orphan (sampled: found one —
loyalty `adjust`, included above). Confidence on the 78: high for the domain clusters, medium for
singles — spot-check in the browser before acting on any individual deletion.

## Recommended next step (owner decides)

The 78 split roughly into: **surface it** (the vertical-depth clusters #1–#8 — real merchant value
already built, UI is the missing 20%), **decide the flow** (#9 workflow dead-ends — either wire the
button or accept the flow as manual/automatic), **delete** (Tier 3 + kiosk-login if legacy), and
**leave headless** (Tier 2). If you want to act on this, the natural follow-up is a small
remediation plan per cluster (each is one page's worth of UI work consuming already-tested
endpoints) — say the word and I'll draft it in the usual plan format. This audit did not modify
any code; `scan.cjs` + `matrix.json` stay in this folder for re-runs after future waves.

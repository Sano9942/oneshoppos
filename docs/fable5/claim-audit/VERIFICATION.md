# Claim Audit — Live Browser Verification (2026-07-08)

Follow-up to the code-derived audit in `README.md`/`MATRIX.md`/`LEAKS.md`. That audit resolved
"what renders" from API responses + gating-logic evaluation, not by loading the UI. This pass
drove the actual local frontend (`localhost:5173` against local Postgres `sanopos_dev`) to get
visual/API-level proof for the three highest-value leaks, plus a report-number reconciliation
that wasn't in the original scope.

## 1. Dental chart on veterinary tenant — CONFIRMED (screenshot)

Logged into `golv_veterinary` (Owner/1234), created a test patient + treatment plan, opened the
**Chart** tab. Default view is a 32-tooth human dental chart (Caries/Restoration/Crown/Root
Canal/Extraction/Missing/Implant/Gingivitis legend) — on a veterinary tenant, with a "Vet
(Canine)"/"Vet (Feline)" option sitting unselected in the same dropdown.

Root cause confirmed in code: `frontend/src/pages/redesign/TreatmentPlansRedesign.jsx:816` —
`ChartPanel` hardcodes `useState("dental_adult")` on every mount, ignoring
`clinical_config.chart_preset`.

## 2. Orphaned Clinical reports / restaurant-group leak — CONFIRMED (live, two tenants)

- `golv_veterinary` → Reports page footer literally reads *"44 reports across sales, customers,
  finance, hr, governance."* No Clinical group exists, despite the tenant having active
  treatment plans.
- `golv_butcher` → Reports page shows a **Restaurant** group with **KDS Analytics** and **Menu
  Engineering** tabs (*"76 reports across ... restaurant."*). Opening KDS Analytics shows "Feature
  disabled: phase4_restaurant_kds_analytics" — the tab renders even though the flag is off,
  because the report *group* isn't gated by preset at all, only individual routes are
  flag-gated.
- Bonus finding not in the original LEAKS list: `golv_general_retail` **also** gets the
  Restaurant group (76 reports, same as butcher) — the retail-spine-never-subtracted pattern
  applies to plain general retail too, not just butcher/grocer.

## 3. Dead portal tab — CONFIRMED (live API + code cross-check)

`GET /api/portal/config?tenant=golv_gym` → `enabled_tabs` includes `"subscriptions"`, with
`portal_labels.subscriptions_tab = "My Memberships"`. Cross-checked against
`frontend/src/routes/publicRoutes.jsx:236-254` — the customer-portal route tree has no
`<Route path="subscriptions">` (only invoices/appointments/treatments/forms/stays/packages/
orders/loyalty/wallet/profile/gallery). The nav renders "My Memberships" linking to a path with
no matching route. Same mechanism confirmed for `contracts` (rentals) and `tickets` (repair) via
`backend/routes/customer-portal/data.js:30-42` (`TAB_FEATURE_FLAGS`).

## 4. Report-number reconciliation — mostly correct; one local-dev-only bug found

**Method:** on `golv_general_retail`, recorded the pre-existing baseline (3 seeded sales,
`total_amount` sum = $9,598.00, confirmed via `GET /api/sales`), then rang up a controlled POS
sale (3× "Backpack (Sample)" @ $2,500.00, no discount, no tax — tenant `tax_mode` is `none`) for
an exact, known $7,500.00 cash sale. Expected new totals: **$17,098.00** overall revenue,
**4 units / $10,000.00** for that one SKU.

- **Sales Summary, full date range** (`date_from=2026-07-01&date_to=2026-07-09`): `total_revenue
  = 17098` — exact match. ✅
- **Item Wise** (same range): Backpack (Sample) `units_sold: 4.000, revenue: 10000.00000` —
  exact match. ✅
- **Sales Summary, `date_to` = today** (`date_from=2026-07-01&date_to=2026-07-08`, i.e. the
  natural "up to and including today" query a user would type): `total_revenue = 9598` — **the
  new sale is silently dropped.** Isolated further: `date_from=2026-07-08` alone (no `date_to`)
  incorrectly *includes* the prior day's sales too. Both directions are wrong by exactly 5 hours
  — the tenant's UTC offset.

**Root cause, confirmed via direct SQL:** `backend/utils/tz.js`'s `toUtcStart`/`toUtcEnd` compute
correct UTC boundary strings (e.g. `"2026-07-08 19:00:00"` meant literally as UTC), but every
report query interpolates that naive string against a `timestamptz` column with no explicit `Z`/
`+00` suffix. Postgres casts a bare-string literal to `timestamptz` using the **session's**
`TimeZone` GUC, not UTC. On the local dev database the session `TimeZone` is `Asia/Karachi`
(`SHOW TIME ZONE` confirmed), so `"2026-07-08 19:00:00"` gets cast as 19:00 **PKT** = 14:00 UTC —
a silent 5-hour shift, exactly matching the observed exclusion boundary.

**This is not currently a production bug** — checked directly against Supabase
(`SELECT current_setting('timezone')` → `UTC`) via the Supabase MCP tool, read-only. Because the
production session timezone is UTC, the naive-string cast happens to land on the intended
boundary there. But the code has an undocumented, unenforced assumption (session `TimeZone =
UTC`) baked into every date-range report filter across `routes/reports/*` — if that ever changes
(a different Postgres host, a future `ALTER DATABASE ... SET timezone`, a self-hosted
deployment), every date-filtered report would silently mis-bucket by the tenant's UTC offset with
no error. Fix: cast explicitly, e.g. `toUtcStart/toUtcEnd` should emit an ISO string with a `Z`
suffix (or the query should use `::timestamptz 'UTC'` style casts) instead of a naive
`"YYYY-MM-DD HH:MM:SS"` string — never rely on session `TimeZone` matching UTC implicitly.
Flagged as a hardening item, not a live-data-accuracy incident.

## What this does and doesn't cover

- Verified 3 of 5 leaks visually/live; the other 2 (KDS/Menu-engineering-vs-restaurant-inversion,
  FBR-flag-dropped) were already confirmed via live endpoint reads in the original audit pass and
  weren't re-driven in a browser here.
- Reconciliation covered one retail-spine tenant, one SKU, one date-range edge case — not a
  systematic sweep of every report type or every vertical's report math.

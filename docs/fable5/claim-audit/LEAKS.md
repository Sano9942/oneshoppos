# Leaks, Mislabels, Missing & Drift — ranked, with fix locations

Every item points to a tool result gathered this session (config read, fresh local signup + login,
read-only prod read, or a driven behavior flow) and names the file responsible for the fix. Severity:
**LEAK** (another industry's surface here) > **MISSING** (should have, doesn't) > **MISLABELED** >
**DRIFT**. 2026-07-08, main @ v126. Findings only — nothing was changed.

The five worst were independently re-confirmed by a fresh-context verifier against live local logins
(see § Verification at the end).

---

## Top 5 worst leaks (ranked)

### #1 — LEAK · Clinical `chart_preset` ignored: veterinary & physiotherapy get a DENTAL tooth chart
**This is the canonical "does a butcher get dental charting" failure — landing on vet/physio.**
`frontend/src/pages/redesign/TreatmentPlansRedesign.jsx:373-374` hardcodes
`api.get("/api/chart-areas", { preset: "dental_adult" })` with the comment *"Default to dental_adult;
user/preset could override"* — it never reads the tenant's `clinical_config.chart_preset`
(`dental_clinic`→`dental`, `veterinary`→`vet_body`, `clinic`/`physiotherapy`→`body`, per
`backend/config/industry-config.js:180,624,664,703`). A veterinary or physiotherapy clinic opens a
treatment plan and the charting view loads **human adult tooth positions**. Verified by direct file
read + the behavior walkthrough (dental charting worked precisely because dental is the accidental
default).
**Fix**: `TreatmentPlansRedesign.jsx:372-377` — read `chart_preset` from `usePreset()`/bootstrap and
pass it to `/api/chart-areas` (the backend already serves `vet_body`/`body` area sets).

### #2 — LEAK + MISSING · Restaurant analytics shown to butchers, hidden from restaurants
`frontend/src/pages/Reports.jsx` GROUPS include `"Restaurant"` (line 564 — **KDS Analytics** + **Menu
Engineering**), `"Multi-Channel"` (:558) and `"Procurement"` (:510). **No preset's
`visible_report_groups` lists any of these labels.** Filtering (`Reports.jsx:804`) shows a group only
if its label is in the preset array, and `null` shows *all* groups. So the six null-group presets —
general_retail, grocery, wholesale, butcher, sweet_shop, textile — see KDS Analytics and Menu
Engineering, while `restaurant` (`industry-config.js:53`) and `cafe` (`:138`) explicitly omit
`"Restaurant"` and **never see their own analytics**. Same inversion loses Procurement reports for
restaurant/cafe/repair_shop. Verified: grep of GROUPS labels + all 23 presets' arrays.
**Fix**: add `"Restaurant"` to the `restaurant`/`cafe` `visible_report_groups`
(`industry-config.js:53,138`); add per-tab `mode`/`flag` guards to `kds-analytics`/`menu-engineering`
in `Reports.jsx:564-568`; decide null-group semantics so retailers stop inheriting F&B analytics.

### #3 — MISSING (all tenants) · The entire Clinical report group is orphaned
`clinic`, `dental_clinic`, `veterinary`, `physiotherapy` all list `"Clinical"` in
`visible_report_groups` (`industry-config.js:177,622,661,700`), but **`Reports.jsx` GROUPS has no
group labeled `"Clinical"`** (verified: zero grep matches for a Clinical label) and
`frontend/src/pages/reports/ClinicalTab.jsx` is **never imported** anywhere (verified). The group
filter matches nothing → clinical tenants get *no clinical reports at all* in the UI, and
`/api/reports/clinical/*` is unreachable from the reports surface. `reports/CLAUDE.md` claiming it's
wired is stale.
**Fix**: add a `{ label: "Clinical", tabs: [...] }` group to `Reports.jsx` GROUPS and import/wire
`ClinicalTab.jsx` (gate on `treatment_plans` mode).

### #4 — MISSING (flagship) · Dead portal tabs for gym, repair, and all four rental presets
`PORTAL_ENABLED_TABS_BY_PRESET` promises `subscriptions` (gym, labeled "My Memberships"), `tickets`
(repair_shop, "Repair Tickets"), and `contracts` (car_rental/equipment_hire/furniture_rental/
party_supplies, "Rental Agreements" etc). Their flags are ON, so `/api/portal/config` returns them
(verified live: `claimauditgym` → `enabled_tabs` includes `subscriptions`) and `PortalLayout.jsx`
renders the nav item (`:150-167`, `TAB_PATHS[tab] || tab` falls back to the raw key). But
**`publicRoutes.jsx:236-254` has no route** for `subscriptions`/`contracts`/`tickets` and no
`PortalSubscriptions`/`PortalContracts`/`PortalTickets` component exists — the click lands on an empty
`<Outlet>`. For six industries the portal's flagship tab is a dead link. (Confirmed-present tabs:
treatments, stays, packages, gallery, forms, appointments, invoices, orders, loyalty, wallet,
profile.)
**Fix**: build the three portal pages + routes in `publicRoutes.jsx`, or remove the tabs from those
presets' `PORTAL_ENABLED_TABS_BY_PRESET` until built.

### #5 — MISSING (all tenants) · FBR Invoices dashboard invisible to everyone, despite the flag being ON
`GET /api/feature-flags` (`backend/routes/registerAllRoutes.js:385-406`) builds its response by
iterating `Object.keys(DEFAULT_FEATURE_FLAGS)` and merging DB rows *only for those keys* — any DB
flag **not** in `DEFAULT_FEATURE_FLAGS` is dropped. `fbr_integration` is deliberately not in defaults
(it's seeded ON by the PK country pack, `config/country-packs.js:25`), so it never reaches the
frontend flag map. The sidebar "FBR Invoices" item (`nav-config.js:259`, `requiredFlag:
"fbr_integration"`) is therefore hidden for **every** tenant, and `/fbr` is unreachable from nav —
even though every PK tenant has the flag ON in the DB (verified: fresh captures show the API response
lacking the key while the DB row is `enabled=true`). Cruelly compounds #integrations-8 (FBR failures
are only discoverable on that unreachable dashboard).
**Fix**: `registerAllRoutes.js:385-406` — union the DB rows with the defaults (include DB-only keys),
not just iterate defaults.

---

## Other LEAKs

### L-6 · Retail spine is never subtracted for service industries (structural)
Nav derivation across all 23 fresh tenants (mirroring `AppLayoutRedesign` gating): modes only *add*
sidebar groups; nothing retail is ever removed. A dental clinic, hotel, salon, and car-rental all
see full **Catalog** (Products/Categories/Brands/Attribute Sets/Promotions/Price Lists/Smart
Collections/Scheduled Changes), **Inventory** (Audit/Adjustments/Transfers/Reorder Alerts),
**Procurement** (Suppliers/POs/Supplier Returns/Payables), **Fulfillment**, **Online Store → View
Storefront** (zero guards, `nav-config.js:152-157`), **CRM/Quotations**, full double-entry
accounting, Barcode Templates, and Import-from-Shopify/Square. The reports surface *hides* Inventory
for these presets while the sidebar *shows* it — internally inconsistent. Storefront itself is
preset-blind (`routes/storefront.js:33-56` returns no industry/labels; hardcoded currency "PKR").
**Fix**: `nav-config.js` needs `business_model`-aware exclusions (e.g. hide Catalog/Inventory/
Procurement for pure service/lodging/clinical models), and `AppLayoutRedesign` must honor them.

### L-7 · Storefront + public QR menu are not industry/mode gated
`routes/storefront.js` serves the same product-grid storefront to every industry with no service-
industry gate, and the sidebar entry is ungated (L-6). `routes/public-restaurant.js:94` serves the QR
menu with no `requireMode("restaurant")` — protection is only implicit at kiosk-token issuance.
**Fix**: gate the storefront nav item + config by `business_model`; add `requireMode` to the public
menu route as defense-in-depth.

---

## MISLABELED

### M-8 · Generic retail vocabulary bleeds onto specialized screens
- `DashboardTopProducts.jsx:31` — rows read "**N sold**" under a preset-translated heading ("Top
  Services Today" for salon, "Top Menu Today" for restaurant) — "sold" reads wrong for clinics/salons.
- `PortalOrders.jsx:56,102` — body says "Order history" / "Order #" hardcoded even though the *tab*
  is renamed per preset.
- Portal `forms` tab shows the raw key `"forms"` as its label (`PortalLayout.jsx:6-20,151` — no
  `TAB_LABEL_KEYS` entry). Portal "Dashboard" tab label hardcoded (`:148`).
- POS hardcodes "Sell", "Complete Payment", "Total Due", "Search by Barcode/SKU/Price" regardless of
  preset (`POSSubHeader.jsx:58`, `POSCheckoutModal.jsx:250,264`, `POSSearchArea.jsx:46-48`).
- Breadcrumbs translate only Customer/Product substrings (`ui/Breadcrumbs.jsx`).
- Lodging quirk: two different sidebar items both render as "Rooms" (translated Catalog→Products vs
  the real Rooms group) — `AppLayoutRedesign.jsx:87-107` translation collides with the Rooms group.

**Positive**: sidebar nav *is* vocabulary-translated (`AppLayoutRedesign.jsx:87-107` swaps
Customer(s)/Product(s)/Sales History/Parked Sales → butcher "Cuts", hotel "Rooms", wholesale "Invoice
History"), and POS cart/receipt/customer labels, dashboard headings, portal tab labels, and public
booking labels all adapt correctly. Vocabulary is the *strongest* part of the reshaping.

---

## MISSING (non-leak internal gaps)

### N-9 · `dashboard_widgets` config is largely decorative
Only `inventory_alerts` is honored (`DashboardRedesign.jsx:252`). `appointments_today` (all booking
presets), `active_treatment_plans` + `overdue_sessions` (clinical), and `floor_plan` (restaurant)
have **no consumer** — the industry dashboards the presets advertise don't exist. `top_products`/
`trends`/`attendance` render for everyone regardless. Dead path: `hasMode("retail")` gates
StaffOfDay/CashPosition (`:65,208-213`) but no preset declares a `"retail"` mode → those cards flash
during load then vanish for every tenant.
**Fix**: consume the widget flags in `DashboardRedesign.jsx`; add the missing clinical/booking widgets
or drop the config keys; remove the dead `retail` mode gate.

### N-10 · `counter` POS layout silently degrades outside restaurant mode
`counter` is a real distinct layout only inside the restaurant shell (`RestaurantCheckView.jsx:24-49`).
`cafe` is safe only because it carries `restaurant` mode. For any hypothetical non-restaurant preset
set to `counter`, `POSSearchArea.jsx:100`'s binary ternary falls back to grid.
**Fix**: acceptable today; note the coupling if a counter preset is ever added without restaurant mode.

---

## DRIFT

### None.
Three-way compare (config-resolved vs 23 fresh local signups vs 23 prod `golv_*` tenants) found
**zero** mode or flag diffs across all 23 industries (`threeway.json`). The seeding pipeline —
`routes/setup.js` mode/flag/extra-flag seeding + `services/retail-flag-preset.js` bundles + PK country
pack — is consistent between current code and every tenant seeded on 2026-07-07. The reshaping bugs
are entirely in the *rendering* layer, not in seeding.

---

## Hardening finds surfaced during behavior flows (not leaks, but real)

- **Unaudited credit-limit override** (`sales.js:1332-1336`): an `all_access` holder pushes exposure
  to 160% of a `hard`-blocked credit limit and gets a plain 200 with `creditWarning: null` and **no
  `approval_events` row** — the manager-PIN path (`:1356-1372`) writes one, the perm path writes
  nothing. Asymmetric audit on a credit control. **Fix**: log an approval/override event on the perm
  path too.
- **`customers.balance` stays 0** while AR lives solely in `customer_invoices.balance_due` — anything
  reading `customers.balance` as exposure is wrong.
- **Rental invoice deposit math** (`rental-service.js` ~710): `balance_due` is netted by the deposit
  but `amount_paid` stays 0 and no payment row is written → `amount_paid + balance_due ≠ total`,
  contradicting the code's own comment.
- **Overdue rentals free availability** (`rental-service.js:502` checkout does no availability
  re-check) → a unit still out overdue can be re-contracted.
- **`chart_area` codes unvalidated** (`schemas/treatment-plans.js` + `treatment-plan-service.js:765`)
  — bogus area codes persist; clinical chart correctness is UI-enforced only.

---

## § Verification

The five worst (#1–#5) were re-checked by a fresh-context verifier subagent against live local
logins + code reads. **All five CONFIRMED:**

- **#1 chart_preset dental leak — CONFIRMED.** Live `/api/chart-areas` returns `dental_adult`=32 tooth
  areas vs `body`=15 vs `vet_body`=0; `TreatmentPlansRedesign.jsx:373-374` hardcodes `dental_adult`.
  **Two adjacent gaps found while confirming:** (a) `vet_body` has **0 seeded chart areas** in the vet
  tenant — so even after wiring `chart_preset`, a vet would get an *empty* chart; (b) a naming
  mismatch — `clinical_config.chart_preset` for dental is `"dental"` but the seeded area key is
  `"dental_adult"`, so a naïve pass-through wouldn't match. The fix must map `chart_preset` → seeded
  key AND seed `vet_body`/`body` areas.
- **#2 restaurant analytics inversion — CONFIRMED.** Live bootstrap for `claimauditrestaurant` returned
  the 7-group list without "Restaurant"/"Multi-Channel"; null-group retailers get all 10. Nuance: the
  KDS/menu backend routes are themselves mode-gated, so a retailer clicking the tab would hit an error
  rather than see F&B data — but the *visibility* inversion (tab shown to the wrong industry, hidden
  from the right one) holds.
- **#3 Clinical group orphaned — CONFIRMED.** No "Clinical" label in GROUPS; `ClinicalTab.jsx`
  imported nowhere.
- **#4 dead portal tabs — CONFIRMED.** Live `/api/portal/config`: gym→`subscriptions`,
  repair→`tickets`, car_rental→`contracts`; no matching route in `publicRoutes.jsx:236-254`.
- **#5 FBR flag dropped — CONFIRMED.** `claimauditwholesale` DB has `fbr_integration=true`; the
  106-flag API response omits the key entirely.

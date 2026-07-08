# WS2 — Industry-language claim honesty `P1`

**Model:** Sonnet (2c portal build may want Opus for the initial page architecture). **Branch:**
`fix/ws2-claim-honesty` off `main`. Fully parallel to all of WS1 (never touches the money path).

## Context
From `docs/fable5/claim-audit/` (README, LEAKS, MATRIX, VERIFICATION). Seeding is CLEAN (zero drift);
every leak here is in the RENDERING layer. Makes the "reshapes the dashboard, reports, portal"
marketing honest. Follow the Always-Square design rule: reuse `ui/primitives` + `--ui-*` tokens, never
raw colors.

## Verify first
Three of these were browser-verified 2026-07-08 (see `VERIFICATION.md`). Re-confirm each on `main @
v126` before editing — the frontend CLAUDE.md is known to drift on page locations.

## Task

### 2a — chart_preset (three parts)
`TreatmentPlansRedesign.jsx:816` (`ChartPanel` `useState("dental_adult")`) + `:373-374` hardcode dental,
ignoring `clinical_config.chart_preset`. Vet/physio get a human tooth chart.
- read `chart_preset` from `usePreset()`/bootstrap
- MAP it to the seeded area key (`"dental"` ≠ seeded `"dental_adult"` — a naïve pass-through won't match)
- SEED `vet_body`/`body` chart areas (vet has 0 → empty chart even after wiring; backend already serves
  `body`=15 areas)
- validate `chart_area` codes server-side (`schemas/treatment-plans.js`, `treatment-plan-service.js:765`)

### 2b — Reports surface
- Add a `{ label: "Clinical", tabs: [...] }` group to `Reports.jsx` GROUPS + import/wire the dead
  `reports/ClinicalTab.jsx`; gate on `treatment_plans` mode. (4 clinical presets list "Clinical" —
  `industry-config.js:177,622,661,700` — but the label doesn't exist in GROUPS.)
- Add `"Restaurant"` to `restaurant`/`cafe` `visible_report_groups` (`industry-config.js:53,138`); add
  per-tab mode/flag gates to KDS-Analytics + Menu-Engineering (`Reports.jsx:564-568`); fix null-group
  semantics so butcher/grocer/textile/sweet_shop/retail/wholesale stop inheriting F&B analytics.

### 2c — Portal pages — BUILD (decision: build all 3)
Build `PortalSubscriptions` / `PortalContracts` / `PortalTickets` + routes in
`publicRoutes.jsx:236-254`. Tabs are served + rendered but dead-end today: gym `subscriptions`
("My Memberships"), repair `tickets`, 4 rentals `contracts`. Data source: `TAB_FEATURE_FLAGS`
(`customer-portal/data.js:30-42`) + the relevant portal data endpoints. Reuse existing portal pages
(treatments/stays/packages) as the one reference for layout + auth pattern.

### 2d — FBR globalization + flag union (revised scope — read PLAN.md §WS2d)
Model = **availability (country pack) vs activation (merchant opt-in)**. Minimal gating only; leave the
generic tax step alone.
- Union DB flag rows into `GET /api/feature-flags` — `registerAllRoutes.js:385-406` currently iterates
  `DEFAULT_FEATURE_FLAGS` keys only, dropping DB-only `fbr_integration`. KEEP it out of
  `DEFAULT_FEATURE_FLAGS`; union DB rows in. (Unhides FBR nav for PK.)
- Gate compliance seeding on opt-in — `setup.js:330-338` seeds `compliance_features` unconditionally,
  ignoring `is_gst_registered`. A non-GST PK merchant is promised "FBR off" (`SetupWizard.jsx:637-639`)
  but gets `fbr_integration=true` and enqueues to FBR (`sales.js:2296-2298`). Only seed PK compliance
  features when `is_gst_registered === true`.
- Verify all FBR surfaces gate on the flag (nav `nav-config.js:259`, `/settings/fbr`, `/fbr`, reports
  FBR export, sale/return/void enqueue), AND that a PK merchant who skipped opt-in can still reach
  Settings → FBR to activate later. US/global merchant: empty compliance_features → no flag → nothing,
  by construction.

### 2e — Dashboard widgets
`DashboardRedesign.jsx:252` honors only `inventory_alerts`. Consume `appointments_today`,
`active_treatment_plans`, `overdue_sessions`, `floor_plan` OR drop the config keys. Remove the dead
`hasMode("retail")` gate (`:65,208-213`) that flashes StaffOfDay/CashPosition for everyone.

### 2f — DEFER (do not do here)
L6 retail-spine subtraction, L7 storefront/QR gating, M8 vocabulary mislabels — separate scoping,
larger. Note them, don't build.

## Verify the fix
Drive the local frontend (preview tools / Playwright): log into `golv_veterinary` → Chart shows a vet
chart not dental; `golv_veterinary` Reports shows a Clinical group; `golv_butcher` Reports no longer
shows Restaurant/KDS; `golv_gym` portal "My Memberships" loads a real page; a PK GST-registered signup
shows the FBR nav item; a non-GST PK signup does not seed `fbr_integration`.

## Commit & push (REQUIRED)
Commit per sub-task (2a/2b/2c/2d/2e), push `fix/ws2-claim-honesty`. No PR. Co-Authored-By trailer.

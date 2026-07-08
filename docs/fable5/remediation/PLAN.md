# Remediation Plan — platform-audit → fixes

**Derived:** 2026-07-08 · **From:** `docs/fable5/claim-audit/` (5 files) + `docs/fable5/core-research/` (5 files)
· **Against:** main @ v126 · **Status:** PLANNING ONLY — no code changed yet.

This plan sequences every finding from both audit bundles into dispatchable workstreams, collapses the
items that appear in **both** audits under different names, and folds in the FBR-globalization decision
taken 2026-07-08 (compliance is a country-pack capability; minimal wizard gating).

Dispatch prompts live in `./prompts/`. Each is a self-contained session. Per house rule, every prompt
carries an explicit **commit instruction** and a **verify-prod-state-first** step.

---

## Duplicate map — fix once, not twice

Six findings are the same bug counted in both bundles. The owning workstream is authoritative:

| Fix | claim-audit id | core-research id | Owner |
|---|---|---|---|
| clinical `chart_preset` → dental leak | #1 / L-1 | V1 | WS2a |
| FBR flag dropped from `/api/feature-flags` | #5 / D-3 | A7 | WS2d |
| Unaudited credit-limit override | Hardening | V2 | WS1d |
| `customers.balance` never updated (AR truth) | Hardening | V3 | WS1d (note only) |
| Rental invoice deposit math invariant | Hardening | V4 | WS5 |
| Overdue rental frees availability | Hardening | V5 | WS5 |

Four items already sit in project memory as open follow-ups — **verify current prod state before
touching** (some may be partially addressed): H7 quotation-convert oversell (`cross_surface_traps_plan01`),
L1 attendance UTC (`F06 clock-in trap`), report date-boundary TZ (`report_date_boundary_tz_bug` —
confirmed **local-dev only, NOT prod**), reservations availability TZ.

---

## Workstreams & sequencing

```
WS1  Money & stock hardening        P0  ── launch blocker
     1a stock helper + retrofits    (serial; gates 1a's own callers)
     1b sales money path            (parallel with 1c/1d once 1a lands)
     1c returns money path
     1d adjacent writers
WS2  Industry-language honesty      P1  ── rendering layer, fully parallel to WS1
     2a chart_preset  2b reports  2c portal pages  2d FBR globalization  2e dashboard widgets
WS3  Integrations connectivity      P2
WS4  Auto-stock-entry (Phase 1)     feature track, separate cadence
WS5  Low-priority hardening         cleanup, batch anytime
```

**Recommended order:** WS1a first (serial) → WS1b/1c/1d + all of WS2 in parallel → WS3/WS5 batched →
WS4 on its own track once `ANTHROPIC_API_KEY` is set on Railway.

---

## WS1 — Money & stock hardening `P0`

core-research's verdict: *launch-grade in structure, NOT in money-path hardening.* The POS sale path was
locked (`FOR UPDATE`, credit re-check, gift-card lock) and its siblings were not. Fix the siblings.

### 1a — Shared stock helper + retrofit (`prompts/WS1a-stock-helper.md`)
Build `decrementStock/incrementStock(client, …)`: 3-table write (`outlet_stock` +
`variant_outlet_stock` + `product_variants.stock`) + `FOR UPDATE` + `WHERE quantity ≥ qty` + batch
ledger. **Then** retrofit the unlocked writers onto it:
- H7 quotation-convert oversell — `tier4/crm.js:724-727` (bare decrement, code comment admits the gap)
- M3 inventory transfer oversell — `inventory.js:96-133`
- M6 supplier-return variant drift — `supplier-returns.js:92-102` (only touches `product_variants.stock`)
- M7 PO-receive + stock-count variant blindness — `purchase-orders.js:428-433`, `inventory.js:599-621`
- M1 void double-restore race — `sales.js:338-341,355-357` (add `AND (voided IS NULL OR voided=false)`)

Sequencing: helper lands first; retrofits reference it. Keep in ONE session (serial dependency).

### 1b — Sales money path (`prompts/WS1b-sales-money.md`) — `sales.js`
- H1 server-authoritative pricing via `resolvePriceForContext` — `sales.js:1181-1190` (client-trusted
  total; POS uses a different pricing engine than storefront/quote/field — `services/quote.js:173`,
  `field.js:78`). Resolve price server-side, validate client total within tolerance.
- H2 add tax in exclusive mode — `sales.js:1181` vs `services/tax-snapshot.js:181` (`taxTotalSnapshot`
  never added; exclusive-mode tenants under-collect GST).
- H3 loyalty redemption — `sales.js:585,1189,2031-2035` (no balance check, no `FOR UPDATE`, hardcoded
  1:1). Add `SELECT … FOR UPDATE`, assert `points_redeemed ≤ balance`, clamp total ≥ 0, configurable
  point value.
- H4 wallet tender TOCTOU — `sales.js:1237-1247` (read) / `:2210-2222` (debit). Lock + re-check inside tx.
- L5 split/cash tender coverage — `sales.js:1271-1289` (only Credit enforces Σpayments ≥ total).

### 1c — Returns money path (`prompts/WS1c-returns-money.md`) — `returns.js`
- H5 refund cap — `returns.js:458,493` (only qty guarded; `total_refund`/`refund_price` uncapped).
  Enforce `refund_price ≤ line price` and `total_refund ≤ remaining refundable`.
- H6 `store_credit` no-op — `returns.js:43,84,601` (advertised, never credits the wallet; store keeps
  goods AND money). Implement as wallet increment inside the return tx.
- M2 double-refund race — `returns.js:224-283` (qty check outside tx, no lock).

### 1d — Adjacent writers (`prompts/WS1d-adjacent-writers.md`)
- M4 commission idempotency — `services/commission-calc.js:36-43` (bare INSERT; auto-hook
  `sales.js:2395` + manual `commissions.js:228` double-pay). Add `ON CONFLICT`/pre-delete.
- M5 PO partial-receive — `purchase-orders.js:397-461` (status→Received unconditional; supplier
  invoice uses full `po.total_cost` outside tx in silent try/catch). Keep PO open, bill received qty.
- M8 transfer-points wrong ledger — `customers.js:953-962` (loyalty transfer writes wallet ledger).
- M9 subscription dunning predicate — `workers/subscription-grace-worker-boss.js:74-80`
  (`EXISTS…ORDER BY…LIMIT` no-op flags any-ever-unpaid; cuts off paying subscribers).
- V2 credit-override audit asymmetry — `sales.js:1332-1336` (perm path writes no `approval_events`
  row; PIN path `:1356-1372` does). Log the override on the perm path too.
- V3 note: `customers.balance` stays 0 while AR lives in `customer_invoices.balance_due` — no fix,
  document the invariant so no future consumer reads `customers.balance` as exposure.

---

## WS2 — Industry-language honesty `P1` (`prompts/WS2-claim-honesty.md`)

All rendering-layer; **seeding is clean (zero drift)**. Never touches the money path — fully parallel
to WS1.

### 2a — chart_preset (three parts, not one)
`TreatmentPlansRedesign.jsx:816` (`ChartPanel` `useState("dental_adult")`) + `:373-374` ignore
`clinical_config.chart_preset`. Vet/physio load a human dental chart.
- (i) read `chart_preset` from `usePreset()`/bootstrap
- (ii) **map** `chart_preset` → seeded area key (`"dental"` ≠ seeded `"dental_adult"`)
- (iii) **seed** `vet_body`/`body` chart areas (vet has 0 → empty chart even after wiring)
- (iv) validate `chart_area` codes server-side (`schemas/treatment-plans.js`,
  `treatment-plan-service.js:765` — currently UI-enforced only)

### 2b — Reports surface (two leaks)
- Add missing `"Clinical"` group to `Reports.jsx` GROUPS + import/wire `reports/ClinicalTab.jsx`
  (dead code today), gate on `treatment_plans` mode. 4 clinical presets currently get zero clinical
  reports (`industry-config.js:177,622,661,700`).
- Fix restaurant inversion: add `"Restaurant"` to `restaurant`/`cafe` `visible_report_groups`
  (`industry-config.js:53,138`); add per-tab mode/flag gates to KDS/Menu tabs (`Reports.jsx:564-568`);
  decide null-group semantics so retailers stop inheriting KDS Analytics + Menu Engineering.

### 2c — Portal pages — BUILD (decision 2026-07-08)
Build `PortalSubscriptions` / `PortalContracts` / `PortalTickets` components + routes in
`publicRoutes.jsx:236-254`. Tabs are served (`/api/portal/config`) and rendered
(`PortalLayout.jsx:150-167`) for gym (`subscriptions`/"My Memberships"), repair (`tickets`), and 4
rental presets (`contracts`) but dead-end on an empty `<Outlet>`. Backing data: `TAB_FEATURE_FLAGS` in
`customer-portal/data.js:30-42`. Largest task in WS2 — real customer-facing pages, each with its own
read path.

### 2d — FBR globalization + flag union (revised scope, decision 2026-07-08)
**Model: availability (country pack) vs activation (merchant opt-in).** The `country-packs.js`
`compliance_features` array is already the correct global spine (PK=`["fbr_integration"]`, all 25
others `[]`). Minimal gating only — leave the generic tax step (name/rate/inclusive/exclusive) alone.
- Union DB flag rows into `GET /api/feature-flags` — `registerAllRoutes.js:385-406` iterates
  `DEFAULT_FEATURE_FLAGS` keys only, dropping DB-only `fbr_integration` (seeded ON by PK country pack,
  `country-packs.js:25`). Keeps it OUT of `DEFAULT_FEATURE_FLAGS` (correct for globalization) and
  unions DB rows in. Unhides FBR nav for PK tenants.
- Gate compliance seeding on merchant opt-in — `setup.js:330-338` seeds every `compliance_features`
  entry unconditionally, ignoring the wizard's `is_gst_registered` toggle. A non-GST PK merchant is
  promised "FBR off" (`SetupWizard.jsx:637-639`) but gets `fbr_integration=true` and every sale
  enqueues to FBR (`sales.js:2296-2298`). Seed PK compliance features only when
  `is_gst_registered === true`.
- Verify every FBR surface gates on the flag (nav `nav-config.js:259`, `/settings/fbr`, `/fbr`
  dashboard, reports FBR export, sale/return/void enqueue) AND that a PK merchant who skipped opt-in
  can still reach Settings → FBR later to activate. A US/global merchant: empty compliance_features →
  no flag → no surfaces, by construction.

### 2e — Dashboard widgets
`DashboardRedesign.jsx:252` honors only `inventory_alerts`. `appointments_today`,
`active_treatment_plans`, `overdue_sessions`, `floor_plan` have no consumer. Also remove the dead
`hasMode("retail")` path (`:65,208-213`) that flashes StaffOfDay/CashPosition for everyone (no preset
declares a `retail` mode). Consume the widget flags OR drop the config keys.

### 2f — Structural (defer within stream, separate scoping)
L6 retail-spine subtraction for service industries (`nav-config.js` needs `business_model`-aware
exclusions; `AppLayoutRedesign` must honor them). L7 storefront/QR mode-gating
(`routes/storefront.js:33-56` preset-blind, hardcoded PKR; `public-restaurant.js:94` no `requireMode`).
M8 vocabulary mislabels (DashboardTopProducts "N sold", PortalOrders body, POS hardcoded strings,
lodging double-"Rooms"). These are bigger and lower-urgency — scope separately.

---

## WS3 — Integrations connectivity `P2` (`prompts/WS3-integrations.md`)

- Security (C2): encrypt courier (`couriers.js:106-115,159-163`) + WooCommerce
  (`woocommerce.js:74-79`) creds (plaintext at rest today); parse courier `config_json`
  (`couriers.js:162,293,414,467` pass raw TEXT → adapters read `undefined`).
- Real inbound (B4): Daraz webhook no-op (`webhooks.js:567-579`), Meta webhook no-op (`:502-511`),
  WhatsApp inbox wrong pool (`:527-556` uses `require("../db-pg")`, every insert silently fails).
- FBR alerting (C5): invalid-token → silent `failed`, no alert/dead-letter
  (`fbr-worker-boss.js:109-134`). Compounds the hidden dashboard (2d).
- Doc drift: `workers/CLAUDE.md`, `services/marketplace/CLAUDE.md` (worker schedules no crons),
  `services/CLAUDE.md` (courier decryption claim false).

---

## WS4 — Auto-stock-entry `feature track` (`prompts/WS4-auto-stock-phase1.md`)

Roadmap in `../core-research/AUTO-STOCK-ENTRY.md`. **Phase 1 only** for now (low-risk UX on the existing
import engine): scan-to-create at POS, supplier-catalog import mapper, fuzzy `pg_trgm` name-match in the
import preview, cost→margin→price rule, GRN name-match. Phase 2/3 (AI invoice parse → moonshot) are
gated on **`ANTHROPIC_API_KEY` set on Railway** (absent today — also silently disables current AI
insights). Set the key regardless.

---

## WS5 — Low-priority hardening `cleanup` (`prompts/WS5-hardening.md`)

L1 attendance TZ (`attendance.js:390-391`), report date-boundary TZ (`tz.js` naive strings vs
`timestamptz` — local-dev only, add `Z`/`::timestamptz 'UTC'`), reservations TZ, L2 insights perm
guard (`insights.js:5`, `insights-ai.js:19`), L9 impersonation revoke check
(`operations.js:~226-237`), L10 ABC worker env verify, L11 dead migration removal
(`inventory.js:10-19`), L6-L8 batch-ledger writers, L3 sale idempotency 409, V4 rental deposit math
(`rental-service.js:~710`), V5 overdue rental availability (`rental-service.js:502`), V6 booking-service
product-type friction, V7 folio bucket columns.

---

## Confirmed-sound (do NOT touch)

Tenant isolation (ALS proxy, no raw-pool leak anywhere in the spine). Portal IDOR protection. bcrypt
PIN/password. Admin impersonation controls (modulo L9). Payment (xPay), FBR sale/return/void chain,
deposit pre-auth, email (Resend), SMS, delivery aggregators (foodpanda/Careem), Shopify orders/create
— all wired end-to-end. Seeding pipeline (zero three-way drift across 23 industries).

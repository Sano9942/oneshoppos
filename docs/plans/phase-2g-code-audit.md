# Phase 2-G — Code Audit

**Date:** 2026-04-20
**Purpose:** For each Tier A + Tier B + Tier C scope candidate from the research synthesis, report schema/route/UI status + gap type + effort estimate based on actual source code.
**Source of truth:** actual code in `backend/schema-pg.sql`, `backend/migrate-pg.js`, `backend/routes/`, `backend/middleware/`, `frontend/src/pages/`, `frontend/src/routes/`.
**Explicit non-source:** CLAUDE.md files were NOT used — they are dated April 16, 2026 and known stale (user memory `feedback_frontend_claude_stale.md`).
**Scope input:** `docs/plans/phase-2g-research-synthesis.md` §Phase 2-G scope candidates (Tier A + B + C).

---

## Summary table (all 19 items)

| Item | Gap type | Effort (days) | Primary blockers | Shared deps |
|------|----------|---------------|------------------|-------------|
| A1 — Omni-input primitive | PARTIAL WORKING | 3d | No barcode-format pattern detection; current UI is substring search only | Triggers B1 variant modal when matched product has variants |
| A2 — Gift cards as tender | ORPHANED ENDPOINTS | 3d | Routes exist in `barcode-expenses.js`, zero POS checkout integration, no feature flag | Shares ledger primitive with A3, B3; tender column on `sale_payments` |
| A3 — Store credit as tender | **ALREADY SHIPPED** | 0d | — | Reference pattern for A2 gift card wiring |
| A4 — Exchange flow | **ALREADY SHIPPED** | 0d | Composite flow in `POSReturnExchangeModal.jsx` | Uses existing sales + returns routes |
| A5 — Manager price override | FULLY MISSING | 5d+ | No schema columns, no route, no UI; `verifyManagerPin()` pattern exists but unused | Shares PIN-verify pattern with C5 training; `override_reason_code` parallels B7 restock reason |
| A6 — Inventory-intelligence hub | PARTIAL + missing hub | 5–7d | No ABC, no cycle-count scheduling, no unified `/retail/inventory-intelligence` route | Absorbs C2 cycle counts + C6 GMROI/sell-through/aging into one hub |
| B1 — Matrix variant grid | ORPHANED ENDPOINTS | 5d | Full schema + routes + admin UI; zero POS picker modal | Depends on A1 (omni-input triggers modal); may stack with B5 serials |
| B2 — Label designer (ZPL/TSPL/EPL) | FULLY MISSING | 8–10d | `barcode_templates` has metadata only (no template body, no printer language); zero designer UI | Reuses printer service; could extend to GRN labels |
| B3 — Loyalty earn+redeem at POS | PARTIAL WORKING | 2–3d | Earn + redeem live; tier `discount_percent` column unused; no ledger/audit table; no feature flag | Shares ledger primitive with A2/A3; shares discount-application pattern with B4 |
| B4 — Customer-group price books | SCHEMA-READY NO AUTO-APPLY | 1–2d | `customer_groups.discount_percent` exists; NOT applied in `sales.js`; no per-product price-book extension | Shares discount-application pattern with B3 |
| B5 — Serialized inventory E2E | PARTIAL WORKING | 5d | Serials table + admin CRUD exist; GRN never creates serials; sales never assigns; returns never reverses; no warranty columns | Wires into GRN + POS checkout + returns flows; may stack with B1 for variant-level serials |
| B6 — Bulk-scan toggle | **ALREADY SHIPPED (default)** | 0d | Increment-on-duplicate is default in `useCart.js:179-215` | — |
| B7 — Per-line restock + reason | PARTIAL WORKING | 2d | `return_reasons` exists + selected per-return; no per-line `restock_flag` or per-item reason override | Shares reason-code pattern with A5 override_reason |
| C1 — Layaway/hold/special-order | FULLY MISSING | 8–10d | No schema (parked_sales is cart-pause only, no deposits); no routes; no UI | May use C3 barcode to recall hold from receipt |
| C2 — Scheduled cycle counts | PARTIAL (one-shot works) | 4–5d | `stock_counts` exists for one-shot; no schedule/zone/recurrence schema | Absorbs into A6 hub |
| C3 — Receipt-barcode return lookup | SCHEMA-READY NO UI | 3–4d | `show_barcode` flag exists but renders plain text; no JsBarcode/Code128; no lookup endpoint | Standalone; complements C1 if holds use barcoded receipts |
| C4 — Staff commissions | PARTIAL WORKING | 4–5d | Full schema + routes + UI shipped (v20); `fixed_per_item` and `tiered` calcs unimplemented; `sale_items.staff_id` (v49) not wired to commission attribution | Shares `earning_type` discriminator with tips (Phase 2-R) |
| C5 — Training role | ORPHANED + MISSING | 5–6d | Roles CRUD is generic; no `is_training` column; no middleware gate; `sandbox.js` is unrelated (payment simulator) | Shares PIN/role-gate pattern with A5 |
| C6 — GMROI / sell-through / aging | PARTIAL (1 of 3 shipped) | 3–4d | Stock aging shipped; GMROI and sell-through fully missing | Absorbs into A6 hub |

**Totals:** 2 already shipped (A3, A4) + 1 shipped-as-default (B6) = 3 items to remove from scope. Remaining 16 items. Sum of lower-bound efforts for remaining 16 ≈ **65–80 days raw**, before dedup via shared primitives (see §Shared dependencies).

---

## Cluster 1 — Tenders & Returns (A2, A3, A4, A5, B7)

### A2 — Gift cards at checkout

- **Schema found:** `gift_cards` table at `backend/schema-pg.sql:732-740` (id, code, initial_value, remaining_value, status, redeemed_at, created_at). No `gift_card_transactions` ledger. Table is in DDL but **not seeded via any migration** — `grep "gift_card" backend/migrate-pg.js` returns 0 matches.
- **Routes found:** `backend/routes/barcode-expenses.js:823-882` — `GET /api/gift-cards`, `POST /api/gift-cards`, `GET /api/gift-cards/:code`, `POST /api/gift-cards/:code/redeem`. Mounted in `registerAllRoutes.js:452`. Permission: `manage_orders`. **No feature flag.**
- **UI found:** `frontend/src/pages/redesign/pos/POSCheckoutModal.jsx` — 0 matches for "gift" (wallet + loyalty are present at line 10+, gift card is not). No gift card balance lookup, no gift card tender option.
- **Gap type:** **ORPHANED ENDPOINTS** — backend routes work but are admin-only CRUD; zero POS checkout integration.
- **Effort:** 3d — checkout lookup + balance check; debit on sale completion; UI for code entry + balance + split-pay.
- **Shared deps:** Ledger primitive (wants `gift_card_transactions` parallel to `customer_wallet_ledger`); `sale_payments` tender column.
- **Verification:** `grep -n "gift_cards" backend/schema-pg.sql` → 1 match line 732; `grep -rn "gift" backend/routes/` → 25 matches (all in `barcode-expenses.js`); `grep -n "gift" frontend/src/pages/redesign/pos/POSCheckoutModal.jsx` → 0; `grep -n "gift" backend/middleware/permissions.js backend/middleware/feature-flags.js` → 0, 0.

### A3 — Store credit as tender

- **Schema found:** `customer_wallet_ledger` table at `backend/schema-pg.sql:324-333` (id, customer_id, type[credit/debit], amount, reference_type, reference_id, note, created_at). Balance is computed from ledger aggregation — no denormalized `wallet_balance` column.
- **Routes found:** `backend/routes/customers.js:465-517` — `GET /api/customers/:id/wallet`, `POST /api/customers/:id/wallet/topup`, `POST /api/customers/:id/wallet/topup-link`. Mounted via `registerAllRoutes.js:472`. Permission: `manage_customers` (write), `view_reports` (read). Ledger entries created on sale completion (`sales.js:950`), points transfer (`customers.js:628,634`), and returns (`returns.js:125-128`).
- **UI found:** `frontend/src/pages/redesign/pos/POSCheckoutModal.jsx:56-60` fetches wallet balance on customer select; lines 159-173 add Wallet tender entry; lines 509-511 display at checkout. `ReturnsRedesign.jsx:38` supports `store_credit` refund destination.
- **Gap type:** **ALREADY SHIPPED.**
- **Effort:** 0d.
- **Shared deps:** **This is the reference pattern A2 gift cards should mirror.** Any Phase 2-G ledger primitive (A2 gift cards, B3 loyalty audit trail) should follow this shape.
- **Verification:** `grep -n "customer_wallet_ledger" backend/schema-pg.sql` → 1; `grep -rn "wallet" backend/routes/customers.js` → 20+.

### A4 — Exchange as distinct flow

- **Schema found:** No dedicated schema; exchange is a composite of (1) sale insert + (2) return insert, run in this order to avoid state inconsistency.
- **Routes found:** Exchange uses existing `POST /api/sales` + `POST /api/returns`. Both mounted, both require `manage_orders`.
- **UI found:** `frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx:28` — `mode` state (`"refund"` default / `"exchange"`). Lines 195-286 wire exchange flow (replacement sale first, original return second). Line 577 button: "Complete Exchange".
- **Gap type:** **ALREADY SHIPPED.**
- **Effort:** 0d.
- **Shared deps:** Uses `return_reasons` table (B7 touches same table).
- **Verification:** `grep -n "mode.*exchange" frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx` → 8 matches; no dedicated backend route needed.

### A5 — Manager price override with PIN at POS

- **Schema found:** **NONE.** `sale_items` schema at `backend/schema-pg.sql:387-402` has id, sale_id, product_id, quantity, price_at_sale, cost_price_at_sale, variant_id, gross_weight, tare_weight, staff_id, seat_number — no `price_override`, no `override_approved_by`, no `override_reason`. `grep "price_override\|override_price" backend/schema-pg.sql` → 0 matches.
- **Routes found:** **No price override endpoint.** `verifyManagerPin()` service pattern exists: `backend/routes/approval-policies.js:114`, `backend/routes/restaurant/void-comp.js:14` — used for void/comp approvals, never for price override.
- **UI found:** `POSApprovalModal.jsx` exists for generic approvals (void, comp) — **no price override modal.**
- **Gap type:** **FULLY MISSING.**
- **Effort:** 5d+ — schema columns + migration + route + UI modal + refund-honors-override logic.
- **Shared deps:** Reuses `verifyManagerPin()` (approval-policies.js:94-117); shares reason-code pattern with B7.
- **Verification:** `grep -n "price_override" backend/routes/sales.js` → 0; `grep -n "priceOverride" frontend/src/pages/redesign/pos/` → 0.

### B7 — Per-line restock toggle + reason codes on returns

- **Schema found:** `return_reasons` table at `backend/schema-pg.sql:2152-2160` (id, code, label, requires_note, is_active, sort_order, created_at). Added via migration v19 (`backend/migrate-pg.js:1355`). `returns.return_reason_id` column exists. `return_items` schema at `backend/schema-pg.sql:453-460` — **no `restock_flag`, no per-line reason**. Policy-level `return_policies.restocking_fee_percent` exists at line 2144 but is not per-line.
- **Routes found:** `backend/routes/returns.js:163,289` — accepts `return_reason_id` in payload, inserts on return creation. No per-line restock toggle logic in route.
- **UI found:** `POSReturnExchangeModal.jsx:38` — fetches `/api/return-reasons` (single selection per return, lines 31-35). **No per-line toggle or per-item reason override UI.**
- **Gap type:** **PARTIAL WORKING** — reason tracking complete, per-line restock + per-item reason missing.
- **Effort:** 2d — add `restock_flag` + `reason_code_override` columns to `return_items`; per-line toggle UI; condition stock-restoration on flag.
- **Shared deps:** Reuses `return_reasons` table; shares reason-code pattern with A5.
- **Verification:** `grep -n "restock" backend/schema-pg.sql` → 1 (policy-level only, line 2144); `grep -n "restock" backend/routes/returns.js` → 0.

---

## Cluster 2 — Inventory & Reports (A6, B2, B6, C2, C6)

### A6 — Inventory-intelligence hub at /retail/inventory-intelligence

- **Schema found:** `products.min_qty`, `products.max_qty` at `backend/schema-pg.sql:134-135`. `stock_counts` + `stock_count_items` at `backend/schema-pg.sql:1694-1715`. **No ABC columns** (`grep abc_` → 0), **no reorder_point column** (only min_qty/max_qty for display), **no forecast or cycle schedule tables.**
- **Routes found:** `backend/routes/inventory.js:283-430` — `GET/POST /api/stock-counts`, `POST /api/stock-counts/:id/scan`. Mounted at `registerAllRoutes.js:473`. Permission: `manage_inventory`. `/api/reports/replenishment` + `/api/reports/replenishment-smart` exist in `backend/routes/reports/inventory.js:694-733`.
- **UI found:** `StockCountRedesign.jsx` at `/stock-counts` (`appRoutes.jsx:206`); `/reorder-alerts` at `appRoutes.jsx:143`. **No unified `/retail/inventory-intelligence` hub route.**
- **Gap type:** **PARTIAL WORKING** (stock counts + replenishment work standalone) + **missing unified hub, no ABC, no scheduling.**
- **Effort:** 5–7d — add ABC columns + migration, build hub route wrapper, compose cycle-count-scheduler + ABC + forecast cards into single page.
- **Shared deps:** Absorbs C2 (scheduled cycle counts) + C6 (GMROI/sell-through/aging) into summary cards on this hub.
- **Verification:** `grep -n "min_qty\|max_qty" backend/schema-pg.sql` → lines 134-135, 243; `grep abc_ backend/ -r` → 0; `grep reorder_point backend/ -r` → 0.

### B2 — Label template designer (ZPL/TSPL/EPL)

- **Schema found:** `barcode_templates` at `backend/schema-pg.sql:659-672` — name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default. **No printer-language column, no template body/content field.** `barcode_print_jobs` at line 674-683 is print-job history.
- **Routes found:** `backend/routes/barcode-expenses.js` — basic `GET/POST /api/barcode-templates`. Mounted at `registerAllRoutes.js:572`. Permission: `manage_inventory`. **No ZPL/TSPL/EPL compile, preview, or render endpoints.**
- **UI found:** Zero matches for "label.*designer", "drag.*drop.*label". `barcode-expenses.js` handles print-job history only, not template authoring.
- **Gap type:** **FULLY MISSING** (current templates store metadata only, no design content).
- **Effort:** 8–10d — extend schema (format + body JSON), ZPL/TSPL/EPL generator service, drag-drop designer UI, preview endpoint, printer integration.
- **Shared deps:** Printer service exists (`services/printer.js`); GRN label printing could reuse.
- **Verification:** `grep -rn "ZPL\|TSPL\|EPL" backend/` → 0; `grep -n "label.*designer" backend/schema-pg.sql` → 0.

### B6 — Bulk-scan toggle

- **Schema found:** N/A.
- **Routes found:** N/A.
- **UI found:** `frontend/src/pages/redesign/pos/hooks/useCart.js:179-215` — `addToCart` finds existing line by `product.id` and **increments qty** (lines 189-199). No toggle state, no scan-mode setting. No `bulkScanMode`, `scanMode`, or `incrementQty` state anywhere.
- **Gap type:** **ALREADY SHIPPED (as default behavior).** Increment-on-duplicate is standard retail POS behavior and is already the implementation.
- **Effort:** 0d. (If a toggle were wanted to allow duplicate lines instead, that would be ~1d — but the feature as described in the synthesis is already live.)
- **Shared deps:** —
- **Verification:** `grep -n "bulk\|scan.*mode" frontend/src/pages/redesign/pos/POSContext.jsx` → 0; `useCart.js:189-199` confirms increment.

### C2 — Scheduled cycle counts (zone-based)

- **Schema found:** `stock_counts` at `backend/schema-pg.sql:1694-1715` — id, count_number, outlet_id, status, started_by, started_at, completed_by, completed_at, notes. **No schedule_id, no zone_id, no recurrence columns. No `cycle_count_schedule` or `count_task` tables.**
- **Routes found:** `backend/routes/inventory.js:283-430` — one-shot CRUD only. **No scheduling endpoints, no zone filtering.**
- **UI found:** `StockCountRedesign.jsx` — one-shot only; status filter (`in_progress/completed/cancelled`), no schedule/zone UI.
- **Gap type:** **PARTIAL WORKING (one-shot) + SCHEMA-READY NO SCHEDULING.**
- **Effort:** 4–5d — schedule + task tables, schedule CRUD routes, zone-based item distribution, scheduling UI, cron integration.
- **Shared deps:** Feeds into A6 hub; existing scheduler pattern in `backend/routes/schedules.js` reusable.
- **Verification:** `grep -n "cycle_count\|count_schedule" backend/schema-pg.sql` → 0; `grep -n "schedule\|zone" backend/routes/inventory.js` → 0.

### C6 — GMROI / sell-through / inventory aging

- **Schema found:** Aging supported via GRN `received_at` + `outlet_stock` joins. **No gross-margin-at-SKU-level rollup** (cost_price + price exist, no COGS reconciliation). **No purchase-history rollup** for sell-through denominator.
- **Routes found:**
  - **Stock aging: SHIPPED** — `backend/routes/reports/stock-aging.js` → `GET /api/reports/stock-aging`, feature-flagged `reports_inventory_health_plus`. Buckets: fresh 0-30, aging 31-90, old 91-365, critical 365+.
  - **Forecast demand: SHIPPED** — `backend/routes/reports/inventory.js:676-691` → `GET /api/reports/forecast-demand`.
  - **Replenishment smart: SHIPPED** — `backend/routes/reports/inventory.js:694-733`.
  - **GMROI: MISSING** — 0 grep matches for "gmroi", "margin.*roi".
  - **Sell-through: MISSING** — 0 grep matches for "sell.through", "sellthrough", "sell_rate".
- **UI found:** `frontend/src/pages/reports/ReportsInventoryReplenishment.jsx` has `ReplenishmentTab`, `StockoutRiskTab`, `ForecastDemandTab`. No GMROI tab, no sell-through tab.
- **Gap type:** **PARTIAL (1 of 3 shipped)** — aging done, GMROI + sell-through fully missing.
- **Effort:** 3–4d — GMROI endpoint + tab (1.5d); sell-through endpoint + tab (1.5d).
- **Shared deps:** Both reuse forecast moving-average patterns; ideally surfaced as cards in A6 hub.
- **Verification:** `grep -n "gmroi\|sell.through" backend/routes/reports/inventory.js` → 0; `grep -n "GMROI\|SellThrough" frontend/src/pages/reports/` → 0.

---

## Cluster 3 — Loyalty & Pricing (B3, B4, C4)

### B3 — Loyalty earn + redeem at POS

- **Schema found:** `loyalty_tiers` at `backend/schema-pg.sql:271-282` (id, name, min_spend, points_multiplier, discount_percent, benefits, color, sort_order, is_active, created_at); `customers.loyalty_points` at line 293 (INTEGER DEFAULT 0); `customers.loyalty_tier_id` at line 310 (FK); `sales.points_earned` + `sales.points_redeemed` at lines 376-377. **No `loyalty_transactions` or `loyalty_ledger` audit table** — points are denormalized columns only.
- **Routes found:** `backend/routes/customers.js:736-805` — tier CRUD (`requirePerm("all_access")`). Line 586-642 — `POST /api/customers/loyalty/transfer`. Line 658-668 — profile enrichment returns tier_multiplier + tier_discount. Auto-earn on sale: `backend/routes/sales.js:883-933`. **No feature flag** (unlike `phase2_commissions` for C4).
- **UI found:** `LoyaltyTiersRedesign.jsx` at `/loyalty-tiers`; `PortalLoyalty.jsx` for customer portal; `useLoyaltyWallet.js` hook wires earn + redeem into POS; `POSCheckoutModal.jsx` shows balance + redeem toggle.
- **Redeem at POS:** Working — `useCheckout.js:32` `redeemPointsOn` state; `useLoyaltyWallet.js:42-47` computes `pointsDiscount`; `sales.js:589` subtracts `points_redeemed`.
- **Gap type:** **PARTIAL WORKING** — earn + redeem live; tier `discount_percent` field defined but **never applied** to sale total; no historical ledger.
- **Effort:** 2–3d — ledger table + triggers; wire tier discount auto-application; add `phase2_loyalty` feature flag; display tier discount in checkout.
- **Shared deps:** Ledger primitive shared with A2 (gift cards) and A3 (wallet pattern); discount-application pattern shared with B4.
- **Verification:** `grep -n "loyalty_tiers\|loyalty_points" backend/schema-pg.sql` → 3; `grep -n "loyalty" backend/routes/customers.js` → 14; `grep -n "points_earned\|points_redeemed" backend/routes/sales.js` → auto-earn confirmed at lines 883-933.

### B4 — Customer-group price books

- **Schema found:** `customer_groups` at `backend/schema-pg.sql:260-267` (id, name, description, discount_percent, is_active, created_at); `customers.customer_group_id` at line 305. `customer_groups.discount_percent` at line 264 exists but **not auto-applied at checkout.**
- **Routes found:** `backend/routes/customers.js:10-62` — full CRUD. Profile enrichment at line 658 returns `group_name` + `group_discount` (informational only). **No auto-discount logic in `sales.js`** — `grep "group_discount\|customer_group" backend/routes/sales.js` → 0 matches.
- **UI found:** `CustomerGroupsRedesign.jsx` at `/customer-groups`; customer-to-group assignment in `CustomersRedesign.jsx`. Group discount **not wired** into POS checkout — `grep -rn "group_discount\|customer_group" frontend/src/pages/redesign/pos/` → 0.
- **Gap type:** **SCHEMA-READY NO AUTO-APPLICATION.**
- **Effort:** 1–2d — apply `group_discount` in `sales.js` sale total; wire into POS checkout math. (Full "price books" with per-product per-group pricing would be +3–5d extra.)
- **Shared deps:** Discount-application pattern shared with B3 tier discount.
- **Verification:** `grep -n "customer_groups\|customer_group_id" backend/schema-pg.sql` → 6; `grep -n "group_discount" backend/routes/sales.js` → 0; `grep -rn "group_discount" frontend/src/pages/redesign/pos/` → 0.

### C4 — Staff commissions (per product / per category / tiered)

- **Schema found:** `commission_plans` at `backend/schema-pg.sql:2238-2248` (type: percentage / fixed_per_sale / fixed_per_item / tiered); `commission_plan_rules` at 2250-2261 (scope_type: all / category / product / brand; rate, min_threshold, max_cap, priority); `commission_earnings` at 2263-2281 (status: pending/approved/paid/reversed); `earning_type` column at 2285-2293 (Phase 2.1 C2 extension discriminating commission from tip); `employees.commission_plan_id` at 2295; `sale_items.staff_id` at 397 (**v49 migration, `backend/migrate-pg.js:3938-3948`**).
- **Migration:** v20 full schema (`migrate-pg.js:1369-1512`); v49 adds `sale_items.staff_id`; feature flag `phase2_commissions` seeded false at `migrate-pg.js:2688`.
- **Routes found:** `backend/routes/commissions.js` — `GET/POST/PUT/DELETE /api/commission-plans`, `POST /api/commission-plans/:id/assign`, `GET /api/commissions/earnings`. Mounted at `registerAllRoutes.js:531`. Feature flag gate: `commissions.js:6`. Auto-calculation: `sales.js:1020-1040` (fire-and-forget INSERT; matches plan rules by priority DESC, LIMIT 1). Void reversal: `sales.js:361-366`. **`fixed_per_item` and `tiered` types defined but calculation logic missing** — only `percentage` and `fixed_per_sale` have working math.
- **UI found:** `CommissionPlansRedesign.jsx` at `/commissions` — plan CRUD, rule builder, earnings history tab, bulk-assign modal. Feature-flagged at `CommissionPlansRedesign.jsx:33-34`.
- **Gap type:** **PARTIAL WORKING** — infrastructure complete; `fixed_per_item` and `tiered` calcs unimplemented; `sale_items.staff_id` not wired to commission attribution (commissions tied to sale-level authenticated employee only, not per-item).
- **Effort:** 4–5d — `fixed_per_item` calc (0.5d); `tiered` calc (1.5d); per-item `staff_id` attribution (1d); multi-rule stacking if needed (1d); approval UI (0.5d).
- **Shared deps:** `earning_type` discriminator bridges commissions + tips (Phase 2-R); shares discount/rate pattern with B3/B4.
- **Verification:** `grep -n "commission_plans\|commission_earnings" backend/schema-pg.sql` → 4; `grep -n "staff_id" backend/schema-pg.sql` → 1 (line 397); `grep -n "phase2_commissions" backend/routes/commissions.js` → 1.

---

## Cluster 4 — Variants, Serials, POS UX (A1, B1, B5)

### A1 — Omni-input primitive on /pos

- **Schema found:** Backend search handler is field-aware: `backend/routes/products.js:244` — `/api/products/search` with `field` query param routing to barcode/sku/price/all (lines 254-267); `/api/products/scan/:barcode` at line 311 looks up by `barcode` OR `sku` (line 329).
- **Routes found:** Both mounted. Permission: `view_reports | manage_inventory | all_access`. No feature flag.
- **UI found:** `frontend/src/pages/redesign/pos/POSSearchArea.jsx:64-81` — single `<input>` with `autoFocus` at line 66, `ref={searchRef}` at line 64, placeholder "Search by name, barcode, SKU… (F2)" at line 79. `handleSearchChange` dispatches by field (`useCart.js:150-177`). Enter auto-adds single result (line 74-77). Optional field toggles (`barcodeSearch`, `skuSearch`, `priceSearch`) rendered conditionally at lines 34-55.
- **Gap type:** **PARTIAL WORKING** — unified input exists, but search is substring ILIKE (`products.js:254-266`) with no EAN/UPC format detection and no auto-routing on keystroke. Cashiers must manually pick field.
- **Effort:** 3d — add barcode format detection regex (EAN-13, UPC-A, Code128), auto-route to scan endpoint on match, emit pattern badge in UI.
- **Shared deps:** When a matched product has variants, triggers B1 variant modal; when has serials, triggers B5 serial picker.
- **Verification:** `grep -n "autoFocus" frontend/src/pages/redesign/pos/POSSearchArea.jsx` → line 66; `grep -n "field.*barcode" backend/routes/products.js` → lines 254-267.

### B1 — Matrix variant grid modal

- **Schema found:** `attribute_sets` / `attributes` / `attribute_options` at `backend/schema-pg.sql:100-116`; `product_variants` at 157-174; `variant_option_values` at 176-181 (PK on variant+attribute — supports multi-attribute combinations).
- **Routes found:** `backend/routes/products.js:419` — `GET /api/products/:id/variants` returns variants with attribute options via LEFT JOIN. `backend/routes/attribute-sets.js:7` — returns nested `attributeSets[{attributes[{options[...]}]}]`. Both mounted, no feature flag.
- **UI found:** Admin-side variant table in `ProductFormPage.jsx:617-665` — grid rows for combinations with price/cost/stock/SKU (not a visual matrix). **POS-side: zero variant picker** — `grep -rn "variant" frontend/src/pages/redesign/pos/` → 0 matches. When a variant product is added, `addToCart()` uses base product (no prompt to select variant). **Apparel cashier cannot pick "Small Red Shirt" at POS.**
- **Gap type:** **ORPHANED ENDPOINTS** — full schema + routes + admin UI exist; zero POS integration.
- **Effort:** 5d — variant picker modal (size × color matrix or dropdown fallback), wire into POS search result click, pass `variant_id` to cart, stamp `sale_items.variant_id`, variant-level price-list + stock.
- **Shared deps:** Triggered by A1 omni-input when product has variants; stacks with B5 for variant-level serials.
- **Verification:** `grep -n "product_variants\|variant_option_values" backend/schema-pg.sql` → lines 100-181; `grep -rn "variant" frontend/src/pages/redesign/pos/` → 0.

### B5 — Serialized inventory end-to-end

- **Schema found:** `product_serial_numbers` at `backend/schema-pg.sql:720-728` (product_id, serial_number, status='available'|'sold', sale_id, created_at; UNIQUE on product_id+serial_number). **No warranty columns** (`grep warranty backend/schema-pg.sql` → 0). `sale_items` has **no `serial_number` column** (lines 387-402) — linkage is indirect via `product_serial_numbers.sale_id` → `sales.id`, not to `sale_items.id`. GRN schema (lines 327-337) has **no serial creation columns.** Returns schema has no serial tracking.
- **Routes found:** `backend/routes/barcode-expenses.js:767-815` — `GET /api/products/:id/serials`, `POST /api/products/:id/serials` (bulk insert), `POST /api/serials/:id/assign` (status='sold'). Permission: `manage_inventory`. Mounted.
- **GRN flow:** `backend/routes/grn.js:84-150` — scan-receive increments qty; **does NOT create serials** (grep "serial" returns 0 matches in grn.js).
- **Sales flow:** `backend/routes/sales.js` — `grep serial` returns 0 matches. **Does not stamp serial, does not call assign endpoint.**
- **Returns flow:** `backend/routes/returns.js` — `grep serial` returns 0 matches. **Does not reverse serial status.**
- **UI found:** `InventoryRedesign.jsx:192-270` — admin-side serial entry modal (bulk textarea, POST to add endpoint). **POS/GRN/returns: zero serial UI.**
- **Gap type:** **PARTIAL WORKING** — admin CRUD works; receive/sell/return flows disconnected.
- **Effort:** 5d — GRN serial entry (1d); POS serial picker + assign call (1.5d); returns serial reverse (1d); add warranty_months column + warranty_expiry computation (1d); tests (0.5d).
- **Shared deps:** Wires into GRN + POS checkout + returns; stacks with B1 for variant-level serials.
- **Verification:** `grep -n "product_serial_numbers" backend/schema-pg.sql` → lines 720-728; `grep serial backend/routes/sales.js backend/routes/returns.js backend/routes/grn.js` → 0, 0, 0.

---

## Cluster 5 — Flow-Shape (C1, C3, C5)

### C1 — Layaway / hold / special-order

- **Schema found:** **NONE.** `grep "layaway\|special_order" backend/schema-pg.sql` → 0 matches; `grep "hold" backend/schema-pg.sql` → 1 match (`restaurant_preauth_holds` at line 2748, unrelated). `sales` (lines 364-385) and `customer_invoices` have no deposit/installment columns. `parked_sales` at `backend/schema-pg.sql:614-633` is **cart-pause only** — fields are label/notes/parked_at with no payment tracking; not compatible with layaway.
- **Routes found:** **None.** No `/api/layaway`, `/api/holds`, or `/api/special-order`. `parked-sales.js` (mounted `registerAllRoutes.js:546`) covers cart pause with `pos_park` permission only.
- **UI found:** **None.** No layaway modal, no hold list, no deposit UI.
- **Gap type:** **FULLY MISSING.**
- **Effort:** 8–10d — schema (holds table with deposit + installment_schedule + expiry), CRUD routes, partial-payment handler, returns integration against hold, modal + list UI, aging report.
- **Shared deps:** May use C3 receipt barcode to recall hold; C5 training role should block hold creation.
- **Verification:** `grep "layaway\|special_order" backend/schema-pg.sql` → 0; `grep -r "layaway" backend/routes/ --include=*.js` → 0.

### C3 — Receipt-barcode → one-scan return lookup

- **Schema found:** `receipt_templates.show_barcode` column exists; `sales.invoice_number` at `backend/schema-pg.sql:379`. Current render: `frontend/src/utils/receipt.js:195-202` sets `bc.textContent = s.invoiceNumber` — **plain text, not Code128.**
- **Routes found:** `backend/routes/receipts.js` — `GET /api/receipts/:invoiceNumber/public` (no auth, returns sale). **No dedicated `GET /api/sales/by-invoice/:invoiceNumber` for scan-based returns lookup.** `ReturnsRedesign.jsx:471` has manual `original_sale_id` numeric input; `ReturnsRedesign.jsx:180` has product-barcode scan (different feature).
- **UI found:** **No JsBarcode or bwip library import** (`grep -r "JsBarcode\|bwip" frontend/src/ --include=*.js --include=*.jsx` → 0). No scan input on returns for invoice barcode.
- **Gap type:** **SCHEMA-READY NO UI** — template flag + API exist; barcode encoding + scan-return workflow missing.
- **Effort:** 3–4d — JsBarcode lib + Code128 render (0.5d); `GET /api/sales/by-invoice/:invoiceNumber` lookup (1d); returns UI scan input + auto-prefill (1d); E2E test (0.5d).
- **Shared deps:** Complements C1 if holds use same barcode.
- **Verification:** `grep "barcode\|Code128\|JsBarcode" frontend/src/utils/receipt.js` → 2 matches (flag + text render only); `grep -r "JsBarcode" frontend/src/` → 0.

### C5 — Training role

- **Schema found:** `roles` table at `backend/schema-pg.sql:52-57` — generic (id, name, description, created_at). Default roles hardcoded in `backend/middleware/permissions.js:37-64` as Administrator / Manager / Cashier. **No `is_training` or `training_mode` column** on roles/employees/outlets/sales.
- **Routes found:** `backend/routes/roles.js` (mounted `registerAllRoutes.js:446`) — generic role CRUD, `requirePerm("all_access")`. `backend/routes/sandbox.js` (mounted `registerAllRoutes.js:155` **only if `PAYMENT_GATEWAY=sandbox`**) is a **payment simulator** — unrelated to training.
- **UI found:** **Zero training UI.** `grep -r "training" frontend/src/ --include=*.jsx --include=*.js` → 0 matches.
- **Gap type:** **ORPHANED + FULLY MISSING.**
- **Effort:** 5–6d — `is_training` boolean on roles; middleware gate in permissions for sales/voids/discounts; role editor toggle; training-mode banner in POS.
- **Shared deps:** Shares PIN/role-gate pattern with A5.
- **Verification:** `grep "training\|sandbox" backend/middleware/permissions.js` → 0; `grep "is_training" backend/schema-pg.sql` → 0; `grep -r "training" frontend/src/ --include=*.jsx` → 0.

---

## Shared dependencies & primitives

### Ledger primitive (A2 + A3 + B3)

- **Reference implementation: `customer_wallet_ledger`** (`backend/schema-pg.sql:324-333`) with (type, amount, reference_type, reference_id, note). This is already shipped for A3 store credit.
- **A2 gift cards** currently have a `gift_cards` balance table but **no transaction ledger** — adding `gift_card_transactions` modeled on wallet ledger is the standard move.
- **B3 loyalty** currently tracks points via denormalized `customers.loyalty_points` + `sales.points_earned/redeemed` — no audit trail. A `loyalty_transactions` ledger modeled on wallet pattern would unify the primitive.
- **Design implication:** treat "ledger table (ref_type + ref_id + amount + note)" as a Phase 2-G foundational primitive. Consolidate A2 ledger + B3 ledger into one schema migration.

### Permission rules & PIN verification (A5 + B7 + C5)

- **PERMISSION_RULES** live in `backend/middleware/permissions.js:37-64` (Administrator / Manager / Cashier defaults); enforced via `requirePerm("perm")` and `requireAnyPerm(["perm1","perm2"])`.
- **`verifyManagerPin()` service** exists: `backend/routes/approval-policies.js:114`, `backend/routes/restaurant/void-comp.js:14`. Used today for void/comp only.
- **A5 price override** should reuse `verifyManagerPin()` + `requirePerm("override_price")` as a new permission entry.
- **C5 training role** needs a new `is_training` column on roles + middleware gate (distinct from permission rules — it's a role-level block, not a permission).
- **B7 restock + reason** uses `return_reasons` table pattern — a reusable shape for A5 `override_reasons` (shared "reason code" primitive across sensitive actions).

### Feature flags to add

All new Phase 2-G features should be behind feature flags, following the existing pattern in `backend/middleware/feature-flags.js`:
- `phase2g_gift_cards` (A2)
- `phase2g_price_override` (A5)
- `phase2g_loyalty` (B3 — note: current loyalty has no flag; adding one lets us gate the tier-discount auto-application behavior change)
- `phase2g_variant_picker` (B1)
- `phase2g_serialized_inventory` (B5)
- `phase2g_inventory_intelligence` (A6 hub)
- `phase2g_label_designer` (B2)
- `phase2g_cycle_counts_scheduled` (C2 — or fold into `phase2g_inventory_intelligence`)
- `phase2g_layaway` (C1)
- `phase2g_receipt_barcode_lookup` (C3)
- `phase2g_training_role` (C5)

`phase2_commissions` (C4) already exists (`migrate-pg.js:2688`) — no new flag needed, just finish the calc types.

### Modal primitives (exchanges + splits + price override)

- `frontend/src/ui/primitives.jsx` provides `PageShell`, `Button`, `Input`, etc. — no inventory of reusable modal shells was mapped in this audit.
- `POSApprovalModal.jsx` (used for voids/comps) is the closest reference for A5 price override modal.
- `POSReturnExchangeModal.jsx` is the reference for any multi-mode modal (refund/exchange) and should inspire A5 modal structure (single modal, two flows).

---

## Tier C promotion/demotion recommendations

| Item | Current Tier | Code findings | Recommendation |
|------|--------------|---------------|----------------|
| C1 — Layaway | Tier C MAYBE | Fully missing, 8-10d, distinct from parked sales | **KEEP MAYBE** — high effort; defer to Phase 3 unless explicit merchant demand surfaces. Not a Lightspeed/Square parity-critical feature for Phase 2-G. |
| C2 — Scheduled cycle counts | Tier C MAYBE | Partial (one-shot works); 4-5d for scheduling | **PROMOTE to Tier B (fold into A6 hub)** — low marginal cost once A6 hub is built; adds retail credibility. |
| C3 — Receipt-barcode return lookup | Tier C MAYBE | Schema flag exists, 3-4d, low risk | **PROMOTE to Tier B** — small UX win, low effort, differentiates from manual invoice lookup. |
| C4 — Staff commissions | Tier C MAYBE | Infrastructure already shipped (v20); 4-5d to finish tiered + per-item | **PROMOTE to Tier A or Tier B** — sunk cost is already paid; finishing is cheap; commissions are a real retail differentiator in the target market. This is the single highest ROI item in Tier C. |
| C5 — Training role | Tier C MAYBE | Fully missing, 5-6d | **KEEP MAYBE** — moderate effort; nice-to-have but not a parity-critical feature. Defer unless competitor audits surface it as a table-stakes item. |
| C6 — GMROI/sell-through/aging | Tier C MAYBE | Aging shipped; GMROI + sell-through missing (3-4d) | **PROMOTE to Tier B (fold into A6 hub)** — same A6-absorb argument as C2; small effort, retail-essential metrics. |

**Net recommendation:** promote **C2, C3, C4, C6** into Phase 2-G; defer **C1, C5** to Phase 3.

---

## Recommended sequencing

Based on shared primitives and logical dependencies:

**Wave 1 — Foundational primitives (unblock everything else):**
1. **Ledger primitive migration** (`gift_card_transactions` + `loyalty_transactions` shaped like `customer_wallet_ledger`) — unblocks A2 + B3 audit work.
2. **Feature flags** for all Phase 2-G items — standard pattern.
3. **A1 omni-input pattern detection** — unblocks B1 variant modal and B5 serial modal trigger logic (search must know when to open them).

**Wave 2 — Tender completion (A2 + B3/B4 polish):**
4. **A2 gift cards at POS** — wire into `POSCheckoutModal`, mirror A3 wallet pattern.
5. **B3 loyalty tier-discount auto-application** + ledger — small change, big UX win.
6. **B4 customer-group discount auto-application** — pairs with B3 discount logic.

**Wave 3 — POS UX (A5 + B1 + B5 + B6 already shipped):**
7. **A5 price override** — new schema + modal + `verifyManagerPin` wiring.
8. **B1 variant picker** — new POS modal, pairs with A1 pattern routing.
9. **B5 serial end-to-end** — wire GRN receive + POS assign + returns reverse + warranty column.
10. **B7 per-line restock toggle** — small additive change on returns modal.

**Wave 4 — Reports & inventory intelligence (A6 absorbs C2 + C6):**
11. **A6 hub + ABC columns** — scaffolds the unified page.
12. **C6 GMROI + sell-through endpoints + tabs** — surface as hub cards.
13. **C2 scheduled cycle counts** — schedule table + zone filter + hub card.

**Wave 5 — Finishing touches & flow-shape:**
14. **C4 commission tiered + fixed_per_item calcs + per-item `staff_id` attribution** — cheap finish on already-shipped infrastructure.
15. **C3 receipt barcode + invoice-lookup endpoint** — adds Code128 to receipt, returns scan input.
16. **B2 label designer** — heaviest single item; consider deferring to Phase 3 or parallelizing on a separate track.

**Deferred to Phase 3:** C1 layaway, C5 training role.

---

## Surprises / caveats / already-shipped

### Already shipped — REMOVE from Phase 2-G scope

- **A3 store credit** — complete end-to-end (wallet ledger + topup routes + POS tender).
- **A4 exchange flow** — complete as composite return+sale in `POSReturnExchangeModal.jsx`.
- **B6 bulk-scan toggle** — default behavior of `useCart.js:179-215` is increment-on-duplicate. No toggle UI needed unless we want the *opposite* behavior (new line per scan).
- **C4 commissions — infrastructure** — v20 schema + routes + UI all shipped; only calc types (fixed_per_item, tiered) + per-item attribution remain.

### Larger than synthesis suggested

- **A6 inventory-intelligence hub** — synthesis treated it as "compose existing reports into one page" (~3d). Reality: ABC columns don't exist at all (new schema), cycle-count scheduling doesn't exist (new schema + routes), hub route doesn't exist. More like 5–7d.
- **B2 label designer** — 8–10d, not 3–5d. Current `barcode_templates` has metadata only (no ZPL body, no printer language). This is a full designer build, not a template selector.
- **C1 layaway** — 8–10d (distinct from parked sales which is cart-pause only). Synthesis implied "deposits + schedule" but schema has neither.

### Hidden dependencies

- **A2 gift cards** need a new tender code in `sale_payments.method` enum check (if one exists). Wallet + cash + card + loyalty are already tender types. Verify before wiring.
- **B1 variant picker** interacts with `price_lists` (variant-level pricing exists per variant via `product_variants.price`) and outlet stock (stock is per-variant via `variant_stock` if it exists, per-product otherwise). Auditor did not confirm variant stock shape — needs follow-up.
- **B5 serials + B1 variants** — for apparel, serials are at variant level (Small Red Shirt serial #XYZ), not product level. `product_serial_numbers` has `product_id` but no `variant_id` — may need a column add for serialized variant stock.
- **C4 per-item commission via `sale_items.staff_id`** — v49 added the column for walk-in service assignment (per-item staff), but commission calc reads only `authenticatedEmployeeId` from the sale. Wiring this requires changing the commission matching logic, not just the data.

### Collisions with Phase 2-R work

- **C4 commissions share `commission_earnings.earning_type` with Phase 2-R tips** (Phase 2.1 C2 extension at schema lines 2285-2293). Tip and commission insert/read paths both touch this table. Any Phase 2-G commission changes must preserve tip code paths.
- **A1 omni-input** collides with existing Phase 2-R POS work if that phase touched `POSSearchArea.jsx`. Check recent git history before modifying.
- **B7 return reasons** — Phase 2-R may have touched `return_reasons` if dining returns/comps use the same table. Verify.

---

## CLAUDE.md drift detected

The main `CLAUDE.md` at `d:/newprojects/oneshoppos/CLAUDE.md` claims migration version 49. Source confirms v49 — `backend/migrate-pg.js:3938-3948` adds `sale_items.staff_id`. No drift on migration count.

However, the following drift was observed during the audit:

1. **CLAUDE.md on feature list** — claims "Loyalty: tiers exist" but omits that the tier `discount_percent` field (`schema-pg.sql:276`) **is never applied** to sale totals. This gap is not mentioned in any CLAUDE.md. Flag for docs update.

2. **CLAUDE.md on parked sales vs layaway** — neither CLAUDE.md nor its sub-guides distinguish `parked_sales` (cart-pause) from the missing layaway primitive. Merchants reading docs might assume parked sales covers layaway. Flag for docs clarification.

3. **CLAUDE.md on serials** — does not mention that `product_serial_numbers` exists but is disconnected from GRN receive / POS sell / returns reverse. The table's existence in schema is misleading without a statement about end-to-end status. Flag for docs clarification.

4. **CLAUDE.md on commissions** — mentions "Phase 2B (v20) shipped commissions" without noting that `fixed_per_item` and `tiered` calc types have schema entries but no calculation logic. Flag for docs clarification.

5. **CLAUDE.md on barcode templates** — mentions label printing exists via `barcode-expenses.js` without clarifying that `barcode_templates` stores metadata only (no template body, no ZPL/TSPL/EPL support). Reader may assume label designer is shipped. Flag for docs clarification.

6. **CLAUDE.md on `/reports`** — does not list the exact report tabs present (`ReplenishmentTab`, `StockoutRiskTab`, `ForecastDemandTab` in `ReportsInventoryReplenishment.jsx`). No mention that GMROI/sell-through are absent. Low-impact drift.

None of the above drift is load-bearing for this audit — all findings are grounded in source. Drift items are listed so a future `/update-docs` run can clean them up.

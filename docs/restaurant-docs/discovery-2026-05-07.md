# Restaurant Pre-Launch — Discovery Report (2026-05-07)

> **Purpose:** Read-only investigation that maps the restaurant surface area before authoring the pre-launch walkthrough plan. All claims verified against source code (cited file:line) and the live test tenant `sanoposlivetest1778021564659` on Supabase project `tpjewvfoqtskscmwjtjj`.

> **Important:** CLAUDE.md content was treated as potentially stale. Every functional claim below is grounded in either the source file or the tenant DB.

---

## TL;DR — Three launch-blockers found

1. **Schema drift in `schema-pg.sql`** — migrations v59 + v61 (`sale_item_adjustments`, `void_reason_codes`, `menu_schedules`, `menu_schedule_products`, `reservations`, `waitlist_entries`, `restaurant_payment_sessions`) are NOT in `backend/schema-pg.sql`, but freshly-provisioned tenants get `schema_version` pre-seeded with `1..N`, so the migration runner skips re-applying. Result: void/comp, day-parting, reservations, waitlist, pay-at-table all 500 on a fresh restaurant tenant.
2. **Manager role missing 13 perms** — `backend/routes/setup.js:22-34` hardcodes an OLD 8-perm Manager list. The new 21-perm list lives in `backend/middleware/permissions.js:37-68`. Setup wizard wins. Live tenant DB confirms Manager has only 8 perms — missing `manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, etc. Any non-Admin employee cannot use any restaurant route.
3. **Provisioner role mismatch** — provisioner creates a role named `"Admin"` (`tenant-provisioner-pg.js:104-105`), but setup.js inserts `"Administrator"` (`setup.js:314-322`) with `INSERT ... ON CONFLICT (id) DO NOTHING`. Live tenant ends up with a role named `"Admin"` (id=1) but the owner employee has `role` text column = `"Cashier"` (legacy column, fixed by setup.js bug — see §8). Sidebar role display may be wrong.

---

## Section 1 — What a restaurant tenant gets at signup

### 1.1 Modes seeded in `tenant_modes`

From `backend/config/industry-config.js:30-55` (restaurant) and `:114-139` (cafe) — both define `modes: ["restaurant"]`. Setup wizard at `backend/routes/setup.js:243-251` inserts each preset mode.

| Tenant | `tenant_modes` row |
|---|---|
| `industry_type=restaurant` | `restaurant` |
| `industry_type=cafe` | `restaurant` (same) |

**Verified live:** `sanoposlivetest1778021564659.tenant_modes` = `[{ mode: 'restaurant', enabled: true, enabled_at: '2026-05-05 23:30:33' }]` ✅

### 1.2 Feature flags ON for a fresh restaurant tenant (PK)

Three sources combine, all run inside the setup transaction (`backend/routes/setup.js:194-281`):

**A) Mode flags from `MODE_REGISTRY.restaurant` (`backend/config/mode-registry.js:6-20`)** — 13 flags
| Flag |
|---|
| phase4_restaurant |
| phase4_restaurant_kds |
| phase4_restaurant_qr |
| phase4_restaurant_86 |
| phase4_restaurant_void_comp |
| phase4_restaurant_pay_at_table |
| phase4_restaurant_reservations |
| phase4_restaurant_kds_analytics |
| phase4_restaurant_day_parting |
| phase4_restaurant_fire_chits |
| phase4_restaurant_seats |
| phase4_restaurant_drive_thru |
| phase4_restaurant_menu_engineering |

**B) `RESTAURANT_SEED_FLAGS` (`backend/services/retail-flag-preset.js:55-80`)** — 10 flags. Fired for `industry_type === "restaurant" || "cafe"` (setup.js:279).
| Flag | Purpose |
|---|---|
| phase2g_loyalty | Loyalty admin page |
| phase2g_gift_cards | Gift card admin + POS tender |
| sms_campaigns | Marketing → Campaigns surface |
| phase5_sms_providers | SMS provider config |
| phase2g_price_override | Manager PIN price override |
| phase2_pos_approvals | POS approval workflow |
| phase2g_risk_controls | Cashier risk controls |
| retail_weekly_digest | Monday revenue digest email |
| phase5_cod_reconciliation | COD settlement workflow |
| phase5_shipping_automation | Picklists, loadsheets |

**C) Country pack PK (`backend/config/country-packs.js`, applied at `setup.js:265-272`)** — adds `fbr_integration` (only when `country_code=PK`).

**Live tenant verification (`SELECT key FROM ... WHERE enabled=true ORDER BY key`)** — 24 flags ON, all expected ✅:
```
fbr_integration, phase2_pos_approvals, phase2g_gift_cards, phase2g_loyalty,
phase2g_price_override, phase2g_risk_controls, phase4_restaurant,
phase4_restaurant_86, phase4_restaurant_day_parting, phase4_restaurant_drive_thru,
phase4_restaurant_fire_chits, phase4_restaurant_kds, phase4_restaurant_kds_analytics,
phase4_restaurant_menu_engineering, phase4_restaurant_pay_at_table,
phase4_restaurant_qr, phase4_restaurant_reservations, phase4_restaurant_seats,
phase4_restaurant_void_comp, phase5_cod_reconciliation, phase5_shipping_automation,
phase5_sms_providers, retail_weekly_digest, sms_campaigns
```
13 mode flags + 10 restaurant seed flags + 1 country pack = 24. Matches.

### 1.3 Sample data seeded

From `backend/seeds/preset-seed-data.js:41-60`:

| Industry | Categories | Sample products (qty 100 each, no `initial_stock` flag) |
|---|---|---|
| restaurant | Appetizers, Main Course, Beverages, Desserts | Caesar Salad 650, Grilled Chicken 1200, Iced Tea 300, Chocolate Cake 500, Garlic Bread 350 |
| cafe | Hot Drinks, Cold Drinks, Bakery | Espresso 350, Cappuccino 450, Iced Latte 500, Croissant 300, Sandwich 600 |

Note: `seedPresetData` at line 145-152 inserts 100-unit `outlet_stock` for every sample product. **Verified live**: all 5 products have `stock_qty=100.000` ✅.

### 1.4 Preset config differences vs general_retail

Direct comparison from `backend/config/industry-config.js`:

| Field | general_retail (4-29) | restaurant (30-55) | cafe (114-139) |
|---|---|---|---|
| `display_name` | Retail Store | Restaurant / Cafe | Cafe / Quick Service |
| `business_model` | buy_sell | food_service | food_service |
| `modes` | `[]` | `["restaurant"]` | `["restaurant"]` |
| `labels.product` | Product | Menu Item | Menu Item |
| `labels.customer` | Customer | **Guest** | Customer (note: cafe uses Customer, not Guest) |
| `labels.sale` | Sale | Order | Order |
| `pos_layout_mode` | grid | **list** | list |
| `pos_search_config.show_barcode` | true | **false** | false |
| `pos_search_config.show_sku` | true | false | false |
| `pos_search_config.show_price` | true | false | false |
| `dashboard_widgets.floor_plan` | false | **true** | false (cafe doesn't show floor plan) |
| `onboarding_steps` | `["store","product","customer","employees","shift","sale","receipt"]` (7) | `["store","menu_item","floor_plan","shift","order"]` (5) | `["store","menu_item","employees","shift","order"]` (5) |
| `visible_report_groups` | null (= all) | `["Sales","Customers","Inventory","Operations","Finance","HR","Governance"]` | (same as restaurant) |

Portal tabs (`PORTAL_ENABLED_TABS_BY_PRESET` `:752-776`):
| Preset | Tabs |
|---|---|
| general_retail | invoices, orders, loyalty, profile |
| restaurant | orders, loyalty, profile (no invoices) |
| cafe | orders, loyalty, profile |

Portal label overrides (`:782-783`):
- restaurant: `orders_tab="My Orders"`, `dashboard_heading="Welcome"`
- cafe: same

**Cafe vs restaurant gotcha:** cafe seeds the `restaurant` mode — same backend gates apply — but the wizard's UI/labels say "Customer" not "Guest", and `dashboard_widgets.floor_plan` is `false` (so the dashboard widget hides). Whether that matches a cafe owner's expectation is a Phase 2 walkthrough question.

---

## Section 2 — Sidebar nav for restaurant tenants

Source: `frontend/src/ui/nav-config.js`. Items have `requiredPerm`, `requiredFlag`, `requiredMode`. Hidden if any unmet.

### 2.1 The Restaurant section (lines 144-160)

| Item | Path | requiredPerm | requiredFlag | requiredMode | Will show for restaurant? |
|---|---|---|---|---|---|
| Floor Plan | /restaurant/floor | manage_restaurant | phase4_restaurant | restaurant | ✅ |
| Checks | /restaurant/checks | manage_restaurant | phase4_restaurant | restaurant | ✅ |
| 86'd Items | /restaurant/availability | manage_restaurant | phase4_restaurant_86 | restaurant | ✅ |
| Modifiers | /restaurant/modifiers | manage_restaurant | phase4_restaurant | restaurant | ✅ |
| Menu Schedules | /restaurant/menu-schedules | manage_restaurant | phase4_restaurant_day_parting | restaurant | ✅ (route, but **table missing — see §8**) |
| Reservations | /restaurant/reservations | manage_restaurant | phase4_restaurant_reservations | restaurant | ✅ (table missing) |
| Waitlist | /restaurant/waitlist | manage_restaurant | phase4_restaurant_reservations | restaurant | ✅ (table missing) |
| Online Inbox | /restaurant/inbox | manage_restaurant | phase4_restaurant | restaurant | ✅ |
| Void/Comp Reasons | /restaurant/void-reasons | all_access | phase4_restaurant_void_comp | restaurant | ✅ (table missing) |
| KDS | /kds | manage_kds | phase4_restaurant_kds | restaurant | ✅ |
| Tip Pools | /tips | manage_tips | phase4_restaurant | restaurant | ✅ |
| Order Kiosks | /order-kiosks | manage_restaurant | phase4_restaurant_qr | restaurant | ✅ |

**Items that SHOULD show but DON'T have a sidebar entry:**

- **Menu Engineering report** — flag `phase4_restaurant_menu_engineering` is on, route exists at `/reports/menu-engineering` (`appRoutes.jsx:211`), but no nav entry. Reachable only via Reports → Menu Engineering tab.
- **KDS Analytics report** — flag `phase4_restaurant_kds_analytics` is on, route at `/reports/kds-analytics` (`appRoutes.jsx:210`), no nav entry. Same as above.
- **Pay-at-Table sessions** — flag `phase4_restaurant_pay_at_table` is on, but no admin page. Pay sessions are minted from POS (`PayAtTableQRModal`); no list view, no audit page. Reasonable for MVP but the walkthrough should note it.
- **Reservations Booking page (`/reserve/:slug`)** — public page exists; no admin nav surface that previews it. Manager has to construct URL manually.
- **QR Menu launcher** — `/order-kiosks` doubles as it (mints `/menu/<token>` URLs); but a "Public QR menu" entry would help — there's no read-only menu-preview link.
- **Restaurant POS** — `/pos/restaurant` route exists (`publicRoutes.jsx:124`), but the "POS" sidebar item points to `/pos`. Restaurant tenants may want the sidebar POS to default to `/pos/restaurant` when in restaurant mode. (Current behaviour: `POSRestaurantRedesign:147` redirects retail tenants away from `/pos/restaurant`, but the nav itself doesn't redirect restaurant tenants TO it.)

**Retail-only items that DO show on restaurant — potential bleed-through:**

These all use `requiredPerm: "manage_inventory"` or `"manage_orders"` with NO `requiredMode`/`requiredFlag` filtering, so they appear on restaurant tenants too:

| Section | Item | Should restaurant see this? |
|---|---|---|
| Sell | Quotations (flag `crm_quotations`) | Optional — flag is OFF by default, so won't show. Fine. |
| Sell | Parked Sales | Yes — restaurants can park orders. |
| Sell | Holds & Layaway (flag `phase2g_holds`) | Flag is OFF for restaurant (not in `RESTAURANT_SEED_FLAGS`). Won't show. |
| Sell | Returns | Yes — restaurants do refunds. |
| Sell | Sales History | Yes. |
| Catalog | Products, Categories, Brands, Attribute Sets, Promotions, Price Lists | Yes. (Menu items live in `products`.) |
| Catalog | Smart Collections, Scheduled Changes | Flags OFF for restaurant. Won't show. |
| **Inventory** | **Inventory Audit, Stock Adjustments, Transfers, Reorder Alerts, Intelligence** | **Restaurants typically don't track ingredient stock per-item the same way. The pages will work but feel out of place.** Note: `phase2g_inventory_intelligence` is OFF for restaurant. The other 4 items have no flag gate — they show. |
| Procurement | Suppliers, Purchase Orders, Supplier Returns | Useful for restaurants (food suppliers). Show. |
| Procurement | Supplier Payables (flag `supplier_payables`) | Flag OFF by default. Won't show. |
| Fulfillment | Fulfillment, Courier Settings, COD Settlements | Flags ON (`phase5_cod_reconciliation`, `phase5_shipping_automation`). Show. Reasonable for restaurants doing delivery. |
| Online Store | View Storefront | Tenant has `general_retail` storefront. May feel weird for restaurants. |
| Customers | Loyalty Tiers, Gift Cards, Inbox, Campaigns | All flags ON for restaurant. Show. |
| Customers | Customer Invoices (flag `customer_invoicing`) | Flag OFF by default. Won't show. |
| Customers | Subscriptions (flag + mode `subscriptions`) | Mode OFF. Won't show. |
| Insights | Reports, Retail Risk (flag `phase2g_risk_controls`) | Both ON. Show. |
| Insights | Report Builder (flag `phase2_report_builder`) | Flag OFF by default. Won't show. |
| Compliance | Taxes | Tenant has `tax_mode=none`, but Taxes page still shows (no tax_mode gate). Owner may be confused. |
| Compliance | FBR Settings, FBR Invoices, Tax Lookup | Country=PK so `fbr_integration` ON. Show. Owner answered "No GST" — need to check whether wizard suppressed FBR or it'll prompt. |

**Verdict:** No major bleed-through; Inventory section is the most jarring (restaurants don't typically count ingredients via Stock Adjustments). 4 missing nav items (menu engineering, KDS analytics, /pos/restaurant promotion, public menu preview) — none launch-blocking.

---

## Section 3 — Restaurant-specific routes and what gates them

All file paths under `backend/routes/`. Mounting verified in `registerAllRoutes.js`.

### 3.1 `restaurant.js` — Floor plans, tables, sessions, checks, courses, splits, tabs (`registerAllRoutes.js:648`)

Gate stack (`restaurant.js:17`): `requireMode("restaurant"), requireFeature("phase4_restaurant"), requirePerm("manage_restaurant")`

| Method + path | Service call | Notes |
|---|---|---|
| GET /api/restaurant/floor-plans | `floor.getFloorPlans` | Requires `?outlet_id=` |
| GET /api/restaurant/floor-plans/:id | `floor.getFloorPlanWithTables` | |
| POST /api/restaurant/floor-plans | `floor.createFloorPlan` | + Zod `createFloorPlanSchema` |
| PUT /api/restaurant/floor-plans/:id | `floor.updateFloorPlan` | |
| GET /api/restaurant/tables | direct SELECT | Requires `?floor_plan_id=` |
| POST /api/restaurant/tables | direct INSERT | |
| PUT /api/restaurant/tables/:id | dynamic UPDATE | |
| GET /api/restaurant/table-sessions | direct SELECT joining tables + employees | Default: status != 'closed' |
| POST /api/restaurant/table-sessions | `floor.openTableSession` | |
| PUT /api/restaurant/table-sessions/:id | `floor.updateTableSession` | Used to close session via `{status:"closed"}` |
| GET /api/restaurant/checks | `checks.getOpenChecks` | |
| POST /api/restaurant/checks | `checks.createRestaurantCheck` | |
| POST /api/restaurant/checks/:id/send-to-kitchen | `kds.sendToKitchen` | |
| POST /api/restaurant/checks/:id/fire-course | `checks.fireCourse` + optional fire-chit print routing (lines 195-247, gated by `phase4_restaurant_fire_chits`) | |
| POST /api/restaurant/checks/:id/print-bill | `printerService.printReceipt` | Gated by `phase4_restaurant_fire_chits` (line 259) |
| POST /api/restaurant/checks/:id/courses/hold | `checks.holdCourse` | |
| POST /api/restaurant/checks/:id/courses/expedite | `checks.expediteCourse` | |
| POST /api/restaurant/checks/:id/split | `checks.splitCheckBy{Seat,Amount,Evenly,Item}` (`:327-352`) | `split_type` switch |
| POST /api/restaurant/checks/merge | `checks.mergeChecks` | |
| POST /api/restaurant/tabs | `checks.openTab` | |
| POST /api/restaurant/tabs/:id/close | `checks.closeTab` | |

### 3.2 `restaurant/availability.js` — 86'd items (sold-out)

Gate (`:15`): `requireMode("restaurant"), requireFeature("phase4_restaurant_86"), requirePerm("manage_restaurant")`

| Method + path | Notes |
|---|---|
| GET /api/restaurant/sold-out | Returns `{products, variants}` with `is_sold_out=true` |
| POST /api/restaurant/products/:id/sold-out | Body: `{reason, until?}`. Marks product 86'd |
| DELETE /api/restaurant/products/:id/sold-out | Idempotent un-86 |

### 3.3 `restaurant/menu-schedules.js` — Day parting

Gate (`:14`): `requireMode("restaurant"), requireFeature("phase4_restaurant_day_parting"), requirePerm("manage_restaurant")`. **TABLE MISSING — §8.**

| Method + path | Notes |
|---|---|
| GET /api/restaurant/menu-schedules | List, filter by `?outlet_id=`. Eagerly aggregates `product_ids` |
| POST /api/restaurant/menu-schedules | Creates schedule + `menu_schedule_products` rows |
| PUT /api/restaurant/menu-schedules/:id | Patch fields + replace product_ids |
| DELETE /api/restaurant/menu-schedules/:id | |

### 3.4 `restaurant/void-comp.js` — Manager-PIN voids/comps

Gate (`:16`): `requireMode("restaurant"), requireFeature("phase4_restaurant_void_comp"), requirePerm("manage_restaurant")`. **TABLES MISSING — §8.**

| Method + path | Notes |
|---|---|
| GET /api/restaurant/void-reasons | Filter by `?adjustment_type=void\|comp\|both` |
| PATCH /api/restaurant/void-reasons/:id | `requirePerm("all_access")` (stricter — no Manager) |
| POST /api/restaurant/sale-items/:id/adjust | Body: `{adjustment_type, reason_code, reason_note, amount, manager_pin}`. Calls `verifyManagerPin` |
| GET /api/restaurant/adjustments?sale_id= | Audit trail |

### 3.5 `restaurant/pay-at-table.js` — QR pay sessions

Two factories. Staff-side (`:17`): `requireMode("restaurant"), requireFeature("phase4_restaurant_pay_at_table"), requirePerm("manage_restaurant")`. Public-side (`:175`): `webhookLimiter` only. **TABLE MISSING — §8.**

| Method + path | Auth | Notes |
|---|---|---|
| POST /api/restaurant/checks/:id/payment-session | Staff | Mints token + sandbox checkout, stores `restaurant_payment_sessions` |
| GET /api/restaurant/payment-sessions/:id/status | Staff | Polling endpoint |
| GET /api/public/restaurant/pay/:token | Public | Bill view, refuses if items 86'd or expired |
| POST /api/public/restaurant/pay/:token/confirm | Public | Commits tip, redirects to sandbox |

`handleRestaurantPayWebhook` (exported `:359`) is invoked by sandbox webhook to finalise the sale (creates `sales` row, copies seat-tracked `sale_items`, captures tip via `tip_captures`, flips table session to `dirty`).

### 3.6 `restaurant/reservations.js` — Reservations admin

Gate (`:20`): `requireMode("restaurant"), requireFeature("phase4_restaurant_reservations"), requirePerm("manage_restaurant")`. **TABLE MISSING — §8.**

GET, GET/:id, POST, PUT/:id, DELETE/:id (only terminal states), POST /:id/send-sms (templates: confirmation, reminder, cancellation).

### 3.7 `restaurant/waitlist.js` — Walk-in queue

Same gate. **TABLE MISSING — §8.** `compactPositions` re-numbers 1..N on every state change.

GET, POST, PUT/:id/notify (SMS via `sms.sendSms`), PUT/:id/seat (creates table session best-effort), DELETE/:id.

### 3.8 `restaurant-inbox.js` — Online order inbox

Gate (`:16`): `requireMode("restaurant"), requireFeature("phase4_restaurant"), requirePerm("manage_restaurant")`. Uses `online-inbox.js` service.

| Method + path | Notes |
|---|---|
| GET /api/restaurant/inbox | Filter by `?status=, ?source=` |
| POST /api/restaurant/inbox/:id/accept | Creates draft + tickets via `inbox.acceptOnlineOrder` |
| POST /api/restaurant/inbox/:id/reject | Reason required |

### 3.9 `restaurant-kiosk.js` — Order kiosk tokens (yesterday's commit)

Gate (`:18`): `requireMode("restaurant"), requireFeature("phase4_restaurant_qr"), requirePerm("manage_restaurant")`.

| Method + path | Notes |
|---|---|
| POST /api/restaurant/kiosk-tokens | Body: `{outlet_id, table_id?, label?}`. Counter (no table_id) → `restaurant_kiosk_slots` row. Table → `draft_orders` with `source_token_id` UUID |
| GET /api/restaurant/kiosk-tokens | Returns counters[], tables[], available_tables[] |
| DELETE /api/restaurant/kiosk-tokens/counter/:id | Soft revoke (sets `revoked_at`) |
| DELETE /api/restaurant/kiosk-tokens/table/:id | Cancels open table draft |

### 3.10 `public-restaurant.js` — Public QR menu / kiosk

No gate — mounted before tenant middleware (`registerAllRoutes.js:172`). Tenant resolved via `?tenant=<slug>` (`resolvePublicTenantDb`). Rate-limited via `publicRestaurantLimiter`.

| Method + path | Notes |
|---|---|
| GET /api/public/restaurant/menu/:token | Counter slots: lazy-mints fresh draft. Table tokens: returns existing open dine_in draft. Filters out 86'd items. Day-parting filter applied if flag on (`:122`) |
| POST /api/public/restaurant/checks/:token/items | Adds item to draft. Refuses 86'd (`:168` → 422), refuses off-schedule when day-parting on (`:178` → 422) |
| POST /api/public/restaurant/checks/:token/submit | Counter: snapshots to `web_orders`/`web_order_items` and frees slot. Table: stamps `submitted_at`, leaves draft open |

### 3.11 `public-reservations.js`

No gate — public. Rate-limited by `webhookLimiter`.

| Method + path | Notes |
|---|---|
| GET /api/public/restaurant/reservations/:slug/availability?date= | 30-min slots 09:00–22:00 |
| POST /api/public/restaurant/reservations/:slug | Inserts into `reservations` (TABLE MISSING — §8) |

### 3.12 `kds.js`

Gate (`:11`): `requireMode("restaurant"), requireFeature("phase4_restaurant_kds"), requirePerm("manage_kds")`.

GET/POST/PUT /api/kds/stations, GET/POST/PUT/DELETE /api/kds/routes, GET /api/kds/tickets?station_id=, POST /api/kds/tickets/:id/bump, /:id/recall.

### 3.13 `modifiers.js` — Modifier groups + options

**Gate weak:** only `requireFeature("phase4_restaurant")` — NO `requireMode`. Read gate (`:20`): `requireFeature + requireAnyPerm(["manage_restaurant", "manage_inventory"])`. Write gate (`:21`): `requirePerm("manage_restaurant")`.

GET/POST/PUT/DELETE /api/modifiers/groups, /options, /api/products/:id/modifier-groups, /api/products/:id/modifier-tree, POST /api/modifiers/attach.

### 3.14 `tips.js` — Tip pools

Gate (`:21`): `requireFeature("phase4_restaurant"), requirePerm("manage_tips")`. NO `requireMode`.

GET/POST /api/tips/pools, POST /api/tips/pools/:id/{close,distribute,void}, GET/POST/PUT /api/tips/distribution-rules, GET /api/tips/payouts.

### 3.15 `reports/kds-analytics.js`, `reports/menu-engineering.js`

Mounted under `/api/reports/*` orchestrator — gate not inspected here, but route paths `/api/reports/kds-analytics` and `/api/reports/menu-engineering` exist.

---

## Section 4 — Restaurant-specific frontend pages

### 4.1 Admin pages (`frontend/src/pages/redesign/`)

Routes pulled from `frontend/src/routes/appRoutes.jsx:243-256`. All wrapped with `RequirePerm`.

| File | Route path | Perm | Internal flag check | Renders | Implicit dependencies |
|---|---|---|---|---|---|
| `RestaurantFloorRedesign.jsx` | /restaurant/floor | manage_restaurant | reads `phase4_restaurant` via `useFeatureFlags`, redirects if off | Floor plan grid, table sessions, 10s polling | At least one floor plan + tables; outlet context |
| `RestaurantChecksRedesign.jsx` | /restaurant/checks | manage_restaurant | `phase4_restaurant` | Open checks list, fire course, hold/expedite, split modal | Outlet, tables, draft_orders |
| `restaurant/Restaurant86Redesign.jsx` | /restaurant/availability | manage_restaurant | `phase4_restaurant_86` | List of 86'd products + variants | Products exist |
| `restaurant/VoidReasonsAdminRedesign.jsx` | /restaurant/void-reasons | all_access | `phase4_restaurant_void_comp` | Reason code admin (raw fetch — see CLAUDE.md note in pages/redesign/CLAUDE.md) | **`void_reason_codes` table — MISSING §8** |
| `restaurant/MenuSchedulesRedesign.jsx` | /restaurant/menu-schedules | manage_restaurant | `phase4_restaurant_day_parting` | 7-col × 24-row weekly grid + editor | **`menu_schedules` table — MISSING §8**; products to pin |
| `restaurant/ReservationsRedesign.jsx` | /restaurant/reservations | manage_restaurant | `phase4_restaurant_reservations` | Date picker + reservation list, status workflow, SMS | **`reservations` table — MISSING §8** |
| `restaurant/WaitlistRedesign.jsx` | /restaurant/waitlist | manage_restaurant | `phase4_restaurant_reservations` | Walk-in queue cards, position badges, seat-picker modal | **`waitlist_entries` table — MISSING §8**; tables to seat into |
| `ModifierGroupsRedesign.jsx` | /restaurant/modifiers | manage_restaurant | `phase4_restaurant` | List + per-group option editor modal | None beyond schema |
| `RestaurantInboxRedesign.jsx` | /restaurant/inbox | manage_restaurant | `phase4_restaurant` | Online order queue (Shopify/Daraz/WhatsApp/FB/QR), 10s poll | KDS stations configured (so accepted orders fire to kitchen) |
| `KDSRedesign.jsx` | /kds | manage_kds | `phase4_restaurant_kds` (`KDSRedesign.jsx:52`) | 3-tab: tickets / routes / stations. 5s ticket auto-refresh | KDS stations created; products + categories; printers configured for routing |
| `TipPoolsRedesign.jsx` | /tips | manage_tips | `phase4_restaurant` | 3 tabs: pools / rules / payouts | Open shift; sales with `tip_captures` |
| `OrderKiosksRedesign.jsx` | /order-kiosks | manage_restaurant | `phase4_restaurant_qr` | Counter + table token launcher | Tables for table-mode (counter mode works without) |
| `POSRestaurantRedesign.jsx` | /pos/restaurant | (auth only) | `usePreset().hasMode("restaurant")` redirect (`:147`) | Composes POSRedesign modals + 7 restaurant ones | Outlet, open shift, attendance, floor plan/tables for floor view |

### 4.2 Restaurant POS components (`frontend/src/pages/redesign/pos/restaurant/`)

| File | Purpose |
|---|---|
| RestaurantFloorGrid.jsx | Floor plan grid for table selection / session mgmt |
| RestaurantCheckView.jsx | Open-check detail: items by seat/course, modifiers |
| RestaurantHeader.jsx | Check #, table, server, status |
| RestaurantOverflowMenu.jsx | Overflow actions |
| RestaurantActionBar.jsx | Action bar |
| RestaurantCartGrouped.jsx | Seat/course grouped cart |
| RestaurantGuestModeModal.jsx | Guest mode toggle |
| RestaurantAvailabilityModal.jsx | Quick 86-an-item modal |
| SplitCheckModal.jsx | even / by_amount / by_seat / by_item splits |
| TransferTableModal.jsx | Move check to different table |
| VoidCompModal.jsx | Manager PIN void/comp |
| PayAtTableQRModal.jsx | QR to /pay/:token; auto-closes on payment success |
| SeatCoursePicker.jsx | Seat/course assignment helper |
| ReservationBadge.jsx | Reservation indicator |
| cartGrouping.js | Pure grouping helpers |

### 4.3 KDS sub-component

`frontend/src/pages/redesign/kds/KdsStationSettingsModal.jsx` — per-station settings (balance strategy, target prep time, printer selection).

---

## Section 5 — Public/customer-facing restaurant surfaces

| Surface | Path pattern | Auth | Backend route | Diner can | Staff prereq |
|---|---|---|---|---|---|
| QR menu | `/menu/:token` (`publicRoutes.jsx:168-171`) | None — token + tenant slug | `GET /api/public/restaurant/menu/:token`, `POST /api/public/restaurant/checks/:token/items`, `POST /api/public/restaurant/checks/:token/submit` | Browse menu (excl. 86'd, off-schedule), add items, submit | Mint token via `/order-kiosks` (counter slot) or scan code minted per table; products `status=active` & not `is_sold_out`; if day-parting on, schedules configured |
| Pay-at-table | `/pay/:token` (`publicRoutes.jsx:172-176`) | None — token | `GET/POST /api/public/restaurant/pay/:token` | View bill (with seat split), choose tip, route to sandbox checkout | Cashier opens session via `POST /api/restaurant/checks/:id/payment-session` from POS |
| Public reservation | `/reserve/:tenantSlug` (`publicRoutes.jsx:177-181`) | None — slug | `GET /api/public/restaurant/reservations/:slug/availability`, `POST /api/public/restaurant/reservations/:slug` | Pick date, see 30-min slots, submit booking | **`reservations` table must exist (MISSING §8)** |
| Customer kiosk (counter) | `/menu/:token` mode=counter | None | Same as QR menu | Same as QR menu — slot auto-mints fresh draft after each submit | Mint counter slot via `/order-kiosks` |
| Customer kiosk (table) | `/menu/:token` mode=table | None | Same | Add to existing table draft; cannot submit final pay (server submits) | Mint table token; one open dine_in draft per table |
| Public receipt | `/receipt/:invoiceNumber` (`publicRoutes.jsx:108`) | None — slug query | `/api/receipts/:invoiceNumber/public` | Read receipt | Sale completed |
| Customer portal | `/portal/:tenantSlug` + nested | Portal JWT | `routes/customer-portal/*` | Tabs: orders, loyalty, profile (per `PORTAL_ENABLED_TABS_BY_PRESET.restaurant`) | Customer signed up + verified OTP |

**Day-parting interplay:** `public-restaurant.js:118-126` and `:172-181` both branch on `phase4_restaurant_day_parting`. If flag on but schedules missing/empty → `filterAvailableProducts` returns full list (open by default).

**Tenant slug discovery:** Public pages need `?tenant=<slug>` query (or `x-tenant-slug` header). The `/menu/:token` path hardcodes `?tenant=` in the kiosk URL builder (`OrderKiosksRedesign.jsx:32-37`). For pay-at-table the QR generated by staff side has the slug in the URL.

---

## Section 6 — Background workers triggered by restaurant flows

Worker registration source: `backend/boot/workers.js`.

| Worker file | Env var | Schedule | What it does | State expected | Failure mode |
|---|---|---|---|---|---|
| `course-release-worker-boss.js` | `COURSE_RELEASE_WORKER_ENABLED=1` | (continuous, pg-boss) `boot/workers.js:333-336` | Releases held courses (`restaurant_course_fires.status=held` past `hold_until`) and fires to KDS | `restaurant_course_fires` table; KDS stations configured | Errors logged per tenant; one failure doesn't block others |
| `reservation-reminder-worker-boss.js` | `RESERVATION_REMINDER_WORKER_ENABLED=1` | (pg-boss) `:343-346` | Sends SMS reminders for confirmed reservations near their start time | **`reservations` table MISSING — §8**; SMS provider configured | Silent skip if no SMS provider |
| `kds-load-snapshot-worker-boss.js` | `KDS_SNAPSHOT_WORKER_ENABLED=1` | (pg-boss) `:338-341` | Snapshots KDS station load (open ticket count, avg prep time) → drives KDS Analytics report | `kds_tickets`, `kds_stations` | If `kds_station_load_snapshots` table missing, skips |
| `reservation-worker-boss.js` | `RESERVATION_WORKER_ENABLED=1` | (pg-boss) `:280-283` | Expires stale **inventory** reservations (storefront, not table reservations — confusing naming) | `inventory_reservations` (different table from `reservations`) | Per-tenant logged |
| `retail-digest-worker-boss.js` | `RETAIL_DIGEST_WORKER_ENABLED=1` | Monday 08:00 UTC (pg-boss) `:320-323` | Weekly email digest, gated by `retail_weekly_digest` flag (which IS on for restaurant tenants — `RESTAURANT_SEED_FLAGS`) | `sales` data | Silent skip if no email |
| `shift-auto-close-worker-boss.js` | `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1` | Hourly (pg-boss) `:328-331` | Force-closes shifts older than `shift_auto_close_hours` | Restaurant-agnostic | Per-tenant |
| `hold-expiry-worker-boss.js` | `HOLD_EXPIRY_WORKER_ENABLED=1` | (pg-boss) `:295-298` | Expires stale holds. **Restaurants don't typically have holds** — flag `phase2g_holds` is OFF for restaurants — but worker doesn't filter by industry, so it iterates all tenants. | `holds` table | No-op if empty |
| `marketplace-sync-worker-boss.js` | `MARKETPLACE_SYNC_WORKER_ENABLED=1` | 10 min (pg-boss) `:275-278` | Polls marketplace orders. Restaurant tenants rarely use this. Inert if no integrations connected. | `integration_settings` | Per-tenant |

**Railway env vars to verify before walkthrough** (cannot read without `railway` CLI; require user verification):
- `COURSE_RELEASE_WORKER_ENABLED` — for held-course feature
- `RESERVATION_REMINDER_WORKER_ENABLED` — for SMS reminders
- `KDS_SNAPSHOT_WORKER_ENABLED` — for KDS Analytics
- `RETAIL_DIGEST_WORKER_ENABLED` — for weekly digest

If unset on Railway, the worker silently does nothing — features will appear broken without obvious error.

---

## Section 7 — End-to-end flows that should work

For each flow: UI sequence + backend writes. Restaurant-relevant assumptions noted.

### Flow 1 — Floor plan setup → table session → check → fire → KDS → pay → close

1. **Floor Plan**: `/restaurant/floor` → `POST /api/restaurant/floor-plans` → `POST /api/restaurant/tables` (multiple).
2. **Open table session**: tap table on floor → `POST /api/restaurant/table-sessions` `{table_id, guest_count}` → row in `restaurant_table_sessions`.
3. **Create check**: `/restaurant/checks` or POS → `POST /api/restaurant/checks` → `draft_orders` row, `order_context='dine_in'`, linked `table_session_id`.
4. **Add items**: POS adds via `draft_order_items`. Each item carries `course_name`, `seat_number`.
5. **Fire course**: `POST /api/restaurant/checks/:id/fire-course` → service writes `restaurant_course_fires` and calls `kds.sendToKitchen` → `kds_tickets` rows. If `phase4_restaurant_fire_chits` on, prints chits per station.
6. **KDS bump**: `/kds` → `POST /api/kds/tickets/:id/bump` → ticket flips to `bumped`.
7. **Pay-at-table**: cashier opens `PayAtTableQRModal` → `POST /api/restaurant/checks/:id/payment-session` → `restaurant_payment_sessions` row + sandbox checkout URL. **TABLE MISSING — §8**. Diner scans → `/pay/:token` → `POST /api/public/restaurant/pay/:token/confirm` → sandbox webhook → `handleRestaurantPayWebhook` creates `sales` row, `sale_items` (with `seat_number`), `tip_captures`, marks draft `completed`, table session `dirty`.

**Retail bleed-through risk:** sample products were seeded with `outlet_stock.quantity=100`, but menu items typically aren't decremented. The retail "Opening Stock" bug from livetest1 (silent drop on first sale because stock was 0) — confirmed not a problem here because `seedPresetData` always seeds 100. But if owner deletes sample products and adds real menu items, they may NOT seed initial stock — and the existing sale code path in retail does decrement stock. Need to check whether `sales` POST decrements stock for restaurant-mode sales.

### Flow 2 — Walk-in tab → modifier selection → split bill by seat → tip pooling → close

1. POS → "Open Tab" → `POST /api/restaurant/tabs` → `restaurant_tabs` row.
2. Add item with modifier → `POSModifierModal` → adds `draft_order_item_modifiers` rows.
3. Split: `POST /api/restaurant/checks/:id/split` `{split_type: "by_seat"}`.
4. Each split check pays separately → multiple `restaurant_payment_sessions` (TABLE MISSING).
5. Tips captured → `tip_captures` rows linked to `tip_pools.id` for the day.
6. End of night: `/tips` → distribute pool by chosen rule → `tip_pool_payouts` rows.

### Flow 3 — Reservation → seat → order → settle

1. Public diner: `/reserve/:slug` → `POST /api/public/restaurant/reservations/:slug` → `reservations` row (TABLE MISSING).
2. Reminder SMS at T-2h via reservation-reminder-worker.
3. Staff: `/restaurant/reservations` → `PUT /api/restaurant/reservations/:id` `{status: 'seated', table_id}`.
4. Then standard table session/check flow.

### Flow 4 — Online inbox order → fire → ready → handoff

1. External order arrives via web_orders insert (Shopify/Daraz webhook OR public kiosk submit).
2. Inbox: `/restaurant/inbox` → `POST /api/restaurant/inbox/:id/accept` → service creates `draft_order` + sends to kitchen.
3. KDS shows ticket, bumps when ready.
4. Server hands off; standard cash/card sale completes the draft.

### Flow 5 — Counter Order Kiosk (yesterday's commit 86f9e84)

1. Manager mints counter slot at `/order-kiosks` → `POST /api/restaurant/kiosk-tokens` (no table_id) → `restaurant_kiosk_slots` row.
2. Customer scans/visits `/menu/:token?tenant=<slug>` → `resolveKioskToken` lazy-mints `draft_orders` (`order_context='kiosk_counter'`).
3. Adds items → `POST /api/public/restaurant/checks/:token/items`.
4. Submits → `POST /api/public/restaurant/checks/:token/submit` → snapshots draft into `web_orders`/`web_order_items`, frees slot's `current_draft_order_id`.
5. Staff sees `web_order` with `source='kiosk'` in inbox → accept → fires to KDS.

### Flow 6 — Table Order Kiosk

1. Manager mints table token at `/order-kiosks` → POST with `table_id` → `draft_orders` row with `source_token_id` UUID, `order_context='dine_in'`.
2. Diner at table scans QR → same `/menu/:token` resolves table-mode.
3. Diner adds items → `draft_order_items` against existing draft (one open dine_in draft per table).
4. Server confirms via Checks page → fires to KDS via standard flow (no inbox involvement, per `public-restaurant.js:208-210` comment).

### Flow 7 — QR menu (read-only browse)

Same `/menu/:token` URL but if no order → diner can browse and call server. The bookmark on a table is the same path; it's the same data.

### Flow 8 — Day-parting: lunch 11–15, dinner 18–23

1. Manager: `/restaurant/menu-schedules` → create schedule (TABLE MISSING).
2. Pin products to schedule.
3. POS / kiosk / QR menu filter by `menu-schedule-resolver.isProductAvailableNow` when `phase4_restaurant_day_parting` on.

### Flow 9 — 86'd item

1. Manager: `/restaurant/availability` or POS overflow → `POST /api/restaurant/products/:id/sold-out`.
2. POS, kiosk, QR menu filter via `is_sold_out=true`.
3. Pay-at-table refuses session if any item now 86'd (`pay-at-table.js:57-67`).

### Flow 10 — Comp/void with manager PIN approval

1. Server adjusts a `sale_item` → POS `VoidCompModal` → `POST /api/restaurant/sale-items/:id/adjust` with manager PIN.
2. `verifyManagerPin` checks bcrypt hash. Inserts `sale_item_adjustments` row (TABLE MISSING).
3. Sales total NOT mutated — accounting reconciles via adjustments table.

### Flow 11 — Tip capture → pool → payout

1. Cashier captures tip via `tip_captures` (POS or pay-at-table).
2. End of shift: pool open via `POST /api/tips/pools` → close → distribute by chosen rule → payouts.

### Flow 12 — Menu engineering

`Reports → Menu Engineering` (`/reports/menu-engineering`) — pulls from `sales`, `sale_items` (cost_price_at_sale captured), categorises stars / dogs / puzzles / plowhorses by margin × velocity. Requires real sales history — fresh tenant has none.

### Cross-flow concerns

- **Sale stock decrement for menu items**: need to verify `routes/sales.js` does NOT decrement `outlet_stock` when product has no real inventory tracking. Risk: sample products go to qty=0 after 100 sales, then POS refuses sales unless `out_of_stock_policy` allows. Walkthrough must test this.
- **Tax mode = none + FBR flag ON**: tenant said "No GST" but PK country pack still flips `fbr_integration` ON. The wizard's branching may suppress FBR Settings or it may show — need to walk through (see §8 finding).
- **Public menu tenant resolution**: `/menu/<token>` requires `?tenant=<slug>` — anyone embedding the URL must include it. The kiosk launcher does (`OrderKiosksRedesign:32-37`), but anyone hand-typing the path will hit `TENANT_NOT_FOUND` from `resolvePublicTenantDb`. Test paths need to verify slug presence.

---

## Section 8 — Known gaps / risks

### 8.1 LAUNCH-BLOCKERS (must fix before merchant onboarding)

#### A) Schema drift — 6 tables missing on fresh tenants

**Source of bug:** `backend/tenant-provisioner-pg.js:78-93` runs `schema-pg.sql` to create tables, then INSERTs `schema_version` rows for ALL `MIGRATIONS` (1..N) marking them applied. The migration runner (`migrate-pg.js`) checks `schema_version` and skips applied versions. So when `schema-pg.sql` is missing tables that v59 / v61 added, those tables are never created.

**Live tenant verification:**
- `MAX(version)` in `tenant_sanoposlivetest1778021564659.schema_version` = **85** ✅
- Public schema also at v85 ✅
- v59, v61 marked applied ✅
- BUT `to_regclass('tenant_sanoposlivetest1778021564659.void_reason_codes') = NULL` ❌
- BUT `to_regclass('tenant_sanoposlivetest1778021564659.menu_schedules') = NULL` ❌
- BUT `to_regclass('tenant_sanoposlivetest1778021564659.reservations') = NULL` ❌
- BUT `to_regclass('tenant_sanoposlivetest1778021564659.waitlist_entries') = NULL` ❌

`grep` in `schema-pg.sql` confirms `void_reason_codes`, `menu_schedules`, `menu_schedule_products`, `reservations`, `waitlist_entries`, `restaurant_payment_sessions`, `sale_item_adjustments` are NOT in the file. Only `restaurant_check_seats`, `tip_captures`, `tip_pools`, `tip_pool_payouts`, `restaurant_course_fires`, `kds_station_routes`, `restaurant_kiosk_slots` are.

**Affected features (will all 500 on a fresh restaurant tenant):**
- Void/Comp (manager PIN): `routes/restaurant/void-comp.js` reads `void_reason_codes`, writes `sale_item_adjustments`
- Menu schedules / day-parting: `routes/restaurant/menu-schedules.js` reads/writes `menu_schedules`, `menu_schedule_products`
- Reservations admin + public: `routes/restaurant/reservations.js`, `routes/public-reservations.js`
- Waitlist: `routes/restaurant/waitlist.js`
- Pay-at-table: `routes/restaurant/pay-at-table.js` writes `restaurant_payment_sessions`
- POS adjustment audit (used by webhook reconciliation): `pay-at-table.js:336` references `sale_item_adjustments`

**Fix path** (out of scope for discovery — for the walkthrough plan to capture as remediation tickets):
1. Add the missing CREATE TABLE statements to `schema-pg.sql` so fresh provisioners create them.
2. For existing tenants like `sanoposlivetest1778021564659`: either DELETE rows from their `schema_version` for versions 59 + 61 and re-run migrations, OR run the CREATE TABLE statements manually.

#### B) Manager role missing 13 perms (Phase 4 / vertical perms)

**Source of bug:** `backend/routes/setup.js:22-34` hardcodes:
```js
const ROLE_PERMISSIONS = {
  Administrator: ['all_access'],
  Manager: ['manage_inventory','manage_orders','view_reports','manage_employees',
            'pos_discount','void_sales','pos_park','pos_void'],   // 8 perms
  Cashier: ['view_reports','pos_discount','pos_park'],
};
```

But `backend/middleware/permissions.js:37-68` defines the canonical Manager permission list with 21 entries including `manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`.

`ensureDefaultRolePermissions(db)` at `routes/registerAllRoutes.js:232` is called once per boot with the public-schema `db` pool — NOT per-tenant. It SELECTs from `public.roles` (which has no rows because public has no `roles` table for tenants). So back-fill never happens.

**Live tenant verification (`SELECT name, COUNT(rp.permission)` ...):**
- Admin (id=1): 10 perms (provisioner's `ALL_PERMISSIONS` array including `all_access`) ✅ — admin works
- **Manager (id=2): 8 perms** — missing `manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans` ❌
- Cashier (id=3): 3 perms — missing `pos_void` (which IS in `setup.js:34` Cashier list — wait, no: `setup.js:34` Cashier = `['view_reports','pos_discount','pos_park']` — no `pos_void` for Cashier in setup.js)

**Effect:** any non-Admin restaurant employee gets 403 on EVERY restaurant route. Cashier can't open checks; Manager can't fire courses, run KDS, manage void/comp, run tip pools.

#### C) Owner employee `role` text column says "Cashier"

**Source of bug:** `setup.js:355-363` inserts new admin employee with `role='Administrator'`. But provisioner's `setup.js:343-353` UPDATE branch updates `name` + `pin_hash` only, leaving the `role` text column from provisioner's INSERT. Provisioner inserts at `tenant-provisioner-pg.js:118-121`:
```js
INSERT INTO employees (name, pin_hash, role_id) VALUES ('Admin', $1, $2)
```
No `role` text value — so it likely defaults to whatever the column default is.

**Live tenant verification:** owner employee row has `role_id=1` (correct, points to Admin role) but `role='Cashier'` (wrong). The middleware uses `role_id` for permissions, so functionally the owner has all_access via the role join. But anywhere the UI displays `employee.role` directly will say "Cashier".

Lower-severity than A/B but should be flagged.

### 8.2 NON-BLOCKING risks worth covering in walkthrough

#### D) Sample products have no FBR HS code / tax rate inheritance

`backend/seeds/preset-seed-data.js:137-153` inserts sample products with `name, price, category_id` only. No `hs_code`, no `tax_rate_override`. Tenant's `tax_mode='none'`, so probably moot — but if an owner flips tax_mode later or moves to FBR, the samples need cleanup.

#### E) `routes/modifiers.js` and `routes/tips.js` lack `requireMode` check

Both gate on `requireFeature("phase4_restaurant")` only (`modifiers.js:20-21`, `tips.js:21-22`). For a restaurant tenant this is fine. But if an admin manually flips `phase4_restaurant` ON for a retail tenant (e.g. via `/admin/tenants/:id/feature-flags`), modifiers/tips routes would activate without `tenant_modes.restaurant`. Not a launch blocker; a defense-in-depth gap.

#### F) `routes/restaurant-inbox.js` requires `phase4_restaurant` but inbox can be empty

If no `web_orders` rows of type `kiosk` / `daraz` / `shopify` — page is empty. That's normal but the walkthrough should verify the empty state renders cleanly, not as a 500.

#### G) Onboarding checklist may not surface restaurant-specific steps

`industry-config.js:51` `restaurant.onboarding_steps = ["store","menu_item","floor_plan","shift","order"]`. The dashboard onboarding widget (`frontend/src/pages/dashboard/DashboardOnboarding.jsx` per pages/CLAUDE.md note line 149) uses `usePreset().onboarding_steps`. But the actual implementation of each step (label, "done" detection, action button URL) lives somewhere — need to verify that "menu_item" and "floor_plan" steps render with restaurant-appropriate copy and link to `/inventory` (or a future menu-builder) and `/restaurant/floor` respectively. Not verified in this discovery; flag for walkthrough.

#### H) Cafe vs restaurant divergence

`industry-config.js:114-139` cafe is functionally a restaurant (same `mode: ["restaurant"]`, same flags via `setup.js:279`) BUT:
- `dashboard_widgets.floor_plan = false` (no floor view on dashboard for cafe)
- `labels.customer = "Customer"` (not "Guest")
- `onboarding_steps` includes `employees` instead of `floor_plan`

Cafe walkthrough should be a separate signup at minimum to confirm UI text differences; backend behaviour is identical to restaurant.

#### I) Public restaurant menu requires `?tenant=` query everywhere

`/menu/:token`, `/pay/:token`, `/reserve/:slug` all need the slug. If a manager copies the URL without it, `resolvePublicTenantDb` returns 4xx. The OrderKiosksRedesign launcher includes the slug, but if a printed QR points to a URL without slug it'll break. Walkthrough should verify QR codes generated from `kiosk-tokens` always carry the slug.

#### J) Day-parting "no schedule = always available"

`menu-schedule-resolver.js` per `public-restaurant.js:122-126`: when `phase4_restaurant_day_parting` flag is ON but no schedules exist, `filterAvailableProducts` returns the full menu. So flipping the flag without configuring schedules is harmless. But once schedules exist, products NOT pinned to any schedule remain always-available; only pinned products are restricted. Worth verifying expectation matches behavior.

#### K) Pay-at-table requires `PAYMENT_GATEWAY=sandbox` to actually complete

`pay-at-table.js:96` calls `paymentGateway.getPaymentAdapter("sandbox")` directly. If `PAYMENT_GATEWAY` env var on Railway is unset or `manual`, the sandbox adapter still works (it's invoked by name), but the webhook completion path requires the sandbox webhook flow to be wired. The walkthrough plan should confirm Railway has sandbox payment env vars set.

#### L) FBR + tax_mode=none combination

Tenant has `tax_mode='none'` but country pack PK auto-enabled `fbr_integration`. The walkthrough should verify the FBR sidebar items don't aggressively prompt the merchant to set up FBR (since they declined GST). `frontend/src/ui/FBRPromptBanner.jsx` is opt-in (props-driven), but the sidebar still shows FBR items.

---

## Closing

### Word count
~5,400 words.

### Top 3 surprises / risks
1. **Schema drift between `schema-pg.sql` and `migrate-pg.js`** — at least 6 launch-critical tables for void/comp, day-parting, reservations, waitlist, pay-at-table missing on fresh tenants. The provisioner pre-stamps `schema_version` so the migration runner skips re-applying. This is a system-level bug that affects every new restaurant tenant created since v59 (Phase 2-R Wave B). Severity: launch-blocking.
2. **`setup.js` Manager perm list is stale** — hardcodes the pre-Phase 4 8-perm Manager. The 21-perm list in `middleware/permissions.js` is the spec, but `ensureDefaultRolePermissions` runs against the public pool and never reaches tenant schemas. Every non-Admin employee on a fresh restaurant tenant is functionally locked out of restaurant features. Severity: launch-blocking.
3. **Provisioner role naming + employee `role` text mismatch** — provisioner creates role named `"Admin"` (10 perms), setup.js ON CONFLICT-no-ops on it, owner employee has `role='Cashier'` text but `role_id=1` (Admin). UI surfaces that read the text column will display the wrong role. Severity: cosmetic to medium (depends on how widely the text column is read).

### Suggested time estimate for the walkthrough plan

| Phase | What it covers | Estimated session time |
|---|---|---|
| Phase 0 — Pre-walkthrough remediation | Land schema-pg.sql sync, perm seeding fix, role text bug fix, deploy. Re-verify on test tenant. | 1 day (must precede walkthrough) |
| Phase 1 — Signup + setup wizard | Re-sign up restaurant tenant, verify modes / flags / sample data / preset config / role perms post-setup | 0.5 day |
| Phase 2 — Sidebar + nav coverage | Click every restaurant nav item, verify gates, identify 4 missing nav entries | 0.5 day |
| Phase 3 — Restaurant operational flows (Flows 1-7) | Floor → check → fire → KDS → pay; tab + modifiers + split + tip; reservation → seat; inbox accept → KDS; counter kiosk; table kiosk; QR menu | 2 days |
| Phase 4 — Restaurant operational flows (Flows 8-12) | Day-parting; 86'd item; void/comp with PIN; tip pool distribute + payouts; menu engineering | 1.5 days |
| Phase 5 — Cross-cutting (loyalty, gift cards, FBR opt-out, marketing campaigns SMS, COD, fulfillment, reports) | 1 day |
| Phase 6 — Public surfaces (QR menu, pay-at-table, public reservation, customer portal restaurant tabs) | 0.5 day |
| Phase 7 — Cafe variant signup | Mirror walkthrough on cafe preset to surface UI label differences | 0.5 day |
| Phase 8 — Findings consolidation + ticket triage | 0.5 day |
| **Total** | | **~8 days of focused walkthrough effort, plus 1 day pre-work** |

For comparison: retail walkthrough (`docs/retail-docs/pre-launch-walkthrough-plan-2026-04-27.md`) was structured similarly and surfaced ~10 real bugs. Restaurant has higher feature surface area (12+ flag-gated pages vs retail's ~6) so expect proportionally more findings.

---

*This file is uncommitted by intent — review before committing or before authoring `pre-launch-walkthrough-plan-2026-05-07.md`.*

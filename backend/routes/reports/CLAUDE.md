# Report Routes — Claude Guide

All report routes mount under `/api/reports/*` via standard tenant middleware. Every request has `req.company.timezone`, `deps.db` (tenant-scoped proxy), and standard JWT auth.

## index.js — Orchestrator

Initializes helpers via `helpersInit(db)` then registers all domain modules. Also mounts four extra modules that are not part of the core 9: `fbr-export`, `stock-aging`, `multichannel`, `clinical`, `kds-analytics`, `menu-engineering`.

Returns `{ processPendingReportSchedules }` from the governance module — consumed by `registerAllRoutes.js` to expose a function the report schedule worker can call.

## helpers.js — Shared Utilities (injected as `helpers` into all modules)

All exported functions:
- **`pgWhere(fragments, params, startIdx=1)`** — takes `?`-placeholder fragments, renumbers to `$N` Postgres style. Returns `{ text, values, nextIdx }`. The pattern is used across all report modules.
- **`buildReportFilterParts(req, aliases)`** — builds common WHERE conditions: `voided=false`, `date_from`/`date_to` (UTC-converted), `outlet_id` (multi-value CSV), `employee_id`, `category_id` (expands to leaf descendants). Alias defaults: `s`=sale, `p`=product, `si`=item, `o`=outlet, `e`=employee.
- **`buildCategoryMetaMap()`** — fetches all enriched categories and returns `Map<id, row>` for path lookups.
- **`withCategoryPaths(rows, categoryMeta, sourceKey)`** — enriches rows with `category` and `category_path_label` from enriched category data.
- **`parsePaging(req)`** — `limit` clamp 1–500 (default 100), `offset` clamp 0+.
- **`applyUtcDateFilter`** — for UTC-stored columns (`sales.timestamp`, etc.).
- **`applyLocalDateFilter`** — for locally-stored date columns (`expenses.expense_date`, `grn.received_at`).
- **`nextRunAtIso(frequency, runHour, runMinute)`** — computes next scheduled run timestamp for governance.
- **`toCsvLines(rows, columns, meta)`** — generates CSV with 4-line comment header.
- **`getDescendantLeafIds(id)`** — bound wrapper around `category-tree.js`.
- **`parseJsonObject(raw)`** — safe JSON parse returning `{}` on failure.

**Gotcha**: Helpers use `?` placeholders internally. When building WHERE clauses directly without `pgWhere()` (e.g. governance.js for schedules), route files use Postgres `$N` directly.

## dashboard.js — Dashboard Report

**`GET /api/reports/dashboard`** — no perm/feature guard. Returns a single large payload including: today's and yesterday's revenue/orders, 7-day/30-day trends, 6-month monthly breakdown, top products, top categories, top customers, low-stock items, recent orders. Supports `?outlet_id=` (CSV multi-outlet). Uses timezone-aware bucketing via `toUtcStart`/`toUtcEnd`. Computes elapsed-day normalization for yesterday comparison (same time-of-day comparison, not full-day).

## sales.js — Sales Reports

No feature guards except profit reports. Date params: `date_from`/`date_to`. Common query params: `outlet_id` (CSV), `employee_id`, `category_id`, `brand_id`, `supplier_id`, `search`, `time_from`/`time_to`. All filter via `applySaleTimeFilters()` + `applyProductDimensionFilters()`.

**Routes (no guard):**
- `GET /api/reports/top-salespeople` — revenue per employee
- `GET /api/reports/sales-summary` — daily totals + payment method breakdown + `tax_by_rate` (reads `sale_items.tax_rate_at_sale`, try/catch for pre-v83 installs)
- `GET /api/reports/sales-detail` — flat line items with prorated line total
- `GET /api/reports/order-wise` — one row per sale with total and customer
- `GET /api/reports/monthly-mop-matrix` — pivot: month × payment method
- `GET /api/reports/category-wise` — revenue by category with `path_label`
- `GET /api/reports/subcategory-wise` — like category-wise but with parent context
- `GET /api/reports/item-wise` — product-level units/revenue/cost/profit
- `GET /api/reports/brand-wise` — brand-level with `contribution_pct`
- `GET /api/reports/customer-wise` — customer order count and total (no date filter)
- `GET /api/reports/product-performance` — item-wise sorted by `margin_pct`
- `GET /api/reports/performance-workspace` — 5 parallel queries: items (top 12), categories (top 10), brands (top 10), suppliers (top 10), summary totals
- `GET /api/reports/performance-comparison` — current vs. previous period comparison + monthly trend for items/categories/subcategories/brands/suppliers. Complex SQL: inlines shared filters twice with renumbered $N params.
- `GET /api/reports/refunds-voids` — voids list + refunds list + summary (limit 300 each). Supports time_from/to.
- `GET /api/reports/cashier-wise` — CTE combining sales_agg, void_agg, refund_agg. Uses `pgWhere` with `startIdx` chaining across three CTEs.

**Feature-gated (`reports_profit_layer`):**
- `GET /api/reports/profit-summary` — single-row gross/net profit summary
- `GET /api/reports/profit-by-product` — paginated; sort by revenue/gross_profit/margin_pct/units_sold/product_name
- `GET /api/reports/profit-by-outlet`

## inventory.js — Inventory Reports

Feature flag: `reports_inventory_health_plus` gates some routes.

**Unguarded routes:**
- `GET /api/reports/sales-stock` — all-time sales + current stock per product
- `GET /api/reports/inventory-dump` — full stock snapshot per product per outlet; includes anomaly flags (negative/zero stock). Supports outlet/category/brand/supplier/search filters.
- `GET /api/reports/product-spec` — product master data export
- `GET /api/reports/on-hand` — current stock per product per outlet with filters
- `GET /api/reports/inventory-loss` — stock adjustments classified as loss
- `GET /api/reports/wastage` — wastage adjustments
- `GET /api/reports/replenishment` — products below reorder point
- `GET /api/reports/pricing-exceptions` — products priced below cost or with missing cost
- `GET /api/reports/pricing-margin` — margin analysis across all products
- `GET /api/reports/dead-stock` — products with no sales in 90 days
- `GET /api/reports/forecast-demand` — simple moving-average demand forecast
- `GET /api/reports/product-movement` — in/out movements per product
- `GET /api/reports/str-report` — stock turn ratio
- `GET /api/reports/grn-report` — GRN receiving history
- `GET /api/reports/history-cost` — cost price history
- `GET /api/reports/history-sale` — sale price history
- `GET /api/reports/product-audit` — full product audit trail
- `GET /api/reports/shrinkage` — shrinkage analysis (adjustments vs. expected)

**`requireFeature("reports_inventory_health_plus")`:**
- `GET /api/reports/replenishment-smart` — ML-like demand-based replenishment (uses rolling 30d, seasonal, ABC classification)
- Several advanced health metrics within `replenishment-smart`

## analytics.js — Advanced Analytics

**Unguarded:**
- `GET /api/reports/comparative-trends` — two-period revenue comparison (`period1_from/to`, `period2_from/to`)
- `GET /api/reports/heatmaps` — hour × weekday sales heatmap
- `GET /api/reports/product-mix` — product mix analysis by category contribution
- `GET /api/reports/retail-matrix` — BCG-style revenue vs. margin matrix
- `GET /api/reports/customer-rfm` — RFM scores per customer
- `GET /api/reports/customer-details` — full customer profile with purchase history
- `GET /api/reports/customer-retention` — cohort retention analysis
- `GET /api/reports/customer-capture-rate` — walk-in vs. named customer rate
- `GET /api/reports/outlet-comparison` — per-outlet revenue/margin comparison
- `GET /api/reports/supplier-wise` — purchases by supplier
- `GET /api/reports/returns-by-reason` — return reasons aggregated

**`requireFeature("reports_profit_layer")`:**
- `GET /api/reports/discount-leakage` — discount leakage analysis (gated by `reports_profit_layer`)

**Unguarded (no feature gate):**
- `GET /api/reports/revenue-leaks` — voids/discounts/returns leakage analysis; this route is ungated in `analytics.js`

**`requireFeature("reports_exceptions")`:**
- Route exists in analytics.js for exception detection (specific name varies — check line 654)

## purchasing.js — Purchasing Reports

No perm/feature guards.
- `GET /api/reports/total-purchases` — PO totals by supplier/period
- `GET /api/reports/itemwise-purchases` — per-product purchased quantities/costs
- `GET /api/reports/po-workflow` — PO status funnel (draft→approved→received)
- `GET /api/reports/purchase-orders-report` — flat PO list with status
- `GET /api/reports/procurement-parity` — purchase price vs. sale price comparison

## finance.js — Finance Reports

No perm/feature guards (all require JWT auth only).
- `GET /api/reports/settlement-overview` — cash drawer vs. expected settlement
- `GET /api/reports/payables-receivables` — supplier payables + customer receivables
- `GET /api/reports/supplier-payments-invoices` — invoiced POs vs. payments
- `GET /api/reports/finance-payment-mix` — revenue split by payment method
- `GET /api/reports/gst-output` — GST collected (tax-on-sales)
- `GET /api/reports/gst-type-summary` — GST by rate/category

Date params: `date_from`/`date_to` for most; finance routes use `from`/`to` for some expense-related queries.

## staff.js — Staff Reports

No perm/feature guards.
- `GET /api/reports/labor-performance` — employee hours, sales, and productivity
- `GET /api/reports/loss-prevention` — suspicious patterns per employee (high void rate, high discount, etc.)
- `GET /api/reports/labor-vs-sales` — labor cost vs. revenue correlation
- `GET /api/reports/staff-attribution` — revenue attributed per staff member

## shifts.js — Shift/Cash Reports

No perm/feature guards.
- `GET /api/reports/cash-flow` — opening/closing cash, expected vs. actual
- `GET /api/reports/cash-audit` — cash audit per shift
- `GET /api/reports/shift-summary` — requires `?session_id=` query param (not a date range)
- `GET /api/reports/shift-sales` — sales within a specific shift
- `GET /api/reports/payment-summary` — payment method totals per shift
- `GET /api/reports/all-denominations` — denomination breakdown across shifts
- `GET /api/reports/current-session-zreport` — live Z-report for the active session

## governance.js — Scheduled Reports & Saved Views

**Feature: `reports_scheduled_exports` + perm: `manage_employees`** gates all schedule mutation routes. `GET /api/reports/schedules` also uses `requirePerm("manage_employees")` (not `requireAnyPerm`). Saved view read routes use `requireAnyPerm(["view_reports","manage_employees"])` — that broader permission applies to saved views only, not schedule listing.

Tables: `report_schedules`, `report_schedule_runs`, `report_delivery_log`, `saved_report_views`, `report_definition_versions`, `custom_report_definitions`.

**Scheduled report routes:**
- `GET /api/reports/schedules` — list all schedules
- `POST /api/reports/schedules` — create schedule; body: `name`, `report_key`, `frequency` (`daily|weekly`), `run_hour`, `run_minute`, `recipient`, `export_format` (`csv`), `filters`
- `PUT /api/reports/schedules/:id` — update schedule
- `DELETE /api/reports/schedules/:id`
- `POST /api/reports/schedules/:id/run-now` — immediate manual trigger
- `GET /api/reports/schedules/:id/runs` — run history for a specific schedule
- `POST /api/reports/schedule-runs/:id/deliver` — re-deliver a past run

**Saved views routes:**
- `GET /api/reports/saved-views` — `requireAnyPerm(["view_reports","manage_employees"])` + feature flag
- `POST /api/reports/saved-views` — `requireAnyPerm` + feature flag
- `PUT /api/reports/saved-views/:id` — `requireAnyPerm` + feature flag
- `DELETE /api/reports/saved-views/:id` — `requirePerm("manage_employees")` + feature flag

**Export:**
`processPendingReportSchedules()` — function returned to `index.js` and exposed to the report schedule worker. Iterates due schedules, runs the matching report query, generates CSV via `toCsvLines()`, uploads to R2, sends email via nodemailer (tenant SMTP config).

## fbr-export.js — FBR CSV Export

**`GET /api/reports/fbr-export`** — `requirePerm("all_access")`. Date params: `from` and `to` (not `date_from`/`date_to`). Reads `sale_items.tax_rate_at_sale`, `tax_amount_at_sale`, `hs_code_at_sale` from the snapshot columns (written at sale time). Returns JSON (not CSV directly) — frontend converts to download. Company `ntn`/`strn` comes from `company_profile`.

## stock-aging.js — Stock Aging

**`GET /api/reports/stock-aging`** — `requireAnyPerm(["view_reports","manage_inventory"])`. Accepts: `outlet_id`, `bucket` (age bucket filter), `category_id`, `brand_id`, `supplier_id`, `search`. Age based on most recent GRN received date; products with no GRN get `age_days = 0`.

**Route shadow gotcha**: `stock-aging` routes exist in both `inventory.js` (registered earlier, ungated) and `stock-aging.js` (registered later). Because Express uses first-match registration order, the earlier ungated route in `inventory.js` may shadow the standalone `stock-aging.js` route if the paths collide. Verify actual registration order in `index.js` before assuming the feature-guarded version is the one serving requests.

## multichannel.js — Multi-Channel Reports

No perm guard. Date params: `from`/`to`. Aggregates POS + Shopify + WooCommerce orders.
- `GET /api/reports/multichannel-summary` — per-channel order_count/revenue/aov
- `GET /api/reports/multichannel-daily` — day-by-day channel comparison
- `GET /api/reports/multichannel-products` — top products across all channels

## clinical.js — Clinical Reports

Gate: `requireFeature("phase4_treatment_plans")` + `requirePerm("view_reports")`. Routes are at `/api/reports/clinical/*`.
- `GET /api/reports/clinical/plan-completion` — completion rate by provider and plan title
- `GET /api/reports/clinical/session-attendance` — session attendance rates
- `GET /api/reports/clinical/revenue-per-plan` — revenue attributed to treatment plans
- `GET /api/reports/clinical/patient-retention` — patient return rate
- `GET /api/reports/clinical/lab-turnaround` — lab result turnaround times

## kds-analytics.js — KDS Analytics

Gate: `requireFeature("phase4_restaurant_kds_analytics")` + `requirePerm("view_reports")`. Also uses `requireMode` from feature-flags middleware.
- `GET /api/reports/kds/prep-times` — kitchen display prep time analytics

## menu-engineering.js — Menu Engineering

Gate: `requireFeature("phase4_restaurant_menu_engineering")` + `requirePerm("view_reports")` + `requireMode`. 
- `GET /api/reports/menu-engineering` — Stars/Plowhorses/Puzzles/Dogs classification using revenue × popularity matrix

## Date Parameter Reference

| Module | Params used |
|--------|-------------|
| dashboard, sales, inventory, analytics, purchasing, staff, shifts | `date_from` / `date_to` |
| governance | `date_from` / `date_to` (schedule filters) |
| fbr-export | `from` / `to` |
| multichannel | `from` / `to` |
| analytics (comparative) | `period1_from` / `period1_to` / `period2_from` / `period2_to` |
| shifts (shift-summary) | `session_id` only — no date range |

## Common Gotchas

- **`sales.timestamp` is UTC** — always use `toUtcStart`/`toUtcEnd` from `utils/tz.js`. Never use `date(col)` on `sales.timestamp`.
- **`sale_items.tax_rate_at_sale`** — only exists after migration v83. Code in sales-summary has a try/catch for this.
- **`pgWhere` with `startIdx`** — cashier-wise uses `startIdx` chaining to build one combined SQL from three independent WHERE clauses. When extending that route, continue the chain.
- **`performance-comparison`** — manually inlines shared filter params twice (comparison range + monthly range). The `$N` numbering is complex — read the comments before editing.
- **All routes assume `req.company.timezone`** is set — this comes from `loadCompanyProfile` middleware. Shift report (`shift-summary`) does NOT use timezone-bucketed dates; it uses session_id directly.

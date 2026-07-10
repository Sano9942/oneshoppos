# Report Pages — Claude Guide

Report tab components, orchestrated by `pages/Reports.jsx`. All use `{ api }` named import from `../../api` (same `api.js` object; `api` is also the default export).

`ReportsAudit.jsx` uses `api.raw()` specifically for feature-gate detection (accepts both 403 and 503 as "gated" — see gotcha below). Charts: Recharts (`BarChart`, `AreaChart`, `PieChart`, `LineChart`, `ScatterChart`). CSV exports use `exportCSV(filename, cols, rows)` from `ReportShared.jsx` OR `downloadCsv(headers, rows, filename)` from `utils/csvExport.js` — varies per tab (see each module below); the two have swapped argument order for headers/rows, so don't copy-paste an export call between a `ReportShared`-based tab and a `downloadCsv`-based one without checking argument order.

---

## Shared filter-state hook: `hooks/useReportFilters.js`

Not consumed directly by most tab components below (they receive a `filters` prop shaped by the parent `Reports.jsx` orchestrator instead) — but is the canonical shared filter-state hook for report pages that manage their own local filter state.

```js
DEFAULT_REPORT_FILTERS = { date_from: "", date_to: "", outlet_id: "", employee_id: "", category_id: "" }
useReportFilters(initial?) => { filters, setFilters, query }
```

`query` is a memoized `URLSearchParams` string built from `filters` — empty/whitespace-only values are omitted. Note the default field name is `date_from`/`date_to` — callers using `from`/`to` (see gotcha below) do not source those from this hook's defaults and build their own param objects instead.

---

## `ReportShared.jsx`

Shared utilities re-exported to report tabs.

| Export | Notes |
|--------|-------|
| `fmtDate` | Alias for `fmtUtcDate` from `utils/dates.js` |
| `fmtDateTime` | Alias for `fmtUtcDateTime` from `utils/dates.js` |
| `exportCSV(filename, cols, rows)` | Inline blob export. `cols` can be strings or `{ header, key }`. Uses `="value"` trick for keys in `CSV_TEXT_KEYS` Set (`barcode`, `sku` only) to force text in Excel and preserve leading zeros |
| `ExportButton` | Small download-icon button that triggers `onClick` |
| `TableShell` | Scrollable table (`max-h-[70vh]`, sticky header, `min-w-180`). Props: `cols`, `loading`, `empty`, `emptyIcon`, `children` |
| `DateRangeFilter` | Date range + optional search input. Props: `dateFrom`, `setDateFrom`, `dateTo`, `setDateTo`, `search?`, `setSearch?`, `searchPlaceholder?` |
| `CardShell` | Card wrapper with header/subtitle/action. Props: `title`, `subtitle?`, `action?`, `children` |
| `MetricCard` | Stat card with up/down comparison. Props: `title`, `value`, `compPct`, `compLabel` |

---

## Date/time param convention (read before adding a new tab)

**Most tabs use `date_from` / `date_to`** (never `start`/`end`). Several also add `time_from`/`time_to` for intraday filtering (sales/catalog/finance modules).

**Exceptions that use `from` / `to` instead:**
- `ReportsMultichannel.jsx` — `MultichannelTab` and its internal `DailyTrendsSection`, `TopProductsSection` (via local `buildParams()`)
- `ReportsCommissions.jsx` — `CommissionSummaryTab` (reads `filters.from`/`filters.to` from the parent)
- `KdsAnalyticsTab.jsx` — own local `from`/`to` state
- `MenuEngineeringTab.jsx` — own local `from`/`to` state
- `FBRExportTab.jsx` — own local `from`/`to` state, passed straight to `api.get("/api/reports/fbr-export", { from, to })`

**`ARAgingTab.jsx` uses neither** — it's a point-in-time snapshot report keyed by `as_of` (single date, defaults to today), not a range. Also accepts `outlet_id` built from `filters.outletIds`.

**Shift-locked tabs** (use `session_id` from `filters.shiftId`, skip date params entirely): `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`.

`CashFlowTab` uses `date_from`/`date_to`, NOT `session_id`. `DenominationsTab` uses `session_id` if set, but does not require it (falls back to recent records across sessions).

Before wiring a new tab's fetch, check which convention its module already uses — mixing `from`/`to` and `date_from`/`date_to` inside the same file is the most common copy-paste bug in this directory.

---

## Timestamp gotcha

- **`ReportsStaff.jsx` `AttendanceTab`** — uses `parseLocalDate` for `check_in`/`check_out` display (attendance is a LOCAL-time column, not UTC). All other report files use UTC formatters (`fmtDate`/`fmtDateTime` from `ReportShared`, or `fmtUtcDateTime` directly).
- **`ReportsCommissions.jsx`** — uses `fmtUtcDateTime` from `utils/dates.js` directly (not via `ReportShared`).

---

## Barrel files (no components — re-exports only)

**`ReportsSales.jsx`** re-exports:
- `OverviewTab` ← `ReportsSalesOverview.jsx`
- `SalesSummaryTab`, `MonthlyMOPMatrixTab`, `SubcategoryWiseTab` ← `ReportsSalesCore.jsx`
- `SalesDetailTab`, `OrderWiseTab`, `ItemWiseTab` ← `ReportsSalesDetail.jsx`
- `RefundsVoidsTab`, `CashierWiseTab`, `DailyOperationsTab` ← `ReportsSalesOperations.jsx`

**`ReportsInventory.jsx`** re-exports:
- `SalesStockTab`, `InventoryDumpTab`, `OnHandTab` ← `ReportsInventoryCore.jsx`
- `ProductPerformanceTab`, `BrandWiseTab`, `MerchandisingWorkspaceTab` ← `ReportsInventoryAnalytics.jsx`
- `PricingMarginTab`, `DeadStockTab`, `StockAgingTab`, `ShrinkageTab` ← `ReportsInventoryHealth.jsx`
- `ReplenishmentTab`, `StockoutRiskTab`, `ForecastDemandTab`, `ReplenishmentSmartTab` ← `ReportsInventoryReplenishment.jsx`

When adding a new sales or inventory tab, add the component to the underlying `*Core`/`*Analytics`/`*Health`/`*Replenishment`/`*Detail`/`*Operations`/`*Overview` file, then re-export it from the barrel — don't put new components directly in the barrel file.

---

## Sales module (`ReportsSalesOverview.jsx`, `ReportsSalesCore.jsx`, `ReportsSalesDetail.jsx`, `ReportsSalesOperations.jsx`)

| Tab | Endpoint | Extra params |
|-----|----------|-------------|
| `OverviewTab` | `GET /api/reports/dashboard` | `outlet_id` only |
| `SalesSummaryTab` | `GET /api/reports/sales-summary` | `date_from`, `date_to`, `time_from`, `time_to`, `category_id`, `brand_id`, `outlet_id` |
| `MonthlyMOPMatrixTab` | `GET /api/reports/monthly-mop-matrix` | `date_from`/`date_to`/`time_from`/`time_to`/`outlet_id` |
| `SubcategoryWiseTab` | `GET /api/reports/subcategory-wise` | + `category_id`, `brand_id`, `supplier_id` |
| `SalesDetailTab` | `GET /api/reports/sales-detail` | + `employee_id` |
| `OrderWiseTab` | `GET /api/reports/order-wise` | date/time/outlet only |
| `ItemWiseTab` | `GET /api/reports/item-wise` | + `category_id`, `brand_id` |
| `RefundsVoidsTab` | `GET /api/reports/refunds-voids` | + `employee_id` |
| `CashierWiseTab` | `GET /api/reports/cashier-wise` | + `employee_id` |
| `DailyOperationsTab` | fans out to `sales-summary` + `refunds-voids` + `cashier-wise` in parallel, plus `shift-summary`/`payment-summary` when `filters.shiftId` is set | manager rollup, no own endpoint |

`SalesDetailTab` computes inline stats client-side: `uniqueSales`, `uniqueProducts`, `totalRevenue`. `DailyOperationsTab` is a composite dashboard, not a single-endpoint tab — it shows shift reconciliation only when a shift is selected, otherwise a placeholder prompt.

---

## Inventory module (`ReportsInventoryCore.jsx`, `ReportsInventoryAnalytics.jsx`, `ReportsInventoryHealth.jsx`, `ReportsInventoryReplenishment.jsx`)

| Tab | Endpoint | Extra params |
|-----|----------|-------------|
| `SalesStockTab` | `GET /api/reports/sales-stock` | date range, time range, outlet |
| `InventoryDumpTab` | `GET /api/reports/inventory-dump` | `aggregate` (outlet-detail vs all-outlets), `anomaly` preset, `margin_threshold`, category/brand/supplier/search |
| `OnHandTab` | `GET /api/reports/on-hand` | same shape as `InventoryDumpTab` (aggregate/anomaly/margin_threshold) |
| `ProductPerformanceTab` | `GET /api/reports/product-performance` | date range, time range, outlet, category/brand/supplier, search |
| `BrandWiseTab` | `GET /api/reports/brand-wise` | date range, time range, outlet, category/brand/supplier, search |
| `MerchandisingWorkspaceTab` | `GET /api/reports/performance-workspace` **+** `GET /api/reports/performance-comparison` (fetched in parallel) | date range, time range, outlet, category/brand/supplier, search; also takes `setFilters`/`setActiveTab` props to drill into `ProductPerformanceTab` |
| `PricingMarginTab` | `GET /api/reports/pricing-exceptions` | `aggregate` (outlet-detail vs all-outlets toggle), `anomaly` preset (`margin_risk`/`cost_over_sale`/`zero_sale_price`/`zero_cost`), `margin_threshold` — all local state, not from `filters` |
| `DeadStockTab` | `GET /api/reports/dead-stock` | `inactive_days` local state (default 60) + category/brand/supplier/search/outlet from `filters` |
| `StockAgingTab` | `GET /api/reports/stock-aging` | optional `bucket` (fresh/aging/old/critical) from clickable summary cards + filters |
| `ShrinkageTab` | `GET /api/reports/shrinkage` | `date_from`/`date_to` (defaults to last 30 days via `daysAgoLocalStr`/`todayLocalStr`), outlet, category, search |
| `ReplenishmentTab` | `GET /api/reports/replenishment` | outlet only |
| `StockoutRiskTab` | `GET /api/reports/stockout-risk` | `lookback_days` + category/brand/supplier/search/outlet |
| `ForecastDemandTab` | `GET /api/reports/forecast-demand` | `lookback_days` + category/brand/supplier/search/outlet |
| `ReplenishmentSmartTab` | `GET /api/reports/replenishment-smart` | `lookback_days`, `forecast_days` + category/brand/supplier/search/outlet |

`ReplenishmentTab` has a "Draft PO" action button that groups suggested-reorder rows by `supplier_id` and posts one `POST /api/purchase-orders` per supplier. `MerchandisingWorkspaceTab` is the only tab in this directory that hits two report endpoints for one view — do not assume every card in it maps to a single request. `PricingMarginTab`, `DeadStockTab`, `StockAgingTab`, `ShrinkageTab` all live in `ReportsInventoryHealth.jsx` and share a local `InventoryHealthStat` stat-card component (not exported, not in `ReportShared`); `ReplenishmentTab`/`StockoutRiskTab`/`ForecastDemandTab`/`ReplenishmentSmartTab` in `ReportsInventoryReplenishment.jsx` share their own local copy of the same-named `InventoryHealthStat` component — two separate, unconnected definitions of the same name.

---

## Finance module (`ReportsFinance.jsx`)

Exports: `SettlementOverviewTab`, `PayablesReceivablesTab`, `SupplierPaymentsInvoicesTab`, `FinancePaymentMixTab`, `GSTOutputTab`, `GSTTypeSummaryTab`, `FINANCE_REPORT_ICONS`.

Internal `buildFinanceParams(filters)` helper builds the full filter set (date/time range, employee, category/brand/supplier, search, outlet). `SummaryGrid` and `EmptyFinanceState` are internal (non-exported) components.

Endpoints: `GET /api/reports/settlement-overview`, `/api/reports/payables-receivables`, `/api/reports/supplier-payments-invoices`, `/api/reports/finance-payment-mix`, `/api/reports/gst-output` (extra `tax_mode` param: gst/all/no_tax), `/api/reports/gst-type-summary`.

---

## Analytics module (`ReportsAnalytics.jsx`)

Exports: `ComparativeTrendsTab`, `HeatmapsTab`, `RevenueLeaksTab`, `ProductMixTab`, `RetailMatrixTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `ComparativeTrendsTab` | `GET /api/reports/comparative-trends` | outlet only; shows today vs yesterday (live pulse) |
| `HeatmapsTab` | `GET /api/reports/heatmaps` | date range + outlet; renders 7x24 CSS grid heatmap (no chart lib) — inline rgba intensity keyed to max revenue cell |
| `RevenueLeaksTab` | `GET /api/reports/revenue-leaks` | date range + outlet + employee; per-staff leakage table |
| `ProductMixTab` | `GET /api/reports/product-mix` | date range + outlet; market-basket analysis (product pairs, `co_occurrences`) |
| `RetailMatrixTab` | `GET /api/reports/retail-matrix` | date range + outlet; Star/Plowhorse/Puzzle/Dog quadrant categories (server computes `matrix_category`) |

All five build their own `URLSearchParams` inline rather than sharing a helper (unlike Finance/Catalog modules).

---

## Audit module (`ReportsAudit.jsx`)

Exports: `DiscountLeakageTab`, `ExceptionsTab`.

**Both tabs use `api.raw()` and handle feature-gate responses explicitly** — accepts **either 403 or 503** as "unavailable" (a comment in source notes the backend migrated from 503 to 403 for `requireFeature`, back-compat kept for both across deploy windows). Shows a `FeatureState` placeholder when gated. If adding a new gated report tab, follow this pattern instead of `api.get`, which throws on non-2xx and can't distinguish "gated" from "actual error".

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `DiscountLeakageTab` | `GET /api/reports/discount-leakage` | order-level discount exposure |
| `ExceptionsTab` | `GET /api/reports/exceptions?type=X` | local `type` state with 4 options: `negative_margin_sales`, `high_discount_orders`, `frequent_voids_by_employee`, `frequent_returns_by_product`; type change triggers refetch, each type has different export columns |

---

## Catalog module (`ReportsCatalog.jsx`)

Exports: `CategoryWiseTab`, `ProductSpecTab`, `HistoryCostTab`, `HistorySaleTab`, `ProductAuditTab`.

Internal `buildCatalogParams(filters, extra?)` helper is shared by `HistoryCostTab`, `HistorySaleTab`, `ProductAuditTab` (not by `CategoryWiseTab`/`ProductSpecTab`, which build params inline).

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `CategoryWiseTab` | `GET /api/reports/category-wise` | date range + time range + outlet |
| `ProductSpecTab` | `GET /api/reports/product-spec` | search, category_id, brand_id, supplier_id only (no date) — shows 5 completion metrics (Categorized, Branded, With Supplier, Active Masters, Multi-Outlet) |
| `HistoryCostTab` | `GET /api/reports/history-cost` | GRN-level cost history, flags rows where `vs_current_cost` differs from master |
| `HistorySaleTab` | `GET /api/reports/history-sale` | sale-line history with realized gross profit |
| `ProductAuditTab` | `GET /api/reports/product-audit` | + `issue` preset + `inactivity_days` (default 60, range 1–3650); presets: all, missing_barcode, missing_sku, missing_supplier, missing_category, minmax_unset, inactive_with_stock, no_recent_sales |

---

## Customers module (`ReportsCustomers.jsx`)

Exports: `CustomerDetailsTab`, `CustomerWiseTab`, `CustomerRFMTab`, `CustomerRetentionTab`, `CustomerCaptureRateTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `CustomerDetailsTab` | `GET /api/reports/customer-details` | search + outlet; shows LTV |
| `CustomerWiseTab` | `GET /api/reports/customer-wise` | date range + outlet; high-value ranking |
| `CustomerRFMTab` | `GET /api/reports/customer-rfm` | outlet only; **RFM scoring is done entirely client-side** |
| `CustomerRetentionTab` | `GET /api/reports/customer-retention` | date range + outlet; walk_in / new_customer / returning_customer |
| `CustomerCaptureRateTab` | `GET /api/reports/customer-capture-rate` | date range + outlet; staff-by-staff profiling rate |

`CustomerRFMTab` scoring is entirely client-side via `scoreRFMCustomers()` + `getSegment()`. 11 segments: Champions, Loyal, Potential Loyalist, New Customers, Promising, Need Attention, About to Sleep, At Risk, Can't Lose Them, Hibernating, Lost. Filterable by segment via clickable segment cards.

---

## A/R Aging module (`ARAgingTab.jsx`)

Default export: `ARAgingTab({ filters })`.

**Point-in-time snapshot, not a date-range report** — single `as_of` date param (defaults to today via local `todayIso()` helper), plus optional `outlet_id` built by joining `filters.outletIds`. Endpoint: `GET /api/reports/ar-aging?as_of=X&outlet_id=Y`.

Response shape: `{ buckets: [30, 60, 90], rows: [{ customer_id, name, b0, b1, b2, b3_plus, total }], totals }`. Bucket boundaries come from the server (`data.buckets`), not hardcoded — bucket labels are derived dynamically (`0–30`, `31–60`, `61–90`, `90+`).

Uses `downloadCsv` (not `exportCSV`/`ReportShared`) and appends a `TOTAL` row to the exported CSV. Renders its own table markup (not `TableShell`) with a `<tfoot>` totals row.

---

## Governance module (`ReportsGovernance.jsx`)

Default export: `GovernanceTab`.

**Feature-gated by `reports_scheduled_exports` flag** (checked with `useFeatureFlags`) — returns early with a placeholder if the flag is off.

Uses `useAuth()` for `hasPerm("manage_employees")` — schedules/definitions/delivery-log sections only shown to managers/admins; non-managers still see the Saved Views section.

4 sections in one tab:
1. Saved Views — `GET/POST /api/reports/saved-views` (all roles)
2. Schedules — `GET/POST /api/reports/schedules` + `POST /api/reports/schedules/:id/run-now` (managers/admins only)
3. Definition Versions — `GET/POST /api/reports/governance/definitions` (managers/admins only)
4. Delivery Log — `GET /api/reports/delivery-log` (managers/admins only)

Schedule form fields: `report_key` (4 hardcoded options), `frequency` (daily/weekly), `run_hour`, `run_minute`, `recipient`. Both saved-view creation and schedule creation attach the current `filters` object from the parent as part of the POST body.

---

## Operations module (`ReportsOperations.jsx`)

Exports: `InventoryLossTab`, `WastageTab`, `ProductMovementTab`, `STRReportTab`, `OutletComparisonTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `InventoryLossTab` | `GET /api/reports/inventory-loss` | negative stock adjustments |
| `WastageTab` | `GET /api/reports/wastage` | damage/expiry removals |
| `ProductMovementTab` | `GET /api/reports/product-movement` | inter-outlet transfers |
| `STRReportTab` | `GET /api/reports/str-report` | grouped stock-transfer formal register; `STR-NNNN` format |
| `OutletComparisonTab` | `GET /api/reports/outlet-comparison` | renders one card per outlet, NOT a `TableShell` — shows revenue, avg ticket, unique customers |

---

## Purchasing module (`ReportsPurchasing.jsx`)

Exports: `SupplierWiseTab`, `PurchaseOrdersReportTab`, `TotalPurchasesTab`, `ItemwisePurchasesTab`, `POWorkflowTab`, `ProcurementParityTab`, `GRNReportTab`.

Endpoints: `GET /api/reports/supplier-wise`, `GET /api/purchase-orders` (note: `PurchaseOrdersReportTab` hits the live purchase-orders CRUD endpoint directly, not a `/api/reports/*` path), `/api/reports/total-purchases`, `/api/reports/itemwise-purchases`, `/api/reports/po-workflow`, `/api/reports/procurement-parity`, `/api/reports/grn-report`.

`TotalPurchasesTab` and `ItemwisePurchasesTab` share the same `statusMode` (all/received/pending/not_received) + `taxMode` (all/gst/no_gst) local-state toggle pattern.

---

## Shifts module (`ReportsShifts.jsx`)

Exports: `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashFlowTab`, `CashAuditTab`, `DenominationsTab`, `CurrentSessionZReportTab`, `SHIFT_TAB_META`.

**Shift-locked tabs** (require `filters.shiftId` — show a `ShiftRequired` placeholder otherwise): `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`.

**Not shift-locked**: `CashFlowTab` (date range), `DenominationsTab` (session_id optional — falls back to cross-session recent records).

`SHIFT_TAB_META` — tab key to `{ label, icon }` map — used by the parent orchestrator for shift tab labels.

Endpoints: `GET /api/reports/shift-summary?session_id=X`, `shift-sales`, `payment-summary`, `cash-flow`, `cash-audit`, `all-denominations`, `current-session-zreport`.

---

## Staff module (`ReportsStaff.jsx`)

Exports: `AttendanceTab`, `LaborPerformanceTab`, `LaborVsSalesTab`, `StaffAttributionTab`, `LossPreventionTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `AttendanceTab` | `GET /api/attendance` | Uses `parseLocalDate` — LOCAL time, not UTC (clock-in/out are local columns). Fetches from `/api/attendance` directly, NOT `/api/reports/` — then filters client-side by `outletIds` |
| `LaborPerformanceTab` | `GET /api/reports/labor-performance` | Revenue per man-hour |
| `LaborVsSalesTab` | `GET /api/reports/labor-vs-sales` | Hours + revenue + labor cost per employee |
| `StaffAttributionTab` | `GET /api/reports/staff-attribution` | Sales, discounts, voids, returns, approvals per employee |
| `LossPreventionTab` | `GET /api/reports/loss-prevention` | void/refund risk ratio per employee; risk badge if >5% |

---

## Multichannel module (`ReportsMultichannel.jsx`)

Default export: `MultichannelTab`.

**Uses `from`/`to` params (not `date_from`/`date_to`)** — the headline gotcha for this directory, via a local `buildParams(filters)` helper shared across the tab's three sections.

3 parallel sections, each with its own state and load function:
1. Summary cards (per channel + grand total) — `GET /api/reports/multichannel-summary`
2. `DailyTrendsSection` (internal) — `GET /api/reports/multichannel-daily`
3. `TopProductsSection` (internal) — `GET /api/reports/multichannel-products`

Channels: POS (blue), Shopify (green), WooCommerce (purple). `RevenuePieChart` uses Recharts `PieChart` with one `Cell` per channel. `buildParams` only forwards `outlet_id` when exactly one outlet is selected (`filters.outletIds.length === 1`) — multi-outlet selection is silently ignored for this module.

---

## Commissions module (`ReportsCommissions.jsx`)

Default export: `CommissionSummaryTab`.

**Uses `filters.from`/`filters.to`** (not `date_from`/`date_to`). **Uses `downloadCsv` from `utils/csvExport.js`** (not `exportCSV` from `ReportShared`). **Uses `fmtUtcDateTime` from `utils/dates.js` directly** (not via `ReportShared`).

Fetches `GET /api/commissions/earnings` — note this is a `/api/commissions/*` endpoint, not `/api/reports/*`. Status filter: pending/approved/paid/reversed. Type filter: commission/tip/both (`earning_type` param, omitted when "both"). Summary cards: `pending_total`, `approved_total`, `paid_total`, `commission_total`, `tip_total`. Uses `Badge` from `ui/primitives` for status/type chips.

---

## Clinical module (`ClinicalTab.jsx`)

Default export: `ClinicalTab`.

Feature flag `phase4_treatment_plans` is checked in the parent orchestrator, not inside this file.

5 parallel requests on mount (each individually `.catch()`-guarded so one failing endpoint doesn't blank the whole tab):
- `GET /api/reports/clinical/plan-completion`
- `GET /api/reports/clinical/session-attendance`
- `GET /api/reports/clinical/revenue-per-plan`
- `GET /api/reports/clinical/patient-retention`
- `GET /api/reports/clinical/lab-turnaround`

Uses `{ api }` and `useCurrency()`. Does not use `exportCSV` from `ReportShared` or `api.raw()` — no CSV export on this tab at all.

---

## KDS Analytics module (`KdsAnalyticsTab.jsx`)

Default export: `KdsAnalyticsTab`.

Endpoint: `GET /api/reports/kds/prep-times?from=X&to=Y&station_id=Y` (station_id optional). **Uses `from`/`to` params.**

Response shape: `{ stations[], by_category[], snapshots[] }`.

3 sections:
1. Prep Time by Station — Recharts `BarChart` with p50 (blue) vs p95 (red) bars per station
2. Load Trend — Recharts `LineChart` pivoting snapshots by station name. Snapshots are populated by a 15-minute background worker — the chart is empty until the worker has run at least once
3. Station Performance table — p50, p95, mean, target, delta (mean minus target); delta colored green (<=0) or red (>0)
4. By Category (top 20) — p50, p95, mean per category

CSV export via `downloadCsv`. Columns: station, count, p50_sec, p95_sec, mean_sec, target_sec, delta_sec.

---

## Menu Engineering module (`MenuEngineeringTab.jsx`)

Default export: `MenuEngineeringTab`.

Endpoint: `GET /api/reports/menu-engineering?from=X&to=Y&outlet_id=Y&category_id=Y` (outlet + category optional). **Uses `from`/`to` params.** Prefetches `/api/outlets` and `/api/categories` on mount for filter dropdowns.

Response shape: `{ thresholds: { popularity_median, margin_median }, products[] }`.

4 quadrant classifications (determined server-side):

| Key | Label | Color | Definition |
|-----|-------|-------|-----------|
| `star` | Star | emerald | High popularity + high margin |
| `plowhorse` | Plowhorse | amber | High popularity + low margin |
| `puzzle` | Puzzle | blue | Low popularity + high margin |
| `dog` | Dog | red | Low popularity + low margin |

Median thresholds from `data.thresholds` are drawn as `ReferenceLine`s on the `ScatterChart`. Each classification is a separate `<Scatter>` series so legend colors line up correctly.

Table is client-side sortable by any column (`toggleSort` — ascending/descending). Default sort: `popularity` descending.

CSV export via `downloadCsv`. Columns: product_id, name, category, classification, popularity, revenue, cogs, profit, avg_margin_per_unit.

Uses `useCurrency()` for margin/profit formatting.

---

## `FBRExportTab.jsx`

Default export: `FBRExportTab()` — no props, manages its own `from`/`to` state.

**Uses `from`/`to` params, sent via `api.get("/api/reports/fbr-export", { from, to })`.** Both fields required before the fetch button is enabled.

CSV download via `downloadCsv` from `utils/csvExport.js` (NOT `exportCSV`). Shows company NTN/STRN info panel above the export. CSV columns: NTN, STRN, Invoice #, Date, Buyer, Phone, Item, Qty, Unit Price, Tax Rate %, Tax Amount, Total.

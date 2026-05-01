# Report Pages — Claude Guide

- **27 files** — all report tab components, orchestrated by `pages/Reports.jsx`
- All use `{ api }` named import from `../../api` (same `api.js` object; `api` is also the default export)
- `ReportsAudit.jsx` uses `api.raw()` specifically for 503 feature-gate detection
- Charts: Recharts (`BarChart`, `AreaChart`, `PieChart`, `LineChart`, `ScatterChart`)
- CSV exports use `exportCSV(filename, cols, rows)` from `ReportShared.jsx` OR `downloadCsv` from `utils/csvExport.js` — varies per tab (see each module)

---

## `ReportShared.jsx`

Shared utilities re-exported to all report tabs.

| Export | Notes |
|--------|-------|
| `fmtDate` | Alias for `fmtUtcDate` from `utils/dates.js` |
| `fmtDateTime` | Alias for `fmtUtcDateTime` from `utils/dates.js` |
| `exportCSV(filename, cols, rows)` | Inline blob export. `cols` can be strings or `{ header, key }`. Uses `="value"` trick for keys in `CSV_TEXT_KEYS` Set (`barcode`, `sku` only) to force text in Excel and preserve leading zeros |
| `ExportButton` | Small download icon button that triggers `onClick` |
| `TableShell` | Scrollable table (`max-h-[70vh]`, sticky header, `min-w-180`). Props: `cols`, `loading`, `empty`, `emptyIcon`, `children` |
| `DateRangeFilter` | Date range + optional search input. Props: `dateFrom`, `setDateFrom`, `dateTo`, `setDateTo`, `search?`, `setSearch?`, `searchPlaceholder?` |
| `CardShell` | White card wrapper. Props: `title`, `subtitle?`, `action?`, `children` |
| `MetricCard` | Stat card with ↑/↓ comparison. Props: `title`, `value`, `compPct`, `compLabel` |

---

## `FBRExportTab.jsx`

Date-range picker → `GET /api/reports/fbr-export?from=X&to=Y`.

**Uses `from`/`to` params (not `date_from`/`date_to`)**.

CSV download via `downloadCsv` from `utils/csvExport.js` (NOT `exportCSV`). Shows company NTN/STRN info panel above the export. CSV columns: NTN, STRN, Invoice #, Date, Buyer, Phone, Item, Qty, Unit Price, Tax Rate %, Tax Amount, Total.

---

## Barrel Files (no components — re-exports only)

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

---

## Date Param Convention

**Most tabs use `date_from` / `date_to`** (never `start`/`end`).

**Exceptions (use `from` / `to`):**
- `ReportsMultichannel.jsx` — `MultichannelTab` + its internal `DailyTrendsSection`, `TopProductsSection`
- `ReportsCommissions.jsx` — `CommissionSummaryTab` (uses `filters.from`/`filters.to` from parent)
- `KdsAnalyticsTab.jsx` — `KdsAnalyticsTab` (own `from`/`to` state)
- `MenuEngineeringTab.jsx` — `MenuEngineeringTab` (own `from`/`to` state)
- `FBRExportTab.jsx` — uses `from`/`to`

**Shift-locked tabs** (use `session_id` from `filters.shiftId`, skip date params entirely):
- `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`

**`CashFlowTab`** — uses `date_from`/`date_to`, NOT `session_id`.

**`DenominationsTab`** — uses `session_id` if set, but does NOT require it.

---

## Timestamp Gotcha

- **`ReportsStaff.jsx` `AttendanceTab`** — uses `parseLocalDate` for `check_in`/`check_out` display (attendance is local time). All other report files use UTC formatters.
- **`ReportsCommissions.jsx`** — uses `fmtUtcDateTime` from `utils/dates.js` directly (not via `ReportShared`).

---

## Sales Module (`ReportsSalesOverview.jsx`, `ReportsSalesCore.jsx`, `ReportsSalesDetail.jsx`, `ReportsSalesOperations.jsx`)

| Tab | Endpoint | Extra Params |
|-----|----------|-------------|
| `OverviewTab` | `GET /api/reports/dashboard` | `outlet_id` only |
| `SalesSummaryTab` | `GET /api/reports/sales-summary` | `date_from`, `date_to`, `time_from`, `time_to`, `category_id`, `brand_id`, `outlet_id` |
| `MonthlyMOPMatrixTab` | `GET /api/reports/mop-matrix` | same |
| `SubcategoryWiseTab` | `GET /api/reports/subcategory-wise` | same |
| `SalesDetailTab` | `GET /api/reports/sales-detail` | + `employee_id` |
| `OrderWiseTab` | `GET /api/reports/order-wise` | + `employee_id` |
| `ItemWiseTab` | `GET /api/reports/item-wise` | + `employee_id` |
| `RefundsVoidsTab` | `GET /api/reports/refunds-voids` | + `employee_id` |
| `CashierWiseTab` | `GET /api/reports/cashier-wise` | + `employee_id` |
| `DailyOperationsTab` | `GET /api/reports/daily-operations` | + `employee_id` |

`SalesDetailTab` computes inline stats: `uniqueSales`, `uniqueProducts`, `totalRevenue`.

---

## Inventory Module (`ReportsInventoryCore.jsx`, `ReportsInventoryAnalytics.jsx`, `ReportsInventoryHealth.jsx`, `ReportsInventoryReplenishment.jsx`)

| Tab | Endpoint | Extra Params |
|-----|----------|-------------|
| `SalesStockTab` | `GET /api/reports/sales-stock` | date range, outlet |
| `InventoryDumpTab` | `GET /api/reports/inventory-dump` | outlet only |
| `OnHandTab` | `GET /api/reports/on-hand` | outlet only |
| `ProductPerformanceTab` | `GET /api/reports/product-performance` | date range, outlet, supplier_id, search |
| `BrandWiseTab` | `GET /api/reports/brand-wise` | date range, outlet |
| `MerchandisingWorkspaceTab` | `GET /api/reports/merchandising-workspace` | date range, outlet |
| `PricingMarginTab` | `GET /api/reports/pricing-exceptions` | `aggregate`, `anomaly`, `marginThreshold` local state |
| `DeadStockTab` | `GET /api/reports/dead-stock` | date range, outlet |
| `StockAgingTab` | `GET /api/reports/stock-aging` | date range, outlet |
| `ShrinkageTab` | `GET /api/reports/shrinkage` | date range, outlet |
| `ReplenishmentTab` | `GET /api/reports/replenishment` | outlet |
| `StockoutRiskTab` | `GET /api/reports/stockout-risk` | outlet |
| `ForecastDemandTab` | `GET /api/reports/forecast-demand` | outlet |
| `ReplenishmentSmartTab` | `GET /api/reports/replenishment-smart` | outlet |

`ReplenishmentTab` has "Draft PO" action button on each row.
`ReportsInventoryAnalytics.jsx` uses `LineChart` + `BarChart` (Recharts).

---

## Finance Module (`ReportsFinance.jsx`)

Exports: `SettlementOverviewTab`, `PayablesReceivablesTab`, `SupplierPaymentsInvoicesTab`, `FinancePaymentMixTab`, `GSTOutputTab`, `GSTTypeSummaryTab`, `FINANCE_REPORT_ICONS`.

Internal `buildFinanceParams` helper builds full filter set. `SummaryGrid` and `EmptyFinanceState` are internal components.

Endpoints:
- `GET /api/reports/settlement-overview`
- `GET /api/reports/payables-receivables`
- `GET /api/reports/supplier-payments-invoices`
- `GET /api/reports/payment-mix`
- `GET /api/reports/gst-output`
- `GET /api/reports/gst-type-summary`

---

## Analytics Module (`ReportsAnalytics.jsx`)

Exports: `ComparativeTrendsTab`, `HeatmapsTab`, `RevenueLeaksTab`, `ProductMixTab`, `RetailMatrixTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `ComparativeTrendsTab` | `GET /api/reports/comparative-trends` | outlet only; shows today vs yesterday |
| `HeatmapsTab` | `GET /api/reports/heatmaps` | date range + outlet; renders 7×24 CSS grid heatmap (no chart lib) — inline CSS rgba intensity |
| `RevenueLeaksTab` | `GET /api/reports/revenue-leaks` | date range + outlet + employee; per-staff leakage table |
| `ProductMixTab` | `GET /api/reports/product-mix` | date range + outlet; market basket analysis (product pairs) |
| `RetailMatrixTab` | `GET /api/reports/retail-matrix` | date range + outlet; Star/Plowhorse/Puzzle/Dog quadrant categories |

---

## Audit Module (`ReportsAudit.jsx`)

Exports: `DiscountLeakageTab`, `ExceptionsTab`.

**Both tabs use `api.raw()` and handle 503 responses explicitly** (feature-gate — shows `FeatureState` placeholder when gated).

| Tab | Endpoint | Exception Types |
|-----|----------|-----------------|
| `DiscountLeakageTab` | `GET /api/reports/discount-leakage` | — |
| `ExceptionsTab` | `GET /api/reports/exceptions?type=X` | `negative_margin_sales`, `high_discount_orders`, `frequent_voids_by_employee`, `frequent_returns_by_product` |

`ExceptionsTab` has a local `type` state with 4 options; type change triggers refetch. Each type has different export columns.

---

## Catalog Module (`ReportsCatalog.jsx`)

Exports: `CategoryWiseTab`, `ProductSpecTab`, `HistoryCostTab`, `HistorySaleTab`, `ProductAuditTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `CategoryWiseTab` | `GET /api/reports/category-wise` | date range + time range + outlet |
| `ProductSpecTab` | `GET /api/reports/product-spec` | search, category_id, brand_id, supplier_id only (no date) |
| `HistoryCostTab` | `GET /api/reports/history-cost` | GRN-level cost history |
| `HistorySaleTab` | `GET /api/reports/history-sale` | sale-line history with GP |
| `ProductAuditTab` | `GET /api/reports/product-audit` | + `issue` + `inactivity_days` |

`ProductAuditTab` has preset filter buttons: all, missing_barcode, missing_sku, missing_supplier, missing_category, minmax_unset, inactive_with_stock, no_recent_sales. `inactivity_days` input (default 60, range 1–3650).

`ProductSpecTab` shows 5 completion metrics: Categorized, Branded, With Supplier, Active Masters, Multi-Outlet.

---

## Customers Module (`ReportsCustomers.jsx`)

Exports: `CustomerDetailsTab`, `CustomerWiseTab`, `CustomerRFMTab`, `CustomerRetentionTab`, `CustomerCaptureRateTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `CustomerDetailsTab` | `GET /api/reports/customer-details` | search + outlet; shows LTV |
| `CustomerWiseTab` | `GET /api/reports/customer-wise` | date range + outlet; high-value ranking |
| `CustomerRFMTab` | `GET /api/reports/customer-rfm` | outlet only; **RFM scoring is done CLIENT-SIDE** |
| `CustomerRetentionTab` | `GET /api/reports/customer-retention` | date range + outlet; walk_in / new_customer / returning_customer |
| `CustomerCaptureRateTab` | `GET /api/reports/customer-capture-rate` | date range + outlet; staff-by-staff profiling rate |

**`CustomerRFMTab` RFM scoring is entirely client-side** via `scoreRFMCustomers()` + `getSegment()`. 11 segments: Champions, Loyal, Potential Loyalist, New Customers, Promising, Need Attention, About to Sleep, At Risk, Can't Lose Them, Hibernating, Lost. Filter by segment via clickable segment cards.

---

## Governance Module (`ReportsGovernance.jsx`)

Default export: `GovernanceTab`.

**Feature-gated by `reports_scheduled_exports` flag** — returns early with placeholder if flag is off.

**Auth**: uses `useAuth()` for `hasPerm("manage_employees")` — schedules/definitions/delivery log only shown to managers/admins.

**4 sections** (all within one tab):
1. Saved Views — `GET/POST /api/reports/saved-views` (all roles)
2. Schedules — `GET/POST /api/reports/schedules` + `POST /api/reports/schedules/:id/run-now` (managers/admins only)
3. Definition Versions — `GET/POST /api/reports/governance/definitions` (managers/admins only)
4. Delivery Log — `GET /api/reports/delivery-log` (managers/admins only)

Schedule form: `report_key` (4 options), `frequency` (daily/weekly), `run_hour`, `run_minute`, `recipient`.

---

## Operations Module (`ReportsOperations.jsx`)

Exports: `InventoryLossTab`, `WastageTab`, `ProductMovementTab`, `STRReportTab`, `OutletComparisonTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `InventoryLossTab` | `GET /api/reports/inventory-loss` | negative stock adjustments |
| `WastageTab` | `GET /api/reports/wastage` | damage/expiry removals |
| `ProductMovementTab` | `GET /api/reports/product-movement` | inter-outlet transfers |
| `STRReportTab` | `GET /api/reports/str-report` | grouped stock transfer formal register; STR-NNNN format |
| `OutletComparisonTab` | `GET /api/reports/outlet-comparison` | renders card-per-outlet, NOT a `TableShell` |

`OutletComparisonTab` renders each outlet as a card — shows revenue, avg ticket, unique customers.

---

## Purchasing Module (`ReportsPurchasing.jsx`)

Exports: `SupplierWiseTab`, `PurchaseOrdersReportTab`, `TotalPurchasesTab`, `ItemwisePurchasesTab`, `POWorkflowTab`, `ProcurementParityTab`, `GRNReportTab`.

Endpoints: `GET /api/reports/supplier-wise`, `/api/reports/purchase-orders-report`, `/api/reports/total-purchases`, `/api/reports/itemwise-purchases`, `/api/reports/po-workflow`, `/api/reports/procurement-parity`, `/api/reports/grn-report`.

---

## Shifts Module (`ReportsShifts.jsx`)

Exports: `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashFlowTab`, `CashAuditTab`, `DenominationsTab`, `CurrentSessionZReportTab`, `SHIFT_TAB_META`.

**Shift-locked tabs** (require `filters.shiftId` — show `ShiftRequired` placeholder otherwise): `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`.

**Not shift-locked**: `CashFlowTab` (date range), `DenominationsTab` (session_id optional).

`SHIFT_TAB_META` object — tab key → `{ label, icon }` — used by the parent orchestrator for shift tab labels.

Endpoints: `GET /api/reports/shift-summary?session_id=X`, `shift-sales`, `payment-summary`, `cash-flow`, `cash-audit`, `all-denominations`, `current-session-zreport`.

---

## Staff Module (`ReportsStaff.jsx`)

Exports: `AttendanceTab`, `LaborPerformanceTab`, `LaborVsSalesTab`, `StaffAttributionTab`, `LossPreventionTab`.

| Tab | Endpoint | Notes |
|-----|----------|-------|
| `AttendanceTab` | `GET /api/attendance` | Uses `parseLocalDate` — **local time, not UTC** (clock-in/out are local columns) |
| `LaborPerformanceTab` | `GET /api/reports/labor-performance` | Revenue per man-hour |
| `LaborVsSalesTab` | `GET /api/reports/labor-vs-sales` | Hours + revenue + labor cost per employee |
| `StaffAttributionTab` | `GET /api/reports/staff-attribution` | Sales, discounts, voids, returns, approvals per employee |
| `LossPreventionTab` | `GET /api/reports/loss-prevention` | void/refund risk ratio per employee; risk badge if >5% |

`AttendanceTab` fetches from `/api/attendance` (not `/api/reports/`) — then client-side filters by `outletIds`.

---

## Multichannel Module (`ReportsMultichannel.jsx`)

Default export: `MultichannelTab`.

**Uses `from`/`to` params (not `date_from`/`date_to`)** — critical difference from most other tabs.

3 parallel sections (each with own state + load):
1. Summary cards (per channel + grand total) — `GET /api/reports/multichannel-summary`
2. `DailyTrendsSection` (internal) — `GET /api/reports/multichannel-daily`
3. `TopProductsSection` (internal) — `GET /api/reports/multichannel-products`

Channels: POS (blue), Shopify (green), WooCommerce (purple). `RevenuePieChart` uses Recharts `PieChart` with `Cell` per channel.

---

## Commissions Module (`ReportsCommissions.jsx`)

Default export: `CommissionSummaryTab`.

**Uses `filters.from`/`filters.to` (not `date_from`/`date_to`)**.

**Uses `downloadCsv` from `utils/csvExport.js`** (not `exportCSV` from `ReportShared`).

**Uses `fmtUtcDateTime` from `utils/dates.js` directly** (not via `ReportShared`).

Fetches `GET /api/commissions/earnings`. Status filter (pending/approved/paid/reversed). Summary cards: pending_total, approved_total, paid_total. Uses `Badge` from `ui/primitives` for status chips.

---

## Clinical Module (`ClinicalTab.jsx`)

Default export: `ClinicalTab`.

**Feature flag**: `phase4_treatment_plans` (checked in parent orchestrator, not inside this file).

5 parallel requests on mount:
- `GET /api/reports/clinical/plan-completion`
- `GET /api/reports/clinical/session-attendance`
- `GET /api/reports/clinical/revenue-per-plan`
- `GET /api/reports/clinical/patient-retention`
- `GET /api/reports/clinical/lab-turnaround`

Uses `{ api }` from `../../api` + `useCurrency()`. Does NOT use `exportCSV` from `ReportShared` or `api.raw()`.

---

## KDS Analytics Module (`KdsAnalyticsTab.jsx`)

Default export: `KdsAnalyticsTab`.

Endpoint: `GET /api/reports/kds/prep-times?from=X&to=Y&station_id=Y` (station_id optional).

**Uses `from`/`to` params.**

Response shape: `{ stations[], by_category[], snapshots[] }`.

3 sections:
1. **Prep Time by Station** — Recharts `BarChart` with p50 (blue) vs p95 (red) bars per station
2. **Load Trend** — Recharts `LineChart` pivoting snapshots by station name. Snapshots populated by a 15-min background worker — chart empty until worker has run.
3. **Station Performance table** — p50, p95, mean, target, delta (mean − target); delta colored green (≤0) or red (>0)
4. **By Category (top 20)** — p50, p95, mean per category

CSV export via `downloadCsv`. Columns: station, count, p50_sec, p95_sec, mean_sec, target_sec, delta_sec.

---

## Menu Engineering Module (`MenuEngineeringTab.jsx`)

Default export: `MenuEngineeringTab`.

Endpoint: `GET /api/reports/menu-engineering?from=X&to=Y&outlet_id=Y&category_id=Y` (outlet + category optional).

**Uses `from`/`to` params.** Prefetches `/api/outlets` and `/api/categories` on mount for filter dropdowns.

Response shape: `{ thresholds: { popularity_median, margin_median }, products[] }`.

**4 quadrant classifications** (determined server-side):

| Key | Label | Color | Definition |
|-----|-------|-------|-----------|
| `star` | Star | emerald | High popularity + High margin |
| `plowhorse` | Plowhorse | amber | High popularity + Low margin |
| `puzzle` | Puzzle | blue | Low popularity + High margin |
| `dog` | Dog | red | Low popularity + Low margin |

Median thresholds from `data.thresholds` are drawn as `ReferenceLine`s on the `ScatterChart`. Each classification is a separate `<Scatter>` series for correct legend colors.

Table is client-side sortable by any column (toggleSort — ascending/descending). Default sort: `popularity` descending.

CSV export via `downloadCsv`. Columns: product_id, name, category, classification, popularity, revenue, cogs, profit, avg_margin_per_unit.

Uses `useCurrency()` for margin/profit formatting.

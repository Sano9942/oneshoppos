# POS Rebuild Roadmap

## Scope

This roadmap is for planning only. It does not imply implementation has started.

The plan is based on the legacy iPOS.NET screens reviewed from the `images/` folder and is intended to guide a staged rebuild inside OneShopPOS without trying to clone every legacy screen one-for-one.

## Current Baseline

As of March 4, 2026, OneShopPOS already has substantial reporting groundwork in place.

- The main reports workspace currently exposes `67` report tabs.
- The backend currently exposes `74` active `/api/reports/*` endpoints across modular report domains.
- The active reporting backend is already split into:
  - dashboard
  - sales
  - inventory
  - analytics
  - purchasing
  - finance
  - staff
  - shifts
  - governance
- Shared report foundations already exist:
  - global filters
  - grouped report navigation
  - reusable cards and tables
  - CSV export actions
  - modular frontend report pages

## Current Filters Baseline

The active reports workspace already has shared global filters for:

- date from
- date to
- time from
- time to
- outlet
- employee
- shift
- category
- brand
- supplier
- free-text search

Filter gaps versus the legacy screenshots still include:

- station number
- cashier-specific presets
- explicit sub-category selector separate from the hierarchical category picker
- customer filter
- sales type filter
- payment method filter in the shared shell
- rack/bin location filtering beyond outlet

## Legacy Coverage Snapshot

The screenshot review covered `11` legacy report/screens. Current coverage in OneShopPOS is:

- `5` direct equivalents
- `5` partial equivalents
- `1` missing direct equivalent

## Gap Matrix

| Legacy report/screen | Current status | Current OneShopPOS coverage |
|---|---|---|
| `Daily Sale Report` | Partial | Covered by dashboard, `sales-summary`, `sales-detail`, and shift reporting primitives |
| `Periodic Sale Report` | Partial | Covered by date-range reporting in `sales-summary`, `order-wise`, and `sales-detail` |
| `Itemwise Sale Report` | Direct | `item-wise` report exists |
| `Category Wise Sale Report` | Direct | `category-wise` report exists |
| `Supplier Wise Sale Report` | Direct | `supplier-wise` report exists |
| `Brand Wise Sale Report` | Direct | Dedicated `brand-wise` report and backend endpoint now exist |
| `Total Purchases` | Direct | Dedicated `total-purchases` report now exists with received, pending, and tax-state views |
| `Itemwise Purchases` | Direct | Dedicated `itemwise-purchases` report now exists with GST/no-GST and supplier/category/brand filters |
| `List Of Item File` / `Present Stock Position` | Partial | Covered by `on-hand`, `inventory-dump`, `product-spec`, and pricing/inventory tools |
| Dashboard metrics view | Direct | Dashboard exists |
| Dashboard analytics view | Direct | Dashboard plus analytics reports exist |

## What We Already Have

- Sales reporting:
  - sales summary
  - sales detail
  - order wise
  - item wise
  - category wise
- Dashboard and analytics:
  - dashboard
  - comparative trends
  - heatmaps
  - revenue leaks
  - product mix
  - retail matrix
- Inventory reporting:
  - sales and stock
  - inventory dump
  - on hand
  - product spec
  - replenishment
  - inventory loss
  - wastage
  - product movement
  - STR report
  - GRN report
- Procurement and supplier reporting:
  - supplier wise
  - total purchases
  - itemwise purchases
  - PO workflow
  - procurement parity
  - purchase order registry view
  - supplier payments and invoices
- Finance and settlement:
  - settlement overview
  - payables and receivables
  - finance payment mix
  - shift and cash settlement tabs
- Staff and controls:
  - attendance
  - labor performance
  - loss prevention
  - governance reporting

## What Is Partial And Needs Extension

- Daily sales reporting needs a more explicit legacy replacement workflow:
  - cashier-wise
  - unified manager view
  - stronger cashier drilldowns
- Periodic sales reporting exists logically, but needs a better dedicated UX for managers.
- Stock position reporting exists, but legacy-style exception views still need consolidation:
  - zero stock
  - negative stock
  - zero price
  - margin-risk filters
  - label/barcode actions in-context
- Purchasing is now broad enough for the agreed rebuild scope, but may still need long-tail variants later:
  - specialist GST outputs
  - edge-case approval and receipt views
- Shift and cash reporting already exist in the backend, but are not yet first-class in the main report workspace:
  - now exposed in the main workspace, but still need broader real-world reconciliation signoff
- Finance reporting is now first-class in the main report workspace, but still needs Phase 5 validation and signoff:
  - bank balance parity remains blocked by missing source data
  - customer receipts remain represented through receivables rather than a dedicated receipts ledger

## What Is Still Missing

- Bank balance reporting with a real ledger-backed data source
- A dedicated customer receipts ledger if product later requires receipt-event visibility instead of balance visibility
- Some legacy specialist outputs remain long-tail scope:
  - cheque-based reporting
  - waiter/table-specific reporting
  - specialized GST variants
  - niche audit/history outputs

## Current Implementation References

### Frontend

- Main reports workspace:
  - `frontend/src/pages/Reports.jsx`
- Report modules:
  - `frontend/src/pages/reports/ReportsSales.jsx`
  - `frontend/src/pages/reports/ReportsInventory.jsx`
  - `frontend/src/pages/reports/ReportsOperations.jsx`
  - `frontend/src/pages/reports/ReportsPurchasing.jsx`
  - `frontend/src/pages/reports/ReportsCustomers.jsx`
  - `frontend/src/pages/reports/ReportsAnalytics.jsx`
  - `frontend/src/pages/reports/ReportsAudit.jsx`
  - `frontend/src/pages/reports/ReportsCatalog.jsx`
  - `frontend/src/pages/reports/ReportsStaff.jsx`
  - `frontend/src/pages/reports/ReportsGovernance.jsx`
  - `frontend/src/pages/reports/ReportShared.jsx`
- Current redesign entry:
  - `frontend/src/pages/redesign/ReportsRedesign.jsx`
  - `frontend/src/pages/redesign/ReportsPowerUpPanel.jsx`
- Current dashboard UI:
  - `frontend/src/pages/redesign/DashboardRedesign.jsx`

### Backend

- Reports route orchestrator:
  - `backend/routes/reports/index.js`
- Modular report domains:
  - `backend/routes/reports/dashboard.js`
  - `backend/routes/reports/sales.js`
  - `backend/routes/reports/inventory.js`
  - `backend/routes/reports/analytics.js`
  - `backend/routes/reports/shifts.js`
  - `backend/routes/reports/staff.js`
  - `backend/routes/reports/governance.js`
  - `backend/routes/reports/helpers.js`
- Related non-report data sources frequently used by reporting:
  - `backend/routes/sales.js`
  - `backend/routes/products.js`
  - `backend/routes/categories.js`
  - `backend/routes/suppliers.js`
  - `backend/routes/purchase-orders.js`
  - `backend/routes/grn.js`
  - `backend/routes/shifts.js`
  - `backend/routes/attendance.js`

### Interpretation

- When a needed legacy feature already maps to one of the files above, the preferred approach is extension or exposure of the current module.
- New greenfield report pages should be the exception, not the default.

## Active Frontend Report Tabs

The current main reports workspace already exposes these tabs:

### Sales

- `overview`
- `daily-operations`
- `comparative-trends`
- `heatmaps`
- `revenue-leaks`
- `product-mix`
- `sales-summary`
- `sales-detail`
- `order-wise`
- `item-wise`
- `category-wise`
- `cashier-wise`
- `refunds-voids`
- `shift-summary`
- `shift-sales`
- `payment-summary`
- `cash-flow`
- `cash-audit`
- `denominations`
- `current-session-zreport`

### Customers

- `customer-details`
- `customer-wise`
- `customer-rfm`
- `customer-retention`
- `customer-capture`

### Inventory

- `performance-workspace`
- `brand-wise`
- `product-performance`
- `retail-matrix`
- `pricing-margin`
- `sales-stock`
- `inventory-dump`
- `on-hand`
- `product-spec`
- `history-cost`
- `history-sale`
- `product-audit`
- `replenishment`
- `dead-stock`
- `stock-aging`
- `stockout-risk`
- `forecast-demand`
- `replenishment-smart`

### Operations

- `outlet-comparison`
- `inventory-loss`
- `wastage`
- `product-movement`
- `str-report`

### Procurement

- `supplier-wise`
- `total-purchases`
- `itemwise-purchases`
- `po-workflow`
- `procurement-parity`
- `purchase-orders-report`
- `grn-report`

### Finance

- `settlement-overview`
- `payables-receivables`
- `supplier-payments-invoices`
- `finance-payment-mix`
- `gst-output`
- `gst-type-summary`

### HR

- `attendance`
- `labor-performance`
- `loss-prevention`

### Governance

- `governance`
- `discount-leakage`
- `exceptions`

## Active Backend Report Endpoints

The current modular backend already exposes these reporting endpoints.

### Dashboard

- `/api/reports/dashboard`

### Sales

- `/api/reports/top-salespeople`
- `/api/reports/sales-summary`
- `/api/reports/sales-detail`
- `/api/reports/order-wise`
- `/api/reports/category-wise`
- `/api/reports/item-wise`
- `/api/reports/brand-wise`
- `/api/reports/customer-wise`
- `/api/reports/product-performance`
- `/api/reports/performance-workspace`
- `/api/reports/performance-comparison`
- `/api/reports/refunds-voids`
- `/api/reports/cashier-wise`
- `/api/reports/profit-summary`
- `/api/reports/profit-by-product`
- `/api/reports/profit-by-outlet`

### Inventory

- `/api/reports/brand-wise`
- `/api/reports/sales-stock`
- `/api/reports/inventory-dump`
- `/api/reports/product-spec`
- `/api/reports/history-cost`
- `/api/reports/history-sale`
- `/api/reports/product-audit`
- `/api/reports/on-hand`
- `/api/reports/inventory-loss`
- `/api/reports/wastage`
- `/api/reports/replenishment`
- `/api/reports/pricing-exceptions`
- `/api/reports/dead-stock`
- `/api/reports/stock-aging`
- `/api/reports/stockout-risk`
- `/api/reports/forecast-demand`
- `/api/reports/replenishment-smart`
- `/api/reports/product-movement`
- `/api/reports/str-report`
- `/api/reports/grn-report`

### Analytics

- `/api/reports/comparative-trends`
- `/api/reports/heatmaps`
- `/api/reports/revenue-leaks`
- `/api/reports/product-mix`
- `/api/reports/retail-matrix`
- `/api/reports/customer-rfm`
- `/api/reports/customer-details`
- `/api/reports/customer-retention`
- `/api/reports/customer-capture-rate`
- `/api/reports/discount-leakage`
- `/api/reports/exceptions`
- `/api/reports/outlet-comparison`
- `/api/reports/supplier-wise`

### Purchasing

- `/api/reports/total-purchases`
- `/api/reports/itemwise-purchases`
- `/api/reports/po-workflow`
- `/api/reports/procurement-parity`

### Finance

- `/api/reports/settlement-overview`
- `/api/reports/payables-receivables`
- `/api/reports/supplier-payments-invoices`
- `/api/reports/finance-payment-mix`
- `/api/reports/gst-output`
- `/api/reports/gst-type-summary`

### Shifts And Settlement

- `/api/reports/cash-flow`
- `/api/reports/cash-audit`
- `/api/reports/shift-summary`
- `/api/reports/shift-sales`
- `/api/reports/payment-summary`
- `/api/reports/all-denominations`
- `/api/reports/current-session-zreport`

### Staff

- `/api/reports/labor-performance`
- `/api/reports/loss-prevention`

### Governance

- `/api/reports/schedules`
- `/api/reports/schedules/:id/runs`
- `/api/reports/delivery-log`
- `/api/reports/saved-views`
- `/api/reports/governance/definitions`

## Legacy-To-Current Detailed Mapping

| Legacy screen | Current frontend tab(s) | Current backend endpoint(s) | Status | Main remaining gap |
|---|---|---|---|---|
| `Daily Sale Report` | `overview`, `sales-summary`, `sales-detail` | `/api/reports/dashboard`, `/api/reports/sales-summary`, `/api/reports/sales-detail`, `/api/reports/shift-sales`, `/api/reports/payment-summary` | Partial | One dedicated daily operations workflow with cashier, shift, station, void, and refund focus |
| `Periodic Sale Report` | `sales-summary`, `order-wise`, `sales-detail` | `/api/reports/sales-summary`, `/api/reports/order-wise`, `/api/reports/sales-detail` | Partial | Better dedicated manager UX and broader payment, shift, and time slicing |
| `Itemwise Sale Report` | `item-wise` | `/api/reports/item-wise` | Direct | More legacy filter depth if needed |
| `Category Wise Sale Report` | `category-wise` | `/api/reports/category-wise` | Direct | Add some sub-category and MOP drilldowns if required |
| `Supplier Wise Sale Report` | `supplier-wise` | `/api/reports/supplier-wise` | Direct | Extend with more summary variants if needed |
| `Brand Wise Sale Report` | `brand-wise` | `/api/reports/brand-wise` | Direct | Extend only if legacy summary/detail variants are later required |
| `Total Purchases` | `purchase-orders-report`, `grn-report`, `supplier-wise` | `/api/purchase-orders`, `/api/reports/grn-report`, `/api/reports/supplier-wise` | Partial | Need a true total purchases report with summary and drilldown |
| `Itemwise Purchases` | none dedicated | no dedicated itemwise purchases endpoint in reports module | Partial | Add itemwise purchase report endpoint and UI |
| `List Of Item File` / `Present Stock Position` | `on-hand`, `inventory-dump`, `product-spec`, `pricing-margin` | `/api/reports/on-hand`, `/api/reports/inventory-dump`, `/api/reports/product-spec` | Partial | Consolidate stock exceptions, labels, barcode, margin, and audit checks |
| Dashboard metrics view | `overview`, redesigned dashboard | `/api/reports/dashboard` | Direct | Continue alignment with finance and settlement KPIs |
| Dashboard analytics view | analytics tabs plus dashboard | `/api/reports/comparative-trends`, `/api/reports/heatmaps`, `/api/reports/revenue-leaks`, `/api/reports/product-mix`, `/api/reports/retail-matrix` | Direct | Expand only if exact legacy widgets are still needed |

## Remaining Gap Checklist

The items below are the main uncovered or underexposed areas after comparing the legacy screenshots with the current codebase.

### Already Implemented In Backend But Not First-Class In Frontend

- none from the original Phase 1 cash and shift scope

### Needs Extension Of Existing Reports

- daily sales workflow consolidation
- periodic sales manager view
- cashier drilldowns beyond summary level
- stock exception presets
- stronger purchase reporting coverage
- finance and settlement summaries
- unified refund, void, and cancel reporting surface beyond current daily operations coverage
- GST-focused sales and purchase slices

### Needs New Dedicated Reporting

- itemwise purchases report
- total purchases summary report
- supplier/customer settlement reporting surface
- station-wise sales reporting if the data model ever captures station/register attribution

### Long-Tail Specialist Legacy Coverage

- cheque number reports
- waiter hour and waiter itemwise reports
- table summary and service-floor reporting
- special GST output variants
- history cost and history sale audit tools
- item-not-found and reference utilities

## Phase-To-Current-Code Mapping

| Phase | Current assets to build on | Main additions still needed |
|---|---|---|
| 1. Core Sales And End-Of-Day | `ReportsSales.jsx`, `dashboard.js`, `sales.js`, `shifts.js` | cashier drilldown polish, live UAT signoff, optional deeper reconciliation UX |
| 2. Product Performance | `ReportsSales.jsx`, `ReportsCatalog.jsx`, `ReportsPurchasing.jsx`, `sales.js`, `analytics.js` | complete for current scope, with later work limited to optional optimization |
| 3. Inventory And Stock Control | `ReportsInventory.jsx`, `ReportsOperations.jsx`, `ReportsCatalog.jsx`, `inventory.js`, `products.js` | item-file strengthening, inventory health tabs, barcode/label actions if later reintroduced |
| 4. Purchasing And Purchase Orders | `ReportsPurchasing.jsx`, `purchase-orders.js`, `grn.js` | total purchases report, itemwise purchases report, GST/no-GST reporting depth |
| 5. Finance, Settlement, And Payment Analysis | `shifts.js`, dashboard data, accounting-related screens outside reports | unified finance reporting workspace and settlement tables |
| 6. Dashboard And Executive Analytics | `DashboardRedesign.jsx`, `ReportsAnalytics.jsx`, `dashboard.js`, `analytics.js` | tighter parity for legacy KPI tiles if still required |
| 7. Long-Tail Legacy Coverage And Audit Tools | `ReportsGovernance.jsx`, `ReportShared.jsx`, existing exports | specialist niche reports only after core workflows are settled |

## Recommended Planning Assumptions

- Most of the rebuild is not blocked by schema or architecture.
- The project already has enough reporting structure to favor incremental extension over rewrite.
- Shift and cash reporting should be derived from `cash_shifts` and `shift_denominations` in the current production schema.
- Sales and returns are not directly linked to sessions in production, so session-based reporting must use outlet plus shift time windows unless the schema changes.
- The biggest remaining work is in:
  - UX consolidation
  - adding a few missing dedicated endpoints
  - widening filters to match the old operator workflows
- Legacy screenshot parity should be treated as capability parity, not exact screen parity.

## Rebuild Principles

- Rebuild by workflow, not by screenshot count.
- Keep dense legacy report coverage, but consolidate overlapping reports behind cleaner filters and reusable table/chart views.
- Prioritize cashier, inventory, purchasing, and closing flows before long-tail analytics.
- Treat dashboards and reports as separate concerns:
  - dashboards for quick decisions
  - reports for export, audit, and drill-down
- Keep module boundaries aligned with the current OneShopPOS architecture where practical.

## Target Module Groups

1. Sales
2. Returns and Exceptions
3. Inventory
4. Purchasing
5. Finance and Settlement
6. Reporting and Analytics
7. Admin Outputs and Audit

## Phase 1: Core Sales And End-Of-Day

### Status

`Nearly complete`

Phase 1 is complete for the current data model from a feature-exposure perspective. The remaining work is validation polish rather than major new reporting capability.

### Goal

Rebuild the highest-frequency operational workflows first so day-to-day POS usage is stable before expanding into deeper reporting.

### Scope

- Sales workspace
- Daily sales summary
- Periodic sales summary
- Cashier-wise and shift-wise sales views
- Sale and refund combined reporting
- Cash closing and shift closing
- Mode of payment summary

### Legacy Features Covered

- `Daily Sale Report`
- `Periodic Sale Report`
- `Cash Closing`
- `Shift Closing`
- `Mode Of Payment`
- `Sale & Refund`
- `Cash Report`
- `Bill Summary`
- `Sale Summary`

### Deliverables

- Unified Sales Reports page
- Reusable filters for store, cashier, shift, date, and time
- Sales summary cards
- Bill-level and summary-level tables
- Export support for CSV/print
- End-of-day closing view with reconciliation totals

### Exit Criteria

- Managers can review daily and shift sales without using legacy report menus.
- Cash closing totals match current production calculations.
- Refunds and voids are visible in the same reporting workflow.

### Phase 1 Validation Update

Validation was run against the live SQLite production database on March 4, 2026.

- Production data confirms:
  - `sales`: `40` rows
  - `returns`: `5` rows
  - `cash_shifts`: `5` rows
  - `shift_denominations`: `12` rows
- Production schema confirms:
  - no `register_sessions` table
  - no `register_denominations` table
  - no `session_id` column on `sales`
  - no `session_id` column on `returns`
- Resulting implementation decision:
  - shift and cash reports are validated through `cash_shifts` plus outlet/time-window derivation
  - denomination reporting is validated through `shift_denominations`
  - returns/session linkage is not populated in production because the schema does not store it
- Verified Phase 1 coverage now includes:
  - daily operations
  - cashier-wise sales
  - refunds and voids
  - shift summary
  - shift sales
  - payment summary
  - cash flow
  - cash audit
  - denominations
  - session z-report
  - time-of-day filtering
- Explicit scope decision:
  - station-wise reporting is deferred because the current POS does not capture station/register attribution as a reportable dimension

### Remaining To Fully Close Phase 1

- complete final UAT against real operating days and closing routines
- decide whether cashier-wise needs deeper drilldowns beyond the current summary table
- optionally add more explicit reconciliation cues between daily operations and shift/cash reports

### Phase 1 UAT Conclusion

The targeted UAT pass was completed against live production data on March 4, 2026 using the actual report route logic and the production SQLite database.

- Verified scenarios:
  - `2026-03-04` day-level sales for outlet `1`
  - shift `#4` as a normal closed sales shift
  - shift `#5` as an open shift with no sales yet
  - shift `#3` as a refund-only closed shift
- Verified results:
  - day-level sales totals for `2026-03-04` show `5` orders and `950` revenue for outlet `1`
  - selected shift `#4` correctly isolates `4` orders and `350` revenue inside the closed shift window
  - selected shift `#4` payment summary correctly reports `Cash = 350`
  - selected shift `#4` cash audit correctly lists four cash sale events inside the shift window
  - selected shift `#3` correctly reports `0` sales and `1990` returns, proving refund-only shift handling works
- Cashier-wise decision:
  - no deeper drilldown is required to close Phase 1
  - the current cashier summary is adequate because detailed order-level drilldown already exists elsewhere in the sales workspace
  - deeper cashier drilldowns can be deferred unless future operators require transaction-level cashier investigation from the same tab
- Reconciliation UX decision:
  - implemented
  - `Daily Operations` now shows selected-shift reconciliation, tender mix, and cash variance context when a shift filter is applied

## Phase 2: Item, Category, Supplier, And Brand Performance

### Status

`Complete`

Phase 2 is complete for the currently agreed scope.

### Goal

Replace fragmented product performance reports with a cleaner merchandising and performance analysis layer.

### Scope

- Itemwise sales
- Category-wise sales
- Supplier-wise sales
- Brand-wise sales
- Monthly and date-wise comparisons
- Top-selling item views

### Legacy Features Covered

- `Itemwise Sale Report`
- `Category Wise Sale Report`
- `Supplier Wise Sale Report`
- `Brand Wise Sale Report`
- `Monthly`
- `Sale Age`
- `Summary`

### Deliverables

- Product Performance page
- Unified merchandising workspace
- Dedicated brand-wise report
- Shared dimension filters:
  - category
  - sub-category
  - supplier
  - brand
  - item
- Toggleable views for summary, detail, and trend
- Top-items widgets and contribution tables

### Exit Criteria

- Users can answer "what sold" by item, category, supplier, or brand from one module.
- Existing category and supplier drill-down use cases are preserved.

### Phase 2 Progress Update

Implemented in the current slice:

- dedicated `brand-wise` reporting endpoint and frontend tab
- unified merchandising workspace spanning:
  - item
  - category
  - brand
  - supplier
- stronger product-performance rows with:
  - category
  - brand
  - supplier
  - shared search and dimension filters
- drill-through actions from the unified workspace into:
  - category filter
  - supplier filter
- monthly/date-comparison reporting for:
  - item performance
  - category performance
  - brand performance

Current implementation references for this slice:

- frontend:
  - `frontend/src/pages/Reports.jsx`
  - `frontend/src/pages/reports/ReportsInventory.jsx`
- backend:
  - `backend/routes/reports/sales.js`

Additional progress completed after the initial Phase 2 slice:

- category, brand, and supplier drill-through now route directly into `product-performance`
- chart-based trend views now sit on top of the comparison tables
- supplier-period comparison depth is implemented
- sub-category comparison depth is implemented from the existing hierarchical category tree

### Phase 2 Final Signoff

Phase 2 was closed against the agreed scope after the following decisions and validations:

- product decision:
  - comparison tables should drill through into the same filtered `product-performance` report tab
  - no additional legacy-style manager views are required for Phase 2 signoff
- completed functional coverage:
  - brand-wise reporting
  - unified item/category/brand/supplier merchandising workspace
  - cross-dimension drill-through into product performance
  - item/category/brand/supplier date comparison
  - item/category/brand/supplier monthly leader views
  - sub-category comparison and monthly taxonomy depth
  - export coverage for comparison and monthly leader datasets
- final validation:
  - frontend production build passed
  - live report-route validation confirmed comparison payloads for:
    - item
    - category
    - sub-category
    - brand
    - supplier

Remaining work related to these reports now moves out of Phase 2 and into later optimization/polish only if users request it.

## Phase 3: Inventory And Stock Control

### Status

`Complete`

Phase 3 is complete for the current agreed scope. Barcode/label output, FIFO handling, expiry handling, and rack/bin location filtering remain intentionally out of scope unless the product direction changes later.

### Goal

Rebuild stock inquiry and item master visibility so teams can audit stock conditions without relying on legacy list screens.

### Scope

- Present stock position
- Item file lookup
- Stock anomalies
- Price and margin checks

Current implementation decision for Phase 3:

- keep extending the existing inventory tabs instead of replacing them with a single new inventory page
- leave barcode and label actions out of the current phase
- leave FIFO and expiry handling out of the current phase
- treat outlet as the only supported location dimension in the current schema

### Legacy Features Covered

- `List Of Item File`
- `Present Stock Position`
- `Inhand = 0`
- `Inhand < 0`
- `CostPrice <= 0`
- `Sale Price = 0`

Explicitly excluded from the current Phase 3 scope:

- `Barcode`
- `Label`
- `FIFO`
- `Expiry Date`

### Deliverables

- stronger `Product Spec` item-file / master lookup workflow
- Advanced stock filters
- Stock health widgets
- Price/margin exception views
- advanced inventory health reports
- Exportable stock tables

### Exit Criteria

- Inventory staff can find zero-stock, negative-stock, zero-price, and margin-risk items from one place.
- Stock lookup supports supplier, brand, category, and hierarchical sub-category filtering.
- Outlet-level filtering is available everywhere inventory reports support location today.
- The roadmap explicitly avoids promising rack/bin location filtering until the schema supports it.

### Phase 3 Batch 1 Progress

Implemented in the current batch:

- extended existing inventory tabs instead of creating a new consolidated inventory page
- outlet-detail and all-outlet aggregate modes in stock lookup views
- anomaly presets for:
  - low stock
  - zero stock
  - negative stock
  - zero sale price
  - zero cost
  - cost greater than or equal to sale
  - margin risk
- pricing exception reporting with both margin-risk rules:
  - cost greater than or equal to sale price
  - margin below threshold
- shared inventory filtering by:
  - category
  - brand
  - supplier
  - search

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/reports/ReportsInventory.jsx`
- backend:
  - `backend/routes/reports/inventory.js`

Current validation note:

- the live production dataset currently contains no zero-stock, negative-stock, zero-price, zero-cost, or margin-risk matches, so Batch 1 validation confirms query behavior and UI integration but not high-volume anomaly coverage yet

### Phase 3 Batch 2 Progress

Implemented in the current batch:

- enabled advanced inventory health reporting in the current environment through the existing `reports_inventory_health_plus` feature gate
- extended `product-spec` backend output to support richer item-file fields:
  - SKU
  - status
  - product type
  - min/max quantity
  - unit
  - total stock
  - outlet count
- extended `Product Spec` in the frontend into an item-file / product-master lookup workflow
- added explicit supplier-aware item-file filtering in the current `Product Spec` tab
- exposed advanced inventory health tabs:
  - `dead-stock`
  - `stock-aging`
  - `stockout-risk`
  - `forecast-demand`
  - `replenishment-smart`
- widened advanced inventory health filters where supported by the current schema:
  - outlet
  - category and sub-category via the hierarchical category tree
  - brand
  - supplier
  - free-text search

Current schema note:

- true rack/bin/location filtering is still not supported because the live schema only stores outlet-level stock, not intra-outlet location metadata

### Phase 3 UAT Conclusion

The targeted UAT pass was completed against the live SQLite production database on March 4, 2026 using the actual report route logic and the current report UI scope.

- Verified live baseline:
  - `products`: `6`
  - `outlet_stock`: `7`
  - `outlets`: `2`
  - `suppliers`: `2`
  - `reports_inventory_health_plus`: enabled
- Verified item-file / master lookup behavior:
  - `product-spec` returns `6` live products
  - supplier-filtered `product-spec?supplier_id=1` returns `2` rows
- Verified inventory health behavior:
  - `dead-stock?inactive_days=60` returns `1` row
  - `stock-aging` returns `7` rows
  - `stockout-risk?outlet_id=1&lookback_days=30` returns `5` rows
  - `forecast-demand?outlet_id=1&lookback_days=28` returns `4` rows after the forecasting fix
  - `replenishment-smart?outlet_id=1&lookback_days=365&forecast_days=14` returns `4` rows after the forecasting fix
- Verified live findings:
  - current dead stock example is `Plush Buddy Bear` in `Main Store`
  - current dead stock quantity is `80`
  - current dead stock cost value is `3600`
  - current dead stock retail value is `6000`
  - current stockout-risk rows are presently all `stable` for the tested outlet window
- Bug found and fixed during UAT:
  - `forecast-demand` and `replenishment-smart` were originally returning zero rows because `buildForecastRows()` had incorrect SQL parameter ordering
  - forecast and cover calculations also needed real-number division instead of integer truncation
  - both issues were fixed in `backend/routes/reports/inventory.js`

### Phase 3 Closeout

- Barcode and label work is intentionally excluded by product decision.
- FIFO and expiry are intentionally excluded by product decision.
- Rack/bin location filtering remains unavailable because the schema does not support it.
- Phase 3 is complete for the current rebuild scope.

## Phase 4: Purchasing And Purchase Orders

### Status

`Complete`

Phase 4 is complete for the current agreed scope. The remaining procurement risk is historical data quality, not missing reporting capability.

### Goal

Rebuild procurement reporting and receiving workflows after inventory visibility is stable.

### Scope

- Total purchases
- Itemwise purchases
- Purchase GST/no-GST summaries
- Adjustments and transfers
- Purchase order status views
- Not received and pending PO tracking

### Legacy Features Covered

- `Total Purchases`
- `Itemwise Purchases`
- `P/O`
- `Generate PO`
- `Pending`
- `Not Received`
- `Purchase GST`
- `Purchase No GST`
- `Adjustment`
- `Transfer`

### Deliverables

- Purchasing Reports page
- PO and receiving status widgets
- Purchase detail and summary tables
- GST/no-GST report variants
- Supplier-focused purchase analysis

### Exit Criteria

- Procurement staff can review total purchases, item purchases, and pending POs from one workflow.
- Receiving and PO status no longer depend on legacy-style multi-button screens.

### Phase 4 Batch 1 Progress

Implemented in the current batch:

- added dedicated backend reports for:
  - `/api/reports/total-purchases`
  - `/api/reports/itemwise-purchases`
- added dedicated frontend procurement tabs for:
  - `total-purchases`
  - `itemwise-purchases`
- added status presets for:
  - all
  - received
  - pending
  - not received
- added purchase tax presets for:
  - all tax
  - GST
  - no GST
- fixed the purchase-order registry tab to read the live response shape from `/api/purchase-orders`
- corrected the GRN report to source date and outlet from `goods_received_notes` instead of relying on `purchase_orders`

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/reports/ReportsPurchasing.jsx`
  - `frontend/src/pages/Reports.jsx`
- backend:
  - `backend/routes/reports/purchasing.js`
  - `backend/routes/reports/index.js`
  - `backend/routes/reports/inventory.js`

### Phase 4 Validation Update

Validation was run against the live SQLite production database on March 4, 2026.

- Verified live report counts:
  - `total-purchases`: `4` rows
  - `itemwise-purchases`: `4` rows
  - `itemwise-purchases?tax_mode=gst`: `3` rows
  - `itemwise-purchases?tax_mode=no_gst`: `1` row
  - `grn-report`: `5` rows
  - `/api/purchase-orders`: `4` rows
- Verified live procurement summary:
  - ordered cost: `2690`
  - received cost: `2690`
  - ordered tax: `380.8`
  - received tax: `380.8`
- Verified live itemwise tax split:
  - GST purchasing exists for `3` item rows
  - no-GST purchasing currently exists for `1` item row
- Important live data finding:
  - one PO is marked `Received` while still resolving as `not received` from the report logic because there is no linked GRN row
  - procurement reporting therefore now treats `not received` as a receiving-state check, not only a PO status check
- GST implementation note:
  - purchase GST/no-GST reporting is derived from the product tax profile (`taxes.rate` or legacy `products.gst`) because the schema does not store purchase-tax postings separately

### Phase 4 Batch 2 Progress

Implemented in the current batch:

- added explicit PO workflow reporting in:
  - `/api/reports/po-workflow`
- added procurement parity reporting in:
  - `/api/reports/procurement-parity`
- added procurement workflow tabs for:
  - `po-workflow`
  - `procurement-parity`
- surfaced counters for:
  - draft POs
  - pending approval POs
  - approved but not yet received POs
  - received POs without GRN linkage
  - unpaid invoice counts
  - overdue invoice counts
- added procurement parity coverage for:
  - supplier receipts
  - inventory transfers
  - stock adjustments
- hardened procurement parity against orphaned historical transfer rows by using tolerant joins instead of assuming every historical transfer still links to a current product record

### Phase 4 UAT Conclusion

The targeted UAT pass was completed against the live SQLite production database on March 4, 2026 using the actual procurement and supplier-payables route logic.

- Verified live workflow summary:
  - `po_count`: `4`
  - `received_without_grn_count`: `1`
  - `unpaid_invoice_count`: `1`
  - `invoice_due`: `2610`
- Verified live receipt and payment scenarios:
  - one real `Received Unpaid` PO exists:
    - PO `#4`
    - supplier `Supplier A`
    - GRN linked
    - invoice amount `2610`
    - amount paid `0`
    - amount due `2610`
  - one real `Complete` PO exists:
    - PO `#3`
    - supplier `Supplier A`
    - GRN linked
    - invoice amount `100`
    - amount paid `100`
    - amount due `0`
  - one real `Received Without GRN` PO exists:
    - PO `#1`
    - status `Received`
    - no GRN row
    - no supplier invoice row
- Verified procurement parity summary:
  - `receipt_count`: `4`
  - `transfer_count`: `2`
  - `adjustment_count`: `0`
- Important live data findings:
  - transfer history exists in production, but some transfer rows are orphaned from current product or outlet references
  - those rows are now surfaced as `Unknown Product` or `Unknown Outlet` instead of being silently dropped
  - one PO is still marked `Received` without an associated GRN, confirming that receipt-state monitoring is necessary even when PO status looks complete

### Phase 4 Cleanup Pass

After the UAT findings, a focused live-data cleanup pass was completed on March 4, 2026.

- applied repairs:
  - restored outlet `#3` as `Historical Outlet 3 (Inactive)` to recover legacy transfer and GRN outlet references
  - backfilled a missing GRN for historical PO `#1`
  - annotated orphaned transfer rows with explicit historical-reference notes
- verified post-cleanup state:
  - `received_without_grn_count`: `0`
  - `not_received_count`: `0`
  - `grn-report`: `6` rows
  - procurement parity now shows:
    - `receipt_count`: `6`
    - `transfer_count`: `2`
    - `adjustment_count`: `0`
- remaining historical limitation:
  - orphaned transfer product references still exist for deleted product IDs
  - these now retain outlet context and explicit notes, but product identity cannot be fully restored without inventing replacement product masters

### Phase 4 Signoff Recommendation

- Phase 4 is complete enough to move to Phase 5.
- The procurement reporting workflow now covers:
  - total purchases
  - itemwise purchases
  - GST/no-GST purchase splits
  - PO workflow state
  - GRN visibility
  - supplier invoice/payment state
  - procurement parity across receipts and transfers
- The only remaining concern is historical data integrity for deleted transfer product references, which is not a reporting-feature blocker.

## Phase 5: Finance, Settlement, And Payment Analysis

### Status

`Complete`

Phase 5 is complete for the current agreed scope. The finance workspace is implemented, live UAT passed after one outlet-filter fix, and the remaining bank-balance gap is intentionally deferred until a ledger source exists.

### Goal

Consolidate settlement, cash, supplier payment, and receivable/payable visibility into clearer finance-facing screens.

### Scope

- Cash in hand
- Bank balances
- Supplier payments
- Customer receipts
- Payables and receivables
- MOP contribution and detail

### Legacy Features Covered

- `Cash In Hand`
- `Bank Balances`
- `Supplier Payable`
- `Customer Receivable`
- `Todayâ€™s Supplier Payments`
- `Todayâ€™s Customer Receipts`
- `MOP Detail`
- `MOP Contribution In Sales`

### Deliverables

- Settlement Overview page
- Payment mix reporting
- Cash summary cards
- Supplier/customer settlement tables
- Daily and monthly rollups

### Exit Criteria

- Managers can review operational cash and tender mix without opening multiple report forms.
- Finance users can track supplier/customer balances from one module.
- The team has made an explicit product decision on whether bank balances stay deferred until a ledger source exists.

### Phase 5 Batch 1 Progress

Implemented in the current batch:

- added dedicated backend finance reports for:
  - `/api/reports/settlement-overview`
  - `/api/reports/payables-receivables`
  - `/api/reports/supplier-payments-invoices`
  - `/api/reports/finance-payment-mix`
- added dedicated frontend finance tabs for:
  - `settlement-overview`
  - `payables-receivables`
  - `supplier-payments-invoices`
  - `finance-payment-mix`
- linked finance reporting to the shared report filters:
  - date
  - time
  - outlet
  - supplier
  - search
- surfaced finance-side payment mix so payment analysis is no longer limited to shift/session-only views
- consolidated AP/AR and supplier payment visibility into the main reports workspace instead of relying on standalone accounting and redesign pages

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/Reports.jsx`
  - `frontend/src/pages/reports/ReportsFinance.jsx`
- backend:
  - `backend/routes/reports/finance.js`
  - `backend/routes/reports/index.js`
  - `backend/routes/tier4/accounting.js`
  - `backend/routes/grn.js`

### Phase 5 Current Limitation

- There is still no real bank ledger or bank-balance reporting source in the schema.
- Finance reporting currently covers:
  - inflows
  - expenses
  - supplier payments
  - supplier payables
  - customer receivables
  - payment mix
- Finance reporting does not yet cover:
  - ledger-backed bank balances
  - a dedicated customer receipt-event journal separate from receivable balances

### Phase 5 Live UAT

Live UAT was run on March 4, 2026 against the current finance routes and `oneshop.db`, using real date ranges and outlet filters.

Validated endpoints:

- `/api/reports/settlement-overview`
- `/api/reports/payables-receivables`
- `/api/reports/supplier-payments-invoices`
- `/api/reports/finance-payment-mix`

Validated scenarios:

- overall range `2026-02-22` to `2026-03-04`
- outlet-specific range for `Main Store` (`outlet_id=1`)
- outlet-specific range for `Branch Store` (`outlet_id=2`)
- single-day check for `2026-03-04` at `Main Store`

Live UAT results:

- overall settlement:
  - inflows `51934.03`
  - supplier payments `180`
  - net cashflow `51754.03`
  - supplier outstanding `2610`
  - customer receivable `500`
- `Main Store` settlement:
  - inflows `51606.53`
  - supplier payments `100`
  - open supplier invoices `1`
  - supplier outstanding `2610`
- `Branch Store` settlement:
  - inflows `300`
  - no supplier-payment or payable exposure in the tested range
- payables and receivables:
  - `3` supplier invoices overall
  - `2` supplier invoices tied to `Main Store`
  - `1` customer with open receivable balance
- finance payment mix:
  - overall primary tender is `Cash`
  - overall sale mix is `Cash 46992.50` and `Card 4941.53`
  - `2026-03-04` at `Main Store` shows inflows `650` with `Cash 550` and `Card 100`

UAT finding and fix:

- outlet-filtered finance AP and settlement views were initially dropping valid supplier rows because SQLite was comparing outlet parameters as strings inside `COALESCE(...)` outlet expressions
- this was fixed by normalizing `outlet_id` and `supplier_id` to numeric values in `backend/routes/reports/finance.js`

### Phase 5 Product Decisions

The following decisions are now explicit and should remain part of the roadmap unless product direction changes later:

- `Bank balances` are deferred until ledger support exists.
  - Reason: there is no current bank ledger or account transaction source that can produce accounting-truth balances.
- `Customer receipts ledger` is deferred.
  - Reason: the current need is customer receivable visibility, not a separate receipt-event journal.
- Phase 5 current accepted scope is:
  - settlement overview
  - payables and receivables
  - supplier payments and invoices
  - finance payment mix
  - no bank ledger
  - no standalone customer receipt-event ledger

## Phase 6: Dashboard And Executive Analytics

### Status

`Complete except optional Batch 7D`

Phase 6 is started as a consolidation and alignment phase, not a blank-slate build. OneShopPOS already has a reports dashboard, analytics tabs, and a separate redesigned dashboard route, but these surfaces are not yet fully aligned around one executive workflow.

### Goal

Rebuild the legacy dashboard into a modern decision layer after core operational reports are stable.

### Scope

- KPI dashboard
- Comparative sales/purchase trends
- Category contribution
- Sale type contribution
- MOP contribution
- Top sellers by department/class
- Discount, void, and refund visibility

### Legacy Features Covered

- `Current Stock`
- `Todayâ€™s Sale`
- `Todayâ€™s Average Bill`
- `Todayâ€™s Refund`
- `Monthâ€™s Sale`
- `Monthâ€™s Purchase`
- `Todayâ€™s Gross Margin`
- `Monthâ€™s Gross Margin`
- `Top 50 Selling Items`
- `Category Contribution In Sales`
- `Sale Purchase Comparison`
- `Todayâ€™s Discount`
- `Todayâ€™s Voids`
- `Todayâ€™s Refunds`

### Deliverables

- Executive dashboard
- Role-based summary widgets
- Trend charts
- Contribution charts
- Top-items panels
- Exception panels for discounts, refunds, and voids

### Exit Criteria

- Leadership can monitor daily and monthly performance without entering detailed report pages.
- Dashboard values reconcile with the underlying reports module.

### Phase 6 Baseline

Current Phase 6 groundwork already exists in the codebase:

- reports dashboard endpoint:
  - `backend/routes/reports/dashboard.js`
- analytics endpoints:
  - `backend/routes/reports/analytics.js`
- reports dashboard and analytics tabs:
  - `frontend/src/pages/reports/ReportsSales.jsx`
  - `frontend/src/pages/reports/ReportsAnalytics.jsx`
  - `frontend/src/pages/Reports.jsx`
- separate redesigned dashboard route:
  - `frontend/src/pages/redesign/DashboardRedesign.jsx`
  - `frontend/src/pages/DashboardRoute.jsx`

Current Phase 6 starting observations:

- the reports workspace already covers:
  - overview dashboard
  - comparative trends
  - heatmaps
  - revenue leaks
  - product mix
  - retail matrix
- the standalone redesigned dashboard already exists, but it expects a richer dashboard payload shape than the current `reports/dashboard` route clearly guarantees
- Phase 6 should therefore focus on:
  - unifying the executive dashboard story
  - aligning dashboard payloads with the current reports data model
  - closing the remaining KPI and contribution gaps from the legacy screenshots

### Phase 6 Batch 1 Progress

Implemented in the current batch:

- aligned `/api/reports/dashboard` to serve both:
  - the reports overview tab
  - the standalone redesigned dashboard route
- preserved the existing reports-overview payload fields:
  - `salesByOutlet`
  - `topProducts`
  - `monthlyTrend`
  - `hourlySales`
  - `categoryPerformance`
  - `inventory`
- added the redesigned-dashboard payload fields on the same endpoint:
  - `saleCount`
  - `todayProfit`
  - `todayGrossProfit`
  - `todayExpenses`
  - `inventoryValue`
  - `topSelling`
  - `lowStock`
  - `salesTrend`
  - `attendanceSummary`
- added outlet-aware dashboard filtering so the executive dashboard contract can now respond consistently to `outlet_id`
- normalized attendance detail output so negative historical `duration_hours` values do not leak into executive dashboard tiles

Current implementation references for this batch:

- backend:
  - `backend/routes/reports/dashboard.js`
- frontend consumers:
  - `frontend/src/pages/reports/ReportsSales.jsx`
  - `frontend/src/pages/redesign/DashboardRedesign.jsx`

### Phase 6 Batch 2 Progress

Implemented in the current batch:

- reshaped the standalone dashboard into an executive summary surface instead of a competing analytics workspace
- added legacy-aligned KPI coverage to the shared dashboard payload:
  - `averageBill`
  - `monthSales`
  - `monthPurchases`
  - `refundsToday`
  - `voidsToday`
  - `discountsToday`
  - `paymentContribution`
  - `categoryContribution`
  - `salePurchaseComparison`
- added standalone executive panels for:
  - discounts
  - voids
  - refunds
  - category contribution
  - payment contribution
  - sales versus purchases
- intentionally kept the standalone dashboard at summary level and pushed deeper investigation back to the analytics/report tabs via drill-through actions

Why this matters:

- the standalone dashboard now aligns better with the legacy management-dashboard targets
- the analytics tabs remain the place for deeper comparisons, heatmaps, revenue leakage analysis, and product-mix detail
- this reduces overlap instead of creating two different screens that both try to do full analytics

### Phase 6 Batch 3 Progress

Implemented in the current batch:

- added the remaining legacy-style executive KPI coverage directly to the shared dashboard payload:
  - `monthGrossMargin`
  - `currentStockUnits`
- added the matching KPI tiles to the standalone dashboard so the executive surface now covers:
  - current stock
  - month sales
  - month purchases
  - month gross margin
  - discounts
  - voids
  - refunds
- reconciled the reports overview tab with the standalone dashboard by aligning the KPI vocabulary and contribution sections:
  - average bill
  - current stock
  - month gross margin
  - category contribution
  - payment contribution
  - executive exception rail

### Phase 6 Live UAT

Live UAT was run on March 4, 2026 against the shared dashboard endpoint and the outlet-filtered executive KPI contract.

Validated outlet scenarios:

- all outlets
- `Main Store` (`outlet_id=1`)
- `Branch Store` (`outlet_id=2`)
- `Historical Outlet 3 (Inactive)` (`outlet_id=3`)

Live UAT results:

- all outlets:
  - today sales `650`
  - average bill `130`
  - month sales `52940`
  - month purchases `2610`
  - month gross margin `448.29`
  - current stock units `322`
- `Main Store`:
  - today sales `650`
  - month sales `52640`
  - month purchases `2610`
  - month gross margin `371.88`
  - current stock units `308`
- `Branch Store`:
  - today sales `0`
  - month sales `300`
  - month gross margin `76.41`
  - current stock units `14`
- `Historical Outlet 3 (Inactive)`:
  - zero current-day and month activity
  - zero current stock units
  - dashboard contract still returns stable zeroed executive values

Phase 6 dashboard alignment result:

- the standalone dashboard and reports overview now consume the same expanded dashboard contract
- the standalone dashboard remains the executive summary surface
- the reports overview now mirrors the same KPI language instead of drifting into a different interpretation of “overview”

### Phase 6 Final Refinement

- tightened the top-selling executive panels from all-time ranking to a rolling `30-day` view so dashboard leadership signals stay current instead of being dominated by historical lifetime volume

### Phase 6 Signoff Recommendation

- Phase 6 is complete enough to move to Phase 7.
- The dashboard layer now covers the main legacy executive targets that are realistically supported by the current schema:
  - current stock
  - today sale
  - today average bill
  - today refund
  - month sale
  - month purchase
  - today gross margin
  - month gross margin
  - top-selling items
  - category contribution
  - sale/purchase comparison
  - today discount
  - today voids
  - payment contribution
- The main remaining dashboard limitation is `sale type contribution`, which is not yet a first-class data concept in the current schema and is therefore better treated as a later enhancement than a Phase 6 blocker.

### Phase 5 Closeout Decision

- Phase 5 is closed for the current scope.
- No additional Phase 5 UX polish is required before starting Phase 6.
- Deferred by product decision:
  - bank balances until a ledger source exists
  - standalone customer receipts ledger until receipt-event tracking is needed

## Phase 7: Long-Tail Legacy Coverage And Audit Tools

### Status

`Started`

Phase 7 is complete for the agreed rebuild scope. The only remaining work is optional `Batch 7D` service-counter legacy coverage if a real schema-backed need appears later.

### Goal

Close remaining parity gaps only after primary workflows are complete and validated.

### Scope

- Rare report variants
- Specialized GST outputs
- Cheque/customer/waiter/table detail views
- Audit and history utilities
- Legacy edge-case exports

### Legacy Features Covered

- `GST Output`
- `GST Type`
- `Cheque No Report`
- `Waiter Hour`
- `Table Summary`
- `History Cost`
- `History Sale`
- `Ref`
- `Criteria`
- `Item Not Found`

### Deliverables

- Audit and Utilities page
- Advanced export actions
- Specialist report tabs where needed
- Gap list closure against legacy screenshots

### Exit Criteria

- The remaining legacy-only use cases are either rebuilt, intentionally deprecated, or documented as out of scope.

### Phase 7 Planned Batches

The remaining Phase 7 scope should be implemented in these batches:

1. `Batch 7A: Exceptions And Advanced Audit Exposure`
- expose `discount-leakage` as a first-class report tab
- expose `exceptions` as a first-class report tab
- keep governance focused on:
  - schedules
  - saved views
  - definition versions
  - delivery log
- do not leave exception analysis hidden behind redesign-only panels

2. `Batch 7B: GST And Tax Specialist Outputs`
- add dedicated GST specialist reporting surfaces where the current schema supports them
- focus on legacy-style `GST Output` and `GST Type` parity, not generic tax duplication

3. `Batch 7C: History And Product Audit Utilities`
- extend inventory/product audit tools with:
  - history cost
  - history sale
  - item-not-found or reference-style utilities
  - criteria-style exception utilities where supported

4. `Batch 7D: Legacy Service-Counter Views`
- treat waiter/table/cheque-style reports as last-priority and optional
- only implement where the current schema actually supports the workflow

### Phase 7 Current Recommendation

- `Batch 7A`: signed off
- `Batch 7B`: signed off
- `Batch 7C`: signed off
- `Batch 7D`: optional and deferred unless a real schema-backed need appears

### Phase 7 Batch 7A Progress

Implemented in the current batch:

- exposed `discount-leakage` as a first-class tab in the main reports workspace
- exposed `exceptions` as a first-class tab in the main reports workspace
- kept governance focused on:
  - schedules
  - saved views
  - definition versions
  - delivery log
- added feature-disabled states so these audit tabs fail cleanly when the corresponding backend feature flags are off instead of showing broken tables

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/Reports.jsx`
  - `frontend/src/pages/reports/ReportsAudit.jsx`
  - `frontend/src/pages/reports/ReportsGovernance.jsx`
- backend:
  - `backend/routes/reports/analytics.js`
  - `backend/routes/reports/governance.js`

Batch 7A result:

- exception analysis is no longer hidden behind redesign-only power-up panels
- specialist audit outputs are now reachable from the main reports module

### Phase 7 Batch 7A UAT

Live validation was run against the production SQLite database on March 4, 2026.

- Verified live source conditions:
  - `reports_profit_layer = 0`
  - `reports_exceptions = 0`
  - discounted sales rows in live data: `6`
  - total live discount amount in scope: `971`
  - live voided sales rows: `1`
  - live void value: `4340`
  - live return lines: `6`
  - live return value: `2393`
- UAT conclusion:
  - the new `Discount Leakage` and `Exceptions` tabs are working correctly for the current environment
  - in production today they should show an explicit feature-disabled state, not live grids, because the corresponding feature flags are intentionally off
  - Batch 7A therefore closes as an exposure and environment-clarity task, not as a feature-flag enablement task

### Phase 7 Batch 7C Progress

Implemented in the current batch:

- added dedicated `history-cost`, `history-sale`, and `product-audit` tabs to the main reports workspace
- extended the existing catalog/product reporting module instead of creating a separate long-tail audit page
- added backend report routes for:
  - `/api/reports/history-cost`
  - `/api/reports/history-sale`
  - `/api/reports/product-audit`
- product audit now covers live-schema utility checks for:
  - missing barcode
  - missing SKU
  - missing supplier
  - missing category
  - unset min/max controls
  - inactive products with stock
  - products with stock but no recent sales for a configurable idle window

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/Reports.jsx`
  - `frontend/src/pages/reports/ReportsCatalog.jsx`
- backend:
  - `backend/routes/reports/inventory.js`

### Phase 7 Batch 7C Validation

Live validation was run against the production SQLite database on March 4, 2026.

- Verified live baseline:
  - `grn_items`: `8`
  - `sale_items`: `45`
  - `inventory_transfers`: `2`
  - `stock_adjustments`: `0`
- Verified live history coverage:
  - cost history has live GRN-backed rows from `goods_received_notes` and `grn_items`
  - sale history has live sale-line rows from `sales` and `sale_items`
- Verified current audit utility reality:
  - the schema supports strong product-master checks and sales/cost history
  - the schema does not currently support a richer historical adjustment audit because `stock_adjustments` has no live rows
- Batch 7C result:
  - history cost, history sale, and product-master audit utilities are now first-class reports
  - the remaining Phase 7 work shifts to GST specialist outputs and any truly needed service-counter legacy reports only

### Phase 7 Batch 7A/7C Signoff

- `Batch 7A`: signed off for the current environment
- `Batch 7C`: signed off for the current schema and live data
- no further work is required on these batches unless:
  - the production feature-flag posture changes for specialist audit tabs
  - or product later asks for deeper master-data criteria beyond the current audit checks

### Phase 7 Batch 7B Progress

Implemented in the current batch:

- added dedicated finance-side GST specialist tabs:
  - `gst-output`
  - `gst-type-summary`
- added backend report routes for:
  - `/api/reports/gst-output`
  - `/api/reports/gst-type-summary`
- kept GST reporting aligned to the live schema by using:
  - product tax profiles from `tax_id` with fallback to legacy `gst`
  - sales line items for output GST math
  - purchase order items and GRN items for ordered and received input-tax math

Current implementation references for this batch:

- frontend:
  - `frontend/src/pages/Reports.jsx`
  - `frontend/src/pages/reports/ReportsFinance.jsx`
- backend:
  - `backend/routes/reports/finance.js`

Current implementation note:

- the live schema does not store a separate tax column directly on sales or purchase invoices
- GST outputs are therefore computed from line values plus the current product tax profile, which is the same pattern already used elsewhere in the current dashboard/reporting layer

### Phase 7 Batch 7D Review

- `Batch 7D` remains deferred
- current schema review still does not show a strong waiter/table/cheque service-counter model worth surfacing as first-class reports
- unless product later confirms those workflows are required and backed by real data, `Batch 7D` should stay optional

### Phase 7 Batch 7B Validation

Live validation was run against the production SQLite database on March 4, 2026.

- verified live GST output route:
  - `/api/reports/gst-output`
  - status `200`
  - `15` GST-taxed sales lines in scope
  - inclusive sales `963.5`
  - exclusive sales `823.5`
  - output GST `140`
- verified live GST type summary route:
  - `/api/reports/gst-type-summary`
  - status `200`
  - total sales inclusive `1413.5`
  - total output GST `140`
  - ordered input GST `380.8`
  - received input GST `380.8`
  - current net GST position `-240.8`
- current implementation conclusion:
  - Batch 7B has a working live baseline
  - the next work in this batch is UI/UAT polish and any tax-report wording refinements, not missing backend capability

### Phase 7 Batch 7B UAT Conclusion

Focused UAT was completed against live outlet/date scenarios on March 4, 2026.

- verified GST output behavior across scopes:
  - all outlets, GST only: `15` taxed lines, output GST `140`
  - `Main Store`: `8` taxed lines, output GST `92.27`
  - `Branch Store`: `3` taxed lines, output GST `43.59`
  - no-tax mode: `3` non-tax lines, GST `0`
- verified GST type summary behavior across scopes:
  - all outlets: net GST position `-240.8`
  - `Main Store`: net GST position `-283.44`
  - `Branch Store`: net GST position `43.59`
- wording/export refinement completed:
  - labels now distinguish:
    - sales inclusive of GST
    - sales exclusive of GST
    - output GST
    - received input GST
  - export headers now match the tax-report terminology used in the UI
- Batch 7B result:
  - GST specialist outputs are sufficient for the current schema and agreed rebuild scope

### Phase 7 Status Recommendation

- Phase 7 is effectively complete for the current agreed scope
- the only remaining Phase 7 work is optional:
  - `Batch 7D` service-counter legacy views, but only if product later confirms a real schema-backed need

## Roadmap Closeout

### Overall Status

`Complete except optional Phase 7D`

The rebuild roadmap is complete for the agreed scope.

What remains deferred or optional:

- `Phase 7D` legacy service-counter views
- bank balances until a real ledger source exists
- customer receipts ledger until receipt-event tracking is needed
- station-wise reporting until station/register attribution exists in the schema
- barcode/label, FIFO, expiry, and rack/bin location support unless product direction or schema changes later

## Priority Summary

| Phase | Name | Why It Comes First |
|---|---|---|
| 1 | Core Sales And End-Of-Day | Highest daily usage and operational risk |
| 2 | Product Performance | Core manager reporting after sales stability |
| 3 | Inventory And Stock Control | Critical for item, stock, and pricing operations |
| 4 | Purchasing And Purchase Orders | Dependent on inventory and supplier visibility |
| 5 | Finance, Settlement, And Payment Analysis | Depends on sales and purchasing data consistency |
| 6 | Dashboard And Executive Analytics | Best rebuilt after underlying report logic is stable |
| 7 | Long-Tail Legacy Coverage And Audit Tools | Lowest priority, highest fragmentation |

## Suggested Delivery Strategy

- Build shared reporting primitives first:
  - filter bar
  - summary cards
  - table shell
  - export actions
  - chart blocks
- Keep one report registry/config model where possible instead of separate one-off pages for every old button.
- Validate each phase against the screenshot-derived feature list before moving to the next one.
- Treat legacy parity as controlled scope, not an unlimited requirement.
- Prefer extending existing report modules and endpoints before adding new one-off pages.
- Treat backend-complete but frontend-hidden reports as exposure work, not greenfield work.

## Explicit Non-Goals For Now

- No attempt to recreate the exact visual layout of the legacy WinForms screens.
- No one-to-one migration of every button before workflow consolidation is evaluated.
- No implementation work is started by this document alone.


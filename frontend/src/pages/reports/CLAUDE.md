# Report Pages — Claude Guide

- **24 files** — all report tab components, orchestrated by `pages/Reports.jsx`
- **`ReportShared.jsx`** — shared utilities: `fmtDate`, `fmtDateTime`, `exportCSV(filename, cols, rows)` (forces text for barcode/sku via `="value"` Excel trick), `ExportButton`, `TableShell`, `CardShell`
- **Barrel re-exports**: `ReportsSales.jsx` re-exports from SalesOverview/Core/Detail/Operations. `ReportsInventory.jsx` re-exports from InventoryCore/Analytics/Health/Replenishment
- **Wave 16 report modules**: `ReportsMultichannel.jsx` (POS vs Shopify vs WooCommerce channel breakdown with PieChart), `ReportsCommissions.jsx` (`CommissionSummaryTab` — fetches `/commissions/earnings`, status filter, CSV export), `ReportsInventoryHealth.jsx`, `ReportsInventoryReplenishment.jsx` (reorder suggestions, inventory health stats)
- **Pattern**: Each tab uses `useState` + `useEffect` fetch + table/chart render. Charts use Recharts (`BarChart`, `AreaChart`, `PieChart`)
- **Feature-gated tabs**: `ReportsGovernance` (scheduled exports), analytics exception detection, profit layer — check via `useFeatureFlags()`
- **Timestamp gotcha**: `ReportsStaff.jsx` uses `parseLocalDate` (attendance is local time), most others use UTC formatters
- **Date params**: Always `from`/`to` (not `start`/`end`)

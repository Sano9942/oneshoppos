# Report Routes — Claude Guide

- **14 report files**: dashboard, sales, inventory, analytics, purchasing, finance, staff, shifts, governance, fbr-export, stock-aging, multichannel, helpers (shared utilities), index (orchestrator)
- **All require** `view_reports` permission (some need additional feature flags)
- **Feature-gated reports**:
  - `reports_profit_layer` → sales profit margins, analytics profit
  - `reports_inventory_health_plus` → advanced inventory health
  - `reports_exceptions` → analytics exception detection
  - `reports_scheduled_exports` → governance scheduled report generation
  - `e_invoicing_export` → FBR export
- **Date params**: Use `from`/`to` (not `start`/`end`)
- **Governance tables**: `report_schedules`, `report_schedule_runs`, `report_delivery_log`, `saved_report_views`, `report_definition_versions`
- **Frontend**: `pages/reports/*.jsx` (23 module files) orchestrated by `pages/Reports.jsx`

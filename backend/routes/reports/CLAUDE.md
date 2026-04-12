# Report Routes — Claude Guide

- **14 report files**: dashboard, sales, inventory, analytics, purchasing, finance, staff, shifts, governance, fbr-export, stock-aging, multichannel, helpers (shared utilities), index (orchestrator)
- **All require** `view_reports` permission (some need additional feature flags)
- **Feature-gated reports**:
  - `reports_profit_layer` → sales profit margins, analytics profit
  - `reports_inventory_health_plus` → advanced inventory health
  - `reports_exceptions` → analytics exception detection
  - `reports_scheduled_exports` → governance scheduled report generation
  - FBR export (`GET /api/reports/fbr-export`) uses `requirePerm('all_access')` — no feature flag, perm-gated only
- **Date params**: Most report routes use `date_from`/`date_to`. A few (fbr-export, multichannel, some governance) use `from`/`to`. Analytics comparison endpoints use `period1_from`/`period1_to`/`period2_from`/`period2_to`. Never use `start`/`end`
- **Governance tables**: `report_schedules`, `report_schedule_runs`, `report_delivery_log`, `saved_report_views`, `report_definition_versions`, `custom_report_definitions`
- **Frontend**: `pages/reports/*.jsx` (24 module files) orchestrated by `pages/Reports.jsx`

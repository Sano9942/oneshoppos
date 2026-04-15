# Report Routes — Claude Guide

- **15 report files**: dashboard, sales, inventory, analytics, purchasing, finance, staff, shifts, governance, fbr-export, stock-aging, multichannel, clinical, helpers (shared utilities), index (orchestrator)
- **Permission guards vary by file** — most report routes rely on JWT auth only (no explicit `requirePerm`); exceptions: fbr-export requires `all_access`, governance requires `manage_employees`, stock-aging requires `view_reports` or `manage_inventory`, clinical requires `view_reports`
- **Feature-gated reports**:
  - `reports_profit_layer` → sales profit margins, analytics profit
  - `reports_inventory_health_plus` → advanced inventory health
  - `reports_exceptions` → analytics exception detection
  - `reports_scheduled_exports` → governance scheduled report generation
  - `phase4_treatment_plans` + `view_reports` → clinical reports (`GET /api/reports/clinical/plan-completion`, `session-attendance`, `revenue-per-plan`, `patient-retention`, `lab-turnaround`)
  - FBR export (`GET /api/reports/fbr-export`) uses `requirePerm('all_access')` — no feature flag, perm-gated only
- **Date params**: Most report routes use `date_from`/`date_to`. A few (fbr-export, multichannel, some governance) use `from`/`to`. Analytics comparison endpoints use `period1_from`/`period1_to`/`period2_from`/`period2_to`. Never use `start`/`end`
- **Governance tables**: `report_schedules`, `report_schedule_runs`, `report_delivery_log`, `saved_report_views`, `report_definition_versions`, `custom_report_definitions`
- **Frontend**: `pages/reports/*.jsx` (25 module files) orchestrated by `pages/Reports.jsx`

# OneShopPOS Reports Power-Up Plan (Profit + Inventory Control, Feature-Flagged)

Last Updated: 2026-02-27

## Implementation Status

Status: **Phase 1 and Phase 2 implemented in code and validated.**

Completed outcomes:
- Feature flags implemented and wired
- Report telemetry logging added
- Phase 1 endpoints and UI surfaces delivered
- Phase 2 forecasting/scheduling/saved views/governance delivered
- Backend worker wiring for schedules delivered
- Retention cleanup for report artifacts delivered
- Live verification completed with flags ON
- Automated phase 2 test script added and passing

Verification snapshot:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS
- `npm run test:reports-phase2`: PASS (26 passed, 0 failed)

---

## Delivered Endpoint Inventory

1. `GET /api/reports/profit-summary`
2. `GET /api/reports/profit-by-product`
3. `GET /api/reports/profit-by-outlet`
4. `GET /api/reports/discount-leakage`
5. `GET /api/reports/dead-stock`
6. `GET /api/reports/stock-aging`
7. `GET /api/reports/stockout-risk`
8. `GET /api/reports/exceptions`
9. `GET /api/reports/forecast-demand`
10. `GET /api/reports/replenishment-smart`
11. `GET/POST/PUT/DELETE /api/reports/schedules`
12. `POST /api/reports/schedules/:id/run-now`
13. `GET /api/reports/schedules/:id/runs`
14. `GET /api/reports/delivery-log`
15. `GET/POST/PUT/DELETE /api/reports/saved-views`
16. `GET/POST /api/reports/governance/definitions`

---

## Delivered Data Model Additions

- `report_schedules`
- `report_schedule_runs`
- `report_delivery_log`
- `saved_report_views`
- `report_definition_versions`

Migration: `backend/migrate55.js`

---

## Operational Controls

Flags:
- `reports_enhanced_filters`
- `reports_profit_layer`
- `reports_inventory_health_plus`
- `reports_exceptions`
- `reports_scheduled_exports`

Worker controls:
- `REPORT_SCHEDULE_WORKER_DISABLED=1` disables schedule processor

Retention controls:
- `REPORT_RUNS_RETENTION_DAYS` (default 45)
- `REPORT_DELIVERY_RETENTION_DAYS` (default 60)
- `REPORT_EXPORT_FILES_RETENTION_DAYS` (default 30)

---

## Remaining Follow-ups (Non-blocking)

1. Add performance dataset benchmark record to docs (P95 tracking evidence)
2. Add browser-level UAT evidence captures for report drilldowns/exports
3. Add optional scheduled delivery channels beyond file generation (email/PDF pipeline hardening)
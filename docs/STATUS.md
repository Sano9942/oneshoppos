# OneShopPOS - Project Status

Last Updated: 2026-02-27  
Current Phase: Reports Power-Up Phase 1 + Phase 2 implemented (feature-flagged)  
System State: Operational

---

## Current Snapshot

- Backend API: `http://localhost:5000`
- Frontend app: `http://localhost:5173`
- Latest migration in runner: `migrate55.js`
- Reports feature flags available:
  - `reports_enhanced_filters`
  - `reports_profit_layer`
  - `reports_inventory_health_plus`
  - `reports_exceptions`
  - `reports_scheduled_exports`

---

## Reports Power-Up Delivery

- Phase 1 completed:
  - profit endpoints and widgets
  - inventory health endpoints
  - exceptions endpoint/panel
  - shared report filters + export metadata
- Phase 2 completed:
  - forecasting and smart replenishment endpoints
  - scheduled report packs (DB tables + worker + run logs)
  - saved views
  - governance/report definition versions

---

## New Reports APIs (Additive)

- `/api/reports/profit-summary`
- `/api/reports/profit-by-product`
- `/api/reports/profit-by-outlet`
- `/api/reports/discount-leakage`
- `/api/reports/dead-stock`
- `/api/reports/stock-aging`
- `/api/reports/stockout-risk`
- `/api/reports/exceptions`
- `/api/reports/forecast-demand`
- `/api/reports/replenishment-smart`
- `/api/reports/schedules*`
- `/api/reports/delivery-log`
- `/api/reports/saved-views*`
- `/api/reports/governance/definitions*`

---

## Latest Verification

- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS
- `npm run build` (frontend): PASS
- Live endpoint checks with reports flags ON: PASS

---

## Operational Hardening

- Report schedule worker runs every 60s (disable with `REPORT_SCHEDULE_WORKER_DISABLED=1`)
- Retention cleanup runs daily:
  - schedule runs (`REPORT_RUNS_RETENTION_DAYS`, default 45)
  - delivery logs (`REPORT_DELIVERY_RETENTION_DAYS`, default 60)
  - exported report files (`REPORT_EXPORT_FILES_RETENTION_DAYS`, default 30)

---

## Resume Checklist

1. Start services (`START.bat` or backend/frontend separately)
2. Run `node backend/run_migrations.js`
3. Run `npm run preflight` in `backend/`
4. Run `npm run test:e2e-full` in `backend/`
5. Run `npm run test:reports-phase2` in `backend/`
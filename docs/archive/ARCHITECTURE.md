# OneShopPOS Architecture and Code Map

Last Audited: 2026-02-27

This document summarizes the current runtime architecture after Reports Power-Up Phase 1 and Phase 2 delivery.

---

## 1. System Overview

OneShopPOS is a local-first retail platform with:
- Frontend: React + Vite + Tailwind
- Backend: Express + sqlite3
- Database: SQLite file (`backend/oneshop.db`)

Architecture style:
- Backend runtime bootstrap in `backend/index.js`
- Domain routes primarily registered from `backend/routes/registerAllRoutes.js`
- Tier 4 routes also split in `backend/routes/tier4.js`
- Frontend route/page architecture centered in `frontend/src/App.jsx`
- Schema evolves via incremental migrations (now through `migrate55.js`)

---

## 2. Main Runtime Flow

1. Run migrations (`backend/run_migrations.js`)
2. Start backend (`npm start` in `backend/`)
3. Start frontend (`npm run dev` in `frontend/`)
4. Frontend authenticates via `/api/auth/login` and sends `x-employee-id`
5. Backend enforces permission checks and feature flags per route

---

## 3. Backend Architecture

### Core
- `backend/index.js`: app bootstrap, middleware, flags, workers
- `backend/db.js`: sqlite connection and base schema bootstrapping
- `backend/routes/registerAllRoutes.js`: primary API route registrations
- `backend/routes/tier4.js`: Tier 4 module routes
- `backend/run_migrations.js`: ordered migration runner

### Reports Power-Up additions
- Phase 1 endpoints:
  - profit layer (`profit-summary`, `profit-by-product`, `profit-by-outlet`, `discount-leakage`)
  - inventory health (`dead-stock`, `stock-aging`, `stockout-risk`)
  - exceptions (`/api/reports/exceptions`)
- Phase 2 endpoints:
  - forecasting (`forecast-demand`, `replenishment-smart`)
  - schedules (`/api/reports/schedules*`, run-now, runs)
  - delivery logs (`/api/reports/delivery-log`)
  - saved views (`/api/reports/saved-views*`)
  - governance definitions (`/api/reports/governance/definitions*`)

### Workers and operational jobs
- Shopify queue worker (30s interval, optional disable flag)
- Report schedule worker (60s interval, optional disable flag)
- Daily backup job
- Daily cleanup jobs:
  - old Shopify sync events
  - report schedule run retention
  - report delivery log retention
  - old generated report file cleanup (`backend/exports/reports`)

---

## 4. Feature Flags

Core and redesign flags remain available; reports flags now include:
- `reports_enhanced_filters`
- `reports_profit_layer`
- `reports_inventory_health_plus`
- `reports_exceptions`
- `reports_scheduled_exports`

---

## 5. Frontend Architecture

### Core
- `frontend/src/App.jsx`: route declarations
- `frontend/src/components/AppLayout.jsx`: navigation, feature-flag visibility, branding
- `frontend/src/auth/AuthProvider.jsx`: session and auth headers

### Reports Power-Up frontend additions
- `frontend/src/hooks/useReportFilters.js`
- `frontend/src/pages/redesign/ReportsPowerUpPanel.jsx`
- `frontend/src/pages/redesign/ReportsRedesign.jsx` integrates panel with existing report surfaces

---

## 6. Data and Migrations

Latest migration: `backend/migrate55.js`

Adds reports phase 2 data model entities:
- `report_schedules`
- `report_schedule_runs`
- `report_delivery_log`
- `saved_report_views`
- `report_definition_versions`

---

## 7. Testing and Verification Baseline

Current baseline:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS
- `npm run test:reports-phase2`: PASS (26 passed, 0 failed)
- `npm run build` (frontend): PASS

---

## 8. Current Technical Debt

- Backend route file remains large and can be further split by domain
- Tier 2 placeholder pages remain pending (`/lookup`, `/custom-fields`, `/partners`, `/shopcast`)
- Tier 3.1 email/SMS receipts remains pending
- No browser automation suite yet (Playwright/Cypress)
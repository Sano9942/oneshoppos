# OneShopPOS Architecture and Code Map

Last Audited: 2026-02-25

This document summarizes the current runtime architecture after Tier 4 implementation.

---

## 1. System Overview

OneShopPOS is a local-first retail platform with:
- Frontend: React + Vite + Tailwind
- Backend: Express + sqlite3
- Database: SQLite file (`backend/oneshop.db`)

Architecture style:
- Backend is still monolithic (`backend/index.js`)
- Frontend is route/page oriented (`frontend/src/App.jsx`)
- Schema evolves by incremental migrations (`migrate.js` through `migrate46.js`)

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
- `backend/index.js`: API surface (all modules)
- `backend/db.js`: sqlite connection and base schema bootstrapping
- `backend/run_migrations.js`: ordered migration runner (now includes `migrate46.js`)

### Tier 4 additions
- Notifications engine
- Company profile APIs and logo upload
- Accounting APIs (P and L, cashflow, AP, periods)
- Advanced HR APIs (leave + payroll)
- CRM and quotations APIs

### Feature flags
Current defaults include:
- `backup_restore`
- `e_invoicing_export`
- `supplier_payables`
- `approvals`
- `notifications`
- `accounting_core`
- `crm_quotations`
- `advanced_hr`
- `multi_company`

---

## 4. Frontend Architecture

### Core
- `frontend/src/App.jsx`: route declarations
- `frontend/src/components/AppLayout.jsx`: navigation, feature-flag visibility, branding
- `frontend/src/auth/AuthProvider.jsx`: session and auth headers

### Tier 4 additions
- `frontend/src/components/NotificationBell.jsx`
- `frontend/src/pages/Accounting.jsx`
- `frontend/src/pages/CRM.jsx`
- `frontend/src/pages/Quotations.jsx`
- `frontend/src/pages/HRManagement.jsx`
- `frontend/src/pages/CompanySettings.jsx`

Tier 4 route paths:
- `/accounting`
- `/crm`
- `/quotations`
- `/hr/leave`
- `/hr/payroll`
- `/company-settings`

---

## 5. Data and Migrations

Latest migration: `backend/migrate46.js`

Adds Tier 4 schema entities including:
- `notifications`
- `accounting_periods`
- `crm_leads`, `crm_activities`
- `quotations`, `quotation_items`
- `leave_requests`
- `payroll_periods`, `payroll_lines`
- `company_profile`
- Additional employee/outlet columns for HR and multi-company context

---

## 6. Testing and Verification

Latest baseline:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: 69 passed, 0 failed
- `npm run test:tier4-smoke`: 53 passed, 0 failed

---

## 7. Current Technical Debt

- Backend monolith remains large (`backend/index.js`)
- Tier 2 placeholder routes are still stubs
- Tier 3.1 email/SMS receipts pending
- No browser automation suite yet

# OneShopPOS - Full Project Overview

Generated: 2026-02-26  
Last Updated: 2026-02-26

---

## 1. What This Project Is

OneShopPOS is a local-first, SQLite-backed retail POS and operations platform.
It supports multi-outlet inventory, procurement, customer workflows, role-based access, reporting, and Shopify integration.

Tier 4 is now delivered, adding accounting, CRM plus quotations, advanced HR, notification engine, and company profile modules.

---

## 2. Stack

- Backend: Node.js, Express 5, sqlite3
- Frontend: React 19, Vite 7, Tailwind 4, React Router 7
- Database: `backend/oneshop.db`
- Icons/charts: lucide-react, Recharts

---

## 3. Runtime

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`
- Migration runner: `backend/run_migrations.js`
- Latest migration: `backend/migrate46.js`

Standard commands:
```bash
cd backend
node run_migrations.js
npm run preflight
npm run test:e2e-full
npm run test:tier4-smoke
```

---

## 4. Current Size and Surface

- Backend endpoints under `/api/*`: 229
- Frontend declared routes: 63

Largest backend API groups:
- `integrations`: 25
- `reports`: 20
- `products`: 12
- `customers`: 8
- `orders`: 8
- `hr`: 7
- `crm`: 7
- `quotations`: 7
- `purchase-orders`: 7
- `accounting`: 6

---

## 5. Tier 4 Modules Delivered

### 4.1 Accounting Core
- Backend: P and L, cashflow, AP, accounting periods
- Frontend: `/accounting`

### 4.2 CRM and Quotations
- Backend: lead pipeline, activities, lead conversion, quotation CRUD, quotation-to-sale conversion
- Frontend: `/crm`, `/quotations`

### 4.3 Advanced HR
- Backend: leave requests and payroll period generation
- Frontend: `/hr/leave`, `/hr/payroll`

### 4.4 Notification Engine
- Backend: notifications list/count/read APIs and notification triggers from business flows
- Frontend: notification bell with unread badge/dropdown

### 4.5 Company Profile
- Backend: profile get/update and logo upload
- Frontend: `/company-settings`, dynamic branding in layout

---

## 6. Important Files

Backend:
- `backend/index.js` (main API)
- `backend/migrate46.js` (Tier 4 schema)
- `backend/run_migrations.js`
- `backend/tier4_smoke_test.js`

Frontend:
- `frontend/src/App.jsx` (routes)
- `frontend/src/components/AppLayout.jsx` (navigation, feature-flag-aware UI)
- `frontend/src/components/NotificationBell.jsx`
- `frontend/src/pages/Accounting.jsx`
- `frontend/src/pages/CRM.jsx`
- `frontend/src/pages/Quotations.jsx`
- `frontend/src/pages/HRManagement.jsx`
- `frontend/src/pages/CompanySettings.jsx`

---

## 7. Feature Flags (Current)

Core flags:
- `backup_restore`
- `e_invoicing_export`
- `supplier_payables`
- `approvals`

Tier 4 flags:
- `notifications`
- `accounting_core`
- `crm_quotations`
- `advanced_hr`
- `multi_company`

---

## 8. Validation Baseline

Latest known results:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: 69 passed, 0 failed
- `npm run test:tier4-smoke`: 53 passed, 0 failed

---

## 9. What Is Still Pending

- Tier 2 placeholder pages:
  - `/lookup`
  - `/custom-fields`
  - `/partners`
  - `/shopcast`
- Tier 3.1 email/SMS receipts
- Tier 5 technical debt (monolith split, rate limiting, offline mode, realtime updates, cleanup)

---

## 10. Shopify Progress Snapshot

Completed:
- Connection, live location fetch, location mapping, and product mapping are functional.
- Reconciliation run and approval workflow are functional.
- Outbound sync queue/events are functional and processed events are confirmed.

Remaining:
- Configure webhook secret and matching Shopify webhook secret.
- Configure public HTTPS callback URL for webhook delivery.
- Execute inbound webhook test and confirm inbound processed events.
- Capture final UAT evidence and go-live checklist signoff.

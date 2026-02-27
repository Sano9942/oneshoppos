# OneShopPOS - Full Project Overview

Generated: 2026-02-26  
Last Updated: 2026-02-27

---

## 1. What This Project Is

OneShopPOS is a local-first, SQLite-backed retail POS and operations platform.
It supports multi-outlet inventory, procurement, customer workflows, role-based access, reporting, and Shopify integration.

Major completed delivery tracks include:
- Tier 4 modules (accounting, CRM/quotations, HR, notifications, company profile)
- Reports Power-Up Phase 1 + Phase 2 (profit/inventory control, forecasting, scheduling, governance)

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
- Latest migration: `backend/migrate55.js`

Standard commands:
```bash
cd backend
node run_migrations.js
npm run preflight
npm run test:e2e-full
npm run test:reports-phase2
```

---

## 4. Reporting System (Current)

### Phase 1 delivered
- Profit summary/by-product/by-outlet
- Discount leakage
- Dead stock, stock aging, stockout risk
- Exception reporting (`negative margin`, `high discount`, `frequent voids`, `frequent returns`)
- Shared report filters and export metadata

### Phase 2 delivered
- Forecast demand
- Smart replenishment suggestions
- Report schedules (create/edit/run-now/list runs)
- Delivery logs
- Saved report views
- Governance/report definition versions

All delivered as additive `/api/reports/*` endpoints behind feature flags.

---

## 5. Feature Flags (Current)

Core and module flags remain available; report-specific flags:
- `reports_enhanced_filters`
- `reports_profit_layer`
- `reports_inventory_health_plus`
- `reports_exceptions`
- `reports_scheduled_exports`

---

## 6. Validation Baseline

Latest known results:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS
- `npm run test:reports-phase2`: PASS (26/0)
- `npm run build` (frontend): PASS

---

## 7. What Is Still Pending

- Tier 2 placeholder pages:
  - `/lookup`
  - `/custom-fields`
  - `/partners`
  - `/shopcast`
- Tier 3.1 email/SMS receipts
- Browser automation test suite

---

## 8. Shopify Progress Snapshot

Completed:
- Connection, location mapping, product mapping, reconciliation flow, outbound queue processing

Remaining for final live signoff:
- Public webhook callback and secret finalization in production
- Inbound webhook validation evidence
- Final go-live UAT signoff artifacts
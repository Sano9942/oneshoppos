# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
*Last updated: March 9 2026 — post full audit + 6-session parallel fix run*

---

## ✅ Already Built & Shipped

- POS sell screen with shift/attendance gating
- Park Sale + Previously Parked Sales
- Sales History with Returns & Exchanges (bill-linked + no-bill)
- Cash Management (denomination-based open/close, variance capture)
- Purchase Orders → GRN flow (partial receive, auto-invoice)
- Stock Adjustments, Transfers, Returned Stock (RMA)
- Supplier Payables (aging, ledger, payment recording) — pagination fixed
- Attendance + Kiosk PIN clock-in/out with breaks
- Barcode scanner (global keydown, 100ms debounce) — now uses `/scan/:barcode`
- ESC/POS thermal printer + email receipts (nodemailer SMTP)
- Receipt Templates (header/footer/barcode, active template)
- Shopify integration (import, sync, webhooks, reconciliation, event log)
- Hierarchical categories (tree CRUD, leaf-only assignment)
- Variant products (attribute sets, cartesian generation)
- Promotions / discount rules (percent, fixed, threshold, BXGY) + quote tester
- Reports V2 — 67 tabs + 5 new endpoints added: dead-stock, pricing-margin, forecast-demand, replenishment-smart, purchase-orders-report
- Operations Dashboard (auto-refresh, KPIs, outlet ranking, exceptions) + top products, yesterday deltas, inventory value card now wired up
- SaaS Phase 1–5 (multi-tenant ready, JWT auth, super-admin dashboard)
- Customer wallet (balance + ledger + debit on sale)
- Loyalty points (earn/redeem on sales, stored per customer)
- Quotations (full CRUD + convert-to-sale)
- Orders (web orders, bulk status update, fulfillments)
- CRM (leads, stages, activity timeline)
- HR (leave requests, leave balance, payroll periods + line items)
- Accounting (P&L, Cashflow daily, AP/AR summary)
- Action History (audit log) — date range + action type filters added
- Sales History — employee + payment method filters added
- Cash Management — denomination subtotals (count × value) added
- Product image upload route (multer, backend/uploads/products/)
- Customers — broken bulk delete UI removed

---

## 🔴 High Priority — Build Next

### 1. Loyalty & Wallet Frontend
**Status:** Backend fully built, no frontend UI
**What's needed:**
- Show customer's points balance + wallet balance when selected at POS checkout
- UI to redeem points at checkout (apply as discount)
- Dedicated page: Customers → Loyalty & Wallet history
- Configure earn rate (e.g. 1 point per PKR 100 spent)

### 2. Fix 2 Pre-existing Security Test Failures
**Status:** Were failing before this session — not caused by us, but should be fixed
**Tests:** `security.test.js` — SEC6 (header injection) + SEC8 (`/api/feature-flags` returns 200 without auth instead of 401)
**What's needed:**
- SEC8: Add auth guard to `GET /api/feature-flags` endpoint
- SEC6: Validate/sanitize `x-employee-id` header to prevent injection escalation

### 3. Reorder Alerts Page
**Status:** Data exists (replenishment-smart endpoint now built), no dedicated nav page
**What's needed:**
- Sidebar entry under Stock Control
- Lists products where days_of_stock_remaining < 14, sorted by urgency
- Quick "Create PO" button from each row

---

## 🟡 Medium Priority

### 4. Accounting — Wire Cashflow + AP/AR to Frontend
**Status:** Backend endpoints now built (`/api/accounting/cashflow/daily`, `/api/accounting/ap-ar`), but frontend Accounting.jsx Cashflow + AP/AR tabs still use stub/client-side data
**What's needed:**
- Update `Accounting.jsx` Cashflow tab to fetch from `GET /api/accounting/cashflow/daily`
- Update AP/AR tab to fetch from `GET /api/accounting/ap-ar`

### 5. HR — Wire Leave Balance + Payroll Lines to Frontend
**Status:** Backend endpoints now built (`/api/hr/leave/balance`, `/api/hr/payroll/periods/:id/lines`), frontend stubs not connected
**What's needed:**
- Update `HRManagementRedesign.jsx` Leave Balance tab to call `/api/hr/leave/balance`
- Update Payroll tab to show line items per period + allow adding/editing them

### 6. FBR Integration (Pakistan E-Invoicing)
**Status:** Feature flag exists (`e_invoicing_export: true`), not connected to FBR
**What's needed:**
- Send sale data to FBR API on each completed sale
- FBR invoice number stored on sale record
- "FBR Resync" button on Sales History for failed submissions

### 7. Advance / Layaway Payments
**Status:** Not built
**What's needed:**
- Accept partial payment on a sale (advance amount)
- Track outstanding balance per customer
- Allow customer to return and pay remaining balance

### 8. Purchase Orders — Edit + Approval Flow
**Status:** No `PUT /api/purchase-orders/:id`, no Draft→Approved status transition
**What's needed:**
- `PUT /api/purchase-orders/:id` for editing draft POs
- Approve button on PO detail (manager/admin only)
- Status badge: Draft → Approved → Received

### 9. Orders Detail — Transactions + Fulfillments UI
**Status:** Backend returns transactions + fulfillments on `GET /api/orders/:id`, detail modal shows nothing
**What's needed:**
- Add Transactions tab inside order detail modal (payments received, amounts)
- Add Fulfillments tab (tracking info, shipped items)

### 10. Quotations — Send via Email
**Status:** Backend sets status to "sent" but no actual delivery
**What's needed:**
- Reuse existing email infrastructure (nodemailer, email_config table)
- "Send" button calls backend, which emails quotation HTML to customer email
- Backend: `POST /api/quotations/:id/send`

---

## 🟢 Low Priority / Nice to Have

### 11. Parked Sales Management Page
Standalone admin page to view/delete/expire parked sales across outlets. Currently only accessible from POS.

### 12. Stock Adjustments — Edit/Delete
No edit or delete after creation. Append-only by design but could allow admin correction.

### 13. Transfers — Reverse Transfer
No way to undo a transfer. Add a "Reverse" action that moves stock back.

### 14. Supplier Payables — Payment Reversal
No way to void a payment once recorded. Add void action with reason.

### 15. Supplier Delete Protection
Can currently delete a supplier with outstanding invoices — orphans payable records. Add guard.

### 16. Category Delete Protection
Can delete categories with products assigned — orphans products. Add warning/block.

### 17. CRM — Typed Activity Categories
Activity log is free text. Add types: Call, Email, Meeting, Demo, Follow-up.

### 18. Backup & Restore — Progress Indicator
Long restores appear hung. Add a progress/spinner state while restore runs.

### 19. Notifications Centre
Feature flag exists (`notifications: true`). No page, no sidebar entry, no data.

### 20. Serial Number Tracking
Assign serial numbers to products at point of sale. Useful for electronics/high-value items.

### 21. Gift Cards / Vouchers
Generate codes with fixed value, redeem at POS checkout.

### 22. Purchase Order Templates
Save a PO as a template for repeat orders from same supplier.

### 23. Products — Stock by Outlet Popup
`GET /api/products/:id/stock` returns per-outlet stock but inventory list has no UI to show it.

### 24. Action History — Expand Logging Coverage
Sales, returns, stock adjustments don't write to `action_history`. Add inserts at key transaction points.

### 25. Reports — Governance UI
`POST /api/reports/schedules` and `GET /api/reports/saved-views` endpoints exist but no UI to manage them.

---

## 🔵 Competitor Gap Analysis (vs XStak ShopDesk)

| Feature | Priority | Status |
|---------|----------|--------|
| FBR e-invoicing | 🔴 High | Not built |
| Advance/layaway payments | 🟡 Medium | Not built |
| Serial number per sale | 🟢 Low | Not built |
| Shopcast digital signage | 🟢 Low | Not built |

**We have that XStak doesn't:**
- Supplier Payables with aging + ledger
- Multi-level Approvals workflow
- Attendance + Kiosk terminal
- Shift denomination capture
- 67+ report tabs (vs their 22)
- SaaS / multi-tenant architecture
- ESC/POS thermal printer integration
- Email receipts via SMTP

---

## 📋 Multi-Tenant Go-Live Checklist (before flipping MULTI_TENANT=1)

1. **Timezone Phase 2** — ~30 `'localtime'` SQL modifiers in GROUP BY must use tenant timezone; `loadCompanyProfile` cache must be keyed per-tenant
2. **Tenant isolation testing** — verify no cross-tenant data leakage
3. **Tenant onboarding flow** — production provisioning from super-admin dashboard (not just CLI)
4. **Tenant-aware scheduled jobs** — stale session cleanup + report scheduler must iterate all tenant DBs
5. **Subdomain/slug routing** — frontend tenant resolution from URL
6. **Railway multi-DB volume strategy** — N tenant SQLite files or Postgres migration
7. **Backup/restore per-tenant** — current backup operates on single DB
8. **Rate limiting** — per-tenant request limits
9. **Timezone Phase 3** (nice-to-have) — write-path unification (~49 `datetime('now','localtime')` → UTC)

---

## 📋 Discussed but Deferred

- **Payment gateway integration** (card machines, JazzCash, EasyPaisa)
- **Profit-sharing / payroll module** — seed data mentions it but no UI
- **Shopcast / digital signage**

---

## 🔍 Audit History

| Date | What | Result |
|------|------|--------|
| Mar 9 2026 | Full 38-area backend↔frontend audit | 25+ gaps found, documented |
| Mar 9 2026 | 6 parallel fix sessions | 11 gaps fixed, 18 files changed, 1,410 lines, zero regressions |
| Mar 9 2026 | Merged + pushed to main | Live on Vercel + Railway |

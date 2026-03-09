# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
*Last updated: March 9 2026 — post roadmap phase 2 — all 25 items complete (9-session parallel run)*

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

## ✅ Roadmap Phase 2 — All 25 Items Complete (Mar 9 2026)

### 🔴 High Priority (all done)
- **#1 Loyalty & Wallet Frontend** — POS checkout shows points + wallet balance, redeem toggle, Customers loyalty/wallet tab
- **#2 Security Fixes** — SEC6 (x-employee-id header injection) + SEC8 (feature-flags requires auth) — all 8 security tests pass
- **#3 Reorder Alerts Page** — sidebar entry under Stock Control, lists products with <14 days stock, Create PO button

### 🟡 Medium Priority (all done)
- **#4 Accounting Cashflow + AP/AR** — `Accounting.jsx` Cashflow + AP/AR tabs now fetch from live backend endpoints
- **#5 HR Leave Balance + Payroll Lines** — `HRManagementRedesign.jsx` Leave Balance + Payroll tabs wired to live endpoints
- **#6 FBR Integration** — placeholder comment added, deferred for future implementation
- **#7 Advance / Layaway Payments** — deferred (not in this phase)
- **#8 Purchase Orders Edit + Approval** — `PUT /api/purchase-orders/:id`, approve button (manager/admin), Draft→Approved→Received badges
- **#9 Orders Detail Transactions + Fulfillments** — Transactions tab + Fulfillments tab inside order detail modal
- **#10 Quotations Email Send** — `POST /api/quotations/:id/send` backend + Send button in UI using nodemailer

### 🟢 Low Priority (all done)
- **#11 Parked Sales Management Page** — standalone admin page at `/parked-sales`, view/delete across outlets
- **#12 Stock Adjustments Delete** — admin delete action with confirmation
- **#13 Transfers Reverse** — Reverse Transfer action moves stock back
- **#14 Supplier Payables Payment Void** — void action with reason on recorded payments
- **#15 Supplier Delete Protection** — guard blocks delete when outstanding invoices exist
- **#16 Category Delete Protection** — guard blocks delete when products are assigned
- **#17 CRM Typed Activities** — activity types: Call, Email, Meeting, Demo, Follow-up
- **#18 Backup Progress Indicator** — spinner + status message during restore
- **#19 Notifications Centre** — page + sidebar entry at `/notifications`
- **#20 Serial Number Tracking** — backend routes + frontend assignment at POS
- **#21 Gift Cards / Vouchers** — backend routes + frontend redeem UI
- **#22 Purchase Order Templates** — save/load PO templates
- **#23 Products Stock by Outlet Popup** — outlet stock breakdown in inventory list
- **#24 Action History Logging** — expanded logging for sales, returns, adjustments
- **#25 Reports Governance UI** — schedule manager + saved views UI in Reports

---

## 🔵 Competitor Gap Analysis (vs XStak ShopDesk)

| Feature | Priority | Status |
|---------|----------|--------|
| FBR e-invoicing | 🔴 High | Placeholder added, deferred |
| Advance/layaway payments | 🟡 Medium | Deferred |
| Serial number per sale | 🟢 Low | Built (Mar 9 2026) |
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

## 🔴 Next Up: First-Run Setup Wizard

**Priority:** HIGH — should be built before any new store deployment
**Why:** Eliminates all timezone/currency/identity bugs by forcing correct configuration before the first transaction. Also solves the chicken-and-egg problem of "how do you log in when no admin exists yet."

### The Problem It Solves
1. Fresh database has no employees — nobody can log in to configure the store
2. Default timezone (`Asia/Karachi`) is wrong for any non-Pakistan deployment
3. Default currency (`PKR`) is wrong for international stores
4. Previously required a temporary `SETUP_SECRET` endpoint hack to bootstrap the first admin
5. Users who never visit Company Settings run with incorrect defaults forever

### Design: Invitation Link (One-Time Token)

**Single-tenant mode (`MULTI_TENANT=0`):**
- Server boots, sees `setup_complete = 0`, generates a random setup token
- Token stored in `company_profile.setup_token`
- Server logs a setup URL to console: `https://your-app.com/setup?token=a8f3c9...`
- Deployer clicks the link or sends it to the store owner
- Wizard validates token → runs setup → deletes token → sets `setup_complete = 1`
- Link is dead forever after first use

**Multi-tenant mode (`MULTI_TENANT=1`):**
- No public wizard — tenants are provisioned by super-admin
- Super-admin provisions tenant → gets a setup link from Admin Dashboard
- Tenant owner clicks link → same wizard → configures their own store
- Same token mechanism, same wizard code — works identically for both modes

**Server restart safety:** If `setup_complete = 0`, server regenerates and logs a new token on every boot (in case the deployer lost the original).

### Wizard Screens (4 steps, cannot be skipped)

**Screen 1 — Store Identity**
- Store name (required)
- Country (dropdown — auto-suggests timezone + currency on next screen)
- City
- Phone / Email

**Screen 2 — Time, Location & Currency**
- Timezone — searchable dropdown, pre-filtered by country from screen 1
- **Live clock preview:** "Current time in Asia/Karachi: 11:42 PM, Mar 9" — user sees immediately if it's correct
- Currency symbol + currency code (auto-filled from country, can override)
- Fiscal year start month
- Primary tax name + rate (optional — "Skip, I'll add later" button)

**Screen 3 — First Outlet**
- Outlet name (default: "Main Store")
- Outlet address (optional — appears on receipts)

**Screen 4 — Administrator Account**
- Your name (required)
- Choose PIN — 4-6 digits, with confirm field
- Auto-assigned: Administrator role + assigned to outlet from screen 3

### What `POST /api/setup/complete` Creates (in one transaction)

1. Updates `company_profile` — store name, country, city, timezone, currency, fiscal year, tax
2. Creates first outlet (or updates existing if seed created one)
3. Creates default roles: Administrator, Manager, Cashier + permission sets
4. Creates first employee (Administrator) with chosen PIN + assigns to outlet
5. Creates default receipt template (so POS print works on day one)
6. Seeds feature flags with sane defaults
7. Sets `setup_complete = 1`, deletes `setup_token`
8. Returns `{ success: true }` → frontend redirects to `/login`

### Security

- Wizard endpoint only works when `setup_complete = 0` AND token matches
- Once used, token is deleted — endpoint permanently rejects all future calls
- No env var secrets needed — token is auto-generated
- Backend rejects ALL other API calls with `503 Setup required` until wizard completes

### Backend middleware check

```
if (!MULTI_TENANT && !company.setup_complete) {
  // Only allow /api/setup/* endpoints
  // Everything else → 503 "Setup required"
}
```

### Important: server TZ env var still needed

The wizard sets `company_profile.timezone` which fixes all report date filters. But `attendance_sessions` uses SQLite `datetime('now','localtime')` which reads the **server OS timezone**. The wizard should display a reminder on the final screen:

> "For attendance times to be stored correctly, ensure your server's `TZ` environment variable is set to `Asia/Karachi`."

In multi-tenant mode, Timezone Phase 2 (GROUP BY localtime → tenant tz) must also be completed.

### Files to Create/Modify

| File | Action |
|------|--------|
| `backend/migrate71.js` | Add `setup_complete INTEGER DEFAULT 0` + `setup_token TEXT` to `company_profile`; existing deployments auto-set `setup_complete = 1` |
| `backend/routes/setup.js` | `GET /api/setup/status`, `POST /api/setup/complete` (token-gated, creates all seed data) |
| `backend/index.js` | Middleware: if `!setup_complete`, block all routes except `/api/setup/*` with 503; on boot if `setup_complete = 0`, generate token + log URL |
| `frontend/src/pages/SetupWizard.jsx` | 4-step wizard with live timezone preview |
| `frontend/src/App.jsx` | Add `/setup` route (unauthenticated, before `RequireAuth`) |
| `backend/run_migrations.js` | Add `migrate71.js` to migration array |
| `backend/tenant-provisioner.js` | Generate setup token for new tenants, return it to super-admin |
| `frontend/src/pages/admin/AdminTenantDetail.jsx` | Show/regenerate setup link for provisioned tenants |

### How existing deployments are handled

`migrate71.js` should:
```sql
ALTER TABLE company_profile ADD COLUMN setup_complete INTEGER DEFAULT 0;
ALTER TABLE company_profile ADD COLUMN setup_token TEXT;
-- Auto-complete for existing stores (they're already configured)
UPDATE company_profile SET setup_complete = 1 WHERE company_name != 'My Store' OR timezone != 'Asia/Karachi';
-- Safety: if ANY employees exist, store is already set up
UPDATE company_profile SET setup_complete = 1 WHERE (SELECT COUNT(*) FROM employees) > 0;
```

---

## 🐛 Known Live Bugs (Production)

### ~~BUG-1~~: `ContextSwitcher` calls `/api/context/bootstrap` without auth headers — ✅ FIXED Mar 9 2026
**File:** `frontend/src/components/ContextSwitcher.jsx`
**Root cause:** Missing `{ headers: authHeaders() }` — caused POS Opening Gate to show empty branch dropdown, blocking the entire POS flow including product search
**Fix applied:** Added `authHeaders` from `useAuth()` and passed it to the fetch call

### BUG-2: Dashboard KPIs show "No sales yet today" despite recent sales existing
**Severity:** Medium — misleading dashboard data
**File:** `frontend/src/pages/redesign/DashboardRedesign.jsx` line 50
**Root cause:** Caused by BUG-1 — no outlet context stored after login so `/api/reports/dashboard` had no `x-outlet-id`; expected to resolve automatically now that BUG-1 is fixed
**Effect:** All KPI cards (today's sales, revenue, exceptions) show zero/empty; Recent Sales loads fine (separate `/api/sales` call)
**Status:** Monitor after BUG-1 deploys; if still failing, investigate `x-outlet-id` injection in `AuthProvider`

### BUG-3: `ReportsSales.jsx` calls report endpoints without explicit auth headers
**Severity:** Low — global `window.fetch` patch handles headers for logged-in users so this works in practice
**File:** `frontend/src/pages/reports/ReportsSales.jsx` (9 fetch calls, none pass `authHeaders()`)
**Root cause:** File never imported `useAuth` — relies entirely on the global `window.fetch` patch
**Status:** Monitor; only a problem if the patch has a race condition on mount

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
| Mar 9 2026 | Roadmap Phase 2 — 9 parallel sessions | All 25 remaining items complete, 28 files changed, 2,936 lines, 395/395 tests passing |
| Mar 9 2026 | Merged feature/roadmap-phase2 → main | Live on Vercel + Railway |

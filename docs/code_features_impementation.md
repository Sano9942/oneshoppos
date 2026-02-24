# OneShopPOS Code Features Implementation Plan

## Purpose
This document captures:
- Current project problems and architectural risks
- Safe solutions to avoid breaking existing logic
- A phased roadmap to add major new features end-to-end

---

## Current Problems Identified

### 1. Docs and code drift
- Docs still reference `backend/database.sqlite`, but runtime DB is `backend/oneshop.db`.
- Route documentation and actual route paths differ in places.

### 2. Migration process drift
- `backend/run_migrations.js` currently runs only up to `migrate20.js`.
- Actual project has migrations up to `migrate28.js`.

### 3. Frontend route conflicts
- Duplicate `/action-history` route declarations exist in `frontend/src/App.jsx`.

### 4. Parked sales not server-backed
- Parked sales are stored only in `localStorage` in POS page.
- This is not multi-device/multi-user safe and can be lost on browser issues.

### 5. RBAC enforcement mostly UI-side
- Permissions are used in frontend nav and flows, but backend does not enforce every sensitive endpoint.
- Direct API calls can bypass UI guards.

### 6. Monolithic backend file risk
- Most API logic is concentrated in `backend/index.js`.
- New features increase regression risk without stricter module boundaries/tests.

### 7. Data integrity/cascade cleanup limitations
- Limited FK cascade behavior across stock/sales relations complicates cleanup.
- Can cause retained test/business artifacts if not handled transactionally.

---

## Solutions to Stabilize Before Big Features

### A. Baseline hardening (must happen first)
1. Align docs to real DB + routes.
2. Update migration runner to include all current migrations.
3. Add compatibility and regression tests for core flows.
4. Add backend permission middleware scaffold (no behavior changes yet).
5. Resolve duplicated frontend route declarations.

### B. Safety rules for all future changes
1. Additive-first schema changes (new columns/tables first, no destructive rewrites).
2. Backward-compatible APIs until frontend migrations are complete.
3. Transaction-wrapped money/stock operations only.
4. Feature flags for high-risk modules.
5. Tag and auto-clean test data in automated test runs.
6. Run full baseline tests before/after each phase.

---

## Phased Feature Implementation Roadmap

## Phase 0 - Hardening Baseline ✅ COMPLETE
Goal: reduce regression risk before major development.

Scope:
1. Fix docs-code drift (`oneshop.db`, route map).
2. Update migration orchestration to include `migrate21..migrate28`.
3. Add regression suites for:
   - sales + void + stock restore
   - returns
   - GRN receive
   - transfer
   - shifts
   - loyalty
4. Remove duplicate `/action-history` route conflict.
5. Add permission middleware scaffolding in backend.

Exit criteria:
- Existing behavior unchanged
- Tests green
- Docs aligned

Completed: 2026-02-24
- Fixed `database.sqlite` → `oneshop.db` in ARCHITECTURE.md and PLAN.md
- `run_migrations.js` updated to include migrate21–migrate30
- Duplicate `/action-history` route removed from App.jsx
- `loadEmployeePerms` + `requirePerm()` middleware added to backend/index.js

---

## Phase 1 - Approval Workflow (PO + STR) ✅ COMPLETE
Goal: controlled operational approvals for purchasing/transfers.

Scope:
1. Add approval data model (`approval_requests`, `approval_actions`).
2. Extend statuses:
   - purchase orders: `draft/pending_approval/approved/rejected/received`
   - transfers: `draft/pending_approval/approved/rejected/executed`
3. Restrict receive/execute actions to approved state.
4. Add approval APIs and Administrator UI for approve/reject actions.
5. Log all actions into action history.

Exit criteria:
- No receive/execute from unapproved state
- Approval trace visible and auditable

Completed: 2026-02-24
- migrate29.js: approval_requests + approval_actions tables, status column on inventory_transfers
- Backend: GET /api/approvals, POST .../submit + .../approve for POs and Transfers
- Frontend: Approvals.jsx page with status filter tabs + approve/reject modal
- PurchaseOrders.jsx: Submit for Approval button (Draft state), status badge updates
- AppLayout.jsx: Approvals nav item added

---

## Phase 2 - Backend RBAC Enforcement ✅ COMPLETE
Goal: enforce permissions server-side.

Scope:
1. Central permission middleware.
2. Endpoint-permission mapping for all sensitive APIs.
3. Optional manager override token flow for restricted actions.
4. Keep frontend guards as UX layer (not source of truth).

Exit criteria:
- Unauthorized API calls return `403`
- UI and API permissions consistent

Completed: 2026-02-24
- requirePerm() applied to: taxes (manage_inventory), employees/roles (manage_employees),
  void sales (void_sales), purchase orders (manage_orders), adjustments/transfers (manage_inventory)
- Unauthorized calls return 403 JSON with error message

---

## Phase 3 - DB-Backed Parked Sales ✅ COMPLETE
Goal: durable parked sales across sessions/devices/outlets.

Scope:
1. Add tables: `parked_sales`, `parked_sale_items` (+ optional payment draft table).
2. APIs: create/list/delete/restore parked sale.
3. Replace POS localStorage parking with API-backed parking.
4. One-time compatibility import from localStorage if needed.

Exit criteria:
- Parked sales persist across restart/device
- Restored cart matches original

Completed: 2026-02-24
- migrate30.js: parked_sales + parked_sale_items (ON DELETE CASCADE) tables
- Backend: GET/POST /api/parked-sales, GET/DELETE /api/parked-sales/:id
- POS.jsx: all localStorage parking replaced with API calls; fetchParkedSales() on mount + outlet change

---

## Phase 4 - Customer Wallet / Store Credit ✅ COMPLETE
Goal: full wallet payment and ledgered balance control.

Scope:
1. Use `customers.balance` as wallet balance source.
2. Add `customer_wallet_ledger` for immutable credit/debit history.
3. Add wallet payment option in POS split tenders.
4. Add rules for negative balance/override permissions.

Exit criteria:
- Every wallet change has ledger entry
- POS can partially/fully pay from wallet safely

Completed: 2026-02-24
- migrate31.js: customer_wallet_ledger table (credit/debit, reference_type/id, note)
- Backend: GET /api/customers/:id/wallet (balance + ledger), POST .../wallet/topup
- Sales route: wallet payments auto-debit balance + create ledger entry atomically
- POS.jsx: Wallet button in checkout (disabled if no customer/zero balance), shows balance, caps amount
- Customers.jsx: wallet balance column in table, top-up form in detail panel

---

## Phase 5 - Supplier Payables + Payments ✅ COMPLETE
Goal: manage supplier liabilities and settlements.

Scope:
1. Add `supplier_invoices`, `supplier_payments`, `supplier_ledger`.
2. Auto-create payable entry on GRN receive.
3. Add supplier payment UI and aging report.
4. Integrate totals into finance reporting.

Exit criteria:
- Outstanding payable is system-computed and traceable

Completed: 2026-02-24
- migrate32.js: supplier_invoices + supplier_payments tables
- GRN receive route: auto-creates INV-GRN-{n} invoice on successful receive
- Backend: GET /api/supplier-invoices, GET ./:id, POST ./:id/pay, GET /api/supplier-aging
- Frontend: SupplierPayables.jsx with Aging Summary (expandable) + Invoices list tabs
- Payment modal: Cash/Bank Transfer/Cheque, reference, paid_by, notes
- AppLayout: "Supplier Payables" nav item under Suppliers (manage_orders permission)

---

## Phase 6 - Promotions Engine ✅ COMPLETE
Goal: central pricing rules for discounts/promotions.

Scope:
1. Add promotion rules tables.
2. Add backend pricing quote engine endpoint.
3. Make POS consume backend quote for final totals.
4. Initial supported rules:
   - fixed/percent discounts
   - threshold discounts
   - buy X get Y

Exit criteria:
- Promotion result deterministic and tested

Completed: 2026-02-24
- migrate33.js: promotions table (type, value, min_order_amount, buy_qty, get_qty, applies_to, date range, active)
- Backend CRUD: GET/POST/PUT/DELETE /api/promotions (manage_inventory permission)
- Backend: POST /api/promotions/quote — evaluates active promos, returns applied_promotions + total_promotion_discount
- POS.jsx: debounced quote call on cart change; promoDiscount baked into total; applied promo names shown inline
- Promotions.jsx: CRUD page with type-aware form fields, date range, applies_to scope (all/product/category)
- AppLayout: Promotions nav item (manage_inventory permission)

---

## Phase 7 - Barcode Label Designer + Batch Print ✅ COMPLETE
Goal: configurable barcode/shelf label generation.

Scope:
1. Add `barcode_templates`, `barcode_print_jobs`.
2. Setup UI for template editing.
3. Inventory bulk select and print queue flow.

Exit criteria:
- User-defined label templates with batch output

Completed: 2026-02-24
- migrate34.js: barcode_templates (size, fields, default flag) + barcode_print_jobs tables; default 50×30mm template seeded
- Backend CRUD: GET/POST/PUT/DELETE /api/barcode-templates (manage_inventory permission)
- Backend: POST /api/barcode-print-jobs — logs batch print events
- BarcodeTemplates.jsx: template CRUD table + Print Labels modal with product search queue + per-item copy count
- Print engine: pure DOM API Code128B SVG barcode renderer (no external libs), opens print window with mm-exact label layout
- App.jsx: /barcode-templates route now points to BarcodeTemplates (was PlaceholderPage)

---

## Phase 8 - Expenses Module ✅ COMPLETE
Goal: include operating expenses in profitability.

Scope:
1. Add `expenses`, `expense_categories` (optional attachments metadata).
2. Link expenses to outlet/shift/employee.
3. Include expense deductions in dashboard/reporting.

Exit criteria:
- Profit reports reflect expense deductions

Completed: 2026-02-24
- migrate35.js: expense_categories + expenses tables; 7 common categories seeded (Rent, Utilities, Salaries…)
- Backend CRUD: GET/POST/PUT/DELETE /api/expense-categories (manage_inventory), /api/expenses
- Backend: GET /api/expenses/summary — groups by category with grand total
- Dashboard API: today's expenses deducted from Net Profit; todayExpenses exposed for sub-label
- Dashboard.jsx: Net Profit KPI sub-label shows "After PKRs X expenses" when expenses exist
- Expenses.jsx: two-tab page (Expense List + Summary by Category), date/category/outlet filters
- Category management modal: add/delete categories inline
- App.jsx: /expenses route added
- AppLayout.jsx: "Expenses" nav item (Banknote icon) added

---

## Phase 9 - Variant Stock by Outlet
Goal: true outlet-level inventory for variants.

Scope:
1. Add `outlet_variant_stock`.
2. Backfill from existing variant stock values.
3. Update POS/transfer/adjustment logic to variant+outlet stock.
4. Keep compatibility path during transition.

Exit criteria:
- Variant stock is outlet-aware in all stock operations

---

## Phase 10 - Shift Reconciliation Enhancements ✅ COMPLETE
Goal: stronger cash accountability.

Scope:
1. Add denomination capture tables.
2. Add close-shift denomination UI.
3. Add variance reason codes + approval thresholds.

Exit criteria:
- Full close-shift accountability trail with reasons

Completed: 2026-02-24
- migrate36.js: shift_denominations table (denomination, count, computed subtotal); added variance_reason + variance_approved_by columns to cash_shifts
- Backend: close-shift route accepts denominations[], variance_reason, variance_approved_by; stores denomination rows post-close
- Backend: GET /api/shifts/:id/denominations — retrieve breakdown for audit; GET /api/variance-reasons — static reason code list
- CashManagement.jsx: close-shift modal replaced with denomination count grid (PKR 5000→1 denominations); auto-totals closing cash from counts
- Variance reason dropdown pre-shown in close modal; optional "Approved By" field appears when reason is selected
- Shift history table: new Reason column; clicking Actual amount opens denomination breakdown panel
- Shift history: +1 column (Reason) with variance_reason displayed

---

## Phase 11 - Backup/Restore + E-Invoicing
Goal: recoverability and compliance readiness.

Scope:
1. One-click backup/restore with validation.
2. Safe restore flow with lock/checks.
3. E-invoice numbering/export format support.

Exit criteria:
- Restore drill passes
- Invoicing export generated consistently

---

## Phase 12 - Performance, Rollout, and Governance
Goal: safe production rollout at scale.

Scope:
1. Feature flags for high-risk modules.
2. Migration preflight and health checks.
3. Add indexes for new query hotspots.
4. Expand E2E coverage for all new financial paths.

Exit criteria:
- Old flows stable with flags off
- New flows stable with flags on

---

## Recommended Implementation Order
1. Phase 0 -> Phase 1 -> Phase 2 (safety + governance first)
2. Phase 3 -> Phase 4 -> Phase 5 (core business value)
3. Phase 6 -> Phase 8 -> Phase 10 (pricing + finance controls)
4. Phase 7 -> Phase 9 -> Phase 11 -> Phase 12 (operational depth + scale)

---

## Change-Control Checklist (Use Before Every Phase)
1. Confirm migration scripts and rollback notes are prepared.
2. Confirm impacted endpoints and UI screens list is documented.
3. Add/adjust automated tests before implementing risky logic.
4. Verify no breaking response shape changes.
5. Run full regression tests + sanity browser checks.
6. Update `docs/IMPLEMENTATION_PLAN.md` and `docs/TESTING.md`.

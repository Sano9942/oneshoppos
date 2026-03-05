# OneShopPOS Testing Strategy and Execution Plan

Updated: 2026-03-05 (Revision 2 — based on full codebase audit)
Project: OneShopPOS (`D:\newprojects\oneshoppos`)
Scope: Backend + Frontend + Role behavior + Workflow integrity

---

## Why We Are Doing This

The project has reached a size where manual testing alone is too slow and risky.
OneShopPOS now has:

- Multiple roles (`Administrator`, `Manager`, `Cashier`)
- Role and permission differences (what each role can/cannot do)
- Backend rules that must always stay correct
- Frontend route guards and user flows that must match backend behavior
- Cross-feature dependencies (attendance, shifts, sales, reports, inventory, approvals, etc.)
- Context Unification (mandatory post-login branch selection, header enforcement)
- POS Return/Exchange workflows with multi-step atomic operations

Goal: avoid 2-3 months of manual re-testing by using a structured test system that catches regressions early and repeatedly.

## Our Goal

Create a reliable release-quality test strategy that:

- Protects critical daily operations from breakage
- Verifies role-based behavior for `Administrator`, `Manager`, and `Cashier`
- Verifies backend logic and frontend user behavior together
- Prioritizes highest business risk first
- Scales as the project grows

Success criteria:

- All existing 212 backend integration tests pass again (currently broken)
- Initial 5 critical smoke tests are stable and repeatable
- Permission boundaries are enforced in both frontend and backend
- Critical end-to-end daily flow (open -> sell -> close) remains green
- Future tests can be added in the same matrix without redesigning the process

---

## Current State Assessment (Audit Results)

### What Exists

| Layer | Files | Tests | Framework | Status |
|-------|-------|-------|-----------|--------|
| Backend Integration | 20 files | 212 tests | Vitest + Supertest | **ALL BROKEN** |
| Frontend Unit | 3 files | ~20 tests | Vitest + Testing Library | Likely passing |
| Frontend E2E | 8 files | 9 tests | Playwright (Chromium) | **Stale selectors** |

### Why Everything Is Broken

**Root cause:** Context Unification shipped (March 2026) but test infrastructure was never updated.

`backend/tests/helpers/createTestApp.js` does not provide `resolveContext` or `requireContextOutlet` to the `deps` object, but `registerAllRoutes.js` (line 47-48) calls `app.use(resolveContext)` and `app.use(requireContextOutlet)`. This crashes every test with:

```
TypeError: app.use() requires a middleware function
```

### Stale Test Inventory

| File | Problem |
|------|---------|
| `createTestApp.js` | Missing `resolveContext`, `requireContextOutlet` in deps — **breaks all 212 tests** |
| `seedData.js` | Missing context feature flags (`context_selection_required`, `context_header_enforced`, `kiosk_context_locked`), no `employee_outlets` records, no company record |
| `returns.test.js` | Tests `manage_orders` permission but route actually requires `manage_customers` |
| `sales.test.js` | Sets up shift/attendance preconditions but never tests the *rejection* when they're missing |
| `auth.test.js` | No tests for `/api/context/bootstrap` endpoint |
| `rbac.test.js` | No tests for context header enforcement (428 responses) |
| `E2E helpers/auth.js` | `loginAsAdmin()` doesn't handle `/context-select` flow — breaks all E2E tests |
| `pos.spec.js` | Denomination input selectors may fail; no tests for recent sales or return/exchange |
| `layout.test.jsx` | Tests `NotificationBell` component that is never imported anywhere in the app |

### Known Bug Confirmations in Tests (Not Fixes)

Several tests document bugs that still exist rather than verifying they're fixed:

- **B2**: Negative stock allowed (sales + adjustments)
- **B11**: Summary vs Detail report discount discrepancy
- **B12**: Prior shift sales leak into next shift's expected_cash
- **B16**: No validation that returned items belong to original sale

### Features With Zero Test Coverage

- Context bootstrap (`GET /api/context/bootstrap`)
- Context header enforcement (428 responses for non-admin without `x-outlet-id`)
- POS Recent Sales panel (`POSRecentSalesPanel.jsx`)
- POS Return/Exchange modal (`POSReturnExchangeModal.jsx`)
- Exchange sale flow (POST sale with Return Credit → POST return atomically)
- RequireContext guard component
- Variant stock handling in returns (only `outlet_stock` is restocked, not `product_variants`)

---

## Phased Execution Plan

### Phase 0: Fix The Foundation (Do This First)

**Goal:** Get 212 existing backend tests passing again. Nothing else matters until this is done.

**Tasks:**

1. **Fix `createTestApp.js`** — Add `resolveContext` and `requireContextOutlet` as no-op middleware stubs to the `deps` object:
   ```js
   resolveContext: (req, res, next) => next(),
   requireContextOutlet: (req, res, next) => next(),
   ```

2. **Update `seedData.js`** — Add missing seed data:
   - Context feature flags: `context_selection_required: false`, `context_header_enforced: false`, `kiosk_context_locked: false`
   - `employee_outlets` records (assign all 3 employees to outlet 1)
   - Company record (id=1, name="Test Company")
   - Update outlets to reference `company_id = 1`

3. **Fix `returns.test.js` permission mismatch** — Either:
   - Change test to expect `manage_customers` permission (matches route), OR
   - If `manage_orders` was the intended permission, fix the route

4. **Run `npm run test:integration`** — Verify all 212 tests pass

5. **Fix `E2E helpers/auth.js`** — Update `loginAsAdmin()` to handle post-login context selection:
   - After login, detect if redirected to `/context-select`
   - Select outlet, wait for dashboard

6. **Run `npm run test:e2e`** — Verify E2E tests pass

**Exit criteria:** `npm run test:integration` = 212 pass, `npm run test:e2e` = 9 pass

---

### Phase 1: Daily Operations Smoke Suite (The Original 5 Tests, Properly Sequenced)

**Goal:** Create a dedicated sequential smoke suite that validates the complete daily business cycle. These tests fill gaps in existing coverage — they don't duplicate it.

**File:** `backend/tests/integration/smoke-gate.test.js`

This suite runs T1 through T5 in order within a single test file, sharing state (one test app, one DB), because the daily cycle is inherently sequential.

#### T1 — Login and Role Session Bootstrap

Tests that ALREADY exist and cover this:
- `auth.test.js`: login, permissions, bad credentials

Tests to ADD in smoke suite:
- Login as each role → verify exact permission set matches `DEFAULT_ROLE_PERMISSIONS`
- Call `GET /api/context/bootstrap` → verify admin sees all outlets, non-admin sees only assigned outlets
- Verify bootstrap response shape: `employee`, `outlets`, `allowed_outlet_ids`, `scope_mode_default`

#### T2 — Kiosk Check-In and Attendance Lifecycle

Tests that ALREADY exist:
- `attendance.test.js`: PIN status, checkin, break, checkout, hours

Tests to ADD in smoke suite:
- **Outlet assignment rejection**: employee not in `employee_outlets` → `pin-checkin` returns 403
- **Multiple break cycles**: work → break → work → break → checkout, verify cumulative hours
- **Break reason validation**: invalid reason → error

#### T3 — Shift Open Gate Enforcement

Tests that ALREADY exist:
- `shifts.test.js`: open, double-open prevention, close

Tests to ADD in smoke suite:
- **Cashier cannot open shift**: POST `/api/shifts/open` as Cashier → 403
- **Verify active shift endpoint**: GET `/api/shifts/active?outlet_id=1` returns the open shift

#### T4 — POS Checkout With Precondition Enforcement

Tests that ALREADY exist:
- `sales.test.js`: successful checkout, discounts, payments

**Critical tests to ADD** (these are the biggest gap):
- **No shift → sale blocked**: POST `/api/sales` without open shift → 400 with `code: "shift_not_open"`
- **Not clocked in → sale blocked**: POST `/api/sales` with shift but no attendance → 400 with `code: "employee_not_clocked_in"`
- **On break → sale blocked**: POST `/api/sales` while employee is on break → 400 with `code: "employee_not_clocked_in"`
- **Both conditions met → sale succeeds**: verify sale, items, payments, stock, invoice

#### T5 — Shift Close and Cash Reconciliation

Tests that ALREADY exist:
- `shifts.test.js`: close, variance, denominations

Tests to ADD in smoke suite:
- **Full cycle math**: open at 500 → make cash sale of 300 → close → verify `expected_cash = 800`, `variance = closing_cash - 800`
- **Voided sale excluded**: void a sale → verify it doesn't affect expected_cash
- **Manager permission required**: Cashier cannot close shift → 403

**NPM script to add:**
```json
"test:smoke": "vitest run tests/integration/smoke-gate.test.js"
```

**Exit criteria:** `npm run test:smoke` passes all T1-T5 assertions

---

### Phase 2: Context Enforcement and RBAC Hardening

**Goal:** Validate the Context Unification system end-to-end and fill RBAC gaps.

**New file:** `backend/tests/integration/context-enforcement.test.js`

Tests to write:

1. **Context header enforcement (flag ON)**:
   - Non-admin request without `x-outlet-id` → 428 "Context required"
   - Admin request without `x-outlet-id` → passes (admin bypass)
   - Exempt paths (`/api/auth/*`, `/api/attendance/pin-*`) → pass without header

2. **Outlet assignment enforcement**:
   - Employee assigned to outlet 1 → can access outlet 1 data
   - Employee NOT assigned to outlet 2 → blocked from outlet 2 data

3. **Automated RBAC matrix**:
   Create a parameterized test that validates the role×workflow matrix:
   ```
   POST /api/shifts/open     → Admin: 200, Manager: 200, Cashier: 403
   POST /api/shifts/:id/close → Admin: 200, Manager: 200, Cashier: 403
   POST /api/products        → Admin: 200, Manager: 200, Cashier: 403
   POST /api/returns         → Admin: 200, Manager: 200*, Cashier: 403
   POST /api/sales           → Admin: 200, Manager: 200, Cashier: 200
   ```
   *Note: returns.js requires `manage_customers` — Manager may not have this. Resolve in Phase 0.

**Exit criteria:** Context enforcement + RBAC matrix tests pass for all 3 roles

---

### Phase 3: Return and Exchange Flow Coverage

**Goal:** Test the March 2026 return/exchange feature that has zero coverage.

**New file:** `backend/tests/integration/returns-exchange.test.js`

Tests to write:

1. **Simple refund with bill**: Create sale → POST return with `original_sale_id` → verify return record, items, outlet_stock restocked
2. **Refund without bill**: POST return without `original_sale_id` → verify it works (manual return)
3. **Exchange — even balance**: Return 100 PKR item, exchange for 100 PKR item → verify:
   - Exchange sale created with Return Credit payment
   - Return record linked to original sale
   - Balance = 0, no additional payment
4. **Exchange — customer pays difference**: Return 100 PKR, exchange for 150 PKR → verify:
   - Return Credit = 100, customer pays 50 via settle method
   - Both sale and return records correct
5. **Exchange — customer gets refund**: Return 150 PKR, exchange for 100 PKR → verify:
   - Return Credit covers exchange, 50 PKR refunded
6. **Exchange atomic ordering**: Exchange sale (POST /api/sales) must succeed before return (POST /api/returns) — if shift closes between them, return should not be orphaned
7. **Variant stock handling**: Return a variant product → verify `product_variants.stock` AND `outlet_stock` are both restocked (currently a potential bug — only `outlet_stock` is updated)

**Exit criteria:** All exchange math and ordering tests pass

---

### Phase 4: E2E Smoke Chain

**Goal:** One Playwright test that runs the complete daily business cycle through the real UI.

**New file:** `frontend/tests/e2e/smoke-gate.spec.js`

Single test flow:

1. Login as Manager
2. Complete context selection (select outlet)
3. Navigate to Kiosk → clock in via PIN
4. Navigate to POS → open shift with denomination capture
5. Search product → add to cart → complete cash sale
6. Open Recent Sales panel → verify sale appears
7. Click Return on the sale → complete a refund
8. Close shift → verify reconciliation math on screen
9. Logout

**Also fix in existing E2E:**
- Update `helpers/auth.js` `loginAsAdmin()` to handle context-select flow
- Fix denomination input selectors in `pos.spec.js`
- Remove `NotificationBell` tests from `layout.test.jsx` (component not used)

**Exit criteria:** `npm run test:e2e` = all specs pass including new smoke chain

---

### Phase 5: Known Bug Resolution

**Goal:** Convert bug confirmations into either fixes or documented accepted risks.

| Bug | Description | Decision Needed |
|-----|-------------|----------------|
| B2 | Negative stock allowed on sales and adjustments | Fix or accept? |
| B11 | Summary vs Detail report discount discrepancy | Fix or accept? |
| B12 | Prior shift sales leak into next shift's expected_cash | Fix (impacts reconciliation math) |
| B16 | Returned items not validated against original sale | Fix (allows fraud) |
| Variant restock | Returns only restock `outlet_stock`, not `product_variants` | Fix (inventory drift) |

For each bug decided as "Fix":
1. Write a failing test that proves the bug
2. Fix the code
3. Verify test passes

For each bug decided as "Accept":
1. Change the test from bug confirmation to documented behavior
2. Add a comment explaining why it's accepted

---

### Phase 6: Expansion (After Phases 0-5 Are Green)

These are intentionally deferred:

1. **Negative and abuse cases** — invalid inputs, boundary values, injection attempts
2. **Concurrency** — simultaneous shift opens, double-checkout race conditions
3. **Data integrity** — full lifecycle (create → sell → return → report consistency)
4. **Auditability** — verify audit trail records exist for sensitive operations
5. **Failure handling** — network errors, DB lock timeouts, partial transaction rollback
6. **Performance** — response time under load, query efficiency
7. **Security hardening** — OWASP top 10, header validation, SQL injection
8. **Migration testing** — verify migrate61→62 doesn't break existing data
9. **Backup/restore** — backup creates valid snapshot, restore recovers state
10. **Cross-browser** — Playwright multi-browser (Firefox, WebKit)
11. **Observability** — log output validation, error tracking
12. **Compliance** — business rule verification, tax calculation accuracy

---

## Backend <-> Frontend Link Map

| Frontend Surface | Backend Endpoint(s) | Critical Rule | Current Coverage |
|---|---|---|---|
| Login (`/login`) | `POST /api/auth/login`, `GET /api/auth/me` | Session and permissions must match employee role | Backend: `auth.test.js` (8 tests). E2E: `auth.spec.js` (stale — missing context flow) |
| Context Select (`/context-select`) | `GET /api/context/bootstrap` | Branch context must exist when required | **NO TESTS** — add in Phase 1 (T1) and Phase 4 |
| Kiosk (`/kiosk`) | `POST /api/attendance/pin-status`, `pin-checkin`, `pin-checkout` | PIN flow and branch assignment rules must hold | Backend: `attendance.test.js` (11 tests). E2E: `kiosk.spec.js` (mostly current) |
| POS Opening Gate (`/pos`) | `GET /api/shifts/active`, `GET /api/attendance/my-status`, `POST /api/shifts/open` | No checkout unless shift open and employee clocked in | Backend: `shifts.test.js` (11 tests). **Gap: no rejection tests** — add in Phase 1 (T3, T4) |
| Checkout | `POST /api/sales` | Sale logic, totals, payments, stock, invoice generation | Backend: `sales.test.js` (21 tests). **Gap: no gate rejection tests** — add in Phase 1 (T4) |
| Return/Exchange | `POST /api/returns`, `POST /api/sales` (exchange) | Refund math, exchange ordering, stock restock | **NO TESTS** — add in Phase 3 |
| Recent Sales | `GET /api/sales?date_from=...` | Today's sales for outlet, search by invoice | **NO TESTS** — add in Phase 4 (E2E) |
| Role-guarded pages | Multiple via `PERMISSION_RULES` + route-level guards | Frontend visibility must match backend enforcement | Backend: `rbac.test.js` (13 tests). **Gap: no context enforcement** — add in Phase 2 |

## Role x Workflow Matrix

| Workflow | Administrator | Manager | Cashier | Permission Required |
|---|---|---|---|---|
| Login | Allow | Allow | Allow | (none) |
| Context bootstrap | All outlets | Assigned only | Assigned only | (none — auth required) |
| Kiosk check-in/out | Allow | Allow | Allow | (none — PIN auth) |
| Open shift | Allow | Allow | **Deny** | `manage_orders` |
| Complete POS sale | Allow | Allow | Allow | (none — gate checks only) |
| Close shift | Allow | Allow | **Deny** | `manage_orders` |
| Process return | Allow | **Check** | **Deny** | `manage_customers`* |
| Manage inventory | Allow | Allow | **Deny** | `manage_inventory` |
| View reports | Allow | Allow | Allow | `view_reports` |
| Manage employees | Allow | Allow | **Deny** | `manage_employees` |
| Admin/settings | Allow | **Deny** | **Deny** | `all_access` |

*Note: `returns.js` requires `manage_customers` but Manager role seed data only has `manage_orders`. This mismatch must be resolved in Phase 0.

Legend:
- `Allow`: action permitted
- `Deny`: returns 403
- `Check`: depends on permission assignment — currently mismatched, needs resolution

---

## Test Infrastructure Reference

### Existing Test Helpers

| File | Purpose |
|------|---------|
| `backend/tests/helpers/createTestApp.js` | Express app factory with in-memory SQLite, permission middleware, seeded data |
| `backend/tests/helpers/seedSchema.js` | Replays full DB schema (56 migrations, 40+ tables) |
| `backend/tests/helpers/seedData.js` | Fixtures: 2 outlets, 3 roles/employees, 5 products, 1 customer |
| `backend/tests/helpers/request.js` | Supertest wrapper with auto `x-employee-id` injection |
| `frontend/tests/e2e/helpers/auth.js` | E2E login helper with admin credentials |

### Seeded Test Data

| Entity | Values |
|--------|--------|
| Employees | ID 1: Hassan (Admin, PIN 2580), ID 2: Manager User (PIN 2222), ID 3: Cashier User (PIN 3333) |
| Outlets | ID 1: Main Store, ID 2: Branch Store |
| Products | PROD-001 to PROD-005 (prices 50-500, stock 20-100 at outlet 1) |
| Customer | ID 1: Test Customer (wallet balance 500.00) |
| Roles | Administrator (`all_access`), Manager (8 permissions), Cashier (3 permissions) |

### Commands

```bash
# Phase 0: Fix and verify existing tests
cd backend && npm run test:integration

# Phase 1: Run smoke suite only
cd backend && npm run test:smoke

# Phase 4: Run E2E
cd frontend && npm run test:e2e

# Full release gate
cd backend && npm run test:smoke && npm run test:integration && cd ../frontend && npm run test:e2e
```

### NPM Scripts to Add

```json
// backend/package.json
"test:smoke": "vitest run tests/integration/smoke-gate.test.js"

// frontend/package.json (already exists)
"test:e2e": "npx playwright test"
```

---

## Release Gate Checklist

Before any release:

- [ ] Phase 0 complete: all 212 existing backend tests pass
- [ ] Phase 1 complete: smoke-gate.test.js (T1-T5) passes
- [ ] Phase 2 complete: context enforcement + RBAC matrix passes
- [ ] No P0/P1 defects in role enforcement or checkout lifecycle
- [ ] Open-day to close-day flow passes end-to-end (E2E smoke chain)
- [ ] Known bugs either fixed or documented as accepted risk
- [ ] Test evidence captured (Vitest JSON reporter + Playwright HTML report)

---

## File Plan (New Files to Create)

| Phase | File | Purpose |
|-------|------|---------|
| 0 | (modify) `backend/tests/helpers/createTestApp.js` | Add context middleware stubs |
| 0 | (modify) `backend/tests/helpers/seedData.js` | Add context flags, employee_outlets, company |
| 0 | (modify) `backend/tests/integration/returns.test.js` | Fix permission mismatch |
| 0 | (modify) `frontend/tests/e2e/helpers/auth.js` | Handle context-select flow |
| 1 | `backend/tests/integration/smoke-gate.test.js` | T1-T5 sequential smoke suite |
| 2 | `backend/tests/integration/context-enforcement.test.js` | Context headers + RBAC matrix |
| 3 | `backend/tests/integration/returns-exchange.test.js` | Return/exchange flow coverage |
| 4 | `frontend/tests/e2e/smoke-gate.spec.js` | Full daily cycle E2E |

---

## Ownership and Maintenance

- This file is the single source of truth for test priorities.
- Every new major feature must add:
  - one role-impact entry to the matrix
  - one workflow-impact entry
  - at least one mapped automated test case
- When shipping a feature that changes middleware, route registration, or auth flow: **update `createTestApp.js` and `seedData.js` in the same commit**
- Review cadence: weekly during active development, and before each release candidate.

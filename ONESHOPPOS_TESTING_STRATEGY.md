# OneShopPOS Testing Strategy and Execution Plan

Updated: 2026-03-06 (Revision 3 — Phases 0-3 complete)
Project: OneShopPOS (`D:\newprojects\oneshoppos`)
Scope: Backend + Frontend + Role behavior + Workflow integrity

---

## Execution Progress

| Phase | Goal | Status | Tests Added | Total Passing |
|-------|------|--------|-------------|---------------|
| Phase 0 | Fix broken test infrastructure | **COMPLETE** | 0 new (fixed 5 existing) | 212 → 212 |
| Phase 1 | Daily operations smoke suite | **COMPLETE** | +25 | 237 |
| Phase 2 | Context enforcement + RBAC matrix | **COMPLETE** | +29 | 266 |
| Phase 3 | Return/exchange flow coverage | **COMPLETE** | +11 | 277 |
| Phase 4 | E2E smoke chain | Pending | — | — |
| Phase 5 | Known bug resolution | Pending | — | — |
| Phase 6 | Expansion | Deferred | — | — |

**Current:** `npm run test:integration` → **277/277 passing** (23 test files)

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

- All existing 212 backend integration tests pass again ✅ Done
- Initial 5 critical smoke tests are stable and repeatable ✅ Done (25 tests in T1-T5)
- Permission boundaries are enforced in both frontend and backend ✅ Done (Phase 2)
- Critical end-to-end daily flow (open -> sell -> close) remains green ✅ Done (backend)
- Future tests can be added in the same matrix without redesigning the process ✅

---

## What Was Fixed (Phase 0 Findings)

### Root cause: Context Unification shipped, test infra not updated

`registerAllRoutes.js` calls `app.use(resolveContext)` and `app.use(requireContextOutlet)` (lines 47-48). These were undefined in `createTestApp.js` deps, causing `TypeError: app.use() requires a middleware function` on every test.

### Files modified in Phase 0

| File | What changed | Why |
|------|-------------|-----|
| `backend/tests/helpers/createTestApp.js` | Added `resolveContext` (sets `req.context = {…}`, calls next) and `requireContextOutlet` (noop) to deps | Fix root crash |
| `backend/tests/helpers/seedSchema.js` | Added `employee_outlets` table + indexes; added `companies` table | Tables exist in migrate61 but were missing from schema replay |
| `backend/tests/helpers/seedData.js` | Added company record (id=1), `employee_outlets` records (all 3 employees → outlet 1; admin also → outlet 2), context feature flags | Middleware and endpoints query these |
| `backend/routes/returns.js` | Fixed `requirePerm("manage_customers")` → `requirePerm("manage_orders")` | Route permission contradicted PERMISSION_RULES — Manager was being wrongly blocked |
| `backend/tests/integration/returns.test.js` | Updated test description to match corrected permission | |
| `backend/tests/integration/customers.test.js` | 4 tests used anonymous `supertest(app)` on permission-gated routes → changed to `makeRequest(app, ADMIN_ID)` | Routes now enforce `manage_customers` |
| `backend/tests/integration/inventory.test.js` | 1 test used `MANAGER_ID` for outlet 2 adjustment — Manager not assigned to outlet 2 → changed to `ADMIN_ID` | Outlet assignment enforcement middleware added |
| `frontend/tests/e2e/helpers/auth.js` | `loginAsAdmin()` now handles `/context-select` redirect after login | Context Unification: admin gets context-select page after login |

### Key architectural facts discovered

- **`employee_outlets` junction table**: Non-admin employees are blocked from accessing any outlet not in this table. This applies to ALL requests that carry an `outlet_id` (body, query, header, or context). Admin (`all_access`) bypasses it.
- **`companies` table**: Added in migrate61, queried by `/api/context/bootstrap`. Missing from seedSchema caused silent failures.
- **Login vs attendance field naming**: `/api/auth/login` uses `pin` field; `/api/attendance/pin-checkin` and `/api/attendance/pin-status` use `pin_code` field. These are different — do not confuse them.
- **`resolveContext` is cached in `index.js`**: The real `resolveContext` uses a module-level `_contextEnforced` boolean cached at startup from the DB. Integration tests bypass this entirely via the no-op stub. Tests that need real enforcement build their own middleware — see `context-enforcement.test.js`.

---

## Current State Assessment (Post Phase 0 Audit)

### What Exists

| Layer | Files | Tests | Framework | Status |
|-------|-------|-------|-----------|--------|
| Backend Integration | 23 files | 277 tests | Vitest + Supertest | **ALL PASSING** |
| Frontend Unit | 3 files | ~20 tests | Vitest + Testing Library | Likely passing |
| Frontend E2E | 8 files | 9 tests | Playwright (Chromium) | Auth helper fixed; selectors may need review |

### Known Issues and Watch-Outs

#### Cross-test contamination (parallel execution)

Vitest runs test files in parallel by default. Tests that modify shared state (sales, shifts) can contaminate each other when run together. Known affected pair:

- `shifts.test.js` — the B12 bug test (`expect(res.body.cash_sales).toBe(125)`) relies on exactly 1 sale from a prior closed shift (= 50) plus 1 sale in the current shift (= 75) = 125. If other test files also create sales in outlet 1 before this test runs, the number grows and the test fails.
- **Mitigation**: All tests use their own in-memory DB (from `createTestApp()`). Contamination only happens when tests share the same `app+db` instance — but since each file creates its own instance and SQLite is in-memory, this should not happen. If the B12 test starts failing intermittently, check whether something changed the `beforeAll` ordering.
- **Current status**: Passes reliably when run in isolation or with any other individual test file. If it fails in full suite runs, investigate test file ordering.

#### Vitest parallel file execution and test ordering within smoke-gate.test.js

`smoke-gate.test.js` runs T1→T5 sequentially in one file sharing a single DB. This is intentional. Do NOT reorder or split the describes — later phases depend on earlier ones (e.g., T4 depends on T2's clock-in and T3's shift open).

#### Express v5 wildcard routes

Express v5 (used in this project) does NOT support `app.all("*", ...)` — it throws `Missing parameter name at index 1: *`. Use `app.use(...)` as a catch-all instead. This was encountered in `context-enforcement.test.js` and fixed.

### Known Bugs (Confirmed by Tests, Not Yet Fixed)

| Bug ID | Description | Test that documents it | Fix status |
|--------|-------------|------------------------|------------|
| B2 | Negative stock allowed on sales and adjustments | `sales.test.js`, `inventory.test.js` | Unfixed |
| B11 | Summary vs Detail report discount discrepancy | `reports.test.js` | Unfixed |
| B12 | Prior shift sales leak into next shift's `expected_cash` | `shifts.test.js` — "voided sales excluded…" | Unfixed |
| B16 | Returned items not validated against original sale (wrong product or excess qty accepted) | `returns.test.js` — two B16 tests | Unfixed |
| B-VARIANT | `POST /api/returns` restocks `outlet_stock` but does NOT update `product_variants.stock` | `returns-exchange.test.js` RE7 | Unfixed — confirmed |

**Important**: B-VARIANT is now confirmed by RE7. The test currently asserts the **buggy** behavior (`variantStockAfter.stock === variantStockBefore.stock`). When this is fixed in `routes/returns.js`, the RE7 assertion must be flipped to `variantStockBefore.stock + quantity`.

### Features With Zero Test Coverage (Remaining)

- POS Recent Sales panel (`POSRecentSalesPanel.jsx`) — no E2E
- `RequireContext` guard component — no frontend unit test
- Frontend denomination input in shift open/close UI — selectors may be stale in `pos.spec.js`

---

## Phased Execution Plan

### ✅ Phase 0: Fix The Foundation

**Status: COMPLETE** — All 212 pre-existing tests pass.

Files fixed: `createTestApp.js`, `seedSchema.js`, `seedData.js`, `returns.js` (route), `returns.test.js`, `customers.test.js`, `inventory.test.js`, `frontend/tests/e2e/helpers/auth.js`

---

### ✅ Phase 1: Daily Operations Smoke Suite

**Status: COMPLETE** — 25/25 tests pass.
**File:** `backend/tests/integration/smoke-gate.test.js`
**NPM script:** `npm run test:smoke`

Sequential suite sharing one DB. Covers the complete daily business cycle:

| Describe | Tests | What it covers |
|---------|-------|----------------|
| T1 — Login & Bootstrap | 6 | Login as each role, verify permissions, context bootstrap (admin sees all outlets, manager sees only assigned, no-auth 401) |
| T2 — Kiosk Check-In | 6 | PIN status, check-in idempotency, outlet assignment rejection (403 for wrong outlet), all 3 roles clock in |
| T3 — Shift Gate | 4 | Cashier blocked from opening shift (403), Manager opens shift, active shift endpoint, double-open blocked |
| T4 — POS Checkout | 4 | Gate rejection (no attendance → `employee_not_clocked_in`), gate rejection (no shift → `shift_not_open`), happy path sale with stock deduction, Cashier can sell |
| T5 — Shift Close | 5 | Cashier blocked from close (403), Manager closes, DB state verified, re-close blocked, post-close sale blocked |

**Lessons from writing this suite:**
- T4 gate-rejection tests need isolated DBs (no existing state). Use inline `createTestApp()` + `closeDb()` for those two tests, shared DB for the rest.
- Login endpoint uses `pin` field. Attendance endpoints (`pin-status`, `pin-checkin`, `pin-checkout`) use `pin_code` field. These are different.

---

### ✅ Phase 2: Context Enforcement and RBAC Hardening

**Status: COMPLETE** — 29/29 tests pass.
**File:** `backend/tests/integration/context-enforcement.test.js`

| Describe | Tests | What it covers |
|---------|-------|----------------|
| CE1–CE3 — Context enforcement logic | 8 | Non-admin without `x-outlet-id` → 428 CONTEXT_REQUIRED; Admin bypasses; Request with header passes; 5 exempt paths all pass |
| CE4 — Outlet assignment enforcement | 6 | Manager/Cashier blocked from unassigned outlet 2; Admin passes outlet 2; kiosk check-in also enforces assignment |
| CE5 — RBAC matrix | 15 | 3 roles × 5 endpoints: shifts/open, shifts/:id/close, products, returns, sales |

**Implementation note:** The real `resolveContext` in `index.js` reads a cached `_contextEnforced` flag at startup. Integration tests stub it out. CE1-CE3 tests build a local `buildEnforcingResolveContext()` function that mirrors the real logic and use mini Express apps to test it in isolation. This avoids needing to touch the flag cache.

**RBAC matrix results (confirmed passing):**

| Endpoint | Admin | Manager | Cashier |
|---|---|---|---|
| POST /api/shifts/open | 400 (shift exists, not 403) | 400 (shift exists, not 403) | **403** |
| POST /api/shifts/:id/close | not 403 | not 403 | **403** |
| POST /api/products | 200 | 200 | **403** |
| POST /api/returns | 200 | 200 | **403** |
| POST /api/sales | 200 | 200 | 200 |

---

### ✅ Phase 3: Return and Exchange Flow Coverage

**Status: COMPLETE** — 11/11 tests pass.
**File:** `backend/tests/integration/returns-exchange.test.js`

| Describe | Tests | What it covers |
|---------|-------|----------------|
| RE1 — Refund with bill | 3 | Outlet_stock restocked, return record linked to sale, partial return only touches selected items |
| RE2 — Manual refund | 1 | No `original_sale_id` → still succeeds, stock restocked |
| RE3 — Even exchange | 1 | Exchange sale with `Return Credit` payment, balance = 0 |
| RE4 — Customer pays diff | 1 | Split payment: Return Credit 100 + Cash 50 for 150 PKR exchange |
| RE5 — Customer gets refund | 1 | Return Credit covers exchange total; excess refunded by cashier outside system |
| RE6 — Atomic ordering | 2 | Sale fails if shift closed → return never sent → inventory stays consistent; Return can be posted after shift closes |
| RE7 — Variant stock bug | 2 | Sale correctly decrements `product_variants.stock`; return does NOT restock it (**BUG B-VARIANT confirmed**) |

**Exchange flow summary** (as implemented by `POSReturnExchangeModal.jsx`):
1. `POST /api/sales` first with `Return Credit` payment — if this fails, stop (no return posted)
2. `POST /api/returns` second — links to original sale via `original_sale_id`
3. Balance math: `balance = exchangeTotal - refundTotal`
   - `balance < 0`: Return Credit covers exchange total; cashier pays out difference separately
   - `balance > 0`: Payments = [Return Credit: refundTotal, settleMethod: balance]
   - `balance = 0`: Even exchange — Return Credit offsets entirely, payments array is empty

**Bug B-VARIANT details:**
`routes/returns.js` uses `updateStockStmt` to update `outlet_stock` only. It does not touch `product_variants`. The sales route (`routes/sales.js`) DOES decrement `product_variants.stock` on sale (line ~462). This creates an asymmetry: variants are decremented on sale but not restocked on return. Fix is to add a variant stock UPDATE to the returns route.

---

### Phase 4: E2E Smoke Chain

**Status: Pending**

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
- Update `helpers/auth.js` `loginAsAdmin()` to handle context-select flow ✅ Already done in Phase 0
- Fix denomination input selectors in `pos.spec.js` — may be stale after March 2026 UI changes
- Remove `NotificationBell` tests from `layout.test.jsx` — component is never imported anywhere in the app

**Exit criteria:** `npm run test:e2e` = all specs pass including new smoke chain

---

### Phase 5: Known Bug Resolution

**Status: Pending**

**Goal:** Convert bug confirmations into either fixes or documented accepted risks.

| Bug | Description | Recommended action |
|-----|-------------|-------------------|
| B2 | Negative stock allowed on sales and adjustments | Decide: add stock floor check in `POST /api/sales` and `POST /api/adjustments` |
| B11 | Summary vs Detail report discount discrepancy | Decide: fix SQL aggregate or accept |
| B12 | Prior shift sales leak into next shift's `expected_cash` | **Fix recommended** — reconciliation math is wrong, affects daily cash reports |
| B16 | Returned items not validated against original sale | **Fix recommended** — allows returns of items never sold, potential fraud vector |
| B-VARIANT | Returns don't restock `product_variants.stock` | **Fix recommended** — inventory drift for variant products. Fix in `routes/returns.js`: add `UPDATE product_variants SET stock = stock + ? WHERE id = ?` for each return item that has a `variant_id` |

For each bug decided as "Fix":
1. Write a failing test that proves the bug (already done for B16 and B-VARIANT)
2. Fix the code
3. Flip the test assertion to verify the fix

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
| Login (`/login`) | `POST /api/auth/login`, `GET /api/auth/me` | Session and permissions must match employee role | Backend: `auth.test.js` (8 tests), `smoke-gate.test.js` T1. E2E: `auth.spec.js` (auth helper updated) |
| Context Select (`/context-select`) | `GET /api/context/bootstrap` | Branch context must exist when required | Backend: `smoke-gate.test.js` T1 (3 tests). E2E: Pending Phase 4 |
| Kiosk (`/kiosk`) | `POST /api/attendance/pin-status`, `pin-checkin`, `pin-checkout` | PIN flow and branch assignment rules must hold | Backend: `attendance.test.js` (11 tests), `smoke-gate.test.js` T2 (6 tests). E2E: `kiosk.spec.js` |
| POS Opening Gate (`/pos`) | `GET /api/shifts/active`, `GET /api/attendance/my-status`, `POST /api/shifts/open` | No checkout unless shift open and employee clocked in | Backend: `shifts.test.js` (11 tests), `smoke-gate.test.js` T3/T4 (8 tests). Gap: no gate rejection tests |
| Checkout | `POST /api/sales` | Sale logic, totals, payments, stock, invoice generation | Backend: `sales.test.js` (21 tests), `smoke-gate.test.js` T4, `context-enforcement.test.js` CE5 |
| Return/Exchange | `POST /api/returns`, `POST /api/sales` (exchange) | Refund math, exchange ordering, stock restock | Backend: `returns.test.js` (8 tests), `returns-exchange.test.js` (11 tests) ✅ |
| Recent Sales | `GET /api/sales?date_from=...` | Today's sales for outlet, search by invoice | No backend gaps. E2E: Pending Phase 4 |
| Role-guarded pages | Multiple via `PERMISSION_RULES` + route-level guards | Frontend visibility must match backend enforcement | Backend: `rbac.test.js` (13 tests), `context-enforcement.test.js` CE5 (15 tests) ✅ |

## Role x Workflow Matrix

| Workflow | Administrator | Manager | Cashier | Permission Required |
|---|---|---|---|---|
| Login | Allow | Allow | Allow | (none) |
| Context bootstrap | All outlets | Assigned only | Assigned only | (none — auth required) |
| Kiosk check-in/out | Allow | Allow | Allow | (none — PIN auth) |
| Open shift | Allow | Allow | **Deny** | `manage_orders` |
| Complete POS sale | Allow | Allow | Allow | (none — gate checks only) |
| Close shift | Allow | Allow | **Deny** | `manage_orders` |
| Process return | Allow | Allow | **Deny** | `manage_orders` |
| Manage inventory | Allow | Allow | **Deny** | `manage_inventory` |
| View reports | Allow | Allow | Allow | `view_reports` |
| Manage employees | Allow | Allow | **Deny** | `manage_employees` |
| Admin/settings | Allow | **Deny** | **Deny** | `all_access` |

Note: `returns.js` requires `manage_orders` (confirmed in PERMISSION_RULES and route). Manager has this permission. This was a bug (previously `manage_customers`) — fixed in Phase 0.

Legend:
- `Allow`: action permitted
- `Deny`: returns 403

---

## Test Infrastructure Reference

### Existing Test Helpers

| File | Purpose |
|------|---------|
| `backend/tests/helpers/createTestApp.js` | Express app factory with in-memory SQLite, permission middleware, seeded data |
| `backend/tests/helpers/seedSchema.js` | Replays full DB schema (migrate61, 40+ tables including `employee_outlets`, `companies`) |
| `backend/tests/helpers/seedData.js` | Fixtures: 1 company, 2 outlets, 3 roles/employees, 5 products, 1 customer, employee_outlets assignments, context feature flags |
| `backend/tests/helpers/request.js` | Supertest wrapper with auto `x-employee-id` injection |
| `frontend/tests/e2e/helpers/auth.js` | E2E login helper — handles both `/dashboard` and `/context-select` redirect after login |

### Seeded Test Data

| Entity | Values |
|--------|--------|
| Company | ID 1: Test Company (code: TEST) |
| Employees | ID 1: Hassan (Admin, PIN `2580`), ID 2: Manager User (PIN `2222`), ID 3: Cashier User (PIN `3333`) |
| Outlets | ID 1: Main Store, ID 2: Branch Store |
| Employee-outlet assignments | All 3 → outlet 1; Admin also → outlet 2 |
| Products | PROD-001 to PROD-005 (prices 50-500, stock 20-100 at outlet 1) |
| Customer | ID 1: Test Customer (wallet balance 500.00) |
| Roles | Administrator (`all_access`), Manager (8 permissions), Cashier (3 permissions) |
| Feature flags | All context flags `false` by default (tests unaffected); `manage_orders`, `manage_inventory` etc. active |

### Live Credentials (production DB — NOT used in integration tests)

| Name | Role | PIN |
|------|------|-----|
| Hassan | Administrator | `2580` |
| mubashir | Manager | `2222` |
| ishtiaq | Cashier | `3333` |
| naeem shah | Manager | `1234` |

Integration tests use seeded data (Hassan/2580, Manager User/2222, Cashier User/3333) — not live credentials.

### Commands

```bash
# Run all integration tests
cd backend && npm run test:integration

# Run smoke suite only (T1-T5 daily cycle)
cd backend && npm run test:smoke

# Run a single test file
cd backend && npx vitest run tests/integration/context-enforcement.test.js

# Run E2E
cd frontend && npm run test:e2e

# Full release gate
cd backend && npm run test:smoke && npm run test:integration && cd ../frontend && npm run test:e2e
```

### NPM Scripts

```json
// backend/package.json (all present)
"test:integration": "vitest run tests/integration",
"test:smoke":       "vitest run tests/integration/smoke-gate.test.js",
"test:unit":        "vitest run tests/unit",
"test:coverage":    "vitest run --coverage"
```

---

## Release Gate Checklist

Before any release:

- [x] Phase 0 complete: all 212 existing backend tests pass (now 277 with new files)
- [x] Phase 1 complete: smoke-gate.test.js (T1-T5) — 25/25 pass
- [x] Phase 2 complete: context enforcement + RBAC matrix — 29/29 pass
- [x] Phase 3 complete: return/exchange coverage — 11/11 pass
- [ ] Phase 4 complete: E2E smoke chain passes
- [ ] No P0/P1 defects in role enforcement or checkout lifecycle
- [ ] Known bugs either fixed (B-VARIANT, B16, B12) or documented as accepted risk (B2, B11)
- [ ] Test evidence captured (Vitest JSON reporter + Playwright HTML report)

---

## File Plan

| Phase | File | Purpose | Status |
|-------|------|---------|--------|
| 0 | `backend/tests/helpers/createTestApp.js` | Added context middleware stubs, `employee_outlets`, `companies` | ✅ Done |
| 0 | `backend/tests/helpers/seedSchema.js` | Added `employee_outlets` table + indexes; `companies` table | ✅ Done |
| 0 | `backend/tests/helpers/seedData.js` | Added company, employee_outlets, context feature flags | ✅ Done |
| 0 | `backend/routes/returns.js` | Fixed permission: `manage_customers` → `manage_orders` | ✅ Done |
| 0 | `backend/tests/integration/returns.test.js` | Updated test description | ✅ Done |
| 0 | `backend/tests/integration/customers.test.js` | Fixed 4 anonymous requests to use `ADMIN_ID` | ✅ Done |
| 0 | `backend/tests/integration/inventory.test.js` | Fixed Manager→outlet 2 to Admin | ✅ Done |
| 0 | `frontend/tests/e2e/helpers/auth.js` | Handle context-select redirect | ✅ Done |
| 1 | `backend/tests/integration/smoke-gate.test.js` | T1-T5 sequential smoke suite (25 tests) | ✅ Done |
| 1 | `backend/package.json` | Added `test:smoke` script | ✅ Done |
| 2 | `backend/tests/integration/context-enforcement.test.js` | Context headers + RBAC matrix (29 tests) | ✅ Done |
| 3 | `backend/tests/integration/returns-exchange.test.js` | Return/exchange flow + B-VARIANT bug doc (11 tests) | ✅ Done |
| 4 | `frontend/tests/e2e/smoke-gate.spec.js` | Full daily cycle E2E | ⏳ Pending |
| 5 | `backend/routes/returns.js` | Fix B-VARIANT: restock `product_variants.stock` on return | ⏳ Pending |
| 5 | `backend/routes/sales.js` or shifts | Fix B12: scope expected_cash to current shift only | ⏳ Pending |
| 5 | `backend/routes/returns.js` | Fix B16: validate returned items belong to original sale | ⏳ Pending |

---

## Ownership and Maintenance

- This file is the single source of truth for test priorities.
- Every new major feature must add:
  - one role-impact entry to the matrix
  - one workflow-impact entry
  - at least one mapped automated test case
- When shipping a feature that changes middleware, route registration, or auth flow: **update `createTestApp.js` and `seedData.js` in the same commit**
- When a bug is fixed: flip the confirming test assertion from "buggy behavior" to "correct behavior"
- Review cadence: weekly during active development, and before each release candidate.

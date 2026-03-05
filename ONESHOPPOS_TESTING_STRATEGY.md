# OneShopPOS Testing Strategy and Execution Plan

Generated on: 2026-03-05  
Project: OneShopPOS (`D:\newprojects\oneshoppos`)  
Scope: Backend + Frontend + Role behavior + Workflow integrity

## Why We Are Doing This

The project has reached a size where manual testing alone is too slow and risky.  
OneShopPOS now has:

- Multiple roles (`Administrator`, `Manager`, `Cashier`)
- Role and permission differences (what each role can/cannot do)
- Backend rules that must always stay correct
- Frontend route guards and user flows that must match backend behavior
- Cross-feature dependencies (attendance, shifts, sales, reports, inventory, approvals, etc.)

Goal: avoid 2-3 months of manual re-testing by using a structured test system that catches regressions early and repeatedly.

## Our Goal

Create a reliable release-quality test strategy that:

- Protects critical daily operations from breakage
- Verifies role-based behavior for `Administrator`, `Manager`, and `Cashier`
- Verifies backend logic and frontend user behavior together
- Prioritizes highest business risk first
- Scales as the project grows

Success criteria:

- Initial 5 critical tests are stable and repeatable
- Permission boundaries are enforced in both frontend and backend
- Critical end-to-end daily flow (open -> sell -> close) remains green
- Future tests can be added in the same matrix without redesigning the process

## Where We Are Starting From (Current State)

This plan is based on a full codebase pass of current structure.

### Backend

- Runtime bootstrap: `backend/index.js`
- Route registration: `backend/routes/registerAllRoutes.js`
- Domain route modules: `backend/routes/*.js` and `backend/routes/reports/*.js`
- Context + permission enforcement:
  - `loadEmployeePerms`
  - `requirePerm` / `requireAnyPerm`
  - `PERMISSION_RULES`
  - `resolveContext` / `requireContextOutlet`
- Core operational routes:
  - Auth: `backend/routes/auth.js`
  - Attendance/Kiosk: `backend/routes/attendance.js`
  - Shifts: `backend/routes/shifts.js`
  - Sales: `backend/routes/sales.js`

### Frontend

- App routes: `frontend/src/App.jsx`
- Auth/session/context: `frontend/src/auth/AuthProvider.jsx`
- Guards:
  - `frontend/src/components/RequireAuth.jsx`
  - `frontend/src/components/RequirePerm.jsx`
  - `frontend/src/components/RequireContext.jsx`
- Critical operation UIs:
  - POS: `frontend/src/pages/redesign/POSRedesign.jsx`
  - POS state/workflow: `frontend/src/pages/redesign/pos/POSContext.jsx`
  - Kiosk: `frontend/src/pages/redesign/KioskRedesign.jsx`
  - Context selection: `frontend/src/pages/ContextSelect.jsx`

### Existing Automated Coverage (Already Present)

- Backend integration tests (`backend/tests/integration/*.test.js`)
  - Includes RBAC, auth, sales, shifts, attendance, returns, reports, etc.
- Frontend unit tests (`frontend/tests/unit/*.test.jsx`)
- Frontend Playwright E2E (`frontend/tests/e2e/*.spec.js`)
  - Includes auth, RBAC, POS, kiosk, reports/governance, inventory/report smoke

## Backend <-> Frontend Link Map

| Frontend Surface | Backend Endpoint(s) | Critical Rule | Current Coverage |
|---|---|---|---|
| Login (`/login`) | `POST /api/auth/login`, `GET /api/auth/me` | Session and permissions must match employee role | Backend auth integration + frontend E2E auth |
| Context Select (`/context-select`) | `GET /api/context/bootstrap` | Branch context must exist when required | Route guards in frontend, context middleware in backend |
| Kiosk (`/kiosk`) | `POST /api/attendance/pin-status`, `pin-checkin`, `pin-checkout` | PIN flow and branch assignment rules must hold | Backend attendance tests + frontend kiosk E2E |
| POS Opening Gate (`/pos`) | `GET /api/shifts/active`, `GET /api/attendance/my-status`, `POST /api/shifts/open` | No checkout unless shift open and employee clocked in | Backend shifts/sales tests + frontend POS E2E |
| Checkout | `POST /api/sales` | Sale logic, totals, payments, stock, invoice generation | Backend sales integration + frontend POS E2E |
| Role-guarded pages | Multiple via `PERMISSION_RULES` + route-level guards | Frontend visibility must match backend enforcement | Backend RBAC integration + frontend RBAC E2E |

## Test Execution Strategy (Order)

1. Run and stabilize 5 initial critical tests first
2. Make these 5 required release smoke gates
3. Expand to wider role/feature matrix
4. Add deferred 12 test areas after initial 5 are consistently green

## Initial 5 Tests (Do First)

These are the first mandatory tests before broad expansion.

### T1 - Login and Role Session Bootstrap

- Objective: validate login and correct permission loading per role
- Roles: `Administrator`, `Manager`, `Cashier`
- Preconditions:
  - Valid employees exist with mapped role permissions
- Steps:
  1. Login with each role account
  2. Verify session payload and permissions list
  3. Verify denied login on bad credentials
- Expected results:
  - Correct role identity and permissions returned
  - Invalid credentials rejected
- Layer: Integration + E2E
- Evidence:
  - Auth API assertions and role-specific UI behavior

### T2 - Kiosk Check-In and Attendance Status Validity

- Objective: validate PIN-based attendance transitions and outlet assignment checks
- Roles: all three roles via PIN flow
- Preconditions:
  - Employee assigned to outlet
  - Employee exists with valid PIN
- Steps:
  1. Check status with `pin-status`
  2. Check in with `pin-checkin`
  3. Validate status becomes `clocked_in`
  4. Start break and return from break
  5. End-of-day checkout
- Expected results:
  - Valid transitions only
  - Unassigned outlet returns error
- Layer: Integration + E2E
- Evidence:
  - Attendance session records and kiosk flow pass

### T3 - Shift Open Gate Enforcement

- Objective: ensure selling is blocked until valid shift is open
- Roles: Manager/Admin can open; Cashier can sell only after gate satisfied
- Preconditions:
  - Outlet selected
  - No active shift for outlet
- Steps:
  1. Open POS on outlet with no active shift
  2. Verify gate blocks checkout
  3. Open shift using allowed role
  4. Re-check gate state
- Expected results:
  - Gate blocks before open shift
  - Gate clears after successful open
- Layer: Integration + E2E
- Evidence:
  - `cash_shifts` open entry + POS gate behavior

### T4 - POS Checkout With Shift + Attendance Preconditions

- Objective: ensure checkout only works when both conditions are true
- Roles: primarily Cashier and Manager/Admin
- Preconditions:
  - Outlet selected
  - Employee clocked in
  - Active shift exists
- Steps:
  1. Attempt checkout without shift (must fail)
  2. Attempt checkout while not clocked in (must fail)
  3. Complete valid checkout with both conditions true
  4. Verify sale, items, and payments persisted
- Expected results:
  - Invalid precondition attempts are blocked
  - Valid flow succeeds and data writes correctly
- Layer: Integration + E2E
- Evidence:
  - Sale records + UI completion state

### T5 - Shift Close and Cash Reconciliation Baseline

- Objective: verify end-of-day closure math and output integrity
- Roles: Manager/Admin
- Preconditions:
  - Open shift exists
  - Known cash sales/refunds in shift period
- Steps:
  1. Close shift with known closing cash
  2. Verify `expected_cash`, `variance`, and summary values
  3. Verify denomination entries when provided
- Expected results:
  - Reconciliation formula outputs expected values
  - Shift status transitions to closed
- Layer: Integration (+ targeted manual check in UI)
- Evidence:
  - Shift close response and database values

## Role x Workflow Matrix (Initial Template)

Use this matrix to drive both manual checks and automated assertions.

| Workflow | Administrator | Manager | Cashier |
|---|---|---|---|
| Login | Allow | Allow | Allow |
| Kiosk check-in/out | Allow | Allow | Allow |
| Open shift | Allow | Allow | Deny |
| Complete POS sale (with gate satisfied) | Allow | Allow | Allow |
| Close shift | Allow | Allow | Deny |
| Manage inventory mutations | Allow | Allow | Deny |
| View reports | Allow | Allow | Conditional (as configured) |
| Admin/settings pages | Allow | Deny | Deny |

Legend:

- `Allow`: full action allowed
- `Deny`: forbidden
- `Conditional`: depends on explicit permission assignment

## TODO (After Initial 5 Tests Are Green)

These are intentionally deferred until initial 5 are stable:

1. Negative and abuse cases
2. Concurrency and race conditions
3. Data integrity across full lifecycle
4. Auditability checks
5. Failure handling and retry behavior
6. Performance and load testing
7. Security hardening tests
8. Upgrade and migration testing
9. Backup/restore and disaster recovery
10. Cross-browser/device/hardware compatibility
11. Observability validation (logs/metrics/alerts)
12. Compliance and business-rule verification

## Automation and Command Plan

### Backend

```bash
cd backend
npm run test:integration
```

### Frontend Unit

```bash
cd frontend
npm run test:unit
```

### Frontend E2E

```bash
cd frontend
npm run test:e2e
```

Run sequence for releases:

1. Initial 5 related suites first (smoke subset)
2. Full integration + frontend E2E after smoke passes

## Release Gate Before Commercial Rollout

Must be true before release:

- Initial 5 tests all pass consistently
- No P0/P1 defects in role enforcement or checkout lifecycle
- RBAC checks pass in both backend and frontend
- Open-day to close-day flow passes end-to-end
- Test evidence captured and archived

## Ownership and Maintenance

- This file is the single source of truth for test priorities.
- Every new major feature must add:
  - one role-impact entry
  - one workflow-impact entry
  - at least one mapped automated test case
- Review cadence: weekly during active development, and before each release candidate.


# Review of `FULL-DAY-SIMULATION-PLAN.md`

## Overall assessment

The plan is strong in breadth. It is already close to a usable end-to-end audit script, especially for POS, reports, dashboard, inventory, RBAC, and feature-flagged modules.

The main gaps are not about scope anymore. They are about:

1. A few route/API inaccuracies that will make automation fail.
2. Missing execution discipline for deterministic data and result validation.
3. A few important product behaviors that are live in the repo but not explicitly simulated.

---

## High-priority corrections

### 1. Fix route/API mismatches before using this as an automation source of truth

- Phase 2 / 10 shift routes are out of date in the plan.
  - Plan says `POST /api/shifts` and `PUT /api/shifts/:id/close`.
  - Repo uses `POST /api/shifts/open` and `POST /api/shifts/:id/close`.
- Phase 16 backup route is inaccurate.
  - Plan says `POST /api/backup`.
  - Repo exposes `GET /api/backup/download`, `POST /api/backup/restore`, and `GET /api/backup/log`.
- Phase 0.7 nav-group count is wrong.
  - The text says "8 groups visible".
  - The list actually names 9 groups: Overview, Commerce, Inventory, Stock Control, Procurement, Insights, Operations, Setup, Admin.

Why this matters: if Playwright is later driven from this document, these route mismatches become false failures immediately.

---

### 2. Resolve document-level count inconsistencies

- The intro says "335+ scenarios across 20 phases".
- The summary says `~352`.

This should be normalized to one number so progress tracking and completion criteria are unambiguous.

---

### 3. Add a deterministic test-data contract

Right now the plan is operationally broad, but it still depends on implicit data assumptions.

Add a short section before Phase 0 covering:

- exact seed/reset strategy
- required baseline employees/outlets/roles
- whether the run starts from a clean DB or from an existing dev DB
- naming convention for created entities
  - example: `SIM-Outlet-1`, `SIM-Cashier-1`, `SIM-iPhone-15`
- expected product stock starting values
- whether feature flags must be on or off before execution

Without this, repeat runs will become flaky because CRUD assertions depend on prior state.

---

### 4. Add an explicit business ledger for cross-checking

The plan asks reports and dashboard to "match Phase 3", but it does not define a canonical expected totals sheet.

Add a small "Expected Day Ledger" section with the exact values the simulation intends to generate:

- number of sales
- gross sales
- discounts
- tax collected
- refunds
- voids
- net sales
- cash sales
- card sales
- split-payment totals
- opening cash
- expected closing cash
- stock movement for 5-10 named products

This would make report validation much more concrete and less subjective.

---

## Important missing coverage

### 5. Add printer hardware-path validation, not only browser fallback

The current plan verifies receipt popup fallback, but the live system is hardware-first.

Add tests for:

- configured thermal printer path calls `/api/print/receipt`
- success path does not incorrectly fall back
- fallback path is graceful when printer is offline/unconfigured
- printer status/config screens reflect actual saved config

This is one of the more meaningful recent features and should be exercised directly.

---

### 6. Add negative-path email receipt tests

The plan covers the happy path for email receipts, but not the operational failure modes.

Add checks for:

- invalid email format
- SMTP not configured
- sale not found / bad sale id
- retry after config is fixed

That will make the simulation better at catching production-grade support issues.

---

### 7. Add context-enforcement checks as first-class simulation items

Because this app now depends heavily on branch context and injected headers, the plan should explicitly validate them.

Add tests for:

- request behavior before outlet selection
- direct navigation to protected pages without context
- outlet switch changes visible data
- multi-outlet reports with more than one outlet selected
- wrong-context leakage does not occur

The current plan checks some outlet behavior indirectly, but not the context model itself.

---

### 8. Add a true backup-and-restore round trip

Phase 16 currently behaves more like "backup download smoke test".

To make it complete, add:

- perform backup download
- mutate data after backup
- run restore
- verify restored dataset matches pre-mutation state
- verify backup log/history entry appears

That is the only way to validate restore, not just the page.

---

### 9. Add restart/resume resilience checks

For a full-day simulation, there should be at least a small resilience section covering:

- refresh dashboard mid-day
- close and reopen POS tab with shift still open
- re-login and confirm context recovery
- browser refresh after parked sale exists
- browser refresh during report navigation

These are realistic operator behaviors and often surface session/context bugs.

---

### 10. Add stricter assertions for cross-outlet reporting

The repo supports comma-separated / multi-select outlet reporting. The plan only checks single-outlet filtering.

Add:

- select two outlets together in reports
- verify aggregate totals equal outlet A + outlet B
- verify outlet ranking and dashboard comparison reflect multi-outlet data correctly

This is especially important because cross-outlet reporting is called out as a live feature.

---

## Areas that should be clarified in the document

### 11. Mark feature-flag-dependent phases more explicitly

Some parts are already labeled, but the execution plan should state the required flag state before each dependent phase.

Recommended additions:

- `multi_company`
- `backup_restore`
- `supplier_payables`
- `accounting_core`
- `crm_quotations`
- `advanced_hr`
- `reports_inventory_health_plus` if you want enhanced report coverage

This avoids ambiguous failures caused by disabled modules rather than broken modules.

---

### 12. Clarify what is expected vs what is only observed

Some items are currently phrased as "document whichever behavior happens". That is useful for discovery, but weak for audit quality.

Examples:

- zero-stock sale behavior
- unsupported promotion types
- reconciliation page "if page exists"

For each of these, decide whether the goal is:

- strict pass/fail validation, or
- exploratory observation

That distinction should be explicit in the plan.

---

### 13. Align migration references with current project state

Project docs are internally inconsistent:

- `CLAUDE.md` says latest migration is `migrate70.js`
- other parts of `CLAUDE.md` still refer to `migrate65.js` as the latest schema reference

For the simulation plan, the environment statement should consistently assume the March 7, 2026 state:

- latest applied migration: `migrate70.js`
- DB file: `backend/sanopos.db`

---

## Recommended additions by phase

### Add before Phase 0

- Simulation prerequisites
- seed/reset procedure
- feature-flag matrix
- expected business ledger
- artifact capture rules
  - screenshot on failure
  - network error capture
  - console error capture
  - download artifact naming

### Add to Phase 0

- verify auth session and context session objects after login
- verify protected page redirects before context selection
- verify `/api/feature-flags` only after authenticated context is established

### Add to Phase 1

- duplicate SKU behavior
- invalid image upload type/size behavior
- product import partial-success case
- category deletion blocked when category is in use

### Add to Phase 2 / 10

- duplicate shift-open blocked
- close shift with missing denomination/cash data blocked
- close already-closed shift rejected

### Add to Phase 3

- hardware printer success path
- invalid tender / insufficient cash handling
- duplicate checkout submission idempotency with stronger assertion
- receipt reprint from recent sales after refresh

### Add to Phase 4

- exchange blocked when no active shift
- exchange blocked when employee not clocked in
- partial exchange/refund totals verified against stock and cash impact

### Add to Phase 11 / 12

- multi-outlet aggregate checks
- empty-state handling for tabs with no data
- report tab deep-linking for more than one alias
- inventory-health-plus reports if the flag is enabled

### Add to Phase 16

- restore round trip
- post-restore smoke verification of login, dashboard, sales history

---

## Final recommendation

Do not rewrite the plan from scratch. Keep its current phase structure.

The highest-value next step is:

1. Correct the inaccurate routes/endpoints.
2. Add a pre-run deterministic data section.
3. Add an expected day ledger for numeric cross-checking.
4. Add printer, restore, context-enforcement, and multi-outlet aggregation coverage.

Once those are added, this becomes much more concrete and much safer to automate as a real Playwright master simulation.

# Phase 2 review — Operations + Phase 2B sub-wave

## Summary
- Files reviewed: 25 (of 59 — all high-risk paths per V1–V10 directives plus supporting evidence)
- Critical findings: 3
- High findings: 2
- Medium findings: 2
- Low/pattern findings: 2

---

## Critical findings

### C1 — draft_orders INSERT omits `order_context` column; v22 default is NOT null-safe for all columns
**File**: `backend/routes/draft-orders.js:86`
**Seam**: Cross-phase with Phase 4 (v22 ALTER TABLE)
**Finding**: The INSERT at line 86 lists only the 8 Phase 2 columns: `(outlet_id, customer_id, created_by, notes, subtotal, tax_total, discount_total, total)`. v22 adds `order_context TEXT DEFAULT 'retail'`, `table_id`, `table_session_id`, `tab_id`, `seat_count`, `dining_option`, and `source_token_id`. The `order_context` column has `DEFAULT 'retail'` in v22 (`migrate-pg.js:2036`), so INSERTs that omit it will correctly default to `'retail'`. However, `seat_count INTEGER DEFAULT 0` also has a default, whereas `table_id`, `table_session_id`, `tab_id`, `dining_option`, and `source_token_id` are nullable — those will be NULL which is correct. The structural INSERT omission is therefore safe at the DB level because of the v22 defaults. **The actual critical bug is in the `complete` endpoint (line 208–217):** it marks the draft as completed but returns the stale pre-update `draft` object (fetched before the UPDATE) rather than re-querying, so `draft.status` in the response is still `'claimed'` — clients see an inconsistent completed state.
**Reproduction**: POST `/api/draft-orders/:id/complete` with a valid claimed draft; check response body `draftOrder.status` — it will be `"claimed"` not `"completed"`.
**Evidence**:
```js
// line 200–217
const { rows: [draft] } = await db.query("SELECT * FROM draft_orders WHERE id = $1", [id]);
// ...
await db.query("UPDATE draft_orders SET status = 'completed'...WHERE id = $1", [id]);
// Returns the PRE-UPDATE draft object, not the updated one:
res.json({ completed: true, draftOrder: draft, items });
```

---

### C2 — `pos-authorize` endpoint has no feature flag gate and no `deleted_at` filter on employee PIN scan
**File**: `backend/routes/approval-policies.js:93`
**Seam**: In-phase
**Finding**: `POST /api/approvals/pos-authorize` (line 93) has no `requireFeature("phase2_pos_approvals")` middleware — it is reachable on any tenant regardless of whether the approval feature is enabled. Additionally, the PIN validation query (line 104–107) fetches ALL employees with `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code FROM employees e LEFT JOIN roles r` with no `WHERE` clause filtering out deleted employees (`deleted_at IS NULL`). A soft-deleted manager whose PIN is known can authorize POS overrides on any tenant.
**Reproduction**: (1) Disable `phase2_pos_approvals` for a tenant; POST to `/api/approvals/pos-authorize` — still executes. (2) Delete an employee (sets `deleted_at`); use their PIN at `/api/approvals/pos-authorize` — still grants approval.
**Evidence**:
```js
app.post("/api/approvals/pos-authorize", async (req, res) => { // no feat guard
  const { rows: employees } = await db.query(
    `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role
     FROM employees e
     LEFT JOIN roles r ON e.role_id = r.id` // no deleted_at IS NULL filter
  );
```

---

### C3 — Catalog scheduler worker: SQL injection via `field_name` from user-controlled DB column
**File**: `backend/boot/workers.js:232`
**Seam**: Cross-phase with pre-existing `products` / `product_variants` tables
**Finding**: The scheduled catalog worker (lines 231–234) builds update SQL by interpolating `change.field_name` directly into the SQL string: `UPDATE products SET ${change.field_name} = $1 WHERE id = $2`. `field_name` is a TEXT column in `scheduled_catalog_changes`, populated from user input in `POST /api/catalog/scheduled-changes` (routes/scheduled-changes.js:33). There is no server-side allowlist of permitted field names — only client-side validation. A user with `all_access` perm can POST `field_name = "price = 0; DROP TABLE products; --"` (or more practically, `field_name = "deleted_at"` to mass-soft-delete products). The injection executes in the background worker with full DB write access.
**Reproduction**: POST `/api/catalog/scheduled-changes` with `{"field_name": "deleted_at", "new_value": "NOW()", "entity_type": "product", "entity_id": 1, "change_type": "field_update", "scheduled_at": "<1min from now>"}`. When the worker fires, all products matching `id = 1` will have `deleted_at` set. With a crafted `field_name`, multi-statement injection is possible depending on PG driver settings.
**Evidence**:
```js
// workers.js:232
updateSql = `UPDATE products SET ${change.field_name} = $1 WHERE id = $2`;
// field_name comes directly from scheduled_catalog_changes.field_name (user-supplied)
```

---

## High findings

### H1 — `smart-collections` uses `p.created_at` field rule on `products` table which has no `created_at` column
**File**: `backend/routes/smart-collections.js:26`
**Seam**: Cross-phase with pre-existing `products` table schema
**Finding**: `buildRuleQuery()` maps the rule field `"created_at"` to column `p.created_at` (line 26). The `products` table in `schema-pg.sql` has no `created_at` column (confirmed — the table definition ends at `review_count` with no timestamp column). Any smart collection rule using `field: "created_at"` will produce a Postgres error `column p.created_at does not exist` at query time, silently breaking collection evaluation.
**Reproduction**: Create a smart collection with a rule `{field: "created_at", operator: "greater_than", value: "2024-01-01"}`, then GET `/api/smart-collections/:id` — returns 500.
**Evidence**: `schema-pg.sql` products table (lines 120–149) contains no `created_at` column. `smart-collections.js:26`: `case "created_at": col = "p.created_at"; break;`

---

### H2 — Report builder `buildQuery` ORDER BY on aggregate alias fails silently for customer_analysis dataset
**File**: `backend/routes/report-builder.js:136,145`
**Seam**: In-phase
**Finding**: When the `customers` dataset is used and `sortBy` references an alias of a column that is an aggregate (e.g., `"points_balance"` which is `SUM(c.loyalty_points)`), the `ORDER BY points_balance` fails in Postgres because the alias of an aggregate cannot be used in ORDER BY with the current query construction. This causes a 400 from the `try/catch` on line 175, silently swallowing the real SQL error.
**Reproduction**: POST `/api/reports/builder/run` with `dataset: "customer_analysis"`, `measures: ["points_balance"]`, `sort_by: "points_balance"` — returns 400 `{error: ...}` because `ORDER BY points_balance` on an aggregate alias fails in Postgres.
**Evidence**: `report-builder.js:80`: `points_balance: "SUM(c.loyalty_points)"` — aggregate alias used in ORDER BY line 145.

---

## Medium findings

### M1 — `approval_events` transaction atomicity gap: action is committed before approval is verified
**File**: `backend/routes/approval-policies.js:93`
**Seam**: In-phase (V5 verification)
**Finding**: The `pos-authorize` endpoint records the approval event but does NOT wrap the original action (discount/return/void) and the approval recording in a single transaction. The frontend POSContext.jsx calls `pos-authorize` first, gets an `approval_event` ID back, then submits the sale/return separately. If the sale POST fails after approval is recorded, the `approval_events` row exists with `status = 'approved'` but no corresponding sale — the audit trail falsely shows an approved action that never executed.

---

### M2 — `leave_requests` date comparison V3 verification clean
**File**: `backend/routes/schedules.js:139`
**Seam**: Cross-phase with pre-existing `leave_requests` table (V3 verification)
**Finding**: The fix from commit `73b1d0a` is in place and the pattern is safe. No bug here — this V3 seam is clean.

---

## Low / design drift patterns

### P1 — approval-policies.js uses inline `requireFeature()` calls per-route instead of shared `feat` constant
**Affected files**: `backend/routes/approval-policies.js` (lines 8, 32, 53, 78, 159)
**Description**: All other Phase 2 routes create a single `const feat = requireFeature("phase2_...")` at the top and reuse it. `approval-policies.js` calls it inline on every route handler. Additionally, `pos-authorize` has no gate at all (see C2).
**Why it matters**: One-off calls are easy to accidentally omit (as happened with `pos-authorize`).

---

### P2 — Phase 2 flags correctly seeded in v26, NOT in v19/v20 — confirmed
**Affected files**: `backend/migrate-pg.js` (v19, v20 sections; v26 section lines 2677–2692)
**Description**: Confirmed the map's finding. All 13 `phase2_*` flags are inserted in v26.

---

## Cross-phase observations
- `backend/routes/contracts.js:2` uses `require("../middleware/feature-flags")` direct import (Phase 4 pattern) rather than `deps.requireFeature` — different from all Phase 2 routes.
- `backend/routes/bookings.js:2` same Phase 4 direct-import pattern.
- `backend/boot/workers.js:255`: `global.__catalogSchedulerStatus` is initialized but `lastPollAt` is never updated within the interval loop — always shows `null` in worker-status.

---

## Seams verified clean
- V1 (draft_orders INSERT vs v22 columns): v22 defaults are correct; the structural concern is benign.
- V2 (feature flag import style): All Phase 2 route files correctly destructure `requireFeature` from `deps`.
- V3 (leave_requests date join): Fix from `73b1d0a` is in place.
- V7 (report builder governance runner / pg-boss): No pg-boss queues introduced in Phase 2.
- V10 (Phase 2 flags seeded where): Confirmed.
- V6 (commission calculator): correct FK handling.
- returns.js cross-phase shape: coexists correctly with Phase 1's `web_order_id`.

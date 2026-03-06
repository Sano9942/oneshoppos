# Design: Shift Report Attribution + PO Credit Limit Warning

**Date:** 2026-03-06
**Status:** Approved

---

## 1. Shift Reports — Switch from Time-Window to `shift_id`

### Problem

Five endpoints in `routes/reports/shifts.js` identify shift-scoped sales and returns via time-window matching:

```sql
WHERE outlet_id = ? AND timestamp >= opened_at AND timestamp <= COALESCE(closed_at, datetime('now'))
```

This is fragile: open shifts expand to `now`, boundary transactions are ambiguous, and overlapping shifts double-count. `shift_id` is now written to both tables at creation time (migrate63), making direct FK lookup possible.

### Affected Endpoints

| Endpoint | Tables |
|---|---|
| `GET /api/reports/cash-audit` | `sales`, `returns` |
| `GET /api/reports/shift-summary` | `sales`, `returns` |
| `GET /api/reports/shift-sales` | `sales` |
| `GET /api/reports/payment-summary` | `sales` |
| `GET /api/reports/current-session-zreport` | `sales` |

Not affected: `cash-flow` (queries `cash_shifts` only), `all-denominations` (already uses `shift_id`).

### Solution

Replace `shiftTimeWhere()` calls and their parameter arrays with `shift_id = ?` predicates. Remove the now-unused `shiftTimeWhere()` helper. `loadShift()` helper is retained — it loads shift metadata returned in every response.

**Backward compatibility:** `migrate63` backfilled all historical rows. Any row still without `shift_id` had no legitimate shift match under the old logic either, so it is acceptable to exclude them.

### Tests

New file: `backend/tests/integration/shift-report-attribution.test.js`

- Sale created in shift A does NOT appear in shift B's reports
- Return created in shift A does NOT appear in shift B's reports
- All 5 endpoints return correct counts/totals for the right shift

---

## 2. Supplier Credit Limit Warning on PO Creation

### Problem

`POST /api/purchase-orders` creates a PO against any supplier regardless of their credit limit. A credit supplier's `credit_limit` and `running_balance` are stored but never checked at PO creation time.

### Solution: Warn-but-allow

1. After validating items, look up the supplier's `payment_terms`, `credit_limit`, and current `running_balance` (same outstanding subquery as `GET /api/suppliers`)
2. If supplier is `credit` AND `credit_limit > 0` AND `(running_balance + total_cost) > credit_limit`:
   - Create the PO normally
   - Respond with `{ id, warning: "Credit limit exceeded. Outstanding: X, Limit: Y" }`
3. Otherwise respond with `{ id }` as today

Frontend `createPO()` in `PurchaseOrdersRedesign.jsx`:
- Check `data.warning` after successful POST
- If present: show yellow/amber notice banner with the warning text
- If absent: show normal green success notice

### Tests

New file: `backend/tests/integration/po-credit-limit.test.js`

- Cash supplier → no warning
- Credit supplier under limit → no warning
- Credit supplier over limit → 200 with `warning` field
- Credit supplier with `credit_limit = 0` (unlimited) → no warning

---

## Files to Change

### Backend
- `backend/routes/reports/shifts.js` — remove `shiftTimeWhere()`, rewrite 5 endpoint queries
- `backend/routes/purchase-orders.js` — add credit check before COMMIT in `POST /api/purchase-orders`
- `backend/tests/integration/shift-report-attribution.test.js` — new
- `backend/tests/integration/po-credit-limit.test.js` — new

### Frontend
- `frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx` — handle `data.warning` in `createPO()`

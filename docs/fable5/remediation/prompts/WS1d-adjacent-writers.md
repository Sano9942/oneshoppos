# WS1d — Adjacent money/stock writers `P0`

**Model:** Sonnet. **Branch:** `fix/ws1d-adjacent-writers` off `main`. Parallel-safe with WS1b/WS1c.

## Context
From `docs/fable5/core-research/01-CORE-SPINE.md` MEDIUM + `03-VERTICAL-CONNECTIVITY.md`. A cluster of
independent writers with double-write / semantic bugs.

## Verify first
Confirm each anchor on `main @ v126`. M9 touches customer-subscription dunning (NOT tenant billing) —
read `workers/subscription-grace-worker-boss.js` fully before editing.

## Task
- **M4** commission idempotency — `services/commission-calc.js:36-43` `insertEarning` is a bare INSERT.
  Both the POS auto-hook (`sales.js:2395`) and manual route (`commissions.js:228`) call it with no
  pre-delete. Add `ON CONFLICT (employee_id, sale_id) DO NOTHING` (or pre-delete for that sale) so a
  checkout auto-calc + later manager recalc can't double-pay.
- **M5** PO partial-receive — `purchase-orders.js:397-461`: don't force status→`'Received'` on a
  partial receipt (`:400`); keep the PO receivable for the remainder. Bill the received value, not full
  `po.total_cost` (`:478-495`), and move the supplier-invoice insert INSIDE the tx (it's currently a
  silent `try/catch {}` outside, `:491-498`).
- **M8** transfer-points ledger — `customers.js:953-962`: a *loyalty points* transfer writes two
  `customer_wallet_ledger` rows and no `loyalty_transactions` row. Write the loyalty ledger and adjust
  `customers.loyalty_points`; stop denominating points as wallet currency.
- **M9** dunning predicate — `subscription-grace-worker-boss.js:74-80`: the
  `EXISTS (SELECT 1 … WHERE ci.balance_due > 0 ORDER BY … LIMIT 1)` has a no-op ORDER BY/LIMIT — it's
  true if ANY past run was unpaid. Rewrite to test whether the LATEST run is unpaid, so a
  currently-paid subscriber isn't cut off.
- **V2** credit-override audit — `sales.js:1332-1336`: the `all_access` perm path bypasses a `hard`
  credit block with no `approval_events` row, while the manager-PIN path (`:1356-1372`) writes one.
  Log an approval/override event on the perm path too.
- **V3** document-only — add a code comment where `customers.balance` is read/written noting AR truth
  lives in `customer_invoices.balance_due`; `customers.balance` stays 0. No behavior change.

## Verify the fix
- Backend integration tests from `backend/` cwd; diff vs baseline.
- Add tests: double commission calc → single earning set; partial PO receive → PO still open + AP =
  received value; override on perm path → `approval_events` row written.

## Commit & push (REQUIRED)
Commit per fix, push `fix/ws1d-adjacent-writers`. No PR. Co-Authored-By trailer.

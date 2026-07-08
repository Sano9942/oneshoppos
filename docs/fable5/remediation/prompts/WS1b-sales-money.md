# WS1b — Sales money path hardening `P0`

**Model:** Sonnet. **Branch:** `fix/ws1b-sales-money` off `main`. Parallel-safe with WS1c/WS1d.
(If WS1a is also in flight, expect a merge touch-point in `sales.js` around the void path — coordinate.)

## Context
From `docs/fable5/core-research/01-CORE-SPINE.md` HIGH section. The POS sale total is client-trusted and
several money-equivalent tenders lack balance checks/locks.

## Verify first
Read each anchor on `main @ v126` and confirm the bug. Tax work: read `tax_architecture.md` memory +
`services/tax-snapshot.js` before touching — inclusive mode (PK/FBR default) is correct and must stay
correct; only exclusive mode is broken.

## Task (all in `routes/sales.js` unless noted)
- **H1** — route POS pricing through `resolvePriceForContext` (the server-side price-list cascade
  storefront/quote/field already use — `services/quote.js:173`, `field.js:78`). Today `:1181-1190`
  computes totals from client `item.price` with only `isFinite` (`:877`). Resolve price server-side
  from line id+qty+overrides; validate the client-asserted total within a small tolerance; reject
  mismatch.
- **H2** — add `taxTotalSnapshot` to `totalAmount` when `tax_mode='exclusive'` (`:1181` vs
  `tax-snapshot.js:181`). Leave inclusive mode untouched.
- **H3** — loyalty redemption (`:585,1189,2031-2035`): `SELECT … FOR UPDATE` the customer, assert
  `points_redeemed ≤ balance`, clamp `total ≥ 0`, introduce a configurable point value (not hardcoded
  1:1). Mirror the guard the admin path already has (`loyalty.js:145`).
- **H4** — wallet tender (`:1237-1247` read / `:2210-2222` debit): lock + re-check the customer row
  inside the tx (`AND balance ≥ amount`), matching how credit tender re-validates under `FOR UPDATE`
  (`:1937`).
- **L5** — enforce `Σ sale_payments ≥ total_amount` for cash/card/split, not just Credit
  (`:1271-1289`).

## Verify the fix
- Backend integration tests from `backend/` cwd; diff vs known-failing baseline.
- Add tests: crafted low total → rejected; exclusive-mode sale total includes tax; over-redeem points
  → rejected, balance never negative; concurrent wallet sales → no overspend.

## Commit & push (REQUIRED)
Commit per fix, push `fix/ws1b-sales-money`. No PR. Co-Authored-By trailer in each commit body.

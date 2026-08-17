# WS1c — Returns money path hardening `P0`

**Model:** Sonnet. **Branch:** `fix/ws1c-returns-money` off `main`. Parallel-safe with WS1b/WS1d.

## Context
From `docs/fable5/archive/core-research/01-CORE-SPINE.md`. Returns guard quantity but not refund AMOUNT, and
`store_credit` is a decorative no-op (store keeps goods AND money).

## Verify first
Confirm each anchor on `main @ v126`. Check `returns.js` refund-method handling end-to-end before
editing — `credit_reversal` and `card` are implemented; `store_credit` is advertised but unimplemented.

## Task (all in `routes/returns.js`)
- **H5** — cap refunds on create: enforce `refund_price ≤ sale_items.price` per line (`:493`) and
  `total_refund ≤ remaining refundable value` (`:458`). The correct figure already exists as
  `suggested_refund` in the check-eligibility preview (`:118-133`) — reuse that logic on create.
- **H6** — implement `store_credit` (`:43,84`) as a real wallet increment inside the return tx:
  update `customers.balance` + insert a `customer_wallet_ledger` row (mirror how the credit/card paths
  post at `:601/:653`). Today it records the return + restocks but credits nothing.
- **M2** — move the remaining-qty check (`:224-283`) inside the tx (opens `:447`) with a lock on the
  sale + prior returns, so two concurrent returns can't both pass. The partial unique index only blocks
  identical idempotency keys.

## Verify the fix
- Backend integration tests from `backend/` cwd; diff vs baseline.
- Add tests: `refund_price` above line price → rejected; `store_credit` return → wallet balance rises
  by exactly the refund; concurrent returns of the same line → cumulative refund never exceeds sold qty.

## Commit & push (REQUIRED)
Commit per fix, push `fix/ws1c-returns-money`. No PR. Co-Authored-By trailer.

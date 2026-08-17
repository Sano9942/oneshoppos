# WS1a — Shared stock helper + retrofit unlocked writers `P0`

**Model:** Sonnet. **Branch:** `fix/ws1a-stock-helper` off `main`. **Serial session** (retrofits depend
on the helper — do not parallelize internally).

## Context
From `docs/fable5/archive/core-research/01-CORE-SPINE.md`. The POS sale path was hardened (`FOR UPDATE`,
`WHERE quantity ≥ qty`, 3-table + batch ledger). Its sibling stock writers were NOT — they oversell
under concurrency and/or drift variant/batch tables. Fix them via ONE shared helper so new surfaces
can't drift again. See the stock-writer consistency table in that doc.

## Verify first (house rule)
Before changing anything, confirm current prod state — some of these are old known gaps that may be
partially addressed. Read each anchor and confirm the bug still exists on `main @ v126`. H7 specifically
is tracked in memory (`cross_surface_traps_plan01`) as STILL OPEN — confirm.

## Task
1. Build `decrementStock(client, { productId, variantId, outletId, qty })` and `incrementStock(...)` in
   a shared service (co-locate with existing stock logic; match the POS sale path's exact semantics):
   - `SELECT … FOR UPDATE` the stock row(s)
   - `WHERE quantity ≥ qty` availability gate (throw a typed insufficient-stock error otherwise)
   - write all 3 tables when a variant is present: `outlet_stock`, `variant_outlet_stock`,
     `product_variants.stock` (prefer `variant_outlet_stock` when present, matching `sales.js:1506`)
   - maintain the batch ledger (`stock_batches`) so `Σ batch.remaining = outlet_stock` holds
2. Retrofit these callers onto the helper (each must go through `deps.db.transaction`):
   - **H7** quotation-convert — `routes/tier4/crm.js:724-727` (remove the bare
     `UPDATE outlet_stock SET quantity = quantity − $1`; the code comment admits the gap)
   - **M3** inventory transfer — `routes/inventory.js:96-133`
   - **M6** supplier-return variant path — `routes/supplier-returns.js:92-102` (currently touches only
     `product_variants.stock`)
   - **M7** PO-receive + stock-count — `routes/purchase-orders.js:428-433`,
     `routes/inventory.js:599-621` (both ignore variant/batch)
   - **M1** void double-restore — `routes/sales.js:338-341,355-357`: add
     `AND (voided IS NULL OR voided = false)` to the in-tx `UPDATE sales SET voided=true` and guard the
     restore so two concurrent voids can't double-restore

## Verify the fix
- Run backend integration tests from `backend/` cwd (Vitest). Diff against the ~57 known pre-existing
  failures baseline — do not treat pre-existing red as a regression.
- Add/extend a concurrency test: two simultaneous decrements of the last unit → exactly one succeeds,
  the other gets insufficient-stock; no negative `outlet_stock`.
- Confirm variant + batch tables stay consistent after transfer/supplier-return/PO-receive.

## Commit & push (REQUIRED)
Commit each logical step, then push the branch. Do NOT open a PR (house rule — branch + push only).
End the commit message body with the Co-Authored-By trailer.
Suggested commits: `feat(inventory): shared decrementStock/incrementStock helper` then
`fix(inventory): route quotation-convert/transfer/supplier-return/PO-receive/void through stock helper`.

# Core Spine — POS/sales, inventory, CRM, HR, reporting, platform

Read-only audit, 2026-07-08, main @ v126. Three parallel Explore/audit agents traced the call paths;
findings cross-checked and deduped here. **Tenant isolation is clean** — no raw `db`/pool usage in any
transactional route; everything routes through the `deps.db` ALS proxy (grep-verified across sales,
returns, inventory, grn, purchase-orders, reports, customers, and services). Every bug below is
correctness / concurrency / money, not isolation. Findings only — nothing changed.

Severity: **HIGH** (money leak or negative-balance abuse reachable from a client) > **MEDIUM** >
**LOW**.

---

## HIGH

### H1 · POS sale total is client-trusted, never server-recomputed
`routes/sales.js:1181-1190` computes `subtotal`/`totalAmount` from client-supplied `item.price`; the
tax snapshot is fed the same client prices (`:1423`). The only line check is `isFinite(item.price)`
(`:877`). Per-line overrides are recorded for audit (`:900-960`) but never gated against catalog
price. **The sale's monetary total is whatever the POS client asserts.** POS also does not call
`resolvePriceForContext` (the server-side price-list cascade that storefront/quote/field DO use —
`services/quote.js:173`, `field.js:78`) — so POS and every other surface can price the same
product+customer differently (two pricing engines, no shared authority).
**Fix**: route POS pricing through `resolvePriceForContext`; send line IDs+qty+overrides, resolve
price server-side, validate the client total within tolerance.

### H2 · Tax-exclusive sales never add the tax to the total (revenue undercharge)
`routes/sales.js:1181-1190` vs `services/tax-snapshot.js:181`. `totalAmount = subtotal − discounts −
points`; `taxTotalSnapshot` is **never added**. In `tax_mode='exclusive'`, the snapshot returns
`subtotal = gross` with tax meant to sit on top — but it isn't added. A 100 + 17% GST sale stores
`tax_total=17, subtotal=100, total_amount=100` and charges 100. Inclusive mode (the PK/FBR default) is
correct, so blast radius is exclusive-mode tenants — but for them it's a books-integrity/revenue bug.
**Fix**: add `taxTotalSnapshot` to `totalAmount` when `tax_mode='exclusive'`.

### H3 · Loyalty `points_redeemed` — no balance check, unclamped, 1:1 as cash
`routes/sales.js:585` (from client body), `:1189-1190` (subtracted from total), `:2031-2035`
(`loyalty_points + earned − redeemed`, no guard, no `FOR UPDATE`). Nothing verifies the customer owns
those points; no total floor; hardcoded 1:1 value. Client posts `points_redeemed:100000` → total goes
≤ 0 (no `Math.max(0,…)`), goods leave free, balance goes negative. Concurrent redemptions both read
the old balance and both apply. The manual-adjust path (`loyalty.js:145`) and wallet transfer
(`customers.js:939`) both guard against negative — only the POS sale path doesn't.
**Fix**: `SELECT … FOR UPDATE` the customer, assert `points_redeemed ≤ balance`, clamp total ≥ 0,
introduce a configurable point value.

### H4 · Wallet tender is a TOCTOU race, debit unguarded
Balance read outside the tx without a lock (`sales.js:1237-1247`); debited unconditionally inside
(`:2210-2222`, `balance = COALESCE(balance,0) − walletTotal`, no re-read, no `AND balance ≥ amount`).
Two concurrent wallet sales both pass the pre-check and both debit → negative wallet / overspend.
Credit tender re-validates under `FOR UPDATE` (`:1937`) and gift cards lock the row (`:1877`); wallet
got neither.
**Fix**: lock + re-check the customer row inside the tx.

### H5 · Returns over-refund by AMOUNT is unvalidated
`routes/returns.js`: the only guard is quantity (`:224-283`). `total_refund` (`:458`) and per-line
`refund_price` (`:493`) come from the client and are never capped at `sale_items.price`. The correct
figure exists (`suggested_refund`, `:118-133`) but only in the `check-eligibility` preview, not on
create. Refund 1 unit that sold for 10 with `refund_price:10000` → money over-refunded to card
(`:664`) / AR reversal (`:622`) even though the quantity cap holds.
**Fix**: enforce `refund_price ≤ line price` and `total_refund ≤ remaining refundable value` on create.

### H6 · `store_credit` refund method is a decorative no-op
`returns.js` advertises `store_credit` (`:43,84`) but create only implements `credit_reversal`
(`:601`) and `card` (`:653`). **No `customers.balance` update, no `customer_wallet_ledger` insert.** A
store-credit return records the row and restocks, but the customer's wallet is never credited — the
store keeps the goods-value AND the money.
**Fix**: implement store_credit as a wallet increment inside the return tx.

### H7 · Quotation-convert oversells — unlocked, unchecked decrement
`routes/tier4/crm.js:724-727`: standard products decrement with a bare `UPDATE outlet_stock SET
quantity = quantity − $1` — no `FOR UPDATE`, no `WHERE quantity ≥ qty`. The code comment (`:694-715`)
admits this is "the documented completion-01 concurrency gap — NOT fixed here"; kits/batch items are
rejected, ordinary SKUs are not. The main sale path was hardened with `FOR UPDATE` (`sales.js:1506`);
this parallel writer was left open. Two concurrent conversions of the last unit both succeed → negative
stock.
**Fix**: same `FOR UPDATE` + availability gate as the sale path.

---

## MEDIUM

### M1 · Void double-restore race
`sales.js:338-341` reads `sale.voided` before the tx; the in-tx `UPDATE sales SET voided=true WHERE
id=$2` (`:355-357`) has no `AND (voided IS NULL OR voided=false)` guard. Two concurrent voids both
pass the pre-read, both restore stock + reverse the AR invoice + enqueue an FBR debit note → doubled
stock, two debit notes.

### M2 · Returns double-refund race
The remaining-qty check (`returns.js:224-283`) runs outside the tx (opens at `:447`) with no lock on
the sale or prior returns. Two concurrent returns with different/absent idempotency keys both pass and
both insert → cumulative refund exceeds sold qty. The partial unique index only blocks identical keys.

### M3 · Inventory transfer oversells
`inventory.js:96-133` checks availability outside the tx without `FOR UPDATE`; the tx decrements with
no lock, no `WHERE quantity ≥ qty`. A concurrent sale/transfer from the same source between check and
write drives `outlet_stock` negative.

### M4 · Commission earnings double-written (payroll double-pay)
`services/commission-calc.js:36-43` `insertEarning` is a bare INSERT — no `ON CONFLICT`, no
"already calculated for this sale". Both the POS auto-hook (`sales.js:2395`) and the manual route
(`commissions.js:228`) call it with no prior delete. A checkout auto-calc + a later manager
"recalculate" → a second full set of `commission_earnings` for the same (employee, sale). Void reversal
keys on `sale_id` and would reverse all duplicates, but non-voided sales stay double-credited.

### M5 · PO partial receipt closes the PO and over-bills the supplier
`purchase-orders.js:397-461`: status set to `'Received'` unconditionally (`:400`) even on a partial
receipt; only `'Approved'` POs are receivable (`:362`), so the remainder can never be received (no
back-order). The auto-created supplier invoice uses the full `po.total_cost` (`:478-495`), not the
received value — and is inserted **outside** the tx in a silent `try/catch {}` (`:491-498`), so a
throw leaves stock received with no payable. Receive 60 of 100 → PO closed, 40 orphaned, AP booked for
100.

### M6 · Supplier-return variant path drifts stock
`supplier-returns.js:92-102`: a variant line decrements **only** `product_variants.stock` — never
`variant_outlet_stock` or `outlet_stock`, no `FOR UPDATE`, no negative guard, no batch ledger. Every
other writer updates all three tables. Returning variant stock to a supplier corrupts per-outlet
quantities.

### M7 · PO-receive and stock-count ignore variants
PO-receive bumps only product-level `outlet_stock` (`purchase-orders.js:428-433`), never
`variant_outlet_stock`/`product_variants.stock`; since the sale gate prefers `variant_outlet_stock`
when present (`sales.js:1506`), variant stock received can be invisible to POS. Stock-count auto-adjust
(`inventory.js:599-621`) writes only `outlet_stock` — no variant/batch — silently desyncing a
variant/batch catalog on any cycle count.

### M8 · `transfer-points` writes the wallet ledger, not the loyalty ledger
`customers.js:953-962`: a *loyalty points* transfer inserts two `customer_wallet_ledger` rows and no
`loyalty_transactions` row. `customers.loyalty_points` and the loyalty audit trail permanently
disagree after any transfer; the wallet view renders point-denominated rows as currency.

### M9 · Subscription grace/dunning predicate is semantically wrong
`workers/subscription-grace-worker-boss.js:74-80`: `EXISTS (SELECT 1 … WHERE ci.balance_due > 0
ORDER BY … LIMIT 1)` — the ORDER BY/LIMIT inside EXISTS is a no-op, so it's true if *any* past run was
unpaid, not "the latest run is unpaid". A customer with one old unpaid invoice but current since is
still flagged active→past_due→expired, cutting off a paying subscriber. (Customer subscriptions, not
tenant billing.)

---

## LOW / hardening

- **L1 · Attendance "today" in UTC** (`attendance.js:390-391`) compared against locally-stored
  `session_start::date` — for off-server-TZ tenants near midnight, the open-session lookup misses and
  opens a duplicate check-in. Limited blast radius (PK-centric, server likely `Asia/Karachi`).
- **L2 · insights endpoints lack a permission guard** — `insights.js:5` (`/auto`) and
  `insights-ai.js:19` (`/ask`) have no `requirePerm`; any authenticated employee (incl. a Cashier with
  no `view_reports`) can read 30-day revenue/top-products directly or via the AI. AI daily cap is an
  in-memory `Map` (`insights-ai.js:1-13`) that resets on redeploy and isn't shared across instances.
- **L3 · Sale idempotency is check-then-insert** (`sales.js:1403-1413`) — a racing duplicate fails the
  whole tx with a raw 500 instead of the friendly 409 that `returns.js:736-762` returns; the pre-check
  `catch {}` swallows errors. Client may re-queue on the 500.
- **L4 · Non-variant sale decrement keys on `item.id`** (`sales.js:1832`) while the stock gate locked
  `original_product_id || id` (`:1548`) — divergent on exchange/remap lines.
- **L5 · Split/cash tenders don't enforce coverage** — only Credit checks `Σ payments ≥ total`
  (`sales.js:1271-1289`); cash/card/split store full `total_amount` regardless of what `sale_payments`
  sum to → reconciliation leak.
- **L6 · Batch ledger not maintained by several writers** — service-ticket part consumption
  (`service-tickets.js:485`), supplier returns, and stock conversions (`stock-conversions.js:145`)
  move `outlet_stock` without touching `stock_batches` → the `Σ batch.remaining = outlet_stock`
  invariant drifts for tracked SKUs (sales/transfers/adjustments/PO-receive/returns DO maintain it).
- **L7 · GRN scan-receive never moves stock** — `grn.js:85-243` updates `qty_received` + creates
  serials (status `available`) but touches no `outlet_stock`/batch. Stock only lands via the separate
  PO-receive path. If a workflow treats scan-receive as the stocking step, serials exist as available
  with no on-hand increment. Also allows over-receipt past `qty_ordered` (flags only, `:208`).
- **L8 · All money math is JS float** (`sales.js:1181-1190`) written to `NUMERIC(12,2)` (rounds on
  write) — intermediate percent-discount / inclusive-tax back-out can differ by a cent from a decimal
  engine.
- **L9 · Impersonation `/end` revoke is best-effort** — `admin/operations.js:~226-237` warns on failure
  inserting the `jti` into `revoked_tokens`; `loadTenantAndPerms` doesn't check
  `impersonation_sessions.revoked_at`, so a failed insert leaves the 1h JWT usable until expiry.
- **L10 · ABC nightly rollup off by default** — `boot/workers.js:309,470` gate on `ABC_WORKER_ENABLED`
  (default "0"); if unset in prod, stored `abc_rank` never refreshes (realtime reorder math still
  works). Verify the Railway env.
- **L11 · Dead migration-in-code** — `inventory.js:10-19` runs an `ALTER TABLE … ADD COLUMN` IIFE at
  module load against the proxy with no ALS context → caught/discarded; the real column is in
  `schema-pg.sql`. Looks load-bearing, isn't.

---

## Confirmed sound (checked, not defects)
Tenant isolation across sales/returns/inventory/reports (ALS proxy only, no raw pool). Portal IDOR:
every read constrained by `customer_id = req.customerId` (`customer-portal/data.js:255,284,303`);
both portal auths cross-check token `tid` vs resolved tenant. bcrypt(10) PIN/password with legacy
plaintext fallback. Loyalty *admin* adjust uses `FOR UPDATE` + guard. Messaging inbox real. Admin
impersonation IP-allowlisted + super-admin-gated + jti-revocable (modulo L9). `insights.js /auto`
computes real cards. Portal TTL "drift" (customer 30m / manufacturer 15m access, both 30d refresh) is
intentional, not a bug.

---

## Stock-writer consistency (the recurring "one surface hardened, sibling not" pattern)

| Writer | FOR UPDATE gate | Variant: all 3 tables | Batch ledger | Negative guard |
|---|---|---|---|---|
| POS sale | ✅ | ✅ | ✅ | via gate |
| Returns restock | n/a (incr) | ✅ | ✅ | n/a |
| Service-ticket part | ✅ | ✅ | ❌ | via gate |
| Stock conversion | ✅ | ✅ | ❌ | via gate |
| Web / storefront order | ✅ | ❌ | ✅ | via gate |
| Inventory transfer | ❌ | ✅ | ✅ | ❌ |
| Inventory adjustment | n/a | ✅ | ✅ | ❌ |
| Supplier return | ❌ | ❌ (only product_variants.stock) | ❌ | ❌ |
| PO receive | n/a | ❌ (only outlet_stock) | ✅ | n/a |
| Quotation convert | ❌ | ❌ | rejects tracked | ❌ |

The single highest-leverage refactor is a shared `decrementStock/incrementStock(client, …)` helper
(3-table + `FOR UPDATE` + `WHERE quantity ≥ qty` + batch ledger) so new surfaces can't drift.

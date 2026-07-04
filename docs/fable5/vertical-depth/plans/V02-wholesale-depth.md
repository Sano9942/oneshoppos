# V02 — Wholesale Depth (Backorders · Van Sales · POD)

**Covers:** findings [03-wholesale](../findings/03-wholesale.md) — the one structural P0 (backorders/partial fulfillment) plus van-sales and proof-of-delivery.
**Presets/modes:** `wholesale` — mode `wholesale` + `WHOLESALE_SEED_FLAGS`; new flags `wholesale_backorders`, `wholesale_van_sales` (default OFF, wholesale seeds ON at approval).
**Surfaces:** POS/on-account sales · storefront B2B reorder · portal · field PWA · fulfillment · admin
**Closes findings rows:** [03] "Backorders / partial fulfillment" (**P0**) · "Van-sales mode" (P1) · "Delivery-run management with proof-of-delivery" (P1 partial) · "Catch-weight" (P2) · "Retrospective rebates" (P2 — stays parked per findings note unless user unparks).
**Depends on:** completion plan 04 executed (proves the Tier 0–2 stack live first). F05 for status notifications (soft).
**Branch:** off `main` (backend-heavy); field-PWA + fulfillment UI touches ride `redesign/square` if its pages are tokenized by then, else `main` with reskin note.
**Model:** **Fable, effort high.** Backorders rewrite the "no partial fulfillment" invariant baked into `services/reservation.js` + `services/allocation.js` (both 400 on shortfall — findings [03] evidence); getting partial-allocation + credit + AR interactions right is genuine design work. Van sales adds a stock-location concept. Apply [[feedback_audit_ledger_before_building]] before touching AR-adjacent flows.

---

## Tasks

### P0 — backorders / partial fulfillment
1. **Schema (pause-list):**
```sql
CREATE TABLE backorders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('sale','web_order','field_order')),
  source_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  outlet_id INTEGER REFERENCES outlets(id),
  qty_ordered NUMERIC(12,4) NOT NULL,
  qty_fulfilled NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL,          -- price honored at fulfillment (snapshot)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','fulfilled','cancelled')),
  expected_at DATE, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
2. **Order-taking behavior** — on shortfall, offer "fulfill available + backorder remainder" instead of hard 400/oversell: `routes/sales.js` (`insufficient_stock` branch :2068 — POS + field-rep), `services/reservation.js`/`storefront-cart` checkout (storefront/portal), `services/allocation.js` (ship orders). Sale invoices ONLY the fulfilled qty; backorder rows carry the remainder at snapshot price. Credit-limit check counts fulfilled amount only (backorder is not yet AR — state this rule in code).
3. **Fulfillment loop** — "Backorders" screen (filter by product/customer/age); GRN receipt → match against open backorders for that product (suggest allocation, oldest-first) → one-click convert to a new sale/invoice line (through the standard sale path: stock lock, tax snapshot, AR) → notify customer (F05). Partial receipts partially fulfill (status `partial`).
4. **Visibility** — customer statement/portal shows open backorders; reports: open-backorder value by product (feeds purchasing).

### P1 — van sales
5. **Van as stock location** — lightweight: vans are `outlets` of a new `outlet_type='van'` (one column on outlets, pause-list) → ALL stock machinery (outlet_stock, transfers, FOR UPDATE decrements, reports) works unmodified. Load-out = transfer depot→van; van sale = field-PWA sale with `outlet_id`=van; end-of-day = reconciliation screen: expected (load-out − sales) vs counted, variance → adjustment with reason + cash reconciliation vs collected payments. Blocked-by-check: plan-limits `requirePlanLimit("outlets")` counts vans — decide exemption at approval.
6. **Field PWA additions** — "Van stock" view (rep sees own van's stock), sell-from-van flow (existing order capture posts to `/api/sales` — set outlet to van + immediate fulfillment instead of order-booking), day-end reconcile screen (manager confirms).
7. **Proof of delivery** — loadsheet dispatch (`routes/fulfillment.js`) gains per-stop POD: photo/signature capture (reuse field.js selfie→R2 pipeline :168-175 + upload-validation) + receiver name; delivery-run screen marks delivered/failed per stop; failed → return-to-stock flow.

### P2
8. Catch-weight (order by case, invoice by actual kg): dual-qty on `sale_items` (`ordered_qty`/`ordered_unit`) — only if a meat/produce distributor asks; park like rebates.
9. Backorder auto-cancel policy (age threshold + notification).

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Shortfall detection points | `services/reservation.js` (:14-159, 400-on-shortfall), `services/allocation.js` (:22-92), sales.js `insufficient_stock` :2068 | grep this session + findings [03] |
| Photo capture → R2 | `routes/field.js` selfie flow | :168-175 |
| Dispatch/loadsheets | `routes/fulfillment.js` picklists/loadsheets/tracking events | findings [03] built rows |
| Van stock | `outlets` + `outlet_stock` + transfers (unchanged machinery) | design choice above |
| Statement integration | `customer-invoices` AR + statements stack | findings [03] Tier 0 rows |
| Fulfillment notify | F05 engine | plans/F05 |

## Harden what's built
- **P0 — credit-limit check race.** `routes/sales.js:1097` reads `credit_limit`/outstanding with a plain SELECT (no FOR UPDATE on the customer row), then inserts. Failure: two branch cashiers ring on-account sales for the same distributor customer simultaneously; each sees Rs 90k outstanding against a 100k limit, both proceed → 110k+ exposure past a hard `credit_block_mode='block'`. Fix: lock the customer row (`SELECT … FOR UPDATE`) for on-account sales inside the sale transaction. Must also cover the other on-account writers (quotation-convert invoices, batch invoicing — grep `credit_limit` across routes/services at execution per [[feedback_parallel_paths]]).
- **P1 — geofence check-in failure mode.** `routes/field.js` skips selfie upload silently on failure (documented :168) — fine — but verify the geofence *distance* failure path flags rather than blocks (a rep with GPS drift shouldn't be locked out of order capture; findings say flag-only — confirm live).
- **P1 — statement completeness after backorders.** Backorder conversion creates sales through the standard path; run the ledger audit (Σ invoices − Σ payments = balance) on the test tenant after the walkthrough — the Tier 0.4 "Reduce A/R" class of gap ([[feedback_audit_ledger_before_building]]) is exactly what a new sale-creating path can reintroduce.
- **P2 — MOQ vs partial fulfillment.** `services/moq.js` validates ordered qty; a partial fulfillment below MOQ is legitimate (the ORDER met MOQ). Assert fulfillment conversion bypasses MOQ re-validation.

## Cross-surface lens
- **Stock:** backorder offer must appear on ALL FOUR order-taking surfaces (POS, storefront checkout, portal reorder, field PWA) — one service decision point, not four implementations.
- **Pricing:** backorder honors snapshot price even if price lists changed — state on the fulfillment screen. Note the portal/storefront pricing fork is completion-01's OPEN item; backorder pricing snapshots at order time, sidestepping it, but conversion-time re-pricing must NOT occur.
- **Tax:** fulfillment conversion goes through `tax-snapshot.js` at conversion time with the snapshot price.
- **AR/credit:** rules stated in tasks 2; statements show backorders as memo (not AR).
- **Notifications:** backorder created / stock-arrived / delivered (POD) via F05.

## Verification bar
- Test tenant: [[wholesale_test_tenant]].
- Walkthrough: order 100 with 60 in stock on each of the four surfaces → 60 invoiced + 40 backordered each time; GRN 50 → fulfill screen suggests oldest-first → convert → invoice correct (price snapshot, tax, AR) → customer notified; statement reconciles (ledger audit); van: create van outlet → load-out 20 items → field rep sells 5 from van → day-end reconcile shows 15 expected, count 14 → variance adjustment; POD: dispatch run → per-stop signature+photo → delivered stamps on tracking events.
- Concurrency: two simultaneous on-account sales exceeding the credit limit jointly — second one blocks (post-fix).
- Empty states: backorders screen empty; reconcile with zero sales.

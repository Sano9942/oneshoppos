# One Toy Store pilot: progress

**Goal:** One Toy Store (Packages Mall, Lahore) becomes SanoPOS's first real merchant. SanoPOS replaces iPOS.NET at the counter, and shop stock and Shopify stock stay in sync automatically. Along the way, we **prove with evidence** that SanoPOS works correctly.

**Scope freeze:** retail core only (selling, returns, purchasing, stock, cash closing, reports, Shopify sync) plus whatever One Toy Store specifically needs. No new verticals, redesigns or unrelated features. FBR stays off.

**Branch:** `onetoystore-pilot`

## Ground rules

1. Never connect SanoPOS to `one-toy-store-dev.myshopify.com`. **That is the LIVE store** (onetoystore.com), despite the name. All Shopify testing happens on a separate development store the owner provides.
2. No production data, real tenants or deploys without asking first. Work locally (`sanopos_dev` / `sanopos_test` on localhost) or on a throwaway tenant.
3. Verify, don't assume. Source wins over docs.
4. Every fix ships with a test that fails before the fix and passes after.
5. Follow the repo's `CLAUDE.md` conventions.
6. Plain English for the owner: does it work, yes or no, and how do we know.

---

## Plan

| Phase | What | Status |
|---|---|---|
| **A** | Prove the retail core works: (1) test-suite baseline, (2) shop-day acceptance script that checks the numbers at every step, (3) scorecard | 🟡 in progress |
| **B** | Fix the 3 blockers: fulfilment trigger, absolute initial alignment + drift check, offline queue proof | ⏳ |
| **C** | Shopify sync on a TEST development store: repeatable checklist | ⏳ needs dev store from owner |
| **D** | iPOS item file → SanoPOS CSV converter, dry run into a test tenant | ⏳ needs the full iPOS item file export |
| **E** | In-shop checklist: printer, scanner, label printer, speed, offline, cash closing, real delivery | ⏳ |
| **F** | 2-week parallel run with a nightly comparison, then switch on owner's go-ahead | ⏳ |

---

## Blocker verification (against source, 2026-09-25)

All three blockers are **real**. Blockers 1 and 2 are **worse** than the readiness check said, because it only read the stock-trigger function, not the path an order takes to reach it.

### Blocker 1: online COD orders don't reduce shop stock. REAL, plus 5 more problems on the same path

| # | Finding | Evidence |
|---|---|---|
| 1a | Stock is reduced only when payment is `paid` / `partially_paid` / `authorized`. COD orders stay `pending`, so they never reduce stock. | `backend/shopify/order-service.js:10-16` |
| 1b | **Shopify cannot reach the webhook at all.** The order webhook is mounted *after* the tenant login wall, so Shopify's call (which carries no SanoPOS login) gets `401 AUTH_REQUIRED` before the signature check runs. Even with the COD fix, no online order would arrive automatically. Even if it got through, nothing maps Shopify's shop domain to a SanoPOS tenant. | `routes/registerAllRoutes.js:236-239` (auth wall) vs `:662` (Shopify mount); `middleware/tenant-auth.js:265-274`. The July architecture audit found the same issue; it is still unfixed. |
| 1c | Only **one** webhook endpoint exists (`orders-create`). The setup screen tells you to point `orders/create`, `orders/updated`, `orders/cancelled` and `refunds/create` at it. Webhooks are not registered automatically; staff would paste them into Shopify admin by hand. | `routes/shopify/webhooks.js:10`, `routes/shopify/health.js:206-218` |
| 1d | **Cancellations are never recorded.** `order_status` is written as `'open'` on insert and never updated from Shopify's `cancelled_at`, so the "reverse on cancel" branch can't fire from order status. Reversal only works if payment moves to `refunded`/`voided`. | `order-service.js:234-247` |
| 1e | **Online order lines usually won't match a SanoPOS product.** Matching tries `product_variants.sku`, then barcode, but Shopify order lines carry no barcode, and plain products (no variants) are never matched by SKU. The Shopify product map (`shopify_product_map`), which already links items, is not used. The failure is swallowed: the order saves and the webhook replies "success", but stock never moves. | `order-service.js:54-107, 166-173, 297-301` |
| 1f | The online-order stock change writes `outlet_stock` directly: no row lock, no stock-movement record, and it ignores variant stock. Every other stock writer goes through `services/stock-ledger.js`. | `order-service.js:175-184` |

### Blocker 2: sync sends +/− changes, not absolute counts. REAL; no "set Shopify to SanoPOS" exists

| # | Finding | Evidence |
|---|---|---|
| 2a | Outbound sync only ever uses `inventoryAdjustQuantities` (delta). There is no absolute set anywhere in the code. | `shopify/client.js:153-180`; no `inventorySetQuantities` / `inventorySetOnHandQuantities` in repo |
| 2b | `POST /sync/push-inventory` is **not** an absolute push: it takes delta rows from the caller. It also **never responds**: it passes a callback to an `async` function that never calls it, so the HTTP request hangs. `POST /sync/process` has the same bug. | `routes/shopify/sync.js:152-243` vs `routes/orders.js:763, 909` |
| 2c | The reconciliation screen's "POS wins" fix **does nothing**. It marks rows "resolved", and a code comment claims "Shopify sync will push POS values", which is false. Only "Shopify wins" changes anything, and that overwrites SanoPOS stock (the opposite of what OTS needs). | `routes/shopify/reconciliation.js:313-328` |
| 2d | Reconciliation compares Shopify with **product-level** stock only. Variant stock is ignored, so every Hot Wheels variant would compare against the total for all cars. A Shopify item it can't read counts as 0. | `reconciliation.js:88-103, 134-136` |
| 2e | No periodic drift check. Reconciliation only runs when someone presses the button. | no worker in `boot/workers.js` |
| 2f | **Partial purchase receipts lose their Shopify update.** The sync de-duplication key uses the PO number, not the GRN number, so the 2nd delivery against the same PO is silently dropped as a "duplicate". Stock transfers use no reference at all, so after the first transfer of an item, later ones are dropped. | `routes/purchase-orders.js:523-535`, `routes/inventory.js:187-198`, key built at `routes/orders.js:808-816` |

### Blocker 3: cloud-only counter. REAL, and bigger than "untested"

| # | Finding | Evidence |
|---|---|---|
| 3a | The offline queue covers **only the checkout step**. Scanning a barcode, searching or opening variants all call the server, so with the internet down the cashier **can't put an item in the cart**, except items already on screen from a search done before the outage. | `POSContext.jsx:897`, `POSOmniInput.jsx:82`, `useCart.js:181` |
| 3b | The service worker caches the app shell, so a page reload while offline should still open the app (to be proven). | `frontend/public/sw.js` |
| 3c | Queued sales carry an `idempotency_key`, and there is a unique DB index on `sales.idempotency_key`, so a duplicate replay should be rejected (to be proven). The duplicate check runs *before* the transaction, so the unique index is the real guard. | `routes/sales.js:1694-1704`; `schema-pg.sql:2032` |

**Plain English:** the offline safety net exists but only catches the last step. For One Toy Store we need the POS to be able to **find products while offline**, which means keeping a copy of the catalogue (~10k items) in the browser. That is a design decision for the owner (see Decisions log).

---

## Retail core scorecard

**How it's measured:** `tools/onetoystore-pilot/shop-day.mjs` creates a brand-new throwaway shop in the **local** database and plays a full day through the **real** server: 20 products (2 with variants), 5 purchase orders with partial deliveries, 13 bills, returns, an exchange, a supplier return, an adjustment, a transfer, a till open/close and a stock count. It keeps its own independent ledger of what every number *should* be, then runs ~105 checks. To run it, start the backend (`node backend/index.js`; the banner must say LOCAL DB), then `node tools/onetoystore-pilot/shop-day.mjs --dump`.

**First full run (2026-09-25, before any fixes): 76 checks pass, 29 fail.** The 29 failures trace back to **about 14 distinct bugs** (D1–D15 below). The basic "ring up a bill and take the money" path works. The bugs are in purchasing, variants, cash closing, stock counts and reports.

**After the first round of fixes (same day): 106 pass, 1 fails.** The one left is D6 (stock count wipes uncounted items), which waits on an owner decision. Every fix has a regression test in `backend/tests/integration/ots-retail-core.test.js` (22 tests), each shown to fail before its fix. The two POS-screen fixes (D5 variant scan, D18 resume prompt) were also proven in the real POS screen in a browser; screenshots are in `tools/onetoystore-pilot/out/` (not committed).

> The tables below are the **first-run** picture. For current status, go by the Defect list at the bottom.

Legend: ✅ works (proven by a check that ran) · 🔴 broken · 🛠️ fixed (test proves it) · ⬜ untested · 🟡 works, but differently from iPOS or needs a setting

### Selling
| Feature | Status | Evidence / defect |
|---|---|---|
| Cash sale, card sale, split cash+card sale | ✅ | totals stored correctly |
| Bill discount (10%) and fixed Rs discount | ✅ | stored total = subtotal − discount |
| Item discount (price override) | ✅ | |
| Park a bill, resume it, pay | ✅ | but the resumed bill is booked at **Rs 0 cost** → D2 |
| Void a whole bill | ✅ | stock returns, drops out of sales totals |
| Selling more than is on hand is refused | ✅ | |
| Payment short of the total is refused | ✅ | |
| Same bill sent twice (network retry / offline replay) → only one bill | ✅ | idempotency key returns the original bill |
| Customer pays more and gets change | 🔴 | **D3**: change is booked as cash taken |
| Selling a variant (e.g. one Hot Wheels car) created with opening stock | 🔴 | **D4**: 1st sale OK, 2nd refused "available −1" |
| Scanning a variant's own barcode | 🔴 | **D5**: "not found" |
| Cashier must clock in (PIN) before the till will sell | 🟡 | by design; staff need to know |
| Refund above Rs 5,000 needs a manager PIN | 🟡 | by design (risk controls); threshold is configurable |

### Returns
| Feature | Status | Evidence / defect |
|---|---|---|
| Return with card refund; return with cash refund | ✅ | stock goes back |
| Exchange (return + new bill) | ✅ | |
| Returning more than was bought is refused | ✅ | |

### Purchasing and suppliers
| Feature | Status | Evidence / defect |
|---|---|---|
| Create PO | ✅ | |
| **Approve a PO from the PO screen** | 🔴 | **D1**: fails for every shop |
| Receive a partial delivery, then the rest | ✅ | PO stays open until complete; stock right |
| Receiving more than was ordered | 🔴 | **D8**: accepted; the screen pre-fills the full qty again on the 2nd delivery |
| Cost after a new purchase | 🟡 | latest purchase price, not weighted average (Rubik's: 800 then 900 → 900; average would be 850) |
| Supplier ledger balance = value received − paid − returned | ✅ | |
| Pay a supplier | 🟡 | **D13**: only against one delivery's invoice at a time, not "on account" as in iPOS |
| Supplier return reduces stock and supplier balance | ✅ | in the ledger, but the payables report ignores it → D12 |
| Variant stock via a PO | 🔴 | PO lines are product-level only, so an individual Hot Wheels car can't be bought on a PO (the test used an adjustment instead) |

### Stock
| Feature | Status | Evidence / defect |
|---|---|---|
| On-hand = opening + received − sold + returned ± adjustments, every simple item | ✅ | |
| Stock adjustment (damaged) | ✅ | |
| Transfer to a 2nd location | ✅ | |
| On-hand / stock value for variant items | 🔴 | **D4**: shows 0 |
| **Stock count of one shelf** | 🔴 | **D6**: "auto-adjust" set **every product not scanned to zero** (17 products wiped in the test) |
| Scanning the same item repeatedly in a count | 🔴 | **D7**: one duplicate line per scan instead of adding up |
| Scanning a variant barcode in a count | 🔴 | **D5** |

### Till (cash closing)
| Feature | Status | Evidence / defect |
|---|---|---|
| Open with float + denominations; close | ✅ | |
| Expected cash = float + cash sales − cash refunds | 🔴 | **D3**: off by exactly the change given (Rs 50 in the test) → a false shortage every day |

### Reports
| Report | Status | Evidence / defect |
|---|---|---|
| Sales summary total and bill count = the bills | ✅ | |
| Sales summary cash/card split | 🔴 | **D9**: a split bill is divided 50/50, not by what was actually paid |
| Order-wise (bill list, discounts) | ✅ | |
| Item-wise, category-wise, brand-wise: per line = the bills | ✅ | totals are **before** bill discounts, so they sum to more than the sales summary by exactly the discounts. Sales-detail spreads discounts over lines. 🟡 need to know which way iPOS reports it |
| Supplier-wise | 🟡 | this is **purchases** by supplier, not sales by supplier. Sales by supplier is only a column on item-wise |
| Cashier-wise; refunds & voids | ✅ | |
| Dashboard: bill count, refunds, discounts | ✅ | |
| Dashboard: today's sales, average bill, cash in Z-report | 🔴 | **D3** (change counted as sales) |
| Dashboard gross profit | 🔴 | **D10**: ignores bill discounts; also **D2** (Rs 0 cost lines) |
| Gross margin reports | 🔴 | off by default (**D15**: Business Modules → Advanced Reports). When on: **D10** counts a bill's discount once per line; **D2** |
| Stock value at cost, inventory dump, shrinkage | ✅ | simple items; variants → D4 |
| Total purchases / item-wise purchases | 🔴 | **D11**: ordered qty & value double-counted when a PO arrives in 2 deliveries |
| Payables (owed to suppliers) | 🔴 | **D12**: ignores supplier returns; disagrees with the supplier ledger |
| New shop starts with 5 "(Sample)" products at 100 units, cost 0 | 🔴 | **D14**: pollutes stock value and low-stock lists |

### Defect list

| # | Severity | Defect | Status |
|---|---|---|---|
| D1 | 🔴 | PO "Approve" fails for every shop: the approvals module registers the same URL earlier and intercepts it (`routes/tier4/approvals.js:62` shadows `routes/purchase-orders.js:318`) | 🛠️ fixed: approvals handler only claims requests carrying `action` |
| D2 | 🔴 | Sale cost is taken from the POS screen, not the database. Bills resumed from "parked" (and any path that rebuilds the cart) are booked at Rs 0 cost → inflated margin (`routes/sales.js:1946`) | 🛠️ fixed: cost read from product/variant in the DB at sale time |
| D3 | 🔴 | Cash change booked as cash taken (tendered amount stored in `sale_payments`) → the till "expects" the change (false shortage); dashboard sales, payment mix and Z-report cash overstated | 🛠️ fixed: change taken off the cash tender before storing (tips kept). Also: till close now uses the DB clock (a sale in the same second as the close was left out) |
| D4 | 🔴 | Variant opening stock is written only to `product_variants.stock`; per-outlet rows aren't created → 2nd sale refused, on-hand/stock value show 0 | 🛠️ fixed: opening stock goes through the shared stock ledger (all three tables) |
| D5 | 🔴 | Barcode scan (POS and stock count) doesn't look up variant barcodes | 🛠️ fixed: server + all 3 POS scan inputs; proven in the real POS screen |
| D6 | 🔴 | Stock count auto-adjust zeroes every product not scanned | open, **needs owner decision** |
| D7 | 🟠 | Stock-count scan creates a duplicate line per scan (`ON CONFLICT` never fires when `variant_id` is NULL) | 🛠️ fixed |
| D8 | 🟠 | Receiving can exceed the ordered qty; GRN dialog pre-fills the full ordered qty on later deliveries | 🛠️ fixed: server refuses over-receipt; dialog pre-fills the outstanding qty. Also: the Shopify sync for a 2nd delivery is now keyed by GRN (was silently dropped, blocker 2f) |
| D9 | 🟠 | Sales summary splits split-tender bills equally between methods | 🛠️ fixed: split by what was actually paid |
| D10 | 🟠 | Profit summary sums a bill's discount once per line; dashboard gross profit ignores bill discounts | 🛠️ fixed (both) |
| D11 | 🟠 | Purchase reports double-count ordered qty/value for POs with more than one delivery | 🛠️ fixed |
| D12 | 🟡 | Payables report ignores supplier returns (and counted voided supplier payments as paid) | 🛠️ fixed: returns shown as credit lines; voided payments excluded |
| D13 | 🟡 | Supplier payment only per delivery invoice, not on account | open, owner decision |
| D14 | 🟡 | Retail setup seeds 5 sample products with stock | open, owner decision |
| D15 | 🟡 | Margin reports off by default for retail | config: turn on "Advanced Reports" for OTS |
| D16 | 🟠 | A supplier invoice paid in two instalments stays "partial" forever (text + number concatenation in `routes/grn.js`) | 🛠️ fixed |
| D17 | 🟡 | Profit reports (profit summary, dashboard) don't subtract returns: a returned item's profit still counts | open, owner decision: how does iPOS report it? |
| D18 | 🟠 | After every completed sale, the POS offers to "Resume previous cart?", i.e. the cart just paid for. Clicking Resume re-rings it (double-sale trap) | 🛠️ fixed; proven in the real POS screen (fails before, passes after) |
| D19 | 🟡 | Scanning a variant runs the modifier lookup with the variant id as a product id (harmless 403 today; pre-existing pattern shared with the variant picker) | open, low |

---

## Test suite baseline (Phase A step 1), 2026-09-25

| Suite | Result | Notes |
|---|---|---|
| Backend unit | **749 / 752 pass** (55/57 files) | 3 failures, none retail: worker-status test expects the marketplace-sync worker "running" (that worker is a known stub); 2 payment-gateway `isEnabled()` env tests |
| Frontend unit | **201 / 201 pass** (25 files) | `npx vitest run` with no path also picks up 54 Playwright browser specs, which "fail" because Vitest can't run them. Not real failures. Run `npx vitest run tests/unit`. |
| Backend integration | **1,801 pass, 26 fail, 29 skipped** (155 of 202 files pass) | **33 files can't load at all** (30 import a deleted helper `tests/helpers/createTestApp`; 3 use Jest syntax). Those 33 include the dedicated retail tests: `purchase-orders`, `returns-exchange`, `shifts`, `shift-linkage`, `supplier-payables`, `reports_accuracy`, `inventory`, `promotions`. **So most of the retail core had no running test.** The 26 failures are the same 12 files already triaged in July as stale test fixtures (e.g. sales tests written before a sale needed an open till); none are new. |
| Backend integration, **after the 13 fixes** (re-run 2026-09-26) | **1,823 pass, 26 fail, 29 skipped** | Compared test-by-test against the baseline: **0 new failures**, 0 disappeared, the same 26 failing. The +22 are the new `ots-retail-core` regression tests, all passing. |

---

## Decisions log

| Date | Decision | Who | Why |
|---|---|---|---|
| 2026-09-25 | Work on branch `onetoystore-pilot`, push only, no PR unless asked | repo convention | |
| 2026-09-25 | Acceptance script runs against the **real** backend (`index.js`, multi-tenant mode) on local Postgres, with a fresh throwaway tenant each run, not against the test harness's re-implemented middleware | Claude | The test harness (`tests/helpers/createTestApp-pg.js`) re-implements auth/permissions, so it can't prove the real server works |
| 2026-09-25 | Margin reports' cost = the cost recorded **on each sale line at the moment of sale** (now read from the DB, D2). The product's cost itself = **latest purchase price** | code as-is | iPOS may use weighted average; see open question |
| 2026-09-26 | Stock count (D6): items not scanned are **left alone** by default; an explicit "full count: zero everything not counted" tick box does the wall-to-wall version | **Owner** | Shelf-by-shelf counting at 10k items |
| 2026-09-26 | Offline: **yes**, keep a catalogue copy (names, barcodes, prices; not stock) in the counter's browser so scanning and search work offline; sales queue and replay | **Owner** | Blocker 3 |
| 2026-09-26 | Cost method: OTS prices **cost-plus a fixed margin that differs by category/brand**. Keep cost = latest purchase price. When a delivery arrives at a different cost, SanoPOS **suggests** the new selling price (cost × (1 + margin), rounded to the **nearest Rs 50**); the owner confirms per item, and repriced items are flagged for label reprint. Not automatic | **Owner** | Matches how OTS prices today. Needs a margin % per category/brand, to be collected |
| 2026-09-26 | Profit reports **subtract returns** (D17): a returned item's profit comes back out | **Owner** | Profit should match money kept |
| 2026-09-26 | Shopify dev store: **later**. Phase B starts locally; Shopify-facing parts are tested on a dev store afterwards | **Owner** | |

# One Toy Store pilot: progress

**Goal:** One Toy Store (Packages Mall, Lahore) becomes SanoPOS's first real merchant. SanoPOS replaces iPOS.NET at the counter, and shop stock and Shopify stock stay in sync automatically. Along the way, we **prove with evidence** that SanoPOS works correctly.

**Scope freeze:** retail core only (selling, returns, purchasing, stock, cash closing, reports, Shopify sync) plus whatever One Toy Store specifically needs. No new verticals, redesigns or unrelated features. FBR stays off.

**Branch:** `onetoystore-pilot`

## ▶ Where we are / next (updated 2026-09-29)

**2026-09-29 (end of session, ~16:00): LIVE DUAL-RUN STARTED.** Real iPOS import done + checked on prod (10,044 items, totals exact). Counter PC set up (Chrome, scanner, thermal printer via Chrome print box, kiosk clock-in, shift 1 opened 13:51 float Rs 32,870). Every sale is rung in **both** iPOS and SanoPOS. By 15:53: **11 real bills, Rs 58,860 = Cash 13,920 + Card 44,940**, one exchange. New iPOS-style receipt (D45) + scannable barcode (D49) **deployed** (main `a62b155d`); prod receipt template set. Details under "Go-live on prod" → "Counter PC (step 8)".

**2026-09-29 night: day 1 closed and reconciled** (cash exact, card +40 = D48, bank settlement 94,650 + online transfer 1,290 = iPOS card; drawer Rs 130 or 420 over after Rs 10,470 register expenses, not settled). New defects D50 (till expenses), D51 (no day slip), D52 (no online-transfer tender). ✅ **Phase F plan written: [`PHASE-F-PLAN.md`](PHASE-F-PLAN.md)**: daily dual-run routine, 9 "ready to drop iPOS" rules (incl. **R7 backups: prod is on Supabase Free with none**), fixes F1 D48 → F2 D52 → F3 D50 → F4 D51 → F5 D44 → F6 D47 → F7 D46 → F8 email receipt, owner questions Q1–Q6. **Next (2026-09-30):** Q1 ✅ (nightly Download Backup, proven), Q2 ✅ (one Online button with click-to-pick EasyPaisa/JazzCash/Allied/Meezan/MCB/HBL/Alfalah), Q3 ✅ (7 days). Sidebar vs code checked: 75 of 122 shown (47 hidden = other verticals), 75/75 pages load. **Tomorrow:** (1) day 2 dual-run + night reconciliation + backup; (2) go through the page keep/switch-off list with the owner (PHASE-F-PLAN "Testing the whole app"); (3) Q4–Q6; (4) start F1 (D48).

**2026-09-30 morning: day 2.** 12:35–12:41 PKT **Railway outage**: `api.sanopos.com` and the `up.railway.app` address both answered Railway's own 404 "Application not found" while the server kept running (same container, no restart, last own log 12:34, back 12:41 untouched). Railway status page showed nothing; dashboard showed Online, no billing banner. First outage of the dual-run: counter sold in iPOS only meanwhile. After it, the shop PC hung on "Loading session..." (new **D53**: boot requests have no timeout); Ctrl+Shift+R fixed it. Then kiosk clock-in and shift 2.

~~**Next, in order:**~~ (done) (1) **close shift 1 at closing** and reconcile: SanoPOS cash vs drawer, SanoPOS card vs bank machine (**expect SanoPOS +Rs 40**, D48), SanoPOS day total vs iPOS; (2) write the **Phase F plan** ("ready to drop iPOS" rules + fixes: **D48** exchange can't discount 🔴, **D44** Adjustments/Transfers can't search by code 🔴, D47 voids hidden in Sales History, D46 sandbox card gateway on prod, email receipt header). Branch `onetoystore-golive` = `main` + docs commits (local only).

**GO-LIVE IN PROGRESS on prod (sanopos.com), branch `onetoystore-golive`** — see "Go-live on prod (2026-09-28)" below. The real shop `onetoystore` exists (Pro, set up, samples removed, category tree + brands + suppliers in). **Next (2026-09-29):** owner brings a fresh iPOS "Present Stock Position by Supplier" → converter (must match iPOS totals, diff vs 25 Sep file) → preview → **import with "already have labels" ticked** → dry-run checks against prod → counter PC (step 8) → Phase F plan.

**Phase D started 2026-09-28** — see "Phase D" below. Category sheet approved, brands set, D35 fixed, **dry run passed 18/0** into `otsipos_mul06eh1`. Phase D code is done; what's left is the go-live import (needs the owner's go-ahead and a fresh export on the day).

**Phase B order** (agreed with owner 2026-09-26):
1. ✅ Stock count: unscanned left alone + "full count" tick box (D6) — `45b63ffb`
2. ✅ Profit takes returns off (D17), plus D20–D23 found on the way — `e3c3503d`, `42992dae`, `e143ee5b`
3. ✅ Online orders reduce shop stock (blocker 1, 1a–1f) — `f92533b5`. Proven locally in tests and on the real backend with a signed webhook and no login. **Still to prove on the Shopify dev store** (Phase C): real Shopify payloads, and registering the 3 webhooks
4. ✅ "Set Shopify to SanoPOS counts" button + daily drift check (blocker 2, 2a–2h). Found on the way: **the everyday sync was never switched on** (2h), so no till sale ever reached Shopify. Proven locally against a fake Shopify in tests. **Still to prove on the Shopify dev store** (Phase C): the exact field name Shopify's API version wants for the set (see 2a), and a real count set
5. ✅ Offline counter (blocker 3, 3a–3j): catalogue copy in the browser, scan/search/variants offline, offline reload keeps selling, queued sales land at their own time and till and are accepted past stock. Proven in tests and in a real browser on a production build (see Blocker 3). **Still to prove in the shop** (Phase E): the real counter PC, scanner and router, with the internet unplugged
6. ✅ **"Labels to reprint" list.** Split into three (owner decisions 2026-09-27, see Decisions log):
   - ✅ **6a** list + marking + clearing (below, "Step 6: labels to reprint"). Proven in tests and on screen
   - ✅ D25 fixed first (owner's call, 2026-09-27): editing a variant product no longer resets its stock
   - ✅ D27 fixed (2026-09-27): SKU-only variant products (Hot Wheels singles) save from the edit screen; rows labelled by SKU
   - ✅ **6b variant labels** (2026-09-27): the label page's search lists each variant as its own label (own barcode + price, never the parent); the print log records `variant_id` (migration **v142**). See "Step 6b" below
   - ✅ **6c price sheet** (2026-09-27): Import → **Update prices** updates selling price + cost of existing items (products and variants) from a CSV, matched by SKU else barcode, with an old → new preview and a tick box per row; never adds items. See "Step 6c" below
7. ✅ Product **History tab** (2026-09-27): stock ledger with running balance (per branch or all, per variant), price & cost changes with who/why, sales by bill no with returns as minus lines. Migration **v143**. See "Step 7" below
   - ▶ **Phase C started 2026-09-27** (see "Phase C" below): test store `ots-sanopos-test.myshopify.com` created by the owner. Found + built **C1** (Shopify now only allows Dev Dashboard apps with a 24-hour token → SanoPOS stores Client ID + secret and renews the token itself, migration **v144**) and fixed **D29** (the Shopify Settings tab couldn't connect a store: 7 of 8 buttons called missing routes). ✅ **Phase C DONE 2026-09-28** (C-0 to C-8 on `ots-sanopos-test`; D30, D31, D32, D34 fixed on the way). Leftovers: Barbie is deliberately 9 vs 7 on the test store (C-7); the 3 test-store webhooks point at a dead quick-tunnel address (harmless, test store only). **Go-live needs for the live store:** Dev Dashboard app with Custom distribution, webhooks to the real backend address, Mappings tab (location + Generate/Apply). **Next: Phase D** (iPOS item file converter: needs the full iPOS export from the owner)
   - ⏭ **NEXT:** Phase B is done. Next is Phase C (Shopify on a test dev store: needs the dev store from the owner) or Phase D (iPOS item file converter: needs the full iPOS export). Open small items: ~~D28~~ ✅ fixed; ~~frontend-coverage drift~~ ✅ fixed; ~~Sales History shows "#10" instead of the invoice number~~ ✅ fixed 2026-09-27 (list, receipt heading, CSV and reprint show the invoice no; "#id" only for a sale without one; test `frontend/tests/unit/sales-history-bill-no.test.jsx`, failed before). **All small items closed; only Phase C/D (owner inputs) remain**

**Migration head: v144.** **Current proof:** shop-day **112 pass, 0 fail** (re-run after step 6a, with the price triggers in place); `ots-label-reprints.test.js` 19 tests; `ots-retail-core.test.js` 47 tests; `ots-shopify-stock.test.js` 18 tests (17 fail on the old code); online-order webhook proof on the real backend **7 pass, 0 fail**; blocker 3: `ots-offline.test.js` 14 backend tests + 11 new frontend test files, browser proof under Blocker 3. Everything committed on `onetoystore-pilot`, not pushed.

**Shopify access on the owner's machine (checked 2026-09-26):** the Claude desktop Shopify connector and the Shopify CLI (3.91.1, theme login for `one-toy-store-dev.myshopify.com`) both point at the **LIVE** store. Neither is a test store. Don't use them for Phase C testing.

**How to run things (local only):**
- Backend: start via the `backend` launch config (or `node backend/index.js`); banner must say LOCAL DB. Restart it after backend edits (no hot reload).
- Shop day: `OTS_API_BASE=http://127.0.0.1:5000 node tools/onetoystore-pilot/shop-day.mjs --dump` — use 127.0.0.1, `localhost` fails from Node here (IPv6). Log into the printed `otsacc_*` shop in the UI as **Owner / 4321**.
- Regression file: from `backend/`, `npx vitest run tests/integration/ots-retail-core.test.js`.
- Online-order webhook proof (after a shop-day run): `node tools/onetoystore-pilot/online-orders.cjs <otsacc_* tenant>`. Posts signed Shopify order webhooks with no login to the real backend and checks shop stock. Fake shop domain, never calls Shopify.
- Screens: the in-app browser pane has a 0×0 viewport here; use the Playwright MCP.
- Offline proof needs a **production build** (the service worker only registers in production): `VITE_API_BASE=http://localhost:5000 npx vite build --outDir <scratch>/dist`, then `npx vite preview --outDir <scratch>/dist --port 5173 --strictPort` (5173 because of the local CORS origin). In Playwright: `context.route('http://localhost:5000/**', r => r.abort())` = internet down with Wi-Fi up; `context.setOffline(true)` = browser fully offline. Run `node backend/migrate-pg.js` first after a new migration.
- Files here are CRLF: edits via scripts must keep CRLF (check `git diff --stat` stays small).

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
| **A** | Prove the retail core works: (1) test-suite baseline, (2) shop-day acceptance script that checks the numbers at every step, (3) scorecard | ✅ done 2026-09-26 (post-fix full integration run: 0 new failures) |
| **B** | Owner-decision fixes + the 3 blockers + owner requests (order below) | ✅ done 2026-09-27: steps 1–7 (all 3 blockers, labels + price sheet, History tab) |
| **C** | Shopify sync on a TEST development store: repeatable checklist | ▶ started 2026-09-27: store created; C1 + D29 built; waiting on owner for the app (C-0) |
| **D** | iPOS item file → SanoPOS CSV converter, dry run into a test tenant | ✅ dry run passed 2026-09-28 (see "Phase D"); the real import waits for go-live |
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

**Fixed 2026-09-26 (Phase B step 3, `f92533b5`), locally. Shopify dev-store test still to do:**

| # | What changed | Proof |
|---|---|---|
| 1a | An online order takes stock off **when it arrives**, paid or cash-on-delivery, the same moment Shopify reduces its own stock. It lets go when the order is cancelled or its payment voided. A Shopify refund puts back **only the units Shopify restocked** (the refund's "restock" tick), so a refund for a toy that never came back leaves stock alone. | test 1a; refund test |
| 1b | The webhook now sits **in front of** the login wall, at a per-shop address: `/api/integrations/shopify/webhooks/orders/<shop>`. The shop name in the address picks the tenant; that tenant's webhook secret (HMAC) and shop domain are checked as before. The Shopify setup screen now shows this address. | test 1b (route order); `online-orders.cjs` on the real multi-tenant server: no login → 200, forged signature → 401, unknown shop → 404 |
| 1c | One address takes `orders/create`, `orders/updated` and `orders/cancelled` (refunds arrive inside `orders/updated`). The setup screen lists exactly those 3. Other topics are acknowledged and ignored. **Webhooks are still registered by hand in Shopify admin**; automatic registration waits for the dev store. | |
| 1d | Shopify's `cancelled_at` now marks the order cancelled, and a cancelled order stays cancelled. Out-of-order deliveries are handled: an older copy of the order arriving after a newer one is ignored. | tests 1d, "older update" |
| 1e | Lines are matched through the **Shopify product map** first, then variant SKU, **plain-product SKU**, then barcode. An unmatched line no longer blocks the rest: matched lines move stock, and the order note and the webhook event (`needs_attention`) name the unmatched line. | tests 1e ×2 |
| 1f | Stock moves through `services/stock-ledger.js` (row locks, variant stock, batch ledger). A new table `web_order_stock` (migration v139) records what each order currently holds off the shelf. Every webhook compares "should hold" with "holds" and moves only the difference, so create + updated + retries can't take stock off twice. | test 1f, "delivered twice" test |

Changed on purpose (old tests updated): an unpaid order used to be ignored; one unmatched line used to block the whole order; a Shopify refund used to put everything back, restocked or not. `pg-batch7-order-service` tests updated to the new rules. Full integration suite: 1,848 pass, 26 fail (the known 26), see Test suite baseline below.

### Blocker 2: sync sends +/− changes, not absolute counts. REAL; no "set Shopify to SanoPOS" exists

| # | Finding | Evidence |
|---|---|---|
| 2a | Outbound sync only ever uses `inventoryAdjustQuantities` (delta). There is no absolute set anywhere in the code. | `shopify/client.js:153-180`; no `inventorySetQuantities` / `inventorySetOnHandQuantities` in repo |
| 2b | `POST /sync/push-inventory` is **not** an absolute push: it takes delta rows from the caller. It also **never responds**: it passes a callback to an `async` function that never calls it, so the HTTP request hangs. `POST /sync/process` has the same bug. | `routes/shopify/sync.js:152-243` vs `routes/orders.js:763, 909` |
| 2c | The reconciliation screen's "POS wins" fix **does nothing**. It marks rows "resolved", and a code comment claims "Shopify sync will push POS values", which is false. Only "Shopify wins" changes anything, and that overwrites SanoPOS stock (the opposite of what OTS needs). | `routes/shopify/reconciliation.js:313-328` |
| 2d | Reconciliation compares Shopify with **product-level** stock only. Variant stock is ignored, so every Hot Wheels variant would compare against the total for all cars. A Shopify item it can't read counts as 0. | `reconciliation.js:88-103, 134-136` |
| 2e | No periodic drift check. Reconciliation only runs when someone presses the button. | no worker in `boot/workers.js` |
| 2f | **Partial purchase receipts lose their Shopify update.** The sync de-duplication key uses the PO number, not the GRN number, so the 2nd delivery against the same PO is silently dropped as a "duplicate". Stock transfers use no reference at all, so after the first transfer of an item, later ones are dropped. | `routes/purchase-orders.js:523-535`, `routes/inventory.js:187-198`, key built at `routes/orders.js:808-816` |

**Found while fixing (2026-09-26):**

| # | Finding | Evidence |
|---|---|---|
| 2g | The stock check compared **every imported item against 0**. The Shopify import saves inventory ids as full `gid://shopify/InventoryItem/…`; reconciliation prefixed `gid://shopify/InventoryItem/` again, so no Shopify count was ever found. "Shopify wins" on those rows would have set SanoPOS stock to 0. | `routes/shopify/import.js:152-159` vs old `reconciliation.js:134-136` |
| 2h | **The everyday sync was never switched on.** Sales, voids, returns, transfers, adjustments, PO receipts and supplier returns all queue their Shopify change via `deps.enqueueInventorySyncEvents`, but that helper was only given to the Shopify routes, never to `deps`. Every caller found nothing and silently skipped. No till sale ever reached Shopify. | `routes/registerAllRoutes.js:685-695` (helper only in `shopifyDeps`); callers e.g. `routes/sales.js:58-64` |
| 2i | Two lines of the same item on one bill made the same de-duplication key, so the 2nd line was dropped. A return of a variant was sent without its `variant_id`, so it would update the plain product on Shopify. | `routes/orders.js` key; `routes/returns.js` sync call |
| 2j | The per-row "POS wins / Shopify wins" buttons created approval requests that **nothing ever carries out**: approving one changes nothing. | no consumer of `reconciliation_fix` approvals anywhere in `backend/` |
| 2k | The old-event cleanup deletes `success`/`failed` events, but the sync writes `processed`, so sent events were never cleaned up (matters on the 500 MB free Supabase tier). | `boot/workers.js` `cleanupSyncEvents` |

**Fixed 2026-09-26 (Phase B step 4), locally. Shopify dev-store test still to do:**

| # | What changed | Proof (`ots-shopify-stock.test.js`) |
|---|---|---|
| 2a | New **Set Shopify to SanoPOS counts** (Reconciliation tab button, `POST /api/integrations/shopify/stock/set-to-pos`). It sets Shopify's `available` to SanoPOS's **exact** count with `inventorySetQuantities`, not a +/- change. Negative SanoPOS stock is sent as 0; part-units round down. Every set is **compare-and-set**: it carries the count just read from Shopify, and Shopify refuses it if an online order changed the count in between. That item is left alone and reported "changed while fixing, run again"; the rest of the batch still goes through. Before setting, waiting +/- changes are sent; an item whose change is still waiting to retry is skipped ("update on its way") so it can't land on top of the new count. After a set, old failed changes for that item are marked `superseded`, so "retry failed" can't replay them. **To prove on the dev store:** Shopify renamed the compare field (`compareQuantity` before API 2026-04, `changeFromQuantity` + a required idempotency key from 2026-04). The code picks by the connection's API version (default 2025-10) and retries once with the other spelling. Shopify's schema couldn't be read from here to confirm. | sets exact counts; negative → 0; online order mid-fix; waiting change skipped; failed events retired |
| 2b | "Process pending" and "push inventory" now **answer**. Push inventory with no rows = set Shopify to SanoPOS counts. The old tests passed only because their stubs called the callback the real code never calls. | 3 tests with a 5 s timeout (hung before) |
| 2c | "POS wins" (bulk, and the new per-row **Set Shopify to N**) now actually sets Shopify. "Shopify wins" (now labelled "Copy Shopify count into SanoPOS") is refused on variant rows, and on rows with no Shopify count. The per-row approval buttons that did nothing (2j) are gone. | POS wins test; variant refusal test |
| 2d | Compares **per variant** (the variant's own shop stock) and per plain product. An item Shopify can't read shows **"Unknown to Shopify"** or **"Not stocked here on Shopify"** with the Shopify count blank, never 0, and is never set. | variant test; unreadable test |
| 2e | **Daily check** (`boot/workers.js` `shopify_stock_check`, on by default, off with `SHOPIFY_STOCK_CHECK_WORKER_DISABLED=1`). Runs for each shop with an active Shopify connection when its last check is 23 h+ old (hourly tick, so restarts can't skip or double a day). **Report only:** saves the comparison for the Reconciliation tab and sends an in-app notification when counts differ. It never changes a count. Items the owner marked "ignored" stay ignored if nothing changed. Shown on the admin worker-status page. | daily check test; ignored-stays-ignored test |
| 2f | Transfers carry their transfer id (was none). PO receipts were already keyed by GRN (fixed in `e6389eac`). A move with no reference now gets a unique key instead of colliding. | 2 transfers → 2 events |
| 2g | Ids compared in one form (`toGid`) whether saved as a number or a full gid. | exact-counts test (one of each form) |
| 2h | The helper is now given to every caller, wrapped so a failed queue write is logged and can't crash the server. **Effect: once a shop has an active Shopify connection, every till sale, void, return, transfer, adjustment, delivery and supplier return now sends its change to Shopify.** That was always the intent, but it has never actually run before, so Phase C must watch it on the dev store. | all 3 duplicate tests needed it |
| 2i | Same-item lines on one bill are added together into one change; returns send the variant. | 2 lines → one −3 change; variant return test |
| 2k | Cleanup also removes old `processed` and `superseded` events. | |

Real multi-tenant backend (not the test harness): `node tools/onetoystore-pilot/shopify-sync-live.cjs <otsacc_* tenant>` gives a throwaway local shop a Shopify link to a domain that can't exist (`ots-fake.invalid`), then checks that 2 transfers queue 2 Shopify changes (2h/2f), and that Check now / process pending / set counts all answer, with an unreachable Shopify shown as a blank count. **8 pass, 0 fail.**

Screen checked in the browser (local shop): new button with a confirm box, plain-English statuses, blank Shopify count for unreadable items, "Set Shopify to 100" on a differing row.

### Blocker 3: cloud-only counter. REAL, and bigger than "untested"

| # | Finding | Evidence |
|---|---|---|
| 3a | The offline queue covers **only the checkout step**. Scanning a barcode, searching or opening variants all call the server, so with the internet down the cashier **can't put an item in the cart**, except items already on screen from a search done before the outage. | `POSContext.jsx:897`, `POSOmniInput.jsx:82`, `useCart.js:181` |
| 3b | The service worker caches the app shell, so a page reload while offline should still open the app (to be proven). | `frontend/public/sw.js` |
| 3c | Queued sales carry an `idempotency_key`, and there is a unique DB index on `sales.idempotency_key`, so a duplicate replay should be rejected (to be proven). The duplicate check runs *before* the transaction, so the unique index is the real guard. | `routes/sales.js:1694-1704`; `schema-pg.sql:2032` |

**Plain English:** the offline safety net exists but only catches the last step. For One Toy Store we need the POS to be able to **find products while offline**, which means keeping a copy of the catalogue (~10k items) in the browser. That is a design decision for the owner (see Decisions log).

**Checked against source 2026-09-26, before building:**

| # | Finding | Evidence |
|---|---|---|
| 3a | Confirmed, and wider: **every** way into the cart asked the server (hand scanner, scan box, PLU pad, typed search, variant picker). No endpoint returned the whole catalogue | `POSContext.jsx` `handleBarcodeScanned`, `POSOmniInput.jsx`, `POSPluPad.jsx`, `useCart.js` `triggerSearch`, `POSVariantMatrixModal.jsx` |
| 3b | **Wrong as written.** An offline reload **signed the cashier out**: boot re-reads the role's permissions, the fetch throws, the catch clears the session, and signing in needs the server | `AuthProvider.jsx` boot catch → `clearSession()` |
| 3b′ | The service worker saved the app page once, at install, and never again. After a few deploys the offline page pointed at code files never saved. Its fallback also tested a promise for truthiness, so it never fell through | `frontend/public/sw.js` |
| 3c | Holds: pre-check + unique index, racing duplicate → 409 `duplicate`, which the queue treats as synced | `routes/sales.js` |
| 3d | Queued sales replayed only on the browser's `online` event. With the shop Wi-Fi up and the internet down the browser never goes "offline", so sales sat until someone pressed Sync | `useOfflineQueue.js` |
| 3e | A replay was refused when SanoPOS's stock was too low (`insufficient_stock`), leaving a sale whose money was already taken stuck as "failed". The "Oversell anyway" button is wired to nothing | `routes/sales.js` stock gate; `POSInsufficientStockModal.jsx` |
| 3f | A replayed sale got the **replay** time and whatever till was open then: a 21:50 bill synced next morning landed in the next day and the next till | `routes/sales.js` `INSERT INTO sales` (timestamp default NOW(), open till) |
| 3g | The queue refused the 51st bill (`MAX_QUEUED = 50`) | `utils/offlineQueue.js` |

**Found while fixing:**

| # | Finding |
|---|---|
| 3h | After an offline reload the POS still couldn't sell: the opening gate couldn't load branches / till / clock-in ("Failed to load POS setup data."), the POS feature flags (which switch on the scan box) weren't loaded, and money showed in "$" |
| 3i | A sync network failure marked the sale **failed**, and nothing retries failed sales automatically. A sale left **"syncing"** by a page reload mid-request was never retried either (seen live in the browser test) |
| 3j | The catalogue's ETag can't be read by the page (the API is on another origin), so every refresh would re-download the whole catalogue; and the browser's own HTTP cache replayed an old body under the same ETag |

**Fixed 2026-09-27 (Phase B step 5), locally:**

| # | What changed | Proof |
|---|---|---|
| 3a | New `GET /api/products/catalogue`: every live product and variant with barcode, SKU, PLU, shelf price, tax and variant options; **no cost, no stock**. The POS keeps it in IndexedDB, one copy per shop (`utils/offlineCatalogue.js`), refreshed when the POS opens, every 10 min and when the browser comes back online; an unchanged catalogue answers 304 (`?version=`, 3j). Every input asks the server first and falls back to the copy only when the server can't be reached: browser offline, request fails, 502/503/504, or no answer in 4 s (`offlineLookup.js`). A real answer (404 etc.) is never overridden. Offline items carry "stock unknown": never called out of stock; the variant picker shows "?" and lets the cashier pick | `ots-offline.test.js` 3a (3); `offline-catalogue`, `offline-lookup`, `use-offline-catalogue`, `pos-offline-inputs` (all 8 input tests fail on the old code), `pos-context-offline` |
| 3b | A network failure at boot keeps the saved session and its permissions; a real refusal (401) still signs out | `auth-offline-boot` |
| 3b′ | Every successful page load saves the page as the offline copy | `sw-offline-shell` |
| 3d, 3i | While sales wait, the queue retries every 60 s; a network failure or 502/503/504 leaves the sale **waiting** (not failed) and stops that round; "syncing" sales found when the page opens go back to waiting. A real refusal (400/500) still marks it failed for a manager | `use-offline-queue-ots` |
| 3e | An **offline replay** (`idempotency_key` + `offline_sold_at`) is booked past stock: stock goes negative (a missing stock row is created negative), kits too. The sale stores `offline_past_stock`; the reply lists the items; the POS shows "Sold offline past stock: recount these" with sold vs had, until dismissed. Live sales keep the stock check | `ots-offline.test.js` 3e (4) |
| 3f | The queue stamps `offline_sold_at` when the bill is rung; checkout sends its till (`shift_id`). The server books the sale **at that time** in that till, but only if the time falls inside that till's open–close window, otherwise in the till open at that time. Future times are clamped to now. The clock-in check is skipped for replays. A closed till is named in the reply and the POS panel. Migration **v140**: `sales.offline_sold_at`, `sales.offline_past_stock` | `ots-offline.test.js` 3f (6) |
| 3g | Queue cap 500 bills (counted through the index, not by reading every row) | `use-offline-queue-ots` |
| 3h | The POS remembers, per shop, the last-known currency, branches, POS flags and (per branch + cashier) the till and clock-in (`utils/lastKnown.js`), and uses them only when the server can't be reached, with the notice "Offline: using the till and clock-in saved at HH:MM" | `pos-offline-reload` (4), `pos-context-offline` |
| — | Owner decisions: Lock greyed out offline ("Lock needs the internet"; also refused when the server doesn't answer), the lock screen says it unlocks when the internet is back; automatic discounts off offline with a one-time notice | `pos-offline-screens`, `pos-context-offline`, `pos-offline-inputs` |

**Real browser, production build, local backend (2026-09-27):**
1. Online: catalogue saved (25 products, 5 variants); next refresh 304.
2. Wi-Fi up, internet down (API blocked, browser still "online"): scanned a plain item and a single Hot Wheels car by its own barcode, searched "monopoly", took cash → queued with its time and till #2.
3. Browser fully offline, **page reloaded**: still signed in, no opening gate, prices in Rs, scan box present, Lock greyed out; scanned + took cash → queued.
4. Back online: both queued sales synced (both had been left "syncing" by reloads, 3i); in the database each is booked **once**, `timestamp` = `offline_sold_at` = the moment it was rung up, till #2, cash matches.
5. Matchbox Car stock set to 0, sold 2 offline, synced: stock −2, panel "Matchbox Car: sold 2, SanoPOS had 0". Screens: `out/offline-sale-queued.png`, `out/offline-reload-sale.png`, `out/offline-recount-report.png`.

**Not covered / to do in the shop (Phase E):** the real counter PC, scanner and router with the internet unplugged. The first visit to the POS must happen online (it saves the app, the catalogue and the till state then). Receipts printed offline show "Invoice: PENDING" (the number is given when the sale syncs). Offline **returns** were already queued before this work and are unchanged (no past-stock or time handling). Signing out offline still works, but signing back in needs the internet.

---

## Step 6: labels to reprint (2026-09-27)

**Every writer of a selling price, checked one by one** (a grep for `SET price =` finds nothing; the writes are built dynamically):

| # | Writer | Writes | Covered |
|---|---|---|---|
| W1 | Product edit `PUT /api/products/:id` (`routes/products.js`, dynamic field list) | `products.price` | ✅ trigger |
| W2 | Same request, variant rows | `product_variants.price` (`v.price || price`: a blank variant price falls back to the parent's) | ✅ trigger |
| W3 | Shopify import, update path (`routes/shopify/import.js`) | `products.price` on **every** import (each Shopify variant is its own product row; never writes `product_variants`) | ✅ trigger; an unchanged price is not listed |
| W4 | Scheduled catalogue changes (`services/catalog-scheduler.js`, `UPDATE ${table} SET ${field}`) | either table; only runs with `SCHEDULED_CATALOG_WORKER_ENABLED` | ✅ trigger |
| W5 | WooCommerce import (`routes/woocommerce.js`) | `selling_price`, **a column that doesn't exist**: fails before writing (D26) | n/a |
| New | Product form create (+ variants), inventory bulk-import, `/import` spreadsheet, Shopify import new-item path | first price | ✅ listed as "new" |
| Out | Packages and preset seed data (service/package items); price lists / per-shop prices / price books (`price_list_items`, flags off for one shop) | | not listed, by design |

**How it works.** Marking is done by the database, not route code: triggers on `products` and `product_variants` (migration **v141**, same DDL in `schema-pg.sql`, shared from `services/label-reprints.js`) open one row per item in `label_reprints` with the price on the last label and the current price. That way no writer can skip it, including future ones. These are the **first database triggers in the repo**. New items open a row with no old price. A second change before a reprint updates the same row; a price moved back to the label's price removes it. A product with variants is listed per variant, never as the parent. Existing items at migration time are **not** listed (their labels are assumed right).

**Clearing.** `POST /api/barcode-print-jobs` clears an item printed **at its current price** (a stale page printing the old price doesn't clear it). "Label is fine" (`POST /api/label-reprints/dismiss`) clears without printing. The `/import` tick box "These items already have shelf labels" (`?already_labelled=1`) keeps imported items off, for the iPOS switchover.

**Screen.** A "Labels to reprint" section at the top of the label page (`/barcode-templates`): item (variant SKU for variants), barcode, label price → new price (or "New"), when; select rows, then "Print selected" (fills the print queue at the new price; variants keep their own barcode) or "Label is fine".

**Proof.**
- `backend/tests/integration/ots-label-reprints.test.js`: 19 tests. 17 failed before the build (no table). With only the triggers dropped, 13 fail (the other 4 are "must not list" cases). The migration test caught a real bug in my first v141 (unquoted table names: FATAL on the public schema), failing on it and passing on the fix.
- Frontend: `label-reprints.test.jsx` (5), `import-already-labelled.test.jsx` (2), both failing first.
- Neighbouring suites (products, import, Shopify, kits, packages, variants, pricing, ots-*): 274 pass. `pg-batch13-catalog-scheduler` fails the same way on the old code (Jest syntax).
- On screen (Playwright, local backend, fresh shop-day shop): list showed the 28 new items incl. the Hot Wheels variants → "Label is fine" on all → Rubik's Cube edited Rs 1,500 → 1,650 in the product screen → listed as `Rs 1,500.00 → Rs 1,650.00` → "Print selected" → label printed "Rubik's Cube / 869000000012 / Rs 1,650.00" → list empty. `out/step6-labels-to-reprint.png`, `out/step6-print-queue.png`, `out/step6-after-print.png`.
- Note: the setup wizard's 5 "(Sample)" products also show as new on a fresh shop.

## Step 6b: variant labels (2026-09-27)

**Before:** the label page's search (`/barcode-templates` → Print Labels) listed only whole products: a Hot Wheels single could only be printed with the parent's barcode and price, and `barcode_print_jobs` had no variant column, so a variant printed from the search couldn't be told apart in the log.

**Now:**
- The search lists **each variant as its own item** ("Hot Wheels Single Car – HW-DEORA", its own barcode, its own price; a variant without its own price uses the parent's). The parent of a product with variants is not listed. Search matches name, SKU or barcode (`labelReprints.js` `buildLabelPickList` / `searchLabelPickList`; variants come from `GET /api/products/catalogue`, the offline-catalogue endpoint from blocker 3). Long names wrap instead of being cut off, so the SKU stays readable.
- `POST /api/barcode-print-jobs` stores `variant_id`, kept only when it really is a variant of that product (a foreign id is stored as NULL). Migration **v142** adds `barcode_print_jobs.variant_id` (FK, `ON DELETE SET NULL`), same column in `schema-pg.sql`. Clearing the "Labels to reprint" row already keyed on product + variant (6a).

**Proof:**
- `ots-label-reprints.test.js` +4 (23 total): variant label logged with its variant and clears only that variant; foreign variant id not stored; v142 skips a schema without the table, adds the column, idempotent; `schema-pg.sql` has the column. All 4 failed first. `ots-retail-core` still passes (72 together).
- Frontend `label-variant-picker.test.jsx` (3, all failed first). Unit suite **281 / 281** (41 files).
- Local DB migrated to v142 (all 73 tenant schemas have the column).
- On screen (Playwright script, shop `otsacc_mujorxnl`): list cleared with "Label is fine" → Deora's price changed in the product edit screen (possible since D27) → listed → Print Labels, search "Hot Wheels" shows the 5-Pack and the three singles by SKU, no parent → added HW-DEORA → label printed "Hot Wheels Single Car – HW-DEORA / 027084120903 / Rs 520.00" → list empty ("All shelf labels are up to date."). Print log row: product 24, **variant 3**, barcode 027084120903, Rs 520. `out/step6b-variant-in-print-queue.png`, `out/step6b-variant-label.png`, `out/step6b-after-print.png`.
- Note: a fresh shop has no label template; the proof created one ("Shelf 50x30").

## Step 6c: price sheet updates existing items (2026-09-27)

**Before:** `/api/import/products` rejected a SKU that already exists and `bulk-import` only inserts, so no spreadsheet could change a price.

**Now:** Import → **Update prices** tab (`PriceSheetImport.jsx`), backed by `POST /api/import/prices` (rules in `services/price-sheet.js`, admin only like the rest of `/import`). Template: `sku, barcode, name, selling_price, cost_price` (`name` is for the reader; not used to match).
- Each row is matched by **SKU, else barcode**, against live products and variants (case-insensitive). SKU and barcode on different items, a code on more than one item, the same item twice in the sheet, the **parent** of a product with variants ("put each variant's own SKU or barcode"), a non-number or negative value, or a row with neither price nor cost → error, not applied.
- Only **selling price and cost** change; a blank cell keeps the current value. Unmatched rows: "Not found · skipped"; nothing is ever created.
- `?preview=1` returns old → new per row plus counts; the screen ticks every changed row, greys unchanged ones, flags below-cost in amber (allowed). "Update N prices" sends the file plus the ticked line numbers; the server **matches the sheet again** and writes only rows that are still a change, in one transaction.
- Changed selling prices reach **Labels to reprint** through the v141 triggers (old → new, variants as themselves); a cost-only change doesn't list the item.

**Proof:**
- `ots-price-import.test.js` (18): SKU match with old → new; barcode fallback (no SKU, or SKU matches nothing); variants by own SKU/barcode; SKU/barcode conflict; not found; variant parent refused; duplicate item; blank keeps value + unchanged; bad numbers; below cost; preview writes nothing; apply takes only ticked rows (products + variants), creates nothing; lands on Labels to reprint; cost-only doesn't; ticked errors/not-found skipped; apply without ticked rows → 400; permission; template columns.
- `price-sheet-import.test.jsx` (3, all failed first): preview table, apply sends only ticked rows, nothing ticked → button disabled.
- On screen (Playwright script, shop `otsacc_mujorxnl`, after clearing the list with "Label is fine"): a 9-row sheet previewed as Rubik's 1,500 → 1,650 (cost 900 → 950), UNO by **barcode** 950 → 995, Hot Wheels **HW-DEORA** 520 → 540, Jenga no change, Monopoly 4,200 → 4,500 (**unticked**), Hot Wheels parent refused, NOT-A-SKU not found, OTS-BALL + another item's barcode flagged, Skipping Rope 450 → 180 "below cost". "Update 4 prices" → database: the 4 ticked changed, Monopoly still 4,200, no new products (25 before and after); Labels to reprint shows exactly Rubik's, UNO, HW-DEORA, Skipping Rope with old → new. `out/step6c-price-sheet-preview.png`, `out/step6c-labels-to-reprint.png`.

**Not covered:** a sheet saved from Excel may lose leading zeros on barcodes (the import keeps what it gets; see the CSV-template note in `routes/import.js`). The price sheet doesn't set per-shop prices (price lists), by design.

## Step 7: product History tab (2026-09-27)

**Before:** no per-item movement record existed (19 files write stock directly); price changes were a free-text activity-log line ("Unknown" employee, GRN cost changes missing); `/api/reports/history-sale` showed sale ids, not bill nos.

**Now:** a **History** section at the bottom of the product screen (edit only; `ProductHistory.jsx`), with a variant picker ("All variants (product total)" or one variant) and three tabs:
- **Stock**: every movement with when, what (Sale / Return / Delivery / Adjustment / Transfer in/out / Stock count / Return to supplier / Online order / New item / Opening stock / Sale voided / Other change) and its document (bill no links to Sales History, GRN no, Shopify order no), who, change and **balance after**. Branch picker: one branch (its own balance) or **All branches** (combined running balance + Branch column). "On hand now" beside it, which the newest balance equals. Newest first, "Load older" by 200.
- **Price & cost**: every selling-price and cost change, old → new, which (and which variant), why, who.
- **Sales**: every sale line by **bill no** (links to the bill), returns as **minus lines** against the original bill, voided bills struck through with a "Voided" badge; qty, price, cashier, branch. Read from the bills themselves, so it includes the past.

**How it's recorded** (migration **v143**, DDL shared with `schema-pg.sql` via `services/product-history.js`, same pattern as v141): triggers on `outlet_stock` and `variant_outlet_stock` (quantity insert/update/delete) write `stock_movements` (change + balance after); triggers on `products` / `product_variants` (price, cost_price) write `price_changes`. So nothing that moves stock or changes a price can skip it, and the ledger ties out with on-hand **by construction**. Each row stores its transaction id; the main writers call `tagChanges()` at the end of their transaction to label that transaction's rows: sale (+ kit components), void, return, delivery (PO receive: stock **and** the cost change, as the GRN), adjustment (+ reason), transfer (both branches), stock count, supplier return, Shopify online order (order no), new product, product edit, price sheet, spreadsheet import. Bill/GRN numbers are looked up at read time (a sale's invoice number is assigned after its own transaction). Existing non-zero stock got one "opening" line per item at migration time. Endpoints: `GET /api/products/:id/history/{stock,prices,sales}` (`manage_inventory` or `view_inventory_reports`).

**Untagged (shows "Other change", no who):** setup-wizard sample products, Shopify product import (runs without a transaction, so it can't be tagged this way), storefront/holds/van/fulfillment/aggregator orders, scheduled price changes. The numbers are still recorded and tie out.

**Proof:**
- `ots-product-history.test.js` (22): triggers (insert/change/no-change/delete, variant rows, price + cost incl. first price), tagging only the current transaction's rows, per-branch vs all-branches balances equal on-hand, variant ledger, sales by bill no with return minus lines + voided, permission; migration v143 (skip bare schema, opening lines, changes after, idempotent; **mutation-checked**: with the opening-balance step removed it fails) + schema copy; one test per tagged writer (new item, edit, sale → bill no + cashier, void, return, adjustment + reason, transfer both sides, count, delivery stock + cost as the GRN, supplier return, price sheet), all failed before tagging. `ots-retail-core` +1: Shopify online order tagged with the order no (failed first).
- Frontend: `product-history.test.jsx` (5), `sales-history-deeplink.test.jsx` (1), History section on the edit screen (+1 in `product-form-sku-only-variants`), all failed first. Unit suite **291 / 291** (44 files). New files lint-clean.
- Local DB migrated to v143 (74 schemas). **Shop-day 112 pass, 0 fail** with the triggers in place. On the fresh shop-day shop every `outlet_stock` and `variant_outlet_stock` row equals the sum of its ledger (**0 mismatches**); of 70 movements only the 5 setup-wizard sample products are untagged.
- On screen (Playwright script, shop `otsacc_mujsufsd`): Hot Wheels Single Car, All branches: New item +5 ×3 (the three cars) → Sale INV-2026-00009 −1 → Sale INV-2026-00010 −1 → Stock count −4, balance 9 = on hand 9; Twin Mill at Packages Mall: balance 3 = on hand 3; Twin Mill price edited 450 → 480 on screen → Price & cost shows "Product edit, Owner" (who comes from the signed-in employee on the real multi-tenant backend); Sales tab lists both bills; clicking INV-2026-00010 opens Sales History filtered to that one bill. `out/step7-history-stock-all.png`, `out/step7-history-stock-variant.png`, `out/step7-history-prices.png`, `out/step7-history-sales.png`, `out/step7-bill-link.png`.
- Noticed, not changed: Sales History lists receipts as "#<sale id>", not the invoice number the History tab and receipts show.

## Phase C: Shopify on a test development store (started 2026-09-27)

**Test store:** `ots-sanopos-test.myshopify.com`. The owner created it from the Dev dashboard (Basic plan, no generated test data, no feature preview), in the same Shopify organization as the owner's Partners account (`oneshop349@gmail.com`). **Never** `one-toy-store-dev.myshopify.com`, which is the live store.

**Tools checked (2026-09-27):**
- Claude desktop Shopify connector: works, but is connected to the LIVE store. Its "switch store" can move it to the test store to add test toys and read counts/orders. Ask the owner before switching, and confirm the store before every write.
- Shopify CLI 3.91.1: works when run with `CI=1` (it hangs on its update check otherwise). Logged in as `oneshop349@gmail.com`. It **can't create a dev store** and isn't needed.

### C1: Shopify's new kind of app (found 2026-09-27, built)

Shopify's docs now say "You can no longer create new admin-created custom apps". Those were the only kind SanoPOS supported: one permanent `shpat_` Admin API token. A new app is a **Dev Dashboard app**: its **Client ID + Client secret** are exchanged for a token that **lasts 24 hours** (client credentials grant, only for stores in the app's own organization). Without renewal, SanoPOS would sync for a day and then quietly stop. **This applies to the live store at go-live too**, unless it already has an admin-created app from before the change (not checked yet).

Built (migration **v144**):
- `shopify_connections` has new columns `client_id`, `client_secret` (encrypted) and `access_token_expires_at`.
- **Saving:** Settings → "How SanoPOS connects" = Dev Dashboard app. Saving gets the first token straight away, so wrong credentials are refused with Shopify's reason and nothing is saved. `shop_not_permitted` adds "must be in the same Shopify organization".
- **Renewing:** `shopify/utils.js` `getActiveShopifyConnection()` renews the token when less than 1 hour is left. Every Shopify caller (routes, the orders route's own copy, now shared, and the workers) goes through it. Two callers at once share one renewal. A refused renewal never throws: the reason goes into `last_error` and the old token is tried.
- **Webhooks:** an app's webhooks are signed with its **client secret**, so it is used when no separate webhook secret is saved.
- **Old connections:** a permanent-token connection works as before, and saving a token switches back to token mode.
- **Settings screen:** shows no part of the client secret.
- **Tests:** `ots-shopify-app-auth.test.js`, 10 tests, all failed before. Fake Shopify, no real store.

### D29: the Shopify Settings tab could not connect a store (found 2026-09-27, fixed)

7 of its 8 buttons called addresses the backend doesn't have:

| Button | What it called | What the backend has |
|---|---|---|
| Save | `POST /config` | `PUT` only |
| Disconnect | `DELETE /config` | `POST /disconnect` |
| Run Live Validation | `/validate` | `/live-validation` |
| Push Inventory | `/sync/inventory` | `/sync/push-inventory` |
| Pull Orders | `/sync/orders` | `/sync/pull-orders` |
| Process queue | `/queue/process` | `/sync/process-pending` |
| Retry | `/queue/retry` | `/sync/retry-failed` |

Only Verify worked. Same class as D1.

**Fixed:**
- Save, Disconnect, Live Check (now shows its result), "Send waiting stock changes now" and "Retry failed stock changes" all call real routes.
- The two **"(Dry Run)"** buttons are removed, not rewired, because their real endpoints are not dry runs:
  - `push-inventory` with no rows sets every Shopify count.
  - `pull-orders` imports real orders.

  "Set Shopify to SanoPOS counts" on the Reconciliation tab does the push properly, and orders arrive by webhook.
- The form uses the shared UI components (lint baseline now 5 below).
- **Test:** `frontend/tests/unit/shopify-settings.test.jsx`, 4 tests, all failed on the old screen. One test clicks every button and checks each route against the backend's list.

### C2: API version to check on the test store

Connections default to API version `2025-10`. Shopify keeps a version for about a year, so it is close to being retired. Step 2a picks the compare-and-set field name by version (`compareQuantity` before 2026-04, `changeFromQuantity` from 2026-04) and retries with the other spelling. **On the test store, connect with a current version (2026-07) and confirm a real count set works.**

### D30 + D31: the Mappings tab could not map anything (fixed 2026-09-27)

**D31**, Shopify Mappings + Events tabs (`ShopifyMappings.jsx`, `ShopifyEvents.jsx`, `ShopifyContext.jsx`) called 4 missing routes. Same class as D1/D29. Rewired:
- suggestions → `POST /mappings/products/auto-live`
- apply → `/mappings/products/apply-suggestions`
- save location → `PUT /mappings/locations/:outletId`
- event retry → `/sync/retry-event/:id`
- Also: the tab read `status.location_mappings` (a number) as a list, so it would crash once a location was linked.

**D30**, backend matching (`routes/shopify/mappings.js` auto-live): a variant's barcode was selected as NULL and a plain item's SKU was ignored, so the Hot Wheels variants could not match by barcode and SKU-only plain items never matched. Now a variant row matches on its own barcode, then its own SKU (never the parent's barcode); a plain row on the product barcode, then the product SKU. **Test:** `backend/tests/integration/ots-shopify-mappings.test.js`, 5 tests, 4 failed on the old code.

**On screen (owner, local, 2026-09-27):** Fetch Live Locations → Packages Mall → "Shop location" → Save → "Location mapping updated", row shows Shop location (the old tab would have crashed here). Generate Suggestions → 7 rows, all EXACT_BARCODE (HW5, BARBIE, LEGOP, RUBIK + Twin Mill, Bone Shaker, Deora) → Apply Approved (7) → "Linked 7 item(s)." DB: 7 active `shopify_product_map` rows (3 with variant_id 1–3 on product 24), `shopify_location_map` outlet 1 → `gid://shopify/Location/89763872990`.

### D32: no till sale reached Shopify on a current API version (fixed 2026-09-27)

Found by C-4. The queued -1 for the Rubik's sale was refused by the real store: *"InventoryChangeInput must include the following argument: changeFromQuantity."* From API **2026-04**, `inventoryAdjustQuantities` (the everyday +/- sync, 2h) requires `changeFromQuantity` on every change **and** an `@idempotent` key. 2a only updated the full set, not the +/- path, and the stock test used a 2025-10 connection, so nothing caught it. Every counter sale, return, transfer and receipt would have failed to reach Shopify.

**Fixed** (`shopify/client.js` adjustShopifyInventory, `routes/orders.js` worker): on 2026-04+ each change sends `changeFromQuantity: null` (a +/- change is right whatever the count is, so it opts out of the compare, as Shopify's docs allow) and the call carries `@idempotent` with the queued change's own `idempotency_key`, so a retry after a lost answer is applied once. Older versions send neither.

**Test:** `ots-shopify-stock.test.js` +3 (fake Shopify now enforces the 2026-04 rules by URL version): a till sale lowers Shopify on 2026-07; a resent change is applied once; 2025-10 still works. 2 of 3 failed on the old code. Shopify stock/orders tests 66 pass. **Real store:** null opt-out accepted, Rubik's 18 → 17.

### D34: an online order moved no stock unless a raw "default location ID" was typed (fixed 2026-09-27)

Found by C-5. `shopify/order-service.js` resolveWebOrderOutletId needed `shopify_connections.default_location_id` (a raw Shopify location id typed on the Settings tab) whenever the order carries no outlet, which is always for online orders. Nobody fills that field, so order #1001 was saved but moved no stock: "Order has no outlet_id and no default Shopify location is configured".

**Fixed:** with no default set, if exactly one Shopify location is linked to a branch (Mappings tab), that branch is used; with none or several it still refuses, with a message saying which. Shopify's next orders/updated for a refused order applies it, once. **Test:** `ots-retail-core.test.js` "D34" (failed on the old code); retail-core + shopify-stock 74 pass.

**Go-live notes (live store):** the live app also needs Custom distribution before order webhooks can be registered; the webhook address must be the public backend (`api.sanopos.com`), not a tunnel.

### Phase C checklist (on `ots-sanopos-test`)

| # | Check | Result |
|---|---|---|
| C-0 | Owner: Dev Dashboard app "SanoPOS test" with scopes `read_products, read_inventory, write_inventory, read_locations, read_orders`, released and installed on `ots-sanopos-test` | ✅ 2026-09-27, owner |
| C-1 | SanoPOS Settings → Dev Dashboard app → Save gets a token (owner types Client ID + secret into SanoPOS, not chat); Verify + Live Check pass | ✅ 2026-09-27: owner saved it on the Settings screen (tenant `otsacc_mujsufsd`, local backend). Green "Connected", Verify OK, Live Check: store ots-sanopos-test, 1 location, 0 sample items (no products yet). DB: `shop_domain` = ots-sanopos-test.myshopify.com, API 2026-07, client_id + secret stored, token expires 2026-09-28 16:01 UTC, no error. **First real proof of C1: a Dev Dashboard app's client credentials work** |
| C-2 | Test toys on the store with the same SKUs as SanoPOS (incl. a variant product); location map set | ✅ 2026-09-27: toys created by `tools/onetoystore-pilot/phase-c-seed-shopify.cjs` (HW5, BARBIE, LEGOP, RUBIK + Hot Wheels Single Car with 3 variants, all at 2 on Shopify). Packages Mall → Shop location; 7 items linked on screen after D30/D31 (above) |
| C-3 | "Set Shopify to SanoPOS counts" sets exact counts (real field name for the API version, 2a) | ✅ 2026-09-27: owner clicked it on the Reconciliation tab → "7 item(s) set on Shopify." Read back from the test store (GraphQL, API 2026-07): HW5 9, BARBIE 9, LEGOP 4, RUBIK 18, Twin Mill 3, Bone Shaker 5, Deora 1 = SanoPOS Packages Mall exactly (were all 2). **2a/C2 settled:** on 2026-07 Shopify accepts `changeFromQuantity` + `@idempotent` directly (a same-value set returned no errors), and a stale expected count is refused with `CHANGE_FROM_QUANTITY_STALE`, so the guard is real |
| C-4 | A till sale lowers the Shopify count (2h everyday sync) | ✅ 2026-09-27 after **D32** (below): owner sold 1 Rubik's Cube at Packages Mall (INV-2026-00014); SanoPOS 18 → 17; first tries refused by Shopify, after the fix the worker retried the same queued change by itself (attempt 3, processed) and the test store reads **17** |
| C-5 | Webhooks registered (`orders/create`, `orders/updated`, `orders/cancelled`) to a public tunnel address; a COD test order lowers shop stock | ✅ 2026-09-27 after **D34** (below). Owner ran `cloudflared` (quick tunnel) in their own terminal. Registering the 3 webhooks first failed: *"This app is not approved to subscribe to webhook topics containing protected customer data"* — fixed by giving the app **Custom distribution** (Partners → Distribution); no separate protected-data request was needed. Test order **#1001** (1 × LEGO City Police Car, payment pending = COD, from the admin): webhooks arrived, signature accepted with the app's client secret, order saved, but no stock moved (D34). After the fix + a tag edit on #1001 (a timeline comment does **not** send orders/updated): SanoPOS Packages Mall LEGO 4 → **3**, order on outlet 1, "Stock applied"; no outbound event (no echo back to Shopify); Shopify available 3 / on_hand 4 |
| C-6 | Cancelling / refunding the test order puts the stock back | ✅ 2026-09-28: owner cancelled #1001 (restock). First delivery missed: the PC had slept overnight (tunnel gone, backend stopped). New tunnel → webhooks moved to the new address (`webhookSubscriptionUpdate`, no duplicates) → a tag edit re-sent it. SanoPOS LEGO 3 → **4**, web order "cancelled / Stock reversed", History +1 `#1001`; Shopify 4 (no +1 echo). **Lesson for go-live:** a tunnel only lives while the PC is awake; the live store must use the real backend address |
| C-7 | Daily drift check catches a difference made on Shopify | ✅ 2026-09-28: owner changed Barbie on the test store 9 → 7; Reconciliation → Check now: "Checked 7 item(s): 6 the same, 1 different", row Barbie / Packages Mall / SanoPOS 9 / Shopify 7 / DIFFERENT (+2). Neither count changed (DB 9, Shopify 7). Check now runs the same `shopify/stock-check.js` compareCounts + saveCheck as the daily worker |
| C-8 | A token past 24 hours is renewed on the real store (force expiry in the DB, then Verify) | ✅ 2026-09-28: `phase-c-seed-shopify.cjs otsacc_mujsufsd --renew` marked the token expired → **PASS**, renewed against the real Shopify, valid until 2026-09-29 07:55 UTC, no error; the counts on Shopify were untouched |

## Phase D: iPOS item file → SanoPOS (started 2026-09-28)

**Source file (owner, 2026-09-28):** `C:\Users\HP\Downloads\pspsupplier.xls` = iPOS **"Present Stock Position by Supplier"**, printed 2026-09-25, 221 pages. Per item: code, description, on hand, unit cost, unit sale price; grouped under a supplier heading (supplier code + name).

| Check | Result |
|---|---|
| Items | **10,044**, under **29 suppliers** (biggest: TOYS AND TOYS LAHORE 3,421; "AUDIT REPORT MARCH 2025" 2,093 — not a real supplier; BABY LAND LAHORE 1,174) |
| Ties out to iPOS's own grand totals | ✅ exactly: net **21,428** units, cost **Rs 13,267,140**, sale **Rs 32,318,450** |
| Duplicate codes | **0** |
| Stock | 4,512 in stock, 5,312 at zero, **220 below zero**; all whole numbers |
| Prices | 1 item with cost 0, none with sale 0 |
| Codes | lengths 2–14 digits; 3,113 look like real barcodes (12–13 digits); **7 odd codes** (`X000UO7NQD`, trailing `.`/`_`/`I`) |
| vs the older `psps1.xls` (21 Sep) | all 9,873 present; 171 new items; 220 quantities changed |
| Hot Wheels | one line `027084120134 MATTLE HW DINKEY-C4982-TT`, **251 units**; the individual cars are not in iPOS. Shopify (saved `shopify-variants.json`, LIVE store export, read-only) has ~594 variant rows mentioning Hot Wheels, many sharing SKU `027084120134` |

**What the current import can't do** (checked in `backend/routes/import.js:289-475`): stock goes to the one outlet in context only; no variants; category/brand must already exist (else the row errors); negative stock is silently dropped (`> 0` check); no supplier by name (`supplier_id` only).

**Not in the file:** location split (see decisions: iPOS has one count), category, brand.

**Converter:** `tools/onetoystore-pilot/ipos/ipos_convert.py` (Python: `xlrd` reads the .xls, `openpyxl` writes the check sheet; the repo dropped the JS `xlsx` package). Tests: `python -m pytest tools/onetoystore-pilot/ipos -q` → **39 pass** (failed first: module missing). It reads the report (supplier headings repeat per page; codes kept as text), **refuses to continue unless the items add up to iPOS's own grand totals**, applies the supplier decisions, puts the iPOS code in SKU exactly as it is (the till scan matches barcode OR sku, `routes/products.js:498`), rounds cost to 2 decimals (`products.cost_price` is `NUMERIC(12,2)`), imports below-zero at 0 and flags it, and sorts every item into a category by keywords in its name.

Run on the real file (2026-09-28): 10,044 items, totals match iPOS; 220 below zero → 0 (**740 units**); 22 suppliers; **695 items (7%) "Needs a Category"**; 31 categories (the approved tree + "Animals & Play Sets" under Action Figures & Hero Play, added for ~160 animal sets). Outputs (kept out of git, business data): `ipos-categories-to-check.xlsx` (every item, its group/category, a blank "Change category to" column; a second sheet with the tree and counts) and `ipos-products.csv`.

**Brands** (owner 2026-09-28: makers only): `brand_for()` in the converter, 23 brands, **811 items** get one (Yalong 124, Winfun 114, Lepin 114, Intex 85, Barbie 79, Hasbro 55, Maisto 50, Hot Wheels 47, …). Owner named the short codes: **W.F = Winfun, HSB = Hasbro, L.T = Little Tikes; TB = supplier Tooba Stuff (not a brand)**; TORY, MBK, GT, H.B etc. left alone. Known miss: "WATCH LEGO DESIGN" gets LEGO. Tests: 64 pass.

### D35: the product import silently dropped a `supplier` column (fixed 2026-09-28)

`POST /api/import/products` only read `supplier_id`; a file naming the supplier imported every item with **no supplier and no error**. **Fixed:** a `supplier` column is matched to a supplier by name (ignoring case and repeated spaces); an unknown name is a row error in the preview; `supplier_id` still works. **Test:** `backend/tests/integration/ots-ipos-import.test.js` (2 of 5 failed on the old code); with the other 3 import test files, 54 pass.

### Phase D dry run (2026-09-28): ✅ 18 pass, 0 fail

`tools/onetoystore-pilot/ipos/dry-run.mjs <converter output dir>` (local only; refuses a non-localhost DB or API). Makes a throwaway shop (Packages Mall + Store Room, Owner / 4321), removes the setup samples, creates the 14 groups + 31 categories, 22 brands, 22 suppliers, previews and imports the converter CSV into Packages Mall with "already have labels" ticked, then reads every item back from the DB and the till scan. Last run: tenant **`otsipos_mul06eh1`**, backend on port 5001 (launch config `backend-5001`; port 5000 belonged to another session with older code).

| Check | Result |
|---|---|
| Preview | 10,044 valid, 0 errors, no SKU made up (0.8 s) |
| Import | 10,044 imported, 0 errors (**15 s**) |
| Every item vs the converter: name, price, cost, category + group, brand, supplier, Packages Mall stock, Store Room 0 | ✅ all 10,044 identical |
| Units / cost value / sale value in Packages Mall | ✅ 22,168 / Rs 13,551,132.24 / Rs 32,991,600 (iPOS net 21,428 + the 740 below-zero units now at 0) |
| Below-zero items at 0 | ✅ 220 |
| Labels to reprint | ✅ none open; all 10,044 marked "already labelled" |
| Categories | ✅ exactly the approved tree (45) |
| History tab | 4,512 opening lines, 22,168 units |
| Till scan by iPOS code | ✅ `0107`, `001`, `027084120134` (Hot Wheels, 251), `6939143104280.`, `X000UO7NQD`, `2011009434138` (a 2-prefix 13-digit code; not taken for a scale label) |
| On screen (Owner) | ✅ Products list "10044 items"; search `0107` → MASK AVENGERS, Rs 1,150 / 395, 12, Action Figures & Robots; its page shows supplier HAFIZ NAWAZ, no brand; `027084120134` → 251 in Die-cast & Hot Wheels; Categories page 14 top level / 31 leaf |

**Found on the way:** (a) every new shop gets **5 "(Sample)" products with 100 units each** plus 3 sample categories from setup (`seeds/preset-seed-data.js`, no opt-out). The app's delete only hides a product and keeps its stock, and a category with hidden products can't be deleted, so the dry run removes them outright while the shop has no sales. **Go-live step:** do the same on the real shop before its import (ask the owner first: production). (b) The category rules had 5 word-boundary checks switched off by a typing slip (a `\b` became a backspace); fixed, with a test that the file has no control characters. Versus the sheet the owner approved, exactly **2 items** moved, both out of "Needs a Category": KITCHE SET-GT-88-2C → Kitchen Sets, FARM HORSE 2PACK → Animals & Play Sets. "Needs a Category" is now 693.

**Go-live order (real shop, needs the owner's go-ahead):** fresh iPOS export on the day → converter (must match iPOS totals) → owner glance at the check sheet → new One Toy Store shop → remove samples → tree, brands, suppliers → import with "already have labels" → the dry-run checks → staff count the 220 below-zero items and move Store Room stock.

**Next in Phase D:** (1) ✅ owner checked the category sheet 2026-09-28: no changes; (2) brands (propose from names: Maisto, Burago, Lepin, Intex, Crayola, Mattel/Barbie, LEGO…); (3) the import has to take a supplier by name and create the tree (it only takes `supplier_id` and existing categories today) — fix with a failing test first; (4) ✅ dry run (above).

## Go-live on prod (2026-09-28)

Owner in the shop, Claude watching (Playwright tab on sanopos.com, read-only SQL, `railway logs`). Prod = `65d476a7`, migration head v145, all 6 old test shops deleted first (backup `D:\newprojects\sanopos-backups\sanopos-prod-before-reset-2026-09-28.dump`). Supabase **Free** plan (owner's choice).

| Step | What happened | Checked |
|---|---|---|
| 1. iPOS export | Owner has no fresh export today → **old file (25 Sep, `pspsupplier.xls`) used for everything except the real import**; still converts: 10,044 items, matches iPOS totals, 220 below zero (740 units), 693 "Needs a Category", 22 suppliers | converter run |
| 2. Create shop | Owner chose the **real sign-up** at sanopos.com/signup (store name "One Toy Store" → slug **`onetoystore`**, tenant id **134**) + email confirm link; then /admin → Edit → **Pro**, time zone Asia/Karachi, max staff 0 / products 0 (= unlimited), max outlets **1** | DB: `plan=pro, payment_status=active`, no trial/expiry, verified; schema at v145, 326 tables |
| Store Room | **Owner decision: one location for everything** (as iPOS). No Store Room outlet | |
| 3. Setup wizard | Retail Store; One Toy Store, Pakistan, Lahore, phone 042 32184836, email = owner's; Asia/Karachi, Rs/PKR, notes 5000–10, year from July; **not GST registered** (tax_mode none, FBR off); outlet **Packages Mall**, "Shop G017, Ground Floor , Packages Mall, Lahore"; owner PIN typed by the owner | DB `company_profile` + `outlets` as entered; `setup/complete` 200, console clean |
| 4. Setup samples | **Owner decision: through the app, nothing hard-deleted.** 5 "(Sample)" products → category "Needs a Category", stock −100 each by adjustment ("Setup sample item removed before go-live"), label list cleared ("Label is fine"), archived; the 3 sample categories (Electronics, Clothing, Accessories) then deleted | DB: 0 live products, 5 archived at stock 0 (both tables), History +100/−100 each, 0 labels open, 14 top-level + 31 categories |
| 5. Tree, brands, suppliers | Owner OK'd a script in the logged-in tab calling the same POSTs as the screens: 14 groups + 31 categories, 22 brands, 22 suppliers (names only; opening balances later from the registers) | DB: no duplicate names; avg 263 ms/call, no errors in Railway log |
| 6. Import **preview only** (old file) | Import → Products, `ipos-products.csv` from the 25 Sep file: **10,044 valid rows, 0 errors**, SKUs = iPOS codes, prices as iPOS (row 1: 3,050 / 1,195). **Not imported** (waits for the fresh file). The "Markup % 25" box on that screen belongs to *Scan invoice photo* only and does not affect a CSV | DB still 0 live products; DB **262 MB** / 500, shop schema 17 MB before import |

**2026-09-29 (morning):** fresh export `C:/Users/HP/Downloads/pspsupplier2992026.xls` (iPOS 29 Sep 13:05, 242 pages) is an **.xlsx saved as .xls**; converter taught to read both (`7d74f570`, test first, 69 pass; 25 Sep output byte-identical). Result: **10,044 items, totals match iPOS: 20,892 units, cost 13,004,323, sale 31,674,300**; 225 below zero -> 0 (756 units); 694 Needs a Category; 22 suppliers. Import totals (below-zero at 0): **21,648 units, cost 13,294,932.50, sale 32,363,380**. vs 25 Sep: same 10,044 codes; 249 items down (547 units = 4 days of sales); COLOUR BOOK JUMBO (9789695000472) 0->27, price 690->790, cost 336->378; item `00` renamed WRAPPING SHEET -> SHEET (now Needs a Category). Import file: **`C:/Users/HP/Downloads/ipos-products-2026-09-29.csv`**. Prod checked read-only before import: `tenant_onetoystore` has only the 5 soft-deleted samples, 45 categories, 22 suppliers, 22 brands; DB 261 MB. **Not imported yet**: owner wants Claude watching in Playwright (MCP failed to connect this session, so a new session).

**2026-09-29: ✅ REAL IMPORT DONE on prod** (Claude watching in Playwright + read-only SQL + `railway logs`; owner OK'd the Import press). Owner was already logged in (`hassan`, Packages Mall).

| Check | Result |
|---|---|
| Before | 0 live products, 5 archived samples, 45 categories, 22 suppliers, 22 brands; DB 262 MB |
| Preview (`POST /api/import/products?preview=1`, 200, 2.8 s) | **10,044 valid, 0 errors**; 0 SKUs made up; all prices from the file; all have a category; 9,942 with supplier, 811 with brand (same as the CSV); preview sums 21,648 units / cost 13,294,932.50 / sale 32,363,380 |
| Import (`?already_labelled=1`, 200, **68 s**) | `{"imported":10044,"errors":[]}`; console clean; no errors in Railway log |
| Items | **10,044** live, 10,044 distinct SKUs, 1 outlet |
| Units / cost / sale (outlet_stock × product) | ✅ **21,648 / 13,294,932.50 / 32,363,380** (exact) |
| Below zero | ✅ all **225** codes from the converter's `ipos-below-zero.csv` (re-run into scratch; its import CSV is byte-identical to the one imported, sha256 `49ee8018…`) found, all at 0; 0 negative anywhere |
| Stock spread | 4,473 in stock, 5,571 at 0 |
| Labels to reprint | ✅ 0 open; 10,044 "already labelled" |
| History | 4,483 movements (4,473 opening + the 10 sample ±100), net 21,648 |
| Till scan (`/api/products/scan/…?outlet_id=1`) | ✅ `0107` MASK AVENGERS-7790 Rs 1,150 (12); `027084120134` MATTLE HW DINKEY Rs 550 (**247**, was 251 on 25 Sep); `X000UO7NQD` UNCORN GLITTER ART SET Rs 1,590 (1); `6939143104280.` LUNCH BOX NO-372 Rs 2,190 (0). Stock is in `local_stock` (what the till reads); the old `stock` field is 0 for all, as expected |
| Size | DB **274 MB** / 500; shop schema 33 MB |

Playwright can only upload from inside the repo, so the CSV was copied to `.playwright-mcp/` (git-ignored) first.

**Next:** counter PC (step 8) → Phase F plan.

**Counter PC (step 8), 2026-09-29** (separate PC in the shop; Claude watches only via `railway logs` + SQL, can't see its screen):
- ✅ Chrome → sanopos.com, owner logged in (`POST /api/auth/mt-login` 200 at 13:38 PKT), shop onetoystore / Packages Mall; no 4xx/5xx after.
- The till (**New Sale**) will not open at all without an open shift (`POSOpeningGateModal`), so opening a shift is a prod write, pending the owner's OK.
- ✅ Scanner tested on Catalog → Products search instead (no writes): owner scanned 3 printed barcodes + 3 short iPOS codes, all found. Log shows e.g. `6987657899185` MARKER SET 18PCS Rs 1,890, `6935539616238` SLIME-7507 Rs 650, `7976` CHU CHU RUBBER TOYS Rs 850, `7034` MAGIC CUBE Rs 550.
- **Owner decision:** dual-run with iPOS from today: real shift, real sales in SanoPOS alongside iPOS; the bank card machine stays separate (swipe, then pick **Card**, same as iPOS).
- ✅ Kiosk clock-in (`/kiosk?tenant=onetoystore`, PIN) 13:49; shift 1 opened 13:51 with the real drawer count, float **Rs 32,870**. The till needs both.
- ✅ Test sale INV-2026-00001 (owner practice: new customer "test checkout", 5% discount, split cash 3,000 + card 1,000 + cash 892.50 = Rs 4,892.50, MUSICAL VARIETY TRACK 24685) → **voided** 14:14 ("test sale no customer"): stock 2 → 1 → 2, History shows sale −1 and void +1; 0 live sales. Leftover: the test customer keeps 48 loyalty points (void doesn't reverse points).
- ✅ Receipt: no printer set up in SanoPOS, so "Print failed" → **Browser** → Chrome print box → thermal printer (POS-80), margins None: prints. **vs the iPOS slip, SanoPOS is missing:** shop name/address/phone, "No Refund No Warranty / Exchange within 3 days", change given; text small and faint. To check in Receipt Templates next.
- **Card payments hit the sandbox gateway on prod:** `PAYMENT_GATEWAY` is sandbox, so a Card line gets `gateway_ref sandbox_inline_…` (`routes/sales.js:2264`); no money moves. Harmless for the shop, but a prod cleanup item.
- **Sales in iPOS after the 13:05 export** must be corrected in SanoPOS: owner's list: 11:14 `2770` and 12:51 `2106` were before the export (already in); **13:24 `2703` FLYING DISC BALL ×1 cash was after** → SanoPOS shows 29, real 28; fix = stock adjustment −1 (its cash is already in the counted float, so not a SanoPOS sale). ✅ Done 14:19 via Inventory → Adjustments (reason "Other"; no note field): 2703 now **28**, History "adjustment −1". Finding the item took the quick-type-the-name workaround (**D44**).
- ✅ **First real sales in SanoPOS (dual-run with iPOS), new iPOS-style slips printed** after the 14:47 deploy: INV-2026-00002 15:00 Card 3,530 (4 lines, 5 pcs); 00003 15:01 Cash 100; **00004 15:07 exchange** for 00002 (Pony Biting 2423 returned + restocked, Clay 8859335200034 out; return credit 950 + **Card 40**, see D48); 00005 15:08 Cash 300. All match the server. Owner: slips "look beautiful"; the barcode didn't scan (D49). Flow as used: add items → Pay → payment box → Sale Complete → **Print** → Chrome print box straight away (no "Print failed").
- After the 15:30 barcode deploy: INV-2026-00006 … 00012 (15:35–15:53), 7 bills, incl. a 9-line Card 24,780 and a discounted Card 13,000 (discount 770). Day so far (not voided): **11 bills, Rs 58,860 = Cash 13,920 + Card 44,940** (card includes the Rs 40 of D48). No item below zero.
- ✅ **Day 1 reconciliation vs iPOS "Daily Sale Report" slip (printed 21:14:36)** — SanoPOS read-only SQL, 34 bills INV-00002…00035 (last 21:13), shift 1 still open:

  | | iPOS net | SanoPOS net | Diff |
  |---|---|---|---|
  | Cash | 25,990 (sub 26,180, disc 190) | 25,990 | 0 |
  | Card | 95,940 (sub 98,290, disc 2,350) | 95,980 | **+40** (D48) |
  | Total | 121,930 (sub 124,470, disc 2,540) | 121,970 | **+40** (D48) |

  Card discounts match exactly (770+950+440+190 = 2,350). iPOS cash discount 190 = SanoPOS 150 (INV-00018) + the **Rs 40 waived on the exchange**, which iPOS booked as a cash-mode bill with discount 40. Gross also matches: SanoPOS net 121,970 + real discounts 2,500 = **124,470** = iPOS sub total. (SanoPOS stores the exchange's 950 return credit in `sales.discount_amount`, so a naive discount sum shows 3,450.) **No bill missing on either side.** Expected drawer at close = float 32,870 + cash 25,990 = **Rs 58,860** before till expenses (D50).
- ✅ **Shift 1 closed 22:36** by the owner on the counter (after iPOS End of Day; kiosk clock-out done). Counted by denomination: 5000×2, 1000×17, 500×17, 100×35, 50×179, 20×0, 10×57 = **Rs 48,520**. SanoPOS: expected 58,860, variance **−10,340**; over Rs 500 so it asked for reason + manager PIN (owner typed both): reason "Till expenses Rs 10,470 as per register", approved by employee 1. **Against the register: 58,860 − 10,470 = 48,390 expected → drawer Rs 130 over.** The last bill (INV-00035, 21:13, Rs 290 cash: customer paid 300, got 10 back) came after the first count; owner first said the typed notes were counted **after** it, then corrected to "I think **before**". If before, the real drawer was 48,520 + 290 = **48,810 → Rs 420 over** and SanoPOS's saved count is Rs 290 low (the shift is closed, so the saved figure stays; this note is the record). Not a SanoPOS sales error either way: SanoPOS cash = iPOS cash exactly; opening denominations sum to the 32,870 float. Owner was already home, so it **stays unsettled: drawer Rs 130 or Rs 420 over**. Tomorrow's opening count will show what actually went home/stayed in the drawer.
- ✅ **Card vs bank machine:** settlement **Rs 94,650** + one **online transfer Rs 1,290** (customer paid by EasyPaisa/JazzCash/bank app, rung as Card in both systems = SanoPOS **INV-00017**, 17:07) = **95,940** = iPOS card. SanoPOS 95,980 = +40 (D48). **Day 1 fully reconciled** apart from D48 and the unsettled drawer overage. Shop practice: online transfers are rung as Card in iPOS and written in the register (method + amount); next morning the settlement minus the bank's fee (~2%, varies by bank) is added to a hand-kept running bank figure. No sales after 21:13. **Rule told to the owner:** count the drawer last, right before pressing Close Shift; a cash sale after counting means recount (expected includes every sale up to the close).

**Tomorrow (2026-09-29), in order:** fresh export → converter + diff vs 25 Sep → preview → import with "These items already have shelf labels" ticked → dry-run checks on prod (10,044 items; units / cost / sale totals vs the converter summary; 220 below-zero at 0; scans `0107`, `027084120134`, `X000UO7NQD`, `6939143104280.`; 0 labels open) → counter PC (open sanopos.com online, log in, POS, scanner, test receipt) → Phase F plan + "ready" rules.

## D13: paying suppliers on account (2026-09-28)

Owner: credit suppliers (1, 2 months…) are paid **lump sums** by cash or bank transfer whenever money is available; a lump sum lowers the **balance only** (no bill marked paid). Cash suppliers are still paid bill by bill.

- **What we owe = opening balance + bills − payments (not voided; per bill or on account) − returns.** One definition, `backend/services/supplier-balance.js` (`SUPPLIER_TOTALS_SQL`), now used by: supplier list balance, Payables aging, supplier ledger, payables report, settlement overview + supplier payments report aging, accounting AP + balance sheet, PO credit-limit warning.
- **Migration v145:** `suppliers.opening_balance` (+ `opening_balance_date`), `supplier_payments.supplier_invoice_id` nullable. DDL shared with `schema-pg.sql`.
- **API:** `POST /api/suppliers/:id/payments` {amount, payment_method, reference, notes, paid_at (date)} → 201 + new balance (perm `manage_orders`, flag `supplier_payables`). Paying more than owed is allowed (advance). A date of today keeps the time; an earlier date is stored at midday shop time. Voiding goes through `POST /api/supplier-payments/:id/void`. `opening_balance` on supplier create/edit (omitted = kept).
- **Every reader of supplier payments** now skips voided payments and keeps on-account payments (money-paid totals, payment lists and history join the supplier directly, not through a bill).
- **Screens:** Suppliers → **Pay** on each row and **Pay supplier** in a supplier's ledger; **Opening balance** on the supplier form; an advance shows "Rs X advance". Supplier Payables → **Pay on account** on each Aging row, an **Opening** column, the Ledger tab fixed (D36) with brought forward (D37); CSV exports fixed.
- **Tests:** `backend/tests/integration/ots-supplier-account.test.js` **23 pass** (14 failed on the old code at first; D40 re-proved on the old void code); `frontend/tests/unit/supplier-pay-on-account.test.jsx` **5 pass** (all 5 failed on the old pages). Related integration files + backend unit: remaining failures are pre-existing (pg-batch3 sales/gift cards ×10, 5 files needing the removed SQLite helper, worker-status ×2, payment-gateway ×1: same on the old code). Frontend unit 301/301.
- **On screen** (trial shop `otsipos_mul06eh1`, frontend 5174 → backend 5001): TOYS AND TOYS opening Rs 250,000 → Pay Rs 100,000 bank transfer HBL-TRX-5521 → row Rs 150,000; ledger: Opening 250,000, Payment (Bank Transfer · on account) → 150,000. Payables: Pay on account Rs 25,000 dated 25 Sep → aging Opening 250,000 / Paid 125,000 / Outstanding 125,000; ledger from 26 Sep starts "Balance brought forward 225,000" dated 26 Sep, closing 125,000.
- Launch configs added: `backend-5001` (CORS for 5173 + 5174) and `frontend-5174` (→ 5001), so a session can test its own code while another session holds 5000/5173.

## Deploy plan (drafted 2026-09-28, needs the owner's go-ahead)

**Live state, checked read-only 2026-09-28:** api.sanopos.com health OK, sanopos.com 200; last Railway deploy 2026-09-03 (SUCCESS). Supabase org plan **free**; DB **334 MB of 500 MB**; 6 tenants, all at schema **v138**. Railway has `INTEGRATION_SECRET_KEY` and `SHOPIFY_SECRET_KEY` (needed to decrypt the Shopify client secret, C1). Shopify sync + daily stock check are opt-out workers and are **not** disabled; email, shift auto-close, hold expiry and attendance auto-close are on; everything else off. The branch adds **no new env vars**.

| Step | What | Who |
|---|---|---|
| 1 | Full backend suite on the branch; any failing file re-run on `main` in a worktree; only branch-only failures count | Claude: ✅ **2026-09-28 done.** Full suite (exact baseline command, `--no-file-parallelism`): **62 red vs 72 in the July baseline**; `check-baseline.js` flagged 2 "new" (pg-batch14 blocked-time slots, pg-f06 parallel-booking race) — both files give the **identical 4 failures on `main`** (worktree at `1d72ff7c`), so date/env drift, not the branch. 12 baseline entries now pass. **No branch-caused failure** |
| 2 | `onetoystore-pilot` → `main` (fast-forward: main has not moved), push | **Owner** (branch stays local until then) |
| 3 | Railway builds and `start.sh` runs migrations **v139–v145** on all 6 tenants; Vercel builds the frontend | automatic |
| 4 | Verify: health, every schema at v145 in the deploy log and by read-only SQL, `/admin` worker status, a login + supplier page on a test tenant | Claude |
| 5 | Before any real One Toy Store data: Supabase back to **Pro** (daily backups; Free has none) | **Owner** |

Rollback: redeploy the previous Railway deployment; the 7 migrations only add tables/columns/triggers (v145 also relaxes a NOT NULL), so old code runs against the new schema.

## Retail core scorecard

**How it's measured:** `tools/onetoystore-pilot/shop-day.mjs` creates a brand-new throwaway shop in the **local** database and plays a full day through the **real** server: 20 products (2 with variants), 5 purchase orders with partial deliveries, 13 bills, returns, an exchange, a supplier return, an adjustment, a transfer, a till open/close and a stock count. It keeps its own independent ledger of what every number *should* be, then runs ~105 checks. To run it, start the backend (`node backend/index.js`; the banner must say LOCAL DB), then `node tools/onetoystore-pilot/shop-day.mjs --dump`.

**First full run (2026-09-25, before any fixes): 76 checks pass, 29 fail.** The 29 failures trace back to **about 14 distinct bugs** (D1–D15 below). The basic "ring up a bill and take the money" path works. The bugs are in purchasing, variants, cash closing, stock counts and reports.

**After the first round of fixes (same day): 106 pass, 1 fails.** The one left is D6 (stock count wipes uncounted items), which waits on an owner decision. Every fix has a regression test in `backend/tests/integration/ots-retail-core.test.js` (22 tests), each shown to fail before its fix. The two POS-screen fixes (D5 variant scan, D18 resume prompt) were also proven in the real POS screen in a browser; screenshots are in `tools/onetoystore-pilot/out/` (not committed).

**After D6 (2026-09-26): 107 pass, 0 fail.** First fully clean run. 26 regression tests.

**After D17 (2026-09-26): 108 pass, 0 fail.** The two profit checks now expect profit **after returns** (Rs 18,480 on the shop day, was 22,680), plus a new "returns = refunds given" check. 29 regression tests.

**After D21/D22 (2026-09-26): 110 pass, 0 fail.** New checks: per-product profits add up to the day's profit after returns, and the outlet's profit equals the summary's. 33 regression tests.

**After D23 (2026-09-26): 112 pass, 0 fail.** New checks: Sales & Stock units/value per item match the bills, and its stock matches the on-hand report. 37 regression tests.

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
| D6 | 🔴 | Stock count auto-adjust zeroes every product not scanned | 🛠️ fixed: only scanned/typed-in lines are adjusted (a line counted as 0 still counts); `?full_count=true` / the "Full count" tick box zeroes the rest, including every variant with stock, moving stock on the variant rows so product and variant totals stay in step. Complete is claimed atomically (a double-click can't adjust twice). Screen: "counted" now means scanned or typed in, uncounted rows show "—" variance. Proven in the real screen (`out/stock-count-*.png`) |
| D7 | 🟠 | Stock-count scan creates a duplicate line per scan (`ON CONFLICT` never fires when `variant_id` is NULL) | 🛠️ fixed |
| D8 | 🟠 | Receiving can exceed the ordered qty; GRN dialog pre-fills the full ordered qty on later deliveries | 🛠️ fixed: server refuses over-receipt; dialog pre-fills the outstanding qty. Also: the Shopify sync for a 2nd delivery is now keyed by GRN (was silently dropped, blocker 2f) |
| D9 | 🟠 | Sales summary splits split-tender bills equally between methods | 🛠️ fixed: split by what was actually paid |
| D10 | 🟠 | Profit summary sums a bill's discount once per line; dashboard gross profit ignores bill discounts | 🛠️ fixed (both) |
| D11 | 🟠 | Purchase reports double-count ordered qty/value for POs with more than one delivery | 🛠️ fixed |
| D12 | 🟡 | Payables report ignores supplier returns (and counted voided supplier payments as paid) | 🛠️ fixed: returns shown as credit lines; voided payments excluded |
| D13 | 🟡 | Supplier payment only per delivery invoice, not on account | 🛠️ fixed 2026-09-28: **Pay supplier on account** (lump sum lowers the balance, no bill marked paid, owner's choice) + supplier **opening balance**; migration **v145**; one definition of what we owe everywhere (see "D13" below) |
| D14 | 🟡 | Retail setup seeds 5 sample products with stock | open, owner decision |
| D15 | 🟡 | Margin reports off by default for retail | config: turn on "Advanced Reports" for OTS |
| D16 | 🟠 | A supplier invoice paid in two instalments stays "partial" forever (text + number concatenation in `routes/grn.js`) | 🛠️ fixed |
| D17 | 🟡 | Profit reports (profit summary, dashboard) don't subtract returns: a returned item's profit still counts | 🛠️ fixed: one shared definition, `services/returns-profit.js`. A return gives back its refund minus the original sale-line cost of anything restocked (a written-off item gives back the whole refund), dated when the return happens. Applied to the profit summary (new `returns_value` / `returns_profit` / `net_sales`; net margin now on net sales), dashboard today / yesterday / month, the end-of-day digest email (which also ignored bill discounts), and the Accounting P&L (took refunds off but never gave restocked cost back). Reports panel shows a Returns tile. Proven on screen (`out/dashboard-profit-after-returns.png`, `out/reports-profit-returns-fixed.png`) |
| D18 | 🟠 | After every completed sale, the POS offers to "Resume previous cart?", i.e. the cart just paid for. Clicking Resume re-rings it (double-sale trap) | 🛠️ fixed; proven in the real POS screen (fails before, passes after) |
| D20 | 🔴 | `/api/reports/stockout-risk` 500s on every shop (ORDER BY used an output alias inside a CASE). Because the Reports Power-Up panel loaded everything with one `Promise.all`, it also blanked the **profit figures** to 0 | 🛠️ fixed: query wrapped; panel now loads each report independently and says which failed. Also: panel read `rows` where profit-by-product returns `items`, so "Top margin products" was always empty; fixed |
| D21 | 🟡 | Profit **by product** and **by outlet** still count sales only (returns not subtracted per product/outlet) | 🛠️ fixed: both join the shared returned-lines CTE (`returnLinesCte` in `services/returns-profit.js`); new `returns_value` / `returns_profit` / `net_profit` (+ `net_margin_pct` per product); a product only *returned* in the period still gets a row; default sort is net profit. Per-outlet net profit also takes off that outlet's bill discounts, so it equals the summary. Panel shows after-returns figures and exports them |
| D22 | 🔴 | Dead stock: "value tied Rs 0" | 🛠️ fixed, and it was worse: (1) the panel summed `stock_cost_value`, the API returned `cost_value`; (2) the **Dead Stock report page** expected a per-outlet row (`stock_qty`, `stock_cost_value`, `stock_retail_value`, `days_since_sale`, `last_sold_at`, outlet, brand, supplier) the API never returned, so most columns were blank; (3) the query joined every past sale line onto stock, **multiplying stock and value** for anything that had ever sold. Rewritten per product per outlet with the last sale in its own CTE; a never-sold item is aged from when it was created; deleted products excluded; old field names kept. Also the panel's stock-aging "Oldest" read `days_since_sale`, the API returns `age_days`. Proven on screen (`out/dead-stock-report.png`) |
| D23 | 🔴 | Sales & Stock report: stock and sales joined together, so every sale was multiplied by the number of outlet rows and `SUM(DISTINCT os.quantity)` counted two outlets holding the same stock once; **voided bills counted as sales**; deleted products listed; the page's date / time / outlet filters were **ignored** (always all-time, all outlets) | 🛠️ fixed: stock and sales totalled in separate CTEs, voided bills excluded, deleted products excluded, filters applied (times in the shop's time zone). In the test: 4 → 8 stock, 6 → 2 units sold. Screen: `out/sales-and-stock.png` |
| D24 | 🟠 | Picking a product **with variants** from the search results adds the parent product itself (no variant picker), online and offline; the sale is then booked against the parent, not a variant | 🛠️ fixed 2026-09-27: a search pick (click or Enter) of a product with variants opens the variant picker (or says to scan the variant if the picker is switched off). Found on the way: the picker showed **SKU-only variants** (no size/colour options, like the Hot Wheels singles) as one "—" cell, so only the first could be picked; they now get one row each, by SKU. Tests: `pos-search-variants` (3 of 4 fail on the old code), SKU-only picker test in `pos-offline-inputs`. Proven in the real POS (`out/d24-variant-picker.png`) |
| D25 | 🔴 | **Saving a product with variants overwrote each variant's stock** with the number the edit form loaded: `PUT /api/products/:id` wrote `stock = v.stock || 0` on every variant row, so a sale made while the edit screen was open vanished from the count (and a row sent without stock went to 0). Only the `product_variants` rollup moved, not the per-outlet row a sale checks, so the two disagreed | 🛠️ fixed 2026-09-27: a product save never writes variant stock; on edit the variant Stock column is read-only (like a simple product's; change it with an adjustment or count). Opening stock on create unchanged. Tests: 2 in `ots-retail-core.test.js` (both fail on the old code: rollup went back to 6 after a sale took it to 5; unsent stock went to 0), `product-form-variant-stock.test.jsx` (2, fail first). On screen: Twin Mill showed 2, an adjustment took it to 1 while the screen was open, owner saved price 475 → price 475, stock 1 in both tables, and Twin Mill appeared on Labels to reprint 450 → 475 (`out/d25-variant-stock-readonly.png`) |
| D27 | 🟠 | **A product whose variants have no attribute set (SKU-only variants, like the Hot Wheels singles) can't be saved from the edit screen**: "Select an attribute set for variant products.", but the attribute-set box is locked on edit. So the owner can't change such a variant's price on screen. The same rows show as "Variant 1/2/3" instead of their SKU (cosmetic). Found proving D25 (the test product was given an attribute set in the test shop to get past it) | 🛠️ fixed 2026-09-27. **Cause** (checked in source): the check was front-end only (`ProductFormPage.jsx` `save()`) and ran on edit too, while the box that would satisfy it is locked on edit; the back end's `PUT /api/products/:id` never reads `attribute_set_id`. Now only required when creating (the set generates the rows). On edit, rows without options are labelled by SKU, and the locked box reads "None (variants by SKU)". Tests: `product-form-sku-only-variants.test.jsx` (2, both fail on the old code). On screen (Playwright script, local backend, fresh shop-day shop `otsacc_mujorxnl`): Hot Wheels Single Car edit shows rows HW-TWINMILL / HW-BONESHAKER / HW-DEORA, Twin Mill price 450 → 475 saved with no error, database price 475 with stock still 3 in both tables, and Twin Mill appears on Labels to reprint at Rs 475 (`out/d27-sku-only-edit.png`, `out/d27-labels-to-reprint.png`) |
| D28 | 🟡 | **`PUT /api/products/:id` wipes fields it isn't sent**: SKU, barcode, category, brand, GST, product type, vendor, tags and supplier are written as `$n` / `x || null`, not "keep if omitted", so a partial update such as `{ price }` clears the item's SKU and barcode (it stops scanning). Today only the product screen calls it, and it always sends the whole form, so no user hits it. Found writing the step 7 tests (the 6a/6c tests' `{ price }` PUTs had silently cleared barcodes too) | ✅ fixed 2026-09-27: those 9 fields are written only when the key is sent (a key sent empty still clears it, which is how the screen removes a value). Test: `ots-retail-core.test.js` "D28" (2 tests, both failed before the fix). The product screen always sends every key, so nothing changes on screen |
| D26 | 🟡 | WooCommerce import writes `products.selling_price`, which doesn't exist: every WooCommerce product import/update fails | ⏳ found in step 6, not fixed (OTS doesn't use WooCommerce) |
| D19 | 🟡 | Scanning a variant runs the modifier lookup with the variant id as a product id (harmless 403 today; pre-existing pattern shared with the variant picker) | open, low |
| D36 | 🔴 | Supplier Payables → Supplier Ledger tab read `amount`/`payment`/type "purchase", which the server never sends: every line showed "—" and was labelled "Payment" | 🛠️ fixed 2026-09-28 |
| D37 | 🔴 | Supplier ledger over a date range started at 0: its "closing balance" was the period's movement, not what is owed (the Payables tab opens on "this month") | 🛠️ fixed 2026-09-28: balance brought forward line; closing = owed at the end of the range |
| D38 | 🟠 | Supplier aging counted a bill once per payment made on it (fan-out), and ignored returns and voids; 4 more places each had their own "owed" sum | 🛠️ fixed 2026-09-28: one shared definition (`services/supplier-balance.js`) |
| D39 | 🔴 | Clearing a post-dated cheque to a supplier always failed (the payment insert named no supplier) | 🛠️ fixed 2026-09-28: it is recorded as a payment on account for that supplier |
| D41 | 🟠 | **/admin → tenant → Edit: switching Plan to Pro keeps the old Free limits.** The form sends the Max Employees/Products/Outlets boxes it loaded (3/100/1), and `PUT /api/admin/tenants/:id` only applies the new plan's defaults when those keys are missing (`routes/admin/tenants.js:188-190`). So a Free→Pro upgrade from this screen stays capped at 3 staff and 100 products (would have blocked the 10,044-item import). Repro: sign up (Free) → /admin → the shop → Edit → Plan: Pro → Save → Max Products still 100. Worked around on OTS by typing 0/0/1 by hand | open, not blocking |
| D42 | 🟡 | Self sign-up takes **~21.5 s** on the server (`POST /api/auth/signup`, Railway log 2026-09-28 17:01; provisions 326 tables) with no progress message; a merchant may think it froze and click again | open |
| D43 | 🟡 | A browser still holding a login for a **deleted** shop keeps calling it: on /admin/login the console shows `403 /api/company-profile/currency?tenant=livetestauto` and `401 /api/roles/1/permissions`. Harmless, but the stale session is never cleared | open, low |
| D40 | 🔴 | Voiding a payment made against a bill always failed (UPDATE of a column that doesn't exist, `supplier_invoices.amount_paid`), and voided payments still counted as paid in 9 queries | 🛠️ fixed 2026-09-28 |
| D44 | 🔴 | **Stock Adjustments can't find an item in a 10,000-item shop**: the product box is a plain `<select>` of every product sorted by name (`StockAdjustmentsRedesign.jsx:235`), so typing a code or scanning a barcode does nothing; only quick-typing the start of the name works. Same pattern on Transfers (`TransfersRedesign.jsx:216`) and Promotions. Also no free-text note (reason list only) | open (found on prod 2026-09-29) |
| D45 | 🟡 | The SanoPOS receipt lacks the shop name/address/phone and the return-policy line, and prints small and faint vs the iPOS slip (change given *does* print when > 0; the test sale was paid exactly) | 🛠️ fixed on the branch 2026-09-29 (`29f86ccc`, owner chose the iPOS layout + "ONE SHOP"): iPOS-style slip sized in mm, hidden-frame printing, no "Print failed" when no printer is set up, multi-line header, reprint uses the template. ✅ **Deployed 2026-09-29 14:47** (owner said "do all": Claude fast-forwarded `main` 65d476a7 → `ecd21428`, incl. untracking converter `.pyc` files; Vercel READY on ecd21428, Railway SUCCESS, health OK, schema still v145). ✅ Prod template set in Playwright: header `ONE SHOP` / `Shop # G-017, Ground Floor, Packages Mall,` / `Lahore, Pakistan` / `Ph: +92 42 32184836`, footer `No Refund  No Warranty` / `Exchange within 3 days` / `Thank you for your kind visit!`, barcode on (first save hit a one-off `ERR_CONNECTION_TIMED_OUT` before reaching the server; retry 200, DB checked). Preview: `.playwright-mcp/receipt-preview-ipos-style-2.png`. Leftover: the email receipt shows the header lines run together, and doesn't escape the header/footer text |
| D47 | 🟡 | **Sales History never lists a voided sale**: `GET /api/sales` always adds `voided IS NULL OR false` (`routes/sales.js:168`), so the page's "All" and "Voided" tabs and the Voided counter can't show one; the owner saw an empty page when the only sale was the voided test | open (found 2026-09-29) |
| D48 | 🔴 | **Return / Exchange can't take a discount.** Real exchange 2026-09-29 (INV-2026-00004 for 00002: Pony Biting 950 back, Clay 990 out): the customer owed Rs 40 and the owner waived it in iPOS, but SanoPOS had no way to, so it recorded **Card Rs 40 that was never taken**. Shift 1's card total is Rs 40 higher than the bank machine | open |
| D49 | 🟡 | First real slips: the invoice barcode didn't scan (1.2 px bars ≈ 2.5 printer dots, no quiet zone) | 🛠️ fixed `0f51ab28`, **deployed 2026-09-29 15:30** (main `a62b155d`; Vercel READY and the live `receipt-*.js` chunk carries the fix; Railway SUCCESS, health OK). ✅ **Owner scanned a new slip in the Return box and it opened the bill** (2026-09-29 afternoon) |
| D50 | 🔴 | **Cash paid out of the till for shop expenses doesn't reduce the drawer.** The shop pays daily expenses from the till (iPOS: written in a register, worked out by hand after closing). SanoPOS has an **Expenses** page (`/expenses`, perm `manage_inventory`; date, category, description, amount, outlet, reference), but it has no "paid from till cash" choice, the form never sets `shift_id`, and closing a shift works out expected cash as float + cash sales − cash refunds only (`routes/shifts.js:126-150`). So every till expense shows as a cash **shortage** at close. Prod had 0 expenses and 0 expense categories on 2026-09-29 | open (owner asked 2026-09-29 before closing) |
| D51 | 🟡 | **No printable end-of-day slip.** iPOS: print "Sale Reports slip" (per payment mode: sub total, discount, net; grand total) → photo to the family WhatsApp group → press **End of Day**. SanoPOS: **Close Shift** (the POS close box counts notes by denomination) only shows Expected / Counted / Variance on screen, with no print. Reports has Shift Summary / Session Z-Report tabs, but they're not a thermal slip | open (owner asked 2026-09-29) |
| D52 | 🔴 | **No "online transfer" payment type at the till.** Customers often pay by EasyPaisa / JazzCash / bank app; the till offers only Cash, Card, **Wallet** (= the customer's store balance: with a customer it debits their SanoPOS wallet, not a mobile wallet; `routes/sales.js:1593,2640`), and optional Gift Card / On Account. So transfers are rung as Card (INV-00017 on day 1) and card no longer matches the bank settlement. Holds already list JazzCash/EasyPaisa (`POSHoldCreateModal.jsx:179`), the till doesn't. Needs its own type (with an optional reference) that stays out of the drawer and out of card, shown separately on the day slip (D51) | open (owner 2026-09-29) |
| D53 | 🟡 | **Counter stuck on "Loading session..." after a network blip.** Page start (`frontend/src/auth/AuthProvider.jsx:275-343`) awaits `refreshPermissions`, `/api/auth/me` and `/api/billing/status` with **no timeout**; `isBootstrapping` only clears in `finally`. A request left hanging (2026-09-30 ~12:41, just after the Railway outage) keeps the till on "Loading session..." forever. Ctrl+Shift+R cleared it. Fix: time-limit the boot requests (on timeout keep the saved session, like the offline path 3b) | open (seen 2026-09-30) |
| Idea | 💡 | Card settlement tracking: record each day's bank settlement, minus the bank's fee % (≈2%, per bank), into a running "money in bank" figure the shop keeps by hand today. Not a defect; for after iPOS is dropped | idea |
| D46 | 🟡 | Prod runs `PAYMENT_GATEWAY=sandbox`: every POS **Card** line gets a fake `sandbox_inline_…` gateway ref (no money moves; the shop uses a separate bank machine) | open, cleanup |

---

## Test suite baseline (Phase A step 1), 2026-09-25

| Suite | Result | Notes |
|---|---|---|
| Backend unit | **749 / 752 pass** (55/57 files) | 3 failures, none retail: worker-status test expects the marketplace-sync worker "running" (that worker is a known stub); 2 payment-gateway `isEnabled()` env tests |
| Frontend unit | **201 / 201 pass** (25 files) | `npx vitest run` with no path also picks up 54 Playwright browser specs, which "fail" because Vitest can't run them. Not real failures. Run `npx vitest run tests/unit`. |
| Backend integration | **1,801 pass, 26 fail, 29 skipped** (155 of 202 files pass) | **33 files can't load at all** (30 import a deleted helper `tests/helpers/createTestApp`; 3 use Jest syntax). Those 33 include the dedicated retail tests: `purchase-orders`, `returns-exchange`, `shifts`, `shift-linkage`, `supplier-payables`, `reports_accuracy`, `inventory`, `promotions`. **So most of the retail core had no running test.** The 26 failures are the same 12 files already triaged in July as stale test fixtures (e.g. sales tests written before a sale needed an open till); none are new. |
| Backend integration, **after the 13 fixes** (re-run 2026-09-26) | **1,823 pass, 26 fail, 29 skipped** | Compared test-by-test against the baseline: **0 new failures**, 0 disappeared, the same 26 failing. The +22 are the new `ots-retail-core` regression tests, all passing. |
| Backend integration, **after blocker 1** (2026-09-26, ~36 min) | **1,848 pass, 26 fail, 29 skipped** | Pass count = 1,823 + 15 regression tests added for D6–D23 + 10 for blocker 1, exactly. Failures still 26, all in the stale-fixture files; none in any Shopify/order file. The 11 order-adjacent files were also run with and without the change: identical failures. |
| Backend unit, **after blocker 3** (2026-09-27) | **748 / 752 pass** | 4 failures, none from blocker 3: the 3 baseline ones (worker-status ×2, payment-gateway env) plus `frontend-coverage-drift`, which flags 2 endpoints from blockers 1/2 with no screen calling them: `POST …/shopify/webhooks/orders/:tenantSlug` (headless by design → belongs in `frontend-coverage-baseline.json`) and `POST …/shopify/reconciliation/:id/fix` (its per-row buttons were removed in 2j; retire the endpoint or baseline it). ✅ Closed 2026-09-27: the webhook is baselined (headless by design); `/fix` is **retired**. Correction to 2j: its requests did reach a consumer (the Approvals screen → `POST /api/reconciliation/inventory/:id/approve-fix`), but the screen posts no `mode`, so approve-fix answered 500 "Failed to apply fix" to every one. approve-fix itself is left in place (Approvals still calls it for any old request) but no new requests can be filed. Drift test passes |
| Frontend unit, **after blocker 3** (2026-09-27) | **262 / 262 pass** (35 files) | +61 blocker 3 tests |
| Frontend unit, **after D24** (2026-09-27) | **267 / 267 pass** (36 files) | +5 D24 tests |
| Backend, **after 6c** (2026-09-27) | `ots-price-import` **18** (17 failed first; the 18th, "preview changes nothing", passed trivially on a 404), `ots-label-reprints` 23, import neighbours (`pg-import-preview-shape`, `pg-batch-2g14-competitor-import`) pass: 72 together. Backend unit **748 / 752**: the same 4 failures; the drift guard names only the same 2 endpoints | |
| Backend integration, **after step 7** (2026-09-27) | **1,939 pass, 26 fail, 36 skipped** (2,001 tests) | The 26 failing tests re-run file by file on the pre-step-7 commit (`adb97486`, separate worktree): **identical**. The 34 files that fail as a whole are the known ones (30 import the deleted `createTestApp` helper, 3 Jest syntax) plus `pg-customer-portal`, whose setup counts a column across every leftover test schema (fails the same on the old commit). `ots-product-history` 22 and `ots-retail-core` 50 pass. Backend unit 748 / 752, the same 4 failures |
| Frontend unit, **after step 7** (2026-09-27) | **291 / 291 pass** (44 files) | +7 step-7 tests |
| Frontend unit, **after 6c** (2026-09-27) | **284 / 284 pass** (42 files) | +3 `price-sheet-import`; new file lint-clean, `ImportRedesign` unchanged at 3 existing errors |
| Frontend unit, **after D27** (2026-09-27) | **278 / 278 pass** (40 files, `vitest run tests/unit`) | +2 D27 tests. Note: bare `vitest run` also collects the Playwright `tests/*.spec.js` files (54 "failed" files that are not unit tests) |
| Backend unit, **after step 6a** (2026-09-27) | **748 / 752 pass** | the same 4 failures as after blocker 3; the drift guard names only the same 2 endpoints (the new label endpoints have a screen) |
| Backend, **after D25** (2026-09-27) | ots-retail-core **49** (+2 D25), ots-label-reprints 19, variant/crud neighbours pass | `crud_inventory` + `pg-batch3-complex`: 10 failures, identical on the code before D25 (pre-existing) |
| Frontend unit, **after D25** (2026-09-27) | **276 / 276 pass** (39 files) | +2 D25 tests; lint on ProductFormPage unchanged (6 existing errors) |
| Frontend unit, **after step 6a** (2026-09-27) | **274 / 274 pass** (38 files) | +7 step-6a tests. One run showed 2 failures while other jobs ran alongside it; 3 re-runs clean |
| Backend integration, **after blocker 2** (2026-09-26, ~34 min) | **1,866 pass, 26 fail, 29 skipped** | 1,848 + the 18 new `ots-shopify-stock` tests, exactly. The same 12 stale-fixture files fail; none is a Shopify, stock, sales or returns file. |

---

## Decisions log

| Date | Decision | Who | Why |
|---|---|---|---|
| 2026-09-25 | Work on branch `onetoystore-pilot`, push only, no PR unless asked | repo convention | |
| 2026-09-28 | Phase D source = iPOS "Present Stock Position by Supplier" (`pspsupplier.xls`) | **Owner** | Has unit cost + sale price and ties out to iPOS totals |
| 2026-09-28 | iPOS keeps **one stock count** (no Packages Mall / Store Room split). Import it all into Packages Mall; Store Room stock is moved or counted later | **Owner** | The split isn't recorded anywhere in iPOS |
| 2026-09-28 | iPOS has **no real categories or brands**, only supplier names. Claude proposes a toy category tree + brands; owner approves before anything is applied | **Owner** | |
| 2026-09-28 | Hot Wheels come in as **one item** (`027084120134`, the iPOS count); staff count the cars later and it becomes variants then | **Owner** | Neither iPOS nor Shopify knows the per-car count |
| 2026-09-28 | The 220 **below-zero** items import at **0** and go on a "check these" list for staff to count; the import report states the unit difference vs iPOS | **Owner** | A minus count would show as a problem everywhere until counted |
| 2026-09-28 | **All 10,044 items** come across, zero-stock ones included and active | **Owner** | Any old barcode still scans with its price |
| 2026-09-28 | Suppliers: **555 AUDIT REPORT MARCH 2025 merges into 99 TOYS AND TOYS LAHORE** (same supplier; 5,514 items); **04 A TO Z CONSUMERS + 146 A TO Z CONSUMER merge** (94 items); **102 OPEN ITMES, 173 STOCK ADJUDSTMENT, 017 SHOPIFY ORDERS, 998 ADJUSTMENT** are not suppliers → items get **no supplier** (97 items, plus the 5 above the first heading). Result: **22 suppliers** | **Owner** | |
| 2026-09-28 | Categories = a **"kind of toy" tree** (one home per item), named after the website's wording where one fits, plus a **Small Toys & Pocket Money** group. Boys/Girls, age, price bands and "Best Seller" stay **website collections**, not SanoPOS categories; brands go in the **Brand** field. Items are sorted by name keywords; the owner checks an item-by-item sheet before import | **Owner** (Claude's suggestion) | Shopify product types mix kind/gender/marketing labels with 3 spellings of the same thing; ~7,300 iPOS items aren't on the website at all |
| 2026-09-28 | Category sheet approved **as is**, including the 695 "Needs a Category" items | **Owner** | |
| 2026-09-28 | Brand field = **makers only**; characters stay in the name. W.F = Winfun, HSB = Hasbro, L.T = Little Tikes; TB (Tooba Stuff) is a supplier, not a brand; other short codes left alone | **Owner** | |
| 2026-09-28 | **D13 must be fixed before deploy.** Suppliers are either cash or on credit with different terms (1 month, 2 months…); credit suppliers are paid **lump sums on account** (cash by hand or bank transfer) whenever money is available, not bill by bill. Today this lives in paper registers | **Owner** | SanoPOS only pays one delivery invoice at a time |
| 2026-09-28 | At go-live every credit supplier needs an **opening balance** (what is owed today, from the registers) | Claude, from the above | Otherwise the supplier ledger starts at 0 |
| 2026-09-28 | Go-live shop web name (slug) = **`onetoystore`**, created through the real **self sign-up**, then made **Pro** in /admin | **Owner** | Same path a real merchant takes, watched end to end |
| 2026-09-28 | **One location** (Packages Mall) for everything, Store Room included, like iPOS | **Owner** | Matches iPOS for the side-by-side run; can split later |
| 2026-09-28 | Not GST registered; no tax on bills | **Owner** | |
| 2026-09-28 | Setup samples removed **through the app** (move → adjust to 0 → label fine → archive → delete empty categories), nothing hard-deleted on prod | **Owner** | Least destructive, leaves a trail |
| 2026-09-28 | No fresh iPOS export today: shop set up + preview with the 25 Sep file; the **real import waits for tomorrow's fresh file** | **Owner** | Stock from 25 Sep would be stale, and nothing can bulk-correct stock after import |
| 2026-09-28 | Item cost stays the **latest purchase price** (not weighted average) | **Owner** | Closes the open question from 2026-09-25 |
| 2026-09-28 | Order to go live: fix D13 → full test run + deploy plan (DB size, workers/env the pilot needs) → owner pushes + deploy (migrations v138–v144) → verify live → Supabase back to **Pro** (backups) before real shop data → Phase E → Phase F. Deferred: Hot Wheels variants on a PO (until the cars are split), D14 for all shops (go-live clean-up covers OTS), D15 (switch on at go-live), D19, D26 | **Owner** (Claude's suggestion) | |
| 2026-09-25 | Acceptance script runs against the **real** backend (`index.js`, multi-tenant mode) on local Postgres, with a fresh throwaway tenant each run, not against the test harness's re-implemented middleware | Claude | The test harness (`tests/helpers/createTestApp-pg.js`) re-implements auth/permissions, so it can't prove the real server works |
| 2026-09-25 | Margin reports' cost = the cost recorded **on each sale line at the moment of sale** (now read from the DB, D2). The product's cost itself = **latest purchase price** | code as-is | iPOS may use weighted average; see open question |
| 2026-09-26 | Stock count (D6): items not scanned are **left alone** by default; an explicit "full count: zero everything not counted" tick box does the wall-to-wall version | **Owner** | Shelf-by-shelf counting at 10k items |
| 2026-09-26 | Offline: **yes**, keep a catalogue copy (names, barcodes, prices; not stock) in the counter's browser so scanning and search work offline; sales queue and replay | **Owner** | Blocker 3 |
| 2026-09-26 | Cost method: OTS prices **cost-plus a fixed margin that differs by category/brand**. Keep cost = latest purchase price. When a delivery arrives at a different cost, SanoPOS **suggests** the new selling price (cost × (1 + margin), rounded to the **nearest Rs 50**); the owner confirms per item, and repriced items are flagged for label reprint. Not automatic | **Owner** | Matches how OTS prices today. Needs a margin % per category/brand, to be collected |
| 2026-09-27 | **Drop the suggested selling price** (no margins per category/brand needed). Keep only the reprint flag: any selling-price change, **wherever it comes from** (product edit, bulk import, Shopify import), marks the item "label needs reprint"; printing the label clears it. Nothing reprices automatically | **Owner** | Simpler; a shelf label is wrong whichever way the price changed. Supersedes the suggest-and-confirm part of the 2026-09-26 cost-method row |
| 2026-09-27 | Labels to reprint, details: (1) **new items go on the list too** ("new, Rs X") until their first label; (2) spreadsheet import should be able to **update prices of existing items** (step 6c); (3) **variants get their own labels**, not the parent's; (4) import tick box **"these items already have labels"** plus a **"Label is fine"** button (with select-all) take items off without printing | **Owner** | (4) so the iPOS switchover doesn't put the whole shop on the list |
| 2026-09-27 | Price sheet (6c): rows matched by **SKU, else barcode**, against products **and variants**; a SKU and a barcode on two different items is flagged, not applied | **Owner** | Covers sheets with either column; a variant's own code updates that variant |
| 2026-09-27 | Price sheet changes **selling price and cost only**; a blank cell keeps the current value; name/category/stock never change | **Owner** | A price sheet shouldn't be able to rename or restock anything |
| 2026-09-27 | Price sheet rows that **match nothing are shown and skipped**, never added | **Owner** | A mistyped SKU must not create a stray item |
| 2026-09-27 | Price sheet preview has a **tick box per changed row** (all ticked to start); unchanged rows greyed; price below cost flagged amber but allowed | **Owner** | Leave out a row without editing the sheet |
| 2026-09-27 | History tab stock ledger is **recorded from now on** by the database (every writer), not rebuilt from past records; existing stock opens with one "Opening stock" line per item | **Owner** | A rebuilt past can't tie out (several writers leave no record); One Toy Store's real history starts at the iPOS switchover anyway |
| 2026-09-27 | Stock ledger has a **branch picker** plus **All branches** (combined running balance, Branch column); a transfer is out at one branch and in at the other | **Owner** | Check one branch's count against its ledger, or see the whole shop |
| 2026-09-27 | Price & cost history: **every change recorded**, **who/why where the app knows them**; other writers show "Other change" / no who. Old activity-log lines not copied in | **Owner** | Complete by construction; the old lines mostly lack who |
| 2026-09-26 | Profit reports **subtract returns** (D17): a returned item's profit comes back out | **Owner** | Profit should match money kept |
| 2026-09-26 | Product **History tab** (as in the iPOS item file): (1) price & cost change history with who, when and why (hand edit / delivery / accepted suggestion); (2) sales with date, **bill no** (links to the bill), qty, price, cashier, returns as minus lines; (3) a **full stock ledger** (purchases, sales, returns, adjustments, transfers, counts) with running balance, per variant. Today: price changes are only a free-text activity-log line (employee usually "Unknown", GRN cost changes not logged); `/api/reports/history-sale` shows sale id not bill no, caps at 500 rows, no variant split; no per-item ledger exists | **Owner** | Staff need to see an item's price and movement history in one click |
| 2026-09-26 | Shopify dev store: **later**. Phase B starts locally; Shopify-facing parts are tested on a dev store afterwards | **Owner** | |
| 2026-09-26 | Online orders take shop stock off **when the order arrives** (COD included), not when paid or shipped; cancel puts it back; a Shopify refund puts back only what Shopify restocked | Claude (default; owner can change) | Matches what Shopify does to its own stock, so the two counts agree and the counter can't sell a toy already promised online. Blocker 1a |
| 2026-09-26 | The daily Shopify stock check **only reports** (notification + Reconciliation tab); the owner presses "Set Shopify to SanoPOS counts" to fix. Revisit after the 2-week parallel run | **Owner** | Nothing changes on the live website without the owner seeing it first. Blocker 2e |
| 2026-09-26 | Shopify is set to SanoPOS's shop count as Shopify's **available** count | Claude | SanoPOS takes stock off when an online order arrives (1a), and Shopify's "available" is on-hand minus orders not yet shipped, so the two are the same number. No separate "minus unshipped" setting needed |
| 2026-09-26 | Which Shopify location each SanoPOS shop updates = the existing **location map** (Shopify → Mappings). One Toy Store picks it at setup on the dev store | open, owner at setup | |
| 2026-09-26 | Offline sale replayed when SanoPOS stock is too low: **accept it**, let stock go negative, mark the sale "sold offline past stock" and list the items in the sync notice for a recount. Live counter sales keep the stock check | **Owner** | Money was taken and the toy left the shop; refusing only makes the books wrong. Blocker 3e |
| 2026-09-26 | Offline sale lands **when and where it happened**: keeps the time it was rung up and goes into the till session open at that moment, even if since closed. A till closed before its sale synced shows extra cash at close that clears when the sale arrives; the sync notice names the till | **Owner** | Day and till reports match the counter. Blocker 3f |
| 2026-09-26 | Lock button **off while offline** ("Lock needs the internet"); a screen already locked says so plainly. No PIN kept in the browser | **Owner** | Unlock checks the PIN on the server |
| 2026-09-26 | Offline bills ring at **shelf price**: no automatic promotions or price lists offline; hand discount (F2) still works; POS says "Automatic discounts are off while offline" | **Owner** | Simpler, fewer ways to go wrong |

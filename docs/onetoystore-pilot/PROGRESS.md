# One Toy Store pilot: progress

**Goal:** One Toy Store (Packages Mall, Lahore) becomes SanoPOS's first real merchant. SanoPOS replaces iPOS.NET at the counter, and shop stock and Shopify stock stay in sync automatically. Along the way, we **prove with evidence** that SanoPOS works correctly.

**Scope freeze:** retail core only (selling, returns, purchasing, stock, cash closing, reports, Shopify sync) plus whatever One Toy Store specifically needs. No new verticals, redesigns or unrelated features. FBR stays off.

**Branch:** `onetoystore-pilot`

## ▶ Where we are / next (updated 2026-09-27)

**Phase B order** (agreed with owner 2026-09-26):
1. ✅ Stock count: unscanned left alone + "full count" tick box (D6) — `45b63ffb`
2. ✅ Profit takes returns off (D17), plus D20–D23 found on the way — `e3c3503d`, `42992dae`, `e143ee5b`
3. ✅ Online orders reduce shop stock (blocker 1, 1a–1f) — `f92533b5`. Proven locally in tests and on the real backend with a signed webhook and no login. **Still to prove on the Shopify dev store** (Phase C): real Shopify payloads, and registering the 3 webhooks
4. ✅ "Set Shopify to SanoPOS counts" button + daily drift check (blocker 2, 2a–2h). Found on the way: **the everyday sync was never switched on** (2h), so no till sale ever reached Shopify. Proven locally against a fake Shopify in tests. **Still to prove on the Shopify dev store** (Phase C): the exact field name Shopify's API version wants for the set (see 2a), and a real count set
5. ✅ Offline counter (blocker 3, 3a–3j): catalogue copy in the browser, scan/search/variants offline, offline reload keeps selling, queued sales land at their own time and till and are accepted past stock. Proven in tests and in a real browser on a production build (see Blocker 3). **Still to prove in the shop** (Phase E): the real counter PC, scanner and router, with the internet unplugged
6. ⏭ **NEXT:** Suggested new selling price when a delivery arrives at a different cost (cost-plus margin per category/brand, nearest Rs 50, owner confirms each). Needs the margin % per category/brand from the owner
7. Product **History tab**: price/cost changes, sales by bill no, full stock ledger with running balance (owner request, see Decisions log)

**Current proof:** shop-day **112 pass, 0 fail** (re-run after blocker 2); `ots-retail-core.test.js` 47 tests; `ots-shopify-stock.test.js` 18 tests (17 fail on the old code); online-order webhook proof on the real backend **7 pass, 0 fail**; blocker 3: `ots-offline.test.js` 14 backend tests + 11 new frontend test files, browser proof under Blocker 3. Everything committed on `onetoystore-pilot`, not pushed.

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
| **B** | Owner-decision fixes + the 3 blockers + owner requests (order below) | 🟡 in progress: steps 1–5 done (all 3 blockers) |
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
| D13 | 🟡 | Supplier payment only per delivery invoice, not on account | open, owner decision |
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
| D19 | 🟡 | Scanning a variant runs the modifier lookup with the variant id as a product id (harmless 403 today; pre-existing pattern shared with the variant picker) | open, low |

---

## Test suite baseline (Phase A step 1), 2026-09-25

| Suite | Result | Notes |
|---|---|---|
| Backend unit | **749 / 752 pass** (55/57 files) | 3 failures, none retail: worker-status test expects the marketplace-sync worker "running" (that worker is a known stub); 2 payment-gateway `isEnabled()` env tests |
| Frontend unit | **201 / 201 pass** (25 files) | `npx vitest run` with no path also picks up 54 Playwright browser specs, which "fail" because Vitest can't run them. Not real failures. Run `npx vitest run tests/unit`. |
| Backend integration | **1,801 pass, 26 fail, 29 skipped** (155 of 202 files pass) | **33 files can't load at all** (30 import a deleted helper `tests/helpers/createTestApp`; 3 use Jest syntax). Those 33 include the dedicated retail tests: `purchase-orders`, `returns-exchange`, `shifts`, `shift-linkage`, `supplier-payables`, `reports_accuracy`, `inventory`, `promotions`. **So most of the retail core had no running test.** The 26 failures are the same 12 files already triaged in July as stale test fixtures (e.g. sales tests written before a sale needed an open till); none are new. |
| Backend integration, **after the 13 fixes** (re-run 2026-09-26) | **1,823 pass, 26 fail, 29 skipped** | Compared test-by-test against the baseline: **0 new failures**, 0 disappeared, the same 26 failing. The +22 are the new `ots-retail-core` regression tests, all passing. |
| Backend integration, **after blocker 1** (2026-09-26, ~36 min) | **1,848 pass, 26 fail, 29 skipped** | Pass count = 1,823 + 15 regression tests added for D6–D23 + 10 for blocker 1, exactly. Failures still 26, all in the stale-fixture files; none in any Shopify/order file. The 11 order-adjacent files were also run with and without the change: identical failures. |
| Backend unit, **after blocker 3** (2026-09-27) | **748 / 752 pass** | 4 failures, none from blocker 3: the 3 baseline ones (worker-status ×2, payment-gateway env) plus `frontend-coverage-drift`, which flags 2 endpoints from blockers 1/2 with no screen calling them: `POST …/shopify/webhooks/orders/:tenantSlug` (headless by design → belongs in `frontend-coverage-baseline.json`) and `POST …/shopify/reconciliation/:id/fix` (its per-row buttons were removed in 2j; retire the endpoint or baseline it). Open |
| Frontend unit, **after blocker 3** (2026-09-27) | **262 / 262 pass** (35 files) | +61 blocker 3 tests |
| Frontend unit, **after D24** (2026-09-27) | **267 / 267 pass** (36 files) | +5 D24 tests |
| Backend integration, **after blocker 2** (2026-09-26, ~34 min) | **1,866 pass, 26 fail, 29 skipped** | 1,848 + the 18 new `ots-shopify-stock` tests, exactly. The same 12 stale-fixture files fail; none is a Shopify, stock, sales or returns file. |

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

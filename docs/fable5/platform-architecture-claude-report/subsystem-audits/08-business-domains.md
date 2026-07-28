# Subsystem Audit 08 — Business Domains & Critical Write Paths

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**

---

## 1. POS sale write path (`routes/sales.js` POST /api/sales, line 595)

**Entry:** `app.post("/api/sales", validate(CreateSaleSchema), …)` (:595). Body uses `cartItems` with item `id`/`price`/`quantity` plus ~20 optional linkage fields (folio, treatment folio, draft_order, field_visit, appointment, backorder_items — :596-651).

### Pre-transaction gates, in order
| Gate | Lines |
|---|---|
| Field-visit uuid→id resolution | 658-666 |
| **MOQ enforcement — field-rep orders only; POS bypasses by design** | 674-712 |
| Backorder payload validation with snapshot-price drift rejection (`BACKORDER_PRICE_DRIFT`) | 783-789 |
| Appointment / folio pre-checks | 806-893 |
| Field-visit ownership (`FIELD_VISIT_NOT_OWN` for non-managers) | 910-930 |
| Per-line price-override approval events (self-approve writes an `approval_events` row) | 983-1007 |
| Serialized-inventory validation — serials must equal line qty, be `available`, match product/variant, no cross-line reuse | 1026-1098 |
| **Open-shift requirement** | 1100-1121 |
| **Clock-in requirement** (tenant-TZ attendance check) | 1133-1151 |
| Customer-group / tier auto-pricing | 1156-1226 |
| **H1 server price authority** — re-resolves every line via `resolvePriceForContext`, 400s `PRICE_MISMATCH` if the client subtotal is >1% below server pricing; ⚠️ **fails open** per-line and globally on resolver errors | 1239-1298 |
| **Tax snapshot** via `resolveTaxSnapshot` | 1305-1321 |
| **Manual-discount permission gate** — re-runs `evaluatePromotions` server-side so a cashier can't launder a manual discount through fabricated `applied_promotions` | 1361-1407 |
| Payment-coverage check Σpayments ≥ total | 1449-1464 |
| Blacklist, wallet pre-check, credit-tender pre-flight with manager-PIN/perm override | 1466-1678 |
| Idempotency pre-check on `idempotency_key` | 1681-1691 |

### Transaction (:1697-2527)
- Loads kit map + batch-tracked map once
- Per-line `SELECT … FOR UPDATE` on `variant_outlet_stock`/`product_variants`/`outlet_stock` with availability gate (:1747-1829)
- `sales` INSERT (:1832)
- Promo-application audit rows under a SAVEPOINT (best-effort, :1861-1891)
- Backorder rows created in-tx (:1898-1907)
- `sale_items` INSERT with frozen per-line `tax_rate_at_sale`/`tax_amount_at_sale`/`hs_code_at_sale` (:1918-1952)
- Backorder fulfillment re-locked via `lockForFulfillment` (:1959-1974)
- Serial stamping + warranty dates in tenant-local day (:1981-2005)
- ⚠️ **Stock decrement is INLINE UPDATEs** (:2056-2104) — writes all three stock tables for variants and calls `batchStock.consumeBatches` (FEFO) for tracked lines
- Payments loop with ⚠️ **inline gateway card capture inside the transaction** (:2111-2121); gift-card redemption under `FOR UPDATE` (:2137-2179)
- Credit tender re-asserted under `FOR UPDATE` by `services/credit.js:assertCreditWithinLimit`; AR invoice `INV-AR-<saleId>` created and linked via `sales.customer_invoice_id` (:2191-2244)
- Folio / treatment-folio line attach (:2249-2276)
- Loyalty under `FOR UPDATE OF c` — redemption capped at live balance, earn multiplied by tier **server-side** (:2284-2354)
- Gift-card issuance and package sale/redeem in-tx (:2384-2483)
- Wallet debit re-checked under `FOR UPDATE` (:2494-2523)

### Post-commit
- Shopify sync-event enqueue + low-stock notify (:2578-2589)
- ⚠️ **Invoice numbering** — `invoice_sequences` per-year upsert producing `INV-YYYY-NNNNN`, assigned in a **second transaction** with 1 retry (:18-54, :2592)
- FBR enqueue when the `fbr_integration` flag row is enabled (:2594-2620)
- Restaurant draft/table-session flips, appointment completion with a `sale_id IS NULL` race guard, tip capture, commission calc — all fire-and-forget (:2627-2698)
- Racing duplicate idempotency keys hitting the 23505 unique index return a friendly 409 (:2783-2798)

### Returns (`routes/returns.js:155`, `requirePerm("manage_orders")`)
Idempotency pre-check (:182-208); transaction locks the original sale `FOR UPDATE` (:399) and **recomputes remaining qty from prior `return_items`** so concurrent returns serialize (:392-437); **H5 refund caps** — per-line refund_price ≤ sold price, header total ≤ sold value of returned lines (:439-486); per-line restock flag (scrap → shrinkage, :519-556); kit component restock + `returnToBatch` (:559-613); serial flip to `returned`/`warranty_claim` (:623-634); `credit_reversal` reduces the linked AR invoice under `FOR UPDATE` with a mirror payment row (:642-688); `store_credit` credits the wallet in-tx (:695-714). Post-commit: gateway refund (recorded-but-pending on failure, :720-746), FBR credit-note enqueue (:759-784), commission reversal (:787-793).

---

## 2. Inventory

**Transfers/adjustments** (`routes/inventory.js`): transfer POST (:54) runs one transaction (:129) calling `stockLedger.decrementStock` at source and `incrementStock` at destination, both `manageBatch:false`, with `batchStock.transferBatches` preserving batch identity (:146-169). Adjustments POST (:300) + `adjustBatches` (:360). Stock-count complete (:572) uses increment/decrement + `adjustBatches` (:612-633).

**`services/stock-ledger.js`** is the shared implementation (FOR UPDATE gate, 3-table variant write, typed `insufficient_stock`, FEFO by default; must run inside the caller's tx — :31-32, 75-151). Consumers: `inventory.js`, `purchase-orders.js`, `stock-conversions.js`, `supplier-returns.js`, `tier4/crm.js` (quotation convert), `services/service-tickets.js` — ⚠️ **but not the POS sale path itself**.

**PO/GRN receive:** `routes/purchase-orders.js` receive (:342) → transaction (:398) calls `incrementStock` with `manageBatch:false` (:435) then `batchStock.receiveBatch` to create a fresh lot with batch number/expiry/unit cost (:458-461). `routes/grn.js` adds scan-receive (:88) and supplier payables.

**Batches/FEFO** (`services/batch-stock.js`): a *parallel ledger* — `outlet_stock` remains authoritative; invariant Σ`stock_batches.remaining_qty` = outlet qty (:5-18). FEFO: no-expiry batches consumed last, then FIFO by id. ⚠️ **Drift-tolerant by contract**: shortfall consumes what exists, logs, **never blocks a sale** (:23-29). `routes/batches.js` exposes expiring/drift/cost-flow reads + write-off.

**Backorders** (`services/backorder.js`): rows created inside the sale transaction (`sales.js:1898`); conversion re-locks via `lockForFulfillment` (:129) and enforces order-time snapshot price.

**Serialized inventory:** status machine `available → sold → returned/warranty_claim`; bridge table `sale_item_serials` retained for audit.

---

## 3. Business Modules engine

**Catalog** (`config/business-modules.js`): every flag classified into a card (bucket A/B/C, `scope: "tenant"|"outlet"`, `sub_toggles`, `depends_on`) or UNMANAGED.

**Toggle engine** (`services/business-modules.js:toggleModule`, :827):
- Bucket C cards can't be toggled here — 409 `REQUIRES_SETUP` (:831-840)
- Enable auto-enables missing prerequisites; **platform locks** (`public.platform_module_locks`, via `getLockedKeys` :89) block enable of target+prereqs with 403 `MODULE_LOCKED` (:873-888) but **never block disable** (:913-914)
- Disable with enabled dependents 409s `HAS_ENABLED_DEPENDENTS` unless `cascade:true`; **Bucket C dependents are deliberately `left_connected`, never cascaded** (:930-941)

**`saved_flags` snapshot/restore:** `disableCardTx` (:636) snapshots managed-flag values — with an idempotency guard: a repeated disable of an already-off module **keeps the existing snapshot** instead of overwriting it with zeros (:646-651). `enableCardTx` (:573) restores exactly; bundle flags added post-snapshot default on; restored sub_toggles with unmet prereqs are skipped (:590-602); snapshot cleared on re-enable (:616-622).

Mode writes go through `backfillModesIfFirstRowTx` (:534) so the first mode row backfills all drifted modes before mode enforcement flips strict. Every toggle writes an `action_history` audit row (:685-698) and invalidates both caches (:958-963).

**Per-outlet** (`setOutletModuleState`, :1007): only `scope:"outlet"` cards; resolution `effective(outlet) = company AND (override ?? default_outlet_enabled ?? TRUE)` (`resolveOutletStates`, :307); `enabled:null` deletes the override; locks block only the enable direction. `getDisabledOutletIds` (:347) is a worker deny-list.

**Routes** (`routes/business-modules.js`): page/impact/outlet-toggle accept `manage_business_modules` OR `manage_outlet_modules` (:110, 234, 290); the company-level toggle requires `manage_business_modules` (:260). `rejectCatalogManagedFlagWrites` (:1148) locks the legacy flag-PUT for module-managed keys.

---

## 4. Subscription / billing lifecycle

**Routes** (`routes/billing.js`): `GET status` (:116), `pricing` (:49), `POST create-checkout` (:324) — inserts `payment_intents` then `paymentGateway.createCheckout()` and stores `gateway_ref` (:367-386); `add-outlet` (:256) and manual `request-upgrade` (:224) both `requirePerm("all_access")`.

**Webhook confirm** (`routes/webhooks.js:536`, mounted pre-tenant): adapter `verifyWebhook` first (:540). Resolves context by `gateway_ref`: platform billing via `payment_intents` (:188-191), idempotent on `status='completed'` (:195-198). On completion: intent completed; tenant updated to `payment_status='active'` with plan limits and `plan_expires_at`/`grace_ends_at` (+7 d) (:200-220); `payment_records` insert (:222-227); confirmation email enqueued (:234-262). Context 2 handles F04 deposit pre-auths by resolving the owning tenant schema from the gateway_ref (:288-300).

⚠️ **State machine driver:** trial→grace→expired transitions live in **`workers/email-worker-boss.js`'s hourly `billing-lifecycle-check` cron** (header :8): trial past `trial_ends_at` → `grace` with `grace_ends_at = trial_ends_at + 7 days` (:99-113); grace past end → `expired` (:119-133); paid subscription lapse → grace (:196-208).
*(`subscription-grace-worker-boss.js` is a different thing — **customer** subscription dunning inside tenant schemas, :111.)*

**Enforcement** (`middleware/plan-limits.js`): `requirePlanLimit` reads `tenants.max_*` live and counts rows (free = 1 outlet / 3 employees / 100 products; pro = 1 outlet, unlimited otherwise; **vans exempt from the outlet cap**, :16-42); `requireActiveSubscription` blocks non-GET writes when `payment_status='expired'`, exempting auth/billing/support/setup/health/receipts and free-plan tenants entirely (:100-136). ⚠️ **Both fail open** on their own lookup errors (:87-91, :135).

---

## 5. Wholesale / B2B

**Credit & AR — two-phase gate.** Friendly pre-flight in `sales.js` (:1523-1678) reads `credit_limit`/`credit_block_mode` (`off`/`warn`/`hard`); a hard block is overridable by `override_credit_limit` perm or manager PIN, **both writing `approval_events`** (the perm path added an audit row it previously lacked, :1590-1613). Authoritative re-check is `services/credit.js:assertCreditWithinLimit` (:39) under `FOR UPDATE` on the customer row — outstanding = Σ unpaid `customer_invoices.balance_due` (:53-64) — throwing 403 `CREDIT_LIMIT_EXCEEDED` (:67-79). Credit sales mint `INV-AR-<saleId>` with due date = tenant-local today + `payment_terms_days` (`sales.js:2206-2230`).

**Field sales** (`routes/field.js`): check-in POST (:167) is **idempotent on `client_uuid`** (:188-198, plus a unique-constraint catch at :273-277); geofence = `distanceMeters` vs `company_profile.field_geofence_meters` default 500 m — out-of-fence is **flagged, not blocked** (:222-227); selfie base64 uploaded to R2 (:232-240). Order capture rides `POST /api/sales` with `field_visit_id`; ownership enforced; field orders **skip clock-in but still require a shift** (`sales.js:1123-1133`) and are the **only** POS-path orders subject to MOQ.

**Schemes** (`services/promo-engine.js:34`): types `percent`/`fixed`/`threshold_percent`/`threshold_fixed`/`bxgy`/`slab_percent`; slab picks a **single** tier from `tier_rules` JSONB by total matched qty, no tier stacking (:142-156); `price_locked` lines never receive discount (:100); promo dates compared against **tenant-local** today (:35-49).

**Manufacturer portal** (`routes/manufacturer-portal/data.js`): all aggregates scoped by `manufacturer_partner_brands` (:46-55; empty brand list ⇒ zero rows); **the only customer attribute exposed is `customers.city` as "region"** (:322, 341, 402).

**MOQ & visibility:** `services/moq.js` (min qty + case-pack increments, portal/field only); `services/product-visibility.js` — restricted products visible only to explicitly linked customer groups; anonymous/ungrouped buyers see `visibility='all'` only (:46-118).

---

## 6. Restaurant

Checks are `draft_orders` (`services/restaurant-checks.js`): create (:18), splits by item/seat/amount/evenly (:70-238), merge (:239), courses fire/hold/expedite (:278-376) with a `releaseHeldCourses` path for the course-release worker (:377), tabs open/close (:428-452), shared `recalcCheckTotals` (:454), pro-rata `distributeAdjustments` on split (:467).

**KDS routing** (`services/restaurant-kds.js:sendToKitchen`, :242): reads outside the tx, writes inside one transaction (:243-249, 271); routing precedence **product > modifier_group > category > match_all** (`resolveStationForItem`, :59); `least_loaded` uses an in-transaction open-ticket count snapshot, **incremented provisionally per item so a batch doesn't dogpile one station** (:275-313); tickets grouped **one per (station, course)** — explicitly fixing an earlier N² kitchen-screen fanout (:287-322); `fired_at = NOW()` at insert makes bump−fired the prep time (:331-338). Bump (:431) / recall (:509).

**Settlement:** POS checkout carries `draft_order_id` + `table_session_id`; post-commit flips the draft to `completed` and the table session to `dirty` for busser cleanup (`sales.js:2627-2638`). **Tips:** `captureTipOnSale` fires post-commit (:2666-2686, Sentry-surfaced on failure); pooling open/close/distribute/void in `services/tips.js` (:122-427) — distribution writes both payout rows and commission earnings. Modifier price deltas are baked into the draft line at attach, so total recalc needs no special handling. QR kiosk / public menu / pay-at-table live in `routes/restaurant/` + `public-restaurant.js`.

---

## 7. Verticals

- **Rentals** (`services/rental-service.js`): availability re-checked *inside* a `FOR UPDATE` lock on the `rental_items` row (:307-314) and per-asset locks (:355); every contract transition (confirm/checkout/return/complete) re-locks the contract row (:505-727); overdue via `rental-overdue-worker-boss.js`
- **Rooms** (`services/room-service.js`): booking creation serialises on `pg_advisory_xact_lock(hashtext(current_schema() || ':room_type:' || id))` (:604-617) — **transaction-scoped** so it's pooler-safe, **schema-prefixed** because advisory locks are cluster-wide; bookings and folios use `FOR UPDATE` throughout (:767-877, 1054-1174); POS "charge to room" attaches a folio line inside the sale transaction (`sales.js:2249-2258`); nightly processing in `night-audit-worker-boss.js`; OTA/iCal in `room-channel-sync.js`
- **Treatment plans** (`services/treatment-plan-service.js`): folio settle under `FOR UPDATE` (:1257); POS "charge to plan" inserts `treatment_folio_lines` + `recalcFolioTotals` in the sale tx (`sales.js:2261-2276`); ⚠️ allergy checks are **advisory-only warnings** (:689-701); deposits parallel the room-deposit pre-auth flow
- **Bookings/scheduling (F06)** (`services/booking-services.js`): per-employee and per-resource `pg_advisory_xact_lock` keys (`:appt-emp-`, `:appt-res-`; :17, :42) serialise double-booking; no-show fee charge idempotent under `FOR UPDATE` (:425-437); POS checkout back-links and completes the appointment with a `sale_id IS NULL` guard (`sales.js:2644-2649`)
- **Memberships/classes/packages:** class capacity gated by `FOR UPDATE` on `class_sessions` (`services/class-bookings.js:75`); packages sold and redeemed *inside* the sale transaction (`sales.js:2444-2483`, 2012-2031) so rollback un-issues/un-redeems; returns flip untouched packages to `refunded` (`returns.js:543-551`)
- **Service tickets/repair** (`services/service-tickets.js`): ticket lifecycle + invoice-from-ticket; parts consumption goes through the **shared stock-ledger** (:14, ~:489) — one of the few verticals correctly on the shared writer

---

## 8. Integrations

**Shopify** (`routes/shopify/` + `backend/shopify/`): inbound webhook HMAC-verified against the captured raw body (`webhooks.js:35`); order ingestion via `upsertWebOrderFromShopifyPayload` (:205) → `applyWebOrderStockPolicy` (:109) — idempotent on `web_orders.stock_applied`, unmappable items short-circuit with a policy note (:167-170), ⚠️ applied stock is a **direct `outlet_stock` upsert** (:179-186). Outbound inventory: `routes/orders.js:enqueueInventorySyncEvents` (:763) writes `external_sync_events` with a composite idempotency key; missing mapping recorded as `failed_mapping` rather than dropped; `processPendingShopifyInventoryEvents` (exported at `orders.js:1344`) pushes to Shopify. POS sales/returns feed this queue post-commit.

**Marketplace hub** (Daraz/Meta/WhatsApp/Google Merchant): manual, UI-triggered sync via `routes/integrations/*`. ⚠️ **Background sync is deliberately not implemented** — `workers/marketplace-sync-worker-boss.js` is an honest stub that schedules nothing, unschedules legacy decorative crons, and reports `mode:"manual"` (:1-45).

**WooCommerce** (`routes/woocommerce.js`): connect/import/stock-sync (:33-192). **Couriers** (`routes/couriers.js`): config writes gated `manage_integrations` (:131-156); shipping at `POST /api/orders/:id/ship` (:221) through the adapter factory.

**FBR pipeline:** `services/fbr.js:enqueueFbrInvoice` (:143) — the W31 gate refuses to enqueue when `tax_mode='none'` or token/NTN missing (:161-180, fail-open on lookup error); inserts a `pending` `fbr_invoices` row then fires a pg-boss job (`retryLimit:5, retryDelay:60`, :191-207). `workers/fbr-worker-boss.js` is idempotent on `status='posted'` and abandons rows as `abandoned_no_creds` after max retries with missing credentials (:46-60). Backoff `[60, 300, 900, 3600, 14400]` s. Sales enqueue invoices, returns credit notes (`returns.js:764-780`), voids debit notes (`sales.js:503`).

**AI:** `routes/insights-ai.js` — `POST /api/insights/ask`, `requirePerm("view_sales_reports")`, requires `ANTHROPIC_API_KEY`, ⚠️ ***soft* flag check** reading the `feature_flags` row directly (:26-38, **not** `requireFeature`), ⚠️ in-memory **20-queries/day/tenant Map** (:1-13), model `claude-haiku-4-5-20251001` (:94). `services/ai.js` uses Haiku for text and `claude-sonnet-5` for vision (invoice-photo import) (:20-23).

---

## 9. Multi-channel order intake

**Storefront** (`routes/storefront.js`, pre-tenant via `resolvePublicTenantDb`): checkout (:636) **re-quotes server-side** with tenant `tax_mode` (:693-709); availability errors 400 with a backorder-offer hint for signed-in customers (:723-733); backorder lines snapshot the *server* quote unit price — **clients never dictate storefront prices** (:751-763); the transaction inserts `web_orders` (`source='storefront'`, `payment_status='pending'`, `public_order_token`) (:788-815).

**Endless aisle** (`routes/orders.js:1073`): cross-outlet availability check (:1136-1149), shared tax snapshot (:1166-1175), `web_orders` with `source='pos_endless_aisle'` (:1187-1202); a later fulfillment step locks and decrements `outlet_stock` (:1286-1298).

**Aggregators** (`services/aggregator-orders.js`): signature-verified webhook → `ingestOrder` idempotent on `UNIQUE(source, external_order_id)` (:230-242) → auto-accept through the online-inbox flow → **`settleAggregatorSale`** (:320): `FOR UPDATE` on `web_orders` + `stock_applied` flag prevents double-booking (:324-331); shared tax cascade (:352-361); sale inserted with `payment_method = source` for channel traceability (:380-398); recipe lines get true plate cost via component rollup (:405-410); ⚠️ **stock decrement is unconditional and may go negative** — the order is already paid on the platform (header :14-19).

**Restaurant inbox** (`routes/restaurant-inbox.js`): accept/reject at :36/:63.

---

## 10. Notable risks / oddities

1. ⚠️ **The POS sale path does NOT use `services/stock-ledger.js`.** The decrement is inline in `sales.js:2056-2104`, and the ledger's own header says it was "extracted" from that path (:6-14) — **the sale path was never migrated onto it**. Same for the returns restock path (`returns.js:580-613`). **Two hand-synchronized implementations of the most critical write in the system**, plus a third in `shopify/order-service.js`.
2. ⚠️ **Inline card capture inside the sale DB transaction** (`sales.js:2111-2121): an external gateway HTTP call runs while row locks are held; if the gateway succeeds and a later in-tx step throws, the transaction rolls back but **the charge stands** — no compensation logic is visible at this call site.
3. ⚠️ **Invoice number assigned post-commit** (:2592): a sale can commit and then fail invoice finalization, returning 500 "Sale committed but invoice finalization failed" (:2770-2776) with a NULL `invoice_number` until retried. `generateInvoiceNumber` also uses **server-TZ** `new Date().getFullYear()` (:19), not tenant TZ.
4. ⚠️ **Offline replay loosens controls:** an `idempotency_key` sale **bypasses the clock-in check** and attaches to the most recent *closed* shift when none is open (:1104-1114, 1133) — a reconciliation edge.
5. ⚠️ **H1 price-authority gate fails open** per line and wholesale on any resolver error (:1260, 1273-1275, 1295-1298), with a 1%/≥1-unit tolerance — undercharge protection, not a guarantee.
6. ⚠️ **`points_earned` base value is client-supplied** — the server applies the tier multiplier (:2306-2308) and floors redemption at the live balance, but **never recomputes the earn base** from the sale total.
7. ⚠️ **`applied_promotions` audit rows persist client-sent snapshots as-is** (:1861-1891); server re-verification via `evaluatePromotions` runs **only** when the cashier lacks `pos_discount` (:1366-1398).
8. ⚠️ **Billing lifecycle transitions live in the email worker** (`email-worker-boss.js` :83-208) — disabling `EMAIL_WORKER_ENABLED` would silently also stop trial/grace/expired transitions.
9. ⚠️ **Plan limits and subscription enforcement fail open** on their own DB errors (`plan-limits.js:87-91, 135`).
10. ⚠️ **AI insights rate limit is an in-memory Map** (`insights-ai.js:1-13`) — resets on restart, per-instance only; the flag gate is a soft direct DB read, not `requireFeature`.
11. **Batch ledger drift never blocks sales by contract** (`batch-stock.js:23-29`) — correct product decision, but `stock_batches` can silently under-represent on-hand stock; `/api/batches/drift` exists to observe this.
12. **Aggregator settlement can drive stock negative by design** — reports consuming `outlet_stock` must tolerate negatives.
13. **Marketplace "sync worker" is a deliberate no-op stub** — the admin dashboard shows `mode:"manual"`; **any doc claiming background marketplace sync is wrong**.
14. **FBR enqueue in `sales.js` reads the `feature_flags` table directly** (:2596-2598) rather than the cached flags map — consistent behaviour, but a second flag-read convention.

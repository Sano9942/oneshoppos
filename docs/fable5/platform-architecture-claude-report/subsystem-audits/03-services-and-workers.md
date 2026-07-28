# Subsystem Audit 03 — Services, Background Workers, Integrations

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**

Scope: 79 `.js` files at `backend/services/` root, plus `couriers/` (16), `marketplace/` (7), `import/mappers/` (3); 26 workers in `backend/workers/` + 8 `setInterval` pollers in `boot/workers.js`.

---

## 1. Load-bearing infrastructure services

### `crypto.js` (57 lines) — integration-secret encryption
- **Format:** `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}` (:31, prefix at :7)
- **Algorithm:** AES-256-GCM, 12-byte random IV (:27-28), auth tag appended (:30)
- **Key derivation** (`getKeyBuffer`, :9-18): `INTEGRATION_SECRET_KEY` → falls back to `SHOPIFY_SECRET_KEY`. Accepts 64-hex (:12), 32-byte base64 (:14-15), **otherwise SHA-256s the raw string** (:17) — any passphrase silently becomes a valid key, no length enforcement
- ⚠️ **Degradation:** with no key configured, `encryptSecret` **returns the plaintext unchanged** (:26) — credentials land in the DB in the clear, no error, no log. `decryptSecret` throws only when a value *is* prefixed and no key exists (:38-39); unprefixed values pass through as legacy plaintext (:37)
- Idempotent re-encryption guard (:24); `maskSecret` returns `"••••"` (:50-55)

### `stock-ledger.js` (209 lines) — the shared on-hand stock writer
- Exports `decrementStock`, `incrementStock`, `insufficientStock` (:205-209)
- **Transaction requirement is explicit and unenforced.** Header states functions "must be called INSIDE the caller's `deps.db.transaction(...)`" (:31-32); both take a raw `client` (:75, :164) — but **no runtime assertion**
- **Locking:** variant path `SELECT … FOR UPDATE` on `variant_outlet_stock` (:89-95), falling back to `product_variants` (:101-105); non-variant path locks `outlet_stock` (:129-133)
- **Three-table write** on the variant path: upsert `variant_outlet_stock` (:113-119), `product_variants.stock` rollup (:120-123), `outlet_stock` (:124-127). The upsert deliberately lets a missing per-outlet row go **negative** (:116)
- **Gate:** `gate=true` (default) throws typed `statusCode:400`, `code:'insufficient_stock'` with `product_id`/`variant_id`/`available`/`requested` (:39-55). `gate:false` documented for stock-count corrections only (:66-67)
- **Batch delegation:** `manageBatch=true` by default → `batchStock.consumeBatches` FEFO (:145-148) / `returnToBatch` (:197-200)
- **Actual callers** (grep-verified): `routes/inventory.js:146,155,612,622`, `routes/purchase-orders.js:435`, `routes/stock-conversions.js:65,107,134`, `routes/supplier-returns.js:99`, `routes/tier4/crm.js:722`, `services/service-tickets.js:493,506`
- ⚠️ **`routes/sales.js` does NOT call it.** The header says it was *extracted from* the sale path (:5-14) — but the POS sale path still runs its own copy. **Two implementations of the same invariant remain in the tree.**

### `tax-snapshot.js` (221 lines) — per-line tax cascade
`resolveTaxSnapshot(db, {items, taxMode, taxInclusive, outletId, tenantId})` (:33). Cascade order:
1. **Outlet tax profile** (:108-121) — only when `outletId` set *and* `phase2_outlet_tax` on (:69-84). Matches `product_id` / `category_id` / catch-all, sorts by `priority DESC`, takes `[0]`. ⚠️ Whole block wrapped in a bare `catch {}` (:83)
2. `products.tax_id → taxes.rate` (:124-126)
3. `products.gst` legacy direct rate (:129-131)
4. Category-tree inherited `tax_id` (:134-147)
5. `0` (:149)

`taxMode === 'none'` short-circuits before the cascade (:44-47). Rounding: inclusive `gross*rate/(100+rate)`, exclusive `gross*rate/100`, 2dp (:164-166). Read-only, safe outside a transaction.
⚠️ Step 4 issues one `SELECT` **per line item** inside the loop (:140-143) — N+1 on a large cart.

Second export `resolveTaxForExplicitRate` (:201) for folio/non-product charges.

### `email.js` (109) + `email-templates.js` (1284)
- `sendEmail({type,to,tenant,data,subject,html})` (:47) — immediate Resend call; `subject && html` bypasses the template registry (:51-53)
- `resolveFrom` (:28-34): a hardcoded 5-entry `TENANT_TYPES` allowlist (`receipt`, `digest`, `customer_statement`, `manufacturer_partner_invite`, `manufacturer_partner_password_reset`) sends as `"{tenant.name} <{slug}@sanopos.com>"`; everything else uses the platform address
- `enqueueEmail(db, …)` (:90) — renders the template **at enqueue time**, pushes `{to,from,subject,html}` onto the pg-boss `"email"` queue with `retryLimit:3, retryDelay:60` (:99)
- ⚠️ The `db` first argument is **completely unused** — "kept for backward compat signature" (:78)

### `boss.js` (59) — pg-boss singleton
`getBoss()` (:14) lazy + **promise-deduplicated** (:16-17), nulls the promise on failure (:40-42). Config (:22-28): `deleteAfterDays: 7`, `archiveCompletedAfterSeconds: 86400`, `monitorStateIntervalSeconds: 30`. `shutdownBoss()` (:46) resets both globals in a `finally`.

### `payment-gateway.js` (348) — payment adapters
- `BasePaymentAdapter` (:23); three adapters in `ADAPTERS` (:268-272): `manual` (default), `xpay`, `sandbox`. Selection is **env-only**; unknown keys silently fall back to `ManualAdapter` (:279-283)
- `isEnabled()`: manual → `false`; xpay → `!!XPAY_API_KEY` (:122-124) — a live key, not just a name; sandbox → always `true`
- **HMAC verification** — `XPayAdapter.verifyWebhook` (:159-182): header `x-xpay-signature`, HMAC-SHA256 hex, `crypto.timingSafeEqual` (:167-168). Sandbox variant identical (:201-224). Missing secret/header → `{valid:false}` (fail closed)
- ⚠️ **Both `timingSafeEqual` calls are unguarded against length mismatch** (:168, :210). Node throws `RangeError` on differing lengths → a wrong-length signature header produces a **500, not a 400**. Contrast `shopify/utils.js:85-86` and `aggregator-orders.js:128`, which both length-check first
- ⚠️ `routes/webhooks.js:540` hardcodes `verifyWebhook("xpay", …)` — the only payment `verifyWebhook` call site, so `SandboxAdapter.verifyWebhook` is unreachable. Sandbox payments call `processWebhookEvent` directly (`routes/sandbox.js:14`), skipping signature verification entirely

### `logger.js` (10) — Pino singleton
`pino({level: LOG_LEVEL || "info"})`, `pino-pretty` only when `NODE_ENV !== "production"` (:5-7). Every consumer does `.child({component})`.

### `alerting.js` (183) — in-memory sliding-window alerts

| type | count | window | cooldown |
|---|---|---|---|
| `error_spike` | 10 | 5 min | 30 min |
| `db_pressure` | 1 | 1 min | 60 min |
| `backup_failed` | 1 | 1 min | **0** |
| `health_check_failed` | 1 | 1 min | 15 min |

State is a module-level `Map` (:16). Only `recordError` resets the window after firing (:100-104); `recordDbPressure` and `recordHealthCheckFailure` set `lastAlertAt` but **never reset `count`/`firstAt`** (:138, :169). `addError` dedupes by message, caps at 10 distinct (:47-54). `escHtml` (:174) escapes tenant names and messages.
⚠️ `backup_failed` is defined but **no exported function records it** — `module.exports` (:183) has only three recorders.

### `business-modules.js` (1185) — the toggle engine
`toggleModule(db, {key, enabled, cascade, actor, tenantId})` (:827):
- Unknown key → 404. **Bucket C rejects toggling in both directions** with `409 REQUIRES_SETUP` + `setup_route` (:831-840)
- Reads live flags+modes uncached in parallel (:842)
- Enable: computes unmet prerequisites (:853-855); a Bucket-C prerequisite fails closed with `409 PREREQUISITE_REQUIRES_SETUP` (:857-868)
- **Platform lock:** `getLockedKeys` queries `public.platform_module_locks` for `tenant_id IS NULL OR tenant_id = $1` (:91-95), explicitly schema-qualified so it works through the tenant handle. Hit → `403 MODULE_LOCKED` (:879-888). **Disable is never lock-blocked**
- All writes in one `db.transaction` (:894): flags + `tenant_modes` upsert + `tenant_business_modules` + one `action_history` audit row. Result names every side effect: `also_enabled`, `cascaded`, `left_connected`, `skipped_restores`, `modes_backfilled`, `flags_changed` (:843-850)
- **Snapshot/restore:** disable snapshots managed-flag values into `saved_flags`; re-enable restores exactly; full bundle defaults apply only on first enable; sub-toggles never blanket-enabled
- **The mode-drift trap:** writing a tenant's *first* `tenant_modes` row flips `requireMode` from fall-through to strict for **every** mode at once, so the engine backfills `enabled=true` rows for any registry mode already having a flag on, before the first row lands
- **Per-outlet** (`resolveOutletStates`, :307-335): `effective = companyEnabled AND (override ?? default_outlet_enabled ?? true)`. Only `scope === "outlet"` cards participate (:314)
- `getDisabledOutletIds` (:347-364) is the worker deny-list; ⚠️ **ignores company-level state** and returns `[]` for non-outlet cards (:349) — indistinguishable from "no outlets disabled"
- Impact-query scoping (:366-382): `parseImpactTable` regex-extracts the FROM table; the predicate builder **refuses** any query with join/group/having/union/`OR` and falls back to a tenant-wide count. The `OR` exclusion is a documented precedence-bug guard

### `outlet-copy.js` (203) — "copy settings from another outlet"
`COPY_SPECS` (:54-124) is both an allowlist and a **column-classification contract**: every column of every listed table must appear in exactly one of `scope`/`copy`/`stamp`/`skip`, drift-tested by `tests/unit/outlet-copy-drift.test.js` (:43-49).

7 copyable tables: `outlet_business_modules`, `pos_layouts`, `outlet_product_visibility`, `price_list_assignments`, `tip_pool_distribution_rules`, `kds_stations`, `approval_policies`. Two scope styles — plain `outlet_id`, and a polymorphic `scope_pair` (`scope_type='outlet'`/`scope_id`) used by `pos_layouts` and `price_list_assignments` that is **invisible to an `outlet_id` grep** (:64-66).

Deliberate non-copies with reasons (:13-35): `outlet_tax_profiles` (the table exists *because* outlets differ — a wrong inherit mis-charges tax silently), `menu_schedules` (restrictions, so copying can silently hide items), D6 checklist tables (would falsely mark a new outlet "set up"), floor plans, device registry, kiosk slots, `shopify_location_map`, `modifier_groups` (de-facto tenant-global; no UNIQUE key, so a copy would double rows on re-run).

`buildCopySql` (:127) emits one set-based `INSERT … SELECT` per spec; identifiers come only from the static map. Runs inside the **caller's** transaction (:172-173).

### `moq.js` (125), `product-visibility.js` (122), `geo.js` (41), `manager-pin.js` (78), `public-tenant-context.js` (33)
- **`moq.js`** — `validateMoq` (:62) batch-loads via `WHERE id = ANY($1::int[])`, returns `{ok, violations[]}`, **never throws** (:16). Reason codes `below_min`/`not_a_multiple`. POS intentionally never gated (:5-8)
- **`product-visibility.js`** — `visibility='all'` → everyone; `'restricted'` → only linked customer groups; anonymous/ungrouped see only `'all'`. `visibleProductSqlFragment` returns a `$PLACEHOLDER` token the caller must substitute (:60). Documented bypass paths: admin CRUD, reports, POS, manufacturer portal. Field reps pass the **customer's** id, not the employee's
- **`geo.js`** — `distanceMeters` haversine on `EARTH_RADIUS_M = 6_371_000`, rounded to whole metres. Returns **`null`** on any non-finite coordinate, with the contract that `null` means "check impossible" — store `gps_flagged=false, gps_distance_m=null`, i.e. **NULL ≠ pass** (:17-21)
- **`manager-pin.js`** — `verifyManagerPin` (:15). **Hard refusal at the top:** `isImpersonating === true` → 403 before anything else (:20-24). Format gate `/^\d{4,8}$/`. ⚠️ **Loads every non-deleted employee's PIN material and bcrypt-compares in a loop** (:34-50) — O(n) bcrypt per attempt, justified in-comment ("can't SELECT on a hashed column", "fewer than a few hundred employees"). Plaintext `pin_code` fallback (:46-49) short-circuits on match
- **`public-tenant-context.js`** — `resolvePublicTenantDb` (:8). ST short-circuits (:9). MT: slug from `?tenant`/`x-tenant-slug`, missing → 400; `WHERE slug=$1 AND status='active'` → 404; then `getDb`. `IS_MULTI_TENANT` read **once at module load** (:6)

---

## 2. Other root services (one line each)

| File | Responsibility |
|---|---|
| `admin-login-alert.js` | Super-admin login from unseen IP (30-day window) → ops alert; detection split from send |
| `admin-totp.js` | otplib RFC-6238 TOTP + bcrypt-hashed single-use recovery codes; **no DB access** |
| `aggregator-orders.js` (676) | foodpanda/Careem ingestion; 19 exports incl. `verifyWebhook`, `ingestOrder`, `settleAggregatorSale`, `deadLetter` |
| `ai.js` | Anthropic wrapper — Haiku for descriptions/tags, Sonnet vision for invoice extraction |
| `allocation.js` | Fulfillment allocation — pickup → fixed outlet, ship → highest-stock outlet |
| `approval-policy.js` | `evaluatePolicy`/`recordApprovalEvent` over 8 action types |
| `backorder.js` | Wholesale split-shipment engine |
| `batch-stock.js` (441) | FEFO batch ledger *underneath* stock-ledger; a **parallel** ledger — `outlet_stock` stays authoritative |
| `booking-availability.js` | `getAvailableSlots`, `checkOverlap`, `findFreeResource` |
| `booking-reminders.js` | `processPendingReminders` — driven by the boot setInterval poller |
| `booking-services.js` (487) | Appointment create/reschedule/cancel/no-show + `lockEmployeeCalendar` |
| `catalog-scheduler.js` | `applyScheduledChange` — **security-critical allowlist**: `field_name` must be in `PRODUCT_FIELDS`/`VARIANT_FIELDS` (:35-38) because it's interpolated into `UPDATE ${table} SET ${field}` (:41) |
| `class-bookings.js` | **`FOR UPDATE` on `class_sessions` serialises all booking/cancel** (:7-9) |
| `client-service-records.js` | Salon service history; skeleton rows auto-created at checkout |
| `commission-calc.js` | Per-line attribution (`item.staff_id` beats cashier), one row per (employee, sale) |
| `contracts.js` | Contract lifecycle + event log |
| `credit.js` | **Authoritative** on-account credit gate — `FOR UPDATE` on the customer row, sums AR under that lock |
| `customer-invoicing.js` | B2B numbering/totals/balance; due date = `tenantToday + Net-X` |
| `customer-notify.js` | The single customer status-notification dispatcher over SMS/email/WhatsApp |
| `deposit-engine.js` (373) | Unified deposit/pre-auth driven by an `ENTITY_ADAPTERS` registry (:35); `room_booking` and `treatment_plan` are hold-mode |
| `embedded-barcode.js` | EAN-13 price/weight-embedded decoder for deli/butcher scales |
| `fbr.js` (224) | Pakistan tax e-invoicing. `BACKOFF_DELAYS = [60,300,900,3600,14400]` s (:10). Invoice date uses `tenantToday(tz ?? "Asia/Karachi")` after a pre-05:00 PKT off-by-one-day bug (:14-18) |
| `forms.js` (399) | Form builder/renderer; snapshots field definitions per submission |
| `inventory-intelligence.js` | **Pure, no DB** — `assignAbcRanks`, `computeVelocity`, `computeGmroi`, `suggestReorderQty` |
| `kit-engine.js` (370) | BOM/recipe engine for kit vs assembled products |
| `lifecycle-events.js` | Append-only `public.tenant_lifecycle_events`; **fire-and-forget, must never throw into the caller** |
| `marketing.js` | `resolveAudience`, `enqueueCampaignSend` |
| `members.js` (418) | `deriveMemberStatus`, `recordCheckin`, `STATE_RANK` |
| `menu-schedule-resolver.js` | Day-parting. **Schedules are restrictions, not allowlists** — zero rows = always available. 60 s per-outlet in-process cache |
| `messaging.js` | Thread/message inbox; auto-resolves customer from inbound WhatsApp number |
| `meta-webhook.js` (151) | Meta/WhatsApp inbound verification — hex HMAC, **app-level** secret (which is what lets verification run *before* tenant resolution, :8-11), strict shape check, no replay window (Meta sends no timestamp). Header warns the three raw-body verifiers **are not interchangeable** |
| `modifiers.js` | Modifier groups/options; constraint validation lives here, not in Zod |
| `online-inbox.js` | Converts unaccepted `web_orders` into restaurant `draft_orders`; prefixes notes `[external]` |
| `packages.js` | Service package sell/redeem/reverse/expire |
| `phase4-polling.js` (20) | `getChangesSince` — ⚠️ **table name interpolated directly into SQL** (:13), no allowlist |
| `preset-apply.js` | `applyPreset`/`expectedFlagsForPreset` — the one "apply industry preset X" implementation |
| `pricing.js` | Customer-group + loyalty-tier resolution; **group and tier discounts stack additively** |
| `printer.js` (498) | ESC/POS USB + raw TCP; `resolvePrinterConfig` routes fire-chit → station printer |
| `project-billing.js` / `projects.js` | Project lifecycle, milestones, quotation convert |
| `promo-engine.js` | Shared promotion evaluator, extracted verbatim from the POS route because the storefront had a **stale fork** missing slab tiers, brand scoping, and priority ordering (:4-9) |
| `quote.js` (374) | Storefront pricing engine composing tax-snapshot + promo-engine + pricing |
| `recall-service.js` (510) | Clinical recalls; one OPEN recall per (customer, subject, type) via partial unique index |
| `rental-service.js` (1284) | Rental lifecycle + `computeLateFee` |
| `reservation.js` | Inventory reservations |
| `restaurant-checks.js` (505) | Check lifecycle, 4 split strategies, merge, course fire/hold, tabs, `recalcCheckTotals` |
| `restaurant-floor.js` | Floor plans + table sessions |
| `restaurant-kds.js` (577) | KDS stations, send-to-kitchen, bump/recall, routing (`resolveStationForItem`, `pickByStrategy`, `LEAST_LOADED_COOLDOWN_MS`) |
| `retail-flag-preset.js` | Named seed-flag bundles applied at wizard completion |
| `room-channel-sync.js` | OTA iCal import/export feeds |
| `room-deposits.js` / `room-night-audit.js` | Pre-auth wrapper; `runNightAudit`, occupancy |
| `room-service.js` (**1549 — largest**) | Room types, availability, booking lifecycle, folios |
| `service-tickets.js` (805) | Repair tickets, `revealPasscode`, invoice-from-ticket. One of only two services calling stock-ledger directly |
| `sms.js` / `sms-templates.js` | `BaseSmsAdapter`, `GenericHttpAdapter` (configurable `field_map`), `TwilioAdapter`; template render |
| `storefront-cart.js` | Anonymous/authenticated cart; delegates to moq + product-visibility |
| `subscriptions.js` (376) | `computeNextPeriod` is **calendar-anchored** — adds whole months so a 15th-of-month enrolment stays on the 15th |
| `tips.js` (479) | Tip capture + shift pooling (open/close/distribute/void) |
| `treatment-plan-service.js` (1503) | Clinical plans, subjects, sessions, charting, lab orders, folios |
| `waitlist.js` | Class + appointment waitlist offers; claims book through the **same locked paths** |

### `services/couriers/` — 16 files
`index.js` `getAdapter(key, config)` (:33-36) maps slug → class, ⚠️ **falling back to `GenericAdapter` for any unrecognised key** (:34). `ADAPTERS` has **14 entries** (:16-31): generic + 13 carriers (leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex). `base-adapter.js` is a 3-method abstract class where every method throws. Adapters receive **already-decrypted** credentials — decryption happens in the route layer.

### `services/marketplace/` — 7 files
`base-marketplace.js` — 4 throwing stubs. Six clients across **two structurally different pipelines**: Integrations-Hub pull/push (`daraz-client` 147, `meta-commerce` 103, `whatsapp-client` 97, `google-merchant` 113) and delivery aggregators (`foodpanda-client` 217, `careem-client` 147), whose real surface is `static normalizeOrder(payload)`.

### `services/import/mappers/` — 3 files
`REGISTRY = {shopify, square}` (:14). Also owns the generic column mapper: `CANONICAL_FIELDS` (:49-59), `buildColumnMapper` which **drops unmapped columns** (:69-85), `suggestColumnMap` (advisory only).

---

## 3. Workers

`boot/workers.js:16` creates `global.__workerRegistry`; `recordGate` (:18-40) records **every** worker's gate at boot including unset ones, so `GET /api/admin/worker-status` can distinguish "env var missing" from "enabled but crashed" (:11-15). Registration wrapped in `tryRegister` (:342-352) — per-worker catch, stashes `register_error`. The whole pg-boss block is a `.then()` chain off `getBoss()` (:353), **not awaited**.

### 3.1 pg-boss workers

| Worker | Queue(s) | Cron | Env gate | Tenant-flag gate |
|---|---|---|---|---|
| `email-worker-boss` | `email`, `billing-lifecycle-check`, `campaign-email`, `campaign-scheduled-send`, `invoice-reminder`, `subscription-renewal` | `0 * * * *` on lifecycle | `EMAIL_WORKER_ENABLED` + `RESEND_API_KEY` | — |
| `fbr-worker-boss` | `fbr-invoice`, teamSize 10 | on-demand | `FBR_WORKER_ENABLED` | — |
| `cleanup-worker-boss` | `cleanup-dead-tenants` | `0 2 * * *` | `CLEANUP_WORKER_ENABLED` | — |
| `orphan-schema-scan` | `orphan-schema-scan` | `0 * * * *` + boot run | **defaults ON** | — |
| `adoption-snapshot` | `adoption-snapshot` | `0 */6 * * *` | `ADOPTION_SNAPSHOT_WORKER_ENABLED` | — |
| `marketplace-sync` | **none** | **none** | `MARKETPLACE_SYNC_WORKER_ENABLED` | — |
| `reservation-worker` | `expire-reservations` | `*/5 * * * *` | `RESERVATION_WORKER_ENABLED` | **deliberately none** |
| `subscription-grace` | `subscription-grace-check` | `0 * * * *` | `SUBSCRIPTION_GRACE_WORKER_ENABLED` | — |
| `subscription-dunning` | `subscription-dunning-check` | `15 * * * *` (offset) | `SUBSCRIPTION_DUNNING_WORKER_ENABLED` | — |
| `rental-overdue` | `rental-overdue-check` | `0 8 * * *` | `RENTAL_OVERDUE_WORKER_ENABLED` | `phase4_rentals` + outlet filter |
| `hold-expiry` | `hold-expiry-sweep` (singleton) | `0 * * * *` | `HOLD_EXPIRY_WORKER_ENABLED` | `phase2g_holds` |
| `channel-sync` | `channel-sync-poll`, `room-reservation-expiry` | `*/10 * * * *` | `CHANNEL_SYNC_WORKER_ENABLED` | `room_channel_sync` / `phase4_room_management` |
| `night-audit` | `night-audit-run` | `0 22 * * *` | `NIGHT_AUDIT_WORKER_ENABLED` | `phase4_room_management` |
| `deposit-hold-expiry` | `deposit-hold-expiry-sweep` | `0 * * * *` | `DEPOSIT_HOLD_EXPIRY_WORKER_ENABLED` | **none** |
| `room-overdue-checkout` | `room-overdue-check` | `0 11 * * *` | `ROOM_OVERDUE_WORKER_ENABLED` | `phase4_room_management` |
| `treatment-plan` | `treatment-plan-daily-check` | `0 9 * * *` | `TREATMENT_PLAN_WORKER_ENABLED` | `phase4_treatment_plans` |
| `recall` | `recall-outreach-check` | `0 10 * * *` (offset) | `RECALL_WORKER_ENABLED` | `clinical_recalls` |
| `abc` | `abc-daily` | `0 2 * * *` | `ABC_WORKER_ENABLED` | `phase2g_inventory_intelligence` |
| `anomaly` | `anomaly-daily` | `30 2 * * *` (offset) | `ANOMALY_WORKER_ENABLED` | `phase2g_risk_controls` |
| `expiry-alert` | `expiry-alert-daily` | `0 6 * * *` | `EXPIRY_ALERT_WORKER_ENABLED` | `batch_expiry_tracking` |
| `retail-digest` | `retail-weekly-digest` | `0 8 * * 1` | `RETAIL_DIGEST_WORKER_ENABLED` | `retail_weekly_digest` |
| `shift-auto-close` | `shift-auto-close` | `0 * * * *` | `SHIFT_AUTO_CLOSE_WORKER_ENABLED` | `shift_auto_close` |
| `attendance-auto-close` | `attendance-auto-close` | `0 9 * * *` | `ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED` | — |
| **`course-release`** | `course-release-sweep` | **`* * * * *`** | `COURSE_RELEASE_WORKER_ENABLED` | `phase4_restaurant` |
| `kds-load-snapshot` | `kds-load-snapshot` | `*/15 * * * *` | `KDS_SNAPSHOT_WORKER_ENABLED` | `phase4_restaurant_kds` |
| `reservation-reminder` | `reservation-reminder-check` | `*/15 * * * *` | `RESERVATION_REMINDER_WORKER_ENABLED` | `phase4_restaurant_reservations` |

### 3.2 `setInterval` pollers (all in `boot/workers.js`, no file in `workers/`)

| Poller | Interval | Gate |
|---|---|---|
| SQLite auto-backup | 24 h | only when `DATABASE_URL` **unset** |
| `cleanupSyncEvents` | boot + 24 h | none |
| `cleanupReportScheduleArtifacts` | boot + 24 h | none |
| `closeStaleAttendanceSessions` | boot + 24 h | none |
| Shopify sync | **30 s** | opt-out `SHOPIFY_SYNC_WORKER_DISABLED` |
| Report schedule | **60 s** | opt-out `REPORT_SCHEDULE_WORKER_DISABLED` |
| Catalog scheduler | 60 s | opt-in |
| Booking reminders | **5 min** + boot run | opt-in |

**The mix:** 26 pg-boss workers vs 8 pollers. **Booking reminders is the confusing hybrid** — registered *inside* the pg-boss `getBoss().then(...)` block (it needs `boss` to enqueue emails) but is itself a `setInterval`, so it **does not survive a crash mid-cycle** the way real pg-boss jobs do. `closeStaleAttendanceSessions` correctly reads per-tenant `company_profile.timezone` and compares `(session_start AT TIME ZONE $1)::date < (NOW() AT TIME ZONE $1)::date` rather than `CURRENT_DATE`.

### 3.3 Tenant scoping — two competing patterns

`tenant-job-context.js` (95) is the intended one: `withTenantContext(pool, slug, fn)` (:53) validates against `SLUG_PATTERN = /^[a-z0-9_]+$/` (:32) — necessary because `SET search_path` cannot be parameterised (:29-31) — acquires a dedicated client, sets the path (:62), and **always** resets to `public` and releases in `finally` (:80-92). The `db` handed to `fn` is only `{query, transaction}` (:64-77).

- **Uses the helper:** `channel-sync`, `email`, `hold-expiry`, `night-audit`, `recall`, `subscription-dunning`
- **Raw `tenant_${slug}.` interpolation:** `adoption-snapshot`, `email` (its `getTenantEmail` helper), `fbr`, `orphan-schema-scan`
- **Neither:** `deposit-hold-expiry` uses `tenantDbMgr.getDb()` directly

### 3.4 `email-worker-boss.js` — the billing brain
`billing-lifecycle-check` runs 7 transitions per hourly tick against `public.tenants` (:76-212): trial warning ≤7 d (:80-94); trial→grace with `grace_ends_at = trial_ends_at + 7 days` (:97-114); grace→expired + lifecycle event (:117-134); billing-expiry warning and overdue for tenants with **no `payment_records` row** (:137-165); renewal warning for those that **have** one (:168-184); active-paid→grace (:187-209). Every branch filters `plan != 'free'`.

Dedup: `singletonKey: "${type}:${tenantId}:${today}"` (:67) where `today` is **UTC day** (:37-39).

`campaign-email` (:265) sends via Resend **first**, then updates deliveries, then re-throws so pg-boss retries (:322) — at-least-once, so a DB failure after a successful send causes a re-send.

---

## 4. `backend/shopify/` — 4 files

**Token storage:** `shopify_connections` rows with `access_token`/`webhook_secret` in `enc:v1:` format; `getActiveShopifyConnection(db, decryptFn)` (:106-117) fetches highest-`id` `WHERE is_active` and decrypts via an **injected** function (keeps the module crypto-free). `crypto.js` (37) wraps `services/crypto.js`, returning `""` on falsy input instead of throwing; also carries `logShopifyEvent` (:17-31) writing to `console.*` — **not** wired to the Pino singleton.

**Client** (`client.js`, 535): all calls funnel through `shopifyGraphqlRequest(connection, query, variables, _retries=3)` (:25). Endpoint `https://{shop}/admin/api/{apiVersion}/graphql.json` (:37), header `X-Shopify-Access-Token` (:43), default `api_version "2025-10"` (:34). Response parsing distinguishes empty body / unparseable-but-JSON-looking / wrong content-type with a 180-char preview (:47-72). **Throttling** — Shopify signals `THROTTLED` on an HTTP 200, so the client recursively retries up to 3× with 2 s if `requestedQueryCost > 500` else 1 s (:83-91). Non-empty `errors[]` is a hard failure even on 200 (:93-95). **No retry for plain network errors** — only the throttle path retries.

**Webhook handling lives here as pure functions**, not routes (`utils.js`):
- `verifyWebhookSignature` (:74-90) — HMAC-SHA256 → **base64** (:82), length-checked *before* `timingSafeEqual` (:85-88), structured `{ok, reason}` with `no_secret_configured`/`missing_signature`/`invalid_signature`
- `evaluateWebhookTimestampWindow(header, now, maxAge=10min, futureSkew=5min)` (:22-40) — **fails open on a missing header** (:28-30), closed on unparseable/out-of-window
- `buildWebhookIdempotencyKey` (:62-72) — prefers the webhook-id header, else synthesises from order id + timestamps
- `baseRetryDelayMinutes` (:3-10): 1 → 5 → 15 → 60 → 240, plus jitter scaled to tier
- `canApproveReconciliationRequest` (:52-60) — segregation of duties: both ids present and different

**Sync** (`order-service.js`, 311): factory `createOrderService(db, getActiveShopifyConnection)` (:8) with both dependencies injected. `upsertWebOrderFromShopifyPayload` idempotent on `(source='shopify', external_order_id)`. `applyWebOrderStockPolicy` decides apply/reverse/no-op from two pure predicates (:10, :18), resolves outlet via order → connection default → location map, and maps each line by direct id → variant SKU → variant barcode → product barcode. Any unmappable item **aborts the whole operation** — no partial application.
⚠️ The stock mutation is a **direct `outlet_stock` upsert** (:179-181): `INSERT … ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`. It bypasses `stock-ledger.js` entirely: no `FOR UPDATE`, no availability gate, no `variant_outlet_stock`/`product_variants.stock` write, no batch ledger. **A third stock-movement implementation.**

---

## 5. `backend/utils/` — 9 files

| File | One line |
|---|---|
| `tz.js` (211) | Timezone boundaries via `Intl.DateTimeFormat` + binary search, no external lib. The trailing `Z` on `UTC_FMT` output is **load-bearing** — a naive `"YYYY-MM-DD HH:MM:SS"` is parsed by Postgres in the *session* timezone, so a non-UTC session lands the day boundary hours off (:12-18). ⚠️ Header comment still says "stored as UTC in SQLite" — stale |
| `r2.js` (91) | R2 S3-compatible client built **at module load** (:24-33), or `null` when credentials incomplete. `uploadToR2` returns an **absolute** URL: `R2_PUBLIC_URL/{key}` → `APP_PUBLIC_BASE_URL/r2/{key}` → else **throws** (:68-76), because a bare relative `/r2/<key>` would resolve against Vercel and never reach Railway. ⚠️ With no credentials it silently writes `backend/exports/<key>` and returns a **relative** path (:45-52), contradicting the invariant three lines below; `deleteFromR2` is a no-op when unconfigured so local fallback files are never cleaned up |
| `backup-pg.js` (149) | `spawn` wrappers around `pg_dump`/`pg_restore` **CLI binaries**. Flags `--format custom --no-owner --no-privileges`. ⚠️ `restoreSchema` treats **exit code ≤ 1 as success** (:73-78); `DATABASE_URL` passed as **argv** (:34, :58) — visible in the process list. `MAX_BACKUP_SIZE` 50 MB |
| `receiptEmail.js` (178) | `buildReceiptEmailHtml` — self-contained inline-styled HTML; duplicates `formatPaymentMethodLabel` on purpose to avoid pulling frontend code into the backend |
| `digestEmail.js` (207) | `buildDigestEmailHtml` — same pattern |
| `resendEmail.js` (117) | Direct Resend for **system** emails; lazy singleton that **throws** if `RESEND_API_KEY` unset |
| `alertEmail.js` (44) | `sendAlertEmail` — its own independent lazy singleton that **returns `null`** rather than throwing when the key is unset (:8), i.e. silently no-ops |
| `ics.js` (158) | Zero-dependency RFC 5545 builder with §3.3.11 escaping, CRLF line endings |

---

## 6. `backend/config/` — 6 files, pure config-as-code, zero DB access

### `business-modules.js` (1313) — the module catalog
**Buckets as implemented** (:29-38):
- **A — vertical modules** (11 cards): toggle flips the `tenant_modes` row **and** the flag bundle atomically. Only these carry `mode` + `setup_checklist`
- **B — operational toggles** (29 cards): flags only
- **C — "Set up / Connect" cards** (9 cards, :995+): **never a bare toggle** — returns `409 REQUIRES_SETUP`; state derives from a `connected_check`, either `{type:"query", sql}` (e.g. `fbr_digital_invoicing` checks NTN + token) or `{type:"env", env}` (`online_payments` → `XPAY_API_KEY`)
- **D is not a bucket of cards** — it's the name for `UNMANAGED_FLAGS` (:1220), a frozen map of 7 keys → exclusion reason (:1226-1240): `context_selection_required`, `context_header_enforced`, `kiosk_context_locked` (structural), `multi_company` (self-disable would lock a tenant out), `offline_returns` (gated rollout), `notifications` (gates the notification centre), `phase4_restaurant_preauth` (dormant). These stay writable via the legacy flag PUT

`MODULE_STATES` (:70-77): `off`, `on`, `setup_required`, `connected`, `locked`, `attention_required` (the last when an enabled Bucket-A card has a required checklist item un-done). `DB_ONLY_FLAGS = ["fbr_integration"]` (:83).

Derivations: `cardManagedFlags` = bundle + sub-toggles (:1247); `classifyFlag` → `primary`/`sub_toggle`/`unmanaged`/`null` (:1258-1270); `isCatalogManagedFlag` — ⚠️ **only primaries** are locked out of the legacy PUT (:1277-1280); `presetRecommendedModules` uses **lazy requires** to keep the config importable.

### `permissions-catalog.js` (166)
Entry shape `{id, label, category, module_key?, module_keys?}`. Built from four sources (:7-13): `DEFAULT_ROLE_PERMISSIONS` + `PERMISSION_RULES`, every guard call site, inline `req.employeePerms.includes(...)` checks, and the provisioner's `ALL_PERMISSIONS`. Stated invariant: **a module toggle never grants or revokes a permission** (:33-34). `manage_business_modules` and `manage_integrations` deliberately granted to **no** default role.

### `mode-registry.js` (127)
`MODE_REGISTRY` (:3-76) — 10 modes, each `{description, feature_flags_to_enable[]}`. `modeActiveForFlags` (:102-106) is the **single** "is this mode in use?" predicate — active when *any* registry flag is on; extracted so migration v135 and the business-modules backfill share one definition. `fullModeRows` (:115-118) returns **every** registry mode so a fresh tenant materialises all 10 rows — the countermeasure to the first-mode-row strictness trap.

### `country-packs.js` (347) / `industry-config.js` (883) / `vertical-usage-sources.js` (30)
- Country packs keyed by ISO code; PK carries `compliance_features: ["fbr_integration"]`, 11 couriers, GST 17%, fiscal year `07-01`; US has `default_tax: null`
- **23 industry presets** with `modes[]`, `labels{}`, `dashboard_widgets{}`, `pos_layout_mode`, portal copy overrides
- 14 usage-key → `{table, mode, where?}` mappings for admin vertical-usage counts

---

## 7. Notable risks / oddities

**Security**
1. **`crypto.js:26` — silent plaintext fallback.** No key → every courier/marketplace/Shopify credential written unencrypted, no throw, no log. No boot assertion covers these two vars.
2. **`crypto.js:17` — unbounded key material.** A one-character secret produces a structurally valid AES-256 key.
3. **`payment-gateway.js:168, :210` — `timingSafeEqual` without a length guard.** Wrong-length signature → `RangeError` → 500 instead of `{valid:false}`. The outlier among three implementations, and it handles money.
4. **`phase4-polling.js:13` — table name interpolated into SQL** with no allowlist, unlike `catalog-scheduler.js` which validates.
5. **`manager-pin.js:34-50` — O(n) bcrypt per PIN attempt** plus a plaintext `pin_code` fallback (:46).
6. **`routes/sandbox.js:14` calls `processWebhookEvent` directly**, bypassing signature verification; `SandboxAdapter.verifyWebhook` is dead code.

**Correctness / drift**
7. **Three independent stock-movement implementations** — `stock-ledger.js` (locked, gated, 3-table, batch-aware), the inline path in `routes/sales.js` it was extracted *from* but never replaced, and `shopify/order-service.js:179-181` (bare upsert). The header presents consolidation as done; grep says otherwise.
8. **`stock-ledger.js` has no transaction assertion** — the contract is comment-only; a plain pool handle would run `FOR UPDATE` and three writes non-atomically with no error.
9. **`tax-snapshot.js:140-143` — N+1 inside the per-item loop**, and `:83` swallows *all* errors from the outlet-tax-profile block, so a genuine query failure silently under-taxes with no signal.
10. **`processedToday` never resets** — grep finds no reset anywhere; the admin dashboard over-reports until deploy.
11. **`PG_BOSS_GATES` is bookkeeping only** — the real gates are hand-written `if` blocks; two hand-maintained lists that can drift.
12. **Worker registration is a non-awaited `.then()` chain** — `startAll` returns before any worker is live.
13. **`alerting.js:138,169` — two of three recorders never reset window state** after firing; counters grow unbounded for the process lifetime.
14. **`alerting.js:10` defines `backup_failed` with no recorder.**
15. **`alerting.js:16` — sliding windows are a process-local `Map`.** At N instances, alerts need N× the errors.
16. **`utils/r2.js:24` — client constructed at module load**; local-disk fallback returns a **relative** path, contradicting the absolute-URL invariant enforced three lines below.
17. **`backup-pg.js`** passes `DATABASE_URL` as argv and treats exit code 1 as success.
18. **`email.js:90` — `enqueueEmail(db, …)` ignores its first parameter.**
19. **`email.js:29` — tenant-branded-sender allowlist is a hardcoded 5-element array**; a new tenant→customer email type silently sends from the platform address.
20. **`email-worker-boss.js:37-39` — lifecycle dedup keys on the UTC day**, not tenant-local.
21. **Only *primary* flags are locked out of the legacy flag PUT** — sub-toggles can be flipped outside the snapshot/audit/cache-invalidation path.
22. **`getDisabledOutletIds` returns `[]` for non-outlet-scoped cards** — indistinguishable from "no outlets disabled".
23. **`marketplace-sync-worker-boss.js` registers a worker that does nothing** — no queue, no cron. Exists only to unschedule legacy crons and publish an honest `mode:"manual"` heartbeat. Correct and documented, but `MARKETPLACE_SYNC_WORKER_ENABLED=1` is a no-op flag.
24. **`course-release-worker-boss.js` runs `* * * * *`** — one job per minute per instance, fanning over every active tenant, to release held restaurant courses.
25. **`couriers/index.js:34` — unknown adapter keys silently fall back to `GenericAdapter`**, whose `bookShipment` resolves `{tracking_number: null}`. A typo in `adapter_key` produces a shipment that looks booked with no tracking number.
26. **`utils/tz.js` header still describes SQLite** in a Postgres-only codebase — stale but harmless; the implementation notes are current.
27. **`menu-schedule-resolver.js` — 60 s per-outlet cache with an in-process-only invalidator.** At 2+ instances a menu edit lags up to 60 s elsewhere.

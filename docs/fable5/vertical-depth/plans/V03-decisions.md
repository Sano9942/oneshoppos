# V03 — Decisions & Pause-List Items (await approval)

Three items the V03 plan routed to you for a decision, plus the migration/config status. The security scheme has its own file: [V03-webhook-security-proposal.md](./V03-webhook-security-proposal.md).

---

## 1. FBR on aggregator sales — **APPROVED + WIRED (2026-07-06)**

**Decision: YES.** Aggregator orders become real `sales` rows (with the v83 per-line tax snapshot). They are sales, so `settleAggregatorSale` now enqueues FBR invoices exactly like the POS anonymous-sale path — gated on the tenant's `fbr_integration` flag (a no-op for anyone not on FBR).

**As implemented** (`services/aggregator-orders.js:settleAggregatorSale`, mirroring `routes/sales.js:2294`):
- Gated on `SELECT enabled FROM feature_flags WHERE key='fbr_integration'`.
- Assigns the tenant's next `INV-YYYY-NNNNN` invoice number (shared `invoice_sequences` sequence, same as POS).
- Posts as an **unregistered consumer** (`customer = null`) — aggregator orders carry no NTN/CNIC, exactly how POS handles a walk-in. `enqueueFbrInvoice`'s own credential gate (`tax_mode`/`fbr_api_token`/`ntn`) still applies, so a mis-seeded tenant never backlogs the queue.
- `tenantSlug` is threaded `processInboundOrder → acceptAndSettle → settleAggregatorSale` (from `resolved.tenant.slug` in the route).
- Non-blocking: an FBR failure never rolls back the sale.
- Tested: with `fbr_integration` off, no invoice number is assigned; with it on (+ FBR creds), an `INV-*` number is assigned and an `fbr_invoices` row is enqueued.

**⚠️ Live-enablement guardrail:** posting to FBR's DI API is effectively irreversible (credit-note only, no delete). Before turning `fbr_integration` on for a **live** tenant that also takes aggregator orders, validate one real aggregator sale against the **FBR sandbox** first.

---

## 2. Drive-thru flag (`phase4_restaurant_drive_thru`) — **confirmed LIVE → propose KEEP (no deletion)**

The plan asked to confirm what the flag gates and delete it if dead (coordinating with completion 02's confirm item). **It is not dead.** Grep-confirmed live wiring:
- `frontend/src/pages/redesign/pos/restaurant/RestaurantFloorGrid.jsx:309` — when the flag is ON, the takeaway entry row writes `order_context = 'drive_thru'` (distinct from `'takeout'`).
- `RestaurantHeader.jsx:36` — renders the "Drive-Thru" order-context label.
- `migrate-pg.js` — `draft_orders.order_context` CHECK constraint includes `'drive_thru'`; `schemas/restaurant.js:44` enum includes it.

It's a thin-but-real wiring (a distinct order-context tag + header label for drive-thru service), not a decorative dead flag. **Recommendation: KEEP.** Deletion would drop a working POS distinction. No code change made.

---

## 3. Migration — **none required for V03 core**

The plan flagged "column check → STOP if migration needed." Verified against `schema-pg.sql`:
- **Idempotency** — `web_orders UNIQUE(source, external_order_id)` already exists. No migration.
- **Credentials** — `integration_settings` already has `webhook_secret` + `config_json`. No migration.
- **Dead-letter** — reuses `external_sync_events` (`idempotency_key` UNIQUE). No migration.
- **New flag `delivery_aggregators`** — added to `DEFAULT_FEATURE_FLAGS` (runtime merge, defaults OFF), `RESTAURANT_SEED_FLAGS` (new restaurant/cafe tenants get it ON at wizard), and a `schema-pg.sql` seed row. **No DDL migration** — the `feature_flags` table already exists and the flag defaults OFF via the in-memory merge.

**Existing-tenant discoverability — resolved WITHOUT a migration (2026-07-06).** Instead of a bulk `UPDATE feature_flags` data migration, connecting a foodpanda/Careem integration now flips `delivery_aggregators` ON for that tenant (`routes/integrations/credentials.js:/connect` — `INSERT ... ON CONFLICT DO UPDATE SET enabled=true` + cache invalidation). New tenants get it via the preset seed; existing tenants get it the moment they connect an aggregator. The flag is a **real gate** (not decorative), and no bulk migration or pause-list step is needed. The generic BYOK connect UI (gated by `marketplace_integrations`) is already reachable, so there's no chicken-and-egg.

---

## 4. Auto-accept configuration (informational — no approval needed)

Auto-accept is per-tenant, stored in `integration_settings.config_json.auto_accept` (bool). When ON, an inbound verified order goes straight to a KDS ticket + booked sale with zero human touch (the QSR requirement). When OFF, it lands in the online-ordering inbox for a manager to accept. The acceptor employee for zero-touch is resolved as the tenant's admin (falls back to any employee); the outlet is `config_json.outlet_id` or the tenant's primary outlet.

## 5. P2 / deferred (honest status)
- **Bar-tab pre-auth via F04 slot** — not built. P2, gateway-gated, low card penetration in PK bars/cafes (findings §04 rates it 🟡). The F04 deposit-engine slot exists; wiring `restaurant-checks.js:openTab` to it is a small follow-up when a card-heavy venue needs it.
- **Inbox channel badges (frontend)** — the backend already surfaces `source` (`foodpanda`/`careem`) on every inbox row and failed conversions stay visible (never dropped) + dead-letter to `/admin/dead-letters`. The badge/auto-accept-indicator is pure frontend rendering, deferred.
- **Combo component-level KDS routing** — an aggregator combo arrives as one payload line and routes to its primary station as one ticket. Component-level multi-station routing for combos is a known limitation (documented, matches the plan's fallback: "route the whole combo to its primary station and log the limitation").

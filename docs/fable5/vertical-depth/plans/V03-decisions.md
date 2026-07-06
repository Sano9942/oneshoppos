# V03 — Decisions & Pause-List Items (await approval)

Three items the V03 plan routed to you for a decision, plus the migration/config status. The security scheme has its own file: [V03-webhook-security-proposal.md](./V03-webhook-security-proposal.md).

---

## 1. FBR on aggregator sales — **propose: YES (enqueue like POS), currently NOT wired (pause-list)**

**Decision needed.** Aggregator orders become real `sales` rows (with the v83 per-line tax snapshot). They are sales, so by the plan's cross-surface lens the default is to enqueue FBR invoices exactly like POS sales — gated on the tenant's `fbr_integration` flag (so it's a no-op for anyone not on FBR).

**Why it's not wired yet:** FBR is on the completion pause-list. Taking a compliance action (posting an invoice to FBR's DI API) without sign-off is exactly what the pause-list guards. So `settleAggregatorSale` writes the sale + tax snapshot but does **not** call `enqueueFbrInvoice`. There is a clearly-marked **FBR HOOK POINT** comment at the enqueue site in `services/aggregator-orders.js`.

**To enable after approval** (one place): at the FBR hook point, after the sale is written, mirror the POS path in `routes/sales.js:2299`:
```js
// gated the same way POS is — only fires when fbr_integration is on
const { buildInvoicePayload, enqueueFbrInvoice } = require("./fbr");
const payload = buildInvoicePayload(/* sale + items + company */);
await enqueueFbrInvoice(client, { saleId, invoiceType: "sale", payload, tenantSlug });
```
Note: the webhook has no `req`, so `tenantSlug` must be threaded through `processInboundOrder` from the resolved tenant (already available as `resolved.tenant.slug` in the route). **Recommendation: approve YES** — a foodpanda sale that skips FBR while the same item sold at the counter posts to FBR is an audit mismatch.

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

**One deferred, approval-gated rollout step:** to flip `delivery_aggregators` ON for **existing** restaurant/cafe tenants (new tenants already get it via the seed), a one-line data migration would `UPDATE feature_flags SET enabled = true WHERE key = 'delivery_aggregators'` per restaurant/cafe tenant. That's a migration → pause-list → **not applied**. Until then the flag is OFF for existing tenants and the surface stays inert (correct: nothing appears until a tenant connects an integration anyway).

---

## 4. Auto-accept configuration (informational — no approval needed)

Auto-accept is per-tenant, stored in `integration_settings.config_json.auto_accept` (bool). When ON, an inbound verified order goes straight to a KDS ticket + booked sale with zero human touch (the QSR requirement). When OFF, it lands in the online-ordering inbox for a manager to accept. The acceptor employee for zero-touch is resolved as the tenant's admin (falls back to any employee); the outlet is `config_json.outlet_id` or the tenant's primary outlet.

## 5. P2 / deferred (honest status)
- **Bar-tab pre-auth via F04 slot** — not built. P2, gateway-gated, low card penetration in PK bars/cafes (findings §04 rates it 🟡). The F04 deposit-engine slot exists; wiring `restaurant-checks.js:openTab` to it is a small follow-up when a card-heavy venue needs it.
- **Inbox channel badges (frontend)** — the backend already surfaces `source` (`foodpanda`/`careem`) on every inbox row and failed conversions stay visible (never dropped) + dead-letter to `/admin/dead-letters`. The badge/auto-accept-indicator is pure frontend rendering, deferred.
- **Combo component-level KDS routing** — an aggregator combo arrives as one payload line and routes to its primary station as one ticket. Component-level multi-station routing for combos is a known limitation (documented, matches the plan's fallback: "route the whole combo to its primary station and log the limitation").

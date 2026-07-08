# Integrations — connectivity trace (does each actually call through?)

Read-only code trace, 2026-07-08, main @ v126. For each integration: is the outbound call real, is the
inbound path wired to a handler that mutates tenant data, what silently fails. Ranked most-severe
first. Findings only.

**Headline:** the payment, FBR, email, SMS, and delivery-aggregator paths are genuinely wired
end-to-end. The **marketplace and courier layers are where connectivity rot hides** — several inbound
webhooks are no-ops or silently fail, courier config/credentials are mishandled, and the marketplace
background worker calls nothing.

---

## TIER 1 — decorative stubs (log intent, never call through)

1. **Daraz inbound webhook is a no-op** — `routes/webhooks.js:567-579`. `POST /api/webhooks/daraz`
   logs and returns `{success:true}`; no tenant resolution, no `web_orders` write, no client call.
   Daraz orders only arrive via the *manual* `POST /api/integrations/daraz/pull-orders`.
2. **Meta inbound webhook is a no-op** — `routes/webhooks.js:502-511` (GET verify at `:489` works,
   token echo only; POST creates nothing).
3. **Marketplace sync worker schedules nothing** — `workers/marketplace-sync-worker-boss.js:47-66`
   no longer registers the order-poll/feed-check crons; it best-effort *unschedules* legacy ones and
   reports `heartbeat mode:"manual"`. Zero background call-through to Daraz/Meta/Google clients. **Doc
   drift:** `workers/CLAUDE.md` + `services/marketplace/CLAUDE.md` still describe the old "2 stub crons
   that fire and log" — the current state is no cron at all.

## TIER 2 — silent failures (wired but broken, errors swallowed)

4. **WhatsApp inbound messages never reach any tenant inbox** — `routes/webhooks.js:527-556` uses
   `require("../db-pg")` (the **public pool, no `search_path`**, `:540`) then inserts into tenant-scoped
   `messaging_threads`/`messages`. Every insert fails `relation does not exist`, caught+swallowed at
   `:553`. No tenant resolution at all (contrast payment webhook `:221`). Decorative.
5. **Courier `config_json` passed as raw TEXT, never parsed** — `routes/couriers.js:162,293,414,467`
   pass `config_json: courier.config_json` straight from the row (jsonb cast only on the *write* path,
   `:84-90`). Adapters reading `this.config.config_json?.field` get `undefined`: TCS `cost_center`
   (`tcs-adapter.js:11`), PostEx address codes (`postex-adapter.js:19-20`), DHL/FedEx `account_number`
   (→ "" → booking rejected). Core booking still works via `api_key`/`api_secret`.
6. **Courier credentials stored + transmitted in plaintext** — `couriers.js:106-115` stores
   `api_key`/`api_secret` with no `encryptSecret`; `getAdapter` receives them raw with no
   `decryptSecret` (`:159-163`). Contradicts `services/CLAUDE.md` ("pre-decrypted in the route layer")
   — nothing is encrypted, so nothing is decrypted. WooCommerce creds are likewise plaintext
   (`woocommerce.js:74-79`). (Shopify + marketplace creds ARE AES-GCM encrypted — asymmetric.)
7. **Daraz `push-inventory` is a permanently-empty path** — `routes/integrations/daraz.js`:
   `sync-products` fills `daraz_product_map` without `daraz_sku` (`:59-64`); `push-inventory` filters
   `WHERE daraz_sku IS NOT NULL` (`:136-139`) → always `{updated:0}`. `client.pushInventory`
   (`daraz-client.js:133`) is never reached.
8. **FBR invalid-token → silent `failed`, no alert/dead-letter** — `workers/fbr-worker-boss.js:109-134`:
   on a bad token, 5 retries then `status='failed'` on `fbr_invoices`/`sales`/`returns` and returns
   without rethrow (`:133`). No `alerting.recordError`, no dead-letter, no notification. Operators only
   discover failures on the `/fbr` dashboard — **which is nav-hidden for every tenant** (see
   claim-audit LEAK #5). Missing-creds → `abandoned_no_creds` (`:52-63`).
9. **Booking-reminder SMS skipped by design but marked sent** (`booking-reminders.js`, documented).
   `reservation-reminder-worker-boss.js:44` DOES send real SMS.

## TIER 3 — half-wired / manual-only (real calls, narrower than advertised)

10. **Shopify inbound: only `orders/create`** — `routes/shopify/webhooks.js:9`. `orders/updated`,
    `orders/cancelled`, `refunds/create` are advertised by `health.js` `webhooks/setup` but have no
    handler (404). The `orders/create` path is complete: HMAC (`:35`), replay window (`:50`),
    idempotency (`:62`), `upsertWebOrderFromShopifyPayload` (`:78`).
11. **Shopify order → `web_orders`/`web_order_items` + `outlet_stock` (never `sales`)** —
    `shopify/order-service.js:205-308`; stock decrement only when `payment_status ∈
    {paid,partially_paid,authorized}` (`:10-16`) AND every line maps; an unmapped line throws and
    leaves stock unapplied while the order still "succeeds" (`:296-301`).
12. **Shopify 30s poll = outbound inventory push only** — `boot/workers.js:174-203`; order pull is
    manual (`routes/shopify/orders.js`).
13. **Daraz/Facebook/Google outbound real but manual** — real HMAC-signed `fetch`
    (`daraz-client.js:20-41`); Daraz `pull-orders` creates `web_orders` (source `'daraz'`) but, unlike
    Shopify, **does not decrement stock**. Nothing polls.
14. **WhatsApp order-confirm/tracking templates fire only on manual admin POST** —
    `integrations/whatsapp.js:49,51`. Auto WhatsApp exists via the F05 engine
    (`customer-notify.js:186-190`) but free-text sends fail outside Meta's 24h window (logged failed).
15. **WooCommerce is real REST v3 but one-directional/manual** — `routes/woocommerce.js` connect/
    import/sync-stock all real `wc/v3` calls; **no inbound webhook, no poll** — WooCommerce orders
    never flow in.
16. **Courier tracking is manual only** — `couriers.js:441-523` user-triggered `getTracking`; no
    worker polls.

## TIER 4 — working end-to-end

17. **xPay payment webhook — complete chain**: HMAC `timingSafeEqual` (`payment-gateway.js:159-182`),
    intent lookup → tenant activation → `payment_records` → confirmation email, idempotent
    (`webhooks.js:455-486,113-183`). Real HTTP to `api.xpay.pk`. Sandbox adapter fully functional;
    `manual` throws.
18. **Room/treatment deposit pre-auth — real gateway** via `deposit-engine.create` → `createCheckout`
    (`deposit-engine.js:184`), webhook capture/release wired (`webhooks.js:242-259`).
19. **FBR sale/return/void chain — fully wired**: enqueue (`sales.js:2299-2314`), void→debit note
    (`:486-488`), return→credit note (`returns.js:697-712`); worker posts real API, writes IRN/QR back.
    (Alerting gap #8.)
20. **Email — real Resend chain** (`email.js:65-73,90-107` + worker). **Tenant SMTP (`email_config`)
    is separate** — only `routes/email.js:34`, `tier4/crm.js:596`, `reports/governance.js:391` use raw
    nodemailer, bypassing the unified service.
21. **SMS adapters — real HTTP** (Twilio + generic HTTP, `sms.js:42-108`); clean no-op when
    unconfigured. Live callers: couriers (consent-gated), F05 notify, waitlist, reservations,
    reservation-reminder worker.
22. **Delivery aggregators (foodpanda/Careem) — the ONE real inbound marketplace path** —
    `webhooks.js:587-639`: signature-verified fail-closed (`:605`), tenant by store id (`:599`),
    `processInboundOrder` (`:627`) creates KDS ticket + booked sale, alerting on rejection (`:618`).

---

## Cross-cutting
- **Doc drift to fix:** `workers/CLAUDE.md` + `services/marketplace/CLAUDE.md` (worker no longer
  schedules crons); `services/CLAUDE.md` (courier decryption claim is false).
- **Stock-decrement asymmetry:** Shopify inbound decrements `outlet_stock`; Daraz/Facebook inbound
  create `web_orders` with no stock movement.
- **Credential-encryption asymmetry:** Shopify/marketplace AES-GCM encrypted; courier + WooCommerce
  plaintext.
- **Net:** anything an operator relies on for *inbound* marketplace/WhatsApp order/message capture is
  either manual (Daraz/Woo pull), a no-op (Daraz/Meta webhook), or silently failing (WhatsApp inbox) —
  except foodpanda/Careem and Shopify orders/create. Payment, FBR, email, SMS, and deposits are solid.

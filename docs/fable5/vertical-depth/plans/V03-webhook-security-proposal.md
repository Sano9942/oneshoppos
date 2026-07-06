# V03 — Aggregator Webhook Signature-Verification & Replay-Window Design

> **SECURITY PAUSE — awaiting approval before production exposure.** Per the V03 plan and completion-spec §5 (security is pause-list), this documents the verification scheme for the foodpanda / Careem webhook endpoints. The code is **implemented on `feat/v03-food-depth`** (fail-closed) but the endpoints are **not exposed to production** — no PR, no deploy — until this design is approved. It is deliberately modelled on the repo's existing *verified* webhook (Shopify), NOT the unverified Meta/Daraz handlers.

## The hole this closes
`backend/CLAUDE.md` documents that the Meta, WhatsApp, and Daraz POST webhook handlers are **not** signature-verified — only `/api/webhooks/xpay` is. The plan is explicit: *"do not ship it unverified like the Meta/Daraz handlers."* So foodpanda/Careem follow the Shopify pattern (`shopify/utils.js:verifyWebhookSignature` + `evaluateWebhookTimestampWindow`), not the marketplace pattern.

## Endpoints
- `POST /api/webhooks/foodpanda`
- `POST /api/webhooks/careem`

Both mounted **before** tenant middleware (like every webhook), rate-limited by `webhookLimiter` (60s / 120 req, keyed by IP).

## Verification pipeline (per request)
Implemented in `services/aggregator-orders.js:verifyWebhook` + the route in `routes/webhooks.js`:

1. **Route before verify (unavoidable).** The HMAC secret is per-tenant (`integration_settings.webhook_secret`), keyed by the aggregator **store id**. The store id is read from the *unverified* payload body (`extractStoreId`) purely to look up which tenant+secret to verify against — no side effects happen on this read. If no store id → `400`. If no active integration for that store → `404`. (An attacker can only use this to probe which store ids are connected; they cannot forge an order because step 3 still requires the secret.)
2. **Fail-closed on missing secret.** If the resolved integration has no `webhook_secret`, the request is **rejected** (`no_secret_configured`), never accepted. Unlike the Meta/Daraz handlers, there is no unverified path.
3. **HMAC-SHA256, constant-time.** `expected = base64(HMAC_SHA256(secret, rawBody))`, compared to the platform's signature header via `crypto.timingSafeEqual` with a length pre-check (mirrors the Shopify verifier exactly). `rawBody` is the exact bytes captured by the `express.json` verify callback for `/api/webhooks/*` — never the re-serialized parsed body. Signature header candidates: `x-foodpanda-signature` / `x-fp-signature` / `x-signature` (Careem: `x-careem-signature` / `x-signature`) — broad on purpose so a header rename can't silently drop verification.
4. **Replay window.** When the platform sends a timestamp header (`x-foodpanda-timestamp` etc., epoch-s or -ms or ISO), reject if it is more than **±5 minutes** from now (`replay_window`). Fail-open only on a *missing* timestamp (same posture as the Shopify verifier), fail-closed on a stale/future/unparseable one. Combined with the natural idempotency of `web_orders UNIQUE(source, external_order_id)`, a captured-and-replayed request is doubly defanged: the signature+timestamp gate rejects a stale replay, and even an in-window replay of a genuine delivery inserts nothing (duplicate).
5. **Verified → process.** Only after `verify.ok` does `processInboundOrder` run (normalize → ingest → optional auto-accept).

## Idempotency (defense in depth, not the security control)
`web_orders` already carries `UNIQUE(source, external_order_id)`. Ingest uses `INSERT ... ON CONFLICT (source, external_order_id) DO NOTHING RETURNING id` — a redelivered webhook (aggregators retry on ack timeout) inserts nothing and the kitchen never gets a second ticket. **No new migration is required** for idempotency (verified against schema).

## What needs the platform's real spec (open question for you)
The exact **header names** and whether the signature is **base64 vs hex** depend on foodpanda's / Careem's live POS-integration docs, which we don't have sandbox access to. The scheme above is configurable at exactly one point (`SIGNATURE_HEADERS` / `TIMESTAMP_HEADERS` + the digest encoding in `verifyWebhook`) — if their real scheme differs, only that function changes, not the pipeline. **Careem ships stub-honest** (labelled "manual" in the hub) until API access is provisioned.

## Status — APPROVED 2026-07-06
The HMAC-SHA256 + ±5-min replay-window scheme and the route-before-verify store-id lookup are **approved and implemented** (`services/aggregator-orders.js:verifyWebhook`, `routes/webhooks.js`).

**Operational hardening added on approval:** fail-closed is security-correct but must not be *operationally silent* — a misconfigured secret/header would reject every legit order and the revenue would just vanish. So a signature rejection on an active integration now feeds `services/alerting.js:recordError` (the sliding-window email alert), so a spike of rejections pages ops instead of disappearing.

**Remaining gate before PRODUCTION exposure (not a code change — an ops step):** confirm foodpanda's real signature **header name + encoding** (base64 vs hex) from their POS-integration onboarding docs, set the one config point (`SIGNATURE_HEADERS` + the digest line in `verifyWebhook`), and fire one real test order through before enabling the endpoint for a live tenant. Careem stays "manual" until API access is provisioned.

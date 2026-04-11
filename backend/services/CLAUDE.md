# Services — Claude Guide

- **31 files** — core business services, all imported by route handlers via `deps` or direct `require()`. File list below is incomplete — run `/update-docs` for a full refresh
- **`crypto.js`** — AES-256-GCM encryption for integration credentials (`INTEGRATION_SECRET_KEY` env var)
- **`email.js`** — unified `sendEmail()` (immediate via Resend) + `enqueueEmail()` (pg-boss queue). `resolveFrom()` picks sender: tenant emails from `slug@sanopos.com`, platform from `noreply@sanopos.com`
- **`email-templates.js`** — `TEMPLATES` registry maps email type → `{ subject, html }` builder. `wrapEmailHtml(title, body)` renders branded shell. To add a new email type, add here AND register in `TEMPLATES`
- **`boss.js`** — pg-boss singleton factory: `getBoss()` (lazy-init, promise-deduplicated), `shutdownBoss()`. Auto-prunes after 7 days. Throws if `DATABASE_URL` unset
- **`fbr.js`** — FBR Digital Invoicing: `buildInvoicePayload`, `postToFbr`, `enqueueFbrInvoice` (DB row first, then pg-boss fire-and-forget). Exponential backoff: 60s→5m→15m→1h→4h
- **`payment-gateway.js`** — adapter pattern: `createCheckout()`, `verifyWebhook()`, `isEnabled()`. Default mode is `"manual"` (throws on `createCheckout`). Gate payment UI behind `isEnabled()`
- **`alerting.js`** — in-memory sliding-window alerts: `recordError`, `recordDbPressure`, `recordHealthCheckFailure`. Sends to `ALERT_EMAIL`. State resets on restart (by design)
- **`printer.js`** — factory: `makePrinterService(db)` → `{ printReceipt, printerStatus }`. Supports USB and TCP. 3s connection timeout. Paper width from DB drives layout
- **`catalog-scheduler.js`** — `applyScheduledChange(db, change)`. Called by `boot/workers.js` scheduled-catalog worker per pending row. Validates `entity_type` + `field_name` against allowlist imported from `schemas/scheduled-changes.js` (defense in depth: route validates on write, service re-validates on apply), then runs target UPDATE + status update inside one `db.transaction()`. Non-throwing — returns `{status, reason}` so caller can loop over many rows without one bad row killing the batch. Security-critical: column name is interpolated into the UPDATE string, allowlist is the only thing preventing SQL injection
- **`logger.js`** — Pino singleton. `LOG_LEVEL` env var. Use `.child({ component })` for sub-loggers. Never create multiple instances

## Subdirectories

- **`couriers/`** (16 files) — courier adapter pattern. See `couriers/CLAUDE.md`
- **`marketplace/`** (5 files) — marketplace API clients for integrations hub:
  - `base-marketplace.js` — abstract base class with common HTTP, retry, rate-limit logic
  - `daraz-client.js` — Daraz Seller Center API (Open Platform SDK)
  - `meta-commerce.js` — Facebook/Instagram Commerce API (catalog + orders)
  - `whatsapp-client.js` — WhatsApp Business Cloud API (templates + conversations)
  - `google-merchant.js` — Google Merchant Center Content API (product feed + diagnostics)

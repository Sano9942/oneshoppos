# Services — Claude Guide

- **9 files** — core business services, all imported by route handlers via `deps` or direct `require()`
- **`crypto.js`** — AES-256-GCM encryption for integration credentials (`INTEGRATION_SECRET_KEY` env var)
- **`email.js`** — unified `sendEmail()` (immediate via Resend) + `enqueueEmail()` (pg-boss queue). `resolveFrom()` picks sender: tenant emails from `slug@sanopos.com`, platform from `noreply@sanopos.com`
- **`email-templates.js`** — `TEMPLATES` registry maps email type → `{ subject, html }` builder. `wrapEmailHtml(title, body)` renders branded shell. To add a new email type, add here AND register in `TEMPLATES`
- **`boss.js`** — pg-boss singleton factory: `getBoss()` (lazy-init, promise-deduplicated), `shutdownBoss()`. Auto-prunes after 7 days. Throws if `DATABASE_URL` unset
- **`fbr.js`** — FBR Digital Invoicing: `buildInvoicePayload`, `postToFbr`, `enqueueFbrInvoice` (DB row first, then pg-boss fire-and-forget). Exponential backoff: 60s→5m→15m→1h→4h
- **`payment-gateway.js`** — adapter pattern: `createCheckout()`, `verifyWebhook()`, `isEnabled()`. Default mode is `"manual"` (throws on `createCheckout`). Gate payment UI behind `isEnabled()`
- **`alerting.js`** — in-memory sliding-window alerts: `recordError`, `recordDbPressure`, `recordHealthCheckFailure`. Sends to `ALERT_EMAIL`. State resets on restart (by design)
- **`printer.js`** — factory: `makePrinterService(db)` → `{ printReceipt, printerStatus }`. Supports USB and TCP. 3s connection timeout. Paper width from DB drives layout
- **`logger.js`** — Pino singleton. `LOG_LEVEL` env var. Use `.child({ component })` for sub-loggers. Never create multiple instances

## Subdirectories

- **`couriers/`** (14 files) — courier adapter pattern. See `couriers/CLAUDE.md`
- **`marketplace/`** (5 files) — marketplace API clients for integrations hub:
  - `base-marketplace.js` — abstract base class with common HTTP, retry, rate-limit logic
  - `daraz-client.js` — Daraz Seller Center API (Open Platform SDK)
  - `meta-commerce.js` — Facebook/Instagram Commerce API (catalog + orders)
  - `whatsapp-client.js` — WhatsApp Business Cloud API (templates + conversations)
  - `google-merchant.js` — Google Merchant Center Content API (product feed + diagnostics)

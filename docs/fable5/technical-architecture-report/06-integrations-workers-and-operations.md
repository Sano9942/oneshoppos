# Integrations, Background Workers, Observability, and Administration

## Integration adapters

The platform generally uses adapter or client modules so route code depends on a stable internal interface.

## Commerce channels

Implemented channel clients and routes include:

- Shopify Admin GraphQL
- WooCommerce REST
- Daraz
- Facebook and Instagram Commerce
- WhatsApp Cloud API
- Google Merchant
- Foodpanda
- Careem

Shopify has dedicated modules for:

- Connection and health
- Product import
- Product and location mappings
- Order ingestion
- Inventory synchronization
- Reconciliation
- Signed webhooks

The Shopify client builds GraphQL requests in [`backend/shopify/client.js`](../../../backend/shopify/client.js#L1).

Marketplace credentials and configuration are stored in tenant integration tables, with generalized encryption through [`backend/services/crypto.js`](../../../backend/services/crypto.js#L1).

### Marketplace automation boundary

[`marketplace-sync-worker-boss.js`](../../../backend/workers/marketplace-sync-worker-boss.js#L1) intentionally schedules no automatic polling. It removes old non-functional schedules and reports that marketplace synchronization is manual or webhook-driven.

The existence of an enabled marketplace module should therefore not be interpreted as continuous background order polling.

## Couriers

The courier adapter directory contains:

- Leopards
- TCS
- BlueEx
- Trax
- Call Courier
- M&P
- PostEx
- Rider
- Swyft
- Bykea
- Pakistan Post
- DHL
- FedEx
- Generic/manual adapter behavior

Adapters expose common shipment creation, tracking, cancellation, label, or status behavior where supported.

Courier integrations are configurable per tenant and can participate in fulfillment and COD reconciliation.

## Payments

[`backend/services/payment-gateway.js`](../../../backend/services/payment-gateway.js#L23) defines a base payment adapter with methods for:

- Hosted checkout
- Webhook verification
- Refunds
- Inline POS payments
- Instrument tokenization
- Saved-instrument charging

Current adapters are:

- Manual
- xPay
- Sandbox

The sandbox adapter implements the broadest test surface, including simulated saved-instrument charges and deterministic declines. xPay currently implements hosted checkout and webhook verification but not every interface operation.

Payment webhooks can resolve:

- Platform subscription payment intents
- Tenant deposits
- Customer invoice payment links
- Restaurant payment sessions
- Storefront payment sessions
- Wallet top-ups

See [`backend/routes/webhooks.js`](../../../backend/routes/webhooks.js#L162).

## Webhook authenticity

Verified inbound paths include:

- xPay HMAC
- Shopify HMAC and replay-window validation
- Meta Commerce HMAC
- WhatsApp HMAC
- Foodpanda/Careem-style aggregator HMAC and replay validation

Daraz is rate-limited and integration-routed but currently unsigned. This is explicitly visible in [`backend/routes/webhooks.js`](../../../backend/routes/webhooks.js#L781).

Webhook event and dead-letter tables provide idempotency and operational recovery.

## FBR Digital Invoicing

[`backend/services/fbr.js`](../../../backend/services/fbr.js#L4) supports:

- Sandbox invoice posting
- Production invoice posting
- Connection validation
- Sales invoices
- Return credit notes
- Void debit notes
- Tenant-local invoice dates
- Per-line tax and HS-code snapshots
- Retry backoff
- pg-boss dispatch

FBR enqueueing is skipped when:

- Tenant tax mode is `none`
- API token is absent
- NTN is absent

This prevents permanently stuck queue growth for unconfigured tenants.

## Messaging

### Email

[`backend/services/email.js`](../../../backend/services/email.js#L1) sends through Resend.

It supports:

- Immediate send
- pg-boss enqueue
- Delayed send
- Priority
- Tenant-branded sender addresses
- Platform sender addresses
- Typed templates

Worker jobs cover transactional messages, campaigns, reminders, invoice reminders, billing lifecycle events, and subscription renewals.

### SMS

[`backend/services/sms.js`](../../../backend/services/sms.js#L18) provides:

- Generic JSON HTTP gateway
- Zong/Jazz-style generic configurations
- Twilio
- Provider connectivity testing
- Credential decryption
- Persistent delivery status

### WhatsApp

WhatsApp webhooks are Meta-signed, routed to the matching tenant integration, and persisted into the tenant messaging inbox.

## AI

The AI system is Anthropic-backed.

[`backend/services/ai.js`](../../../backend/services/ai.js#L18) uses:

- Claude Haiku for product descriptions and search tags
- Claude Sonnet vision for supplier invoice/challan extraction

[`backend/routes/insights-ai.js`](../../../backend/routes/insights-ai.js#L20) uses Claude Haiku for analytical questions over precomputed tenant data.

AI output is parsed and validated before entering product/import flows. It does not bypass normal product confirmation and database validation.

## R2 object storage

[`backend/utils/r2.js`](../../../backend/utils/r2.js#L12) provides S3-compatible upload and deletion.

When configured:

- Files are uploaded to Cloudflare R2.
- Public URLs use `R2_PUBLIC_URL` or the backend `/r2/` proxy.

When not configured:

- Files are written below `backend/exports`.
- A relative local path is returned.

The public R2 proxy only allows product, company, and support prefixes. Backup objects are intentionally excluded.

## Thermal printing

[`backend/services/printer.js`](../../../backend/services/printer.js#L35) supports:

- USB ESC/POS
- Network TCP ESC/POS
- Configurable paper width
- Barcode
- FBR QR
- Logo
- Tax and payment details
- Receipt, guest-bill, and fire-chit purposes
- KDS station routing
- Cash drawer pulse
- Connectivity status
- Retry with exponential delay
- Browser fallback signaling

## Worker architecture

[`backend/boot/workers.js`](../../../backend/boot/workers.js#L250) starts a mixture of pollers and pg-boss workers.

### Default pollers

Unless disabled:

- Shopify inventory event processing every 30 seconds
- Report schedules every 60 seconds
- Sync-event cleanup daily
- Report artifact cleanup daily
- Stale attendance-session cleanup daily

Optional pollers include scheduled catalog changes and booking reminders.

### pg-boss

[`backend/services/boss.js`](../../../backend/services/boss.js#L12) creates a singleton pg-boss instance with:

- Seven-day job history
- Twenty-four-hour completed-job archive delay
- Thirty-second state monitoring

pg-boss workers cover:

- Email
- FBR
- Dead tenant cleanup
- Orphan-schema scanning
- Adoption snapshots
- Reservations
- Subscription grace and dunning
- Rental overdue
- Hold expiry
- Channel sync
- Night audit
- Deposit expiry
- Room overdue
- Treatment reminders
- Recall outreach
- ABC classification
- Retail anomalies
- Expiry alerts
- Weekly digest
- Shift auto-close
- Attendance auto-close
- Course release
- KDS load snapshots
- Reservation reminders

Most are opt-in through environment variables. Orphan-schema scanning defaults on when pg-boss is available.

### Tenant worker context

[`backend/workers/tenant-job-context.js`](../../../backend/workers/tenant-job-context.js#L48) safely:

1. Validates the tenant slug.
2. Checks out a pool client.
3. Sets tenant search path.
4. Runs the job.
5. Resets search path to public.
6. Releases the client.

## Observability

### Request logging

[`backend/middleware/request-id.js`](../../../backend/middleware/request-id.js#L15) provides:

- Incoming or generated request UUID
- `X-Request-Id`
- Pino HTTP logs
- Tenant and employee enrichment
- Warning level for slow requests over two seconds
- Error level for HTTP 500 responses

Bodies are not included in standard request serializers.

### Sentry

Backend and frontend Sentry are optional.

The current configuration:

- Captures errors
- Tags backend errors with tenant and request ID
- Disables tracing
- Disables frontend replay

### Health

`GET /api/health` provides a quick health response.

`GET /api/health?deep=true` checks:

- PostgreSQL
- Resend when configured

Checks have explicit timeouts and return `ok`, `degraded`, or `down`.

### Alerting

[`backend/services/alerting.js`](../../../backend/services/alerting.js#L6) keeps in-memory sliding windows for:

- Error spikes
- Database pressure
- Backup failure hooks
- Dependency health failures

Alert aggregation and cooldown state are process-local.

## Super-admin operations

The super-admin orchestrator is [`backend/routes/admin/index.js`](../../../backend/routes/admin/index.js#L1).

It exposes:

- Tenant provisioning and lifecycle
- Plan pricing
- Payments and upgrade requests
- Feature flags and modes
- Preset drift and reapplication
- Tenant migrations
- Setup-token regeneration
- PIN reset
- Tenant notes
- Impersonation
- Support tickets
- Payment and integration dead letters
- Tax-rate management
- FBR health
- Email queues and broadcasts
- Announcements
- Activity and security logs
- Infrastructure metrics
- Slow-query information
- Worker status
- Adoption data
- Orphan-schema cleanup
- Backup and verification
- Platform-level module locks

Infrastructure monitoring queries PostgreSQL catalog and statistics views, including `pg_stat_activity`, storage statistics, database sizes, and optionally `pg_stat_statements`.

Worker status combines:

- Environment gate state
- Registration success or failure
- Process heartbeat
- Processed count
- Queue depth

These heartbeats describe the current backend instance rather than the whole deployment when multiple replicas exist.


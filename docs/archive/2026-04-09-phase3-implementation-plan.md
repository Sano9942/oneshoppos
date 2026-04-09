# Phase 3: Marketing, Engagement & Financial Tools — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add email campaigns, WhatsApp messaging inbox, customer invoicing (with deposits, reminders, batch), payment links, and recurring subscriptions to SanoPOS.

**Architecture:** Extend existing systems (Resend email, pg-boss scheduling, payment-gateway adapter, WhatsApp integration) with new domain services and route modules. All new behavior is feature-flagged and additive — no destructive refactors.

**Tech Stack:** Node.js + Express, PostgreSQL, pg-boss, Resend, React 19 + Vite + Tailwind v4

**Companion design doc:** `docs/plans/2026-04-09-phase3-marketing-engagement-financial-tools-design.md`

---

## Delivery Cuts

- **Phase 3A:** Campaigns + templates, audience preview, WhatsApp inbox, customer invoices, batch invoicing, deposits, reminders
- **Phase 3B:** Payment links, SMS sending adapter, subscription plans, customer subscriptions, auto-charge hooks

---

## Task 1: Schema Migration v21 — All New Tables + Extensions

**Files:**
- Modify: `backend/schema-pg.sql` (append new tables after existing DDL)
- Modify: `backend/migrate-pg.js` (add version 21 entry to MIGRATIONS array)

### Step 1: Add v21 migration to migrate-pg.js

Append after the version 20 entry in the `MIGRATIONS` array. The migration creates all 15 new tables, extends `customers` with consent fields, and extends `quotations` with invoice linkage.

```js
{
  version: 21,
  description: "Phase 3 — marketing campaigns, messaging inbox, customer invoicing, subscriptions",
  up: async (client) => {
    // ── Customer consent fields ──────────────────────────────────
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN DEFAULT false
    `);

    // ── Quotation → invoice linkage ──────────────────────────────
    await client.query(`
      ALTER TABLE quotations
        ADD COLUMN IF NOT EXISTS converted_invoice_id INTEGER
    `);

    // ── Marketing Templates ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        subject TEXT,
        body_html TEXT,
        body_text TEXT,
        created_by INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Marketing Campaigns ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        template_id INTEGER REFERENCES marketing_templates(id),
        status TEXT NOT NULL DEFAULT 'draft',
        subject TEXT,
        body_html TEXT,
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Campaign Audiences ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaign_audiences (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
        filter_type TEXT NOT NULL,
        filter_value TEXT NOT NULL
      )
    `);

    // ── Campaign Deliveries ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaign_deliveries (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        recipient TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Message Threads (generic inbox) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_threads (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        channel_identifier TEXT NOT NULL,
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_to INTEGER REFERENCES employees(id),
        unread_count INTEGER DEFAULT 0,
        last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Message Entries ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_entries (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        content TEXT,
        message_type TEXT DEFAULT 'text',
        external_id TEXT,
        sender_type TEXT DEFAULT 'customer',
        sender_id INTEGER,
        status TEXT DEFAULT 'delivered',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Customer Invoices ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_invoices (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        quotation_id INTEGER REFERENCES quotations(id),
        outlet_id INTEGER REFERENCES outlets(id),
        employee_id INTEGER REFERENCES employees(id),
        status TEXT NOT NULL DEFAULT 'draft',
        subtotal NUMERIC(12,2) DEFAULT 0,
        tax_total NUMERIC(12,2) DEFAULT 0,
        discount_amount NUMERIC(12,2) DEFAULT 0,
        total_amount NUMERIC(12,2) DEFAULT 0,
        amount_paid NUMERIC(12,2) DEFAULT 0,
        balance_due NUMERIC(12,2) DEFAULT 0,
        due_date DATE,
        notes TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Customer Invoice Items ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        variant_id INTEGER REFERENCES product_variants(id),
        description TEXT NOT NULL,
        quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax_rate NUMERIC(8,4) DEFAULT 0,
        line_total NUMERIC(12,2) DEFAULT 0
      )
    `);

    // ── Customer Invoice Payments ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_invoice_payments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        payment_type TEXT NOT NULL DEFAULT 'payment',
        reference TEXT,
        notes TEXT,
        recorded_by INTEGER REFERENCES employees(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Customer Invoice Payment Links ───────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_invoice_payment_links (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
        link_token TEXT NOT NULL UNIQUE,
        gateway_ref TEXT,
        amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Customer Invoice Reminders ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_invoice_reminders (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
        reminder_type TEXT NOT NULL DEFAULT 'before_due',
        days_offset INTEGER NOT NULL DEFAULT 0,
        channel TEXT NOT NULL DEFAULT 'email',
        sent_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Subscription Plans ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC(12,2) NOT NULL,
        currency TEXT DEFAULT 'PKR',
        billing_interval TEXT NOT NULL DEFAULT 'monthly',
        billing_interval_count INTEGER DEFAULT 1,
        trial_days INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Customer Subscriptions ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_subscriptions (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        status TEXT NOT NULL DEFAULT 'draft',
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        trial_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        paused_at TIMESTAMPTZ,
        auto_charge BOOLEAN DEFAULT false,
        gateway_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Subscription Runs ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_runs (
        id SERIAL PRIMARY KEY,
        subscription_id INTEGER NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        invoice_id INTEGER REFERENCES customer_invoices(id),
        charge_amount NUMERIC(12,2),
        charge_status TEXT,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Indexes ──────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_campaign ON marketing_campaign_deliveries(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_customer ON marketing_campaign_deliveries(customer_id);
      CREATE INDEX IF NOT EXISTS idx_message_threads_customer ON message_threads(customer_id);
      CREATE INDEX IF NOT EXISTS idx_message_threads_channel ON message_threads(channel, channel_identifier);
      CREATE INDEX IF NOT EXISTS idx_message_entries_thread ON message_entries(thread_id);
      CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer ON customer_invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customer_invoices_status ON customer_invoices(status);
      CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_invoice ON customer_invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_customer_invoice_payments_invoice ON customer_invoice_payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_customer ON customer_subscriptions(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_plan ON customer_subscriptions(plan_id);
      CREATE INDEX IF NOT EXISTS idx_subscription_runs_sub ON subscription_runs(subscription_id);
    `);

    // ── Seed feature flags ───────────────────────────────────────
    await client.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('marketing_campaigns', false),
        ('customer_messaging', false),
        ('customer_invoicing', false),
        ('payment_links', false),
        ('subscription_billing', false),
        ('sms_campaigns', false),
        ('subscription_autocharge', false)
      ON CONFLICT (key) DO NOTHING
    `);
  },
},
```

### Step 2: Add new tables to schema-pg.sql

Append all 15 `CREATE TABLE IF NOT EXISTS` statements (same DDL as migration) plus indexes after the existing WhatsApp tables section. This keeps the schema file as the single DDL source of truth.

### Step 3: Add feature flags to DEFAULT_FEATURE_FLAGS

**File:** `backend/middleware/feature-flags.js`

Add after the `phase2_item_suggestions` entry:

```js
marketing_campaigns: false,
customer_messaging: false,
customer_invoicing: false,
payment_links: false,
subscription_billing: false,
sms_campaigns: false,
subscription_autocharge: false,
```

### Step 4: Run migration locally

```bash
node backend/migrate-pg.js
```

Expected: v21 applied to public schema + all tenant schemas.

### Step 5: Commit

```bash
git add backend/migrate-pg.js backend/schema-pg.sql backend/middleware/feature-flags.js
git commit -m "feat(phase3): add v21 migration — 15 new tables, customer consent, 7 feature flags"
```

---

## Task 2: Campaign Service + Email Marketing Routes (Phase 3A)

**Files:**
- Create: `backend/services/marketing.js`
- Create: `backend/routes/marketing.js`
- Create: `backend/schemas/marketing.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount marketing routes)
- Modify: `backend/workers/email-worker-boss.js` (add campaign-send job handler)

### Step 1: Create Zod schemas

**File:** `backend/schemas/marketing.js`

Validation schemas for:
- `createTemplateSchema` — name (required), channel (email|sms), subject, body_html, body_text
- `createCampaignSchema` — name (required), channel (email|sms), template_id (optional), subject, body_html, audience_filters (array of `{ filter_type, filter_value }`)
- `scheduleCampaignSchema` — scheduled_at (ISO datetime string, required)

### Step 2: Create marketing service

**File:** `backend/services/marketing.js`

Functions:
- `resolveAudience(db, filters)` — builds a SQL query against `customers` table using filter types: `group` (customer_group_id), `tag` (ANY tag match), `loyalty_tier` (loyalty_tier_id), `city` (ILIKE), `birth_month` (EXTRACT(MONTH FROM date_of_birth)), `last_purchase_days` (customers with sales in last N days via subquery on `sales`), `min_spend` / `max_spend` (total_spend range), `has_email` (email IS NOT NULL AND email_consent = true), `has_mobile` (mobile IS NOT NULL AND sms_consent = true). Returns `{ count, customer_ids }` or just `{ count }` for preview mode.
- `enqueueCampaignSend(boss, campaignId, db)` — loads campaign + resolved audience, creates one `marketing_campaign_deliveries` row per recipient, then enqueues one pg-boss job `"campaign-email"` per delivery row. Updates campaign status to `'sending'`.
- `generateInvoiceNumber(db)` — auto-increment pattern `INV-000001` for customer invoices (shared utility).

### Step 3: Create marketing routes

**File:** `backend/routes/marketing.js`

Pattern: `module.exports = function registerMarketingRoutes(app, deps) { ... }` (same as `routes/billing.js`).

Endpoints:
- `GET /api/marketing/campaigns` — list campaigns with delivery stats (total, sent, failed counts via subquery)
- `POST /api/marketing/campaigns` — create campaign (draft status), validate with Zod schema
- `PUT /api/marketing/campaigns/:id` — update draft campaign (reject if not draft)
- `POST /api/marketing/campaigns/:id/send-test` — resolve audience preview (limit 1), send one email via existing `enqueueEmail()` from `services/email.js`
- `POST /api/marketing/campaigns/:id/schedule` — set `scheduled_at`, update status to `'scheduled'`, enqueue pg-boss delayed job
- `GET /api/marketing/audiences/preview` — accept filters as query params, return count + sample of 10 customers
- `GET /api/marketing/templates` — list templates
- `POST /api/marketing/templates` — create template
- `PUT /api/marketing/templates/:id` — update template
- `DELETE /api/marketing/templates/:id` — soft-delete or hard-delete if unused

All routes gated by `requireFeature('marketing_campaigns')` and `requirePerm('all_access')`.

### Step 4: Add campaign email job to email-worker-boss.js

Register a new job type `"campaign-email"` in the existing `registerEmailWorker` function. Job data: `{ deliveryId, to, from, subject, html }`. On success, update `marketing_campaign_deliveries` row to `status = 'sent'`, `sent_at = NOW()`. On failure, update to `status = 'failed'`, `error = err.message`. After all deliveries for a campaign complete, a follow-up check updates campaign status to `'sent'` or `'partial'`.

### Step 5: Mount routes in registerAllRoutes.js

Add after the `// --- INTEGRATIONS HUB ---` block:

```js
// --- MARKETING CAMPAIGNS ---
require("./marketing")(app, deps);
```

### Step 6: Commit

```bash
git add backend/services/marketing.js backend/routes/marketing.js backend/schemas/marketing.js backend/routes/registerAllRoutes.js backend/workers/email-worker-boss.js
git commit -m "feat(phase3): add campaign service, marketing routes, audience preview, email delivery via pg-boss"
```

---

## Task 3: Generic Messaging Inbox with WhatsApp (Phase 3A)

**Files:**
- Create: `backend/services/messaging.js`
- Create: `backend/routes/messaging.js`
- Create: `backend/schemas/messaging.js`
- Modify: `backend/routes/webhooks.js` (delegate WhatsApp inbound to messaging service)
- Modify: `backend/routes/registerAllRoutes.js` (mount messaging routes)

### Step 1: Create messaging service

**File:** `backend/services/messaging.js`

Functions:
- `findOrCreateThread(db, { channel, channelIdentifier, customerId })` — upsert thread by `(channel, channel_identifier)`. If no customer_id provided, attempt lookup via `customers.mobile` matching `channelIdentifier`.
- `addMessage(db, { threadId, direction, content, messageType, externalId, senderType, senderId })` — insert into `message_entries`, update `message_threads.last_message_at` and `unread_count` (increment on inbound, reset on staff reply).
- `migrateWhatsAppData(db)` — one-time backfill: read `whatsapp_conversations` + `whatsapp_messages`, insert into `message_threads` + `message_entries`. Idempotent — skip rows where `external_id` already exists in `message_entries`.

### Step 2: Create messaging routes

**File:** `backend/routes/messaging.js`

Endpoints:
- `GET /api/messaging/threads` — list threads with customer name, unread count, last message preview. Supports `?status=open|closed|all` and `?channel=whatsapp` filters. Paginated (limit/offset).
- `GET /api/messaging/threads/:id/messages` — list messages for a thread, ordered by created_at ASC. Paginated.
- `POST /api/messaging/threads/:id/send` — staff reply. Body: `{ content, message_type }`. Writes to `message_entries` with `direction = 'outbound'`, `sender_type = 'staff'`, `sender_id = req.employee.id`. For WhatsApp channel, also calls existing `WhatsAppClient.sendMessage()` from `services/marketplace/whatsapp-client.js`. Resets `unread_count` to 0.
- `PUT /api/messaging/threads/:id` — update thread (status, assigned_to).

All routes gated by `requireFeature('customer_messaging')` and `requirePerm('manage_orders')`.

### Step 3: Update WhatsApp webhook to use messaging service

**File:** `backend/routes/webhooks.js`

In the existing WhatsApp webhook handler (`POST /api/webhooks/whatsapp`), after signature verification:
1. Call `messagingService.findOrCreateThread(db, { channel: 'whatsapp', channelIdentifier: senderPhone, customerId })`.
2. Call `messagingService.addMessage(db, { threadId, direction: 'inbound', content: messageBody, messageType, externalId: waMessageId })`.
3. Continue writing to existing `whatsapp_conversations` / `whatsapp_messages` tables for backward compatibility (dual-write during transition).

### Step 4: Create Zod schemas

**File:** `backend/schemas/messaging.js`

- `sendMessageSchema` — content (required, string), message_type (optional, default 'text')
- `updateThreadSchema` — status (optional, enum: open/closed/snoozed), assigned_to (optional, integer)

### Step 5: Mount routes

In `registerAllRoutes.js`, add after marketing routes:

```js
// --- CUSTOMER MESSAGING INBOX ---
require("./messaging")(app, deps);
```

### Step 6: Commit

```bash
git add backend/services/messaging.js backend/routes/messaging.js backend/schemas/messaging.js backend/routes/webhooks.js backend/routes/registerAllRoutes.js
git commit -m "feat(phase3): add generic messaging inbox with WhatsApp channel, thread lifecycle, staff replies"
```

---

## Task 4: Customer Invoicing, Deposits, and Reminders (Phase 3A)

**Files:**
- Create: `backend/services/customer-invoicing.js`
- Create: `backend/routes/customer-invoices.js`
- Create: `backend/schemas/customer-invoices.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: `backend/workers/email-worker-boss.js` (add reminder job)
- Modify: `backend/services/email-templates.js` (add invoice email templates)

### Step 1: Create invoice service

**File:** `backend/services/customer-invoicing.js`

Functions:
- `generateInvoiceNumber(db)` — `SELECT COALESCE(MAX(id), 0) + 1 FROM customer_invoices` → format as `INV-{padded}`.
- `computeInvoiceTotals(items, discountAmount)` — pure function. Sum `line_total` per item (`quantity * unit_price * (1 + tax_rate/100)`), subtract discount, return `{ subtotal, tax_total, total_amount }`.
- `recomputeBalance(db, invoiceId)` — `SELECT COALESCE(SUM(amount), 0) FROM customer_invoice_payments WHERE invoice_id = $1` → update `customer_invoices.amount_paid` and `balance_due = total_amount - amount_paid`. Update status: if `balance_due <= 0` → `'paid'`, if `amount_paid > 0` → `'partial'`, if `due_date < NOW()` and balance > 0 → `'overdue'`.
- `convertQuotationToInvoice(db, quotationId, employeeId)` — load quotation + items, create invoice + invoice_items, update `quotations.converted_invoice_id`. Reject if quotation status is not `'accepted'`.
- `createBatchInvoices(db, { customerIds, items, dueDate, employeeId, outletId })` — for each customer, create invoice with same items. Idempotency: check for existing invoice with same `customer_id + due_date + total_amount` within last 24h before creating.
- `scheduleReminders(boss, invoiceId, rules)` — for each reminder rule (`{ reminder_type, days_offset, channel }`), compute `fire_at` based on `due_date +/- days_offset`, insert `customer_invoice_reminders` row, enqueue pg-boss job `"invoice-reminder"` with `{ reminderId, invoiceId }` and `startAfter: fire_at`.

### Step 2: Create Zod schemas

**File:** `backend/schemas/customer-invoices.js`

- `createInvoiceSchema` — customer_id (required), items (array of `{ description, quantity, unit_price, tax_rate, product_id?, variant_id? }`), due_date (optional), notes (optional), outlet_id (optional), reminders (optional array of `{ reminder_type, days_offset, channel }`)
- `batchInvoiceSchema` — customer_ids (array of integers, min 1), items, due_date, notes
- `recordPaymentSchema` — amount (required, positive number), payment_method (required), payment_type (default 'payment', enum: payment/deposit/refund), reference (optional), notes (optional)

### Step 3: Create invoice routes

**File:** `backend/routes/customer-invoices.js`

Endpoints:
- `GET /api/customer-invoices` — list with customer name, status filter, date range. Include computed `overdue` flag.
- `POST /api/customer-invoices` — create invoice from body. Auto-generate invoice_number. Compute totals.
- `PUT /api/customer-invoices/:id` — update draft invoice (reject if sent/paid).
- `POST /api/customer-invoices/batch` — batch create. Validate body with `batchInvoiceSchema`.
- `POST /api/customer-invoices/:id/send` — mark as `'sent'`, set `sent_at`, enqueue email via `enqueueEmail()` with new `'customer_invoice'` template.
- `POST /api/customer-invoices/:id/payments` — record payment/deposit. Call `recomputeBalance()` after.
- `POST /api/customer-invoices/:id/reminders/run` — manually trigger reminder for an invoice.
- `POST /api/customer-invoices/from-quotation/:quotationId` — convert quotation to invoice.
- `PUT /api/customer-invoices/:id/void` — set status to `'void'`.

All routes gated by `requireFeature('customer_invoicing')` and `requirePerm('manage_orders')`.

### Step 4: Add invoice email templates

**File:** `backend/services/email-templates.js`

Add to `TEMPLATES` registry:
- `customer_invoice` — subject: `"Invoice {invoice_number} from {company_name}"`, body: invoice summary with line items, total, balance due, due date.
- `invoice_reminder` — subject: `"Reminder: Invoice {invoice_number} — {balance_due} due"`, body: friendly reminder with payment instructions.

### Step 5: Add reminder job handler to email-worker-boss.js

Register `"invoice-reminder"` job in the email worker. Job data: `{ reminderId, invoiceId, tenantSlug }`. Handler:
1. Load invoice + customer from tenant DB.
2. If invoice status is `'paid'` or `'void'`, skip (no-op).
3. Build reminder email using `invoice_reminder` template.
4. Enqueue email via `boss.send("email", ...)`.
5. Update `customer_invoice_reminders` row: `status = 'sent'`, `sent_at = NOW()`.

### Step 6: Mount routes + commit

```bash
git add backend/services/customer-invoicing.js backend/routes/customer-invoices.js backend/schemas/customer-invoices.js backend/routes/registerAllRoutes.js backend/workers/email-worker-boss.js backend/services/email-templates.js
git commit -m "feat(phase3): add customer invoicing — CRUD, deposits, batch, reminders, quotation conversion"
```

---

## Task 5: Payment Links (Phase 3B)

**Files:**
- Modify: `backend/routes/customer-invoices.js` (add payment-link endpoint)
- Modify: `backend/services/payment-gateway.js` (add `createInvoiceCheckout` method)
- Modify: `backend/routes/webhooks.js` (add invoice payment webhook handler)

### Step 1: Extend payment gateway

**File:** `backend/services/payment-gateway.js`

Add `createInvoiceCheckout({ invoiceId, amount, currency, description, returnUrl, cancelUrl, linkToken })` — same adapter pattern as `createCheckout()`. Returns `{ checkout_url, gateway_ref }`. The `linkToken` is stored in `customer_invoice_payment_links` for webhook reconciliation.

### Step 2: Add payment-link endpoint

**File:** `backend/routes/customer-invoices.js`

New endpoint:
- `POST /api/customer-invoices/:id/payment-link` — gated by `requireFeature('payment_links')`. Calls `paymentGateway.createInvoiceCheckout()`. Creates `customer_invoice_payment_links` row with `link_token`, `gateway_ref`, `amount`, `status = 'active'`. Returns `{ link_url, link_token, expires_at }`. If gateway not enabled, return 400 with message.

### Step 3: Add invoice payment webhook handler

**File:** `backend/routes/webhooks.js`

Add handler for invoice payment completions (extend existing xPay webhook handler pattern):
1. On successful payment event, look up `customer_invoice_payment_links` by `gateway_ref`.
2. Update link status to `'completed'`.
3. Insert `customer_invoice_payments` row with `payment_type = 'payment'`, `payment_method = 'online'`.
4. Call `recomputeBalance()` on the invoice.

### Step 4: Commit

```bash
git add backend/routes/customer-invoices.js backend/services/payment-gateway.js backend/routes/webhooks.js
git commit -m "feat(phase3): add payment links for customer invoices via gateway adapter"
```

---

## Task 6: Subscription Plans + Customer Subscriptions (Phase 3B)

**Files:**
- Create: `backend/services/subscriptions.js`
- Create: `backend/routes/subscriptions.js`
- Create: `backend/schemas/subscriptions.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: `backend/workers/email-worker-boss.js` (add renewal job)

### Step 1: Create subscription service

**File:** `backend/services/subscriptions.js`

Functions:
- `computeNextPeriod(currentPeriodEnd, interval, intervalCount)` — returns `{ start, end }` for next billing period.
- `processRenewal(db, boss, subscriptionId)` — load subscription + plan. If `auto_charge = true` AND `requireFeature('subscription_autocharge')` is enabled, attempt charge via gateway token. If charge fails or auto_charge disabled, create a customer invoice for the renewal amount. Insert `subscription_runs` row. Update `current_period_start/end`.
- `cancelSubscription(db, subscriptionId)` — set status to `'cancelled'`, `cancelled_at = NOW()`.
- `pauseSubscription(db, subscriptionId)` — set status to `'paused'`, `paused_at = NOW()`.
- `resumeSubscription(db, boss, subscriptionId)` — set status to `'active'`, clear `paused_at`, schedule next renewal.

### Step 2: Create Zod schemas

**File:** `backend/schemas/subscriptions.js`

- `createPlanSchema` — name, price, billing_interval (monthly|quarterly|yearly), billing_interval_count, trial_days, description
- `createSubscriptionSchema` — plan_id (required), customer_id (required), auto_charge (boolean, default false)

### Step 3: Create subscription routes

**File:** `backend/routes/subscriptions.js`

Endpoints:
- `GET /api/subscription-plans` — list active plans.
- `POST /api/subscription-plans` — create plan.
- `PUT /api/subscription-plans/:id` — update plan (name, price, description, is_active).
- `GET /api/customer-subscriptions` — list with customer name, plan name, status, next renewal.
- `POST /api/customer-subscriptions` — create subscription. Set `current_period_start = NOW()`, compute `current_period_end`. If plan has `trial_days > 0`, set `trial_end`. Schedule renewal via pg-boss.
- `PUT /api/customer-subscriptions/:id` — update metadata.
- `POST /api/customer-subscriptions/:id/pause` — pause (reject if not active).
- `POST /api/customer-subscriptions/:id/resume` — resume (reject if not paused).
- `POST /api/customer-subscriptions/:id/cancel` — cancel.

All routes gated by `requireFeature('subscription_billing')` and `requirePerm('all_access')`.

### Step 4: Add renewal job to email-worker-boss.js

Register `"subscription-renewal"` job. Job data: `{ subscriptionId, tenantSlug }`. Handler calls `processRenewal()`. Schedule: pg-boss `startAfter` set to `current_period_end`.

### Step 5: Mount routes + commit

```bash
git add backend/services/subscriptions.js backend/routes/subscriptions.js backend/schemas/subscriptions.js backend/routes/registerAllRoutes.js backend/workers/email-worker-boss.js
git commit -m "feat(phase3): add subscription plans, customer subscriptions, renewal scheduling via pg-boss"
```

---

## Task 7: Frontend — Marketing Campaigns Page

**Files:**
- Create: `frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx`
- Create: `frontend/src/pages/MarketingCampaignsRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

### Step 1: Create MarketingCampaignsRedesign.jsx

Tab-based page with:
- **Campaigns tab** — list of campaigns with status badges (draft/scheduled/sending/sent/partial/failed), create button opens composer modal. Composer: name, subject, body (rich text or HTML textarea), template picker dropdown, audience filter builder (add filters from dropdown: group, tag, city, tier, birth month, spend range, last purchase), preview count (calls `/api/marketing/audiences/preview`), test-send button, schedule button with date picker.
- **Templates tab** — list + create/edit modal.

Feature flag check: redirect to `/dashboard` if `marketing_campaigns` flag is off.

Use `api.get/post/put` for all calls. Use `PageShell`, `SectionCard`, `Button`, `Badge` from `ui/primitives.jsx`.

### Step 2: Create route wrapper + register

Standard 5-line `MarketingCampaignsRoute.jsx`. Add lazy import + route to `appRoutes.jsx`:

```jsx
const MarketingCampaignsRoute = lazy(() => import("../pages/MarketingCampaignsRoute"));
// Inside appRoutes:
<Route path="/marketing/campaigns" element={perm("all_access", <MarketingCampaignsRoute />)} />
```

### Step 3: Add nav entry + breadcrumb

In `nav-config.js`, add to an appropriate group (Operations or a new "Marketing" group):
```js
{ name: "Campaigns", path: "/marketing/campaigns", icon: Mail, requiredPerm: "all_access", requiredFlag: "marketing_campaigns" },
```

In `Breadcrumbs.jsx`, add: `"marketing": "Marketing"`, `"campaigns": "Campaigns"`.

### Step 4: Commit

```bash
git add frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx frontend/src/pages/MarketingCampaignsRoute.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase3): add marketing campaigns frontend — list, composer, templates, audience preview"
```

---

## Task 8: Frontend — Messaging Inbox Page

**Files:**
- Create: `frontend/src/pages/redesign/MessagingInboxRedesign.jsx`
- Create: `frontend/src/pages/MessagingInboxRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

### Step 1: Create MessagingInboxRedesign.jsx

Split-pane layout (Chatwoot-inspired):
- **Left panel** — thread list with customer name, last message preview, unread badge, channel icon (WhatsApp), timestamp. Filter by status (open/closed/all). Click selects thread.
- **Right panel** — message timeline (scrollable, newest at bottom), inbound messages left-aligned, outbound right-aligned. Reply composer at bottom with text input + send button. Thread header shows customer name, phone, assigned_to dropdown, status toggle (open/close).

Feature flag check: redirect if `customer_messaging` off.

### Step 2: Create route wrapper + register + nav + breadcrumb

Same pattern as Task 7.

```jsx
const MessagingInboxRoute = lazy(() => import("../pages/MessagingInboxRoute"));
<Route path="/messaging/inbox" element={perm("manage_orders", <MessagingInboxRoute />)} />
```

Nav entry:
```js
{ name: "Inbox", path: "/messaging/inbox", icon: MessageSquare, requiredPerm: "manage_orders", requiredFlag: "customer_messaging" },
```

### Step 3: Commit

```bash
git add frontend/src/pages/redesign/MessagingInboxRedesign.jsx frontend/src/pages/MessagingInboxRoute.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase3): add messaging inbox frontend — thread list, message timeline, staff replies"
```

---

## Task 9: Frontend — Customer Invoices Page

**Files:**
- Create: `frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx`
- Create: `frontend/src/pages/CustomerInvoicesRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`
- Modify: `frontend/src/pages/redesign/QuotationsRedesign.jsx` (add convert-to-invoice action)

### Step 1: Create CustomerInvoicesRedesign.jsx

Features:
- **Invoice list** — table with invoice number, customer, status badge (draft/sent/partial/paid/overdue/void), total, balance due, due date. Filters: status, date range, customer search.
- **Create invoice modal** — customer select, line items editor (add/remove rows: description, qty, price, tax), due date, notes, auto-computed totals.
- **Invoice detail view** — line items, payment history table, deposit entry form (amount, method, reference), send button (enqueues email), reminder status indicators, void button.
- **Batch create button** — select multiple customers, define items, submit.
- **Payment link button** — generates link (shows warning if gateway unavailable).
- **CSV export** — via shared `csvExport.js`.

### Step 2: Add convert-to-invoice action in QuotationsRedesign.jsx

Add a "Convert to Invoice" button on accepted quotations. Calls `POST /api/customer-invoices/from-quotation/:quotationId`. On success, navigate to `/customer-invoices`.

### Step 3: Create route wrapper + register + nav + breadcrumb

```jsx
const CustomerInvoicesRoute = lazy(() => import("../pages/CustomerInvoicesRoute"));
<Route path="/customer-invoices" element={perm("manage_orders", <CustomerInvoicesRoute />)} />
```

Nav entry:
```js
{ name: "Customer Invoices", path: "/customer-invoices", icon: FileText, requiredPerm: "manage_orders", requiredFlag: "customer_invoicing" },
```

### Step 4: Commit

```bash
git add frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx frontend/src/pages/CustomerInvoicesRoute.jsx frontend/src/pages/redesign/QuotationsRedesign.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase3): add customer invoices frontend — list, detail, deposits, batch, quotation conversion"
```

---

## Task 10: Frontend — Subscriptions Page

**Files:**
- Create: `frontend/src/pages/redesign/SubscriptionsRedesign.jsx`
- Create: `frontend/src/pages/SubscriptionsRoute.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

### Step 1: Create SubscriptionsRedesign.jsx

Tab-based page:
- **Plans tab** — list plans with name, price, interval, active toggle. Create/edit modal.
- **Subscriptions tab** — list customer subscriptions with customer name, plan, status badge (draft/active/paused/cancelled/expired), current period, next renewal date. Actions: pause, resume, cancel. Create modal: select customer + plan.

Feature flag check: redirect if `subscription_billing` off. Show clear message when auto-charge is disabled.

### Step 2: Create route wrapper + register + nav + breadcrumb

```jsx
const SubscriptionsRoute = lazy(() => import("../pages/SubscriptionsRoute"));
<Route path="/subscriptions" element={perm("all_access", <SubscriptionsRoute />)} />
```

Nav entry:
```js
{ name: "Subscriptions", path: "/subscriptions", icon: RefreshCw, requiredPerm: "all_access", requiredFlag: "subscription_billing" },
```

### Step 3: Commit

```bash
git add frontend/src/pages/redesign/SubscriptionsRedesign.jsx frontend/src/pages/SubscriptionsRoute.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js frontend/src/ui/Breadcrumbs.jsx
git commit -m "feat(phase3): add subscriptions frontend — plans management, subscription lifecycle UI"
```

---

## Task 11: Permissions, Audit Logging, and Observability

**Files:**
- Modify: `backend/middleware/permissions.js` (add new permission entries if needed)
- Modify: `backend/routes/admin/monitoring.js` (add campaign/reminder worker status)
- Modify: `backend/routes/marketing.js` (add action_history logging)
- Modify: `backend/routes/customer-invoices.js` (add action_history logging)
- Modify: `backend/routes/messaging.js` (add action_history logging)
- Modify: `backend/routes/subscriptions.js` (add action_history logging)

### Step 1: Add audit logging to all mutation endpoints

Pattern (same as existing routes — grep `action_history` in any route for reference):
```js
await db.query(
  "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
  [req.employee.id, "campaign_scheduled", JSON.stringify({ campaign_id: id })]
);
```

Key actions to log:
- `campaign_created`, `campaign_scheduled`, `campaign_sent`
- `message_sent` (outbound reply)
- `invoice_created`, `invoice_sent`, `invoice_payment_recorded`, `invoice_voided`
- `subscription_created`, `subscription_paused`, `subscription_resumed`, `subscription_cancelled`

### Step 2: Add worker health status for campaign/reminder workers

In email-worker-boss.js, add heartbeat globals:
```js
global.__campaignWorkerStatus = { lastPollAt: null, processedToday: 0 };
```

Update `routes/admin/monitoring.js` GET `/api/admin/worker-status` to include campaign worker status.

### Step 3: Commit

```bash
git add backend/middleware/permissions.js backend/routes/admin/monitoring.js backend/routes/marketing.js backend/routes/customer-invoices.js backend/routes/messaging.js backend/routes/subscriptions.js backend/workers/email-worker-boss.js
git commit -m "feat(phase3): add audit logging, permission checks, and worker observability for all Phase 3 domains"
```

---

## Task 12: Customer Page Enhancements

**Files:**
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx`

### Step 1: Add consent toggles and channel info

In the customer detail/edit view, add:
- Email consent toggle
- SMS consent toggle
- WhatsApp consent toggle
- Quick action buttons: "Send Invoice", "View Messages" (links to inbox filtered by customer)
- Invoice history section (if `customer_invoicing` flag enabled): list recent invoices with status

### Step 2: Commit

```bash
git add frontend/src/pages/redesign/CustomersRedesign.jsx
git commit -m "feat(phase3): add consent toggles, invoice history, and messaging links to customer detail"
```

---

## Task 13: Integration Tests

**Files:**
- Create: `backend/tests/integration/pg-phase3-marketing.test.js`
- Create: `backend/tests/integration/pg-phase3-messaging.test.js`
- Create: `backend/tests/integration/pg-phase3-invoicing.test.js`
- Create: `backend/tests/integration/pg-phase3-subscriptions.test.js`

### Test coverage per file:

**pg-phase3-marketing.test.js:**
- Campaign CRUD (create, update, list)
- Template CRUD
- Audience preview returns correct count for each filter type
- Schedule campaign (status transitions)
- Campaign delivery logging

**pg-phase3-messaging.test.js:**
- Thread findOrCreate (create new, find existing)
- Add message (inbound increments unread, outbound resets)
- Thread list with filters
- Message list pagination

**pg-phase3-invoicing.test.js:**
- Invoice CRUD + auto-numbering
- Compute totals (line items + tax + discount)
- Record payment → balance recompute → status transition (draft → sent → partial → paid)
- Record deposit (payment_type = 'deposit') → balance reduces but not paid
- Batch create — idempotency (second run does not duplicate)
- Quotation-to-invoice conversion (accepted only)
- Void invoice
- Reminder scheduling

**pg-phase3-subscriptions.test.js:**
- Plan CRUD
- Create subscription → period computation
- Pause/resume lifecycle
- Cancel subscription
- Renewal processing (manual fallback → creates invoice)

Pattern: use `createTestApp-pg.js` factory for isolated schema per test, same as existing integration tests.

### Commit

```bash
git add backend/tests/integration/pg-phase3-*.test.js
git commit -m "test(phase3): add integration tests for marketing, messaging, invoicing, subscriptions"
```

---

## Task 14: CLAUDE.md Documentation Updates

**Files:**
- Modify: `CLAUDE.md` (root — add Phase 3 routes, tables, feature flags)
- Modify: `backend/CLAUDE.md` (add new services, routes, workers, feature flags)
- Modify: `frontend/CLAUDE.md` (add new pages)

### Updates:

- Add Phase 3 routes to the Project Structure tree
- Add v21 migration description to the Migrations section
- Add 7 new feature flags to the Feature Flags Registry table
- Add new services to the backend services section
- Add new frontend pages to the pages list
- Update test count

### Commit

```bash
git add CLAUDE.md backend/CLAUDE.md frontend/CLAUDE.md
git commit -m "docs: update CLAUDE.md files for Phase 3 domains"
```

---

## Execution Order Summary

| Task | Domain | Phase | Depends On |
|------|--------|-------|------------|
| 1 | Migration v21 + feature flags | 3A | — |
| 2 | Campaign service + routes | 3A | Task 1 |
| 3 | Messaging inbox + routes | 3A | Task 1 |
| 4 | Customer invoicing + routes | 3A | Task 1 |
| 5 | Payment links | 3B | Task 4 |
| 6 | Subscriptions + routes | 3B | Task 1, Task 4 (for invoice fallback) |
| 7 | Frontend: Campaigns page | 3A | Task 2 |
| 8 | Frontend: Inbox page | 3A | Task 3 |
| 9 | Frontend: Invoices page | 3A | Task 4 |
| 10 | Frontend: Subscriptions page | 3B | Task 6 |
| 11 | Permissions + audit | All | Tasks 2-6 |
| 12 | Customer page enhancements | All | Tasks 1-4 |
| 13 | Integration tests | All | Tasks 2-6 |
| 14 | Documentation | All | All |

**Parallelizable:** Tasks 2, 3, 4 can run in parallel after Task 1. Tasks 7, 8, 9 can run in parallel after their backend counterparts.

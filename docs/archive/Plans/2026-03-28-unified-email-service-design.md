# Unified Email Service Design

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Tenant-branded receipts via Resend, onboarding drip emails, billing notifications, support ticket updates, downtime/announcement broadcasts

---

## Context

SanoPOS has `sanopos.com` as a verified Resend domain (SPF/DKIM/DMARC). Currently:
- **System emails** (password reset, welcome, alerts) use Resend via `resendEmail.js`
- **Tenant emails** (receipts, digest) use tenant-configured SMTP via `email.js` routes, with Resend as fallback
- The Resend fallback sends from `noreply@sanopos.com` — no tenant branding
- No drip emails, billing notifications, support updates, or broadcast capabilities exist

## Goals

1. Tenant receipt emails via Resend use branded sender: `Store Name <slug@sanopos.com>`
2. 3-email onboarding drip series for new signups
3. Billing notifications (payment, plan change, expiry, overdue)
4. Support ticket lifecycle emails (received, resolved)
5. Admin-triggered broadcast emails (downtime, announcements)
6. Single `sendEmail()` entry point for all email types

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `services/email.js` | Unified `sendEmail()` orchestrator + sender resolution |
| `services/email-templates.js` | HTML builder functions for all 12 email types |
| `workers/email-worker.js` | Queue processor (60s poll) + daily billing check |

### Modified Files

| File | Change |
|------|--------|
| `routes/email.js` | `send-receipt-v2` Resend fallback uses branded sender |
| `routes/auth.js` | Enqueue drip emails on signup |
| `routes/billing.js` | Fire billing notifications on payment/plan-change |
| `routes/support.js` | Fire ticket-received email to submitting employee |
| `routes/admin.js` | Fire ticket-resolved email; add downtime/announcement endpoints |
| `schema-pg.sql` | Add `email_queue` table to public schema |
| `migrate-pg.js` | Migration v10 |
| `index.js` | Start email worker (`EMAIL_WORKER_ENABLED=1`) |

---

## sendEmail() API

```js
const { sendEmail } = require("../services/email");

await sendEmail({
  type: "receipt",              // determines template + sender
  to: "customer@example.com",
  tenant: { slug, name },      // for sender resolution
  data: { sale, items, ... }   // template-specific payload
});
```

### Sender Resolution

| Email category | From address |
|---------------|--------------|
| Tenant → Customer (`receipt`, `digest`) | `Store Name <slug@sanopos.com>` |
| Platform → Tenant (all others) | `SanoPOS <noreply@sanopos.com>` |
| System alerts | Unchanged (`alertEmail.js`) |

Since `sanopos.com` is a verified Resend domain, any `*@sanopos.com` address works without per-address verification.

---

## Email Types (12 total)

### Tenant → Customer

| Type | Trigger | Sender |
|------|---------|--------|
| `receipt` | `send-receipt-v2` Resend fallback | `Store Name <slug@sanopos.com>` |
| `digest` | Scheduled EOD report | `Store Name <slug@sanopos.com>` |

### Platform → Tenant (Drip)

| Type | Trigger | Timing |
|------|---------|--------|
| `drip_welcome` | Signup | Immediate (existing, improved) |
| `drip_getting_started` | Signup | +2 days |
| `drip_features` | Signup | +5 days |

Drip content:
- **Welcome** (immediate): Existing welcome email, enhanced with setup guide links
- **Getting Started** (day 2): "Add your first products", "Open your first shift", "Make a sale" — links to relevant pages
- **Features** (day 5): "Did you know?" highlights — receipt customization, reports, keyboard shortcuts, mobile PWA

### Platform → Tenant (Billing)

| Type | Trigger | Source |
|------|---------|--------|
| `billing_payment_recorded` | Admin records payment | Event-triggered |
| `billing_plan_changed` | Admin changes plan | Event-triggered |
| `billing_expiry_warning` | 7 days before expiry | Daily cron |
| `billing_overdue` | Past `plan_expires_at` | Daily cron |

### Platform → Tenant (Support)

| Type | Trigger |
|------|---------|
| `support_received` | Employee submits ticket |
| `support_resolved` | Admin marks ticket resolved |

### Platform → All Tenants (Broadcast)

| Type | Trigger |
|------|---------|
| `downtime` | `POST /api/admin/email/downtime` (manual) |
| `announcement` | `POST /api/admin/email/announcement` (manual) |

Recipient for all platform→tenant emails: `company_profile.email` (one per tenant, typically the owner).

---

## Email Queue

### Table (public schema only)

```sql
CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  email_type TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  from_address TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_queue_pending
  ON email_queue(send_at) WHERE sent_at IS NULL AND attempts < max_attempts;
```

Public schema because platform emails (drip, billing, downtime, announcements) are cross-tenant concerns. Worker queries one table, not N tenant schemas.

### Usage Patterns

**Immediate send** (receipts, support, billing events): Call `sendEmail()` directly — sends via Resend API immediately, no queue.

**Deferred send** (drip, downtime, announcements): Enqueue to `email_queue` with future `send_at`. Worker picks up and sends.

**Daily billing check** (expiry, overdue): Worker runs billing check once per day, enqueues any needed emails. Deduplication: skip if `email_queue` already has unsent row of same `(tenant_id, email_type)` within last 24h.

---

## Worker

### Behavior

- **Startup**: Gated by `EMAIL_WORKER_ENABLED=1` env var
- **Inline**: Runs inside Express process (same pattern as FBR worker)
- **Poll interval**: 60 seconds
- **Queue processing**: Pick rows where `sent_at IS NULL AND send_at <= NOW() AND attempts < max_attempts`, send via Resend, mark `sent_at` on success
- **Failure handling**: Increment `attempts`, store error message. No exponential backoff — retries on next poll cycle
- **Daily billing check**: Track last check time in memory. If 24h elapsed, query `tenants` for expiry/overdue conditions, enqueue emails with deduplication

### Billing Check Queries

```sql
-- Expiry warning (7 days)
SELECT * FROM tenants
WHERE plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
  AND status = 'active' AND plan != 'free';

-- Overdue
SELECT * FROM tenants
WHERE plan_expires_at < NOW()
  AND status = 'active' AND plan != 'free';
```

---

## Template Structure

All templates use a shared `wrapEmailHtml(title, bodyContent)` base:
- SanoPOS branded header (dark gradient, logo area)
- White content card
- Footer with tagline
- Inline CSS for email client compatibility

Each template function signature:
```js
function templateName(data) {
  return { subject: "...", html: wrapEmailHtml("Title", "<p>...</p>") };
}
```

---

## Route Integration

### `routes/auth.js` — Signup drip enqueue
After existing `sendWelcomeEmail()`:
```js
await enqueueEmail(db, tenantId, "drip_getting_started", ownerEmail, +2 days);
await enqueueEmail(db, tenantId, "drip_features", ownerEmail, +5 days);
```

### `routes/billing.js` — Payment/plan events
After successful admin payment recording or plan change, fire `sendEmail()` immediately (fire-and-forget with `.catch()`).

### `routes/support.js` — Ticket received
After ticket saved, fire `sendEmail({ type: "support_received" })` (fire-and-forget).

### `routes/admin.js` — Ticket resolved + broadcasts
- Ticket resolve: fire `sendEmail({ type: "support_resolved" })` (fire-and-forget)
- `POST /api/admin/email/downtime` — query all active tenants with company email, enqueue for each
- `POST /api/admin/email/announcement` — same pattern

### `routes/email.js` — Receipt sender upgrade
In `send-receipt-v2` Resend fallback path, change sender from `RESEND_FROM_EMAIL` to `Store Name <slug@sanopos.com>` using tenant context.

---

## Non-Breaking Guarantees

- Existing SMTP-first logic for receipts/digest is untouched
- Only the Resend fallback sender address changes
- Existing `resendEmail.js` (welcome, password reset) continues working — not replaced
- Existing `alertEmail.js` stays separate (different concern: ops alerting)
- New email types are additive — no existing behavior removed

---

## Railway Env Var

Add `EMAIL_WORKER_ENABLED=1` to Railway after deployment.

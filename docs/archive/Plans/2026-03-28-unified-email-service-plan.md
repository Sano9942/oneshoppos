# Unified Email Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tenant-branded receipt emails via Resend (`slug@sanopos.com`), onboarding drip emails, billing notifications, support ticket updates, and admin broadcast emails — all through a unified `sendEmail()` service with a queue-based worker.

**Architecture:** Single `services/email.js` orchestrator resolves sender addresses and sends via Resend. Deferred emails (drip, broadcasts) go through an `email_queue` table in the public schema. An inline worker (like FBR worker) polls the queue every 60s and runs daily billing checks.

**Tech Stack:** Resend API (existing), Postgres `email_queue` table, Express inline worker pattern.

**Design doc:** `docs/plans/2026-03-28-unified-email-service-design.md`

---

### Task 1: Migration v10 — email_queue table

**Files:**
- Modify: `backend/migrate-pg.js` (add v10 to MIGRATIONS array)
- Modify: `backend/schema-pg.sql` (add email_queue DDL for new tenant provisioning)

**Step 1: Add v10 migration to migrate-pg.js**

Open `backend/migrate-pg.js`, find the MIGRATIONS array, and add after the v9 object:

```js
{
  version: 10,
  description: "Email queue for deferred/scheduled emails",
  async up(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS email_queue (
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
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_pending
      ON email_queue(send_at) WHERE sent_at IS NULL AND attempts < max_attempts`);
  },
},
```

**Important:** This table goes in the **public schema only** (the migration runs in public context for public-schema tables). Since `email_queue` references `tenants(id)`, it must be in public schema. The `up(client)` runs in public schema by default — same as how `tax_rate_reference` was handled in v9.

However, check the v9 migration pattern — it checks `information_schema.tables` for `tenants` to decide public vs tenant schema. For v10, since `email_queue` is always public and the migration already runs once in public context, no conditional is needed.

**Step 2: Add email_queue DDL to schema-pg.sql**

Add after the existing `tax_rate_reference` CREATE TABLE block (near end of file, in the public schema section):

```sql
-- Email queue (public schema — cross-tenant deferred emails)
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

**Step 3: Run migration locally to verify**

Run: `cd backend && node migrate-pg.js`
Expected: Migration v10 applied successfully.

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat(db): add email_queue table (migration v10)"
```

---

### Task 2: Email templates — `services/email-templates.js`

**Files:**
- Create: `backend/services/email-templates.js`

**Step 1: Create the templates file**

This file exports a template registry — each function takes data and returns `{ subject, html }`. All templates use a shared `wrapEmailHtml()` base wrapper.

```js
/**
 * Email templates for the unified email service.
 *
 * Each template function returns { subject, html }.
 * All use wrapEmailHtml() for consistent branding.
 */

// ── Shared HTML wrapper ─────────────────────────────────────────────
function wrapEmailHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
  <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
    <tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:24px 32px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">SanoPOS</h1>
      ${title ? `<p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">${title}</p>` : ""}
    </td></tr>
    <tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px">
      ${bodyContent}
    </td></tr>
    <tr><td style="padding:16px 32px;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function btn(text, url) {
  return `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">${text}</a></p>`;
}

function footer(text) {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/><p style="color:#94a3b8;font-size:12px;margin:0">${text}</p>`;
}

// ── Drip: Getting Started (Day 2) ───────────────────────────────────
function dripGettingStarted({ storeName, slug, frontendUrl }) {
  const url = `${frontendUrl}/?store=${slug}`;
  return {
    subject: `Get started with ${storeName} — 3 quick steps`,
    html: wrapEmailHtml("Getting Started", `
      <p>Hi there,</p>
      <p>Your store <strong>${storeName}</strong> is set up. Here's how to start selling in minutes:</p>
      <ol style="color:#475569;line-height:2;padding-left:20px">
        <li><strong>Add your products</strong> — go to Products and add your inventory</li>
        <li><strong>Open a shift</strong> — head to POS and open your cash register</li>
        <li><strong>Make your first sale</strong> — scan or search for products and checkout</li>
      </ol>
      ${btn("Open Your Store", url)}
      ${footer("You're receiving this because you recently signed up for SanoPOS.")}
    `),
  };
}

// ── Drip: Feature Highlights (Day 5) ────────────────────────────────
function dripFeatures({ storeName, slug, frontendUrl }) {
  const url = `${frontendUrl}/?store=${slug}`;
  return {
    subject: `Did you know? ${storeName} tips & tricks`,
    html: wrapEmailHtml("Tips & Tricks", `
      <p>Hi there,</p>
      <p>Here are some features you might not have tried yet:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Keyboard Shortcuts</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Press F1 in POS for the full shortcut list</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Receipt Customization</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Add your logo, custom header/footer text</td></tr>
        <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0"><strong>Reports</strong></td>
            <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b">Sales summaries, inventory reports, shift reports</td></tr>
        <tr><td style="padding:12px"><strong>Install as App</strong></td>
            <td style="padding:12px;color:#64748b">Open SanoPOS in Chrome and click "Install" for a native-like experience</td></tr>
      </table>
      ${btn("Explore Features", url)}
      ${footer("You're receiving this because you recently signed up for SanoPOS.")}
    `),
  };
}

// ── Billing: Payment Recorded ───────────────────────────────────────
function billingPaymentRecorded({ storeName, amount, plan, cycle, periodEnd }) {
  return {
    subject: `Payment received — ${storeName}`,
    html: wrapEmailHtml("Payment Confirmed", `
      <p>Hi,</p>
      <p>We've recorded your payment for <strong>${storeName}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f0fdf4;border-radius:8px">
        <tr><td style="padding:12px 16px;color:#64748b">Plan</td><td style="padding:12px 16px;font-weight:600">${plan} (${cycle})</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Amount</td><td style="padding:12px 16px;font-weight:600">${amount}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Valid Until</td><td style="padding:12px 16px;font-weight:600">${periodEnd}</td></tr>
      </table>
      <p>Thank you for choosing SanoPOS!</p>
      ${footer("This is a payment confirmation for your SanoPOS subscription.")}
    `),
  };
}

// ── Billing: Plan Changed ───────────────────────────────────────────
function billingPlanChanged({ storeName, oldPlan, newPlan, newLimits }) {
  return {
    subject: `Plan updated — ${storeName}`,
    html: wrapEmailHtml("Plan Updated", `
      <p>Hi,</p>
      <p>Your plan for <strong>${storeName}</strong> has been changed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:12px 16px;color:#64748b">Previous Plan</td><td style="padding:12px 16px">${oldPlan}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">New Plan</td><td style="padding:12px 16px;font-weight:600;color:#059669">${newPlan}</td></tr>
        ${newLimits ? `<tr><td style="padding:12px 16px;color:#64748b">Outlets</td><td style="padding:12px 16px">${newLimits.max_outlets}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Employees</td><td style="padding:12px 16px">${newLimits.max_employees}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Products</td><td style="padding:12px 16px">${newLimits.max_products}</td></tr>` : ""}
      </table>
      ${footer("This is a plan change notification for your SanoPOS account.")}
    `),
  };
}

// ── Billing: Expiry Warning ─────────────────────────────────────────
function billingExpiryWarning({ storeName, plan, expiresAt, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `expires in ${daysLeft} days`;
  return {
    subject: `Your ${plan} plan ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Subscription Expiring", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> plan for <strong>${storeName}</strong> ${urgency} (${expiresAt}).</p>
      <p>To continue without interruption, please contact us to renew your subscription.</p>
      <p style="color:#64748b;font-size:14px">If your plan expires, your account will remain accessible but some features may be limited.</p>
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// ── Billing: Overdue ────────────────────────────────────────────────
function billingOverdue({ storeName, plan, expiredAt }) {
  return {
    subject: `Payment overdue — ${storeName}`,
    html: wrapEmailHtml("Payment Overdue", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> plan for <strong>${storeName}</strong> expired on <strong>${expiredAt}</strong> and no renewal payment has been recorded.</p>
      <p>Please contact us to renew your subscription and restore full access.</p>
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// ── Support: Ticket Received ────────────────────────────────────────
function supportReceived({ ticketId, type, message, storeName }) {
  return {
    subject: `Support ticket #${ticketId} received — ${storeName}`,
    html: wrapEmailHtml("Ticket Received", `
      <p>Hi,</p>
      <p>We've received your support ticket and will get back to you shortly.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px">
        <tr><td style="padding:12px 16px;color:#64748b">Ticket #</td><td style="padding:12px 16px;font-weight:600">${ticketId}</td></tr>
        <tr><td style="padding:12px 16px;color:#64748b">Type</td><td style="padding:12px 16px">${type}</td></tr>
      </table>
      <blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:12px 16px;color:#475569">${message}</blockquote>
      ${footer("This is an automated confirmation for your support ticket.")}
    `),
  };
}

// ── Support: Ticket Resolved ────────────────────────────────────────
function supportResolved({ ticketId, type, storeName }) {
  return {
    subject: `Support ticket #${ticketId} resolved — ${storeName}`,
    html: wrapEmailHtml("Ticket Resolved", `
      <p>Hi,</p>
      <p>Your support ticket <strong>#${ticketId}</strong> (${type}) has been resolved.</p>
      <p>If you're still experiencing issues, feel free to submit a new ticket using the support widget.</p>
      ${footer("This is an automated notification about your support ticket.")}
    `),
  };
}

// ── Broadcast: Downtime ─────────────────────────────────────────────
function downtime({ subject: subj, message }) {
  return {
    subject: `[SanoPOS] ${subj}`,
    html: wrapEmailHtml("Service Notice", `
      <p>Hi,</p>
      ${message}
      <p style="color:#64748b;font-size:14px;margin-top:20px">We apologize for any inconvenience. Thank you for your patience.</p>
      ${footer("This is a service notification from SanoPOS.")}
    `),
  };
}

// ── Broadcast: Announcement ─────────────────────────────────────────
function announcement({ subject: subj, message }) {
  return {
    subject: `[SanoPOS] ${subj}`,
    html: wrapEmailHtml("Announcement", `
      <p>Hi,</p>
      ${message}
      ${footer("This is an announcement from SanoPOS.")}
    `),
  };
}

// ── Template Registry ───────────────────────────────────────────────
const TEMPLATES = {
  drip_getting_started: dripGettingStarted,
  drip_features: dripFeatures,
  billing_payment_recorded: billingPaymentRecorded,
  billing_plan_changed: billingPlanChanged,
  billing_expiry_warning: billingExpiryWarning,
  billing_overdue: billingOverdue,
  support_received: supportReceived,
  support_resolved: supportResolved,
  downtime,
  announcement,
};

module.exports = { TEMPLATES, wrapEmailHtml };
```

**Step 2: Commit**

```bash
git add backend/services/email-templates.js
git commit -m "feat(email): add email template registry (12 types)"
```

---

### Task 3: Email service — `services/email.js`

**Files:**
- Create: `backend/services/email.js`

**Step 1: Create the email service**

```js
/**
 * Unified email service.
 *
 * sendEmail()    — sends immediately via Resend API
 * enqueueEmail() — inserts into email_queue for deferred sending
 */

const { Resend } = require("resend");
const { TEMPLATES } = require("./email-templates");
const logger = require("./logger").child({ component: "email-service" });

let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

/**
 * Resolve the "from" address based on email type and tenant.
 *
 * Tenant→Customer emails: "Store Name <slug@sanopos.com>"
 * Platform→Tenant emails: "SanoPOS <noreply@sanopos.com>"
 */
function resolveFrom(type, tenant) {
  const TENANT_TYPES = ["receipt", "digest"];
  if (TENANT_TYPES.includes(type) && tenant?.slug && tenant?.name) {
    return `${tenant.name} <${tenant.slug}@sanopos.com>`;
  }
  return process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";
}

/**
 * Send an email immediately via Resend.
 *
 * @param {object} opts
 * @param {string} opts.type       — email type key (matches TEMPLATES registry)
 * @param {string} opts.to         — recipient email
 * @param {object} [opts.tenant]   — { slug, name } for sender resolution
 * @param {object} [opts.data]     — template-specific data
 * @param {string} [opts.subject]  — override subject (for receipt/digest which build their own HTML)
 * @param {string} [opts.html]     — override HTML (for receipt/digest which build their own HTML)
 */
async function sendEmail({ type, to, tenant, data, subject, html }) {
  const from = resolveFrom(type, tenant);

  // If subject+html provided directly (e.g. receipt with pre-built HTML), use them
  if (subject && html) {
    return _send(from, to, subject, html);
  }

  // Otherwise, look up template
  const templateFn = TEMPLATES[type];
  if (!templateFn) {
    throw new Error(`Unknown email type: ${type}`);
  }

  const result = templateFn(data || {});
  return _send(from, to, result.subject, result.html);
}

async function _send(from, to, subject, html) {
  const resend = getResend();
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    logger.error({ error, to, subject }, "Resend send failed");
    throw new Error(`Resend error: ${error.message}`);
  }
  logger.info({ to, subject: subject.substring(0, 60) }, "Email sent");
}

/**
 * Enqueue an email for deferred sending.
 *
 * @param {object} db       — master db (db-pg pool, queries public schema)
 * @param {object} opts
 * @param {number} [opts.tenantId] — tenant ID (NULL for system-wide)
 * @param {string} opts.type       — email type key
 * @param {string} opts.to         — recipient email
 * @param {object} [opts.tenant]   — { slug, name } for sender resolution
 * @param {object} [opts.data]     — template-specific data
 * @param {Date}   [opts.sendAt]   — when to send (default: now)
 */
async function enqueueEmail(db, { tenantId, type, to, tenant, data, sendAt }) {
  const from = resolveFrom(type, tenant);
  const templateFn = TEMPLATES[type];
  if (!templateFn) throw new Error(`Unknown email type: ${type}`);

  const { subject, html } = templateFn(data || {});
  const sendAtVal = sendAt || new Date();

  await db.query(
    `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address, send_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId || null, type, to, subject, html, from, sendAtVal.toISOString()]
  );
}

module.exports = { sendEmail, enqueueEmail, resolveFrom };
```

**Step 2: Commit**

```bash
git add backend/services/email.js
git commit -m "feat(email): add unified sendEmail() and enqueueEmail() service"
```

---

### Task 4: Email worker — `workers/email-worker.js`

**Files:**
- Create: `backend/workers/email-worker.js`

**Step 1: Create the worker**

Follow the FBR worker pattern exactly — inline mode with `startEmailWorker(db)`, standalone mode with `require.main === module`.

```js
/**
 * Email Queue Worker
 *
 * Polls email_queue in public schema every 60s.
 * Also runs daily billing checks (expiry warnings, overdue notices).
 *
 * Usage:
 *   Inline:     require('./workers/email-worker').startEmailWorker(db)
 *   Standalone:  node backend/workers/email-worker.js
 */

const { Resend } = require("resend");
const { TEMPLATES } = require("../services/email-templates");

const POLL_INTERVAL = 60_000; // 60 seconds
const BATCH_SIZE = 20;
const BILLING_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

let stopping = false;
let pollTimer = null;
let lastBillingCheck = 0;

// ── Queue Processing ────────────────────────────────────────────────

async function processQueue(pool, resend, logger) {
  const { rows } = await pool.query(
    `SELECT id, to_email, subject, html_body, from_address, attempts
     FROM email_queue
     WHERE sent_at IS NULL AND send_at <= NOW() AND attempts < max_attempts
     ORDER BY send_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const row of rows) {
    if (stopping) break;
    try {
      const { error } = await resend.emails.send({
        from: row.from_address,
        to: row.to_email,
        subject: row.subject,
        html: row.html_body,
      });
      if (error) throw new Error(error.message);

      await pool.query(
        "UPDATE email_queue SET sent_at = NOW() WHERE id = $1",
        [row.id]
      );
      logger.info({ id: row.id, to: row.to_email }, "Queued email sent");
    } catch (err) {
      await pool.query(
        "UPDATE email_queue SET attempts = attempts + 1, error = $1 WHERE id = $2",
        [err.message, row.id]
      );
      logger.error({ err, id: row.id }, "Queued email send failed");
    }
  }
}

// ── Daily Billing Check ─────────────────────────────────────────────

async function runBillingCheck(pool, logger) {
  const now = Date.now();
  if (now - lastBillingCheck < BILLING_CHECK_INTERVAL) return;
  lastBillingCheck = now;

  logger.info("Running daily billing email check");

  const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";
  const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";

  try {
    // Expiry warning — 7 days
    const { rows: expiring7 } = await pool.query(
      `SELECT id, slug, name, plan, plan_expires_at
       FROM tenants
       WHERE plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND status = 'active' AND plan != 'free'`
    );

    for (const t of expiring7) {
      // Deduplicate: skip if already enqueued in last 24h
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM email_queue
         WHERE tenant_id = $1 AND email_type = 'billing_expiry_warning'
           AND created_at > NOW() - INTERVAL '24 hours' AND sent_at IS NULL
         LIMIT 1`,
        [t.id]
      );
      if (existing.length) continue;

      // Get company email
      const email = await getTenantEmail(pool, t.slug);
      if (!email) continue;

      const daysLeft = Math.ceil((new Date(t.plan_expires_at) - new Date()) / 86400000);
      const template = TEMPLATES.billing_expiry_warning({
        storeName: t.name,
        plan: t.plan,
        expiresAt: new Date(t.plan_expires_at).toLocaleDateString(),
        daysLeft,
      });

      await pool.query(
        `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, "billing_expiry_warning", email, template.subject, template.html, fromAddress]
      );
      logger.info({ tenant: t.slug, daysLeft }, "Enqueued expiry warning");
    }

    // Overdue — past plan_expires_at
    const { rows: overdue } = await pool.query(
      `SELECT id, slug, name, plan, plan_expires_at
       FROM tenants
       WHERE plan_expires_at < NOW()
         AND status = 'active' AND plan != 'free'`
    );

    for (const t of overdue) {
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM email_queue
         WHERE tenant_id = $1 AND email_type = 'billing_overdue'
           AND created_at > NOW() - INTERVAL '24 hours' AND sent_at IS NULL
         LIMIT 1`,
        [t.id]
      );
      if (existing.length) continue;

      const email = await getTenantEmail(pool, t.slug);
      if (!email) continue;

      const template = TEMPLATES.billing_overdue({
        storeName: t.name,
        plan: t.plan,
        expiredAt: new Date(t.plan_expires_at).toLocaleDateString(),
      });

      await pool.query(
        `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, "billing_overdue", email, template.subject, template.html, fromAddress]
      );
      logger.info({ tenant: t.slug }, "Enqueued overdue notice");
    }
  } catch (err) {
    logger.error({ err }, "Billing check error");
  }
}

async function getTenantEmail(pool, slug) {
  try {
    const { rows } = await pool.query(
      `SELECT email FROM tenant_${slug}.company_profile WHERE id = 1`
    );
    return rows[0]?.email || null;
  } catch {
    return null;
  }
}

// ── Poll Loop ───────────────────────────────────────────────────────

async function pollOnce(pool, resend, logger) {
  if (stopping) return;
  try {
    await runBillingCheck(pool, logger);
    await processQueue(pool, resend, logger);
  } catch (err) {
    logger.error({ err }, "Email worker poll error");
  }
}

function startEmailWorker(db) {
  const pool = db.pool || db;
  const logger = require("../services/logger").child({ component: "email-worker" });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("EMAIL_WORKER_ENABLED but RESEND_API_KEY not set — worker disabled");
    return { stop() {} };
  }
  const resend = new Resend(key);

  logger.info("Email worker started (inline mode)");

  async function tick() {
    await pollOnce(pool, resend, logger);
    if (!stopping) {
      pollTimer = setTimeout(tick, POLL_INTERVAL);
    }
  }

  tick();

  return {
    stop() {
      stopping = true;
      if (pollTimer) clearTimeout(pollTimer);
    },
  };
}

// ── Standalone entry point ──────────────────────────────────────────
if (require.main === module) {
  require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const logger = require("../services/logger").child({ component: "email-worker" });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.error("RESEND_API_KEY not set");
    process.exit(1);
  }
  const resend = new Resend(key);

  logger.info("Email worker started (standalone mode)");

  async function tick() {
    await pollOnce(pool, resend, logger);
    if (!stopping) {
      pollTimer = setTimeout(tick, POLL_INTERVAL);
    }
  }

  tick();

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, stopping email worker...");
    stopping = true;
    if (pollTimer) clearTimeout(pollTimer);
    pool.end().then(() => process.exit(0));
  });
}

module.exports = { startEmailWorker };
```

**Step 2: Commit**

```bash
git add backend/workers/email-worker.js
git commit -m "feat(email): add email queue worker with daily billing checks"
```

---

### Task 5: Wire worker startup in index.js

**Files:**
- Modify: `backend/index.js` (add email worker startup after FBR worker block)

**Step 1: Add email worker startup**

Find the FBR worker block (around line 1287):
```js
if (String(process.env.FBR_WORKER_ENABLED || "0") === "1") {
  const { startFbrWorker } = require("./workers/fbr-worker");
  startFbrWorker(db);
}
```

Add immediately after:
```js
// Email Worker — processes email_queue + daily billing checks
if (String(process.env.EMAIL_WORKER_ENABLED || "0") === "1") {
  const { startEmailWorker } = require("./workers/email-worker");
  startEmailWorker(db);
}
```

**Step 2: Commit**

```bash
git add backend/index.js
git commit -m "feat(email): wire email worker startup in index.js"
```

---

### Task 6: Update send-receipt-v2 to use branded sender

**Files:**
- Modify: `backend/routes/email.js` (the Resend fallback block in `send-receipt-v2`)

**Step 1: Update the Resend fallback in send-receipt-v2**

In `routes/email.js`, find the Resend fallback block inside the `send-receipt-v2` handler (around line 155):

```js
      // Fall back to Resend
      if (process.env.RESEND_API_KEY) {
        const { Resend } = require("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          `${storeName} <onboarding@resend.dev>`;
        const { error } = await resend.emails.send({
          from: fromEmail,
          to: toEmail,
          subject,
          html,
        });
        if (error) throw new Error(`Resend error: ${error.message}`);
        return res.json({ ok: true, via: "resend" });
      }
```

Replace the entire Resend fallback block with:

```js
      // Fall back to Resend with branded sender
      if (process.env.RESEND_API_KEY) {
        const { sendEmail } = require("../services/email");
        await sendEmail({
          type: "receipt",
          to: toEmail,
          tenant: { slug: req.tenantSlug, name: storeName },
          subject,
          html,
        });
        return res.json({ ok: true, via: "resend" });
      }
```

**Step 2: Commit**

```bash
git add backend/routes/email.js
git commit -m "feat(email): use branded sender for receipt Resend fallback"
```

---

### Task 7: Enqueue drip emails on signup

**Files:**
- Modify: `backend/routes/auth.js` (inside the `POST /api/auth/signup` handler)

**Step 1: Add drip email enqueue after the welcome email block**

In `routes/auth.js`, find the welcome email block inside the signup handler (look for `sendWelcomeEmail`). After the closing `}` of the `if (process.env.RESEND_API_KEY)` block, add:

```js
      // Enqueue onboarding drip emails
      try {
        const { enqueueEmail } = require("../services/email");
        const dbPg = require("../db-pg");
        const corsOrigin = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";
        const dripData = { storeName: store_name, slug, frontendUrl: corsOrigin };

        const day2 = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        const day5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

        await enqueueEmail(dbPg, {
          tenantId: result.tenantId,
          type: "drip_getting_started",
          to: email,
          tenant: { slug, name: store_name },
          data: dripData,
          sendAt: day2,
        });
        await enqueueEmail(dbPg, {
          tenantId: result.tenantId,
          type: "drip_features",
          to: email,
          tenant: { slug, name: store_name },
          data: dripData,
          sendAt: day5,
        });
      } catch (dripErr) {
        console.error("Drip email enqueue failed:", dripErr.message);
      }
```

**Step 2: Commit**

```bash
git add backend/routes/auth.js
git commit -m "feat(email): enqueue onboarding drip emails on signup"
```

---

### Task 8: Billing notification emails

**Files:**
- Modify: `backend/routes/admin.js` (payment recording + tenant update endpoints)

**Step 1: Add billing email after payment recording**

In `routes/admin.js`, find the `POST /api/admin/tenants/:id/record-payment` handler. After the `auditLog` call (around line 923), add:

```js
      // Fire billing notification email (fire-and-forget)
      try {
        const tenantDb = await tenantDbManager.getDb(tenantId);
        const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
        if (profile?.email) {
          const { sendEmail } = require("../services/email");
          sendEmail({
            type: "billing_payment_recorded",
            to: profile.email,
            data: {
              storeName: tenant?.name || slug,
              amount: `${amount}`,
              plan,
              cycle,
              periodEnd: periodEnd.toLocaleDateString(),
            },
          }).catch((err) => console.error("Billing payment email failed:", err.message));
        }
      } catch (emailErr) {
        console.error("Billing payment email lookup failed:", emailErr.message);
      }
```

Note: `tenant` variable, `periodEnd`, `amount`, `plan`, `cycle` are all already in scope from the handler.

**Step 2: Add plan change email after tenant update**

In `routes/admin.js`, find the `PUT /api/admin/tenants/:id` handler. After the `auditLog` call for plan changes (around line 279), add inside the `if (planChanged)` block:

```js
        // Fire plan change notification email (fire-and-forget)
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
          if (profile?.email) {
            const { sendEmail } = require("../services/email");
            const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
            sendEmail({
              type: "billing_plan_changed",
              to: profile.email,
              data: {
                storeName: tenant.name,
                oldPlan: tenant.plan,
                newPlan: plan,
                newLimits: PLAN_DEFAULTS[plan] || null,
              },
            }).catch((err) => console.error("Plan change email failed:", err.message));
          }
        } catch (emailErr) {
          console.error("Plan change email lookup failed:", emailErr.message);
        }
```

**Step 3: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(email): add billing notification emails (payment + plan change)"
```

---

### Task 9: Support ticket lifecycle emails

**Files:**
- Modify: `backend/routes/support.js` (ticket creation)
- Modify: `backend/routes/admin.js` (ticket resolve)

**Step 1: Add ticket-received email in support.js**

In `routes/support.js`, after the existing `sendAlertEmail` fire-and-forget block (around line 40), add:

```js
      // Send confirmation email to submitting employee (fire-and-forget)
      if (req.employee?.email) {
        const { sendEmail } = require("../services/email");
        sendEmail({
          type: "support_received",
          to: req.employee.email,
          data: {
            ticketId: ticket.id,
            type,
            message: message.trim().substring(0, 200),
            storeName: req.company?.company_name || tenantSlug,
          },
        }).catch((err) => {
          req.log?.error({ err }, "Failed to send support ticket confirmation");
        });
      }
```

Also fix the admin panel link in the existing `sendAlertEmail` call — update `sanopos.vercel.app` to `sanopos.com`:

```
<p><a href="https://sanopos.com/admin">Open Admin Panel</a></p>
```

**Step 2: Add ticket-resolved email in admin.js**

In `routes/admin.js`, find the `PUT /api/admin/support-tickets/:tenantId/:ticketId` handler. After the `UPDATE support_tickets` query succeeds and before the `return res.json` (around line 1112), add:

```js
      // Send resolved notification to submitting employee (fire-and-forget)
      if (status === "resolved" && rows[0].employee_id) {
        try {
          const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
          const { rows: [emp] } = await tenantDb.query(
            "SELECT email FROM employees WHERE id = $1", [rows[0].employee_id]
          );
          const { rows: [profile] } = await tenantDb.query(
            "SELECT company_name FROM company_profile WHERE id = 1"
          );
          if (emp?.email) {
            const { sendEmail } = require("../services/email");
            sendEmail({
              type: "support_resolved",
              to: emp.email,
              data: {
                ticketId: rows[0].id,
                type: rows[0].type,
                storeName: profile?.company_name || "Your store",
              },
            }).catch((err) => console.error("Ticket resolved email failed:", err.message));
          }
        } catch (emailErr) {
          console.error("Ticket resolved email lookup failed:", emailErr.message);
        }
      }
```

**Step 3: Commit**

```bash
git add backend/routes/support.js backend/routes/admin.js
git commit -m "feat(email): add support ticket lifecycle emails (received + resolved)"
```

---

### Task 10: Admin broadcast endpoints (downtime + announcements)

**Files:**
- Modify: `backend/routes/admin.js` (add two new POST endpoints)

**Step 1: Add broadcast endpoints**

In `routes/admin.js`, find a suitable location (after the support ticket endpoints), and add:

```js
  // ── Broadcast Emails ───────────────────────────────────────────────

  // POST /api/admin/email/broadcast — send downtime or announcement to all tenants
  app.post("/api/admin/email/broadcast", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { type, subject, message } = req.body || {};
      if (!type || !["downtime", "announcement"].includes(type)) {
        return res.status(400).json({ error: "type must be 'downtime' or 'announcement'" });
      }
      if (!subject || !message) {
        return res.status(400).json({ error: "subject and message are required" });
      }

      // Get all active tenants
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active'"
      );

      const { enqueueEmail } = require("../services/email");
      const dbPg = require("../db-pg");
      let enqueued = 0;

      for (const t of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(t.id);
          const { rows: [profile] } = await tenantDb.query(
            "SELECT email FROM company_profile WHERE id = 1"
          );
          if (!profile?.email) continue;

          await enqueueEmail(dbPg, {
            tenantId: t.id,
            type,
            to: profile.email,
            data: { subject, message },
          });
          enqueued++;
        } catch (err) {
          console.error(`Broadcast enqueue failed for ${t.slug}:`, err.message);
        }
      }

      await auditLog(null, "broadcast_sent", { type, subject, recipients: enqueued }, `admin:${req.admin.email}`);
      return res.json({ ok: true, enqueued });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(email): add admin broadcast endpoint (downtime + announcements)"
```

---

### Task 11: Update CLAUDE.md and docs

**Files:**
- Modify: `CLAUDE.md` (add email service to integrations section)
- Modify: `backend/CLAUDE.md` (add email worker to env vars)

**Step 1: Add to CLAUDE.md integrations section**

Add a new bullet under `## Integrations`:

```
- **Unified Email Service**: `services/email.js` — single `sendEmail()` for all email types. Tenant→customer emails from `slug@sanopos.com`, platform→tenant from `noreply@sanopos.com`. 12 email types: receipt, digest, 3 drip, 4 billing, 2 support, 2 broadcast. `email_queue` table + `workers/email-worker.js` (inline, `EMAIL_WORKER_ENABLED=1`). Migration v10.
```

**Step 2: Add EMAIL_WORKER_ENABLED to backend CLAUDE.md Railway env vars list**

In `backend/CLAUDE.md`, add `EMAIL_WORKER_ENABLED=1` to the Railway env vars list.

**Step 3: Commit**

```bash
git add CLAUDE.md backend/CLAUDE.md
git commit -m "docs: add unified email service to CLAUDE.md"
```

---

### Task 12: Set EMAIL_WORKER_ENABLED on Railway

**Step 1: Set the env var**

```bash
railway variables --set "EMAIL_WORKER_ENABLED=1"
```

**Step 2: Push code to deploy**

```bash
git push origin main
```

The deployment will pick up the new worker code and the env var will start it.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Migration v10 — email_queue | migrate-pg.js, schema-pg.sql |
| 2 | Email templates (12 types) | services/email-templates.js (new) |
| 3 | Unified email service | services/email.js (new) |
| 4 | Email worker | workers/email-worker.js (new) |
| 5 | Wire worker in index.js | index.js |
| 6 | Branded receipt sender | routes/email.js |
| 7 | Drip emails on signup | routes/auth.js |
| 8 | Billing notification emails | routes/admin.js |
| 9 | Support ticket emails | routes/support.js, routes/admin.js |
| 10 | Admin broadcast endpoints | routes/admin.js |
| 11 | Docs update | CLAUDE.md, backend/CLAUDE.md |
| 12 | Railway env var + deploy | Railway CLI |

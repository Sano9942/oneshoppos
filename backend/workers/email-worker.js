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

// -- Queue Processing -----------------------------------------------------

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

// -- Daily Billing Check --------------------------------------------------

async function runBillingCheck(pool, logger) {
  const now = Date.now();
  if (now - lastBillingCheck < BILLING_CHECK_INTERVAL) return;
  lastBillingCheck = now;

  logger.info("Running daily billing email check");

  const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";

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

// -- Poll Loop ------------------------------------------------------------

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

// -- Standalone entry point -----------------------------------------------
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

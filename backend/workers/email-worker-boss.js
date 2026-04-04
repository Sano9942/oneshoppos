/**
 * Email worker — pg-boss implementation.
 *
 * Replaces the polling loop in email-worker.js with durable pg-boss jobs.
 *
 * Jobs:
 *   "email"                    — send a single email via Resend
 *   "billing-lifecycle-check"  — hourly cron: trial/grace/expiry transitions + email triggers
 */

const { Resend } = require("resend");
const { TEMPLATES } = require("../services/email-templates");

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Email send worker ─────────────────────────────────────────────────────────

async function handleEmailJob(job, resend, logger) {
  const { to, from, subject, html } = job.data;
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);

  if (global.__emailWorkerStatus) global.__emailWorkerStatus.processedToday++;
  logger.info({ to, subject: subject?.substring(0, 60) }, "pg-boss email sent");
}

// ── Billing lifecycle logic ───────────────────────────────────────────────────

async function sendLifecycleEmail(boss, pool, tenantId, type, to, from, data, logger) {
  const templateFn = TEMPLATES[type];
  if (!templateFn) return;
  const { subject, html } = templateFn(data);

  const today = todayStr();
  try {
    await boss.send(
      "email",
      { to, from, subject, html },
      {
        retryLimit: 3,
        retryDelay: 60,
        singletonKey: `${type}:${tenantId}:${today}`,
      }
    );
    logger.info({ tenant: tenantId, type }, "Enqueued lifecycle email via pg-boss");
  } catch (err) {
    logger.error({ err, type, tenantId }, "Failed to enqueue lifecycle email");
  }
}

async function runBillingLifecycleCheck(boss, pool, logger) {
  const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";

  // 1. Trial warning — 7 days before trial ends
  const { rows: warningTenants } = await pool.query(
    `SELECT id, slug, name, trial_ends_at
     FROM tenants
     WHERE payment_status = 'trial'
       AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       AND status != 'deleted'`
  );
  for (const t of warningTenants) {
    const email = await getTenantEmail(pool, t.slug);
    if (!email) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(t.trial_ends_at) - new Date()) / 86400000));
    await sendLifecycleEmail(boss, pool, t.id, "trial_warning", email, fromAddress,
      { storeName: t.name, daysLeft }, logger);
  }

  // 2. Trial → Grace transition
  const { rows: expiredTrials } = await pool.query(
    `SELECT id, slug, name FROM tenants
     WHERE payment_status = 'trial' AND trial_ends_at < NOW() AND status != 'deleted'`
  );
  for (const t of expiredTrials) {
    await pool.query(
      `UPDATE tenants SET payment_status = 'grace', grace_ends_at = trial_ends_at + INTERVAL '7 days', updated_at = NOW()
       WHERE id = $1`,
      [t.id]
    );
    const email = await getTenantEmail(pool, t.slug);
    if (email) {
      await sendLifecycleEmail(boss, pool, t.id, "trial_ended", email, fromAddress,
        { storeName: t.name }, logger);
    }
    logger.info({ tenant: t.slug }, "Trial → grace transition");
  }

  // 3. Grace → Expired transition
  const { rows: expiredGrace } = await pool.query(
    `SELECT id, slug, name FROM tenants
     WHERE payment_status = 'grace' AND grace_ends_at < NOW() AND status != 'deleted'`
  );
  for (const t of expiredGrace) {
    await pool.query(
      `UPDATE tenants SET payment_status = 'expired', updated_at = NOW() WHERE id = $1`,
      [t.id]
    );
    const email = await getTenantEmail(pool, t.slug);
    if (email) {
      await sendLifecycleEmail(boss, pool, t.id, "account_locked", email, fromAddress,
        { storeName: t.name }, logger);
    }
    logger.info({ tenant: t.slug }, "Grace → expired transition");
  }

  // 4. Billing expiry warning — 7 days (non-free, no payment record)
  const { rows: expiring7 } = await pool.query(
    `SELECT id, slug, name, plan, plan_expires_at FROM tenants
     WHERE plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       AND status = 'active' AND plan != 'free'
       AND NOT EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = tenants.id)`
  );
  for (const t of expiring7) {
    const email = await getTenantEmail(pool, t.slug);
    if (!email) continue;
    const daysLeft = Math.ceil((new Date(t.plan_expires_at) - new Date()) / 86400000);
    await sendLifecycleEmail(boss, pool, t.id, "billing_expiry_warning", email, fromAddress,
      { storeName: t.name, plan: t.plan, expiresAt: new Date(t.plan_expires_at).toLocaleDateString(), daysLeft },
      logger);
  }

  // 5. Billing overdue — past plan_expires_at (non-free, no payment record)
  const { rows: overdue } = await pool.query(
    `SELECT id, slug, name, plan, plan_expires_at FROM tenants
     WHERE plan_expires_at < NOW()
       AND status = 'active' AND plan != 'free'
       AND NOT EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = tenants.id)`
  );
  for (const t of overdue) {
    const email = await getTenantEmail(pool, t.slug);
    if (!email) continue;
    await sendLifecycleEmail(boss, pool, t.id, "billing_overdue", email, fromAddress,
      { storeName: t.name, plan: t.plan, expiredAt: new Date(t.plan_expires_at).toLocaleDateString() },
      logger);
  }

  // 6. Renewal warning — 7 days (active paid tenants)
  const { rows: renewalWarning } = await pool.query(
    `SELECT t.id, t.slug, t.name, t.plan, t.plan_expires_at FROM tenants t
     WHERE t.payment_status = 'active' AND t.plan != 'free'
       AND t.plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       AND t.status != 'deleted'
       AND EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = t.id)`
  );
  for (const t of renewalWarning) {
    const email = await getTenantEmail(pool, t.slug);
    if (!email) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(t.plan_expires_at) - new Date()) / 86400000));
    await sendLifecycleEmail(boss, pool, t.id, "renewal_due", email, fromAddress,
      {
        storeName: t.name, plan: t.plan, daysLeft,
        expiresAt: new Date(t.plan_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      }, logger);
  }

  // 7. Active paid → Grace transition
  const { rows: expiredPaid } = await pool.query(
    `SELECT t.id, t.slug, t.name, t.plan, t.plan_expires_at FROM tenants t
     WHERE t.payment_status = 'active' AND t.plan != 'free'
       AND t.plan_expires_at < NOW()
       AND t.status != 'deleted'
       AND EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = t.id)`
  );
  for (const t of expiredPaid) {
    await pool.query(
      `UPDATE tenants SET payment_status = 'grace', grace_ends_at = plan_expires_at + INTERVAL '7 days', updated_at = NOW()
       WHERE id = $1`,
      [t.id]
    );
    const email = await getTenantEmail(pool, t.slug);
    if (email) {
      await sendLifecycleEmail(boss, pool, t.id, "renewal_overdue", email, fromAddress,
        {
          storeName: t.name, plan: t.plan,
          expiredAt: new Date(t.plan_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        }, logger);
    }
    logger.info({ tenant: t.slug }, "Paid subscription → grace transition");
  }

  if (global.__emailWorkerStatus) global.__emailWorkerStatus.lastPollAt = Date.now();
}

// ── Register workers ──────────────────────────────────────────────────────────

async function registerEmailWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "email-worker-boss" });

  global.__emailWorkerStatus = global.__emailWorkerStatus || { lastPollAt: null, processedToday: 0, queueDepth: 0 };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("EMAIL_WORKER_ENABLED but RESEND_API_KEY not set — email worker disabled");
    return;
  }
  const resend = new Resend(key);

  // Create queues (pg-boss v12+ requires explicit queue creation before work/send)
  await boss.createQueue("email");
  await boss.createQueue("billing-lifecycle-check");

  // Worker: send a single email
  await boss.work("email", { teamSize: 5, teamConcurrency: 5 }, async (job) => {
    await handleEmailJob(job, resend, logger);

    // Update queue depth for admin dashboard
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM pgboss.job WHERE name = 'email' AND state IN ('created', 'retry')`
      );
      if (global.__emailWorkerStatus) global.__emailWorkerStatus.queueDepth = rows[0]?.cnt || 0;
    } catch {
      // pgboss schema may not exist yet in test environments
    }
  });

  // Cron: billing lifecycle check every hour
  await boss.schedule("billing-lifecycle-check", "0 * * * *");
  await boss.work("billing-lifecycle-check", async () => {
    try {
      await runBillingLifecycleCheck(boss, pool, logger);
    } catch (err) {
      logger.error({ err }, "Billing lifecycle check error");
      throw err; // let pg-boss record the failure
    }
  });

  logger.info("Email worker (pg-boss) registered");
}

module.exports = { registerEmailWorker };

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
 * Tenant->Customer emails: "Store Name <slug@sanopos.com>"
 * Platform->Tenant emails: "SanoPOS <noreply@sanopos.com>"
 */
function resolveFrom(type, tenant) {
  const TENANT_TYPES = ["receipt", "digest", "customer_statement"];
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
 * Enqueue an email for deferred sending via pg-boss.
 *
 * @param {object} db       — master db (kept for backward compat signature)
 * @param {object} opts
 * @param {number} [opts.tenantId] — tenant ID (NULL for system-wide)
 * @param {string} opts.type       — email type key
 * @param {string} opts.to         — recipient email
 * @param {object} [opts.tenant]   — { slug, name } for sender resolution
 * @param {object} [opts.data]     — template-specific data
 * @param {Date}   [opts.sendAt]   — schedule send for later (pg-boss startAfter)
 */
async function enqueueEmail(db, { tenantId, type, to, tenant, data, sendAt }) {
  const from = resolveFrom(type, tenant);
  const templateFn = TEMPLATES[type];
  if (!templateFn) throw new Error(`Unknown email type: ${type}`);

  const { subject, html } = templateFn(data || {});

  const { getBoss } = require("./boss");
  const boss = await getBoss();
  const opts = { retryLimit: 3, retryDelay: 60 };
  if (sendAt) opts.startAfter = sendAt;
  await boss.send(
    "email",
    { to, from, subject, html, tenantId: tenantId || null, type },
    opts
  );
}

module.exports = { sendEmail, enqueueEmail, resolveFrom };

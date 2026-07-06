/**
 * Customer status-change notification engine (F05).
 *
 * One event → rule → template → channel dispatcher over the existing SMS
 * (services/sms.js), email (services/email.js) and WhatsApp
 * (services/marketplace/whatsapp-client.js) adapters. Every vertical routes
 * customer-facing status messages ("your repair is ready", "appointment
 * reminder") through here instead of hand-rolling — a direct sendSms /
 * enqueueEmail for a customer status message is a code-review smell after this.
 *
 * CONTRACT: non-throwing for delivery. A failed notification logs a row in
 * customer_notifications and returns a status object — it never rolls back the
 * business write that triggered it. Callers should still invoke fire-and-forget
 * (`.catch()`), because the ONE thing this DOES throw on is a missing
 * tenantSlug (a programmer error — the pg-boss email payload needs it to route
 * worker-side queries to the right schema, same guard as
 * subscriptions.processRenewal / marketing.enqueueCampaignSend).
 *
 * Status semantics on customer_notifications.status:
 *   sent    — provider acknowledged (sms/whatsapp synchronous).
 *   queued  — handed to the pg-boss email queue (final delivery is async).
 *   skipped — rule disabled, no recipient, no provider configured, or unknown
 *             template. A NON-failure (nothing to blame the customer's data for).
 *   failed  — a real provider/delivery error (creds broken, gateway rejected).
 */

const logger = require("./logger").child({ component: "customer-notify" });
const { TEMPLATES: EMAIL_TEMPLATES } = require("./email-templates");
const { enqueueEmail } = require("./email");
const smsTemplates = require("./sms-templates");
const sms = require("./sms");

// PK-default country code for E.164 normalisation. Adapters (Twilio especially)
// reject local 03xx formats — normalise once here so 'failed' rows don't pile
// up from format drift in customers.mobile.
const DEFAULT_CC = process.env.DEFAULT_SMS_COUNTRY_CODE || "92";

/**
 * Is the customer_notifications feature on for this tenant DB? Central gate so
 * consumers can call notify() unconditionally and the flag is honoured in ONE
 * place. Direct feature_flags read (works in both route and worker contexts,
 * no dependency on the middleware feature-flags module). Defaults OFF.
 */
async function notificationsEnabled(db) {
  try {
    const { rows } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'customer_notifications'"
    );
    return rows.length ? rows[0].enabled === true : false;
  } catch {
    return false;
  }
}

/** Normalise a raw mobile string to E.164 (+<cc><number>). Returns null if empty. */
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("0")) return "+" + DEFAULT_CC + s.slice(1); // 03xxxxxxxxx -> +923xxxxxxxxx
  if (s.startsWith(DEFAULT_CC)) return "+" + s; // 923xxxxxxxxx -> +923xxxxxxxxx
  return "+" + DEFAULT_CC + s; // bare national (3xxxxxxxxx) -> +923xxxxxxxxx
}

// ── WhatsApp channel (P1) — best-effort, graceful skip when unconfigured ──
async function resolveWhatsApp(db) {
  const { rows } = await db.query(
    `SELECT provider, api_key, config_json FROM integration_settings
     WHERE provider = 'whatsapp' AND is_active = true
     ORDER BY updated_at DESC LIMIT 1`
  );
  if (!rows.length) return null;
  const row = rows[0];
  let apiKey = row.api_key;
  try {
    const { decryptSecret } = require("./crypto");
    if (apiKey && apiKey.startsWith("enc:")) apiKey = decryptSecret(apiKey);
  } catch { /* fall through with stored value */ }
  let configJson = {};
  try { configJson = row.config_json ? JSON.parse(row.config_json) : {}; } catch { /* leave {} */ }
  return { api_key: apiKey, config_json: configJson };
}

/** Connectivity probe for the WhatsApp channel (settings test-send). Never throws. */
async function testWhatsApp(db) {
  let cfg;
  try { cfg = await resolveWhatsApp(db); } catch (e) { return { success: false, error: e.message }; }
  if (!cfg || !cfg.config_json.phone_number_id) {
    return { success: false, error: "WhatsApp not configured" };
  }
  try {
    const WhatsAppClient = require("./marketplace/whatsapp-client");
    const client = new WhatsAppClient({ api_key: cfg.api_key, config_json: cfg.config_json });
    return await client.testConnection();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function sendWhatsApp(db, to, body) {
  let cfg;
  try { cfg = await resolveWhatsApp(db); } catch (e) { return { skipped: true, error: e.message }; }
  if (!cfg || !cfg.config_json.phone_number_id) {
    return { skipped: true, error: "WhatsApp not configured" };
  }
  try {
    const WhatsAppClient = require("./marketplace/whatsapp-client");
    const client = new WhatsAppClient({ api_key: cfg.api_key, config_json: cfg.config_json });
    // WhatsApp Cloud API wants the number in international format WITHOUT '+'.
    const res = await client.sendTextMessage(String(to).replace(/^\+/, ""), body);
    const ref = res && res.messages && res.messages[0] && res.messages[0].id ? res.messages[0].id : null;
    return { sent: true, provider_ref: ref };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

/**
 * Dispatch one rule (one channel) for an event. Always logs exactly one
 * customer_notifications row and returns its status object. Never throws.
 */
async function dispatchRule(db, ctx, deps) {
  const { rule, event, customer, customerId, data, tenant, entityType, entityId } = ctx;
  const channel = rule.channel;

  const recipient =
    channel === "email"
      ? (customer && customer.email) || data.email || null
      : normalizePhone((customer && customer.mobile) || data.mobile || null);

  const logRow = async (status, { providerRef = null, error = null } = {}) => {
    try {
      await db.query(
        `INSERT INTO customer_notifications
           (customer_id, event, channel, recipient, entity_type, entity_id, status, provider_ref, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          customerId || null, event, channel, recipient || "",
          entityType, entityId, status, providerRef,
          error ? String(error).slice(0, 500) : null,
        ]
      );
    } catch (e) {
      logger.warn({ err: e.message, event, channel }, "notify: log insert failed");
    }
    return { channel, template_key: rule.template_key, status, recipient, provider_ref: providerRef, error };
  };

  // A rule that exists but is switched off still leaves an auditable trail —
  // "we skipped this because you disabled the rule" — rather than silently
  // nothing (so the log answers "why didn't my customer get a message?").
  if (ctx.ruleDisabled) return logRow("skipped", { error: "rule disabled" });

  if (!recipient) return logRow("skipped", { error: "no recipient for channel" });

  try {
    if (channel === "email") {
      if (!EMAIL_TEMPLATES[rule.template_key]) {
        return logRow("skipped", { error: `unknown email template: ${rule.template_key}` });
      }
      await deps.enqueueEmail(null, {
        type: rule.template_key,
        to: recipient,
        tenant, // { slug, name } for from-resolution (optional)
        data: { ...data, tenantSlug: ctx.tenantSlug },
        priority: 5, // transactional hint — jumps ahead of bulk campaign/digest email
      });
      return logRow("queued");
    }

    // sms + whatsapp share the short-text templates
    const body = smsTemplates.render(rule.template_key, data);
    if (body == null) {
      return logRow("skipped", { error: `unknown sms template: ${rule.template_key}` });
    }

    if (channel === "sms") {
      const res = await deps.sendSms(db, { to: recipient, body, type: "transactional" });
      if (res.sent) return logRow("sent", { providerRef: res.provider_ref });
      if (/no sms provider/i.test(res.error || "")) return logRow("skipped", { error: res.error });
      return logRow("failed", { error: res.error });
    }

    if (channel === "whatsapp") {
      const res = await deps.sendWhatsApp(db, recipient, body);
      if (res.sent) return logRow("sent", { providerRef: res.provider_ref });
      if (res.skipped) return logRow("skipped", { error: res.error });
      return logRow("failed", { error: res.error });
    }

    return logRow("skipped", { error: `unknown channel: ${channel}` });
  } catch (err) {
    logger.error({ err: err.message, event, channel }, "notify: dispatch failed");
    return logRow("failed", { error: err.message });
  }
}

/**
 * Fire notifications for an event.
 *
 * @param {object} db - tenant-scoped DB proxy
 * @param {object} opts
 * @param {string} opts.event        - e.g. 'ticket.status_changed:completed'
 * @param {number} [opts.customerId] - customer to resolve recipient from
 * @param {string[]} [opts.channelHints] - restrict to these channels (else all enabled rules)
 * @param {object} [opts.data]       - template variables (storeName, ticketNumber, …)
 * @param {string} opts.tenantSlug   - REQUIRED (pg-boss email payload schema routing)
 * @param {object} [opts.tenant]     - { slug, name } for email from-resolution
 * @param {string} [opts.entityType] - audit: 'ticket' | 'appointment' | …
 * @param {number} [opts.entityId]   - audit entity id
 * @returns {Promise<{dispatched: object[], reason?: string, error?: string}>}
 */
// Default delivery deps. Tests inject fakes via the 3rd arg (repo Pattern A) —
// vi.mock() can't reliably intercept these CJS top-level requires.
const DEFAULT_DEPS = { enqueueEmail, sendSms: sms.sendSms, sendWhatsApp };

async function notify(db, { event, customerId, channelHints, data = {}, tenantSlug, tenant, entityType = null, entityId = null } = {}, deps = DEFAULT_DEPS) {
  if (!tenantSlug) {
    throw new Error("customer-notify.notify requires tenantSlug (email pg-boss payload schema routing)");
  }
  if (!event) return { dispatched: [], reason: "no_event" };

  // Central feature gate — the single place the customer_notifications flag is
  // enforced, so no consumer can accidentally dispatch when it's off.
  if (!(await notificationsEnabled(db))) return { dispatched: [], reason: "disabled" };

  let rules;
  try {
    // Fetch enabled AND disabled rules for the event — disabled ones still get
    // an auditable 'skipped' row (see dispatchRule's ruleDisabled branch).
    const sql =
      "SELECT channel, template_key, enabled FROM notification_rules WHERE event = $1" +
      (channelHints && channelHints.length ? " AND channel = ANY($2)" : "");
    const params = channelHints && channelHints.length ? [event, channelHints] : [event];
    const q = await db.query(sql, params);
    rules = q.rows;
  } catch (err) {
    logger.warn({ err: err.message, event }, "notify: failed to load rules");
    return { dispatched: [], error: err.message };
  }
  if (!rules.length) return { dispatched: [], reason: "no_rules" };

  let customer = null;
  if (customerId) {
    try {
      const { rows } = await db.query("SELECT id, name, mobile, email FROM customers WHERE id = $1", [customerId]);
      customer = rows[0] || null;
    } catch (err) {
      logger.warn({ err: err.message, customerId }, "notify: failed to load customer");
    }
  }

  // Auto-fill customerName from the resolved row so consumers don't have to
  // re-fetch it just to greet the customer; explicit data always wins.
  const enriched = customer && customer.name ? { customerName: customer.name, ...data } : data;

  const dispatched = [];
  for (const rule of rules) {
    dispatched.push(
      await dispatchRule(
        db,
        { rule, event, customer, customerId, data: enriched, tenantSlug, tenant, entityType, entityId, ruleDisabled: rule.enabled === false },
        deps
      )
    );
  }
  return { dispatched };
}

module.exports = { notify, normalizePhone, notificationsEnabled, sendWhatsApp, testWhatsApp, DEFAULT_DEPS };

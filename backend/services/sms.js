/**
 * SMS provider service — adapter-based SMS delivery.
 *
 * Usage:
 *   const sms = require("./sms");
 *   await sms.sendSms(db, { to: "03001234567", body: "Your order shipped!", type: "transactional" });
 *
 * Adding a new provider:
 *   1. Create a class extending BaseSmsAdapter
 *   2. Register it in the ADAPTERS map
 *   3. Configure via integration_settings (category = 'sms')
 */

const logger = require("./logger").child({ component: "sms" });

// ── Base Adapter ──────────────────────────────────────────────────────

class BaseSmsAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Send an SMS message.
   * @param {string} to - Recipient phone number
   * @param {string} body - Message content
   * @returns {Promise<{ success: boolean, provider_ref?: string, error?: string }>}
   */
  async send(to, body) {
    throw new Error("Not implemented");
  }

  /** Test connectivity with a ping or dummy send */
  async test() {
    return { success: false, error: "Not implemented" };
  }
}

// ── Generic HTTP SMS Adapter ──────────────────────────────────────────
// Works with any HTTP-to-SMS gateway that accepts POST with phone + message

class GenericHttpAdapter extends BaseSmsAdapter {
  async send(to, body) {
    const { api_url, api_key, api_secret, sender_mask, field_map } = this.config;
    if (!api_url) throw new Error("SMS gateway URL not configured");

    const fields = field_map || {};
    const payload = {
      [fields.phone || "to"]: to,
      [fields.message || "message"]: body,
    };
    if (api_key) payload[fields.username || "username"] = api_key;
    if (api_secret) payload[fields.password || "password"] = api_secret;
    if (sender_mask) payload[fields.sender || "sender"] = sender_mask;

    const res = await fetch(api_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown error");
      return { success: false, error: `SMS gateway error: ${res.status} - ${err}` };
    }

    const data = await res.json().catch(() => ({}));
    return {
      success: true,
      provider_ref: data.message_id || data.id || data.ref || null,
    };
  }

  async test() {
    const { api_url } = this.config;
    if (!api_url) return { success: false, error: "No API URL configured" };
    return { success: true, message: "Configuration looks valid" };
  }
}

// ── Twilio Adapter ────────────────────────────────────────────────────

class TwilioAdapter extends BaseSmsAdapter {
  async send(to, body) {
    const { api_key: accountSid, api_secret: authToken, from_number } = this.config;
    if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
    if (!from_number) throw new Error("Twilio from_number not configured");

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from_number, Body: body }).toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.message || `Twilio error: ${res.status}` };
    }

    const data = await res.json();
    return { success: true, provider_ref: data.sid };
  }

  async test() {
    const { api_key: accountSid, api_secret: authToken } = this.config;
    if (!accountSid || !authToken) return { success: false, error: "Missing Twilio credentials" };

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) return { success: true, message: "Twilio account verified" };
      return { success: false, error: `Twilio returned ${res.status}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// ── Adapter Registry & Factory ────────────────────────────────────────

const ADAPTERS = {
  generic: GenericHttpAdapter,
  zong_sms: GenericHttpAdapter,
  jazz_sms: GenericHttpAdapter,
  twilio: TwilioAdapter,
};

function getSmsAdapter(providerKey, config) {
  const AdapterClass = ADAPTERS[providerKey] || GenericHttpAdapter;
  return new AdapterClass(config);
}

// ── Service Layer ─────────────────────────────────────────────────────

/**
 * Resolve the active SMS provider config from integration_settings.
 * @param {object} db - tenant db proxy
 * @returns {Promise<{ provider: string, config: object } | null>}
 */
async function resolveProvider(db) {
  try {
    const { rows } = await db.query(
      `SELECT provider, api_key, api_secret, config_json
       FROM integration_settings
       WHERE category IN ('sms', 'messaging_sms') AND is_active = true
       ORDER BY updated_at DESC LIMIT 1`
    );
    if (!rows.length) return null;

    const row = rows[0];
    let configJson = {};
    try { configJson = row.config_json ? JSON.parse(row.config_json) : {}; } catch {}

    // Decrypt credentials if they look encrypted
    let apiKey = row.api_key;
    let apiSecret = row.api_secret;
    try {
      const { decryptSecret } = require("./crypto");
      if (apiKey && apiKey.startsWith("enc:")) apiKey = decryptSecret(apiKey);
      if (apiSecret && apiSecret.startsWith("enc:")) apiSecret = decryptSecret(apiSecret);
    } catch {}

    return {
      provider: row.provider,
      config: {
        api_key: apiKey,
        api_secret: apiSecret,
        ...configJson,
      },
    };
  } catch (err) {
    logger.warn({ err: err.message }, "Failed to resolve SMS provider");
    return null;
  }
}

/**
 * Send an SMS and persist the delivery record.
 *
 * @param {object} db - tenant db proxy
 * @param {object} opts
 * @param {string} opts.to - Recipient phone number
 * @param {string} opts.body - Message text
 * @param {string} [opts.type='transactional'] - 'transactional' or 'marketing'
 * @returns {Promise<{ sent: boolean, provider_ref?: string, error?: string }>}
 */
async function sendSms(db, { to, body, type = "transactional" }) {
  const providerInfo = await resolveProvider(db);
  if (!providerInfo) {
    logger.debug("No SMS provider configured — skipping send");
    return { sent: false, error: "No SMS provider configured" };
  }

  const adapter = getSmsAdapter(providerInfo.provider, providerInfo.config);

  // Persist queued record
  const { rows: [msg] } = await db.query(
    `INSERT INTO sms_provider_messages (provider, recipient_phone, message_type, message_body, delivery_status)
     VALUES ($1, $2, $3, $4, 'queued')
     RETURNING id`,
    [providerInfo.provider, to, type, body]
  );

  try {
    const result = await adapter.send(to, body);

    if (result.success) {
      await db.query(
        `UPDATE sms_provider_messages SET
           delivery_status = 'sent', provider_ref = $1, sent_at = NOW()
         WHERE id = $2`,
        [result.provider_ref || null, msg.id]
      );
      return { sent: true, provider_ref: result.provider_ref };
    } else {
      await db.query(
        `UPDATE sms_provider_messages SET
           delivery_status = 'failed', failure_reason = $1
         WHERE id = $2`,
        [result.error?.slice(0, 500) || "Unknown error", msg.id]
      );
      logger.warn({ to, error: result.error }, "SMS send failed");
      return { sent: false, error: result.error };
    }
  } catch (err) {
    await db.query(
      `UPDATE sms_provider_messages SET
         delivery_status = 'failed', failure_reason = $1
       WHERE id = $2`,
      [err.message?.slice(0, 500) || "Send error", msg.id]
    );
    logger.error({ err, to }, "SMS send threw");
    return { sent: false, error: err.message };
  }
}

/**
 * Test SMS provider connectivity.
 * @param {object} db
 * @returns {Promise<{ success: boolean, provider?: string, message?: string, error?: string }>}
 */
async function testProvider(db) {
  const providerInfo = await resolveProvider(db);
  if (!providerInfo) return { success: false, error: "No SMS provider configured" };

  const adapter = getSmsAdapter(providerInfo.provider, providerInfo.config);
  const result = await adapter.test();
  return { ...result, provider: providerInfo.provider };
}

module.exports = {
  sendSms,
  testProvider,
  getSmsAdapter,
  resolveProvider,
  BaseSmsAdapter,
  ADAPTERS,
};

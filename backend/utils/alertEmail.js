const { Resend } = require("resend");
const logger = require("../services/logger");

let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return null;
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM =
  process.env.RESEND_FROM_EMAIL || "SanoPOS <onboarding@resend.dev>";

/**
 * Send an alert email via Resend.
 * Silent no-op if ALERT_EMAIL or RESEND_API_KEY is not configured.
 * Never throws — alerting must not crash the app.
 */
async function sendAlertEmail({ subject, html }) {
  const to = process.env.ALERT_EMAIL;
  if (!to) return;

  const resend = getResend();
  if (!resend) return;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `[SanoPOS Alert] ${subject}`,
      html,
    });
    if (error) {
      logger.error({ err: error }, "Alert email send failed");
    }
  } catch (err) {
    logger.error({ err }, "Alert email send threw");
  }
}

module.exports = { sendAlertEmail };

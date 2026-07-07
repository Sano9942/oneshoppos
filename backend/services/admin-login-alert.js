/**
 * services/admin-login-alert.js — new-IP alerting for super-admin logins (B3).
 *
 * On a successful admin login, compare the source IP against the last 30 days
 * of login_success events in admin_security_log. An unseen IP fires a
 * fire-and-forget ops alert. Detection (isNewLoginIp) is separated from the
 * send (alertNewLoginIp) so it can be tested against a seeded log history.
 */
const { sendAlertEmail } = require("../utils/alertEmail");

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Has this (email, ip) NOT been seen as a successful admin login in 30 days?
 * Returns false when ip is missing (can't judge → don't cry wolf) or on any
 * query error — this must never block or fail a login.
 * @param {{query: Function}} db
 */
async function isNewLoginIp(db, email, ip) {
  if (!ip) return false;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM admin_security_log
        WHERE email = $1 AND event_type = 'login_success' AND ip_address = $2
          AND created_at > NOW() - INTERVAL '30 days'
        LIMIT 1`,
      [email, ip]
    );
    return rows.length === 0;
  } catch (_) {
    return false;
  }
}

/** Send the "new admin login" alert. Never throws (sendAlertEmail no-ops when unconfigured). */
async function alertNewLoginIp({ email, ip, userAgent }) {
  const html = `
    <p>A super-admin signed in from a new IP address.</p>
    <ul>
      <li><b>Account:</b> ${escapeHtml(email)}</li>
      <li><b>IP:</b> ${escapeHtml(ip)}</li>
      <li><b>Device:</b> ${escapeHtml(userAgent) || "unknown"}</li>
      <li><b>Time:</b> ${new Date().toISOString()}</li>
    </ul>
    <p>If this wasn't you, rotate the admin password and revoke sessions from
       <b>/admin/security</b> immediately.</p>`;
  return sendAlertEmail({ subject: `New admin login from ${ip}`, html });
}

module.exports = { isNewLoginIp, alertNewLoginIp };

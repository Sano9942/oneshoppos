const logger = require("./logger");
const { sendAlertEmail } = require("../utils/alertEmail");

const ADMIN_URL = "https://sanopos.com/admin";

// Threshold configuration
const THRESHOLDS = {
  error_spike:          { count: 10, windowMs: 5 * 60_000, cooldownMs: 30 * 60_000 },
  db_pressure:          { count: 1,  windowMs: 1 * 60_000, cooldownMs: 60 * 60_000 },
  backup_failed:        { count: 1,  windowMs: 1 * 60_000, cooldownMs: 0 },
  health_check_failed:  { count: 1,  windowMs: 1 * 60_000, cooldownMs: 15 * 60_000 },
};

// In-memory sliding window state
// Map<alertType, { count, errors[], tenants Set, firstAt, lastAlertAt }>
const windows = new Map();

function getWindow(type) {
  if (!windows.has(type)) {
    windows.set(type, {
      count: 0,
      errors: [],
      tenants: new Set(),
      firstAt: null,
      lastAlertAt: null,
    });
  }
  const w = windows.get(type);
  const cfg = THRESHOLDS[type];
  // Clean stale window
  if (w.firstAt && Date.now() - w.firstAt > cfg.windowMs) {
    w.count = 0;
    w.errors = [];
    w.tenants = new Set();
    w.firstAt = null;
  }
  return w;
}

function inCooldown(w, cfg) {
  if (cfg.cooldownMs === 0) return false;
  if (!w.lastAlertAt) return false;
  return Date.now() - w.lastAlertAt < cfg.cooldownMs;
}

function addError(w, message) {
  if (!message) return;
  const existing = w.errors.find((e) => e.message === message);
  if (existing) {
    existing.count++;
  } else if (w.errors.length < 10) {
    w.errors.push({ message, count: 1 });
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Record an application error. Sends alert email when error count
 * exceeds threshold within the sliding window.
 */
async function recordError({ tenant, message, reqId } = {}) {
  const type = "error_spike";
  const cfg = THRESHOLDS[type];
  const w = getWindow(type);

  if (!w.firstAt) w.firstAt = Date.now();
  w.count++;
  addError(w, message);
  if (tenant) w.tenants.add(tenant);

  if (w.count < cfg.count) return;
  if (inCooldown(w, cfg)) return;

  const tenantList = [...w.tenants].join(", ") || "unknown";
  const errorRows = w.errors
    .sort((a, b) => b.count - a.count)
    .map((e) => `<tr><td style="padding:4px 8px">${e.count}</td><td style="padding:4px 8px">${escHtml(e.message)}</td></tr>`)
    .join("");

  await sendAlertEmail({
    subject: `Error spike — ${w.count} errors in ${Math.round(cfg.windowMs / 60_000)} min`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#dc2626;margin-bottom:16px">Error Spike Detected</h2>
        <p><strong>${w.count}</strong> errors in the last ${Math.round(cfg.windowMs / 60_000)} minutes.</p>
        <p><strong>Affected tenants:</strong> ${escHtml(tenantList)}</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr style="background:#f1f5f9"><th style="padding:4px 8px;text-align:left">Count</th><th style="padding:4px 8px;text-align:left">Error</th></tr>
          ${errorRows}
        </table>
        <p><a href="${ADMIN_URL}" style="color:#059669;font-weight:600">Open Admin Panel</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:12px">SanoPOS Alerting</p>
      </div>
    `,
  });

  w.lastAlertAt = Date.now();
  // Reset window after sending
  w.count = 0;
  w.errors = [];
  w.tenants = new Set();
  w.firstAt = null;
}

/**
 * Record DB connection pressure. Sends alert when active connections
 * are high relative to the pool max.
 */
async function recordDbPressure({ active, max, longestQuery } = {}) {
  const type = "db_pressure";
  const cfg = THRESHOLDS[type];
  const w = getWindow(type);

  if (!w.firstAt) w.firstAt = Date.now();
  w.count++;

  if (w.count < cfg.count) return;
  if (inCooldown(w, cfg)) return;

  const pct = max ? Math.round((active / max) * 100) : "?";

  await sendAlertEmail({
    subject: `DB pressure — ${active}/${max} connections (${pct}%)`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#f59e0b;margin-bottom:16px">Database Connection Pressure</h2>
        <p><strong>Active connections:</strong> ${active} / ${max} (${pct}%)</p>
        ${longestQuery ? `<p><strong>Longest running query:</strong> ${escHtml(String(longestQuery))}</p>` : ""}
        <p><a href="${ADMIN_URL}" style="color:#059669;font-weight:600">Open Admin Panel</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:12px">SanoPOS Alerting</p>
      </div>
    `,
  });

  w.lastAlertAt = Date.now();
}

/**
 * Record a health-check failure for a dependency (e.g. database, Redis).
 */
async function recordHealthCheckFailure({ dependency, error } = {}) {
  const type = "health_check_failed";
  const cfg = THRESHOLDS[type];
  const w = getWindow(type);

  if (!w.firstAt) w.firstAt = Date.now();
  w.count++;

  if (w.count < cfg.count) return;
  if (inCooldown(w, cfg)) return;

  await sendAlertEmail({
    subject: `Health check failed — ${dependency || "unknown"}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#dc2626;margin-bottom:16px">Health Check Failed</h2>
        <p><strong>Dependency:</strong> ${escHtml(dependency || "unknown")}</p>
        <p><strong>Error:</strong> ${escHtml(String(error || "no details"))}</p>
        <p><a href="${ADMIN_URL}" style="color:#059669;font-weight:600">Open Admin Panel</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:12px">SanoPOS Alerting</p>
      </div>
    `,
  });

  w.lastAlertAt = Date.now();
}

// ── Helpers ─────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { recordError, recordDbPressure, recordHealthCheckFailure };

/**
 * lifecycle-events.js — tenant lifecycle / funnel event capture (C1).
 *
 * Append-only writes to public.tenant_lifecycle_events. Pure data capture for
 * the Batch E analytics dashboard — nothing user-visible reads it yet.
 *
 * recordLifecycleEvent is FIRE-AND-FORGET: it must never throw into the caller's
 * path (a funnel-event insert failing must not fail a signup, payment, migration,
 * etc.). Only cold paths call it — never the POS hot path.
 *
 * One-time milestones (ONE_TIME_EVENTS) are deduped by the partial unique index
 * from migrate-pg.js v124 via ON CONFLICT DO NOTHING; recurring events append.
 */
const pool = require("../db-pg");
const logger = require("./logger");

// Must match the partial unique index in migrate-pg.js v124.
const ONE_TIME_EVENTS = ["signup", "setup_completed", "first_sale", "first_week_active", "dormant_30d"];

/**
 * @param {number}  tenantId  public tenants.id
 * @param {string}  event     event name (see the migration description)
 * @param {object?} metadata  small JSON blob (plan, amount, source, at, …)
 * @param {object?} opts      { db }  — override the DB handle (tests / worker reuse)
 */
async function recordLifecycleEvent(tenantId, event, metadata = null, opts = {}) {
  try {
    const tid = parseInt(tenantId, 10);
    if (!tid || !event) return;
    const db = opts.db || pool;
    // metadata.at (ISO string) lets derived/backfilled events carry the real
    // moment while created_at defaults to detection time when absent.
    const at = metadata && metadata.at ? metadata.at : null;
    await db.query(
      `INSERT INTO public.tenant_lifecycle_events (tenant_id, event, metadata, created_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
       ON CONFLICT DO NOTHING`,
      [tid, event, metadata ? JSON.stringify(metadata) : null, at]
    );
  } catch (err) {
    try {
      logger.warn({ err: err && err.message, event, tenantId }, "lifecycle event insert failed");
    } catch { /* logging must never throw here either */ }
  }
}

module.exports = { recordLifecycleEvent, ONE_TIME_EVENTS };

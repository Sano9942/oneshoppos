/**
 * Attendance auto-close worker — pg-boss implementation.
 *
 * Daily at 9 AM UTC: for each tenant, find `employee_attendance` rows from
 * before yesterday where the employee never tapped "End of Day" on the kiosk
 * (check_out IS NULL). For each stale row:
 *   - If there's a completed work session for that attendance: close out the
 *     day at the last session's session_end, recompute net hours.
 *   - If no completed session exists at all (employee opened the day but
 *     produced no work segment): mark as absent with hours=0.
 *
 * Mirrors the shift-auto-close worker (workers/shift-auto-close-worker-boss.js):
 * tenant iteration, per-tenant try/catch, heartbeat global.
 *
 * Env gate: ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED=1
 */

const QUEUE_NAME = "attendance-auto-close";

async function registerAttendanceAutoCloseWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "attendance-auto-close-worker" });

  global.__attendanceAutoCloseWorkerStatus = global.__attendanceAutoCloseWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue(QUEUE_NAME);
  await boss.schedule(QUEUE_NAME, "0 9 * * *");

  await boss.work(QUEUE_NAME, async () => {
    logger.info("Running attendance auto-close sweep");
    try {
      global.__attendanceAutoCloseWorkerStatus.lastPollAt = Date.now();
      let totalClosed = 0;
      let totalQueueDepth = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const { closed, queueDepth } = await closeStaleAttendanceForTenant(tenantDb, logger, tenant.slug);
            totalClosed += closed;
            totalQueueDepth += queueDepth;
          } catch (err) {
            if (!String(err.message || "").includes("does not exist")) {
              logger.error({ err, tenantSlug: tenant.slug }, "Attendance auto-close failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        const { closed, queueDepth } = await closeStaleAttendanceForTenant(db, logger, "single");
        totalClosed = closed;
        totalQueueDepth = queueDepth;
      }

      global.__attendanceAutoCloseWorkerStatus.processedToday += totalClosed;
      global.__attendanceAutoCloseWorkerStatus.queueDepth = totalQueueDepth;
      logger.info({ closed: totalClosed }, "Attendance auto-close sweep complete");
    } catch (err) {
      logger.error({ err }, "Attendance auto-close sweep error");
      throw err;
    }
  });

  logger.info("Attendance auto-close worker (pg-boss) registered — daily 9 AM UTC");
}

async function closeStaleAttendanceForTenant(db, logger, tenantSlug) {
  // "Day" boundaries must be TENANT-local: check_in is TIMESTAMPTZ, and a
  // bare ::date / CURRENT_DATE evaluates in the DB session TZ (UTC on prod),
  // shifting the "before yesterday" cutoff by the tenant's UTC offset.
  const { isValidTz } = require("../utils/tz");
  let tz = "UTC";
  try {
    const { rows: [prof] } = await db.query(
      "SELECT timezone FROM company_profile WHERE id = 1"
    );
    if (isValidTz(prof?.timezone)) tz = prof.timezone;
  } catch { /* fall back to UTC */ }

  // Forward-looking queue depth: how many stale rows exist right now.
  let queueDepth = 0;
  try {
    const { rows: [row] } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM employee_attendance
        WHERE check_out IS NULL
          AND (check_in AT TIME ZONE $1)::date < (NOW() AT TIME ZONE $1)::date - 1`,
      [tz]
    );
    queueDepth = row?.n || 0;
  } catch {
    return { closed: 0, queueDepth: 0 };
  }
  if (queueDepth === 0) return { closed: 0, queueDepth: 0 };

  const { rows: stale } = await db.query(
    `SELECT id, employee_id, outlet_id, check_in, comment
       FROM employee_attendance
      WHERE check_out IS NULL
        AND (check_in AT TIME ZONE $1)::date < (NOW() AT TIME ZONE $1)::date - 1
      ORDER BY check_in ASC
      LIMIT 500`,
    [tz]
  );

  let closed = 0;
  for (const row of stale) {
    try {
      // Find the most recent completed session for this day.
      const { rows: [lastSession] } = await db.query(
        `SELECT session_end
           FROM attendance_sessions
          WHERE attendance_id = $1
            AND session_end IS NOT NULL
          ORDER BY session_end DESC
          LIMIT 1`,
        [row.id]
      );

      // Sum of completed WORK session hours (net work for the day).
      const { rows: [workSum] } = await db.query(
        `SELECT COALESCE(SUM(duration_hours), 0) AS net_work_hours
           FROM attendance_sessions
          WHERE attendance_id = $1
            AND session_type = 'work'
            AND session_end IS NOT NULL`,
        [row.id]
      );

      const appendedComment = `${row.comment ? row.comment + " " : ""}(auto-closed)`;

      if (lastSession && lastSession.session_end) {
        const netHours = Number(workSum?.net_work_hours || 0);
        await db.query(
          `UPDATE employee_attendance
              SET check_out = $1,
                  hours = $2,
                  status = 'checked_out',
                  comment = $3
            WHERE id = $4 AND check_out IS NULL`,
          [lastSession.session_end, netHours, appendedComment, row.id]
        );
      } else {
        // No completed session at all — employee opened the day but never
        // produced a work segment. Treat as absent, 0 hours.
        await db.query(
          `UPDATE employee_attendance
              SET check_out = check_in,
                  hours = 0,
                  status = 'absent',
                  comment = $1
            WHERE id = $2 AND check_out IS NULL`,
          [appendedComment, row.id]
        );
      }

      // Also close any stale open sessions on the same attendance row.
      await db.query(
        `UPDATE attendance_sessions
            SET session_end = session_start, session_type = 'auto_closed'
          WHERE attendance_id = $1 AND session_end IS NULL`,
        [row.id]
      ).catch(() => {});

      closed++;
      logger.info(
        { tenantSlug, attendanceId: row.id, employeeId: row.employee_id, checkIn: row.check_in },
        "Attendance row auto-closed"
      );
    } catch (err) {
      logger.error({ err, attendanceId: row.id, tenantSlug }, "Failed to auto-close attendance row");
    }
  }

  return { closed, queueDepth };
}

module.exports = { registerAttendanceAutoCloseWorker, closeStaleAttendanceForTenant, QUEUE_NAME };

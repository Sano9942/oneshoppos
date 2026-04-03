/**
 * pg-boss singleton.
 *
 * getBoss()      — lazy-init, returns a started PgBoss instance
 * shutdownBoss() — graceful stop (call on SIGTERM)
 */

const PgBoss = require("pg-boss");
const logger = require("./logger").child({ component: "pg-boss" });

let _boss = null;
let _startPromise = null;

async function getBoss() {
  if (_boss) return _boss;
  if (_startPromise) return _startPromise;

  _startPromise = (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set — cannot start pg-boss");

    const boss = new PgBoss({
      connectionString,
      // Keep job history for 7 days; prune completed/failed jobs automatically
      deleteAfterDays: 7,
      archiveCompletedAfterSeconds: 60 * 60 * 24, // 24h before archiving completed jobs
      monitorStateIntervalSeconds: 30,
    });

    boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

    await boss.start();
    logger.info("pg-boss started");
    _boss = boss;
    return boss;
  })();

  try {
    return await _startPromise;
  } catch (err) {
    _startPromise = null;
    throw err;
  }
}

async function shutdownBoss() {
  if (!_boss) return;
  try {
    await _boss.stop();
    logger.info("pg-boss stopped");
  } catch (err) {
    logger.error({ err }, "pg-boss stop error");
  } finally {
    _boss = null;
    _startPromise = null;
  }
}

module.exports = { getBoss, shutdownBoss };

/**
 * Admin monitoring — global stats, attention dashboard, cleanup, infrastructure.
 */
const alerting = require("../../services/alerting");

// /api/admin/infra cache — cross-schema introspection at 380 tables/tenant is
// expensive (one query held the DB ~104s at p100 in prod). Cache for 5 min;
// staleness is fine on an admin dashboard polled every 30-60s.
const INFRA_CACHE_TTL_MS = 5 * 60 * 1000;
let _infraCache = null; // { data, timestamp }

module.exports = function registerMonitoringRoutes(app, deps) {
  const { db, masterDb, requireAllowedIp, requireSuperAdmin, tenantDbManager, logAdminAction } = deps;

  // ── Global Stats ───────────────────────────────────────────────────────
  app.get("/api/admin/stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: totalsRows } = await db.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
           SUM(CASE WHEN plan = 'free' THEN 1 ELSE 0 END) AS free_plan,
           SUM(CASE WHEN plan = 'pro' THEN 1 ELSE 0 END) AS pro_plan
         FROM tenants WHERE status != 'deleted'`
      );
      const totals = totalsRows[0] || {};

      const { rows: recentTenants } = await db.query(
        "SELECT id, slug, name, plan, status, created_at FROM tenants WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 5"
      );

      const { rows: recentAudit } = await db.query(
        `SELECT a.action, a.details, a.actor, a.created_at, t.slug AS tenant_slug
         FROM tenant_audit_log a
         LEFT JOIN tenants t ON a.tenant_id = t.id
         ORDER BY a.created_at DESC LIMIT 10`
      );

      return res.json({ totals, recent_tenants: recentTenants, recent_audit: recentAudit });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Attention Dashboard ────────────────────────────────────────────────
  app.get("/api/admin/attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name, plan, max_employees, max_products, max_outlets, created_at FROM tenants WHERE status = 'active'"
      );

      const approaching = [];
      const dormant = [];
      const setupPending = [];

      for (const t of tenants) {
        const s = `tenant_${t.slug}`;
        try {
          const [empR, prodR, outR, loginR, setupR] = await Promise.all([
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.employees WHERE deleted_at IS NULL`),
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.products WHERE deleted_at IS NULL`),
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.outlets`),
            db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
            db.query(`SELECT setup_complete FROM ${s}.company_profile WHERE id = 1`),
          ]);

          const emp = parseInt(empR.rows[0].cnt, 10);
          const prod = parseInt(prodR.rows[0].cnt, 10);
          const out = parseInt(outR.rows[0].cnt, 10);
          const lastLogin = loginR.rows[0].ts;
          const setupComplete = setupR.rows[0]?.setup_complete;

          if (t.max_employees && emp / t.max_employees > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "employees", used: emp, max: t.max_employees });
          }
          if (t.max_products && prod / t.max_products > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "products", used: prod, max: t.max_products });
          }
          if (t.max_outlets && out / t.max_outlets > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "outlets", used: out, max: t.max_outlets });
          }

          if (lastLogin) {
            const daysSince = (Date.now() - new Date(lastLogin).getTime()) / 86400000;
            if (daysSince >= 14) {
              dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: lastLogin, days_inactive: Math.floor(daysSince) });
            }
          } else if (setupComplete) {
            dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: null, days_inactive: null });
          }

          if (!setupComplete) {
            setupPending.push({ id: t.id, slug: t.slug, name: t.name, created_at: t.created_at });
          }
        } catch {
          // Skip tenants with missing schemas
        }
      }

      const dead_tenants = setupPending.filter(
        (t) => new Date(t.created_at) < new Date(Date.now() - 7 * 86400000)
      );
      return res.json({ approaching_limits: approaching, dormant, setup_pending: setupPending, dead_tenants });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Dead Tenant Cleanup ────────────────────────────────────────────────
  app.get("/api/admin/cleanup-preview", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { cleanupDeadTenants } = require("../../jobs/cleanup-dead-tenants");
      const results = await cleanupDeadTenants({ dryRun: true });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/cleanup-run", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { cleanupDeadTenants } = require("../../jobs/cleanup-dead-tenants");
      const results = await cleanupDeadTenants({ dryRun: false });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Revenue Stats ──────────────────────────────────────────────────────
  app.get("/api/admin/revenue-stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: [pricing] } = await db.query(
        "SELECT price FROM plan_pricing WHERE plan = 'pro' AND cycle = 'monthly' LIMIT 1"
      );
      const proPrice = pricing ? Number(pricing.price) : 0;

      const { rows: [counts] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'active') AS paying_tenants,
          COUNT(*) FILTER (WHERE status = 'active' AND payment_status = 'overdue') AS overdue
        FROM tenants
      `);

      const mrr = Number(counts.paying_tenants) * proPrice;

      const { rows: tenants } = await db.query(
        "SELECT id, slug FROM tenants WHERE status = 'active'"
      );
      let totalRevenue = 0;
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows: [rev] } = await tenantDb.query(
            `SELECT COALESCE(SUM(total), 0) AS revenue FROM sales
             WHERE "timestamp" >= date_trunc('month', NOW())`
          );
          totalRevenue += Number(rev.revenue);
        } catch (_) { /* skip */ }
      }

      return res.json({
        mrr,
        tenant_revenue_this_month: totalRevenue,
        paying_tenants: Number(counts.paying_tenants),
        overdue: Number(counts.overdue),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Infrastructure ─────────────────────────────────────────────────────
  app.get("/api/admin/infra", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true";
      if (!force && _infraCache && (Date.now() - _infraCache.timestamp) < INFRA_CACHE_TTL_MS) {
        res.set("X-Infra-Cache", "hit");
        return res.json(_infraCache.data);
      }

      const [
        connResult, maxConnResult, dbSizeResult, slowNowResult,
        cacheResult, tableHealthResult, schemaSizeResult,
      ] = await Promise.all([
        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE state = 'active') AS active,
            COUNT(*) FILTER (WHERE state = 'idle') AS idle,
            COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
            COUNT(*) AS total
          FROM pg_stat_activity
          WHERE backend_type = 'client backend'
        `),
        db.query("SELECT setting::int AS max FROM pg_settings WHERE name = 'max_connections'"),
        db.query("SELECT pg_database_size(current_database()) AS bytes, current_database() AS name"),
        db.query(`
          SELECT
            pid,
            EXTRACT(EPOCH FROM (now() - query_start))::numeric AS duration_s,
            LEFT(query, 200) AS query,
            state,
            usename AS username,
            application_name AS app
          FROM pg_stat_activity
          WHERE state = 'active'
            AND query NOT ILIKE '%pg_stat_activity%'
            AND query_start < now() - interval '1 second'
          ORDER BY query_start ASC
          LIMIT 10
        `),
        db.query(`
          SELECT
            CASE WHEN (sum(heap_blks_hit) + sum(heap_blks_read)) = 0 THEN 100
            ELSE ROUND(sum(heap_blks_hit)::numeric / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100, 2)
            END AS hit_ratio
          FROM pg_statio_user_tables
        `),
        db.query(`
          SELECT
            schemaname AS schema,
            relname AS "table",
            n_dead_tup AS dead_tuples,
            n_live_tup AS live_tuples,
            last_autovacuum
          FROM pg_stat_user_tables
          WHERE n_dead_tup > 0
          ORDER BY n_dead_tup DESC
          LIMIT 15
        `),
        db.query(`
          SELECT
            schemaname AS schema,
            ROUND(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)))::numeric / 1048576, 2) AS size_mb
          FROM pg_tables
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          GROUP BY schemaname
          ORDER BY size_mb DESC
        `),
      ]);

      const conn = connResult.rows[0];
      const maxConn = maxConnResult.rows[0]?.max || 100;

      const totalDeadTuples = tableHealthResult.rows.reduce((sum, r) => sum + parseInt(r.dead_tuples, 10), 0);
      const tablesNeedingVacuum = tableHealthResult.rows.filter((r) => parseInt(r.dead_tuples, 10) > 1000).length;

      let slowHistorical = [];
      try {
        const stmtResult = await db.query(`
          SELECT
            LEFT(query, 200) AS query,
            calls,
            ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
            ROUND(total_exec_time::numeric, 0) AS total_time_ms
          FROM pg_stat_statements
          WHERE calls > 5
            AND query NOT ILIKE '%pg_stat%'
          ORDER BY mean_exec_time DESC
          LIMIT 10
        `);
        slowHistorical = stmtResult.rows;
      } catch {
        // pg_stat_statements not enabled — skip silently
      }

      const connections = {
        active: parseInt(conn.active, 10),
        idle: parseInt(conn.idle, 10),
        idle_in_tx: parseInt(conn.idle_in_tx, 10),
        total: parseInt(conn.total, 10),
        max: maxConn,
      };

      if (connections.active > connections.max * 0.8) {
        alerting.recordDbPressure({
          active: connections.active,
          max: connections.max,
          longestQuery: slowNowResult.rows[0]?.query || null,
        }).catch(() => {});
      }

      const payload = {
        connections,
        database: {
          size_mb: Math.round(Number(dbSizeResult.rows[0].bytes) / 1048576 * 10) / 10,
          name: dbSizeResult.rows[0].name,
        },
        cache: {
          hit_ratio: Number(cacheResult.rows[0].hit_ratio),
        },
        slow_queries_now: slowNowResult.rows.map((r) => ({
          ...r,
          duration_s: Math.round(Number(r.duration_s) * 10) / 10,
        })),
        table_health: {
          total_dead_tuples: totalDeadTuples,
          tables_needing_vacuum: tablesNeedingVacuum,
          worst_tables: tableHealthResult.rows.map((r) => ({
            schema: r.schema,
            table: r.table,
            dead_tuples: parseInt(r.dead_tuples, 10),
            live_tuples: parseInt(r.live_tuples, 10),
            last_autovacuum: r.last_autovacuum,
          })),
        },
        schema_sizes: schemaSizeResult.rows.map((r) => ({
          schema: r.schema,
          size_mb: Number(r.size_mb),
        })),
        slow_queries_historical: slowHistorical,
        cached_at: new Date().toISOString(),
        cache_ttl_seconds: INFRA_CACHE_TTL_MS / 1000,
      };

      _infraCache = { data: payload, timestamp: Date.now() };
      res.set("X-Infra-Cache", "miss");
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};

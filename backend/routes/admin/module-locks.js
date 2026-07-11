/**
 * Admin platform module locks — the Business Modules super-admin backstop.
 *
 * A lock row means the tenant CANNOT self-ENABLE that module via
 * POST /api/business-modules/:key/toggle (enforced in Step 6's service).
 * Disable is always allowed; force-off remains the existing per-tenant
 * admin flag write. tenant_id NULL = global lock, non-NULL = one tenant.
 */

const { BUSINESS_MODULES } = require("../../config/business-modules");

module.exports = function registerModuleLockRoutes(app, deps) {
  const { db, requireAllowedIp, requireSuperAdmin, logAdminAction } = deps;

  // List all locks (global + per-tenant, with tenant slug for display).
  app.get("/api/admin/module-locks", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT l.id, l.module_key, l.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
                l.locked_by, l.reason, l.locked_at
           FROM public.platform_module_locks l
           LEFT JOIN public.tenants t ON t.id = l.tenant_id
          ORDER BY l.module_key, l.tenant_id NULLS FIRST`
      );
      res.json({ locks: rows, module_keys: Object.keys(BUSINESS_MODULES).sort() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create/refresh a lock. Body: { tenant_id?: number|null, reason?: string }.
  app.put("/api/admin/module-locks/:moduleKey", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { moduleKey } = req.params;
      if (!BUSINESS_MODULES[moduleKey]) {
        return res.status(404).json({ error: `Unknown module: ${moduleKey}` });
      }
      const tenantIdRaw = req.body?.tenant_id ?? null;
      const tenantId = tenantIdRaw === null ? null : Number(tenantIdRaw);
      if (tenantId !== null && !Number.isInteger(tenantId)) {
        return res.status(400).json({ error: "tenant_id must be an integer" });
      }
      const reason = req.body?.reason || null;
      if (tenantId !== null) {
        const { rows: [tenant] } = await db.query(
          "SELECT id FROM public.tenants WHERE id = $1",
          [tenantId]
        );
        if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      }

      // Two partial unique indexes (global vs per-tenant) — upsert manually
      // since ON CONFLICT can't target a partial index by column list alone.
      const { rows: [existing] } = await db.query(
        `SELECT id FROM public.platform_module_locks
          WHERE module_key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
        [moduleKey, tenantId]
      );
      let lock;
      if (existing) {
        ({ rows: [lock] } = await db.query(
          `UPDATE public.platform_module_locks
              SET locked_by = $1, reason = $2, locked_at = NOW()
            WHERE id = $3 RETURNING *`,
          [req.admin.email, reason, existing.id]
        ));
      } else {
        ({ rows: [lock] } = await db.query(
          `INSERT INTO public.platform_module_locks (module_key, tenant_id, locked_by, reason)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [moduleKey, tenantId, req.admin.email, reason]
        ));
      }

      logAdminAction(
        req.admin.email,
        "module_lock_set",
        "module_lock",
        lock.id,
        { module_key: moduleKey, tenant_id: tenantId, reason },
        req.ip
      );
      res.json({ lock });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Remove a lock. Query: ?tenant_id=<id> for a per-tenant lock; omit for global.
  app.delete("/api/admin/module-locks/:moduleKey", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { moduleKey } = req.params;
      const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : null;
      if (tenantId !== null && !Number.isInteger(tenantId)) {
        return res.status(400).json({ error: "tenant_id must be an integer" });
      }
      const { rows } = await db.query(
        `DELETE FROM public.platform_module_locks
          WHERE module_key = $1 AND tenant_id IS NOT DISTINCT FROM $2
          RETURNING id`,
        [moduleKey, tenantId]
      );
      if (!rows.length) return res.status(404).json({ error: "Lock not found" });

      logAdminAction(
        req.admin.email,
        "module_lock_removed",
        "module_lock",
        rows[0].id,
        { module_key: moduleKey, tenant_id: tenantId },
        req.ip
      );
      res.json({ message: "Lock removed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

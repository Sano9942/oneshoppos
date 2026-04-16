/**
 * Admin operations — support tickets, impersonation, dead letter queue.
 */
module.exports = function registerOperationsRoutes(app, deps) {
  const { db, masterDb, jwt, requireAllowedIp, requireSuperAdmin, tenantDbManager, auditLog, logAdminAction } = deps;

  // ── Support Tickets (cross-tenant) ─────────────────────────────────────
  app.get("/api/admin/support-tickets", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const status = req.query.status || null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allTickets = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          let sql = `SELECT id, type, message, page_url, browser, employee_id, screenshots, last_req_id, status, admin_reply, replied_at, created_at, resolved_at
                     FROM support_tickets`;
          const params = [];
          if (status) {
            sql += " WHERE status = $1";
            params.push(status);
          }
          sql += " ORDER BY created_at DESC LIMIT $" + (params.length + 1);
          params.push(limit);

          const { rows } = await tenantDb.query(sql, params);
          for (const row of rows) {
            allTickets.push({ ...row, tenant_id: tenant.id, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch {
          // Table may not exist for this tenant — skip silently
        }
      }

      allTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ tickets: allTickets.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/support-tickets/:tenantId/:ticketId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!status || !["open", "acknowledged", "resolved"].includes(status)) {
        return res.status(400).json({ error: "status must be one of: open, acknowledged, resolved" });
      }

      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const resolvedAt = status === "resolved" ? "NOW()" : "NULL";
      const { rows } = await tenantDb.query(
        `UPDATE support_tickets SET status = $1, resolved_at = ${resolvedAt} WHERE id = $2 RETURNING *`,
        [status, req.params.ticketId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      if (status === "resolved" && rows[0].employee_id) {
        try {
          const { rows: [emp] } = await tenantDb.query(
            "SELECT email FROM employees WHERE id = $1", [rows[0].employee_id]
          );
          const { rows: [profile] } = await tenantDb.query(
            "SELECT company_name FROM company_profile WHERE id = 1"
          );
          if (emp?.email) {
            const { sendEmail } = require("../../services/email");
            sendEmail({
              type: "support_resolved",
              to: emp.email,
              data: {
                ticketId: rows[0].id,
                type: rows[0].type,
                storeName: profile?.company_name || "Your store",
              },
            }).catch((err) => console.error("Ticket resolved email failed:", err.message));
          }
        } catch (emailErr) {
          console.error("Ticket resolved email lookup failed:", emailErr.message);
        }
      }

      return res.json({ ticket: rows[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Reply with notification (consolidated from two duplicate handlers in original admin.js)
  app.put("/api/admin/support-tickets/:tenantId/:ticketId/reply", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { reply } = req.body || {};
      if (!reply || !reply.trim()) {
        return res.status(400).json({ error: "reply is required" });
      }
      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const { rows } = await tenantDb.query(
        `UPDATE support_tickets SET admin_reply = $1, replied_at = NOW(), status = 'acknowledged'
         WHERE id = $2 RETURNING *`,
        [reply.trim(), req.params.ticketId]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Ticket not found" });

      // Create in-app notification for the employee
      if (rows[0].employee_id) {
        try {
          await tenantDb.query(
            `INSERT INTO notifications (employee_id, type, title, message)
             VALUES ($1, 'support_reply', 'Support ticket reply', $2)`,
            [rows[0].employee_id, `Your support ticket has been replied to: ${reply.trim().substring(0, 100)}`]
          );
        } catch (_) { /* non-critical */ }
      }

      logAdminAction(req.admin.email, "ticket_replied", "support_ticket", req.params.ticketId, { tenant_id: req.params.tenantId }, req.ip);
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/support-tickets/:tenantId/:ticketId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const { rowCount } = await tenantDb.query(
        "DELETE FROM support_tickets WHERE id = $1",
        [req.params.ticketId]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Ticket not found" });
      logAdminAction(req.admin.email, "ticket_deleted", "support_ticket", req.params.ticketId, { tenant_id: req.params.tenantId }, req.ip);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Impersonation ──────────────────────────────────────────────────────
  app.post("/api/admin/impersonate/:tenantId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);

      const { rows: tenantRows } = await db.query(
        "SELECT id, slug, name, status FROM tenants WHERE id = $1",
        [tenantId]
      );
      const tenant = tenantRows[0];
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") return res.status(400).json({ error: "Can only impersonate active tenants" });

      const tenantDb = await tenantDbManager.getDb(tenantId);
      const { rows: empRows } = await tenantDb.query(
        "SELECT id, name, role_id FROM employees WHERE role_id = 1 LIMIT 1"
      );
      const adminEmployee = empRows[0];
      if (!adminEmployee) return res.status(404).json({ error: "No admin employee found in tenant" });

      const { rows: saRows } = await db.query(
        "SELECT name FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const adminName = saRows[0]?.name || req.admin.email;

      const token = jwt.sign(
        {
          tid: tenant.id,
          eid: adminEmployee.id,
          rid: 1,
          oid: null,
          scope: "full",
          impersonating: true,
          realIdentity: { id: req.admin.id, name: adminName, email: req.admin.email },
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      const { rows: sessionRows } = await masterDb.query(
        "INSERT INTO impersonation_sessions (super_admin_id, tenant_id) VALUES ($1, $2) RETURNING id",
        [req.admin.id, tenantId]
      );
      const sessionId = sessionRows[0].id;

      await auditLog(tenantId, "impersonated", { session_id: sessionId, admin_name: adminName }, `admin:${req.admin.email}`);

      logAdminAction(req.admin.email, "impersonation_started", "tenant", req.params.tenantId, null, req.ip);
      return res.json({ token, tenantSlug: tenant.slug, tenantName: tenant.name, sessionId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/impersonate/:sessionId/end", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      await masterDb.query(
        "UPDATE impersonation_sessions SET ended_at = NOW() WHERE id = $1",
        [sessionId]
      );
      logAdminAction(req.admin.email, "impersonation_ended", "session", req.params.sessionId, null, req.ip);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Dead Letter Queue (cross-tenant) ───────────────────────────────────
  app.get("/api/admin/dead-letters", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allEvents = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows } = await tenantDb.query(
            `SELECT id, topic, status, payload, error, retries, created_at, updated_at
             FROM shopify_webhook_events
             WHERE status IN ('dead_letter', 'failed')
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
          );
          for (const row of rows) {
            allEvents.push({ ...row, tenant_id: tenant.id, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch {
          // Table may not exist — skip silently
        }
      }

      allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ events: allEvents.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/dead-letters/:tenantId/:id/retry", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const { rows } = await tenantDb.query(
        `UPDATE shopify_webhook_events SET status = 'pending', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }

      return res.json({ event: rows[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Payment Webhook Dead-Letters ───────────────────────────────────────
  // Returns recent payment webhook events from the public schema. Used by
  // AdminStuckPayments.jsx to surface unprocessed or anomalous webhooks.
  // Joins across tenants via masterDb (public schema). Last 7 days, newest first.
  app.get("/api/admin/webhooks/payment-dead-letters", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows } = await masterDb.query(
        `SELECT id, provider, event_id, event_type, payment_context, context_ref,
                raw_payload, processed_at, created_at
         FROM payment_webhook_events
         WHERE created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return res.json({ events: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};

# Super Admin Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the super-admin panel with 22 features across 4 phases — wire up hidden backend features, add new admin capabilities (revenue dashboard, activity log, worker monitoring, tenant notes, announcements), improve support ticket system, and automate cleanup jobs.

**Architecture:** All new backend routes go into `backend/routes/admin.js` (existing file, ~1600 lines). New tables go into `public` schema via migration v12 in `backend/migrate-pg.js`. New frontend pages go into `frontend/src/pages/admin/`. Worker heartbeats use in-memory globals on the Express process. Admin activity logging uses a helper function called from every admin mutation route.

**Tech Stack:** Node.js/Express backend, React frontend, PostgreSQL, Tailwind CSS v4, Cloudflare R2 (backups), Resend (emails)

**Key conventions:**
- Backend: `await db.query(sql, [$1])` with `{ rows, rowCount }` results. Booleans are `true`/`false`. All admin routes gated by `requireAllowedIp, requireSuperAdmin`.
- Frontend admin: Uses `adminFetch` from `AdminLogin.jsx` (NOT global fetch interceptor). Session in `localStorage["adminSession"]`.
- Tailwind v4: `(--css-var)` not `[var(--css-var)]`, `shrink-0` not `flex-shrink-0`.
- Timestamps: Use `new Date(x).toLocaleString()` in admin UI (admin timestamps are display-only, no UTC/local distinction needed).

---

## Task 1: Migration v12 — New Tables + Schema Changes

**Files:**
- Modify: `backend/migrate-pg.js` (add version 12 after line 409)
- Modify: `backend/schema-pg.sql` (add tables for new tenant provisioning)

**Step 1: Add migration v12 to migrate-pg.js**

Add this after the `version: 11` block (after line 409, before the closing `];`):

```js
  {
    version: 12,
    description: "Super admin enhancements — activity log, security log, tenant notes, announcements, broadcast log, support replies",
    up: async (client) => {
      // Public schema tables
      await client.query(`CREATE TABLE IF NOT EXISTS admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created ON admin_activity_log(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action)`);

      await client.query(`CREATE TABLE IF NOT EXISTS admin_security_log (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_security_log_created ON admin_security_log(created_at DESC)`);

      await client.query(`CREATE TABLE IF NOT EXISTS tenant_notes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        admin_email TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tenant_notes_tenant ON tenant_notes(tenant_id)`);

      await client.query(`CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        active BOOLEAN DEFAULT true,
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        ends_at TIMESTAMPTZ,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS broadcast_log (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        broadcast_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        recipient_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    },
  },
```

**Step 2: Add per-tenant migration for support ticket reply columns**

This goes inside the same version 12 `up` function, but needs to run for each tenant. However, `migrate-pg.js` already handles public + tenant schemas automatically — the version 12 `up` runs against each schema in sequence. Since `support_tickets` only exists in tenant schemas, wrap the ALTER TABLE:

Add at the end of the version 12 `up` function:

```js
      // Per-tenant: support ticket reply columns (safe if table doesn't exist in this schema)
      try {
        await client.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_reply TEXT`);
        await client.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ`);
      } catch (_) {
        // Table may not exist in public schema — ignore
      }
```

**Step 3: Add the same tables to schema-pg.sql** (for new tenant provisioning)

Add the `admin_reply` and `replied_at` columns to the existing `support_tickets` CREATE TABLE in `schema-pg.sql`. Also add the public-schema tables (they'll be created by migration, but schema-pg.sql should stay in sync as documentation).

**Step 4: Run migration locally**

Run: `cd backend && node migrate-pg.js`
Expected: `[migrate-pg] Applying version 12: Super admin enhancements...` then success for public + each tenant schema.

**Step 5: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat: migration v12 — admin activity log, security log, tenant notes, announcements, broadcast log, support replies"
```

---

## Task 2: Admin Activity Logging Helper

**Files:**
- Modify: `backend/routes/admin.js` (add helper function + instrument existing routes)

**Step 1: Add `logAdminAction` and `logSecurityEvent` helpers**

Add these near the top of `admin.js`, inside the `registerAdminRoutes` function but before the first route:

```js
  // ── Admin Activity Logging ─────────────────────────────────────────
  async function logAdminAction(email, action, targetType, targetId, details, ip) {
    try {
      await db.query(
        `INSERT INTO admin_activity_log (admin_email, action, target_type, target_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, action, targetType, String(targetId || ""), details ? JSON.stringify(details) : null, ip || null]
      );
    } catch (_) { /* non-critical — never block admin operations */ }
  }

  async function logSecurityEvent(eventType, email, ip, userAgent, details) {
    try {
      await db.query(
        `INSERT INTO admin_security_log (event_type, email, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventType, email, ip, userAgent, details ? JSON.stringify(details) : null]
      );
    } catch (_) { /* non-critical */ }
  }
```

**Step 2: Instrument login endpoint**

In the `POST /api/admin/auth/login` handler, add security logging for success and failure:

After successful login (where it returns the token):
```js
logSecurityEvent("login_success", email, req.ip, req.headers["user-agent"], null);
```

After failed login (where it returns 401):
```js
logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
```

**Step 3: Instrument existing mutation routes**

Add `logAdminAction` calls to every admin mutation route. Use `req.admin.email` for the email and `req.ip` for IP. Here are the calls to add:

| Route | After success response | `logAdminAction(...)` call |
|-------|----------------------|---------------------------|
| `POST /api/admin/tenants` (create) | After `res.status(201).json(...)` | `logAdminAction(req.admin.email, "tenant_created", "tenant", tenant.slug, { plan }, req.ip)` |
| `PUT /api/admin/tenants/:id` (update) | After `res.json(...)` | `logAdminAction(req.admin.email, "tenant_updated", "tenant", req.params.id, req.body, req.ip)` |
| `POST /api/admin/tenants/:id/suspend` | After success | `logAdminAction(req.admin.email, "tenant_suspended", "tenant", req.params.id, null, req.ip)` |
| `POST /api/admin/tenants/:id/activate` | After success | `logAdminAction(req.admin.email, "tenant_activated", "tenant", req.params.id, null, req.ip)` |
| `DELETE /api/admin/tenants/:id` | After success | `logAdminAction(req.admin.email, "tenant_deleted", "tenant", tenant.slug, null, req.ip)` |
| `POST /api/admin/tenants/:id/reset-pin` | After success | `logAdminAction(req.admin.email, "pin_reset", "tenant", req.params.id, null, req.ip)` |
| `POST /api/admin/tenants/:id/migrate` | After success | `logAdminAction(req.admin.email, "tenant_migrated", "tenant", req.params.id, null, req.ip)` |
| `POST /api/admin/migrate-all` | After success | `logAdminAction(req.admin.email, "migrate_all", "system", null, result, req.ip)` |
| `POST /api/admin/tenants/:id/record-payment` | After success | `logAdminAction(req.admin.email, "payment_recorded", "tenant", req.params.id, { amount, method }, req.ip)` |
| `PUT /api/admin/upgrade-requests/:id` | After success | `logAdminAction(req.admin.email, "upgrade_request_" + action, "tenant", req.params.id, null, req.ip)` |
| `POST /api/admin/impersonate/:tenantId` | After success | `logAdminAction(req.admin.email, "impersonation_started", "tenant", req.params.tenantId, null, req.ip)` |
| `POST /api/admin/impersonate/:sessionId/end` | After success | `logAdminAction(req.admin.email, "impersonation_ended", "session", req.params.sessionId, null, req.ip)` |
| `PUT /api/admin/plan-pricing/:id` | After success | `logAdminAction(req.admin.email, "pricing_updated", "plan", req.params.id, req.body, req.ip)` |
| `POST /api/admin/email/broadcast` | After success | `logAdminAction(req.admin.email, "broadcast_sent", "email", null, { subject, type: broadcastType }, req.ip)` |

**Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: admin activity + security logging helper, instrument all mutation routes"
```

---

## Task 3: Admin Activity Log + Security Log API Routes

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Add activity log route**

```js
  // ── Activity Log ──────────────────────────────────────────────────
  app.get("/api/admin/activity-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { action, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (action) {
        params.push(action);
        conditions.push(`action = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_activity_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_activity_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Add security log route**

```js
  app.get("/api/admin/security-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { event_type, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (event_type) {
        params.push(event_type);
        conditions.push(`event_type = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_security_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_security_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add cross-tenant activity route**

```js
  app.get("/api/admin/tenant-activity", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allActivity = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows } = await tenantDb.query(
            `SELECT action, entity_type, entity_id, details, performed_by, created_at
             FROM action_history ORDER BY created_at DESC LIMIT $1`,
            [Math.ceil(limit / tenants.length) || 10]
          );
          for (const row of rows) {
            allActivity.push({ ...row, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch (_) { /* table may not exist */ }
      }

      allActivity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ entries: allActivity.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: admin activity log, security log, tenant activity API routes"
```

---

## Task 4: Email Queue Actions (Delete, Send Now, Purge)

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Add delete email route**

```js
  // DELETE /api/admin/email-queue/:id — hard delete a pending/failed email
  app.delete("/api/admin/email-queue/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_deleted", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Add force send route**

```js
  // POST /api/admin/email-queue/:id/send-now — force a pending email to send immediately
  app.post("/api/admin/email-queue/:id/send-now", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE email_queue SET send_at = NOW(), attempts = 0, error = NULL WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_force_sent", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email queued for immediate send" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add purge deleted tenants route**

```js
  // DELETE /api/admin/email-queue/purge-deleted — delete all emails for deleted tenants
  app.delete("/api/admin/email-queue/purge-deleted", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE tenant_id IN (SELECT id FROM tenants WHERE status = 'deleted')"
      );
      logAdminAction(req.admin.email, "email_purge_deleted", "email", null, { count: rowCount }, req.ip);
      return res.json({ message: `Purged ${rowCount} email(s) for deleted tenants` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Important:** Place the `purge-deleted` route BEFORE the `/:id` routes so Express doesn't interpret `purge-deleted` as an `:id` parameter.

**Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: email queue delete, force send, purge deleted tenant emails"
```

---

## Task 5: Revenue Stats, Worker Status, Orphaned Schemas API Routes

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Add revenue stats route**

```js
  // GET /api/admin/revenue-stats — MRR + tenant revenue
  app.get("/api/admin/revenue-stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      // MRR from plan pricing × active pro tenants
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

      // Tenant revenue this month — sum sales across active tenant schemas
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
```

**Step 2: Add worker status route**

```js
  // GET /api/admin/worker-status — heartbeat from email + FBR workers
  app.get("/api/admin/worker-status", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const emailStatus = global.__emailWorkerStatus || null;
      const fbrStatus = global.__fbrWorkerStatus || null;
      const cleanupStatus = global.__cleanupWorkerStatus || null;

      function workerInfo(status, pollIntervalMs) {
        if (!status) return { enabled: false, running: false };
        const lastPollAgo = Date.now() - (status.lastPollAt || 0);
        return {
          enabled: true,
          running: lastPollAgo < pollIntervalMs * 2.5,
          last_poll_at: status.lastPollAt ? new Date(status.lastPollAt).toISOString() : null,
          last_poll_ago_seconds: Math.round(lastPollAgo / 1000),
          processed_today: status.processedToday || 0,
          queue_depth: status.queueDepth || 0,
        };
      }

      return res.json({
        email: workerInfo(emailStatus, 60_000),
        fbr: workerInfo(fbrStatus, 30_000),
        cleanup: workerInfo(cleanupStatus, 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add orphaned schema detection + cleanup routes**

```js
  // GET /api/admin/orphaned-schemas — detect schemas with no tenant record
  app.get("/api/admin/orphaned-schemas", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const orphans = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          const { rows: [size] } = await db.query(
            `SELECT pg_size_pretty(COALESCE(SUM(pg_total_relation_size(quote_ident($1)||'.'||quote_ident(tablename)))::bigint, 0)) AS size
             FROM pg_tables WHERE schemaname = $1`,
            [s.schema_name]
          );
          orphans.push({ schema: s.schema_name, size: size.size });
        }
      }

      return res.json({ orphans, count: orphans.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/orphaned-schemas/cleanup — drop all orphaned schemas
  app.post("/api/admin/orphaned-schemas/cleanup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const dropped = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          await db.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
          dropped.push(s.schema_name);
        }
      }

      logAdminAction(req.admin.email, "orphaned_schemas_cleanup", "system", null, { dropped }, req.ip);
      return res.json({ dropped, count: dropped.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: revenue stats, worker status, orphaned schema detection API routes"
```

---

## Task 6: Tenant Notes, Announcements, Broadcast Log API Routes

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Add tenant notes routes**

```js
  // ── Tenant Notes ──────────────────────────────────────────────────
  app.get("/api/admin/tenants/:id/notes", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM tenant_notes WHERE tenant_id = $1 ORDER BY created_at DESC",
        [req.params.id]
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/notes", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { note } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: "Note is required" });

      const { rows } = await db.query(
        "INSERT INTO tenant_notes (tenant_id, admin_email, note) VALUES ($1, $2, $3) RETURNING *",
        [req.params.id, req.admin.email, note.trim()]
      );
      logAdminAction(req.admin.email, "note_added", "tenant", req.params.id, { note: note.trim().substring(0, 100) }, req.ip);
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/tenants/:id/notes/:noteId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM tenant_notes WHERE id = $1 AND tenant_id = $2",
        [req.params.noteId, req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Note not found" });
      return res.json({ message: "Note deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Add announcement routes**

```js
  // ── Announcements ─────────────────────────────────────────────────
  app.get("/api/admin/announcements", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/announcements", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { message, type = "info", ends_at } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });
      if (!["info", "warning", "maintenance"].includes(type)) return res.status(400).json({ error: "Type must be info, warning, or maintenance" });

      const { rows } = await db.query(
        `INSERT INTO announcements (message, type, ends_at, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [message.trim(), type, ends_at || null, req.admin.email]
      );
      logAdminAction(req.admin.email, "announcement_created", "announcement", rows[0].id, { type, message: message.trim().substring(0, 100) }, req.ip);
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/announcements/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { message, type, active, ends_at } = req.body;
      const { rows } = await db.query(
        `UPDATE announcements SET
          message = COALESCE($1, message),
          type = COALESCE($2, type),
          active = COALESCE($3, active),
          ends_at = $4
        WHERE id = $5 RETURNING *`,
        [message, type, active, ends_at !== undefined ? ends_at : null, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/announcements/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM announcements WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Announcement not found" });
      logAdminAction(req.admin.email, "announcement_deleted", "announcement", req.params.id, null, req.ip);
      return res.json({ message: "Announcement deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add public announcements route (no auth — for tenant dashboards)**

This route should be registered OUTSIDE the admin routes — add it to `backend/routes/admin.js` but BEFORE the `requireSuperAdmin` routes, or better yet, register it in `registerAllRoutes.js` alongside `/api/health`. For simplicity, add it in admin.js before the auth routes:

```js
  // Public: active announcements (no auth, for tenant dashboards)
  app.get("/api/announcements/active", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, message, type, starts_at, ends_at FROM announcements
         WHERE active = true AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
         ORDER BY created_at DESC LIMIT 5`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Add broadcast logging to existing broadcast route**

In the existing `POST /api/admin/email/broadcast` handler, after the emails are queued, add:

```js
      // Log broadcast
      try {
        await db.query(
          `INSERT INTO broadcast_log (admin_email, broadcast_type, subject, message, recipient_count) VALUES ($1, $2, $3, $4, $5)`,
          [req.admin.email, broadcastType, subject, message, recipientCount]
        );
      } catch (_) { /* non-critical */ }
```

Also add a route to fetch broadcast history:

```js
  // GET /api/admin/broadcast-history — list sent broadcasts
  app.get("/api/admin/broadcast-history", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM broadcast_log ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 5: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: tenant notes, announcements, broadcast history API routes"
```

---

## Task 7: Support Ticket Enhancements (Reply, Delete) + Backup + Cleanup Worker API Routes

**Files:**
- Modify: `backend/routes/admin.js`
- Modify: `backend/index.js` (cleanup worker startup)

**Step 1: Add support ticket reply route**

```js
  // PUT /api/admin/support-tickets/:tenantId/:ticketId/reply — admin reply to ticket
  app.put("/api/admin/support-tickets/:tenantId/:ticketId/reply", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { reply } = req.body;
      if (!reply || !reply.trim()) return res.status(400).json({ error: "Reply is required" });

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
```

**Step 2: Add support ticket delete route**

```js
  // DELETE /api/admin/support-tickets/:tenantId/:ticketId — delete a ticket
  app.delete("/api/admin/support-tickets/:tenantId/:ticketId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const { rowCount } = await tenantDb.query(
        "DELETE FROM support_tickets WHERE id = $1",
        [req.params.ticketId]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Ticket not found" });
      logAdminAction(req.admin.email, "ticket_deleted", "support_ticket", req.params.ticketId, { tenant_id: req.params.tenantId }, req.ip);
      return res.json({ message: "Ticket deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add backup routes**

```js
  // POST /api/admin/backup — trigger database backup (uploads to R2)
  app.post("/api/admin/backup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { isPgDumpAvailable, backupSchema } = require("../utils/backup-pg");
      const { uploadToR2 } = require("../utils/r2");

      const available = await isPgDumpAvailable();
      if (!available) return res.status(500).json({ error: "pg_dump not available on this server" });

      // Backup public schema (master tables)
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const key = `backups/full-backup-${timestamp}.dump`;

      const { stream, process: proc } = backupSchema("public");
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));

      await new Promise((resolve, reject) => {
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`)));
        proc.on("error", reject);
      });

      const buffer = Buffer.concat(chunks);
      const url = await uploadToR2(buffer, key, "application/octet-stream");

      // Log to backup_log table (if exists)
      try {
        await db.query(
          "INSERT INTO backup_log (filename, size_bytes, url, created_at) VALUES ($1, $2, $3, NOW())",
          [key, buffer.length, url]
        );
      } catch (_) { /* table may not exist */ }

      logAdminAction(req.admin.email, "backup_created", "system", null, { key, size: buffer.length }, req.ip);
      return res.json({ message: "Backup created", key, size: buffer.length, url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/backup-history — list backup log
  app.get("/api/admin/backup-history", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 20"
      );
      return res.json(rows);
    } catch (err) {
      // Table may not exist
      return res.json([]);
    }
  });
```

**Step 4: Add cleanup worker inline startup to index.js**

Add after the email worker block (~line 1297 in `backend/index.js`):

```js
// Cleanup Worker — removes dead tenants (incomplete setup > 7 days)
if (String(process.env.CLEANUP_WORKER_ENABLED || "0") === "1") {
  const { cleanupDeadTenants } = require("./jobs/cleanup-dead-tenants");
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  global.__cleanupWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };

  async function runCleanup() {
    try {
      global.__cleanupWorkerStatus.lastPollAt = Date.now();
      const result = await cleanupDeadTenants();
      global.__cleanupWorkerStatus.processedToday += result.deleted;
      console.log(`[cleanup-worker] Checked: ${result.checked}, Deleted: ${result.deleted}, Skipped: ${result.skipped}`);
    } catch (err) {
      console.error("[cleanup-worker] Error:", err.message);
    }
  }

  // Run once on startup, then every 24 hours
  setTimeout(runCleanup, 10_000);
  setInterval(runCleanup, CLEANUP_INTERVAL);
  console.log("[cleanup-worker] Scheduled (every 24h)");
}
```

**Step 5: Add worker heartbeats to email and FBR workers**

In `backend/workers/email-worker.js`, inside `startEmailWorker`, after the `resend` initialization:

```js
  global.__emailWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
```

Then inside the `poll` function, add at the start:
```js
    global.__emailWorkerStatus.lastPollAt = Date.now();
```

After processing emails, update:
```js
    global.__emailWorkerStatus.processedToday += sentCount;
    global.__emailWorkerStatus.queueDepth = remainingCount;
```

Do the same pattern for `backend/workers/fbr-worker.js` using `global.__fbrWorkerStatus`.

**Step 6: Commit**

```bash
git add backend/routes/admin.js backend/index.js backend/workers/email-worker.js backend/workers/fbr-worker.js
git commit -m "feat: support reply/delete, backup trigger, cleanup worker, worker heartbeats"
```

---

## Task 8: Admin Layout — Sidebar Nav + Routes

**Files:**
- Modify: `frontend/src/pages/admin/AdminLayout.jsx`
- Modify: `frontend/src/App.jsx`

**Step 1: Update AdminLayout.jsx sidebar nav**

Replace the `NAV_ITEMS` array with:

```js
import { Home, LogOut, Server, Shield, MessageSquare, AlertTriangle, Mail, Activity, Scale } from "lucide-react";

const NAV_ITEMS = [
  { name: "Dashboard", path: "/admin", icon: Home, end: true },
  { name: "Tenants", path: "/admin/tenants", icon: Server },
  { name: "Support", path: "/admin/support", icon: MessageSquare, badge: true },
  { name: "Emails", path: "/admin/emails", icon: Mail },
  { name: "Activity", path: "/admin/activity", icon: Activity },
  { name: "Tax Rates", path: "/admin/tax-rates", icon: Scale },
  { name: "Dead Letters", path: "/admin/dead-letters", icon: AlertTriangle },
];
```

**Step 2: Add support ticket badge**

Add state for open ticket count in `AdminLayout`:

```js
const [openTicketCount, setOpenTicketCount] = useState(0);

useEffect(() => {
  const fetchCount = () => {
    adminFetch("/api/admin/support-tickets?status=open")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setOpenTicketCount(data.tickets?.length || 0); })
      .catch(() => {});
  };
  fetchCount();
  const timer = setInterval(fetchCount, 60000);
  return () => clearInterval(timer);
}, []);
```

In the nav rendering, after `<span>{item.name}</span>`, add:

```jsx
{item.badge && openTicketCount > 0 && (
  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
    {openTicketCount}
  </span>
)}
```

Add necessary imports: `useState, useEffect` from react, `adminFetch` from AdminLogin.

**Step 3: Add Activity route to App.jsx**

Add after the `tax-rates` Route (line 190):

```jsx
<Route path="activity" element={<Suspense fallback={<RouteLoading />}><AdminActivity /></Suspense>} />
```

Add the lazy import at the top with the other admin imports:

```js
const AdminActivity = lazy(() => import("./pages/admin/AdminActivity"));
```

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminLayout.jsx frontend/src/App.jsx
git commit -m "feat: admin sidebar — add Tax Rates, Activity, support badge"
```

---

## Task 9: AdminActivity.jsx — 3-Tab Activity Log Page

**Files:**
- Create: `frontend/src/pages/admin/AdminActivity.jsx`

**Step 1: Create the AdminActivity page**

Build a page with 3 tabs (Admin Actions, Tenant Activity, Security), each showing a paginated table with filters. Reference `AdminEmails.jsx` for the tab pattern and `adminFetch` usage.

Key features:
- Tab state with `useState`
- Each tab fetches its own endpoint: `/api/admin/activity-log`, `/api/admin/tenant-activity`, `/api/admin/security-log`
- Admin Actions tab: filterable by action type dropdown
- Security tab: filterable by event type (login_success, login_failed)
- Tenant Activity tab: shows tenant name + action + timestamp
- Pagination with Next/Previous buttons using `offset` param
- 30s auto-refresh
- CSV export button (use `downloadCsv` from `utils/csvExport.js`)

Table columns per tab:
- **Admin Actions:** Time, Admin, Action, Target, Details
- **Tenant Activity:** Time, Tenant, Action, Entity, Performed By
- **Security:** Time, Event, Email, IP Address, User Agent

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminActivity.jsx
git commit -m "feat: admin activity log page with 3 tabs"
```

---

## Task 10: AdminDashboard.jsx — Revenue, FBR Health, Workers, Orphans, Backup, Impersonation Cards

**Files:**
- Modify: `frontend/src/pages/admin/AdminDashboard.jsx`

**Step 1: Add Revenue section**

Add a new section between "Needs Attention" and "Infrastructure" that fetches `GET /api/admin/revenue-stats` and shows 4 cards: MRR, Tenant Revenue This Month, Paying Tenants, Overdue.

**Step 2: Add FBR Health card**

Fetch `GET /api/admin/fbr-health` and show a card in Infrastructure: FBR API status, pending invoices, failed invoices. Color-code: green = healthy, red = down/failures.

**Step 3: Add Worker Status card**

Fetch `GET /api/admin/worker-status` and show a card for each worker: Email, FBR, Cleanup. Show: status dot (green=running, red=stopped), queue depth, last poll time, processed today count.

**Step 4: Add Orphaned Schema Detector card**

Fetch `GET /api/admin/orphaned-schemas`. If count > 0, show warning card with list + "Clean Up" button. If 0, show green checkmark "All schemas healthy".

**Step 5: Add Database Backup card**

Fetch `GET /api/admin/backup-history`. Show last backup time. "Backup Now" button calls `POST /api/admin/backup`. Show backup list with sizes.

**Step 6: Add Migrate All button**

Add "Migrate All Tenants" button in Infrastructure section. Confirmation modal. Calls `POST /api/admin/migrate-all`. Shows result summary.

**Step 7: Add Active Impersonation Sessions**

Fetch active sessions from existing data (or add a simple query). Show any active impersonation sessions with "End Session" button calling `POST /api/admin/impersonate/:sessionId/end`.

**Step 8: Commit**

```bash
git add frontend/src/pages/admin/AdminDashboard.jsx
git commit -m "feat: dashboard — revenue, FBR health, workers, orphans, backup, impersonation cards"
```

---

## Task 11: AdminTenantList.jsx — Delete Button

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx`

**Step 1: Add delete button and confirmation modal**

Add a red trash icon button on each tenant row. On click, show a confirmation modal that requires typing the tenant slug to confirm (like GitHub repository deletion). On confirm, call `DELETE /api/admin/tenants/:id` and refresh the list.

Add state: `const [deleteTarget, setDeleteTarget] = useState(null)` and `const [deleteConfirm, setDeleteConfirm] = useState("")`.

Modal: "Type `{slug}` to confirm deletion. This will permanently drop all data."

Button disabled until `deleteConfirm === deleteTarget.slug`.

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantList.jsx
git commit -m "feat: tenant list — delete button with slug confirmation modal"
```

---

## Task 12: AdminTenantDetail.jsx — Feature Flags, Notes, Plan Pricing Editor

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx`

**Step 1: Add Feature Flags section**

Add a "Feature Flags" section below billing. Read feature flags from the tenant data (already fetched). Show toggle switches for each flag: `ai_insights`, `fbr_integration`, `accounting`, `advanced_crm`, `approvals`, `advanced_hr`, `notifications`. On toggle, call `PUT /api/admin/tenants/:id` with updated flags.

**Step 2: Add Tenant Notes section**

Add a "Notes" section below Feature Flags. Text input + "Add Note" button. List of existing notes with timestamps and delete (X) button. Fetch `GET /api/admin/tenants/:id/notes`, post with `POST /api/admin/tenants/:id/notes`, delete with `DELETE /api/admin/tenants/:id/notes/:noteId`.

**Step 3: Add Plan Pricing Editor modal**

Next to the current pricing display in billing section, add an "Edit Pricing" button. Opens a modal with fields: price, billing cycle. Calls `PUT /api/admin/plan-pricing/:id`. Refresh after save.

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantDetail.jsx
git commit -m "feat: tenant detail — feature flags, notes, plan pricing editor"
```

---

## Task 13: AdminEmails.jsx — Delete, Send Now, Purge, Broadcasts Tab

**Files:**
- Modify: `frontend/src/pages/admin/AdminEmails.jsx`

**Step 1: Add action buttons per row**

In the Actions column, add:
- **Delete** (red trash icon) — visible for pending + failed emails. Calls `DELETE /api/admin/email-queue/:id`.
- **Send Now** (blue send icon) — visible for pending only. Calls `POST /api/admin/email-queue/:id/send-now`.
- Existing **Retry** button stays for failed emails.

**Step 2: Add Purge button in header**

Next to the filter tabs, add a "Purge Deleted Tenants" button. Calls `DELETE /api/admin/email-queue/purge-deleted`. Show count in success message.

**Step 3: Add Broadcasts tab**

Add a new tab "Broadcasts" alongside All/Pending/Sent/Failed. When selected, fetch `GET /api/admin/broadcast-history` and show a table: Time, Admin, Type, Subject, Recipients.

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminEmails.jsx
git commit -m "feat: email queue — delete, send now, purge, broadcasts tab"
```

---

## Task 14: AdminSupportTickets.jsx — Delete, Reply, Badge

**Files:**
- Modify: `frontend/src/pages/admin/AdminSupportTickets.jsx`

**Step 1: Add delete button**

Add a red trash icon button per ticket row. Calls `DELETE /api/admin/support-tickets/:tenantId/:ticketId`. Confirm with `window.confirm("Delete this ticket?")`.

**Step 2: Add reply functionality**

Add a "Reply" button per ticket row (visible for open/acknowledged tickets). On click, expand an inline text input below the ticket row. On submit, calls `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` with `{ reply }`. Show existing `admin_reply` in the expanded details if present.

**Step 3: Show admin_reply and replied_at in expanded ticket details**

When a ticket is expanded and has `admin_reply`, show it in the details panel:
```
Admin Reply: [reply text]
Replied: [timestamp]
```

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminSupportTickets.jsx
git commit -m "feat: support tickets — delete, reply, show admin reply in details"
```

---

## Task 15: Announcement Banner on Tenant Dashboard

**Files:**
- Modify: `frontend/src/pages/dashboard/` (or `frontend/src/pages/redesign/DashboardRedesign.jsx` — whichever renders the tenant dashboard)
- Or modify: `frontend/src/App.jsx` layout wrapper to show banner globally

**Step 1: Create AnnouncementBanner component**

Create a small component that fetches `GET /api/announcements/active` on mount and renders a dismissible banner at the top. Colors: blue=info, amber=warning, red=maintenance. Dismiss saves to sessionStorage so it doesn't reappear until next session.

**Step 2: Mount in AppLayoutRedesign.jsx**

Add `<AnnouncementBanner />` at the top of the main content area, above `<Outlet />`. This way it appears on every authenticated page.

**Step 3: Add announcement management to admin dashboard**

Add an "Announcements" card on admin dashboard with:
- Current active announcements list
- "New Announcement" button → form with message, type, optional end time
- "Deactivate" button per announcement

**Step 4: Commit**

```bash
git add frontend/src/ui/AnnouncementBanner.jsx frontend/src/pages/redesign/AppLayoutRedesign.jsx frontend/src/pages/admin/AdminDashboard.jsx
git commit -m "feat: announcement banner system — admin management + tenant display"
```

---

## Task 16: Tenant-Side "My Tickets" Page

**Files:**
- Create: `frontend/src/pages/redesign/MyTicketsRedesign.jsx`
- Modify: `frontend/src/App.jsx` (add route)
- Modify: `frontend/src/ui/nav-config.js` (add nav entry)

**Step 1: Create MyTicketsRedesign.jsx**

Page showing the current employee's submitted support tickets. Fetches `GET /api/support/tickets` (already exists). Table: Type, Message, Status, Admin Reply, Created. No actions needed — view-only.

Use `PageShell` with title "My Tickets". Pattern: reference any existing `*Redesign.jsx` page.

**Step 2: Add route to App.jsx**

Add inside the authenticated routes:
```jsx
<Route path="my-tickets" element={<MyTicketsRoute />} />
```

With the lazy import and thin route wrapper.

**Step 3: Add to nav-config.js**

Add a nav entry under a relevant section (e.g., near Profile or at the bottom):
```js
{ name: "My Tickets", path: "/my-tickets", icon: MessageSquare }
```

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/MyTicketsRedesign.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat: tenant-side My Tickets page — view submitted support tickets + admin replies"
```

---

## Task 17: CSV Export Buttons

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx`
- Modify: `frontend/src/pages/admin/AdminEmails.jsx`
- Modify: `frontend/src/pages/admin/AdminActivity.jsx`
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx`

**Step 1: Add CSV export to each page**

Import `downloadCsv` from `../../utils/csvExport.js`. Add a download button (use `Download` icon from lucide-react) in the header of each page. On click, call `downloadCsv(headers, rows, filename)` with the currently displayed/filtered data.

- **Tenant List:** headers = Name, Slug, Plan, Status, Revenue, Created
- **Email Queue:** headers = ID, Type, Tenant, To, Subject, Status, Attempts, Time
- **Activity Log:** headers = Time, Admin/Tenant, Action, Target, Details
- **Payment History (tenant detail):** headers = Date, Amount, Plan, Method, Reference

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantList.jsx frontend/src/pages/admin/AdminEmails.jsx frontend/src/pages/admin/AdminActivity.jsx frontend/src/pages/admin/AdminTenantDetail.jsx
git commit -m "feat: CSV export buttons on admin tenant list, emails, activity, payments"
```

---

## Task 18: Final Integration + Run Migration on Production

**Step 1: Test locally**

Start backend (`cd backend && npm start`) and frontend (`cd frontend && npm run dev`). Verify:
- Migration v12 applies cleanly
- Tax Rates shows in sidebar
- Activity page loads with 3 tabs
- Dashboard shows all new cards
- Email queue has delete/send now/purge buttons
- Tenant detail has Feature Flags + Notes + Pricing editor
- Support tickets have delete + reply
- My Tickets page works from tenant side
- Announcement banner shows on tenant dashboard
- CSV export works on all pages
- Worker status shows correctly

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes from local testing"
```

**Step 3: Push to production**

```bash
git push origin main
```

Railway auto-deploys. After deploy:
- Set `CLEANUP_WORKER_ENABLED=1` on Railway env vars
- Migration v12 runs on next boot (migrate-pg.js is called on startup)
- Verify at `sanopos.com/admin`

**Step 4: Final commit — update CLAUDE.md**

Update the root `CLAUDE.md` and `backend/CLAUDE.md` to document:
- Migration v12 description
- New admin routes
- New frontend pages
- Worker heartbeat pattern
- Cleanup worker env var

```bash
git add CLAUDE.md backend/CLAUDE.md
git commit -m "docs: update CLAUDE.md for super admin enhancement (migration v12, new routes, new pages)"
```

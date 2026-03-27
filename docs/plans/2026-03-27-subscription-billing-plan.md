# Subscription Billing Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable manual subscription billing so admins can record payments, enforce plan expiry with grace periods, and let tenants request upgrades — all without a payment gateway.

**Architecture:** 4 new tables + 4 new columns in master schema (migration v7 + master-db-pg.js DDL). New `routes/billing.js` for tenant-facing endpoints. Admin billing endpoints added to existing `routes/admin.js`. One new frontend page (`BillingRedesign.jsx`) plus enhancements to 3 admin pages.

**Tech Stack:** React 19, Express v5, PostgreSQL, existing multi-tenant infrastructure.

---

### Task 1: Migration v7 + Master Schema — Billing Tables & Columns

**Files:**
- Modify: `backend/master-db-pg.js:5-57` (add tables + columns to MASTER_SCHEMA)
- Modify: `backend/migrate-pg.js:137` (add v7 migration for existing databases)

**Step 1: Update MASTER_SCHEMA in master-db-pg.js**

In `backend/master-db-pg.js`, find the `tenants` table definition. Add 4 new columns after the `trial_ends_at` line (around line 16):

```sql
  billing_cycle          TEXT,
  plan_expires_at        TIMESTAMPTZ,
  grace_ends_at          TIMESTAMPTZ,
  payment_status         TEXT DEFAULT 'active',
```

Then add 3 new CREATE TABLE statements after the `tenant_refresh_tokens` table (around line 55, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS plan_pricing (
  id            SERIAL PRIMARY KEY,
  plan          TEXT NOT NULL,
  cycle         TEXT NOT NULL,
  price         NUMERIC(12,2) NOT NULL,
  currency_code TEXT DEFAULT 'PKR',
  is_active     BOOLEAN DEFAULT true,
  UNIQUE(plan, cycle)
);

INSERT INTO plan_pricing (plan, cycle, price) VALUES
  ('starter', 'monthly', 3000),
  ('starter', 'annual', 30000),
  ('pro', 'monthly', 8000),
  ('pro', 'annual', 80000)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_records (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency_code   TEXT DEFAULT 'PKR',
  plan            TEXT NOT NULL,
  cycle           TEXT NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  payment_method  TEXT,
  reference_note  TEXT,
  recorded_by     TEXT,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS upgrade_requests (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  requested_plan  TEXT NOT NULL,
  requested_cycle TEXT NOT NULL,
  message         TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
```

**Step 2: Add migration v7 to migrate-pg.js**

In `backend/migrate-pg.js`, replace the comment `// Future migrations go here (next: version 7):` with:

```javascript
  {
    version: 7,
    description: "Add billing tables and columns to master schema",
    up: async (client) => {
      await client.query(`
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'active';

        CREATE TABLE IF NOT EXISTS plan_pricing (
          id            SERIAL PRIMARY KEY,
          plan          TEXT NOT NULL,
          cycle         TEXT NOT NULL,
          price         NUMERIC(12,2) NOT NULL,
          currency_code TEXT DEFAULT 'PKR',
          is_active     BOOLEAN DEFAULT true,
          UNIQUE(plan, cycle)
        );

        INSERT INTO plan_pricing (plan, cycle, price) VALUES
          ('starter', 'monthly', 3000),
          ('starter', 'annual', 30000),
          ('pro', 'monthly', 8000),
          ('pro', 'annual', 80000)
        ON CONFLICT DO NOTHING;

        CREATE TABLE IF NOT EXISTS payment_records (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          amount          NUMERIC(12,2) NOT NULL,
          currency_code   TEXT DEFAULT 'PKR',
          plan            TEXT NOT NULL,
          cycle           TEXT NOT NULL,
          period_start    TIMESTAMPTZ NOT NULL,
          period_end      TIMESTAMPTZ NOT NULL,
          payment_method  TEXT,
          reference_note  TEXT,
          recorded_by     TEXT,
          recorded_at     TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS upgrade_requests (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          requested_plan  TEXT NOT NULL,
          requested_cycle TEXT NOT NULL,
          message         TEXT,
          status          TEXT DEFAULT 'pending',
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          resolved_at     TIMESTAMPTZ,
          resolved_by     TEXT
        );
      `);
    },
  },
  // Future migrations go here (next: version 8):
```

**Important:** Migration v7 runs against the **public schema** only (these are master tables, not tenant tables). The `migrateAllTenants()` function will attempt to run it in tenant schemas too, but the `IF NOT EXISTS` / `ON CONFLICT` guards make this safe — `tenants` table doesn't exist in tenant schemas so the ALTER TABLE will simply fail and the migration will be recorded.

Actually — this is a problem. The ALTER TABLE on `tenants` will fail in tenant schemas because `tenants` doesn't exist there. We need to handle this. Wrap the tenants ALTER in a DO block:

```javascript
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'active';
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$;
      `);
```

Use the same `DO $$ ... EXCEPTION WHEN undefined_table` pattern for the `payment_records`, `upgrade_requests` table FKs (they reference `tenants(id)` which won't exist in tenant schemas). Actually simpler: just skip the FK constraint in the migration and keep it only in master-db-pg.js DDL. Or better: wrap each CREATE TABLE in its own exception block.

The cleanest approach: since these tables only make sense in the public schema, check if `tenants` table exists before proceeding:

```javascript
    up: async (client) => {
      // These tables only exist in public schema — skip if tenants table doesn't exist
      const { rows } = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' LIMIT 1"
      );
      if (!rows.length) return; // Skip for tenant schemas

      await client.query(`
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'active';

        CREATE TABLE IF NOT EXISTS plan_pricing (
          id            SERIAL PRIMARY KEY,
          plan          TEXT NOT NULL,
          cycle         TEXT NOT NULL,
          price         NUMERIC(12,2) NOT NULL,
          currency_code TEXT DEFAULT 'PKR',
          is_active     BOOLEAN DEFAULT true,
          UNIQUE(plan, cycle)
        );

        INSERT INTO plan_pricing (plan, cycle, price) VALUES
          ('starter', 'monthly', 3000),
          ('starter', 'annual', 30000),
          ('pro', 'monthly', 8000),
          ('pro', 'annual', 80000)
        ON CONFLICT DO NOTHING;

        CREATE TABLE IF NOT EXISTS payment_records (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          amount          NUMERIC(12,2) NOT NULL,
          currency_code   TEXT DEFAULT 'PKR',
          plan            TEXT NOT NULL,
          cycle           TEXT NOT NULL,
          period_start    TIMESTAMPTZ NOT NULL,
          period_end      TIMESTAMPTZ NOT NULL,
          payment_method  TEXT,
          reference_note  TEXT,
          recorded_by     TEXT,
          recorded_at     TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS upgrade_requests (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          requested_plan  TEXT NOT NULL,
          requested_cycle TEXT NOT NULL,
          message         TEXT,
          status          TEXT DEFAULT 'pending',
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          resolved_at     TIMESTAMPTZ,
          resolved_by     TEXT
        );
      `);
    },
```

**Step 3: Commit**

```bash
git add backend/master-db-pg.js backend/migrate-pg.js
git commit -m "feat: migration v7 — billing tables (plan_pricing, payment_records, upgrade_requests)"
```

---

### Task 2: Admin Billing Endpoints — Pricing + Record Payment + History

**Files:**
- Modify: `backend/routes/admin.js` (add endpoints after last endpoint, ~line 808)

**Step 1: Add plan pricing endpoints**

In `backend/routes/admin.js`, add before the closing `};` of the module.exports function:

```javascript
  // ── Billing: Plan Pricing ──────────────────────────────────────────────
  app.get("/api/admin/plan-pricing", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM plan_pricing ORDER BY plan, cycle");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/plan-pricing/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { price, is_active } = req.body;
      const { rows: [row] } = await db.query(
        "UPDATE plan_pricing SET price = COALESCE($1, price), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *",
        [price, is_active, req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Pricing row not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Add record payment endpoint**

```javascript
  // ── Billing: Record Payment ────────────────────────────────────────────
  app.post("/api/admin/tenants/:id/record-payment", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { plan, cycle, amount, payment_method, reference_note } = req.body;
      if (!plan || !cycle || !amount) {
        return res.status(400).json({ error: "plan, cycle, and amount are required" });
      }

      const tenant = await masterDb.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const periodDays = cycle === "annual" ? 365 : 30;
      const now = new Date();
      const periodEnd = new Date(now.getTime() + periodDays * 86400000);
      const graceEnd = new Date(periodEnd.getTime() + 7 * 86400000);

      // Update tenant plan + billing fields
      const planDefaults = PLAN_DEFAULTS[plan] || {};
      await db.query(
        `UPDATE tenants SET
           plan = $1, billing_cycle = $2,
           plan_expires_at = $3, grace_ends_at = $4, payment_status = 'active',
           max_employees = COALESCE($5, max_employees),
           max_outlets = COALESCE($6, max_outlets),
           max_products = COALESCE($7, max_products),
           updated_at = NOW()
         WHERE id = $8`,
        [plan, cycle, periodEnd, graceEnd, planDefaults.max_employees, planDefaults.max_outlets, planDefaults.max_products, tenant.id]
      );

      // Insert payment record
      await db.query(
        `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, reference_note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tenant.id, amount, plan, cycle, now, periodEnd, payment_method || null, reference_note || null, req.admin.email]
      );

      await auditLog(tenant.id, "payment_recorded", { plan, cycle, amount, payment_method, reference_note }, `admin:${req.admin.email}`);

      res.json({ ok: true, plan, cycle, plan_expires_at: periodEnd, grace_ends_at: graceEnd });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Add payment history endpoint**

```javascript
  // ── Billing: Payment History ───────────────────────────────────────────
  app.get("/api/admin/tenants/:id/payments", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM payment_records WHERE tenant_id = $1 ORDER BY recorded_at DESC",
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Add upgrade requests endpoints**

```javascript
  // ── Billing: Upgrade Requests ──────────────────────────────────────────
  app.get("/api/admin/upgrade-requests", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT ur.*, t.slug, t.name AS tenant_name, t.plan AS current_plan
         FROM upgrade_requests ur
         JOIN tenants t ON ur.tenant_id = t.id
         WHERE ur.status = 'pending'
         ORDER BY ur.created_at ASC`
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/upgrade-requests/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { status } = req.body; // 'approved' or 'dismissed'
      if (!["approved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "status must be 'approved' or 'dismissed'" });
      }
      const { rows: [row] } = await db.query(
        "UPDATE upgrade_requests SET status = $1, resolved_at = NOW(), resolved_by = $2 WHERE id = $3 RETURNING *",
        [status, req.admin.email, req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Request not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 5: Add billing attention endpoint**

```javascript
  // ── Billing: Attention ─────────────────────────────────────────────────
  app.get("/api/admin/billing-attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString();

      const { rows: dueSoon } = await db.query(
        `SELECT id, slug, name, plan, plan_expires_at FROM tenants
         WHERE status = 'active' AND plan != 'free'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at > $1 AND plan_expires_at <= $2`,
        [now, sevenDaysOut]
      );

      const { rows: overdue } = await db.query(
        `SELECT id, slug, name, plan, plan_expires_at, grace_ends_at FROM tenants
         WHERE status = 'active' AND plan != 'free'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at < $1 AND (grace_ends_at IS NULL OR grace_ends_at > $1)`,
        [now]
      );

      const { rows: pastGrace } = await db.query(
        `SELECT id, slug, name, plan, grace_ends_at FROM tenants
         WHERE status = 'active' AND plan != 'free'
           AND grace_ends_at IS NOT NULL AND grace_ends_at < $1`,
        [now]
      );

      const { rows: [{ count: pendingUpgrades }] } = await db.query(
        "SELECT COUNT(*) FROM upgrade_requests WHERE status = 'pending'"
      );

      res.json({ due_soon: dueSoon, overdue, past_grace: pastGrace, pending_upgrades: Number(pendingUpgrades) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 6: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: admin billing endpoints — pricing, record payment, history, upgrade requests, attention"
```

---

### Task 3: Tenant-Facing Billing Endpoints

**Files:**
- Create: `backend/routes/billing.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new route)

**Step 1: Create billing.js**

Create `backend/routes/billing.js`:

```javascript
/**
 * backend/routes/billing.js — Tenant-facing billing endpoints.
 *
 * GET  /api/billing/pricing  — Public, no auth. Returns active plan pricing.
 * GET  /api/billing/status   — Authenticated. Returns tenant's billing info.
 * POST /api/billing/request-upgrade — Authenticated. Submit upgrade request.
 */

module.exports = function registerBillingRoutes(app, deps) {
  const db = require("../db-pg");
  const masterDb = require("../master-db-pg");

  // ── Public: Plan Pricing ───────────────────────────────────────────────
  app.get("/api/billing/pricing", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Authenticated: Billing Status ──────────────────────────────────────
  app.get("/api/billing/status", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const { rows: pricing } = await db.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );

      // Filter upgrade options: only plans above current
      const planRank = { free: 0, starter: 1, pro: 2 };
      const currentRank = planRank[tenant.plan] || 0;
      const upgradeOptions = pricing.filter((p) => (planRank[p.plan] || 0) > currentRank);

      // Check for pending upgrade request
      const { rows: [pendingReq] } = await db.query(
        "SELECT id, requested_plan, requested_cycle, created_at FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
        [tenantId]
      );

      res.json({
        plan: tenant.plan,
        billing_cycle: tenant.billing_cycle || null,
        expires_at: tenant.plan_expires_at || null,
        grace_ends_at: tenant.grace_ends_at || null,
        payment_status: tenant.payment_status || "active",
        upgrade_options: upgradeOptions,
        pending_request: pendingReq || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Authenticated: Request Upgrade ─────────────────────────────────────
  app.post("/api/billing/request-upgrade", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const { plan, cycle, message } = req.body;
      if (!plan || !cycle) return res.status(400).json({ error: "plan and cycle are required" });
      if (!["starter", "pro"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
      if (!["monthly", "annual"].includes(cycle)) return res.status(400).json({ error: "Invalid cycle" });

      // Check for existing pending request
      const { rows: existing } = await db.query(
        "SELECT id FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending'",
        [tenantId]
      );
      if (existing.length) {
        return res.status(409).json({ error: "You already have a pending upgrade request" });
      }

      await db.query(
        `INSERT INTO upgrade_requests (tenant_id, requested_plan, requested_cycle, message)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, plan, cycle, message || null]
      );

      res.json({ ok: true, message: "Upgrade request submitted. We'll be in touch shortly." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Mount billing routes in registerAllRoutes.js**

In `backend/routes/registerAllRoutes.js`, find the section where routes are mounted. Add after the couriers import (search for `require("./couriers")`) or after the last route import before the closing of the function:

```javascript
  // --- ROUTES: BILLING ---
  require("./billing")(app, deps);
```

**Important:** The `/api/billing/pricing` endpoint must be accessible without auth. It's mounted after the tenant middleware, but since it doesn't use `req.tenantId`, it will work fine — the middleware only blocks if auth fails, not if tenant context is missing for public routes. Check that the pricing endpoint doesn't require auth by confirming the route is not wrapped in `requireAuth`. If it is, mount the pricing endpoint before the auth middleware in `registerAllRoutes.js` (similar to how `/api/setup/*` is mounted).

Actually, to be safe, mount the public pricing endpoint in the pre-auth section of registerAllRoutes.js. Find where `/api/setup` is mounted (before auth middleware) and add:

```javascript
  // Public billing pricing (no auth needed)
  app.get("/api/billing/pricing", async (req, res) => {
    try {
      const db = require("../db-pg");
      const { rows } = await db.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

Then remove the duplicate from `billing.js`.

**Step 3: Commit**

```bash
git add backend/routes/billing.js backend/routes/registerAllRoutes.js
git commit -m "feat: tenant-facing billing endpoints — pricing, status, upgrade requests"
```

---

### Task 4: Admin Tenant List — Billing Columns

**Files:**
- Modify: `backend/routes/admin.js` (update GET /api/admin/tenants to include billing fields)
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx` (add Expires + Payment Status columns)

**Step 1: Update admin tenants list query**

In `backend/routes/admin.js`, find the `GET /api/admin/tenants` endpoint. The SELECT query for tenants should already include `plan` and `status`. Add `billing_cycle, plan_expires_at, grace_ends_at, payment_status` to the SELECT.

Find the query (looks like `SELECT id, slug, name, plan, status, ...`) and add the new columns.

**Step 2: Add columns to AdminTenantList.jsx**

In `frontend/src/pages/admin/AdminTenantList.jsx`, find the table header row (around line 133-142). Add after the "Status" column header:

```jsx
                <th className="px-4 py-3 font-semibold text-slate-500">Payment</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Expires</th>
```

In the table body row, add matching cells after the status cell. Use the existing date formatting pattern in the file. For payment status, use colored badges:

```jsx
                  <td className="px-4 py-3">
                    {t.plan !== "free" ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        t.payment_status === "active" ? "bg-emerald-100 text-emerald-700" :
                        t.payment_status === "overdue" ? "bg-red-100 text-red-700" :
                        t.payment_status === "due" ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-500"
                      }`}>{t.payment_status || "active"}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {t.plan_expires_at ? new Date(t.plan_expires_at).toLocaleDateString() : "—"}
                  </td>
```

**Step 3: Commit**

```bash
git add backend/routes/admin.js frontend/src/pages/admin/AdminTenantList.jsx
git commit -m "feat: billing columns in admin tenant list (payment status + expiry)"
```

---

### Task 5: Admin Tenant Detail — Billing Section + Record Payment

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx` (add billing section + record payment modal)

**Step 1: Add billing state**

Add state variables near the top of the component:

```javascript
const [payments, setPayments] = useState([]);
const [showPaymentModal, setShowPaymentModal] = useState(false);
const [paymentForm, setPaymentForm] = useState({ plan: "", cycle: "monthly", amount: "", payment_method: "bank_transfer", reference_note: "" });
const [upgradeRequests, setUpgradeRequests] = useState([]);
```

**Step 2: Fetch billing data**

In the existing useEffect that fetches tenant data, add fetches for payments and upgrade requests:

```javascript
// After fetching tenant detail
adminFetch(`/api/admin/tenants/${id}/payments`).then(r => r.json()).then(setPayments).catch(() => {});
adminFetch(`/api/admin/upgrade-requests`).then(r => r.json()).then(reqs => {
  setUpgradeRequests(reqs.filter(r => r.tenant_id === Number(id)));
}).catch(() => {});
```

**Step 3: Add billing section UI**

Insert a new panel after the Setup Status panel and before the Actions panel. Include:

- Current billing info: plan, cycle, expires_at, payment_status
- "Record Payment" button that opens the modal
- Payment history table (date, amount, method, reference, recorded_by)
- Pending upgrade request banner with approve/dismiss buttons

The payment modal should have:
- Plan dropdown (starter/pro)
- Cycle toggle (monthly/annual)
- Amount field (pre-fill from plan_pricing when plan+cycle changes)
- Payment method dropdown (bank_transfer, jazzcash, cash, other)
- Reference note text input
- Submit button

Fetch plan pricing on modal open: `GET /api/admin/plan-pricing`

On submit: `POST /api/admin/tenants/${id}/record-payment` with the form data. On success, refresh tenant data and payments list.

For upgrade request approve/dismiss: `PUT /api/admin/upgrade-requests/${id}` with `{ status: "approved" }` or `{ status: "dismissed" }`.

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantDetail.jsx
git commit -m "feat: admin tenant detail billing section with record payment modal"
```

---

### Task 6: Admin Dashboard — Billing Attention Card

**Files:**
- Modify: `frontend/src/pages/admin/AdminDashboard.jsx` (add billing attention card)

**Step 1: Add billing attention state and fetch**

Add state: `const [billingAttention, setBillingAttention] = useState(null);`

Fetch in useEffect: `adminFetch("/api/admin/billing-attention").then(r => r.json()).then(setBillingAttention).catch(() => {});`

**Step 2: Add billing attention card**

Insert after the existing "Needs Attention" panel (around line 382) and before the Infrastructure Panel:

```jsx
          {/* Billing Attention */}
          {billingAttention && (billingAttention.due_soon.length > 0 || billingAttention.overdue.length > 0 || billingAttention.past_grace.length > 0 || billingAttention.pending_upgrades > 0) && (
            <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-800">Billing Attention</h2>
              <div className="space-y-3">
                {billingAttention.past_grace.length > 0 && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm font-semibold text-red-700">{billingAttention.past_grace.length} tenant(s) past grace period — should be suspended</p>
                    {billingAttention.past_grace.map(t => (
                      <a key={t.id} href={`/admin/tenants/${t.id}`} className="block text-sm text-red-600 hover:underline mt-1">{t.name} ({t.slug})</a>
                    ))}
                  </div>
                )}
                {billingAttention.overdue.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <p className="text-sm font-semibold text-amber-700">{billingAttention.overdue.length} tenant(s) overdue — in grace period</p>
                    {billingAttention.overdue.map(t => (
                      <a key={t.id} href={`/admin/tenants/${t.id}`} className="block text-sm text-amber-600 hover:underline mt-1">{t.name} ({t.slug})</a>
                    ))}
                  </div>
                )}
                {billingAttention.due_soon.length > 0 && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                    <p className="text-sm font-semibold text-blue-700">{billingAttention.due_soon.length} tenant(s) expiring within 7 days</p>
                  </div>
                )}
                {billingAttention.pending_upgrades > 0 && (
                  <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
                    <p className="text-sm font-semibold text-purple-700">{billingAttention.pending_upgrades} pending upgrade request(s)</p>
                  </div>
                )}
              </div>
            </div>
          )}
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/AdminDashboard.jsx
git commit -m "feat: billing attention card on admin dashboard"
```

---

### Task 7: Tenant Billing Page

**Files:**
- Create: `frontend/src/pages/redesign/BillingRedesign.jsx`
- Create: `frontend/src/pages/BillingRoute.jsx` (thin wrapper)
- Modify: `frontend/src/App.jsx` (add route)
- Modify: `frontend/src/ui/nav-config.js` (add nav entry)

**Step 1: Create BillingRedesign.jsx**

Create `frontend/src/pages/redesign/BillingRedesign.jsx` — a page with two cards:

**Card 1 — Current Plan:** Shows plan name + badge, billing cycle, expiry date, payment status. For free plan: upgrade CTA message.

**Card 2 — Upgrade Options:** Monthly/annual toggle, plan cards with prices, "Request Upgrade" button. If pending request exists, show "Upgrade request pending" badge instead.

Use `PageShell` with `title="Billing"`. Fetch from `GET /api/billing/status` on mount. Use `useCurrency()` for formatting if available, otherwise format manually with PKR.

The upgrade modal: simple form with optional message textarea. Submit to `POST /api/billing/request-upgrade`. On success, show toast and refresh status.

**Step 2: Create BillingRoute.jsx**

Create `frontend/src/pages/BillingRoute.jsx`:

```jsx
import BillingRedesign from './redesign/BillingRedesign';
export default function BillingRoute() { return <BillingRedesign />; }
```

**Step 3: Add route to App.jsx**

Add lazy import near the top with the other lazy imports:

```javascript
const BillingRoute = lazy(() => import("./pages/BillingRoute"));
```

Add route inside the authenticated route group (inside `<RequireAuth><RequireContext><AppLayoutRedesign />`):

```jsx
<Route path="/billing" element={<BillingRoute />} />
```

**Step 4: Add nav entry**

In `frontend/src/ui/nav-config.js`, add a "Billing" entry to the nav. Find an appropriate group (likely near Settings/Admin) and add:

```javascript
{ name: "Billing", path: "/billing", icon: CreditCard },
```

Import `CreditCard` from lucide-react if not already imported.

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/BillingRedesign.jsx frontend/src/pages/BillingRoute.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat: tenant-facing billing page with plan info and upgrade requests"
```

---

### Task 8: Landing Page — Live Pricing

**Files:**
- Modify: `frontend/src/pages/LandingPage.jsx` (fetch prices from API, replace "Contact Us")

**Step 1: Fetch pricing data**

In `LandingPage.jsx`, add a state for pricing and fetch on mount:

```javascript
const [livePricing, setLivePricing] = useState(null);
useEffect(() => {
  fetch(`${API}/api/billing/pricing`)
    .then(r => r.json())
    .then(setLivePricing)
    .catch(() => {}); // Graceful fallback to hardcoded
}, []);
```

**Step 2: Update PLANS rendering**

In the pricing section, update the price display. Find where `price` is rendered and replace with live data:

```javascript
// Helper to get price from API data
function getPlanPrice(planName, cycle = "monthly") {
  if (planName === "Free") return "Free";
  if (!livePricing) return "Contact Us"; // Fallback while loading
  const match = livePricing.find(p => p.plan === planName.toLowerCase() && p.cycle === cycle);
  return match ? `PKR ${Number(match.price).toLocaleString()}/mo` : "Contact Us";
}
```

Use this function where price is displayed in the pricing cards. Show monthly price by default with a note about annual savings.

**Step 3: Commit**

```bash
git add frontend/src/pages/LandingPage.jsx
git commit -m "feat: landing page shows live pricing from API instead of 'Contact Us'"
```

---

## Task Dependency Order

```
Task 1 (migration v7) — no dependencies, must be first
Task 2 (admin endpoints) — depends on Task 1
Task 3 (tenant endpoints) — depends on Task 1
Task 4 (admin tenant list UI) — depends on Task 2
Task 5 (admin tenant detail UI) — depends on Task 2
Task 6 (admin dashboard card) — depends on Task 2
Task 7 (tenant billing page) — depends on Task 3
Task 8 (landing page pricing) — depends on Task 3
```

Tasks 2+3 can run in parallel after Task 1. Tasks 4+5+6 can run in parallel after Task 2. Tasks 7+8 can run in parallel after Task 3.

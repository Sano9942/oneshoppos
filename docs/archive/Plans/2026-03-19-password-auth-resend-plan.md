# Password Auth + Resend Email + Forgot Password — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace PIN-based dashboard login with password-based login, add Resend as system email service, and implement forgot-password flow with reset emails.

**Architecture:** Add `password_hash` and `email` columns to employees table via Postgres migration v3. Modify `/api/auth/login` and `/api/auth/mt-login` to accept passwords with graceful PIN fallback. New Resend utility for system-level transactional emails. New public endpoints for forgot-password and reset-password flows. Frontend: replace PIN field with password field on login form, add forgot-password modal, reset-password page, and password management actions on employees page.

**Tech Stack:** bcryptjs (existing), resend (new npm package), React 19 + Vite + Tailwind v4

---

### Task 1: Database Migration (v3)

**Files:**
- Modify: `backend/migrate-pg.js:47` (add migration v3 to MIGRATIONS array)
- Modify: `backend/schema-pg.sql` (add columns + table to DDL for new tenant provisioning)

**Step 1: Add migration v3 to migrate-pg.js**

In `backend/migrate-pg.js`, replace the comment at line 47:
```js
// Future migrations go here (next: version 3):
```

With:
```js
  {
    version: 3,
    description: "Add password_hash, email to employees + password_reset_tokens table",
    up: async (client) => {
      await client.query(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;

        -- email unique index (partial — only non-null values)
        CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique
          ON employees (email) WHERE email IS NOT NULL;

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id          SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          token_hash  TEXT NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          used_at     TIMESTAMPTZ
        );
      `);
    },
  },
  // Future migrations go here (next: version 4):
```

**Step 2: Update schema-pg.sql for new tenant schemas**

Add to the `employees` CREATE TABLE (after `tokens_revoked_before` column, line 82):
```sql
  email TEXT,
  password_hash TEXT
```

Add after the employees table definition (after line 83):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique ON employees (email) WHERE email IS NOT NULL;
```

Add new table (after `revoked_tokens` table, around line 1100):
```sql
-- ── Password Reset Tokens ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
```

**Step 3: Run migration locally to verify**

Run: `cd backend && node -e "require('dotenv').config(); const db = require('./db-pg'); require('./migrate-pg').migrate(db).then(() => { console.log('OK'); db.end(); }).catch(e => { console.error(e); process.exit(1); })"`

Expected: `[migrate-pg] v3: Add password_hash, email to employees + password_reset_tokens table` then `applied`

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat: migration v3 — add password_hash, email to employees + password_reset_tokens table"
```

---

### Task 2: Install Resend + Create Email Utility

**Files:**
- Modify: `backend/package.json` (add resend dependency)
- Create: `backend/utils/resendEmail.js`

**Step 1: Install resend package**

Run: `cd backend && npm install resend`

**Step 2: Create resendEmail.js utility**

Create `backend/utils/resendEmail.js`:
```js
const { Resend } = require("resend");

let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM =
  process.env.RESEND_FROM_EMAIL || "SanoPOS <onboarding@resend.dev>";

async function sendPasswordResetEmail({
  toEmail,
  employeeName,
  resetLink,
  storeName,
}) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Reset your password — ${storeName || "SanoPOS"}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#059669;margin-bottom:16px">Password Reset</h2>
        <p>Hi ${employeeName},</p>
        <p>We received a request to reset your password for <strong>${storeName || "SanoPOS"}</strong>.</p>
        <p style="margin:24px 0">
          <a href="${resetLink}"
             style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Reset Password
          </a>
        </p>
        <p style="color:#64748b;font-size:14px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
      </div>
    `,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

module.exports = { sendPasswordResetEmail };
```

**Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/utils/resendEmail.js
git commit -m "feat: add Resend email utility for system transactional emails"
```

---

### Task 3: Backend Auth — Password Login + Forgot/Reset Endpoints

**Files:**
- Modify: `backend/routes/auth.js` (update login + mt-login, add forgot-password + reset-password)

**Step 1: Update single-tenant login (lines 5-54)**

In `backend/routes/auth.js`, replace the `POST /api/auth/login` handler (lines 5-54) with a version that accepts `password` alongside `pin`:

```js
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { username, pin, password } = req.body || {};
    if (!username || (!pin && !password)) {
      return res.status(400).json({ error: "username and password (or pin) are required" });
    }

    try {
      const { rows: [employee] } = await db.query(
        `SELECT e.id, e.name, e.role_id, e.pin_code, e.pin_hash, e.password_hash, r.name as role, NULL as outlet_id
         FROM employees e
         LEFT JOIN roles r ON e.role_id = r.id
         WHERE LOWER(e.name) = LOWER($1) AND e.deleted_at IS NULL`,
        [String(username).trim()]
      );

      if (!employee) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      let valid = false;

      if (password) {
        // Password auth — only works if password_hash is set
        if (employee.password_hash) {
          valid = await bcrypt.compare(String(password).trim(), employee.password_hash);
        }
      } else if (pin) {
        // PIN auth — only if no password_hash set (graceful fallback)
        if (employee.password_hash) {
          return res.status(401).json({ error: "Please use your password to log in" });
        }
        if (employee.pin_hash) {
          valid = await bcrypt.compare(String(pin).trim(), employee.pin_hash);
        } else if (employee.pin_code) {
          valid = String(pin).trim() === String(employee.pin_code).trim();
        }
      }

      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const { rows: permRows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [employee.role_id || 3]
      );
      const permissions = (permRows || []).map(r => r.permission);

      return res.json({
        employee: {
          id: employee.id,
          name: employee.name,
          role_id: employee.role_id,
          outlet_id: employee.outlet_id || null,
        },
        permissions,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Update mt-login (lines 168-261)**

In the `POST /api/auth/mt-login` handler, make these changes:

a) Line 169 — destructure `password` from body:
```js
const { tenant_slug, username, pin, password } = req.body || {};
```

b) Line 170 — update validation:
```js
if (!tenant_slug || !username || (!pin && !password)) {
  return res.status(400).json({ error: "tenant_slug, username, and password (or pin) are required" });
}
```

c) Line 192 — add `password_hash` to SELECT:
```js
const { rows: [employee] } = await tenantDb.query(
  `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, e.password_hash
   FROM employees e
   WHERE LOWER(e.name) = LOWER($1) AND e.deleted_at IS NULL`,
  [String(username).trim()]
);
```

d) Lines 201-210 — replace PIN verification with dual auth logic:
```js
      // 3. Verify credentials
      let valid = false;
      if (password) {
        if (employee.password_hash) {
          valid = await bcrypt.compare(String(password).trim(), employee.password_hash);
        }
      } else if (pin) {
        if (employee.password_hash) {
          return res.status(401).json({ error: "Please use your password to log in" });
        }
        if (employee.pin_hash) {
          valid = await bcrypt.compare(String(pin).trim(), employee.pin_hash);
        } else if (employee.pin_code) {
          valid = String(pin).trim() === String(employee.pin_code).trim();
        }
      }
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
```

**Step 3: Add forgot-password endpoint**

Add BEFORE the closing `};` of `registerAuthRoutes` (before line 451), but OUTSIDE the `if (MULTI_TENANT)` block:

```js
  // POST /api/auth/forgot-password — request password reset email
  const crypto = require("crypto");

  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const { username, store_code } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }

    // Generic response — never leak whether the user exists
    const okMsg = { message: "If an account with that username exists and has an email address, a reset link has been sent." };

    try {
      let tenantDb = db;
      let tenantSlug = null;
      let storeName = "SanoPOS";

      // Multi-tenant: resolve tenant DB
      if (process.env.MULTI_TENANT === "1") {
        if (!store_code) return res.json(okMsg);
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(store_code).trim()]
        );
        if (!tenant) return res.json(okMsg);
        tenantDb = await tenantDbMgr.getDb(tenant.id);
        tenantSlug = tenant.slug;
        storeName = tenant.name || "SanoPOS";
      }

      const { rows: [employee] } = await tenantDb.query(
        "SELECT id, name, email FROM employees WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL",
        [String(username).trim()]
      );

      if (!employee || !employee.email) return res.json(okMsg);

      // Generate token
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await tenantDb.query(
        "INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [employee.id, tokenHash, expiresAt]
      );

      // Build reset link
      const frontendUrl = process.env.CORS_ORIGIN || "http://localhost:5173";
      let resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;
      if (tenantSlug) resetLink += `&tenant=${tenantSlug}`;

      // Send email via Resend
      const { sendPasswordResetEmail } = require("../utils/resendEmail");
      await sendPasswordResetEmail({
        toEmail: employee.email,
        employeeName: employee.name,
        resetLink,
        storeName,
      });

      return res.json(okMsg);
    } catch (err) {
      console.error("[forgot-password]", err.message);
      // Still return generic message to avoid leaking info
      return res.json(okMsg);
    }
  });

  // POST /api/auth/reset-password — consume token, set new password
  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, new_password, store_code } = req.body || {};
    if (!token || !new_password) {
      return res.status(400).json({ error: "token and new_password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
      let tenantDb = db;

      if (process.env.MULTI_TENANT === "1") {
        if (!store_code) return res.status(400).json({ error: "store_code is required" });
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(store_code).trim()]
        );
        if (!tenant) return res.status(400).json({ error: "Invalid store code" });
        tenantDb = await tenantDbMgr.getDb(tenant.id);
      }

      // Find valid (unused, unexpired) tokens
      const { rows: tokens } = await tenantDb.query(
        "SELECT id, employee_id, token_hash FROM password_reset_tokens WHERE used_at IS NULL AND expires_at > NOW()"
      );

      // Check each token hash (bcrypt compare)
      let matchedToken = null;
      for (const t of tokens) {
        if (await bcrypt.compare(token, t.token_hash)) {
          matchedToken = t;
          break;
        }
      }

      if (!matchedToken) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      // Set new password
      const passwordHash = await bcrypt.hash(new_password, 10);
      await tenantDb.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2",
        [passwordHash, matchedToken.employee_id]
      );

      // Mark token as used
      await tenantDb.query(
        "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
        [matchedToken.id]
      );

      // Invalidate all existing sessions for this employee (security)
      await tenantDb.query(
        "UPDATE employees SET tokens_revoked_before = NOW() WHERE id = $1",
        [matchedToken.employee_id]
      );

      return res.json({ message: "Password has been reset successfully. Please log in with your new password." });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Commit**

```bash
git add backend/routes/auth.js
git commit -m "feat: password login with PIN fallback + forgot/reset-password endpoints"
```

---

### Task 4: Backend — Employee Password Management Endpoints

**Files:**
- Modify: `backend/routes/employees.js`

**Step 1: Update GET /api/employees to include email and has_password flag**

In `backend/routes/employees.js` line 44-46, update the query:
```js
const { rows } = await db.query(
  `SELECT e.id, e.name, e.pin_code, e.email, e.password_hash IS NOT NULL as has_password,
          e.salary_type, e.monthly_salary, e.hourly_rate, e.daily_rate, e.work_hours_per_day,
          r.name as role, e.role_id
   FROM employees e LEFT JOIN roles r ON e.role_id = r.id
   WHERE e.deleted_at IS NULL ORDER BY e.name ASC`
);
```

**Step 2: Update POST /api/employees to accept email and password**

In `backend/routes/employees.js` line 82, update destructuring:
```js
const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate, email, password } = req.body;
```

Line 84, add password hashing:
```js
const pin_hash = pin_code ? await bcrypt.hash(String(pin_code), 10) : null;
const password_hash = password ? await bcrypt.hash(String(password), 10) : null;
```

Lines 85-87, update INSERT:
```js
const { rows } = await db.query(
  `INSERT INTO employees (name, role_id, pin_code, pin_hash, salary_type, monthly_salary, hourly_rate, daily_rate, email, password_hash)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
  [name, role_id || 3, pin_code, pin_hash, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0), email || null, password_hash],
);
```

**Step 3: Update PUT /api/employees/:id to accept email**

In `backend/routes/employees.js` line 110, add `email` to destructuring:
```js
const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate, email } = req.body;
```

After the COALESCE SET clause (line 127), add email to the query:
Add `, email = COALESCE($${paramIdx++}, email)` to the SET clause and push `email !== undefined ? email : null` to params. Handle the case where `email` is explicitly set to `""` to clear it (set to NULL).

Specifically, after line 128 (params array), add:
```js
// email — allow clearing by sending empty string
if (email !== undefined) {
  query += `, email = $${paramIdx++}`;
  params.push(email === "" ? null : email);
}
```

**Step 4: Add set-password endpoint (admin sets password for any employee)**

Add after the `revoke-all-tokens` endpoint (after line 296):

```js
  // PUT /api/employees/:id/set-password — admin sets password for an employee
  app.put("/api/employees/:id/set-password", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
      const password_hash = await bcrypt.hash(String(password), 10);
      const { rowCount } = await db.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2 AND deleted_at IS NULL",
        [password_hash, Number(id)]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Employee not found" });

      // Log to action_history
      const actorId = Number(req.headers["x-employee-id"] || 0);
      try {
        await db.query(
          `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
           VALUES ('password_set', 'employee', $1, $2, $3)`,
          [Number(id), actorId, `Password set for employee #${id}`]
        );
      } catch { /* best-effort */ }

      res.json({ message: "Password set successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id/change-password — employee changes own password
  app.put("/api/employees/:id/change-password", async (req, res) => {
    const { id } = req.params;
    const actorId = Number(req.headers["x-employee-id"] || 0);

    // Only the employee themselves can change their password
    if (actorId !== Number(id)) {
      return res.status(403).json({ error: "You can only change your own password" });
    }

    const { current_password, pin, new_password } = req.body || {};
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    if (!current_password && !pin) {
      return res.status(400).json({ error: "current_password or pin is required for verification" });
    }

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, password_hash, pin_hash, pin_code FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      // Verify current credentials
      let verified = false;
      if (current_password && employee.password_hash) {
        verified = await bcrypt.compare(String(current_password), employee.password_hash);
      } else if (pin) {
        if (employee.pin_hash) {
          verified = await bcrypt.compare(String(pin), employee.pin_hash);
        } else if (employee.pin_code) {
          verified = String(pin).trim() === String(employee.pin_code).trim();
        }
      }
      if (!verified) {
        return res.status(401).json({ error: "Current credentials are incorrect" });
      }

      const password_hash = await bcrypt.hash(String(new_password), 10);
      await db.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2",
        [password_hash, Number(id)]
      );

      res.json({ message: "Password changed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/employees/:id/send-reset — admin sends password reset email
  app.post("/api/employees/:id/send-reset", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const crypto = require("crypto");

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, name, email FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });
      if (!employee.email) return res.status(400).json({ error: "Employee has no email address set" });

      // Generate token
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await db.query(
        "INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [employee.id, tokenHash, expiresAt]
      );

      // Build reset link
      const frontendUrl = process.env.CORS_ORIGIN || "http://localhost:5173";
      let resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

      // Get store name
      let storeName = "SanoPOS";
      try {
        const { rows: [co] } = await db.query("SELECT name FROM company_profile WHERE id = 1");
        if (co?.name) storeName = co.name;
      } catch { /* best-effort */ }

      // Add tenant slug for MT mode
      if (process.env.MULTI_TENANT === "1" && req.tenantSlug) {
        resetLink += `&tenant=${req.tenantSlug}`;
      }

      const { sendPasswordResetEmail } = require("../utils/resendEmail");
      await sendPasswordResetEmail({
        toEmail: employee.email,
        employeeName: employee.name,
        resetLink,
        storeName,
      });

      // Log to action_history
      const actorId = Number(req.headers["x-employee-id"] || 0);
      try {
        await db.query(
          `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
           VALUES ('password_reset_sent', 'employee', $1, $2, $3)`,
          [Number(id), actorId, `Password reset email sent to ${employee.email}`]
        );
      } catch { /* best-effort */ }

      res.json({ message: `Password reset email sent to ${employee.email}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 5: Commit**

```bash
git add backend/routes/employees.js
git commit -m "feat: employee password management endpoints (set, change, send-reset)"
```

---

### Task 5: Frontend — Update AuthProvider + Login Form

**Files:**
- Modify: `frontend/src/auth/AuthProvider.jsx:84-128` (login function)
- Modify: `frontend/src/pages/LandingPage.jsx:31-137` (LoginForm component)

**Step 1: Update AuthProvider login function**

In `frontend/src/auth/AuthProvider.jsx`, change the `login` function (line 84) to accept `password` instead of `pin`:

```js
  const login = async (username, password, tenantSlug) => {
    if (IS_MULTI_TENANT && tenantSlug) {
      const res = await fetch(`${API}/api/auth/mt-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenant_slug: tenantSlug, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid credentials");
      }
      const next = {
        employee: data.employee,
        permissions: data.permissions || [],
        token: data.token,
        tenant_slug: tenantSlug,
        tenant: data.tenant,
        loadedAt: Date.now(),
      };
      writeSession(next);
      setSession(next);
      return next;
    }

    // Single-tenant login
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Invalid credentials");
    }
    const next = {
      employee: data.employee,
      permissions: data.permissions || [],
      loadedAt: Date.now(),
    };
    writeSession(next);
    setSession(next);
    return next;
  };
```

**Step 2: Update LandingPage LoginForm**

In `frontend/src/pages/LandingPage.jsx`, update the `LoginForm` component:

a) Line 38 — rename state from `pin` to `password`:
```js
const [password, setPassword] = useState("");
```

b) Line 42-43 — update canSubmit:
```js
const canSubmit =
  username.trim() && password.trim() && (!IS_MULTI_TENANT || storeCode.trim());
```

c) Lines 51-54 — update login call:
```js
await login(
  username.trim(),
  password.trim(),
  IS_MULTI_TENANT ? storeCode.trim() : undefined,
);
```

d) Lines 107-125 — replace PIN field with Password field:
```jsx
<label className="block">
  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
    Password
  </span>
  <div className="mt-1.5 relative">
    <Lock
      size={16}
      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
    />
    <input
      type="password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
      placeholder="Enter your password"
    />
  </div>
</label>
```

e) After the password field and before the error display (line 127), add "Forgot password?" link:
```jsx
<div className="flex justify-end">
  <button
    type="button"
    onClick={() => setShowForgot(true)}
    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
  >
    Forgot password?
  </button>
</div>
```

f) Add `showForgot` state at line 40:
```js
const [showForgot, setShowForgot] = useState(false);
```

g) Add ForgotPasswordModal rendering after the `</form>` close:
```jsx
{showForgot && (
  <ForgotPasswordModal
    storeCode={storeCode}
    onClose={() => setShowForgot(false)}
  />
)}
```

**Step 3: Add ForgotPasswordModal component**

Add before the `LoginForm` function (around line 29):

```jsx
function ForgotPasswordModal({ storeCode, onClose }) {
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          store_code: IS_MULTI_TENANT ? storeCode : undefined,
        }),
      });
    } catch { /* always show success */ }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Reset Password</h3>
        {submitted ? (
          <>
            <p className="text-sm text-slate-600 mb-4">
              If an account with that username exists and has an email address, a reset link has been sent.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
            >
              Back to Login
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter your username and we'll send a reset link to your email.
            </p>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              placeholder="Username"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-slate-200 rounded-lg py-2.5 font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

Note: Add `API_BASE` to the import at line 26:
```js
import { IS_MULTI_TENANT } from "../config";
```
becomes:
```js
import { API_BASE, IS_MULTI_TENANT } from "../config";
```

**Step 4: Commit**

```bash
git add frontend/src/auth/AuthProvider.jsx frontend/src/pages/LandingPage.jsx
git commit -m "feat: password login form + forgot password modal on landing page"
```

---

### Task 6: Frontend — Reset Password Page

**Files:**
- Create: `frontend/src/pages/ResetPassword.jsx`
- Modify: `frontend/src/App.jsx` (add route)

**Step 1: Create ResetPassword.jsx**

Create `frontend/src/pages/ResetPassword.jsx`:

```jsx
import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Lock, CheckCircle, XCircle } from "lucide-react";
import { API_BASE } from "../config";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";
  const tenant = searchParams.get("tenant") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success: bool, message: string }

  const valid = password.length >= 8 && password === confirm && token;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          new_password: password,
          store_code: tenant || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setResult({ success: true, message: data.message });
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <XCircle size={40} className="mx-auto text-red-500 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Invalid Link</h2>
          <p className="text-sm text-slate-600 mb-4">This password reset link is invalid or has expired.</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          {result.success ? (
            <CheckCircle size={40} className="mx-auto text-emerald-500 mb-3" />
          ) : (
            <XCircle size={40} className="mx-auto text-red-500 mb-3" />
          )}
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            {result.success ? "Password Reset" : "Reset Failed"}
          </h2>
          <p className="text-sm text-slate-600 mb-4">{result.message}</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            {result.success ? "Sign In" : "Back to Login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Set New Password</h2>
        <p className="text-sm text-slate-500 mb-4">Choose a new password for your account.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">New Password</span>
            <div className="mt-1.5 relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
                placeholder="Minimum 8 characters"
                autoFocus
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Confirm Password</span>
            <div className="mt-1.5 relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
                placeholder="Repeat your password"
              />
            </div>
          </label>
          {password && confirm && password !== confirm && (
            <p className="text-xs text-red-600">Passwords do not match</p>
          )}
          {password && password.length < 8 && (
            <p className="text-xs text-red-600">Password must be at least 8 characters</p>
          )}
          <button
            type="submit"
            disabled={loading || !valid}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold disabled:opacity-50 transition-colors cursor-pointer"
          >
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Add route to App.jsx**

In `frontend/src/App.jsx`, add lazy import near the top (after other lazy imports, around line 10):
```js
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
```

Add route after the `/login` route (after line 108):
```jsx
<Route path="/reset-password" element={<Suspense fallback={<RouteLoading />}><ResetPassword /></Suspense>} />
```

**Step 3: Commit**

```bash
git add frontend/src/pages/ResetPassword.jsx frontend/src/App.jsx
git commit -m "feat: reset password page with token validation"
```

---

### Task 7: Frontend — Employee Password Management UI

**Files:**
- Modify: `frontend/src/pages/redesign/EmployeesRedesign.jsx`

**Step 1: Add email field to create/edit employee form**

In `backend/routes/employees.js`, we already handle `email` in the body. Now add the field to the frontend form.

In `EmployeesRedesign.jsx`:

a) Line 16 — add `email` to EMPTY_FORM:
```js
const EMPTY_FORM = { name: "", role_id: 3, pin_code: "", email: "", salary_type: "monthly", monthly_salary: "", hourly_rate: "", daily_rate: "" };
```

b) Line 84 — add email to openEdit form state:
```js
setForm({ name: emp.name, role_id: emp.role_id, pin_code: "", email: emp.email || "", salary_type: ... });
```

c) Line 127 — add email to save body:
```js
if (form.email !== undefined) body.email = form.email;
```

d) After the PIN input field in the form (after line 342), add email field:
```jsx
<Input
  type="email"
  placeholder="Email address (for password resets)"
  value={form.email}
  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
/>
```

**Step 2: Add password management state and modals**

Add state variables (after revoking state, around line 38):
```js
// Password management
const [passwordTarget, setPasswordTarget] = useState(null);
const [newPassword, setNewPassword] = useState("");
const [confirmPassword, setConfirmPassword] = useState("");
const [settingPassword, setSettingPassword] = useState(false);
```

Add `setPassword` function:
```js
const setPasswordForEmployee = async () => {
  if (!passwordTarget || newPassword.length < 8 || newPassword !== confirmPassword) return;
  setSettingPassword(true);
  setError("");
  try {
    const res = await fetch(`${API}/api/employees/${passwordTarget.id}/set-password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to set password");
    setPasswordTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    await load();
    alert(`Password set for ${passwordTarget.name}`);
  } catch (e) {
    setError(e.message || "Failed to set password");
  } finally {
    setSettingPassword(false);
  }
};
```

Add `sendReset` function:
```js
const sendPasswordReset = async (emp) => {
  if (!emp.email) {
    alert("This employee has no email address set. Edit the employee to add one first.");
    return;
  }
  if (!window.confirm(`Send password reset email to ${emp.email}?`)) return;
  setError("");
  try {
    const res = await fetch(`${API}/api/employees/${emp.id}/send-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send reset email");
    alert(data.message || "Reset email sent");
  } catch (e) {
    setError(e.message || "Failed to send reset email");
  }
};
```

**Step 3: Add action buttons to employee table rows**

In the actions column (line 292), add password buttons:
```jsx
<td className="px-3 py-2 text-right">
  <div className="inline-flex gap-2">
    <Button size="sm" onClick={() => openEdit(emp)}>Edit</Button>
    <Button size="sm" onClick={() => { setPasswordTarget(emp); setNewPassword(""); setConfirmPassword(""); }}>
      <Lock size={12} className="mr-1 inline" />Password
    </Button>
    <Button size="sm" onClick={() => sendPasswordReset(emp)}
      title={emp.email ? `Send reset to ${emp.email}` : "No email set"}>
      <Mail size={12} className="mr-1 inline" />Reset
    </Button>
    <Button size="sm" tone="danger" onClick={() => { setRevokeTarget(emp); setRevokeReason(""); }}>
      <KeyRound size={12} className="mr-1 inline" />Revoke
    </Button>
    <Button size="sm" tone="danger" onClick={() => remove(emp)}>
      <Trash2 size={12} className="mr-1 inline" />Archive
    </Button>
  </div>
</td>
```

Add `Mail` to lucide-react import at line 2:
```js
import { Download, KeyRound, Lock, Mail, MapPin, Plus, Search, Shield, Star, Trash2, User } from "lucide-react";
```

**Step 4: Add set-password modal**

After the revoke sessions modal (after line 506), add:
```jsx
{passwordTarget && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
    <SectionCard className="w-full max-w-sm p-5">
      <h3 className="mb-2 text-lg font-semibold text-(--ui-text)">Set Password</h3>
      <p className="mb-3 text-sm text-(--ui-text-muted)">
        Set a dashboard login password for <strong>{passwordTarget.name}</strong>.
      </p>
      <div className="space-y-2 mb-3">
        <Input
          type="password"
          placeholder="New password (min 8 chars)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {newPassword && confirmPassword && newPassword !== confirmPassword && (
          <p className="text-xs text-red-600">Passwords do not match</p>
        )}
        {newPassword && newPassword.length < 8 && (
          <p className="text-xs text-red-600">Min 8 characters</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setPasswordTarget(null)} disabled={settingPassword}>Cancel</Button>
        <Button
          tone="primary"
          onClick={setPasswordForEmployee}
          disabled={settingPassword || newPassword.length < 8 || newPassword !== confirmPassword}
        >
          {settingPassword ? "Setting..." : "Set Password"}
        </Button>
      </div>
    </SectionCard>
  </div>
)}
```

**Step 5: Update table header — add Email column**

Update the table headers (line 262-267) to include Email and Password Status:
```jsx
<tr>
  <th className="px-3 py-2 text-left">Employee</th>
  <th className="px-3 py-2 text-left">Role</th>
  <th className="px-3 py-2 text-left">Email</th>
  <th className="px-3 py-2 text-left">Auth</th>
  <th className="px-3 py-2 text-right">Actions</th>
</tr>
```

Update the table body row (replace the PIN column at line 287-290) to show Email and Auth status:
```jsx
<td className="px-3 py-2 text-(--ui-text-muted) text-sm">
  {emp.email || <span className="text-xs italic">No email</span>}
</td>
<td className="px-3 py-2">
  {emp.has_password ? (
    <Badge tone="default"><Lock size={10} className="mr-1 inline" />Password</Badge>
  ) : (
    <Badge tone="warning"><Lock size={10} className="mr-1 inline" />PIN only</Badge>
  )}
</td>
```

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/EmployeesRedesign.jsx
git commit -m "feat: employee password management UI (set password, send reset, email field)"
```

---

### Task 8: Update POS Session Expired Modal

**Files:**
- Check: `frontend/src/pages/redesign/pos/POSSessionExpiredModal.jsx` — if it uses PIN re-login, keep it (POS re-auth stays PIN-based since it's a quick re-verify during a shift, not a full dashboard login)

**Step 1: Verify POS session modal uses PIN**

Read `POSSessionExpiredModal.jsx` and confirm it uses PIN auth (`/api/employees/validate-pin` or kiosk PIN). If so, no changes needed — PIN re-auth for POS is intentional.

**Step 2: Commit (if any changes needed)**

```bash
# Only if changes are made
git add frontend/src/pages/redesign/pos/POSSessionExpiredModal.jsx
git commit -m "fix: POS session expired modal stays PIN-based"
```

---

### Task 9: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

**Step 1: Move "Password Auth & Admin Reset" from Up Next to complete**

Move the "Password Auth & Admin Reset" section from `🔲 Up Next` to a new `✅` completed section. Update dates. Mark "Self-service password/PIN reset via email" as built (via forgot-password + Resend). Mark "Self-service signup" and "Onboarding email" as still deferred.

Add Resend as a completed item under integrations.

**Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark password auth + Resend as complete in ROADMAP"
```

---

### Task 10: Final Verification

**Step 1: Build frontend to verify no compile errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

**Step 2: Verify backend starts**

Run: `cd backend && node -e "require('dotenv').config(); require('./index.js')"` (or just check that `node index.js` starts without errors)

**Step 3: Verify all changes look correct**

Run: `git log --oneline -10` to see all commits.
Run: `git diff main --stat` to see full change summary.

**Step 4: Push branch**

```bash
git push -u origin feature/password-auth-resend
```

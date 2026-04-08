# Onboarding Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable self-service signup in production and polish the full new-tenant journey from landing page discovery through first sale.

**Architecture:** 6 changes across frontend and backend: landing page signup links, immediate redirect after signup, branded welcome email, 48h token expiry (migration v6), signup rate limiting, and dead tenant cleanup job. No new tables — uses existing `integration_settings` pattern and `company_profile` columns.

**Tech Stack:** React 19, Express v5, PostgreSQL, Resend email API, bcrypt, existing rate limiting infrastructure.

---

### Task 1: Migration v6 — Setup Token Expiry Column

**Files:**
- Modify: `backend/migrate-pg.js:127` (add v6 to MIGRATIONS array)
- Modify: `backend/schema-pg.sql` (add column to company_profile DDL)
- Modify: `backend/tenant-provisioner-pg.js:100-105` (set expiry on provision)

**Step 1: Add migration v6 to migrate-pg.js**

In `backend/migrate-pg.js`, replace the comment on line 127:

```javascript
  {
    version: 6,
    description: "Add setup_token_expires_at to company_profile",
    up: async (client) => {
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS setup_token_expires_at TIMESTAMPTZ
      `);
    },
  },
  // Future migrations go here (next: version 7):
```

**Step 2: Update schema-pg.sql DDL**

In `backend/schema-pg.sql`, add after the `setup_token TEXT` line in the company_profile table:

```sql
  setup_token_expires_at TIMESTAMPTZ,
```

**Step 3: Update tenant provisioner to set expiry**

In `backend/tenant-provisioner-pg.js`, modify the company_profile INSERT (around line 100-105) to include the expiry:

```javascript
await client.query(
  `INSERT INTO company_profile (id, company_name, timezone, setup_token, setup_token_expires_at, setup_complete)
   VALUES (1, $1, $2, $3, NOW() + INTERVAL '48 hours', false)
   ON CONFLICT (id) DO UPDATE SET setup_token = $3, setup_token_expires_at = NOW() + INTERVAL '48 hours', company_name = $1, timezone = $2`,
  [name, timezone || "UTC", setupToken]
);
```

**Step 4: Update setup.js token verification**

In `backend/routes/setup.js`, around line 92, update the SELECT and add expiry check:

```javascript
const { rows: [profile] } = await setupDb.query(
  'SELECT setup_complete, setup_token, setup_token_expires_at FROM company_profile WHERE id = 1',
  []
);
if (!profile) return res.status(503).json({ error: 'Setup not initialised' });
if (profile.setup_complete) {
  return res.status(403).json({ error: 'Setup already complete' });
}
if (!profile.setup_token || profile.setup_token !== token) {
  return res.status(403).json({ error: 'Invalid setup token' });
}
if (profile.setup_token_expires_at && new Date(profile.setup_token_expires_at) < new Date()) {
  return res.status(403).json({ error: 'Setup link has expired. Please contact support or request a new setup link.' });
}
```

**Step 5: Run migration locally**

```bash
cd backend && node migrate-pg.js
```

Expected: `v6: Add setup_token_expires_at to company_profile — applied`

**Step 6: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql backend/tenant-provisioner-pg.js backend/routes/setup.js
git commit -m "feat: add 48h setup token expiry (migration v6)"
```

---

### Task 2: Branded Welcome Email

**Files:**
- Modify: `backend/utils/resendEmail.js` (add `buildWelcomeEmailHtml` and `sendWelcomeEmail`)
- Modify: `backend/routes/auth.js:616-632` (replace inline HTML with new function)

**Step 1: Add buildWelcomeEmailHtml to resendEmail.js**

Add before `module.exports` at end of `backend/utils/resendEmail.js`:

```javascript
function buildWelcomeEmailHtml({ ownerName, storeName, slug, setupUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669;margin-bottom:16px">Welcome to SanoPOS!</h2>
      <p>Hi ${ownerName},</p>
      <p>Your store <strong>${storeName}</strong> has been created and is ready to set up.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 4px 0;font-size:13px;color:#64748b">Your store code</p>
        <p style="margin:0;font-size:20px;font-weight:700;font-family:monospace;color:#059669">${slug}</p>
      </div>
      <p style="margin:24px 0">
        <a href="${setupUrl}"
           style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Complete Setup
        </a>
      </p>
      <p style="font-weight:600;margin-bottom:8px">What's next?</p>
      <ol style="color:#475569;padding-left:20px;line-height:1.8">
        <li>Configure your store — name, currency, timezone</li>
        <li>Add your products and open your first shift</li>
        <li>Start selling!</li>
      </ol>
      <p style="color:#64748b;font-size:13px;margin-top:20px">This setup link expires in 48 hours. If it expires, contact support for a new one.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="color:#94a3b8;font-size:12px">SanoPOS — Point of Sale</p>
    </div>
  `;
}

async function sendWelcomeEmail({ toEmail, ownerName, storeName, slug, setupUrl }) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Welcome to SanoPOS — Set up ${storeName}`,
    html: buildWelcomeEmailHtml({ ownerName, storeName, slug, setupUrl }),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
```

Update `module.exports`:

```javascript
module.exports = { sendPasswordResetEmail, sendWelcomeEmail };
```

**Step 2: Replace inline email in auth.js**

In `backend/routes/auth.js`, replace lines 616-632 (the inline email block) with:

```javascript
      // Attempt welcome email via Resend
      if (process.env.RESEND_API_KEY) {
        try {
          const { sendWelcomeEmail } = require("../utils/resendEmail");
          const corsOrigin = process.env.CORS_ORIGIN || "https://sanopos.vercel.app";
          const setupUrl = `${corsOrigin}/setup?token=${result.setupToken}&tenant=${slug}`;
          await sendWelcomeEmail({
            toEmail: email,
            ownerName: owner_name,
            storeName: store_name,
            slug,
            setupUrl,
          });
        } catch (emailErr) {
          console.error("Welcome email failed:", emailErr.message);
        }
      }
```

**Step 3: Commit**

```bash
git add backend/utils/resendEmail.js backend/routes/auth.js
git commit -m "feat: branded welcome email template matching password reset style"
```

---

### Task 3: Signup Flow — Return Token + Redirect

**Files:**
- Modify: `backend/routes/auth.js:634` (return setupToken in response)
- Modify: `frontend/src/pages/SignupPage.jsx` (redirect instead of success screen, read ?plan= param)

**Step 1: Update backend response**

In `backend/routes/auth.js`, change line 634 from:

```javascript
res.json({ ok: true, slug, message: "Store created! Check your email." });
```

To:

```javascript
res.json({ ok: true, slug, setupToken: result.setupToken, message: "Store created! Redirecting to setup..." });
```

**Step 2: Update SignupPage.jsx — read plan param and redirect on success**

In `frontend/src/pages/SignupPage.jsx`:

Add URL param reading near the top of the component (after form state):

```javascript
// Pre-select plan from URL param
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const planParam = params.get("plan");
  if (planParam && ["free", "starter", "pro"].includes(planParam)) {
    setForm((f) => ({ ...f, plan: planParam }));
  }
}, []);
```

Add `useEffect` import if not already present.

Replace the success handling in `onSubmit` (around lines 40-47). After `const data = await res.json()`:

```javascript
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }
      // Redirect immediately to setup wizard
      if (data.setupToken && data.slug) {
        window.location.href = `/setup?token=${data.setupToken}&tenant=${data.slug}`;
        return;
      }
      // Fallback: show success screen (if token not returned)
      setResult(data);
```

**Step 3: Commit**

```bash
git add backend/routes/auth.js frontend/src/pages/SignupPage.jsx
git commit -m "feat: redirect to setup wizard immediately after signup"
```

---

### Task 4: Landing Page — Signup Links

**Files:**
- Modify: `frontend/src/pages/LandingPage.jsx` (hero button + pricing card CTAs)

**Step 1: Add "Create Free Account" link in hero section**

In `frontend/src/pages/LandingPage.jsx`, find the login card area (around line 549, after the `</LoginForm>` or after the card closing div). Add below the login card:

```jsx
<p className="mt-4 text-center text-sm text-(--ui-text-muted)">
  Don't have an account?{" "}
  <a href="/signup" className="font-semibold text-(--ui-primary) hover:underline">
    Create Free Account
  </a>
</p>
```

**Step 2: Update pricing card CTAs**

Find the pricing card buttons (around lines 682-687). The current buttons link to `#top`. Replace each card's CTA button with a link to `/signup?plan=<plan>`:

The PLANS array (around lines 301-344) has a `key` field for each plan. Update the button in each pricing card from:

```jsx
<a href="#top" ...>Get Started</a>
```

To:

```jsx
<a href={`/signup?plan=${plan.key}`} ...>Get Started</a>
```

Ensure the Free plan button text stays "Get Started Free" and Starter/Pro say "Get Started".

**Step 3: Commit**

```bash
git add frontend/src/pages/LandingPage.jsx
git commit -m "feat: add signup links to landing page hero and pricing cards"
```

---

### Task 5: Signup Rate Limiting

**Files:**
- Modify: `backend/routes/auth.js` (add rate limit to signup endpoint)

**Step 1: Add signup rate limiter**

In `backend/routes/auth.js`, before the signup handler (around line 569), add an in-memory rate limiter:

```javascript
const signupLimits = new Map(); // ip -> { count, resetAt }
function checkSignupRate(ip) {
  const now = Date.now();
  const entry = signupLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    signupLimits.set(ip, { count: 1, resetAt: now + 3600000 }); // 1 hour window
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count += 1;
  return true;
}
```

Then at the top of the signup handler (after the `SELF_SERVICE_SIGNUP` check), add:

```javascript
const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
if (!checkSignupRate(clientIp)) {
  return res.status(429).json({ error: "Too many signup attempts. Please try again in an hour." });
}
```

**Step 2: Commit**

```bash
git add backend/routes/auth.js
git commit -m "feat: rate limit signups to 5 per IP per hour"
```

---

### Task 6: Admin — Regenerate Setup Link

**Files:**
- Modify: `backend/routes/admin.js` (add regenerate setup link endpoint)

**Step 1: Add endpoint**

In `backend/routes/admin.js`, add a new endpoint near the other tenant-specific routes:

```javascript
// POST /api/admin/tenants/:id/regenerate-setup — generate new setup token
app.post("/api/admin/tenants/:id/regenerate-setup", async (req, res) => {
  try {
    const { rows: [tenant] } = await masterDb.query(
      "SELECT slug, status FROM tenants WHERE id = $1",
      [req.params.id]
    );
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const crypto = require("crypto");
    const newToken = crypto.randomBytes(32).toString("hex");
    const tenantDb = await tenantDbManager.getDb(tenant.slug);
    await tenantDb.query(
      `UPDATE company_profile
       SET setup_token = $1, setup_token_expires_at = NOW() + INTERVAL '48 hours'
       WHERE id = 1`,
      [newToken]
    );

    const corsOrigin = process.env.CORS_ORIGIN || "https://sanopos.vercel.app";
    const setupUrl = `${corsOrigin}/setup?token=${newToken}&tenant=${tenant.slug}`;

    res.json({ ok: true, setupUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

Note: This needs access to `tenantDbManager` — check that it's available in the admin route scope (it's imported in `registerAllRoutes.js` and passed via `deps`). Adjust variable name to match the existing pattern in `admin.js`.

**Step 2: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: admin endpoint to regenerate tenant setup link"
```

---

### Task 7: Dead Tenant Cleanup Job

**Files:**
- Create: `backend/jobs/cleanup-dead-tenants.js`
- Modify: `backend/routes/admin.js` (add cleanup-preview and trigger endpoints, update attention endpoint)

**Step 1: Create cleanup job**

Create `backend/jobs/cleanup-dead-tenants.js`:

```javascript
/**
 * Cleanup tenants with setup_complete = false after 7 days.
 * Safety: skips tenants that have any sales data.
 * Usage: node backend/jobs/cleanup-dead-tenants.js [--dry-run]
 */
const dbPg = require("../db-pg");
const masterDb = require("../master-db-pg");
const tenantDbManager = require("../tenant-db-manager-pg");

async function cleanupDeadTenants({ dryRun = false } = {}) {
  const { rows: candidates } = await masterDb.query(
    `SELECT id, slug, name, created_at FROM tenants
     WHERE status = 'active'
       AND created_at < NOW() - INTERVAL '7 days'`
  );

  const results = { checked: 0, deleted: 0, skipped: 0, details: [] };

  for (const tenant of candidates) {
    results.checked++;
    try {
      const tenantDb = await tenantDbManager.getDb(tenant.slug);

      // Check if setup is incomplete
      const { rows: [profile] } = await tenantDb.query(
        "SELECT setup_complete FROM company_profile WHERE id = 1"
      );
      if (!profile || profile.setup_complete) {
        results.skipped++;
        continue;
      }

      // Safety: skip if any sales exist
      const { rows: [salesCheck] } = await tenantDb.query(
        "SELECT COUNT(*) as count FROM sales LIMIT 1"
      );
      if (Number(salesCheck.count) > 0) {
        results.skipped++;
        results.details.push({ slug: tenant.slug, action: "skipped", reason: "has sales data" });
        continue;
      }

      if (dryRun) {
        results.deleted++;
        results.details.push({ slug: tenant.slug, action: "would_delete", created: tenant.created_at });
        continue;
      }

      // Drop tenant schema
      await dbPg.query(`DROP SCHEMA IF EXISTS tenant_${tenant.slug} CASCADE`);

      // Mark tenant as deleted in master
      await masterDb.query(
        "UPDATE tenants SET status = 'deleted', deleted_at = NOW() WHERE id = $1",
        [tenant.id]
      );

      // Audit log
      await masterDb.query(
        `INSERT INTO tenant_audit_log (tenant_id, action, details, performed_by)
         VALUES ($1, 'auto_cleanup_incomplete_setup', $2, 'system')`,
        [tenant.id, JSON.stringify({ slug: tenant.slug, created_at: tenant.created_at })]
      );

      results.deleted++;
      results.details.push({ slug: tenant.slug, action: "deleted", created: tenant.created_at });
      console.log(`[cleanup] Deleted dead tenant: ${tenant.slug} (created ${tenant.created_at})`);
    } catch (err) {
      results.skipped++;
      results.details.push({ slug: tenant.slug, action: "error", error: err.message });
      console.error(`[cleanup] Error processing ${tenant.slug}:`, err.message);
    }
  }

  return results;
}

// CLI mode
if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[cleanup] Running ${dryRun ? "DRY RUN" : "LIVE"}...`);
  cleanupDeadTenants({ dryRun })
    .then((r) => {
      console.log(`[cleanup] Done. Checked: ${r.checked}, Deleted: ${r.deleted}, Skipped: ${r.skipped}`);
      if (r.details.length) console.table(r.details);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[cleanup] Fatal:", err);
      process.exit(1);
    });
}

module.exports = { cleanupDeadTenants };
```

**Step 2: Add admin endpoints**

In `backend/routes/admin.js`, add:

```javascript
// GET /api/admin/cleanup-preview — dry-run of dead tenant cleanup
app.get("/api/admin/cleanup-preview", async (req, res) => {
  try {
    const { cleanupDeadTenants } = require("../jobs/cleanup-dead-tenants");
    const results = await cleanupDeadTenants({ dryRun: true });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/cleanup-run — execute dead tenant cleanup
app.post("/api/admin/cleanup-run", async (req, res) => {
  try {
    const { cleanupDeadTenants } = require("../jobs/cleanup-dead-tenants");
    const results = await cleanupDeadTenants({ dryRun: false });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Update GET /api/admin/attention to include dead tenant count**

In the existing `GET /api/admin/attention` handler (around line 499-557), find where `setup_pending` is populated. Add a `dead_tenants` field that counts tenants where `setup_complete = false` AND `created_at < NOW() - INTERVAL '7 days'`. This uses the same logic that's already checking `setup_pending` but with the 7-day age filter.

After collecting `setup_pending`, add:

```javascript
const dead_tenants = setup_pending.filter(
  (t) => new Date(t.created_at) < new Date(Date.now() - 7 * 86400000)
);
```

Include `dead_tenants` in the response alongside `approaching_limits`, `dormant`, `setup_pending`.

**Step 4: Commit**

```bash
git add backend/jobs/cleanup-dead-tenants.js backend/routes/admin.js
git commit -m "feat: dead tenant cleanup job with admin preview and trigger endpoints"
```

---

### Task 8: Enable Self-Service Signup in Production

**This is a deployment task, not a code change.**

**Step 1: Set environment variable on Railway**

```bash
# Via Railway CLI or dashboard
SELF_SERVICE_SIGNUP=1
```

**Step 2: Set environment variable on Vercel (if any frontend flag needed)**

Currently the frontend doesn't gate on this — the signup page is always rendered. The backend validates the flag. No Vercel change needed.

**Step 3: Run migration on production**

```bash
node backend/migrate-pg.js
```

This applies v6 (setup_token_expires_at) to public schema and all active tenant schemas.

**Step 4: Verify end-to-end**

1. Visit `sanopos.vercel.app` → pricing cards should show "Get Started" links
2. Click "Get Started" on Free plan → redirects to `/signup?plan=free`
3. Fill signup form → should redirect to setup wizard
4. Complete setup wizard → should redirect to login
5. Check email inbox for branded welcome email

**Step 5: Commit any env/config changes and tag**

```bash
git tag v1.7.0-onboarding-polish
```

---

## Task Dependency Order

```
Task 1 (migration v6) — no dependencies
Task 2 (welcome email) — no dependencies
Task 3 (signup redirect) — no dependencies
Task 4 (landing page links) — no dependencies
Task 5 (rate limiting) — no dependencies
Task 6 (admin regenerate) — depends on Task 1 (needs expires_at column)
Task 7 (dead tenant cleanup) — no dependencies
Task 8 (production enable) — depends on all above
```

Tasks 1-5 can be built in parallel. Task 6 needs Task 1 first. Task 7 is independent. Task 8 is the final deployment step.

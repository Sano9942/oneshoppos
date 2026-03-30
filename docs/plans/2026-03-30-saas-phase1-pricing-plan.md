# SaaS Phase 1 — Pricing Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure from 3 tiers (Free/Starter/Pro) to 2 tiers (Free/Pro) with per-outlet pricing, 45-day Pro trial, write-lock on expiry, and slug reuse fix.

**Architecture:** Activate existing dormant columns (`trial_ends_at`, `grace_ends_at`, `payment_status`) on the `tenants` table. Add `requireActiveSubscription` middleware to block writes when `payment_status = 'expired'`. Email worker's daily billing check transitions trial→grace→expired. Frontend catches `SUBSCRIPTION_EXPIRED` response code globally.

**Tech Stack:** Node.js/Express backend, React frontend, Postgres (Supabase), Resend email, existing email queue worker.

---

### Task 1: Update PLAN_DEFAULTS and add requireActiveSubscription middleware

**Files:**
- Modify: `backend/middleware/plan-limits.js`

**Step 1: Update PLAN_DEFAULTS (lines 16-20)**

Replace the 3-tier config with 2 tiers:

```javascript
const PLAN_DEFAULTS = {
  free: { max_outlets: 1, max_employees: 3,  max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0,  max_products: 0   },
};
```

**Step 2: Add requireActiveSubscription middleware after line 89**

```javascript
/**
 * Blocks write operations (POST/PUT/DELETE) when tenant subscription is expired.
 * Skipped for: GET requests, non-MT mode, non-API routes.
 * Always allows: auth, billing, support, setup, health, receipts routes.
 */
function requireActiveSubscription(req, res, next) {
  if (process.env.MULTI_TENANT !== "1") return next();
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return next();

  // Allow routes that must always work (auth, billing, support, setup, health, receipts)
  const path = req.path;
  if (
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/billing/") ||
    path.startsWith("/api/support/") ||
    path.startsWith("/api/setup/") ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/receipts/")
  ) {
    return next();
  }

  const tenantId = req.tenantId;
  if (!tenantId) return next();

  const masterDb = require("../master-db-pg");
  masterDb.query("SELECT payment_status FROM tenants WHERE id = $1", [tenantId])
    .then(({ rows }) => {
      const status = rows[0]?.payment_status;
      if (status === "expired") {
        return res.status(403).json({
          error: "Your subscription has expired. Please subscribe to continue.",
          code: "SUBSCRIPTION_EXPIRED",
          billing_url: "/billing",
        });
      }
      next();
    })
    .catch(() => next()); // Best-effort — don't block on lookup failure
}
```

**Step 3: Export the new middleware**

```javascript
module.exports = { requirePlanLimit, requireActiveSubscription, PLAN_DEFAULTS };
```

**Step 4: Commit**

```bash
git add backend/middleware/plan-limits.js
git commit -m "feat: update PLAN_DEFAULTS to 2 tiers, add requireActiveSubscription middleware"
```

---

### Task 2: Apply requireActiveSubscription in registerAllRoutes

**Files:**
- Modify: `backend/routes/registerAllRoutes.js`

**Step 1: Add requireActiveSubscription to deps destructuring (line 10)**

Add `requireActiveSubscription` to the destructured `deps` object at line 10, after `requirePlanLimit`:

```javascript
    requirePlanLimit,
    requireActiveSubscription,
```

**Step 2: Apply middleware after resolveContext (after line 168)**

Insert after `app.use(resolveContext);` (line 167) and before `app.use(requireContextOutlet);` (line 168):

```javascript
  // Block write operations for expired subscriptions (must be after tenant resolution)
  if (process.env.MULTI_TENANT === "1") {
    app.use(requireActiveSubscription);
  }
```

**Step 3: Pass requireActiveSubscription in index.js deps**

In `backend/index.js`, find where `deps` object is built (it includes `requirePlanLimit`). Add `requireActiveSubscription` from the same import:

```javascript
const { requirePlanLimit, requireActiveSubscription, PLAN_DEFAULTS } = require("./middleware/plan-limits");
```

And add `requireActiveSubscription` to the deps object passed to `registerAllRoutes`.

**Step 4: Commit**

```bash
git add backend/routes/registerAllRoutes.js backend/index.js
git commit -m "feat: apply requireActiveSubscription middleware to all business routes"
```

---

### Task 3: Fix slug reuse and add trial provisioning in signup

**Files:**
- Modify: `backend/routes/auth.js` (lines 617, 625-633)

**Step 1: Fix slug uniqueness check (line 617)**

```javascript
// Before:
const { rows: existing } = await masterDb.query("SELECT id FROM tenants WHERE slug = $1", [slug]);

// After:
const { rows: existing } = await masterDb.query("SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]);
```

**Step 2: Add trial fields when plan is Pro (after line 633)**

Replace the plan application block (lines 625-633) with:

```javascript
      // Apply plan + its default limits
      const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
      const effectivePlan = ["free", "pro"].includes(plan) ? plan : "free";
      const limits = PLAN_DEFAULTS[effectivePlan] || PLAN_DEFAULTS.free;

      // Pro gets a 45-day trial; Free stays active forever
      const trialFields = effectivePlan === "pro"
        ? `, trial_ends_at = NOW() + INTERVAL '45 days', payment_status = 'trial'`
        : ``;

      await masterDb.query(
        `UPDATE tenants SET plan = $1, max_outlets = $2, max_employees = $3, max_products = $4${trialFields}
         WHERE id = $5`,
        [effectivePlan, limits.max_outlets, limits.max_employees, limits.max_products, result.tenantId]
      );
```

**Step 3: Update plan validation (line 596)**

The plan selection from the request body needs to only accept `free` or `pro`:

```javascript
// No change needed in destructuring. Validation happens in effectivePlan line above.
// "starter" will fall through to "free" since it's not in ["free", "pro"].
```

**Step 4: Commit**

```bash
git add backend/routes/auth.js
git commit -m "fix: allow slug reuse for soft-deleted tenants, add 45-day trial for Pro signups"
```

---

### Task 4: Add trial state transitions to email worker

**Files:**
- Modify: `backend/workers/email-worker.js` (add `runTrialCheck` function)

**Step 1: Add trial check function after `runBillingCheck` (after line 149)**

```javascript
// -- Trial Lifecycle Check ------------------------------------------------

async function runTrialCheck(pool, logger) {
  const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";

  try {
    // 1. Trial warning — 7 days before trial ends
    const { rows: warningTenants } = await pool.query(
      `SELECT id, slug, name, trial_ends_at
       FROM tenants
       WHERE payment_status = 'trial'
         AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND status != 'deleted'`
    );

    for (const t of warningTenants) {
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM email_queue
         WHERE tenant_id = $1 AND email_type = 'trial_warning'
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [t.id]
      );
      if (dup.length) continue;

      const email = await getTenantEmail(pool, t.slug);
      if (!email) continue;

      const daysLeft = Math.max(1, Math.ceil((new Date(t.trial_ends_at) - new Date()) / 86400000));
      const { TEMPLATES } = require("../services/email-templates");
      const template = TEMPLATES.trial_warning({ storeName: t.name, daysLeft });

      await pool.query(
        `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, "trial_warning", email, template.subject, template.html, fromAddress]
      );
      logger.info({ tenant: t.slug, daysLeft }, "Enqueued trial warning");
    }

    // 2. Trial → Grace transition
    const { rows: expiredTrials } = await pool.query(
      `SELECT id, slug, name, trial_ends_at
       FROM tenants
       WHERE payment_status = 'trial'
         AND trial_ends_at < NOW()
         AND status != 'deleted'`
    );

    for (const t of expiredTrials) {
      await pool.query(
        `UPDATE tenants SET payment_status = 'grace', grace_ends_at = trial_ends_at + INTERVAL '7 days', updated_at = NOW()
         WHERE id = $1`,
        [t.id]
      );

      const email = await getTenantEmail(pool, t.slug);
      if (email) {
        const { TEMPLATES } = require("../services/email-templates");
        const template = TEMPLATES.trial_ended({ storeName: t.name });
        await pool.query(
          `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.id, "trial_ended", email, template.subject, template.html, fromAddress]
        );
      }
      logger.info({ tenant: t.slug }, "Trial → grace transition");
    }

    // 3. Grace → Expired transition
    const { rows: expiredGrace } = await pool.query(
      `SELECT id, slug, name
       FROM tenants
       WHERE payment_status = 'grace'
         AND grace_ends_at < NOW()
         AND status != 'deleted'`
    );

    for (const t of expiredGrace) {
      await pool.query(
        `UPDATE tenants SET payment_status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [t.id]
      );

      const email = await getTenantEmail(pool, t.slug);
      if (email) {
        const { TEMPLATES } = require("../services/email-templates");
        const template = TEMPLATES.account_locked({ storeName: t.name });
        await pool.query(
          `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.id, "account_locked", email, template.subject, template.html, fromAddress]
        );
      }
      logger.info({ tenant: t.slug }, "Grace → expired transition (write-locked)");
    }
  } catch (err) {
    logger.error({ err }, "Trial check error");
  }
}
```

**Step 2: Call runTrialCheck in pollOnce (line 167)**

```javascript
async function pollOnce(pool, resend, logger) {
  if (stopping) return;
  try {
    await runTrialCheck(pool, logger);
    await runBillingCheck(pool, logger);
    await processQueue(pool, resend, logger);
  } catch (err) {
    logger.error({ err }, "Email worker poll error");
  }
}
```

Note: `runTrialCheck` runs on every poll (60s) but the SQL queries themselves are cheap — they only match tenants in transition states. No 24h gate needed since the state transitions are idempotent (once `payment_status` changes, the row no longer matches the query).

**Step 3: Commit**

```bash
git add backend/workers/email-worker.js
git commit -m "feat: add trial lifecycle transitions (trial→grace→expired) to email worker"
```

---

### Task 5: Add trial email templates

**Files:**
- Modify: `backend/services/email-templates.js`

**Step 1: Add 3 new template functions before the TEMPLATES registry (before line 202)**

```javascript
// -- Trial: Warning (7 days left) ------------------------------------------
function trialWarning({ storeName, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `ends in ${daysLeft} days`;
  return {
    subject: `Your Pro trial ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Trial Ending Soon", `
      <p>Hi,</p>
      <p>Your Pro trial for <strong>${storeName}</strong> ${urgency}.</p>
      <p>After your trial ends, you'll have a <strong>7-day grace period</strong> to subscribe. After that, your account will become read-only — you'll still be able to view your data, but won't be able to make sales or changes.</p>
      <p>To continue using all features, please contact us to subscribe at <strong>PKR 8,000/month per outlet</strong>.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated reminder about your SanoPOS trial.")}
    `),
  };
}

// -- Trial: Ended (grace period started) -----------------------------------
function trialEnded({ storeName }) {
  return {
    subject: `Trial ended — 7 days to subscribe — ${storeName}`,
    html: wrapEmailHtml("Trial Ended", `
      <p>Hi,</p>
      <p>Your Pro trial for <strong>${storeName}</strong> has ended.</p>
      <p>You have <strong>7 days</strong> to subscribe before your account becomes read-only. During this grace period, everything still works normally.</p>
      <p><strong>Pro plan: PKR 8,000/month per outlet.</strong></p>
      <p>Contact us to set up your subscription and keep selling without interruption.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS trial.")}
    `),
  };
}

// -- Trial: Account Locked (grace expired) ---------------------------------
function accountLocked({ storeName }) {
  return {
    subject: `Account locked — action required — ${storeName}`,
    html: wrapEmailHtml("Account Locked", `
      <p>Hi,</p>
      <p>Your Pro trial and grace period for <strong>${storeName}</strong> have ended. Your account is now <strong>read-only</strong>.</p>
      <p>You can still:</p>
      <ul style="color:#475569;line-height:2;padding-left:20px">
        <li>Log in and view all your data</li>
        <li>Export reports and sales history</li>
        <li>Submit support tickets</li>
      </ul>
      <p>To resume selling and managing your store, subscribe to the Pro plan at <strong>PKR 8,000/month per outlet</strong>.</p>
      ${btn("View Billing", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS account.")}
    `),
  };
}
```

**Step 2: Add to TEMPLATES registry (line 203)**

```javascript
const TEMPLATES = {
  drip_getting_started: dripGettingStarted,
  drip_features: dripFeatures,
  billing_payment_recorded: billingPaymentRecorded,
  billing_plan_changed: billingPlanChanged,
  billing_expiry_warning: billingExpiryWarning,
  billing_overdue: billingOverdue,
  support_received: supportReceived,
  support_resolved: supportResolved,
  trial_warning: trialWarning,
  trial_ended: trialEnded,
  account_locked: accountLocked,
  downtime,
  announcement,
};
```

**Step 3: Commit**

```bash
git add backend/services/email-templates.js
git commit -m "feat: add trial warning, trial ended, and account locked email templates"
```

---

### Task 6: Add trial info to billing status endpoint

**Files:**
- Modify: `backend/routes/billing.js` (lines 38-55)

**Step 1: Add trial info to the response (replace lines 38-55)**

```javascript
      const planRank = { free: 0, pro: 1 };
      const currentRank = planRank[tenant.plan] || 0;
      const upgradeOptions = pricing.filter((p) => (planRank[p.plan] || 0) > currentRank);

      const { rows: [pendingReq] } = await db.query(
        "SELECT id, requested_plan, requested_cycle, created_at FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
        [tenantId]
      );

      // Compute trial days remaining
      let trial_days_left = null;
      let grace_days_left = null;
      if (tenant.payment_status === "trial" && tenant.trial_ends_at) {
        trial_days_left = Math.max(0, Math.ceil((new Date(tenant.trial_ends_at) - new Date()) / 86400000));
      }
      if (tenant.payment_status === "grace" && tenant.grace_ends_at) {
        grace_days_left = Math.max(0, Math.ceil((new Date(tenant.grace_ends_at) - new Date()) / 86400000));
      }

      res.json({
        plan: tenant.plan,
        billing_cycle: tenant.billing_cycle || null,
        expires_at: tenant.plan_expires_at || null,
        trial_ends_at: tenant.trial_ends_at || null,
        grace_ends_at: tenant.grace_ends_at || null,
        payment_status: tenant.payment_status || "active",
        trial_days_left,
        grace_days_left,
        upgrade_options: upgradeOptions,
        pending_request: pendingReq || null,
      });
```

**Step 2: Commit**

```bash
git add backend/routes/billing.js
git commit -m "feat: include trial/grace days remaining in billing status response"
```

---

### Task 7: Remove Starter from admin UI

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx` (line 275)
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx` (lines 51, 219, 590)
- Modify: `frontend/src/pages/admin/AdminDashboard.jsx` (lines 332-333)

**Step 1: AdminTenantList — remove Starter option (line 275)**

Delete the line:
```html
<option value="starter">Starter</option>
```

**Step 2: AdminTenantDetail — remove Starter from plan dropdown (lines 219, 590)**

Delete both occurrences of:
```html
<option value="starter">Starter</option>
```

Also update the default payment form plan (line 51) from `"starter"` to `"pro"`:
```javascript
const [paymentForm, setPaymentForm] = useState({ plan: "pro", cycle: "monthly", amount: "", payment_method: "bank_transfer", reference_note: "" });
```

**Step 3: AdminDashboard — remove or adapt Starter count (lines 332-333)**

Find the stats section that shows plan counts. Remove the Starter card. (Check the actual AdminDashboard code for how plan counts are displayed — likely a stats query that groups by plan. Starter count will naturally be 0 for new tenants.)

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantList.jsx frontend/src/pages/admin/AdminTenantDetail.jsx frontend/src/pages/admin/AdminDashboard.jsx
git commit -m "feat: remove Starter tier from admin UI, default to Pro"
```

---

### Task 8: Update SignupPage to 2 tiers

**Files:**
- Modify: `frontend/src/pages/SignupPage.jsx`

**Step 1: Replace PLANS array (lines 6-10)**

```javascript
const PLANS = [
  { value: "free", label: "Free", desc: "1 outlet, 3 employees, 100 products", badge: null },
  { value: "pro", label: "Pro", desc: "Unlimited employees & products", badge: "45-day free trial" },
];
```

**Step 2: Update URL param validation (line 28)**

```javascript
if (planParam && ["free", "pro"].includes(planParam)) {
```

**Step 3: Update plan selection grid (lines 168-191)**

Replace the `grid grid-cols-3` with `grid grid-cols-2` and add trial badge:

```jsx
<div className="grid grid-cols-2 gap-3">
  {PLANS.map((p) => (
    <label
      key={p.value}
      className={`flex cursor-pointer flex-col items-center rounded-lg border-2 p-4 text-center transition-all ${
        form.plan === p.value
          ? "border-emerald-500 bg-emerald-50"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <input
        type="radio"
        name="plan"
        value={p.value}
        checked={form.plan === p.value}
        onChange={set("plan")}
        className="sr-only"
      />
      <span className="text-sm font-semibold text-slate-900">{p.label}</span>
      <span className="mt-0.5 text-xs text-slate-500">{p.desc}</span>
      {p.badge && (
        <span className="mt-1.5 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          {p.badge}
        </span>
      )}
    </label>
  ))}
</div>
```

**Step 4: Commit**

```bash
git add frontend/src/pages/SignupPage.jsx
git commit -m "feat: update signup page to 2-tier plan selection with trial badge"
```

---

### Task 9: Update BillingRedesign with trial banner and countdown

**Files:**
- Modify: `frontend/src/pages/redesign/BillingRedesign.jsx`

**Step 1: Rewrite BillingRedesign with trial states**

Replace the entire file content. Key additions:
- Trial countdown progress bar
- Grace period warning
- Expired state with CTA
- Remove all Starter references

```jsx
import { useState, useEffect } from "react";
import { CreditCard, ArrowUpRight, Clock, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { API_BASE } from "../../config";
import { PageShell } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";

export default function BillingRedesign() {
  const { success, error: showError } = useToast();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState("monthly");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchBilling = () => {
    fetch(`${API_BASE}/api/billing/status`)
      .then(r => r.json())
      .then(data => { setBilling(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchBilling(); }, []);

  const handleRequestUpgrade = async () => {
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/request-upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan, cycle, message: message || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      success("Upgrade request submitted! We'll be in touch shortly.");
      setShowUpgradeModal(false);
      setMessage("");
      fetchBilling();
    } catch (err) {
      showError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageShell title="Billing"><div className="animate-pulse h-40 bg-slate-100 rounded-xl" /></PageShell>;

  const planColors = { free: "bg-slate-100 text-slate-700", pro: "bg-emerald-100 text-emerald-700" };
  const statusColors = { active: "text-emerald-600", trial: "text-blue-600", grace: "text-amber-600", expired: "text-red-600", due: "text-amber-600", overdue: "text-red-600" };

  const upgradePlans = {};
  (billing?.upgrade_options || []).forEach(o => {
    if (!upgradePlans[o.plan]) upgradePlans[o.plan] = {};
    upgradePlans[o.plan][o.cycle] = o.price;
  });

  const paymentStatus = billing?.payment_status || "active";
  const isTrial = paymentStatus === "trial";
  const isGrace = paymentStatus === "grace";
  const isExpired = paymentStatus === "expired";

  return (
    <PageShell title="Billing">
      <div className="max-w-3xl space-y-6">
        {/* Trial Banner */}
        {isTrial && billing.trial_days_left != null && (
          <div className={`rounded-xl border p-5 ${billing.trial_days_left <= 7 ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={18} className={billing.trial_days_left <= 7 ? "text-amber-600" : "text-blue-600"} />
              <h2 className={`text-base font-semibold ${billing.trial_days_left <= 7 ? "text-amber-800" : "text-blue-800"}`}>
                Pro Trial — {billing.trial_days_left} {billing.trial_days_left === 1 ? "day" : "days"} remaining
              </h2>
            </div>
            <div className="w-full bg-white/60 rounded-full h-2.5 mb-3">
              <div className={`h-2.5 rounded-full ${billing.trial_days_left <= 7 ? "bg-amber-500" : "bg-blue-500"}`}
                style={{ width: `${Math.max(2, ((45 - billing.trial_days_left) / 45) * 100)}%` }} />
            </div>
            <p className="text-sm text-slate-600">
              {billing.trial_days_left <= 7
                ? "Your trial is ending soon. Subscribe to continue using all features."
                : "You have full access to all Pro features during your trial."}
            </p>
          </div>
        )}

        {/* Grace Period Banner */}
        {isGrace && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-red-800">
                Trial Expired — {billing.grace_days_left ?? 0} {(billing.grace_days_left ?? 0) === 1 ? "day" : "days"} left to subscribe
              </h2>
            </div>
            <p className="text-sm text-red-700">
              Your account will become read-only after the grace period. Subscribe now to continue selling.
              <strong> Pro plan: PKR 8,000/month per outlet.</strong>
            </p>
          </div>
        )}

        {/* Expired Banner */}
        {isExpired && (
          <div className="rounded-xl border border-red-400 bg-red-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-red-800">Subscription Expired — Account Read-Only</h2>
            </div>
            <p className="text-sm text-red-700 mb-3">
              You can still view your data and export reports, but cannot make sales or changes.
              Subscribe to restore full access.
            </p>
            <button onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors">
              Subscribe Now — PKR 8,000/mo
            </button>
          </div>
        )}

        {/* Current Plan */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard size={20} className="text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-800">Current Plan</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${planColors[billing?.plan] || planColors.free}`}>
              {billing?.plan || "free"}
            </span>
            {billing?.billing_cycle && (
              <span className="text-sm text-slate-500 capitalize">{billing.billing_cycle}</span>
            )}
            {paymentStatus !== "active" && billing?.plan !== "free" && (
              <span className={`text-sm font-semibold capitalize ${statusColors[paymentStatus] || "text-slate-600"}`}>
                {paymentStatus}
              </span>
            )}
          </div>
          {billing?.expires_at && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock size={14} />
              <span>Expires: {new Date(billing.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}
          {billing?.plan === "free" && (
            <p className="mt-3 text-sm text-slate-500">
              You're on the Free plan (1 outlet, 3 employees, 100 products). Upgrade to Pro for unlimited access.
            </p>
          )}
        </div>

        {/* Upgrade Options */}
        {Object.keys(upgradePlans).length > 0 && !billing?.pending_request && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Upgrade to Pro</h2>
            <p className="text-sm text-slate-500 mb-4">PKR 8,000/month per outlet. Unlimited employees and products. All features included.</p>
            <button
              onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors flex items-center gap-1"
            >
              Request Upgrade <ArrowUpRight size={14} />
            </button>
          </div>
        )}

        {/* Pending Request */}
        {billing?.pending_request && (
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={18} className="text-purple-600" />
              <h2 className="text-base font-semibold text-purple-700">Upgrade Request Pending</h2>
            </div>
            <p className="text-sm text-purple-600">
              You requested <span className="font-semibold capitalize">{billing.pending_request.requested_plan}</span> ({billing.pending_request.requested_cycle}) on {new Date(billing.pending_request.created_at).toLocaleDateString()}.
              We'll be in touch shortly.
            </p>
          </div>
        )}
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Request Upgrade to Pro</h3>
            <p className="text-sm text-slate-500 mb-4">PKR 8,000/month per outlet</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Message (optional)</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                rows={3} placeholder="Any questions or notes..." />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 cursor-pointer">Cancel</button>
              <button onClick={handleRequestUpgrade} disabled={submitting}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/BillingRedesign.jsx
git commit -m "feat: rewrite billing page with trial countdown, grace warning, and expired state"
```

---

### Task 10: Add subscription expired interceptor to AuthProvider

**Files:**
- Modify: `frontend/src/auth/AuthProvider.jsx` (around line 360)

**Step 1: Add subscription state to AuthProvider (after line 33)**

```javascript
const [subscriptionStatus, setSubscriptionStatus] = useState(null); // null | 'trial' | 'grace' | 'expired' | 'active'
const [subscriptionDaysLeft, setSubscriptionDaysLeft] = useState(null);
```

**Step 2: Add SUBSCRIPTION_EXPIRED detection in the fetch interceptor (after line 365, the `!response.ok` block)**

After the existing `if (!response.ok)` block that tracks `__lastFailedReqId`, add:

```javascript
      // Detect subscription expiry
      if (response.status === 403) {
        try {
          const cloned2 = response.clone();
          const body2 = await cloned2.json();
          if (body2.code === "SUBSCRIPTION_EXPIRED") {
            setSubscriptionStatus("expired");
          }
        } catch {
          // ignore parse errors
        }
      }
```

**Step 3: Fetch subscription status on boot (in the boot function, after session is loaded)**

In the boot `useEffect` (around line 172), after session is restored and user is authenticated, add a subscription status check. Find the spot where `setIsBootstrapping(false)` is called and before that, add:

```javascript
      // Check subscription status for banner
      if (IS_MULTI_TENANT && next?.token) {
        try {
          const billingRes = await nativeFetch(`${API}/api/billing/status`, {
            headers: { Authorization: `Bearer ${next.token}` },
          });
          if (billingRes.ok) {
            const billingData = await billingRes.json();
            setSubscriptionStatus(billingData.payment_status || "active");
            setSubscriptionDaysLeft(billingData.trial_days_left ?? billingData.grace_days_left ?? null);
          }
        } catch {
          // non-critical
        }
      }
```

**Step 4: Export subscription state in the context value (line 376)**

Add `subscriptionStatus` and `subscriptionDaysLeft` to the `value` useMemo:

```javascript
      subscriptionStatus,
      subscriptionDaysLeft,
```

**Step 5: Commit**

```bash
git add frontend/src/auth/AuthProvider.jsx
git commit -m "feat: add subscription status detection and state to AuthProvider"
```

---

### Task 11: Add SubscriptionBanner to App.jsx

**Files:**
- Create: `frontend/src/ui/SubscriptionBanner.jsx`
- Modify: `frontend/src/App.jsx` (line 126)

**Step 1: Create SubscriptionBanner component**

```jsx
import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock, XCircle } from "lucide-react";

export default function SubscriptionBanner() {
  const { subscriptionStatus, subscriptionDaysLeft } = useAuth();
  const navigate = useNavigate();

  if (!subscriptionStatus || subscriptionStatus === "active") return null;

  if (subscriptionStatus === "trial" && subscriptionDaysLeft != null && subscriptionDaysLeft <= 7) {
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
        <Clock size={14} />
        <span>Pro trial ends in {subscriptionDaysLeft} {subscriptionDaysLeft === 1 ? "day" : "days"}</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Subscribe now</button>
      </div>
    );
  }

  if (subscriptionStatus === "grace") {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-500 px-4 py-2 text-sm font-medium text-white">
        <AlertTriangle size={14} />
        <span>Trial expired — {subscriptionDaysLeft ?? 0} days left to subscribe</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Go to Billing</button>
      </div>
    );
  }

  if (subscriptionStatus === "expired") {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white">
        <XCircle size={14} />
        <span>Subscription expired — your account is read-only</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Subscribe to continue</button>
      </div>
    );
  }

  return null;
}
```

**Step 2: Import and render in App.jsx (after ImpersonationBanner, line 126)**

```javascript
import SubscriptionBanner from "./ui/SubscriptionBanner";
```

And in the JSX:

```jsx
    <>
    {isImpersonating && <ImpersonationBanner />}
    <SubscriptionBanner />
    <Router>
```

Note: `SubscriptionBanner` is inside `AuthProvider` context (since `App` is rendered inside `AuthProvider` in `main.jsx`), but it needs to be inside `Router` to use `useNavigate`. Move it inside the `<Router>` tag and before `<Routes>`:

```jsx
    <>
    {isImpersonating && <ImpersonationBanner />}
    <Router>
      <SubscriptionBanner />
      <Routes>
```

**Step 3: Commit**

```bash
git add frontend/src/ui/SubscriptionBanner.jsx frontend/src/App.jsx
git commit -m "feat: add global subscription status banner for trial/grace/expired states"
```

---

### Task 12: Update LandingPage pricing section

**Files:**
- Modify: `frontend/src/pages/LandingPage.jsx` (lines 301-343)

**Step 1: Replace PLANS array (lines 301-343)**

```javascript
const PLANS = [
  {
    name: "Free",
    price: "Free",
    subtitle: "For trying out SanoPOS",
    featured: false,
    limits: { outlets: 1, employees: 3, products: "100" },
    features: [
      "Full POS with barcode scanning",
      "Cash shift management",
      "Sales & inventory reports",
      "Customer loyalty & wallet",
      "All features included",
    ],
  },
  {
    name: "Pro",
    price: "PKR 8,000",
    subtitle: "Per outlet / month — 45-day free trial",
    featured: true,
    limits: { outlets: "1+ (add more)", employees: "Unlimited", products: "Unlimited" },
    features: [
      "Everything in Free",
      "Unlimited employees & products",
      "Add outlets at PKR 8,000/mo each",
      "Priority support",
      "45-day free trial included",
    ],
  },
];
```

**Step 2: Update the pricing section grid**

The landing page pricing grid currently uses `grid-cols-3`. Change to `grid-cols-2` or `sm:grid-cols-2` depending on existing responsive classes. Also update the CTA button text for Pro to say "Start Free Trial".

Find the section rendering PLANS (around line 640-720). Update the CTA:

```jsx
{price === "Free" ? "Get Started Free" : "Start 45-Day Free Trial"}
```

**Step 3: Update the `getPrice` helper (around line 441)**

Remove Starter references and handle Pro pricing:

```javascript
if (planName === "Free") return "Free";
if (planName === "Pro") return "PKR 8,000/mo";
return "...";
```

**Step 4: Commit**

```bash
git add frontend/src/pages/LandingPage.jsx
git commit -m "feat: update landing page pricing to 2 tiers with PKR 8,000/mo Pro pricing"
```

---

### Task 13: Update admin plan-defaults endpoint

**Files:**
- Modify: `backend/routes/admin.js`

**Step 1: Find and update any Starter references in admin routes**

Search for `starter` in admin.js and remove references. The `GET /api/admin/plan-defaults` endpoint returns `PLAN_DEFAULTS` directly, so it will automatically reflect the 2-tier change from Task 1.

Check the plan change/update handler for Starter validation. If it validates plan against `["free", "starter", "pro"]`, change to `["free", "pro"]`.

**Step 2: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: remove Starter tier references from admin routes"
```

---

### Task 14: Verify and test

**Step 1: Run backend build check**

```bash
cd backend && node -e "require('./middleware/plan-limits'); require('./services/email-templates'); console.log('OK')"
```

**Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: clean build, no errors.

**Step 3: Verify PLAN_DEFAULTS**

```bash
cd backend && node -e "const { PLAN_DEFAULTS } = require('./middleware/plan-limits'); console.log(JSON.stringify(PLAN_DEFAULTS, null, 2))"
```

Expected:
```json
{
  "free": { "max_outlets": 1, "max_employees": 3, "max_products": 100 },
  "pro": { "max_outlets": 1, "max_employees": 0, "max_products": 0 }
}
```

**Step 4: Verify email templates**

```bash
cd backend && node -e "const { TEMPLATES } = require('./services/email-templates'); console.log(Object.keys(TEMPLATES).join(', '))"
```

Expected: includes `trial_warning`, `trial_ended`, `account_locked`.

**Step 5: Commit final state**

```bash
git add -A
git commit -m "chore: verify SaaS Phase 1 pricing restructure — all checks pass"
```

---

### Task 15: Create branch and push

**Step 1: Create feature branch**

```bash
git checkout -b feature/saas-phase1-pricing
```

**Step 2: Push to remote**

```bash
git push -u origin feature/saas-phase1-pricing
```

---

## Summary of all changes

| Task | What | Files |
|------|------|-------|
| 1 | PLAN_DEFAULTS + requireActiveSubscription middleware | `plan-limits.js` |
| 2 | Apply middleware in route registration | `registerAllRoutes.js`, `index.js` |
| 3 | Slug reuse fix + trial provisioning on signup | `auth.js` |
| 4 | Trial state transitions in email worker | `email-worker.js` |
| 5 | Trial email templates (3 new) | `email-templates.js` |
| 6 | Billing status endpoint with trial info | `billing.js` |
| 7 | Remove Starter from admin UI | `AdminTenantList.jsx`, `AdminTenantDetail.jsx`, `AdminDashboard.jsx` |
| 8 | 2-tier signup page | `SignupPage.jsx` |
| 9 | Billing page with trial/grace/expired states | `BillingRedesign.jsx` |
| 10 | Subscription expired interceptor | `AuthProvider.jsx` |
| 11 | Global subscription banner | `SubscriptionBanner.jsx`, `App.jsx` |
| 12 | Landing page pricing update | `LandingPage.jsx` |
| 13 | Admin routes Starter cleanup | `admin.js` |
| 14 | Verify and test | — |
| 15 | Branch and push | — |

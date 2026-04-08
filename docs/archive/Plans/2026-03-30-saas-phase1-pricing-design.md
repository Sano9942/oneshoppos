# SaaS Phase 1 — Pricing Restructure & Trial System

**Date:** 2026-03-30
**Status:** Approved
**Branch:** `feature/saas-phase1-pricing`

---

## Problem

Current pricing has 3 tiers (Free/Starter/Pro) but Starter is an awkward middle — customers either want free or everything. No trial logic exists despite `trial_ends_at` column being in the DB. Soft-deleted tenant slugs can't be reused. Revenue is unprotected because paid plans have no expiry enforcement.

## Decision

Restructure to 2 tiers with per-outlet pricing and a 45-day trial for Pro.

---

## 1. Pricing Structure

| | Free | Pro |
|---|---|---|
| **Price** | PKR 0 forever | PKR 8,000/mo per outlet |
| **Outlets** | 1 | 1 included (additional @ PKR 8,000/mo each) |
| **Employees** | 3 | Unlimited (`max_employees = 0`) |
| **Products** | 100 | Unlimited (`max_products = 0`) |
| **Features** | All features unlocked | All features unlocked |
| **Trial** | None — free forever | 45-day full access trial |
| **On expiry** | N/A | 7-day grace period → write-lock |

Key changes from current:
- Starter tier removed entirely
- Free: `max_products` 500 → 100
- Pro: per-outlet pricing replaces flat tier limits
- All features available on all tiers (capacity-gated, not feature-gated)

### PLAN_DEFAULTS

```javascript
const PLAN_DEFAULTS = {
  free: { max_outlets: 1, max_employees: 3,  max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0,  max_products: 0   },
};
```

`0` = unlimited (existing convention in `plan-limits.js`).

### Per-Outlet Expansion (Pro)

Additional outlets are manual for now:
1. Customer requests via billing page or contacts support
2. Super-admin records payment in `/admin`
3. Super-admin bumps `max_outlets` by 1 on the tenant

Self-service payment integration (xPay/PostEx) deferred to Phase 5.

---

## 2. Trial Lifecycle

### State Machine

```
Signup (plan = "pro")
  │
  ├─ payment_status = 'trial'
  ├─ trial_ends_at  = NOW() + 45 days
  │
  ▼ Day 1–45: FULL ACCESS
  │  Amber banner: "X days left in your Pro trial"
  │
  ▼ Day 45: trial_ends_at reached
  │
  ├─ payment_status = 'grace'
  ├─ grace_ends_at  = trial_ends_at + 7 days
  │
  ▼ Day 45–52: FULL ACCESS (grace)
  │  Red banner: "Trial expired — 7 days left to subscribe"
  │
  ▼ Day 52: grace_ends_at reached
  │
  ├─ payment_status = 'expired'
  │
  └─ WRITE-LOCKED
     Red banner: "Subscription expired — upgrade to continue"
     Can: login, view data, export, view billing, submit support tickets
     Cannot: sell, create/edit/delete any business data
```

### Free Plan

Free plan signup: `payment_status = 'active'`, `trial_ends_at = NULL`. No trial, no expiry, forever free. Natural upgrade path when they hit 100-product or 3-employee limit.

### Reactivation

When super-admin records a payment and sets `payment_status = 'active'`:
- Write-lock lifts immediately
- `plan_expires_at` set to payment period end date
- Tenant resumes normal operations

---

## 3. Trial State Transitions (Email Worker)

The existing email worker (`workers/email-worker.js`) already runs a daily billing check. Add trial checks to this existing loop:

```
Daily check (runs once per day):
  FOR EACH tenant:
    IF payment_status = 'trial' AND trial_ends_at < NOW():
      SET payment_status = 'grace', grace_ends_at = trial_ends_at + 7 days
      SEND "trial ended" email

    IF payment_status = 'trial' AND trial_ends_at - 7 days < NOW():
      SEND "7 days left" warning email (with 24h dedup)

    IF payment_status = 'grace' AND grace_ends_at < NOW():
      SET payment_status = 'expired'
      SEND "account locked" email
```

Emails use 24h deduplication via `email_queue` (existing pattern).

---

## 4. Write-Lock Middleware

New middleware: `requireActiveSubscription`

### Applied to (write operations on business routes):
- Sales, returns
- Products, categories, brands, suppliers
- Customers
- Employees (create only — existing employees can still login)
- Outlets
- Inventory (adjustments, transfers)
- Purchase orders, GRN
- Cash shifts (open/close)
- Attendance (clock-in/out)
- Promotions, quotations, orders
- CRM activities

### NOT applied to (always allowed):
- All GET requests (view/export anything)
- Auth routes (login, refresh, logout, forgot-password)
- Billing routes (view billing, request upgrade)
- Support routes (submit tickets)
- Company profile reads
- Setup wizard (if still onboarding)

### Placement

Applied in `registerAllRoutes.js` AFTER `loadTenantAndPerms` (needs `req.tenantId`) but BEFORE individual route handlers. Applied only to POST/PUT/DELETE methods on business routes.

### Response

```json
{
  "error": "Your subscription has expired. Please subscribe to continue.",
  "code": "SUBSCRIPTION_EXPIRED",
  "billing_url": "/billing"
}
```

HTTP 403.

---

## 5. Frontend Changes

### Global Subscription Banner

In `AuthProvider.jsx` or `AppLayoutRedesign.jsx`:
- Fetch tenant subscription status on login (added to existing bootstrap/profile endpoint)
- Display persistent banner based on `payment_status`:

| Status | Banner | Style |
|---|---|---|
| `trial` (>7 days left) | "Pro trial: X days remaining" | Amber, dismissible |
| `trial` (<=7 days left) | "Pro trial ends in X days — [Subscribe now]" | Amber, not dismissible |
| `grace` | "Trial expired — X days left to subscribe [Go to Billing]" | Red, not dismissible |
| `expired` | "Subscription expired — [Subscribe to continue]" | Red, not dismissible, blocks writes |
| `active` | None | — |

### Signup Page

- Remove Starter card
- 2 options: Free / Pro
- Pro card shows: "PKR 8,000/mo per outlet" and "45-day free trial" badge
- Default selection: Free (unchanged)

### Billing Page

- Trial countdown with progress bar (days used / 45)
- Grace period warning state
- Expired state with clear CTA: "Contact us to subscribe" (manual payment for now)
- Remove Starter plan references from upgrade options

### Landing Page

- Update pricing section: 2 tiers instead of 3
- Pro pricing: "PKR 8,000/mo per outlet"
- "Start 45-day free trial" CTA on Pro card

### Admin Pages

- `AdminTenantDetail.jsx`: Remove Starter from plan dropdown
- Trial status visible in tenant detail (days remaining, current state)

### Blocked Action Handling

Global fetch interceptor in `AuthProvider.jsx`:
- Catch HTTP 403 with `code: "SUBSCRIPTION_EXPIRED"`
- Show toast: "Upgrade your plan to continue"
- Does NOT redirect — user stays on current page, just can't write

---

## 6. Slug Reuse Fix

In `routes/auth.js` signup handler, change:

```sql
-- Before:
SELECT id FROM tenants WHERE slug = $1

-- After:
SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL
```

Soft-deleted tenants no longer block new signups with the same store name.

---

## 7. Database Changes

**No new tables. No migrations.** All required columns already exist on `public.tenants`:

| Column | Exists | Usage |
|---|---|---|
| `trial_ends_at` | Yes | Set on Pro signup: `NOW() + INTERVAL '45 days'` |
| `grace_ends_at` | Yes | Set by worker when trial expires: `trial_ends_at + 7 days` |
| `payment_status` | Yes | Values: `active`, `trial`, `grace`, `expired` |
| `plan_expires_at` | Yes | Set when payment recorded (subscription end date) |

Only code changes needed.

---

## 8. Files Touched

### Backend (7 files)

| File | Changes |
|---|---|
| `middleware/plan-limits.js` | Update `PLAN_DEFAULTS` (2 tiers, new limits). Add `requireActiveSubscription` middleware. |
| `routes/auth.js` | Slug reuse fix. Set `trial_ends_at` + `payment_status = 'trial'` on Pro signup. |
| `routes/registerAllRoutes.js` | Apply `requireActiveSubscription` to business write routes. |
| `workers/email-worker.js` | Add trial→grace→expired state transitions + email sends to daily check. |
| `services/email-templates.js` | Add 3 templates: trial warning, trial ended, account locked. |
| `routes/admin.js` | Remove Starter from plan options. |
| `routes/billing.js` | Include trial status/days remaining in billing response. |

### Frontend (5 files)

| File | Changes |
|---|---|
| `pages/SignupPage.jsx` | 2-tier plan selection (remove Starter). |
| `pages/redesign/BillingRedesign.jsx` | Trial countdown, grace warning, expired state. |
| `auth/AuthProvider.jsx` | `SUBSCRIPTION_EXPIRED` interceptor + banner state. |
| `pages/LandingPage.jsx` | Update pricing section to 2 tiers. |
| `pages/admin/AdminTenantDetail.jsx` | Remove Starter from plan dropdown. |

---

## 9. Existing Tenants

- `packagesmall` and `khantoys` — delete via admin (user confirmed acceptable)
- No data migration needed for the new tier structure

---

## 10. Future (out of scope)

- **xPay/PostEx integration** — self-service payments (Phase 5)
- **Annual discount** — PKR 80,000/yr for Pro (later, when volume justifies)
- **Self-service outlet expansion** — "Add outlet" button with payment flow (needs payment gateway)

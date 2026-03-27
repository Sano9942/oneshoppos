# Subscription Billing Layer — Design Document

**Date:** 2026-03-27
**Status:** Approved
**Goal:** Enable manual subscription billing so the admin can charge tenants for Starter/Pro plans, track payments, and enforce expiry — without a payment gateway.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Payment provider | Manual/invoice-based (Phase 1) | Only 1 live tenant — automate later with Stripe |
| Billing cycles | Monthly + Annual (annual gets discount) | Standard SaaS model |
| Expiry behavior | 7-day grace period then suspend | Clear incentive to pay, suspend mechanism already exists |
| Trial model | Free plan IS the trial | Generous free tier (1 outlet, 3 employees, 500 products) avoids trial complexity |
| Tenant billing UX | Light self-service | Read-only billing page + upgrade request button |
| Pricing | Configurable via admin panel | No code changes needed to adjust prices |

## Pricing (defaults, PKR)

| Plan | Monthly | Annual | Annual Savings |
|------|---------|--------|----------------|
| Free | Free | Free | — |
| Starter | 3,000 | 30,000 | 6,000 (2 months free) |
| Pro | 8,000 | 80,000 | 16,000 (2 months free) |

---

## Data Model

All billing data lives in the **master/public schema** — no changes to tenant schemas.

### New columns on `tenants` table (migration v7)

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT;          -- 'monthly' | 'annual' | NULL (free)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ; -- when current billing period ends
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;   -- plan_expires_at + 7 days
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'active'; -- 'active' | 'due' | 'overdue' | 'suspended'
```

### New table: `plan_pricing`

```sql
CREATE TABLE IF NOT EXISTS plan_pricing (
  id            SERIAL PRIMARY KEY,
  plan          TEXT NOT NULL,            -- 'starter' | 'pro'
  cycle         TEXT NOT NULL,            -- 'monthly' | 'annual'
  price         NUMERIC(12,2) NOT NULL,
  currency_code TEXT DEFAULT 'PKR',
  is_active     BOOLEAN DEFAULT true,
  UNIQUE(plan, cycle)
);
```

Seeded with 4 rows: starter/monthly=3000, starter/annual=30000, pro/monthly=8000, pro/annual=80000.

### New table: `payment_records`

```sql
CREATE TABLE IF NOT EXISTS payment_records (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency_code   TEXT DEFAULT 'PKR',
  plan            TEXT NOT NULL,
  cycle           TEXT NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  payment_method  TEXT,                   -- 'bank_transfer' | 'jazzcash' | 'cash' | 'other'
  reference_note  TEXT,
  recorded_by     TEXT,                   -- admin email
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `upgrade_requests`

```sql
CREATE TABLE IF NOT EXISTS upgrade_requests (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  requested_plan  TEXT NOT NULL,
  requested_cycle TEXT NOT NULL,
  message         TEXT,
  status          TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'dismissed'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
```

---

## Backend — Admin Billing Endpoints

All under `/api/admin/*`, gated by `requireAllowedIp` + `requireSuperAdmin`.

### Plan Pricing

- `GET /api/admin/plan-pricing` — returns all pricing rows
- `PUT /api/admin/plan-pricing/:id` — update a price row (plan, cycle, price, is_active)

### Record Payment

- `POST /api/admin/tenants/:id/record-payment`
  - Body: `{ plan, cycle, amount, payment_method, reference_note }`
  - Sets `plan_expires_at` = NOW() + 30 days (monthly) or NOW() + 365 days (annual)
  - Sets `grace_ends_at` = `plan_expires_at` + 7 days
  - Sets `payment_status` = 'active'
  - Updates tenant plan + limits via `PLAN_DEFAULTS`
  - Inserts into `payment_records`
  - Logs to `tenant_audit_log`

### Payment History

- `GET /api/admin/tenants/:id/payments` — returns payment records for a tenant, ordered by recorded_at DESC

### Upgrade Requests

- `GET /api/admin/upgrade-requests` — all pending upgrade requests with tenant info
- `PUT /api/admin/upgrade-requests/:id` — set status to 'approved' or 'dismissed', sets resolved_at and resolved_by

### Billing Attention

- `GET /api/admin/billing-attention` — returns:
  - `due_soon`: tenants expiring within 7 days
  - `overdue`: past expiry, within grace period
  - `suspended`: past grace period (admin should suspend if not already)
  - `pending_upgrades`: count of pending upgrade requests

---

## Backend — Tenant-Facing Endpoints

Mounted AFTER tenant middleware (uses `req.tenantId`).

### Billing Status

- `GET /api/billing/status` — returns:
  ```json
  {
    "plan": "free",
    "billing_cycle": null,
    "expires_at": null,
    "payment_status": "active",
    "upgrade_options": [
      { "plan": "starter", "cycle": "monthly", "price": 3000 },
      { "plan": "starter", "cycle": "annual", "price": 30000 },
      { "plan": "pro", "cycle": "monthly", "price": 8000 },
      { "plan": "pro", "cycle": "annual", "price": 80000 }
    ]
  }
  ```

### Request Upgrade

- `POST /api/billing/request-upgrade`
  - Body: `{ plan, cycle, message? }`
  - Creates row in `upgrade_requests`
  - Rate limited: 1 pending request per tenant (rejects if existing pending request)

### Public Pricing

- `GET /api/billing/pricing` — returns active plan pricing (no auth required)
  - Used by landing page and signup page to show live prices

---

## Frontend — Tenant Billing Page

### New: `BillingRedesign.jsx`

Route: `/billing` — requires auth, any role.

**Card 1 — Current Plan:**
- Plan name + badge (Free/Starter/Pro)
- Billing cycle (Monthly/Annual) — only for paid plans
- Expiry date — only for paid plans
- Status indicator (Active / Due Soon / Overdue)
- Free plan message: "You're on the Free plan. Upgrade to unlock more."

**Card 2 — Upgrade:**
- Available plans with prices from `/api/billing/pricing`
- Monthly/Annual toggle with savings callout
- "Request Upgrade" button → modal with optional message
- If pending request exists: shows "Upgrade request pending" instead

### Nav: Add "Billing" to sidebar (Settings section)

---

## Frontend — Admin Billing UI

### AdminDashboard.jsx — "Billing Attention" card
- Counts: due soon, overdue, pending upgrade requests
- Links to tenant detail

### AdminTenantDetail.jsx — "Billing" tab
- Current plan + expiry + payment status
- "Record Payment" button → modal (plan, cycle, amount pre-filled, payment method, reference note)
- Payment history table
- Active upgrade request banner with approve/dismiss

### AdminTenantList.jsx — Enhanced columns
- "Expires" column with expiry date
- "Status" badge (active/due/overdue/suspended)
- Sortable/filterable by payment status

### LandingPage.jsx — Live pricing
- Fetch from `/api/billing/pricing` instead of hardcoded "Contact Us"
- Show actual PKR prices

---

## What's NOT Included (Phase 2)

- Stripe/JazzCash payment gateway integration
- Automated cron for expiry enforcement
- Invoice PDF generation
- Email reminders for upcoming expiry
- Trial period logic (Free plan serves as trial)
- Revenue analytics (MRR/ARR/churn)

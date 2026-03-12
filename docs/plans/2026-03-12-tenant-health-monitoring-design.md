# Tenant Health Monitoring — Design

**Date:** 2026-03-12
**Status:** Approved

## Overview

Expand the super-admin dashboard with operational and capacity visibility across all tenants. Two levels: at-a-glance health on the tenant list, and full health dashboard on the tenant detail page.

## API Changes

### Expand `GET /api/admin/tenants/:id/stats`

Returns everything in one call:

```json
{
  "stats": {
    "employees": 5, "max_employees": 10,
    "products": 120, "max_products": 500,
    "outlets": 2, "max_outlets": 3,
    "total_sales": 1847,
    "customers": 312,
    "sales_today": 23, "revenue_today": 45200,
    "sales_this_week": 156, "revenue_this_week": 312000,
    "sales_this_month": 589, "revenue_this_month": 1180000,
    "last_login": "2026-03-12T14:30:00Z",
    "last_sale": "2026-03-12T13:45:00Z",
    "last_shift_opened": "2026-03-12T08:00:00Z",
    "active_employees_7d": 4,
    "active_employees_30d": 5,
    "schema_size_mb": 12.4
  }
}
```

Sources:
- `last_login`: `MAX(timestamp)` from `action_history` where `action_type = 'login'`
- `last_sale`: `MAX(timestamp)` from `sales`
- `last_shift_opened`: `MAX(opened_at)` from `cash_shifts`
- `sales_today/week/month` + `revenue_*`: `COUNT/SUM` from `sales` with date filters
- `active_employees_7d/30d`: `COUNT(DISTINCT employee_id)` from `action_history` with date window
- `schema_size_mb`: `SELECT pg_total_relation_size(schemaname || '.' || tablename)` summed across tenant schema tables from `pg_tables`
- Plan limits: joined from `tenants` table (`max_employees`, `max_products`, `max_outlets`)

### New `GET /api/admin/attention`

Bulk health query across all active tenants. Returns tenants that need attention:

```json
{
  "approaching_limits": [
    { "id": 3, "slug": "acme", "name": "Acme Store", "dimension": "products", "used": 450, "max": 500 }
  ],
  "dormant": [
    { "id": 7, "slug": "zstore", "name": "Z Store", "last_login": "2026-02-25T10:00:00Z", "days_inactive": 15 }
  ],
  "setup_pending": [
    { "id": 12, "slug": "newshop", "name": "New Shop", "created_at": "2026-03-10T09:00:00Z" }
  ]
}
```

- `approaching_limits`: any tenant where employees/products/outlets > 85% of plan max
- `dormant`: no login in 14+ days (based on `last_login` from each tenant's `action_history`)
- `setup_pending`: tenants where `setup_complete = false`

### Expand `GET /api/admin/stats`

Add `last_login` per tenant in `recent_tenants` array so `AdminTenantList` can show health dots without N+1 queries:

```json
{
  "tenants": [
    { "id": 1, "slug": "acme", "name": "Acme", "plan": "pro", "status": "active",
      "last_login": "2026-03-12T14:30:00Z", "revenue_this_month": 1180000, "setup_complete": true }
  ]
}
```

Or a new `GET /api/admin/tenants` endpoint that returns all tenants with summary health fields, if the existing list endpoint doesn't suffice.

## Frontend — AdminTenantDetail Health Dashboard

Replace current simple stats cards with three sections:

### 1. Activity Section
- Last login (relative time: "2 hours ago")
- Last sale (relative time)
- Last shift opened (relative time)
- Sales today / this week / this month (with revenue in currency)
- Active employees 7d / 30d

### 2. Plan Usage Section
- Three horizontal progress bars: Employees, Products, Outlets
- Each shows `used / max` label
- Color coding: green <70%, amber 70-90%, red >90%

### 3. Storage Section
- Schema size in MB — single stat with database icon

## Frontend — AdminTenantList

- **Health dot column**: green (login <24h), amber (login <7d), red (no login 7d+), grey (setup pending)
- **Revenue column**: `revenue_this_month` — sortable
- **Last activity column**: relative time of `last_login`

## Frontend — AdminDashboard

- **"Needs Attention" card**: three sub-sections — approaching limits (count + "View" link), dormant tenants (count + "View" link), setup pending (count + "View" link). Powered by `GET /api/admin/attention`.

## Files Touched

- `backend/routes/admin.js` — expand per-tenant stats query, new `/api/admin/attention` endpoint, expand tenant list query
- `frontend/src/pages/admin/AdminDashboard.jsx` — "Needs Attention" card
- `frontend/src/pages/admin/AdminTenantDetail.jsx` — full health dashboard (activity, capacity bars, storage)
- `frontend/src/pages/admin/AdminTenantList.jsx` — health dot + revenue column + last activity column

## Not in Scope

- Failed job tracking (no job failure logging infrastructure exists)
- Email alerts when plan limits approached (future enhancement)
- Setup step tracking for abandoned wizards (would need schema change)
- Real-time websocket updates for health metrics

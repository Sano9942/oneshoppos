# Infrastructure Monitoring for Super-Admin Dashboard

**Date:** 2026-03-15
**Goal:** Add database and connection monitoring to the super-admin dashboard so ops issues are visible before they cause outages.

---

## Backend: `GET /api/admin/infra`

New endpoint in `admin.js`, gated by `requireAllowedIp` + `requireSuperAdmin`. Runs Postgres system queries in parallel:

### Queries

| # | Source | Data | Extension? |
|---|--------|------|------------|
| 1 | `pg_stat_activity` | Active, idle, total connections | No |
| 2 | `pg_settings WHERE name = 'max_connections'` | Max allowed connections | No |
| 3 | `pg_database_size(current_database())` | Total DB size in bytes | No |
| 4 | `pg_stat_activity WHERE state != 'idle' AND query_start < now() - interval '1s'` | Currently slow queries (>1s) | No |
| 5 | `pg_statio_user_tables` | Cache hit ratio (heap_blks_hit vs heap_blks_read) | No |
| 6 | `pg_stat_user_tables` | Dead tuples, last autovacuum per table | No |
| 7 | Per-schema size (already used in tenant stats) | Schema sizes | No |
| 8 | `pg_stat_statements` | Top 10 slowest queries by mean_exec_time | Yes — try/catch, skip if unavailable |

### Response Shape

```json
{
  "connections": {
    "active": 5,
    "idle": 8,
    "total": 13,
    "max": 60
  },
  "database": {
    "size_mb": 124.5,
    "name": "postgres"
  },
  "cache": {
    "hit_ratio": 99.2
  },
  "slow_queries_now": [
    { "pid": 1234, "duration_s": 3.2, "query": "SELECT ...", "state": "active", "username": "..." }
  ],
  "table_health": {
    "total_dead_tuples": 12500,
    "tables_needing_vacuum": 3,
    "worst_tables": [
      { "schema": "tenant_packagesmall", "table": "sales", "dead_tuples": 5000, "last_autovacuum": "2026-03-14T..." }
    ]
  },
  "schema_sizes": [
    { "schema": "tenant_packagesmall", "size_mb": 45.2 },
    { "schema": "public", "size_mb": 0.3 }
  ],
  "slow_queries_historical": [
    { "query": "SELECT ...", "calls": 150, "mean_time_ms": 450, "total_time_ms": 67500 }
  ]
}
```

## Frontend: Infrastructure section in `AdminDashboard.jsx`

New card below "Needs Attention" with sections:

1. **Connections** — bar showing active/max with color (green <60%, amber 60-80%, red >80%)
2. **Database Size** — total MB with per-tenant breakdown
3. **Cache Hit Ratio** — percentage, red if <95%
4. **Table Health** — dead tuple count, tables needing vacuum
5. **Active Slow Queries** — list of queries running >1s right now
6. **Historical Slow Queries** — top 10 by avg time (if pg_stat_statements available)

Auto-refreshes every 30 seconds.

## Files Changed

| File | Change |
|------|--------|
| `backend/routes/admin.js` | Add `GET /api/admin/infra` endpoint |
| `frontend/src/pages/admin/AdminDashboard.jsx` | Add Infrastructure section |

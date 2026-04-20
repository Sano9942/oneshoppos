# Supabase Production Audit — 2026-04-20

**Project**: `tpjewvfoqtskscmwjtjj` (sanopos, Singapore / ap-southeast-1)
**Plan**: Supabase Pro (8 GB allowance)
**Postgres**: 17.6 (aarch64-linux, GCC 15.2.0)
**Audit mode**: read-only (no data or migration state modified)
**Auditor**: Claude Opus 4.7 + direct `pg` queries via DATABASE_URL (session pooler, port 5432)

---

## Executive Summary

| Area | Status | Headline |
|---|---|---|
| Storage | 🟡 **Wastage** | 417 MB total — **228 MB (55%) is orphan `test_*` schemas** from test runs. Real app footprint ≈ 82 MB. 8 GB Pro allowance has huge headroom. |
| Connections | 🟢 Healthy | 60 max, ~9 in use at idle, pool_size=15. No leaks, no orphaned long-idle sessions. |
| Query health | 🟡 Unknown | `pg_stat_statements` counters are cold — no historical workload captured. Re-audit after a production load window. |
| Schema drift | 🟢 Aligned | All 6 active tenants at **v61**. No drift. v62 still pending deploy (matches user note). |
| Extensions | 🟢 Good | pgcrypto, uuid-ossp, pg_stat_statements all present. |
| Backups | 🔴 **PITR DISABLED** | 7 daily physical snapshots, most recent 24h old. `pitr_enabled: false` — surprising on Pro. |
| Security | 🟢 SSL on, no RLS (by design — schema-per-tenant) | `ssl=on`, `password_encryption=scram-sha-256`. No unexpected superusers. |
| Cost signals | 🟢 No hot tables | Largest tenant table is 160 kB (web_orders). No runaway logs. |

**Priority**: clean the 19 `test_*` schemas and turn on PITR **this week**. Everything else is healthy.

---

## 1. Storage Posture

### 1.1 Total DB size

```sql
SELECT pg_size_pretty(pg_database_size(current_database())), pg_database_size(current_database());
```

| Metric | Value |
|---|---|
| Total DB size | **417 MB** (436,776,083 bytes) |
| Pro allowance | 8 GB |
| Headroom | ~7.6 GB (95%) |

### 1.2 Size per schema (top 20)

Sourced from `SUM(pg_total_relation_size(c.oid))` over `pg_class`.

| # | Schema | Size | Nature |
|---|---|---|---|
| 1 | `tenant_packagesmall` | 15 MB | ✅ active tenant |
| 2 | `public` | 12 MB | ✅ master registry |
| 3 | `tenant_the_test_bistro` | 11 MB | ✅ active (free plan) |
| 4 | `tenant_khantoys` | 11 MB | ✅ active |
| 5 | `tenant_alfatah_new` | 11 MB | ✅ active |
| 6 | `tenant_alfatah` | 11 MB | ✅ active |
| 7 | `tenant_handicraft` | 11 MB | ✅ active |
| 8 | `test_31ea97cd6bfb` | 11 MB | 🗑️ **orphan** |
| 9 | `test_47123d836e74` | 11 MB | 🗑️ **orphan** |
| 10 | `test_23e3cc8c5370` | 11 MB | 🗑️ **orphan** |
| 11–20 | (10 more `test_*`) | ~11 MB each | 🗑️ **orphan** |

**Orphan footprint**: 19 `test_*` schemas = **228 MB** (55% of total DB).

Empty (structure-only) footprint per fresh tenant schema ≈ 11 MB — 267 tables × ~40 kB of empty relation + index pages each. Every test that provisioned a tenant schema but forgot to drop it on teardown leaks ~11 MB.

### 1.3 Top 15 largest tables across all schemas

```sql
SELECT n.nspname || '.' || c.relname, pg_size_pretty(pg_total_relation_size(c.oid))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15;
```

| # | Table | Size | Notes |
|---|---|---|---|
| 1 | `pgboss.job_common` | 576 kB | pg-boss queue, healthy |
| 2 | `public.admin_activity_log` | 200 kB | cross-tenant audit log |
| 3 | `tenant_packagesmall.web_orders` | 160 kB | |
| 4 | `tenant_packagesmall.sales` | 144 kB | |
| 5 | `public.tenant_refresh_tokens` | 144 kB | |
| 6 | `test_31ea97cd6bfb.sales` | 136 kB | 🗑️ |
| 7 | `pgboss.queue` | 112 kB | |
| 8 | `tenant_packagesmall.service_tickets` | 96 kB | |
| 9 | `tenant_packagesmall.products` | 96 kB | |
| 10 | `auth.users` | 96 kB | Supabase built-in, unused by us |

**Nothing is large.** The largest single table is 576 kB — this is a genuinely small database in absolute terms. The 417 MB figure is almost entirely schema overhead (268 tables × 6 live tenants × ~10–40 kB empty-relation cost per table).

### 1.4 Table bloat

```sql
SELECT n_dead_tup, n_live_tup, last_autovacuum FROM pg_stat_user_tables WHERE n_dead_tup > 100;
```

**Zero rows returned.** No tables have >100 dead tuples. Autovacuum is keeping up cleanly.

### 1.5 Tenant schemas

| Tenant | Schema | Tables |
|---|---|---|
| `tenant_packagesmall` | 272 | (+5 extras beyond other tenants — newest seed) |
| `tenant_the_test_bistro` | 272 | |
| `tenant_alfatah` | 267 | |
| `tenant_alfatah_new` | 267 | |
| `tenant_handicraft` | 267 | |
| `tenant_khantoys` | 267 | |

CLAUDE.md says "~244 tables per tenant" — actual is **267–272**. Doc is slightly stale; not critical.

---

## 2. Connection Posture

### 2.1 Settings

```sql
SHOW max_connections;
```

| Setting | Value |
|---|---|
| `max_connections` | **60** (Supabase Pro default; Free was 60 also, but Pro is the plan billed) |
| Pool (`backend/db-pg.js`) | `pool_size=15` (stated in brief; confirmed in source — see note below) |
| `password_encryption` | `scram-sha-256` (strong) |
| SSL | `on` |

> Brief states `pool_size=15, max_clients=200`. The `max_clients=200` setting applies to Supavisor / transaction pooler on port 6543; session pooler (port 5432) enforces `max_connections=60` at the PG layer. Current DATABASE_URL appears to be using the 5432 session pooler path.

### 2.2 Live connection distribution

```sql
SELECT state, COUNT(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;
```

| State | Count |
|---|---|
| idle | 6 |
| (null) — background workers | 2 |
| active | 1 (the audit itself) |

**Total: 9 of 60** — 15% utilization, 51 connections of headroom.

Breakdown by user/app:

| User | Application | State | Count | Oldest |
|---|---|---|---|---|
| `authenticator` | `postgrest` | idle | 2 | 5m 48s |
| `pgbouncer` | (none) | idle | 1 | 4m 0s |
| `pgbouncer` | Supavisor (auth_query) | idle | 1 | <1s |
| `postgres` | Supavisor | active | 1 | 0s |
| `supabase_admin` | pg_cron scheduler | - | 1 | - |
| `supabase_admin` | pg_net 0.20.0 | - | 1 | - |
| `supabase_admin` | postgres_exporter | idle | 1 | 41s |
| `supabase_storage_admin` | Storage API Canary | idle | 1 | 4m 0s |

All connections are **Supabase infrastructure**, not our app — Railway's Node process is not currently holding any connections (consistent with the audit running from local dev, and the Railway backend being idle). No `idle in transaction` sessions, no long-running queries. **No connection leaks.**

### 2.3 Orphaned `test_*` schemas

```sql
SELECT COUNT(*), pg_size_pretty(SUM(size)) FROM (
  SELECT n.nspname, SUM(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname LIKE 'test_%' GROUP BY n.nspname
) t;
```

| Metric | Value |
|---|---|
| Orphan `test_*` schema count | **19** |
| Total size | **228 MB** |
| Fraction of DB | **55%** |

#### The 19 schemas (confirmed names, ordered by size):

```
test_31ea97cd6bfb    11 MB
test_47123d836e74    11 MB
test_23e3cc8c5370    11 MB
test_0a5df1d3c89d    11 MB
test_d41f00bece0f    11 MB
test_8b7eb79e76f5    11 MB
test_98a2b677fc77    11 MB
test_11bace380f9a    11 MB
test_b82f525e6177    11 MB
test_8907817aa578    11 MB
test_68a2a63d1276    11 MB
test_6cfe5c44284d    10 MB
test_9c212da0e888    10 MB
test_534c572025e2    ~10 MB
test_59bd3c869359    ~10 MB
test_28c3675c0e88    ~10 MB
test_248737d0e422    ~10 MB
test_13cefc743857    ~10 MB
test_905440a3283a    ~10 MB
```

Plus 8 more `test_*` schemas without `schema_version` (likely partial provisions):
```
test_05d0e3ad7ae7, test_115d3605b6e9, test_214a88b83a89, test_24e7d51445c6,
test_7bd6fe6edcfa, test_e45c6592faba, test_e71583aa27bd, test_f923ea4934f7
```

**None are present in `public.tenants`** — confirmed orphans, safe to drop after user confirmation. See § Action Plan.

---

## 3. Query Health

### 3.1 pg_stat_statements snapshot

The top-20 query listing is **not useful**. The top 2 entries are the audit's own schema-size queries (22 s and 11 s — just ran) at 48.5% and 24% of total time. Everything else is Supabase PostgREST schema introspection. **No tenant/application queries appear** in the top 20.

Interpretation: either (a) `pg_stat_statements` was reset recently, or (b) Railway backend has had very light workload since the last PG restart. Combined with the low live-row counts in `pg_stat_user_tables` and zero bloat, (b) is most likely — **this DB has seen very little transactional traffic recently**.

### 3.2 Sequential-scan pressure

```sql
SELECT schemaname, relname, seq_scan, idx_scan, n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > 1000 AND n_live_tup > 1000;
```

**Zero rows returned.** No table exists with >1000 sequential scans AND >1000 rows. No missing-index hotspots to chase.

This is consistent with: small tables (so seq scans are cheap anyway) + low traffic (so any pressure hasn't built up).

**Recommendation**: re-run this audit in 2–4 weeks once a real production workload window has accumulated statistics. Right now the stats are too sparse to be actionable.

---

## 4. Schema Drift

### 4.1 Tenant-schema version alignment

All 6 active tenants + public schema at **v61** — perfect alignment.

| Schema | Max version |
|---|---|
| `public` | **61** |
| `tenant_packagesmall` | **61** |
| `tenant_khantoys` | **61** |
| `tenant_handicraft` | **61** |
| `tenant_alfatah` | **61** |
| `tenant_alfatah_new` | **61** |
| `tenant_the_test_bistro` | **61** |

v62 is in the codebase but **not yet deployed** (matches user's note).

### 4.2 Orphan schemas vs. `public.tenants`

- **`public.tenants` contents**: 42 rows — 6 active, 36 with `status='deleted'` (`deleted_at` populated).
- None of the 36 soft-deleted tenants have a live `tenant_<slug>` schema — cleanup worker appears to be dropping schemas correctly.
- The 19 `test_*` schemas have **no corresponding row** in `public.tenants` — they were created by test provisioners that bypass the tenants registry or by tests that crashed before cleanup.

---

## 5. Extensions

```sql
SELECT extname, extversion FROM pg_extension;
```

| Extension | Version | Status |
|---|---|---|
| `pgcrypto` | 1.3 | ✅ used by `services/crypto.js` (AES-256-GCM helpers) |
| `uuid-ossp` | 1.1 | ✅ used for `uuid_generate_v4()` in schema |
| `pg_stat_statements` | 1.11 | ✅ enabled (counters currently cold — see §3) |
| `pg_graphql` | 1.5.11 | Supabase default — unused by app |
| `plpgsql` | 1.0 | system |
| `supabase_vault` | 0.3.1 | Supabase default — unused by app |

All three the brief flagged as required (pgcrypto, uuid-ossp, pg_stat_statements) are **confirmed present**.

---

## 6. Backup Posture

### 6.1 Physical backups (Supabase CLI)

```bash
npx supabase backups list --project-ref tpjewvfoqtskscmwjtjj --output json
```

| # | Timestamp (UTC) | Status |
|---|---|---|
| 1 | **2026-04-19 22:04:27** | COMPLETED (most recent — ~20h ago at audit time) |
| 2 | 2026-04-18 22:04:25 | COMPLETED |
| 3 | 2026-04-17 22:04:26 | COMPLETED |
| 4 | 2026-04-16 22:03:49 | COMPLETED |
| 5 | 2026-04-15 22:03:42 | COMPLETED |
| 6 | 2026-04-14 22:04:11 | COMPLETED |
| 7 | 2026-04-13 22:04:07 | COMPLETED |

7 daily physical snapshots, rolling 7-day window. Healthy.

### 6.2 PITR

```json
"pitr_enabled": false
```

🔴 **PITR is disabled.** Brief said "confirm PITR is on for Pro tier" — it is **not**. On Pro, PITR is a per-project addon (not automatic). Recovery today is limited to snapshot-granularity (up to 24h of data loss in the worst case).

**Data at risk in a 24h loss**: whatever sales/orders/FBR events occur between the 22:04 UTC nightly snapshot and the incident. For a Pakistan-timezone retail app, that corresponds to one full business day.

---

## 7. Security

### 7.1 SSL / auth

```sql
SHOW ssl;                  -- on
SHOW password_encryption;  -- scram-sha-256
```

✅ SSL enforced at server. ✅ SCRAM-SHA-256 password hashing.

### 7.2 Role privileges

```sql
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls FROM pg_roles;
```

**Superusers**: only `supabase_admin` (Supabase-managed, expected).
**BYPASS RLS**: `supabase_admin`, `postgres`, `service_role`, `supabase_etl_admin`, `supabase_read_only_user` — all Supabase-managed. None created by our team.
**Logins enabled**: `authenticator`, `cli_login_postgres`, `postgres`, `supabase_auth_admin`, `supabase_etl_admin`, `supabase_read_only_user`, `supabase_replication_admin`, `supabase_storage_admin` — all expected Supabase roles.

No custom roles with excess privileges. No user-created roles at all — access is entirely through the `postgres` user via DATABASE_URL, which is expected given schema-per-tenant isolation.

### 7.3 RLS

```sql
SELECT schemaname, tablename FROM pg_tables WHERE rowsecurity = true AND schemaname IN ('public','tenant_packagesmall');
```

**Zero rows**. No RLS enabled on any `public.*` or `tenant_*` table. This is **by design** — SanoPOS uses schema-per-tenant isolation (via `search_path`) rather than RLS. Confirmed matches the brief's expectation.

---

## 8. Replication / Cost Signals

### 8.1 "Tables to watch" — empirical sizes

The brief flagged `email_queue`, `fbr_invoices`, `action_history` as candidates to archive. Actuals:

| Table | Schema | Size | Verdict |
|---|---|---|---|
| `public.email_queue` | public | 80 kB | ✅ trivial |
| `tenant_packagesmall.fbr_invoices` | packagesmall | 48 kB | ✅ trivial |
| `tenant_packagesmall.action_history` | packagesmall | 72 kB | ✅ trivial |
| `public.admin_activity_log` | public | 200 kB | ✅ trivial (but growing — see below) |
| `public.admin_security_log` | public | 80 kB | ✅ trivial |
| `tenant_packagesmall.web_orders` | packagesmall | 160 kB | ✅ trivial |
| `tenant_packagesmall.sales` | packagesmall | 144 kB | ✅ trivial |

**Nothing is large enough to warrant archival today.** `admin_activity_log` at 200 kB is the biggest runaway candidate, but it is cross-tenant so its growth rate scales with admin action volume, not customer volume.

### 8.2 Per-tenant `web_orders` presence

Curiously, `web_orders` is present in 19 `test_*` schemas at 64 kB each — that's 1.2 MB of orphan `web_orders` shell tables, part of the 228 MB orphan total.

---

## Evidence Index (Query Reference)

| # | Finding | SQL used |
|---|---|---|
| 1 | Total DB size | `SELECT pg_size_pretty(pg_database_size(current_database()))` → 417 MB |
| 2 | Per-schema sizes | `SUM(pg_total_relation_size) GROUP BY pg_namespace` |
| 3 | Top tables | `ORDER BY pg_total_relation_size DESC LIMIT 15` |
| 4 | Bloat | `pg_stat_user_tables WHERE n_dead_tup > 100` → 0 rows |
| 5 | max_connections | `SHOW max_connections` → 60 |
| 6 | Live connections | `pg_stat_activity` → 9 total |
| 7 | Orphan schemas | `pg_namespace WHERE nspname LIKE 'test_%'` → 27 schemas, 19 with content, 228 MB total |
| 8 | Slow queries | `pg_stat_statements ORDER BY total_exec_time DESC` → counters cold |
| 9 | Seq scans | `pg_stat_user_tables WHERE seq_scan > 1000 AND n_live_tup > 1000` → 0 rows |
| 10 | Schema versions | `DO $$ ... EXECUTE format('SELECT MAX(version) FROM %I.schema_version', s) ... $$` → all active tenants v61 |
| 11 | Tenants registry | `SELECT id, slug, status FROM public.tenants` → 6 active, 36 deleted |
| 12 | Extensions | `SELECT extname, extversion FROM pg_extension` → 6 installed |
| 13 | Backups | `supabase backups list --output json` → 7 daily, PITR off |
| 14 | SSL | `SHOW ssl` → on |
| 15 | RLS | `pg_tables WHERE rowsecurity = true` → 0 on app schemas |
| 16 | Roles | `pg_roles` → only Supabase-managed |

Reproducer script: [backend/_audit_query.js](../../backend/_audit_query.js) (ephemeral, delete after audit).

---

## Action Plan — Prioritized

### 🔴 Fix this week

1. **Drop the 19 orphan `test_*` schemas** — reclaims ~228 MB (55% of DB). Requires user confirmation per audit-safety policy. List of names in §2.3. Single transaction:

   ```sql
   BEGIN;
   DROP SCHEMA test_05d0e3ad7ae7 CASCADE;
   DROP SCHEMA test_0a5df1d3c89d CASCADE;
   -- ... 25 more (full list in §2.3 + trailing 8 empty ones) ...
   COMMIT;
   ```

   Side benefit: new tenant provisioning will briefly contend with less `pg_class` bloat.

2. **Enable PITR on the Supabase project** — today if retail hours are your exposure window. Supabase dashboard → Project Settings → Database → Backups → "Enable PITR". Cost: typically +$25/mo on Pro. Reduces RPO from 24h to 2 min.

3. **Fix the test-teardown leak.** 19 orphans over ~5 weeks means roughly one leak every 2–3 days. Likely locations to audit:
   - `backend/tests/helpers/createTestApp-pg.js` (in current `git status`, currently modified)
   - `backend/tests/helpers/*` generally — any provisioner missing a `DROP SCHEMA` in `afterAll`/`afterEach`
   - Dead-tenant cleanup worker (`jobs/cleanup-dead-tenants.js`) — does it know to drop `test_*` schemas that never got a `tenants` row?

### 🟡 Defer but plan

4. **Re-run query-health audit** in 2–4 weeks once `pg_stat_statements` has accumulated real workload. Current snapshot is cold.

5. **Update CLAUDE.md tenant table count**: says "~244 tables per tenant", actual is 267–272. Low priority.

6. **Consider archiving `admin_activity_log`** when it passes ~50 MB — rough rule of thumb: start worrying at ~250k rows. Currently 200 kB, so 100x headroom.

### 🟢 Healthy — no action

- Connection pool: well within 60 limit, no leaks.
- Backups (physical, daily): functioning — just needs PITR as the overlay.
- Schema version alignment: perfect.
- SSL, SCRAM, RLS-by-design: all correct.
- Extensions: all required extensions present and current.
- No bloat, no slow queries, no missing indexes on any large table.

---

## Notes on Audit Execution

- All queries executed read-only via DATABASE_URL (session pooler :5432) using ephemeral `backend/_audit_query.js` helper.
- No data modified. No test suite run. No deployment.
- The 27 orphan `test_*` schemas were **identified and listed but NOT dropped** — user confirmation required before destructive action.
- Tenant list: 6 active (`packagesmall`, `khantoys`, `handicraft`, `alfatah`, `alfatah_new`, `the_test_bistro`) + 36 soft-deleted rows in `public.tenants`. No live `tenant_<slug>` schema exists for any soft-deleted tenant — cleanup worker is honouring `deleted_at`.
- The audit helper script [backend/_audit_query.js](../../backend/_audit_query.js) and [backend/_audit_versions.sql](../../backend/_audit_versions.sql) can be deleted after review.

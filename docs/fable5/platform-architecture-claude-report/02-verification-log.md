# Verification Log — live production evidence

> **Captured 2026-07-29** against production, at repo commit `3b84732d`.
> Every command below is **read-only** and safe to re-run. This file exists so a future reader can re-check the report's live claims rather than trusting a dated number.

Findings in the main report graded **CONFIRMED (live)** were established here.

---

## 1. Deployment state

| Check | Result (2026-07-29) |
|---|---|
| Backend health | `200`, 0.70 s |
| Backend deep health | `{"status":"ok"}` — database 38 ms, resend 362 ms |
| Frontend | `200` |
| Vercel production deploy | READY on `3b84732d` — same commit as local main |
| Railway project / service | `zealous-friendship` / `oneshoppos`, environment `production` |

```bash
curl -s -o /dev/null -w "health: %{http_code} in %{time_total}s\n" "https://api.sanopos.com/api/health"
curl -s "https://api.sanopos.com/api/health?deep=true"
curl -s -o /dev/null -w "frontend: %{http_code}\n" "https://sanopos.com"
railway status
```

---

## 2. Tenancy and migration state

| Check | Result |
|---|---|
| Tenant registry rows | 36 total, **29 active** |
| Tenant schemas | 29 |
| Migration version across all tenant schemas | **min 137 / max 137** — no drift |
| Public schema version | 137 |
| Plan split | 31 free / 5 paid |
| Expired tenants | 0 |

```sql
-- tenant counts
SELECT count(*) AS total, count(*) FILTER (WHERE status='active') AS active FROM public.tenants;

-- migration version across every tenant schema (the drift check)
WITH tenant_schemas AS (
  SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'
), versions AS (
  SELECT nspname,
    (xpath('/row/max/text()', query_to_xml(
      format('SELECT max(version) FROM %I.schema_version', nspname), false, true, '')))[1]::text::int AS v
  FROM tenant_schemas
)
SELECT min(v) AS min_version, max(v) AS max_version, count(*) AS tenant_schema_count FROM versions;
```

**Interpretation.** `migrateAllTenants()` catches per-tenant failures and continues, so a partially-migrated fleet is a possible steady state whose only signal is a log line. This query is the cheap way to detect that. On 2026-07-29 it was clean.

---

## 3. Database capacity — contradicts project docs

| Check | Result |
|---|---|
| Postgres version | **17.6** |
| **`max_connections`** | **60** ⚠️ *(docs assumed ~200)* |
| Current connections | 26 |
| `shared_buffers` | 32768 (256 MB) |
| Session `TimeZone` | UTC |
| Database size | 577 MB |
| Supavisor (transaction pooler) present | Yes |

```sql
SELECT name, setting FROM pg_settings
WHERE name IN ('max_connections','shared_buffers','server_version','TimeZone');

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
 (SELECT count(*) FROM pg_stat_activity) AS connections,
 (SELECT count(DISTINCT application_name) FROM pg_stat_activity
    WHERE application_name ILIKE '%supavisor%') AS pooler_present;
```

**Interpretation.** The app pool is hardcoded at 20 (`backend/db-pg.js`), plus pg-boss's own direct connections (it needs `LISTEN`, so it bypasses the pooler) and Supavisor overhead. Any capacity projection derived from a ~200-connection assumption must be recomputed.

---

## 4. Catalog size and RLS coverage

| Check | Result |
|---|---|
| Tables in `public` | 334 |
| **Public tables without RLS** | **0** — the every-deploy sweep is working |
| Tenant tables (all schemas) | 9,350 (~322 per tenant) |
| Tenant indexes (all schemas) | 20,792 (~717 per tenant) |

```sql
WITH s AS (SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%')
SELECT
 (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS public_tables,
 (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=false) AS public_without_rls,
 (SELECT count(*) FROM pg_tables t JOIN s ON t.schemaname=s.nspname) AS tenant_tables,
 (SELECT count(*) FROM pg_indexes i JOIN s ON i.schemaname=s.nspname) AS tenant_indexes;
```

---

## 5. Public-schema shadow tables — CONFIRMED

The `public` schema carries the **entire tenant DDL** because `migrateAllTenants()` runs the same `MIGRATIONS` array (including v1, which executes all of `schema-pg.sql`) against `public` first.

| Check | Result |
|---|---|
| `public.sales` exists | **true** — 0 rows |
| `public.customers` exists | **true** — 0 rows |
| `public.products` exists | **true** | 
| `public.company_profile` exists | **true** |

```sql
SELECT
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sales') AS public_has_sales,
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customers') AS public_has_customers,
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='products') AS public_has_products,
 (SELECT count(*) FROM public.sales) AS rows_in_public_sales,
 (SELECT count(*) FROM public.customers) AS rows_in_public_customers;
```

**Interpretation.** No data is exposed — the shadow tables are empty and RLS is enabled on all 334. But this is why `migrate-pg.js` needs ~74 `information_schema` guards and ~77 `current_schema()` checks to make the public pass a no-op.

---

## 6. Shopify webhook unreachable — CONFIRMED

The decisive test is the **contrast** between two webhooks. A *reachable* webhook rejects on **signature**; an *unreachable* one rejects on **auth**.

```bash
# Target: mounts AFTER the tenant wall
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "https://api.sanopos.com/api/integrations/shopify/webhooks/orders-create" \
  -H "Content-Type: application/json" \
  -H "x-shopify-hmac-sha256: invalid" \
  -H "x-shopify-shop-domain: test.myshopify.com" \
  -d '{"id":1}'

# Control: mounts BEFORE the tenant wall
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "https://api.sanopos.com/api/webhooks/xpay" \
  -H "Content-Type: application/json" -d '{"test":1}'
```

| Endpoint | Result | Meaning |
|---|---|---|
| Shopify `orders-create` | **`401 {"error":"Authentication required","code":"AUTH_REQUIRED"}`** | Blocked by tenant wall — HMAC check never runs |
| xpay (control) | `400 {"error":"Invalid signature"}` | Reachable, signature enforced correctly |

**Blast radius: zero today.**

```sql
WITH s AS (SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'),
conns AS (
  SELECT (xpath('/row/c/text()', query_to_xml(
    format('SELECT count(*) AS c FROM %I.shopify_connections WHERE is_active = true', nspname),
    false, true, '')))[1]::text::int AS active
  FROM s
  WHERE EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = s.nspname AND t.tablename = 'shopify_connections')
)
SELECT count(*) AS schemas_with_table, coalesce(sum(active),0) AS active_connections FROM conns;
```
→ `29 schemas, 0 active connections`. Breaks the first merchant who connects Shopify.

---

## 7. `/api/feature-flags` unauthenticated — CONFIRMED

```bash
# forged header value, no JWT
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://api.sanopos.com/api/feature-flags?tenant=livetestauto" -H "x-employee-id: 1"

# control: no header
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://api.sanopos.com/api/feature-flags?tenant=livetestauto"

# existence oracle
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://api.sanopos.com/api/feature-flags?tenant=definitelynotarealtenant" -H "x-employee-id: 1"
```

| Request | Result |
|---|---|
| Forged `x-employee-id: 1` + real tenant | **`200`** — full feature-flag configuration returned |
| No header | `401` |
| Forged header + nonexistent tenant | **`500`** |

**Interpretation.** The header's *presence* is the only check; its value is never validated. Two issues: unauthenticated disclosure of any tenant's feature posture, and a tenant-existence oracle via distinguishable responses (200 vs 500). The 500 also indicates an unhandled error path where a 404 belongs.

---

## 8. Background job health

All pg-boss jobs were in `completed` state — no failures, no backlog.

| Queue | Completed jobs |
|---|---|
| `__pgboss__send-it` | 17,004 |
| **`course-release-sweep`** | **10,279** ⚠️ runs `* * * * *` |
| `expire-reservations` | 2,250 |
| `room-reservation-expiry` | 1,061 |
| `channel-sync-poll` | 1,061 |
| `kds-load-snapshot` / `reservation-reminder-check` | 686 each |
| `billing-lifecycle-check` | 171 |

```sql
SELECT name, state, count(*) AS jobs FROM pgboss.job
GROUP BY name, state HAVING count(*) > 0 ORDER BY jobs DESC LIMIT 20;
```

Legacy queues empty:
```sql
SELECT (SELECT count(*) FROM public.email_queue) AS email_total,
       (SELECT count(*) FROM public.fbr_invoices) AS fbr_total;
```
→ `0, 0` (`email_queue` is dead schema — pg-boss replaced it).

---

## 9. Actual production usage — the framing fact

| Metric | Value across **all 29 active tenants** |
|---|---|
| **Total sales** | **59** |
| Total products | 81 |
| Total employees | 40 |
| Tenants with ≥1 sale | **5** |
| Busiest tenant | 22 sales |

```sql
WITH s AS (SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'),
counts AS (
  SELECT
    (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.sales', nspname), false, true, '')))[1]::text::int AS sales,
    (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.products', nspname), false, true, '')))[1]::text::int AS products,
    (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.employees', nspname), false, true, '')))[1]::text::int AS employees
  FROM s
)
SELECT sum(sales) AS total_sales, sum(products) AS total_products, sum(employees) AS total_employees,
       max(sales) AS busiest_tenant, count(*) FILTER (WHERE sales > 0) AS tenants_with_any_sale
FROM counts;
```

**Interpretation.** This is the single most important context for the whole report. The architecture is enormous relative to validated load, so most risks are **latent rather than currently biting**, and "no production incidents" mostly means production has not been asked to do much yet.

---

## 10. Error tracking

| Project | Unresolved issues |
|---|---|
| `node-express` (backend) | **0** |
| `sanopos-frontend` | 1 — `TypeError: Cannot read properties of undefined (reading 'default')`, last seen 2026-07-11 |

```bash
sentry-cli issues list --org sanopos --project node-express --max-rows 15
sentry-cli issues list --org sanopos --project sanopos-frontend --max-rows 15
```

---

## 11. Railway environment (names only — no secret values read)

All ~25 `*_WORKER_ENABLED` flags are **set**. Present: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_PORTAL_JWT_SECRET`, `MANUFACTURER_PORTAL_JWT_SECRET`, `INTEGRATION_SECRET_KEY`, `SHOPIFY_SECRET_KEY`, `RESEND_API_KEY`, `SENTRY_DSN`, `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`, `SANDBOX_WEBHOOK_SECRET`, R2 credentials, `MULTI_TENANT=1`, `TZ`.

**Notably absent:** `META_APP_SECRET` (Meta/WhatsApp webhook signing — those webhooks fail closed without it) and `R2_PUBLIC_URL` (so the backend `/r2` proxy serves objects rather than a public CDN domain).

```bash
railway variables --kv | sed 's/=.*//' | sort   # names only, values stripped
```

---

## 12. Repository metrics

| Metric | Value |
|---|---|
| Backend JS (excl. node_modules, archive) | ~181,868 lines |
| Frontend `src` | ~118,736 lines |
| Backend route files | 180 |
| Backend service files | 104 |
| Worker files | 27 |
| `CREATE TABLE` in `schema-pg.sql` | 327 |
| Backend test files | 255 |
| Frontend spec/test files | 79 |
| Total commits | 1,923 (600 in last 90 days) |
| Unmerged branches | none |

```bash
find backend -name '*.js' -not -path '*/node_modules/*' -not -path '*/archive/*' -print0 | xargs -0 cat | wc -l
find frontend/src \( -name '*.jsx' -o -name '*.js' -o -name '*.ts' -o -name '*.css' \) -print0 | xargs -0 cat | wc -l
grep -c 'CREATE TABLE' backend/schema-pg.sql
find backend/tests -name '*.test.js' | wc -l
git rev-list --count HEAD && git log --since="90 days ago" --oneline | wc -l
```

---

## 13. Source-level spot checks (re-verified by the report author)

```bash
# POST /api/sales carries only Zod validation — no permission guard
grep -n 'app.post("/api/sales"' backend/routes/sales.js
#   595:  app.post("/api/sales", validate(CreateSaleSchema), async (req, res) => {

# ...and no PERMISSION_RULES entry covers it
grep -n 'api/sales' backend/middleware/permissions.js
#   (no match)

# No graceful shutdown handler anywhere in backend
grep -rn "SIGTERM\|SIGINT\|uncaughtException\|unhandledRejection" backend --include=*.js -l \
  | grep -v node_modules | grep -v archive | grep -v tests
#   (no match)

# shutdownBoss() is defined but only ever called from a test stub
grep -rn "shutdownBoss" backend --include=*.js | grep -v node_modules
#   backend/services/boss.js:5   (comment: "call on SIGTERM")
#   backend/services/boss.js:46  (definition)
#   backend/services/boss.js:59  (export)
#   backend/tests/integration/public-bookings.test.js:29  (stub)
```

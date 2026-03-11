# Postgres Cutover Checklist

One-time migration from Railway SQLite to Postgres. Target downtime: < 5 minutes.

## Pre-Cutover

- [ ] Provision Postgres instance (Supabase free tier or Railway Postgres addon)
- [ ] Note the `DATABASE_URL` connection string
- [ ] Install `better-sqlite3` locally: `cd backend && npm install better-sqlite3`
- [ ] Download production SQLite DB from Railway volume (`/data/sanopos.db`)
- [ ] Test migration locally:
  ```bash
  DATABASE_URL=postgresql://localhost:5432/oneshoppos_staging \
    node backend/scripts/sqlite-to-pg.js path/to/downloaded/sanopos.db
  ```
- [ ] Verify data integrity: spot-check row counts for `sales`, `products`, `employees`
- [ ] Run the app locally against the staging Postgres to verify all flows work

## Cutover (During Maintenance Window)

1. **Announce maintenance** — brief POS downtime notice
2. **Stop Railway deployment** — pause the service to prevent new writes
3. **Download latest SQLite DB** — `railway volume download sanopos.db`
4. **Run migration script:**
   ```bash
   DATABASE_URL=<production_postgres_url> \
     node backend/scripts/sqlite-to-pg.js sanopos.db
   ```
5. **Set Railway env vars:**
   - `DATABASE_URL=<production_postgres_url>`
   - Remove `DATA_DIR` (no longer needed)
   - Keep `TZ=Asia/Karachi`
   - Keep `MULTI_TENANT=0`
6. **Redeploy Railway** — `start.sh` will detect `DATABASE_URL` and run `migrate-pg.js`
7. **Verify:** `GET /api/health` → `{"status":"ok","missing_tables":[]}`
8. **Test:** Login, make a test sale, check reports

## Post-Cutover

- [ ] Keep Railway SQLite volume for 1 week as rollback safety net
- [ ] Monitor error logs for 24 hours
- [ ] After 1 week with no issues, remove the SQLite volume from Railway
- [ ] Remove `better-sqlite3` from `package.json` (optional dependency, only needed for migration)
- [ ] Update `VITE_API_BASE` in Vercel if backend URL changes

## Rollback Plan

If critical issues are found after cutover:
1. Remove `DATABASE_URL` env var from Railway
2. Re-add `DATA_DIR=/data`
3. Redeploy — app will boot in SQLite mode using the preserved volume
4. Investigate and fix the Postgres issue before retrying

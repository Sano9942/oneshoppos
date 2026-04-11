# Scripts — Claude Guide

- **4 files** — one-off/maintenance scripts, run manually or via cron
- **`seed-tax-rates.js`** — seeds `public.tax_rate_reference` with ~96 Pakistani HS codes and GST rates. Uses `INSERT ... ON CONFLICT DO UPDATE` (safe to re-run). Requires `DATABASE_URL`
- **`backup-all-tenants.js`** — SQLite-era backup script. Backs up all tenant DBs to R2, gzips, prunes >30 days. For Postgres backups, use `utils/backup-pg.js` instead
- **`sqlite-to-pg.js`** — one-time SQLite→Postgres migration. Reads all tables in FK-dependency order via `better-sqlite3`. Not idempotent. Requires `better-sqlite3` installed and `DATABASE_URL` set
- **`verify-schema-apply.js`** — applies `schema-pg.sql` end-to-end against a throwaway schema (`tenant_m1_test`) to catch FK forward-references, cross-schema ALTERs, and duplicate table definitions before they break fresh-tenant provisioning. Run after any edit to `schema-pg.sql`: `node backend/scripts/verify-schema-apply.js`. Requires `DATABASE_URL`. Safe to re-run — drops scratch schema on exit

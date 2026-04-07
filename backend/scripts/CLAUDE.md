# Scripts — Claude Guide

- **3 files** — one-off/maintenance scripts, run manually or via cron
- **`seed-tax-rates.js`** — seeds `public.tax_rate_reference` with ~60+ Pakistani HS codes and GST rates. Uses `INSERT ... ON CONFLICT DO UPDATE` (safe to re-run). Requires `DATABASE_URL`
- **`backup-all-tenants.js`** — SQLite-era backup script. Backs up all tenant DBs to R2, gzips, prunes >30 days. For Postgres backups, use `utils/backup-pg.js` instead
- **`sqlite-to-pg.js`** — one-time SQLite→Postgres migration. Reads all tables in FK-dependency order via `better-sqlite3`. Not idempotent. Requires `better-sqlite3` installed and `DATABASE_URL` set

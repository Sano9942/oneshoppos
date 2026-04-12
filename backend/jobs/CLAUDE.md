# Jobs — Claude Guide

- **1 file**: `cleanup-dead-tenants.js` — removes incomplete tenant setups
- **Export**: `cleanupDeadTenants({ dryRun? })` → `{ checked, deleted, skipped, details[] }`
- **Criteria**: No `setup_complete`, no sales data, older than 7 days
- **Safety**: Skips tenants with `setup_complete = true` OR any sales records
- **Actions**: Drops `tenant_<slug>` schema, sets `status = 'deleted'` in master `tenants`, inserts `tenant_audit_log` (column is `actor`, not `performed_by`)
- **Standalone**: `node backend/jobs/cleanup-dead-tenants.js [--dry-run]`
- **Scheduled**: Called by `cleanup-worker-boss.js` daily at 2am UTC

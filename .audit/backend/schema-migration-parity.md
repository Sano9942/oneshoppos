# Schema and migration parity evidence

## Static results

- `backend/migrate-pg.js` contains 94 unique migration objects, monotonically ordered from v1 through v98. Versions 40-43 are absent; no duplicate numeric versions were detected.
- v1 reads and applies `schema-pg.sql` (`migrate-pg.js:20-37`), then later migrations advance tenant/public schemas.
- Every migration body and its `schema_version` insert execute in one transaction (`migrate-pg.js:7191-7199`). This is positive counterevidence against half-applied individual migrations.
- Static CREATE TABLE extraction found 288 unique tenant-baseline tables and 205 migration-body tables. The five migration-only names are public control-plane tables: `impersonation_sessions`, `payment_intents`, `payment_records`, `plan_pricing`, `upgrade_requests`; each is also represented in `master-db-pg.js` master DDL.
- Current migration tests include provisioning/version coverage (`tests/integration/pg-master-db.test.js:61-71`) and focused migration checks, but require PostgreSQL.

## Confirmed parity/deployment defect

BE-002 in `findings.md`: per-tenant migration failures are swallowed, so runtime code can start against tenant schemas below v98 even though the migration CLI exits successfully.

## Important integrity observations

- `payment_records` has no unique external/idempotency reference in both `master-db-pg.js:83-95` and migration v7 (`migrate-pg.js:171-184`), amplifying BE-001.
- `tenant-db-manager-pg.query/transaction` use transaction-local search paths (`:58-87`), while `getClient` uses session state (`:91-95`), the parity/isolation break documented as BE-003.
- The every-deploy public RLS sweep catches/logs failures at `migrate-pg.js:7273-7277`. Whether that exposes data depends on Supabase grants/PostgREST configuration; without live catalog/grant evidence it is recorded as an operational risk, not a confirmed vulnerability.

## Environment-deferred verification

Local PostgreSQL was unavailable, so the following are explicitly deferred rather than failed:

1. Compare live tenant `schema_version` values and catalog objects/indexes/constraints to v98.
2. Apply v1-v98 to a fresh empty schema and to representative historical versions.
3. Verify public RLS (`relrowsecurity`, policies, grants) and PostgREST anon/service exposure.
4. Pool-size-one proof for BE-003 and concurrent transaction proofs for BE-001/BE-007.


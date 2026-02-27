# OneShopPOS Legacy Artifacts Policy

Last Updated: 2026-02-25

Runtime database source of truth:
- `backend/oneshop.db`

Legacy/non-runtime artifacts must not remain in runtime root paths when they can cause confusion.

Current archive location:
- `backend/archive/legacy/`

Archived files:
- `database.sqlite` (legacy placeholder, not runtime)
- `schema_dump.txt` (historical dump snapshot)
- `readable_schema.txt` (historical readable snapshot)

Policy:
1. Keep runtime folders focused on active files used by app startup, migrations, and tests.
2. Place historical snapshots and deprecated artifacts in archive locations.
3. Update docs/scripts if a path move occurs so references remain accurate.

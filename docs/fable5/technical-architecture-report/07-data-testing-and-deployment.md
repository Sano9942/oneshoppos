# Schema, Migrations, Testing, Quality Controls, and Deployment

## Tenant schema

[`backend/schema-pg.sql`](../../../backend/schema-pg.sql#L1) is the canonical new-tenant DDL.

It contains 325 `CREATE TABLE` declarations representing 324 unique names. `return_reasons` is declared twice with idempotent `IF NOT EXISTS`.

The schema uses:

- `TIMESTAMPTZ`
- `NUMERIC` for money, percentages, and weighted quantities
- JSONB for configuration and snapshots
- Foreign keys
- Cascading and restrictive deletes
- Partial unique indexes
- Check constraints
- Exclusion constraints
- Trigram extension
- Explicit ledger and audit tables
- Soft deletion in major business entities

Broad table families include:

- Foundation, roles, outlets, employees
- Catalog, variants, media, pricing
- Inventory, serials, batches, transfers
- Sales, payments, returns, shifts
- Procurement and supplier finance
- Customers, loyalty, wallet, gift cards
- CRM, quotations, invoices, subscriptions
- Web orders, channels, reservations, fulfillment
- Restaurant, KDS, tips, reservations
- Appointments, classes, packages, memberships
- Projects and contracts
- Service tickets
- Rentals
- Rooms and lodging
- Clinical treatment
- Forms and notifications
- Reporting
- Feature flags, modes, and Business Modules

All operational timestamps are intended to represent UTC instants. Tenant-local date boundaries are derived using explicit timezone utilities rather than database-session dates.

## Migration system

The migration array in [`backend/migrate-pg.js`](../../../backend/migrate-pg.js#L29) contains 133 objects and ends at version 137. Versions 40 through 43 are absent historical numbers rather than pending migrations.

Migration themes include:

- Initial PostgreSQL conversion
- Authentication and reset tokens
- Billing and support
- FBR and email queues
- Omnichannel and storefront
- Scheduling and vertical modes
- Restaurant and KDS
- Appointments and classes
- Projects and contracts
- Shipping and COD
- Rentals, rooms, and treatment plans
- Retail gift cards, loyalty, serialized stock, and intelligence
- Tax snapshots
- Wholesale credit, field sales, schemes, and manufacturer portal
- Kits, forms, notifications, packages, and batch tracking
- Repair depth
- Rental, lodging, and clinical depth
- Super-admin TOTP and sessions
- Credential encryption
- AI activation
- Business Modules
- Permission split
- Mode normalization
- Per-outlet module activation
- Per-outlet roles

Each migration executes inside a transaction and records its version after success.

Fresh provisioning applies the full current schema and then seeds every migration version, avoiding replay of historical migrations against a brand-new schema.

## Public-schema RLS

Migration version 98 and an unconditional deployment sweep enable RLS on every public table.

No `CREATE POLICY` statements are present. The effect is:

- PostgREST/anonymous roles have no policy-granted access.
- The privileged backend PostgreSQL role continues to operate through RLS bypass.

This is being used as an external-access lock rather than application-level row filtering.

## Test inventory

Static inspection found:

- 249 backend test files
  - 202 integration
  - 47 unit
- 78 frontend test/spec files
  - Unit tests
  - Playwright functional tests
  - Smoke suites
  - One long-running sweep

A static pattern count found approximately:

- 2,882 backend `test`/`it` declarations
- 653 frontend `test`/`it` declarations

These counts are approximate because parameterized tests can generate multiple cases from one declaration.

## Backend test configuration

[`backend/vitest.config.js`](../../../backend/vitest.config.js#L1) uses:

- Node environment
- Fifteen-second test timeout
- Ten-second hook timeout
- Forked process pool
- Test isolation
- Global Vitest functions

Coverage includes:

- Utilities
- Services
- Middleware
- Category tree

Coverage excludes:

- Routes
- Workers
- Jobs
- Scripts
- Entry point
- Migration runner

The integration suite covers authentication, tenancy, concurrency, permissions, inventory, reporting, admin, verticals, webhooks, billing, POS atomicity, migrations, and many regression-specific cases.

## Frontend testing

[`frontend/playwright.config.js`](../../../frontend/playwright.config.js#L1) configures:

- Production base URL `https://sanopos.com`
- Chromium
- One worker
- No retries
- Retained traces on failure
- Screenshots on failure
- Global auth setup

The special sweep project:

- Provisions a fresh tenant
- Walks a broad feature surface
- Runs headed
- Allows up to four hours
- Records video on failure

Frontend unit tests use Vitest and jsdom.

## Lint and type checking

Frontend ESLint includes:

- Recommended JavaScript rules
- React Hooks rules
- React Refresh rules
- A custom rule for redesigned pages that prevents unapproved raw interactive elements

Backend and frontend TypeScript configurations use:

- `allowJs: true`
- `checkJs: false`
- `strict: false`
- `noEmit: true`

Most production JavaScript is therefore not semantically type-checked. The typecheck scripts primarily validate TypeScript declarations and module resolution.

## CI

The checked-in GitHub Actions configuration currently contains one workflow:

- Timezone/date-boundary guard

It:

- Installs backend dependencies
- Runs the timezone static guard
- Runs timezone helper unit tests

The complete backend, frontend, lint, typecheck, build, and Playwright suites are not currently enforced in GitHub Actions.

## API documentation

[`backend/swagger.js`](../../../backend/swagger.js#L1) defines:

- OpenAPI 3 metadata
- Bearer authentication
- Core Product, Sale, Customer, Order, and Error schemas
- Production and local server URLs

Only a small number of route files currently contain Swagger annotations relative to the API size. The generated specification is therefore a partial API description, not a full contract.

Swagger UI is hidden unless `API_DOCS_KEY` is configured and supplied in the query string.

## Backend deployment

[`backend/Dockerfile`](../../../backend/Dockerfile#L1) uses:

- Node 22 Alpine builder
- Native build tools for dependency installation
- Node 22 Alpine runtime
- PostgreSQL 17 client tools
- SQLite runtime packages
- Production port 5000

PostgreSQL client tools support `pg_dump` and `pg_restore` for backup endpoints.

[`backend/start.sh`](../../../backend/start.sh#L1):

1. Sets timezone, defaulting to Asia/Karachi.
2. Runs PostgreSQL migrations when `DATABASE_URL` exists.
3. Starts `index.js`.

Railway configuration in [`backend/railway.toml`](../../../backend/railway.toml#L1) uses:

- Dockerfile build
- `/api/health`
- 120-second health timeout
- Restart on failure
- `/data` volume

## Frontend deployment

[`frontend/vercel.json`](../../../frontend/vercel.json#L1):

- Rewrites extensionless application URLs to `index.html`.
- Adds content-type, frame, referrer, permissions, and DNS-prefetch headers.

It does not define a content security policy.

Vite builds the frontend and then runs a metadata prerender script.

## Local development

[`docker-compose.yml`](../../../docker-compose.yml#L1) provides PostgreSQL 15 with:

- Database: `sanopos_dev`
- User: `sanopos`
- Port: 5432
- Persistent volume

Backend and frontend have separate package manifests and lifecycle commands. There is no root `package.json` orchestrating both applications.

## Deployment inconsistency: SQLite fallback

The production start script still contains an alternate branch for missing `DATABASE_URL`. That branch:

- Creates a SQLite data link.
- Attempts to run `run_migrations.js`.
- Starts the same `index.js`.

However:

- `backend/run_migrations.js` does not exist.
- `index.js` imports `db-pg.js` unconditionally.
- Active routes are PostgreSQL-based.

The SQLite branch is therefore stale and should be removed or explicitly rebuilt as a supported runtime.


# Architecture Risks, Recommendations, and Overall Assessment

## Priority risks

### 1. Tenant search-path reset on manual clients

**Current state**

[`tenant-db-manager-pg.getClient`](../../../backend/tenant-db-manager-pg.js#L89) applies a session-level tenant search path. Import routes later release the raw client without an explicit reset.

**Risk**

A pooled connection can retain tenant schema state and be reused by code that expects the public schema or another tenant.

**Recommendation**

- Wrap `release()` so it resets to `public`.
- Prefer transaction callbacks over raw client checkout.
- Add a cross-checkout isolation integration test.

### 2. Stale SQLite runtime path

**Current state**

`start.sh` has a SQLite fallback, while active boot and routes require PostgreSQL and the referenced SQLite migration script is absent.

**Risk**

A deployment missing `DATABASE_URL` enters a misleading and broken startup path rather than failing clearly.

**Recommendation**

- Remove the SQLite branch and SQLite production packages.
- Fail startup immediately when `DATABASE_URL` is absent.
- Retain conversion tools only as explicitly named maintenance scripts.

### 3. Trusted single-tenant employee identity

**Current state**

Single-tenant mode accepts `x-employee-id` as identity.

**Risk**

Any caller able to reach the API can select another employee identity.

**Recommendation**

- Mark single-tenant mode as local/trusted only.
- Bind it to localhost/private interfaces, or add a real local session.
- Prevent this mode in production startup checks.

### 4. Integration-secret encryption fails open

**Current state**

[`encryptSecret`](../../../backend/services/crypto.js#L20) stores plaintext if no encryption key is set.

**Risk**

Operators can believe credentials are encrypted when production configuration omitted the key.

**Recommendation**

- Fail writes for credential-bearing integrations without `INTEGRATION_SECRET_KEY`.
- Add startup configuration validation.
- Provide a rotation/versioning procedure for encrypted values.

### 5. Portal secret fallback

**Current state**

Customer and manufacturer portals fall back to `JWT_SECRET`, then `dev-insecure-secret`.

**Risk**

A configuration error can produce predictable portal tokens.

**Recommendation**

- Require dedicated portal secrets in production.
- Fail startup rather than warning.

### 6. Process-local distributed state

Process-local state includes:

- Rate limits
- Company, feature, mode, and outlet caches
- Alert aggregation windows
- Customer-display memory
- Worker heartbeat globals
- Some signup/resend cooldown maps

**Risk**

Multiple replicas do not share this state. Requests can observe inconsistent caches and bypass aggregate rate limits by hitting different instances.

**Recommendation**

- Use a shared Redis/PostgreSQL store for rate limiting and public abuse controls.
- Persist worker heartbeat and alert state.
- Make cache invalidation event-driven or short-lived and replica-aware.
- Explicitly document any single-replica production assumption.

### 7. Missing graceful shutdown

**Current state**

[`shutdownBoss`](../../../backend/services/boss.js#L46) exists, but `index.js` has no SIGTERM/SIGINT shutdown sequence.

**Risk**

Deploys can interrupt HTTP requests, transactions, pollers, and worker jobs without coordinated draining.

**Recommendation**

Add shutdown handling that:

1. Stops accepting HTTP connections.
2. Clears poller intervals.
3. Stops pg-boss.
4. Waits for active requests/jobs within a deadline.
5. Closes the PostgreSQL pool.

### 8. Unsigned Daraz webhook

**Current state**

The Daraz endpoint routes by seller/account and rate-limits requests but does not verify authenticity.

**Risk**

An attacker with account identifiers and order shapes may be able to inject or alter marketplace order state.

**Recommendation**

- Implement the documented Daraz/Lazada signing contract.
- Until then, restrict the endpoint by network/provider controls where possible.
- Increase anomaly and audit visibility for webhook-created changes.

### 9. Content Security Policy disabled

**Current state**

Backend Helmet CSP is disabled, and Vercel does not supply a CSP.

**Risk**

An HTML/script injection defect has fewer browser-enforced containment layers. Access tokens are present in localStorage.

**Recommendation**

- Introduce CSP in report-only mode.
- Inventory inline scripts, external images, Turnstile, Sentry, and other required origins.
- Progressively enforce nonce/hash-based script policy.

### 10. Tenant migration drift

**Current state**

Tenant migration failures are logged, but deployment continues.

**Risk**

Tenants can run different schema versions and fail only when a newer route touches a missing object.

**Recommendation**

- Persist migration failure state in the public schema.
- Surface it prominently in health/admin monitoring.
- Block writes for a tenant whose schema is behind a required minimum.
- Add an automated repair/retry job.

## Important implementation boundaries

### Marketplace sync worker is not automatic

The current marketplace worker schedules no actual polling work. Manual actions and webhooks remain the real synchronization paths.

### Online storefront kits are restricted

The native storefront explicitly rejects kit/bundle products during checkout because storefront stock allocation is not yet kit-aware.

### Payment adapter completeness varies

The base interface includes tokenization and saved-instrument charging, but production adapters do not all implement every operation. The sandbox adapter is the most complete.

### Offline operation is transaction queueing

The service worker does not maintain an offline tenant database. Offline support means static-shell access and idempotent queueing of selected writes.

### API documentation is partial

Swagger does not describe most of the route surface and should not be treated as the canonical API inventory.

## Quality and maintainability risks

### Limited CI enforcement

The repository contains extensive tests, but CI currently runs only the timezone guard. Regression protection depends heavily on local execution discipline.

Recommended CI stages:

1. Backend unit tests
2. Backend integration tests against disposable PostgreSQL
3. Frontend unit tests
4. Frontend lint
5. Backend and frontend typecheck
6. Frontend production build
7. API parity checks
8. Focused Playwright smoke suite
9. Nightly or scheduled broader Playwright suite

### Weak JavaScript type checking

Both TypeScript configurations use `checkJs: false` and `strict: false`. Most route contracts, service payloads, and frontend state are not checked statically.

Recommended direction:

- Turn on `checkJs` incrementally for shared infrastructure.
- Add JSDoc types to database and middleware contracts.
- Generate frontend API types from Zod/OpenAPI or a shared contract layer.
- Start with auth, context, payment, sale, and worker payloads.

### Large module concentration

Some route and frontend files are very large:

- Sales transaction
- Rooms
- Treatment plans
- Accounting
- POS context

Recommended direction:

- Preserve transactional boundaries.
- Extract pure calculations and domain services.
- Avoid splitting code solely by line count when it would fragment one atomic workflow.
- Prefer tested service modules and command-style transaction functions.

### Configuration overlap

Capabilities can be controlled by:

- Plan
- Subscription state
- Permission
- Mode
- Feature flag
- Business Module state
- Outlet override
- Device scope
- Environment variable
- External credential state

This is powerful but cognitively expensive.

Recommended direction:

- Provide one effective-capability diagnostic endpoint.
- Return the exact refusal layer: plan, subscription, permission, mode, flag, outlet, credential, or environment.
- Reuse the same diagnostic state in admin tooling and merchant UI.

## Architectural strengths

### Transactional rigor

The codebase consistently uses:

- Transactions
- `FOR UPDATE`
- Idempotency keys
- Unique constraints
- Snapshot fields
- Explicit ledgers
- Post-commit external side effects

This is especially strong in sales, returns, credit, storefront checkout, inventory, subscriptions, deposits, and webhook processing.

### PostgreSQL used as an application platform

The system uses PostgreSQL features meaningfully rather than treating it as a generic key/value store.

Examples include:

- Schema isolation
- Partial indexes
- Exclusion constraints
- Numeric inventory
- JSONB
- Catalog/statistics monitoring
- RLS lockdown
- pg-boss
- Trigram matching

### Reuse across verticals

Restaurant, appointments, rentals, lodging, repair, clinical, and wholesale functionality share common:

- Customer identity
- Catalog
- Inventory
- Payment
- Deposit
- Tax
- Receipt
- Notification
- Audit
- Reporting

This limits duplicate financial and inventory engines.

### Layered authorization

Identity, tenant, outlet, assignment, base role, effective role, permission, feature, and mode are independently represented and resolved.

The per-outlet role implementation correctly preserves base permissions for outlet-reach decisions.

### Operational visibility

The system includes:

- Request IDs
- Structured logs
- Sentry
- Health checks
- Email alerts
- Worker status
- Queue depth
- Dead letters
- Infrastructure metrics
- Tenant audits
- Admin security logs
- Migration tools
- Backup verification

## Overall assessment

SanoPOS is architecturally a configurable multi-tenant business platform organized around a robust POS and inventory spine.

Its primary strengths are transaction design, PostgreSQL use, vertical reuse, authorization depth, integration adapters, and operational coverage.

Its primary challenge is complexity management. Continued feature expansion now yields less architectural value than:

- Hardening tenant connection lifecycle
- Removing obsolete runtime paths
- Making secret configuration fail closed
- Supporting horizontal coordination
- Adding graceful shutdown
- Expanding CI
- Strengthening API and type contracts
- Consolidating effective-capability diagnostics

The platform is already broad enough to serve many industries. The highest-leverage engineering work is now reliability, security, consistency, and maintainability across that breadth.


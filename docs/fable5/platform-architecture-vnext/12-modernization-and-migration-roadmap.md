# Current-to-vNext Modernization Roadmap

## Strategy

Modernize inside the existing repository. Preserve useful business behavior, replace unsafe boundaries, and exploit the absence of production customer data to simplify schema and configuration. Do not perform a blind rewrite and do not leave permanent parallel architectures.

## Current strengths to preserve

- Broad transactional and vertical-domain knowledge
- PostgreSQL transactions and constraints
- Existing tenant concepts
- Permission and context mechanisms
- Mature POS workflow coverage
- pg-boss and durable-worker foundations
- Integration adapter patterns
- Request IDs, logging, Sentry, health, admin support surfaces
- Extensive test material that can reveal behavior

See the current [System Overview](../technical-architecture-report/01-system-overview.md) and [Functional Domains](../technical-architecture-report/04-functional-domains.md).

## Priority risks to remove

1. Manual tenant-client search-path lifecycle
2. Stale SQLite runtime branch
3. Trusted single-tenant employee header
4. Integration encryption fail-open
5. Portal-secret insecure fallback
6. Process-local distributed state
7. Missing complete graceful shutdown
8. Unsigned mutable webhooks
9. Disabled Content Security Policy
10. Tenant migration drift
11. Overlapping modes, presets, flags, modules, and permissions
12. Very large route and UI orchestration units
13. Partial CI and weak contract generation

The evidence and source anchors are maintained in [Risks and Assessment](../technical-architecture-report/08-risks-and-assessment.md).

## Migration waves

### Wave 0: Freeze, protect, and measure

- Freeze new vertical modules.
- Mark non-launch modules Experimental.
- Back up the repository and databases.
- Establish Staging and required CI.
- Fix urgent security and isolation risks without waiting for broad refactoring.
- Inventory routes, tables, events, flags, permissions, and tests by domain.
- Capture baseline performance and protected user journeys.

Exit: safe development foundation and agreed source-of-truth inventories.

### Wave 1: Platform skeleton

- Create organization/legal-company/outlet/register identifiers and compatibility mapping.
- Introduce typed request and tenant context.
- Build centralized tenant router and scoped unit of work.
- Establish domain package boundaries, standard errors, contracts, outbox, audit, and design tokens.
- Build capability resolver and explanation model.

Exit: new domains can be built without adding to legacy global mechanisms.

### Wave 2: Identity, subscription, and module runtime

- Consolidate identity/session policy.
- Model organization identity, employment, assignments, devices, and service accounts.
- Replace Free/Pro lifecycle with Trial/Active/Grace/Suspended/Archived.
- Implement entitlement, install, setup, outlet assignment, profile, and release lifecycle.

Exit: one coherent access and commercial capability model.

### Wave 3: Shared commercial domains

Migrate Catalog → Pricing/Tax → Customer/Stored Value → Inventory → Procurement → Payment → Accounting. Each domain receives owned tables, repositories, contracts, events, tests, and legacy adapters.

Exit: launch modules can depend on stable platform services rather than route-local SQL.

### Wave 4: Commerce and Food Service

- Route current retail behavior through Commerce use cases.
- Build Wholesale order lifecycle over shared foundations.
- Consolidate Restaurant/Café into Food Service profiles.
- Replace POS context responsibilities incrementally.
- Introduce focused workspaces.

Exit: online launch workflows pass complete quality gates.

### Wave 5: Edge, Windows, and hardware

- Prototype shell and embedded database.
- Stabilize sync contracts.
- Implement retail edge flow first, then Food Service coordination.
- Move printer/device execution to Hardware Gateway.
- Certify an initial hardware matrix.

Exit: representative outlets complete multi-day outage and recovery exercises.

### Wave 6: Production readiness and pilots

- Load and resilience testing
- Security review and penetration test
- Backup, restore, and incident exercises
- Pakistan country-package professional validation
- Founding-customer operation and UX observation
- Support, billing, and onboarding validation

Exit: controlled paid launch decision.

## Legacy adapter policy

Every adapter records owner, old contract, new contract, callers, telemetry, removal condition, and target wave. No new consumer may depend on a legacy adapter after the replacement domain is declared authoritative.

## Data migration policy

Because current tenants are tests, vNext may reset test data and create a clean baseline after exporting anything useful. Still implement migrations as if production discipline already applies:

- Rehearsable and resumable
- Backed up before destructive transformation
- Reconciled by row counts and domain invariants
- Able to explain rejected or transformed records
- Versioned and observable

## Definition of migrated

A domain is migrated only when:

- New write path is authoritative.
- Reads no longer depend on legacy truth.
- Contracts and events are versioned.
- Required tests and observability pass.
- Data reconciliation passes.
- Frontend uses new use cases.
- Legacy flags/routes/tables have removal disposition.
- Documentation and support procedures are current.

Moving files or renaming routes alone is not migration.

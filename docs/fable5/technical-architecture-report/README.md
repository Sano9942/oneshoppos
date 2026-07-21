# SanoPOS Technical Architecture Report

This report describes the current SanoPOS implementation for developers. It is based on executable source code, SQL, package manifests, test configuration, and deployment configuration.

`AGENTS.md`, `CLAUDE.md`, and similar guide files were deliberately excluded as evidence. Where a statement could be verified directly, this report links to the relevant source file and line.

## Report index

1. [System overview and component architecture](01-system-overview.md)
2. [Backend runtime, request lifecycle, PostgreSQL, and tenancy](02-backend-runtime-and-tenancy.md)
3. [Authentication, authorization, configuration, and security](03-auth-configuration-and-security.md)
4. [Functional domain architecture](04-functional-domains.md)
5. [Frontend, POS, routing, and offline architecture](05-frontend-and-pos.md)
6. [Integrations, background workers, observability, and administration](06-integrations-workers-and-operations.md)
7. [Schema, migrations, testing, quality controls, and deployment](07-data-testing-and-deployment.md)
8. [Architecture risks, recommendations, and overall assessment](08-risks-and-assessment.md)

## Executive description

SanoPOS is a multi-tenant, multi-vertical commerce and operations platform whose shared transactional foundation is a point-of-sale, catalog, inventory, customer, and payment system.

The current codebase extends that foundation into:

- Retail and wholesale
- Restaurant operations and kitchen display
- Appointment and membership businesses
- Repair and workflow tickets
- Projects and contracts
- Rentals
- Hotels, guesthouses, and hostels
- Dental, veterinary, physiotherapy, and other clinical workflows
- Public storefronts and customer portals
- Marketplace, courier, payment, messaging, compliance, and hardware integrations
- Super-admin operations, billing, monitoring, backup, and tenant lifecycle management

## Codebase snapshot

Static inspection of the current tree found:

| Area | Current size |
|---|---:|
| Backend route modules | 180 |
| Backend service modules | 104 |
| Worker modules | 27 |
| Zod schema modules | 52 |
| Frontend JS/JSX/TS source files | 503 |
| Lines under `frontend/src` | Approximately 120,000 |
| Lines under backend routes | Approximately 60,000 |
| Unique tenant-schema table names | 324 |
| Migration objects | 133, ending at version 137 |
| Business Module cards | 49 |
| Operational modes | 10 |
| Industry presets | 23 |
| Country packs | 23 |
| Registered permissions | 39 |
| Authenticated frontend route declarations | 159 |
| Public/portal route declarations | 66 |
| Super-admin route declarations | 15 |

These counts describe checked-in source structure rather than deployed feature availability. Many capabilities remain controlled by tenant modes, feature flags, outlet settings, permissions, environment variables, or external credentials.

## Primary source entry points

- Backend composition root: [`backend/index.js`](../../../backend/index.js#L1)
- Route orchestrator: [`backend/routes/registerAllRoutes.js`](../../../backend/routes/registerAllRoutes.js#L1)
- PostgreSQL schema: [`backend/schema-pg.sql`](../../../backend/schema-pg.sql#L1)
- Migration runner: [`backend/migrate-pg.js`](../../../backend/migrate-pg.js#L1)
- Tenant middleware: [`backend/middleware/tenant-auth.js`](../../../backend/middleware/tenant-auth.js#L1)
- Business Module catalog: [`backend/config/business-modules.js`](../../../backend/config/business-modules.js#L1)
- Frontend composition: [`frontend/src/main.jsx`](../../../frontend/src/main.jsx#L1)
- Frontend route orchestration: [`frontend/src/App.jsx`](../../../frontend/src/App.jsx#L1)
- Merchant route tree: [`frontend/src/routes/appRoutes.jsx`](../../../frontend/src/routes/appRoutes.jsx#L1)
- POS state orchestration: [`frontend/src/pages/redesign/pos/POSContext.jsx`](../../../frontend/src/pages/redesign/pos/POSContext.jsx#L1)


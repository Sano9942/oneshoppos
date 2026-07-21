# Decision and Traceability Matrix

This matrix records the accepted discovery decisions and where they are specified. Detailed rationale is preserved in the ADR set.

| Decision | Accepted direction | Primary specification |
|---|---|---|
| Enterprise hierarchy | Organization → legal company → outlet → stock location/register/device | [Hierarchy](02-enterprise-hierarchy-and-tenancy.md) |
| Initial company support | One legal company in launch UI; multi-company-ready model | [Hierarchy](02-enterprise-hierarchy-and-tenancy.md) |
| Multi-module outlet | Allowed; one primary module and focused assignments | [Capability model](04-capability-and-module-model.md) |
| Finance scope | Separate legal-company ledgers and tax; management consolidation | [Finance](06-data-finance-and-reporting.md) |
| Product structure | One platform with installable modules and market-facing editions | [Principles](01-product-vision-and-principles.md) |
| Module activation | Subscription permits; owner installs/configures/assigns; admin override audited | [Capability model](04-capability-and-module-model.md) |
| Initial charging | Business subscription includes first outlet and ordinary modules; extra outlets recur | [Principles](01-product-vision-and-principles.md) |
| Launch segments | Retail, Wholesale, Restaurant/Café | [Launch architecture](05-commerce-and-food-service.md) |
| Restaurant and café | One Food Service module; Table, Counter, Hybrid profiles | [Launch architecture](05-commerce-and-food-service.md) |
| Retail and wholesale | One Commerce module; Retail, Wholesale, Hybrid profiles | [Launch architecture](05-commerce-and-food-service.md) |
| Launch quality | Fifteen complete workflows are release gates | [Quality](11-quality-reliability-and-operations.md) |
| Customer scope | Legal-company relationship shared across outlets; controlled cross-company linking | [Data](06-data-finance-and-reporting.md) |
| Loyalty scope | Legal-company program across participating outlets/modules | [Data](06-data-finance-and-reporting.md) |
| Catalog scope | Organization identity, legal-company commerce, outlet availability | [Data](06-data-finance-and-reporting.md) |
| Pricing | Central deterministic engine and immutable transaction snapshot | [Data](06-data-finance-and-reporting.md) |
| Inventory | Stock-location ledger; cross-company movement is commercial | [Data](06-data-finance-and-reporting.md) |
| Supplier scope | Shared identity; legal-company account, contract, and payable | [Data](06-data-finance-and-reporting.md) |
| Employee scope | Organization identity, legal-company employment, explicit assignments | [Hierarchy](02-enterprise-hierarchy-and-tenancy.md) |
| Stored value | Legal-company and currency; no initial cross-company value | [Data](06-data-finance-and-reporting.md) |
| Accounting | Legal-company double-entry ledger; outlet/module dimensions | [Data](06-data-finance-and-reporting.md) |
| Full offline | Optional outlet edge server; basic queue for small/short outages | [Edge](07-cloud-edge-offline-and-hardware.md) |
| Offline authority | Cloud owns configuration; edge owns valid local operational events | [Edge](07-cloud-edge-offline-and-hardware.md) |
| Hardware | Local Hardware Gateway, adapters, durable jobs, certification | [Edge](07-cloud-edge-offline-and-hardware.md) |
| Application priority | Cloud web + Windows POS, then Android, then owner/employee mobile | [Frontend](09-frontend-workspaces-and-design-system.md) |
| Trial | 30-day standard; selected founding customers up to 90 days; no permanent Free | [Principles](01-product-vision-and-principles.md) |
| Plans | One Business plan plus consultation-based Enterprise initially | [Principles](01-product-vision-and-principles.md) |
| Tenant placement | Shared schemas for standard; dedicated/regional databases for Enterprise | [Tenancy](02-enterprise-hierarchy-and-tenancy.md) |
| Extensions | Configuration → APIs/webhooks → controlled framework; no arbitrary SQL/code | [Extensions](08-api-events-integrations-and-extensions.md) |
| Feature maturity | Proposed → Experimental → Preview → Production → Deprecated → Archived | [Principles](01-product-vision-and-principles.md) |
| Development freeze | No new major vertical until platform, Commerce, Food Service are Production | [Migration](12-modernization-and-migration-roadmap.md) |
| AI development | Product brief, impact review, bounded plan, evidence, controlled release | [Governance](14-ai-assisted-engineering-governance.md) |
| Country strategy | Pakistan Production first; UAE/USA later through versioned packages | [Country packages](10-security-privacy-and-country-packs.md) |
| Scale | Certified initial Business envelope; Enterprise assessment beyond it | [Vision](01-product-vision-and-principles.md) |
| Security | Strong baseline for every plan; regulated verticals separately assessed | [Security](10-security-privacy-and-country-packs.md) |
| Reliability | 99.9% engineering objective, four-hour RTO, ~five-minute RPO | [Quality](11-quality-reliability-and-operations.md) |
| UX | Role/outlet/module/device-focused workspaces and shared design system | [Frontend](09-frontend-workspaces-and-design-system.md) |
| Capability controls | Entitlement, install, outlet, profile, permission, release flag are distinct | [Capability model](04-capability-and-module-model.md) |
| Backend architecture | Modular monolith; services extracted only on evidence | [Domains](03-platform-domain-architecture.md) |
| Repository and stack | One repository; Node/React/PostgreSQL retained; progressive strict TypeScript | [Domains](03-platform-domain-architecture.md) |
| Contracts | Versioned APIs/events, standard errors, idempotency, compatibility policy | [Contracts](08-api-events-integrations-and-extensions.md) |
| Existing tests | Audit and replace domain by domain; no blanket deletion | [Quality](11-quality-reliability-and-operations.md) |
| Modernization | Incremental vNext in existing repository; no rewrite or permanent duplicate system | [Migration](12-modernization-and-migration-roadmap.md) |
| Program | Approximate 12-month milestone plan controlled by quality gates | [Program](13-twelve-month-program.md) |

## Current-code traceability

The target was informed by the verified [Technical Architecture Report](../technical-architecture-report/README.md). Important gaps between current and target include:

- Current schema-per-tenant routing uses AsyncLocalStorage and search paths; target introduces a storage-placement router with no raw tenant client use.
- Current feature availability spans several overlapping registries; target assigns one responsibility per configuration layer.
- Current POS and route files contain significant orchestration; target moves rules into domain application services.
- Current offline behavior is an IndexedDB replay queue; target adds an outlet edge architecture.
- Current CI is narrow; target makes complete business journeys and migration safety release gates.
- Current security has several documented fail-open or process-local risks; target treats safe production configuration as mandatory.

## Decision-change procedure

1. Identify the accepted ADR.
2. Provide new customer, legal, operational, or technical evidence.
3. Describe alternatives and migration cost.
4. Create a superseding ADR.
5. Update this matrix and affected chapters.
6. Do not rewrite history by silently editing the old ADR status.

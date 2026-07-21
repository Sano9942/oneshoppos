# Product Vision and Architectural Principles

## Vision

SanoPOS helps businesses across industries benefit from a modern, easy-to-use, complete operating platform. Its differentiation is a shared commercial foundation that can present focused industry experiences without becoming separate, duplicated products.

The ambition is global and multi-industry. The execution strategy is deliberately narrower: establish a dependable platform, launch Commerce and Food Service in Pakistan, prove real customer operation, and expand by country and vertical only through defined maturity gates.

## Initial market and operating envelope

The first paying-customer target is small and medium Pakistani retail, wholesale, restaurant, and café businesses. The initial certification target per organization is approximately:

| Dimension | Initial engineering target |
|---|---:|
| Outlets | 10 |
| Registers | 50 |
| Active employees | 100 |
| Catalog items and variants | 250,000 |
| Daily business transactions | 25,000 |

The platform-wide starting target is 100–200 active organizations. These are targets to validate with representative load tests, not claims about present performance.

Larger customers receive an Enterprise capacity assessment and may be placed on dedicated infrastructure.

## Launch product

The launch product consists of:

- A common platform foundation
- Commerce with Retail, Wholesale, and Hybrid profiles
- Food Service with Table Service, Counter Service, and Hybrid profiles
- One legal company per organization in the initial user interface
- Multiple outlets, stock locations, registers, and devices
- Pakistan production country package
- Cloud management and reporting
- Optional outlet edge service for full offline operation
- Windows POS and Hardware Gateway

Other existing verticals remain experimental until deliberately promoted through the maturity lifecycle.

## Commercial starting model

- No permanent Free plan
- A 30-day standard trial
- Up to 90 days for selected founding customers providing structured feedback
- One SanoPOS Business plan including the first outlet and ordinary launch modules
- Recurring fees for additional physical outlets
- Separate charges only for measurable direct-cost usage, professional services, or later premium capabilities
- Consultation-based Enterprise arrangements for dedicated infrastructure and contractual requirements

Module activation is not itself a fee. The entitlement system preserves future pricing flexibility without forcing confusing add-on pricing at launch.

## Architectural principles

### 1. Platform before vertical breadth

Identity, organization structure, catalog, customers, inventory, payments, accounting, security, audit, localization, and reporting are platform capabilities. Verticals extend them; they do not duplicate them.

### 2. Focused experiences over universal navigation

Users see workspaces based on role, outlet, installed module, operational profile, and device purpose. Product breadth must not become interface clutter.

### 3. Legal and financial ownership is explicit

Every transaction, balance, stock movement, tax record, and journal entry belongs to a legal company. Outlet and module dimensions provide operational analysis without weakening legal separation.

### 4. Offline operation is a first-class architecture

Days-long, multi-device offline operation requires an outlet edge service. It cannot be added safely as an afterthought to a browser retry queue.

### 5. Completed transactions are corrected, not overwritten

Sales, payments, stock movements, stored value, and accounting entries use append-only or immutable records with reversal and correction events.

### 6. Configuration layers have one responsibility

Entitlements, module activation, outlet assignment, profiles, permissions, and engineering release flags are distinct.

### 7. Modular monolith before microservices

Strong domain boundaries are required now. Independent network services are introduced only when scaling, security, deployment, or ownership evidence justifies them.

### 8. Contracts outlive implementations

Cloud, edge, desktop, mobile, integrations, and extensions communicate through versioned APIs and events. Database tables are never public contracts.

### 9. Production is a maturity state

A capability is production-supported only after security, tenant isolation, tests, observability, recovery, documentation, and complete workflow verification.

### 10. Modernize incrementally

The current system contains valuable business behavior. SanoPOS vNext replaces boundaries and implementations domain by domain, using the absence of production customer data to simplify aggressively without performing a blind rewrite.

## Explicit non-goals for the initial release

- Production support for every existing vertical
- A universal customer mobile application
- Unrestricted customer code or database access
- Microservices for every domain
- Multiple legal companies in the self-service UI
- Cross-company stored value or ordinary stock transfers
- USA or UAE production-compliance claims
- Guaranteed support for every hardware model
- Full accounting, payroll, and ERP depth for every country

## Success criteria

The first release succeeds when founding customers can operate complete Retail, Wholesale, and Food Service days—including outages, returns, cash reconciliation, inventory, purchasing, and recovery—without engineering intervention for normal work.

The current implementation already demonstrates unusually broad domain ambition. The architecture objective is to convert that breadth into a reliable, understandable platform rather than continue increasing surface area. See the current [overall assessment](../technical-architecture-report/08-risks-and-assessment.md).

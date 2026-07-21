# ADR-002: Modular Product and Launch Scope

- Status: Accepted (ratified by owner 2026-07-17: Pakistan-first production, Commerce + Food Service launch scope, UAE/USA as future previews)
- Date: 2026-07-17

## Context

The current application contains many verticals, causing product and navigation breadth to exceed production discipline. Separate products would duplicate shared commerce foundations.

## Decision

Build one platform with installable modules and focused market-facing editions. Initial Production scope is Commerce and Food Service in Pakistan:

- Commerce profiles: Retail, Wholesale, Hybrid
- Food Service profiles: Table Service, Counter Service, Hybrid

Restaurant and café are one module. Retail and wholesale are one module. Other verticals remain Experimental until promoted through maturity gates.

## Consequences

- New vertical development freezes until launch foundations are Production.
- Shared domains cannot be copied into vertical modules.
- Existing vertical code remains available for later assessment but is not part of the commercial promise.
- One outlet may combine modules using focused register and employee assignments.

## Specification

[Product Vision](../01-product-vision-and-principles.md) and [Launch Architecture](../05-commerce-and-food-service.md)

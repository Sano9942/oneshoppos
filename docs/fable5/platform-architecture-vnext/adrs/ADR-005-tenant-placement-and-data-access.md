# ADR-005: Tenant Placement and Data Access

- Status: Proposed
- Date: 2026-07-17

## Context

Standard customers need cost-effective isolation; Enterprise may require dedicated/regional storage. Current manual search-path client handling creates leakage risk.

## Decision

Introduce a control-plane tenant directory and centralized data-plane router. Standard customers use strongly isolated tenant schemas in shared PostgreSQL. Enterprise customers may use dedicated databases, clusters, or regions. Domain code receives a tenant-scoped unit of work and cannot manipulate placement or raw search paths.

## Consequences

- HTTP, jobs, imports, exports, files, caches, and edge sync use one context model.
- Tenant migration version and drift become control-plane concerns.
- Moving a tenant between placements becomes a verified platform operation.
- Existing AsyncLocalStorage proxy behavior is migrated behind safer infrastructure.

## Current evidence

Current proxy: [`backend/tenant-db-proxy-pg.js`](../../../../backend/tenant-db-proxy-pg.js#L1). Current manual-client risk: [`backend/tenant-db-manager-pg.js`](../../../../backend/tenant-db-manager-pg.js#L89).

## Specification

[Enterprise Hierarchy and Tenancy](../02-enterprise-hierarchy-and-tenancy.md)

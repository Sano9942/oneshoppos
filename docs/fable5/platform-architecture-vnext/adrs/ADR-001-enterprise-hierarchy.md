# ADR-001: Enterprise Hierarchy and Legal Ownership

- Status: Proposed
- Date: 2026-07-17

## Context

SanoPOS must serve one-location businesses and future groups owning several legal companies and mixed-industry locations. Treating tenant, company, and outlet as synonyms would make tax, accounting, access, and consolidation unsafe.

## Decision

Use Organization → Legal Company → Outlet → Stock Location/Register → Device. An outlet may enable multiple modules but has one primary module. Accounting, tax, contracts, fiscal sequences, and official reporting belong to the legal company. Organization reporting is managerial consolidation.

Launch UI supports one legal company and multiple outlets while IDs and ownership remain multi-company ready.

## Consequences

- Cross-company stock and value require explicit intercompany workflows.
- Employee identity can span the organization; employment is legal-company scoped.
- Authorization always resolves legal-company and applicable outlet context.
- Current tenant/company assumptions require compatibility mapping.

## Specification

[Enterprise Hierarchy](../02-enterprise-hierarchy-and-tenancy.md)

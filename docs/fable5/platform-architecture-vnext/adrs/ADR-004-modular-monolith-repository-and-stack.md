# ADR-004: Modular Monolith, Repository, and Technology Stack

- Status: Proposed
- Date: 2026-07-17

## Context

The system is broad, but premature microservices or a framework rewrite would add operational complexity without solving weak domain boundaries.

## Decision

Retain Node.js, Express, React, Vite, and PostgreSQL. Keep one repository. Structure the main cloud application as a modular monolith with domain-owned rules, tables, contracts, tests, and events. Adopt strict TypeScript progressively for new and migrated boundaries.

Edge, Hardware Gateway, and workers may be separate processes. Other services are extracted only on measured scaling, security, placement, deployment, or team-ownership evidence.

## Consequences

- Route handlers become thin adapters.
- Raw cross-domain database writes are prohibited.
- Import and table-ownership rules require CI enforcement.
- Migration occurs domain by domain, not through a folder-only rewrite.

## Specification

[Platform and Domain Architecture](../03-platform-domain-architecture.md)

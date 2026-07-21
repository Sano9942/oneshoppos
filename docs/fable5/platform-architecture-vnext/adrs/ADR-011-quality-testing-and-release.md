# ADR-011: Quality, Test Transition, and Release Gates

- Status: Proposed
- Date: 2026-07-17

## Context

The current suite is large but may contain stale, flaky, duplicated, or implementation-coupled tests. Deleting all tests would remove undocumented behavior and create an unprotected modernization period.

## Decision

Inventory and classify existing tests. Preserve valuable behavior through architecture-aligned replacements before deletion. New coverage includes domain, real-PostgreSQL, API/security, contract, migration, end-to-end, hardware, and resilience layers.

No production change bypasses CI, migration validation, Staging, protected journeys, and controlled rollout. Fifteen launch workflows are formal quality gates. Required tenant migration drift blocks release.

## Consequences

- Test count is not a success metric; protected behavior and reliability are.
- Flaky tests may be quarantined only with owner, reason, replacement, and deadline.
- Database changes use expand-and-contract.
- Release evidence and recovery instructions become permanent records.

## Specification

[Testing, Reliability, Release, and Operations](../11-quality-reliability-and-operations.md)

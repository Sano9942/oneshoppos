# ADR-003: Capability and Initial Commercial Model

- Status: Proposed
- Date: 2026-07-17

## Context

Presets, modes, flags, modules, permissions, plans, and outlet settings currently overlap. Module activation was also at risk of becoming confusing add-on pricing.

## Decision

Separate entitlement, module installation, legal-company/outlet assignment, operational profile, employee permission, and temporary release flag. Each has one responsibility and one explainable resolution chain.

Launch commercially with:

- No permanent Free plan
- 30-day standard trial
- Selected founding customers up to 90 days
- One Business plan including the first outlet and ordinary launch modules
- Recurring additional-outlet pricing
- Consultation-based Enterprise

Module activation is not an activation fee.

## Consequences

- Current configuration needs an explicit migration map.
- Stable features must graduate out of engineering flags.
- Direct-cost services and professional work may be separately charged.
- Capability diagnostics become a support and audit requirement.

## Specification

[Capability Model](../04-capability-and-module-model.md)

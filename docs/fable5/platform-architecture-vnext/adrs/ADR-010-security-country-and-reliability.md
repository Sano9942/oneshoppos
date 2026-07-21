# ADR-010: Security, Country, and Reliability Baseline

- Status: Proposed
- Date: 2026-07-17

## Context

SanoPOS handles financial, personal, employee, and future regulated data across countries. Security and reliability cannot be premium-only or inferred from feature existence.

## Decision

Apply strong identity, tenant isolation, encryption, payment-data minimization, privacy, and immutable audit controls to every plan. Production refuses unsafe missing secrets. Pakistan is the first versioned Production country package; UAE and USA follow only after qualified validation. Each legal company has one primary jurisdiction and accounting currency initially.

Target 99.9% cloud availability, four-hour major-disaster RTO, approximately five-minute cloud RPO, and continued edge operation. These are engineering objectives until contractually validated.

## Consequences

- Clinical and similarly regulated verticals stay Experimental pending separate assessment.
- Security review, penetration testing, restore drills, and incident response are launch gates.
- Tier 2 integrations cannot block Tier 1 checkout.
- Regional deployment and multi-currency expand through explicit architecture.

## Specification

[Security and Country Packages](../10-security-privacy-and-country-packs.md) and [Quality and Reliability](../11-quality-reliability-and-operations.md)

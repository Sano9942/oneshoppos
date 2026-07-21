# ADR-012: Incremental Modernization and AI Governance

- Status: Proposed
- Date: 2026-07-17

## Context

The current product was built primarily with AI tools and contains valuable breadth alongside architectural drift. There are no production customers, enabling simplification without a full rewrite.

## Decision

Develop SanoPOS vNext incrementally inside the current repository. Freeze major new verticals, build platform foundations, migrate shared domains, migrate Commerce and Food Service, then build edge/hardware and conduct founding pilots. Use an approximate 12-month milestone program controlled by quality gates.

Every meaningful AI-assisted change requires a product brief, architecture impact assessment, bounded plan, automated evidence, staging, and controlled release. High-risk tenancy, security, financial, migration, sync, and production work receives experienced human review.

## Consequences

- Test tenants may be reset and obsolete schema simplified deliberately.
- Compatibility adapters are temporary and have removal conditions.
- Conversational history is not architectural authority; ADRs and source evidence are.
- Progress is measured by reliable workflows and removed legacy mechanisms, not generated code volume.

## Specification

[Modernization Roadmap](../12-modernization-and-migration-roadmap.md), [Twelve-Month Program](../13-twelve-month-program.md), and [AI Governance](../14-ai-assisted-engineering-governance.md)

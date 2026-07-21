# ADR-009: Workspace-Oriented User Experience

- Status: Proposed
- Date: 2026-07-17

## Context

A universal navigation surface exposes platform breadth and makes ordinary jobs feel scattered. Cashiers, waiters, buyers, and owners require different information and interaction patterns.

## Decision

Use role-, outlet-, module-, profile-, register-, and device-focused workspaces. Users open into the workspace required for their job. One shared design system provides consistency, accessibility, localization, and standard operational states.

Frontend capability hints use the same explanation model as backend authorization, but backend decisions remain authoritative.

## Consequences

- Marketing editions can look focused while sharing one platform.
- Navigation is contextual rather than a complete feature inventory.
- POS, wholesale, kitchen, inventory, and owner experiences may have distinct layouts.
- Page-local design and business-rule duplication are retired incrementally.

## Specification

[Frontend Workspaces and Design System](../09-frontend-workspaces-and-design-system.md)

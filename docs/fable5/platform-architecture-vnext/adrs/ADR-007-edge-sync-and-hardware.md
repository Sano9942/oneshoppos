# ADR-007: Edge, Synchronization, and Hardware

- Status: Proposed
- Date: 2026-07-17

## Context

Retail and Food Service must operate for hours or days without internet and coordinate several devices. Browser-only replay cannot coordinate tables, kitchen, payments, stock, and hardware safely.

## Decision

Keep cloud as the platform authority and add an optional persistent outlet edge service with encrypted local database, synchronization, local coordination, and Hardware Gateway. Basic queuing remains for small single-register/short-outage use.

Cloud owns global configuration. Edge owns valid operational events accepted locally during outage. Synchronization uses versioned immutable events, idempotency, ordered checkpoints, acknowledgements, and explicit conflict policy.

## Consequences

- Windows POS and edge are first-class applications.
- Hardware uses capability adapters and durable local jobs.
- Cloud/edge compatibility and upgrade policy are mandatory.
- Offline feature scope is explicit; not all administration is available offline.
- Device certification limits support promises.

## Specification

[Cloud, Edge, Offline, and Hardware](../07-cloud-edge-offline-and-hardware.md)

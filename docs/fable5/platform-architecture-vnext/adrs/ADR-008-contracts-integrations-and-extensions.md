# ADR-008: Contracts, Integrations, and Extensions

- Status: Proposed
- Date: 2026-07-17

## Context

Cloud, edge, desktop, mobile, providers, and future partners cannot depend on internal database structure or unstable ad hoc payloads.

## Decision

Use versioned, typed, contract-first APIs and business events with stable errors, idempotency, documentation, and compatibility policy. Use transactional outbox/inbox patterns. External providers are adapters behind domain ports; mutable webhooks require signature and replay verification.

Extensibility proceeds from safe configuration, to scoped APIs/webhooks, to a permission-controlled extension framework. Arbitrary server code, SQL, and audit bypass are prohibited.

## Consequences

- Contracts become separately tested artifacts.
- External failure is isolated from core checkout where possible.
- Client deprecation and minimum versions are operational responsibilities.
- Existing integrations require capability and security conformance review.

## Specification

[APIs, Events, Integrations, and Extensions](../08-api-events-integrations-and-extensions.md)

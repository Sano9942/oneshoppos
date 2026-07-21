# APIs, Events, Integrations, and Extensions

## Contract-first APIs

Cloud, edge, web, desktop, mobile, and external clients use versioned typed contracts. A representative resource path is `/api/v1/...`; version policy is more important than the exact prefix.

Every contract defines:

- Authentication and scope
- Required permission and context
- Request and response schemas
- Stable error codes
- Idempotency behavior
- Pagination and filtering
- Rate limits
- Offline eligibility
- Deprecation and compatibility

The current API layer centralizes basic browser transport in [`frontend/src/api.js`](../../../frontend/src/api.js#L1), while current OpenAPI coverage is partial through [`backend/swagger.js`](../../../backend/swagger.js#L1). vNext generates documentation and clients from authoritative schemas.

## Standard response and errors

Errors include a stable code, safe localized message key or fallback, request ID, retry classification, and typed details. Internal stack traces never cross production boundaries.

Commands that may be retried accept idempotency keys. Duplicate commands return the original result or a stable duplicate status.

## Business events

Event names use domain, fact, and version:

```text
commerce.sale.completed.v1
inventory.stock.moved.v1
food_service.order.sent_to_kitchen.v1
payment.captured.v1
accounting.journal.posted.v1
```

Events contain identity, tenant context, actor, correlation, causation, timestamp, schema version, and typed payload. They describe completed facts, not vague instructions.

## Transactional outbox and inbox

- The producing transaction saves its state and outbox record atomically.
- Workers claim and deliver with retry and dead-letter policy.
- Consumers maintain an inbox or equivalent idempotency record.
- Delivery is at least once; business effect is effectively once through idempotency.
- Poison events become visible operational incidents.

The present system already uses pg-boss for several jobs through [`backend/services/boss.js`](../../../backend/services/boss.js#L12). vNext distinguishes domain-event delivery, scheduled work, and external integration jobs while using shared durable infrastructure initially.

## Integration architecture

Each external integration is an adapter behind a domain-owned port:

```text
Domain use case
→ Integration port
→ Provider adapter
→ Credential vault
→ External system
```

Provider code does not own business truth. For example, Payment decides payment state; an xPay or future provider adapter translates requests and responses.

Required adapter behavior:

- Typed capability declaration
- Authentication and secret rotation
- Timeout, retry, circuit-breaker, and rate-limit policy
- Idempotency mapping
- Signed webhook verification
- Reconciliation support
- Provider error normalization
- Sandbox or contract-test mode
- Audit-safe logging

Current integration breadth includes payment, FBR, marketplace, courier, messaging, storage, and printing services, summarized in [Integrations and Operations](../technical-architecture-report/06-integrations-workers-and-operations.md).

## Webhooks

Inbound webhooks require provider-specific signature verification, timestamp/replay protection where supported, raw-body preservation, durable receipt, idempotency, and tenant/integration routing. Unsigned production webhook mutation is prohibited.

Outbound customer webhooks are signed, versioned, retried, observable, and scoped to explicitly selected events.

## Extensibility stages

### Stage 1: Safe configuration

Custom fields, templates, dashboards, saved reports, approval rules, notifications, required fields, statuses, labels, and terminology use declarative schemas and a constrained rules engine.

### Stage 2: Public API and webhooks

External systems use scoped service accounts, versioned APIs, signed webhooks, and explicit rate/usage limits.

### Stage 3: Extension framework

Trusted extensions declare:

- Identity and supported platform version
- Required modules and permissions
- API scopes and event subscriptions
- Configuration schema
- UI extension points
- Data-retention behavior
- Upgrade and disable hooks

Extensions have no unrestricted SQL, arbitrary server execution, authentication replacement, or audit bypass. Actions are attributable and remotely disableable.

## Rules engine safety

Rules operate over approved facts and actions with execution limits, deterministic evaluation where required, versioning, simulation, audit history, and a clear explanation. Arbitrary JavaScript is not a rule language.

## Compatibility policy

Maintain a compatibility matrix for cloud, edge, Windows POS, mobile, API, and event versions. Define minimum supported versions, update grace periods, offline-safe upgrades, deprecation notice, and emergency blocking for unsafe clients.

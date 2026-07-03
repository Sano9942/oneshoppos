# Backend test evidence

## Commands and results

### Full unit suite

Command: `npm.cmd run test:unit` from `backend/`.

Result: 33 files; 31 passed, 2 failed. 521 tests; 519 passed, 2 failed. Duration reported by Vitest: 14.28s.

Failures:

1. `tests/unit/industry-config.test.js:102-106` expects wholesale `modes=[]`, while current configuration returns `["wholesale"]`. This is test/config expectation drift until product intent is confirmed; it is not promoted to an application finding.
2. `tests/unit/services.test.js:137-140` expects `PAYMENT_GATEWAY=xpay` alone to enable the gateway, while current service requires usable xPay credentials. Source behavior is safer than the stale expectation; not promoted to a defect.

### Targeted control tests

Command: `npx.cmd vitest run tests/unit/middleware.test.js tests/unit/tenant-auth-employee-email.test.js tests/unit/workers-tenant-job-context.test.js tests/unit/routes-admin-worker-status.test.js`.

Result: 4 files passed; 110/110 tests passed; 3.23s.

These provide counterevidence for ordinary permission/plan middleware paths, tenant auth email behavior, worker tenant-context cleanup, and admin worker-status behavior. They do not cover the concurrency/failure windows in BE-001, BE-002, BE-003, BE-007, or BE-008.

## Coverage gaps tied to findings

| Finding | Missing regression evidence |
|---|---|
| BE-001 | Failure injection between billing webhook writes; concurrent/replayed delivery |
| BE-002 | Multi-tenant migration CLI exit code when one tenant fails |
| BE-003 | Pool-size-one search-path reset after `getClient().release()` |
| BE-004 | MT WhatsApp tenant routing, POST signature, and DB failure response |
| BE-005 | Reset-token lookup complexity and auth-specific rate limiting |
| BE-006 | Anonymous setup-status response privacy contract |
| BE-007 | Concurrent create at a plan boundary and fail-closed lookup behavior |
| BE-008 | pg-boss enqueue failure/process-exit recovery for pending FBR rows |
| BE-009 | Revocation query error must deny or return 503 |

## Environment-deferred suites

PostgreSQL-backed integration tests were not run because local PostgreSQL is unavailable. This is an environment constraint, not evidence of a failing application. Relevant deferred coverage includes `pg-master-db.test.js`, `pg-schema.test.js`, `pg-tenant-db.test.js`, billing/admin batches, and focused migration tests.

No production services, production database, third-party gateways, queues, or webhooks were mutated.

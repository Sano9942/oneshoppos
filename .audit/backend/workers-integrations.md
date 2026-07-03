# Workers and integrations audit evidence

## Worker boot model

- `boot/workers.js:244+` obtains the shared pg-boss singleton and conditionally registers workers by environment flag.
- FBR registration is conditional on `FBR_WORKER_ENABLED=1` (`boot/workers.js:267-270`).
- Tenant-aware workers generally use `workers/tenant-job-context.js`; it validates tenant slugs before interpolating a schema and resets search path in `finally`.
- `fbr-worker-boss.js` is the legacy exception and directly interpolates `tenant_<slug>` from internal job data. Reviewed producers supply `req.tenantSlug`/tenant registry slugs; no public arbitrary job producer was found, so SQL injection was not reported.

## Confirmed findings

- BE-008: FBR invoice row commit and pg-boss enqueue are not durable as a unit; enqueue failure is swallowed and no fallback pending-row poller exists.
- BE-004: WhatsApp POST has neither tenant resolution nor POST signature verification and acknowledges database failures.
- BE-001: completed billing webhook state spans independent transactions and its early idempotency return can freeze partial state.

## Positive controls

- xPay verifies the raw-body signature before calling shared payment processing (`webhooks.js:463-475`).
- FBR worker checks `invoice.status === 'posted'` before external submission (`fbr-worker-boss.js:28-32`) and pg-boss retries posting failures (`:109-142`).
- Worker queue depth is queried from pg-boss and surfaced through admin status routes; targeted worker-status tests passed.

## Regression/operational checks

- Add orphan/outbox reconciliation metrics: pending FBR rows without live pg-boss jobs, oldest age, and enqueue error count.
- Require signature-fixture tests for each webhook provider before adding any stateful Meta/Daraz handler.
- Add chaos tests around process exit between database commit and enqueue.
- Readiness should distinguish “worker disabled by configuration” from “worker failed to register.”
- External API verification is environment-deferred; no live FBR/xPay/Meta/WhatsApp calls were made.


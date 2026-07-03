# Confirmed backend findings

Only source-verified, behaviorally reachable findings are listed. Severity reflects the stated deployment conditions.

## BE-001 — Billing webhook can permanently acknowledge a partially applied payment

- Severity/confidence: High / High.
- Evidence: `backend/routes/webhooks.js:108-117` returns “Already processed” whenever the intent is `completed`; `:128-147` performs intent completion, tenant activation, and payment-record insertion as three independent `masterDb.query()` transactions. `backend/master-db-pg.js:211-237` confirms each query starts and commits its own transaction. `backend/master-db-pg.js:83-95` and `backend/migrate-pg.js:171-184` show no uniqueness constraint on `payment_records.reference_note` to provide a second idempotency barrier.
- Conditions/affected scope: xPay (and any adapter calling `processWebhookEvent`) completed platform-billing event; all paid tenants. A database/process failure after line 128 but before lines 133-147 triggers the defect.
- Dataflow/control/sink: verified gateway event -> lookup pending intent -> mark `payment_intents.completed` -> later independent writes to `tenants` and `payment_records`; retry -> early return at lines 115-117.
- Verification: inject a failure into the tenant update after the intent update; replay the same verified event; observe HTTP success/“Already processed” while tenant/payment record remain incomplete.
- Counterevidence/uncertainty: xPay signature validation exists at `webhooks.js:466-475`, so this is not an authentication bypass. No compensating reconciliation path was found in the reviewed worker/route searches.
- Impact: paid customer may remain unactivated or lose accounting history while the gateway receives successful acknowledgement; manual financial reconciliation is required.
- Remediation direction: execute the intent row lock/CAS, tenant update, and payment-record insert in one public-schema transaction; make `reference_note` (or gateway event ID) uniquely idempotent; only acknowledge after commit.
- Regression tests: failure injection after each write; concurrent duplicate deliveries; replay after rollback; assert exactly one record and a consistent tenant/intent state.

## BE-002 — A failed tenant migration does not fail deployment

- Severity/confidence: High / High.
- Evidence: `backend/migrate-pg.js:7293-7301` catches each tenant migration error, logs it, and continues without accumulating/failing; `:7313-7321` therefore exits successfully when only tenant runs failed. `backend/start.sh:3,8-14` uses `set -e` but starts the server after that successful exit.
- Conditions/affected scope: multi-tenant deployments with at least one active tenant whose migration fails; only failed tenants are stale, making the fault asymmetric and easy to miss.
- Dataflow/control/sink: deploy -> public migration -> tenant loop -> exception swallowed -> CLI resolves -> startup launches current application code against stale tenant schema.
- Verification: make a tenant-scoped migration throw for one fixture tenant; run CLI; observe exit code 0 and server-start path eligibility while that tenant’s `schema_version` remains behind.
- Counterevidence/uncertainty: individual migrations are transaction-wrapped at `migrate-pg.js:7191-7199`, preventing half of one migration from committing. That does not prevent application/schema version skew.
- Impact: tenant-specific 500s, missing constraints, incorrect writes, or security controls absent only for some tenants after an apparently healthy deploy.
- Remediation direction: collect failures and reject/exit non-zero after the loop; optionally support an explicit, separately named degraded-start override; expose version skew in health/readiness.
- Regression tests: one success plus one failing tenant must produce non-zero CLI exit and prevent `start.sh` from executing `index.js`.

## BE-003 — Checked-out tenant clients leak session `search_path` back into the shared pool

- Severity/confidence: High / High.
- Evidence: `backend/tenant-db-manager-pg.js:91-95` runs session-level `SET search_path` and returns the client without a reset wrapper. Five import paths obtain that client and release it directly (`backend/routes/import.js:190-215, 299-314, 387-403, 479-495, 613-642`). Raw pool consumers issue unqualified queries; e.g. public admin announcement reads/writes at `backend/routes/admin/messaging.js:324,338,352,369`. The tenant baseline DDL contains same-named `announcements`, `admin_activity_log`, and `admin_security_log` tables (`backend/schema-pg.sql:2008,2021,2041`).
- Conditions/affected scope: multi-tenant deployment using import endpoints, then reuse of that physical pooled connection by raw `db-pg.query`; tenants and super-admin/public operations. Supavisor/pg pooling does not make a session-level setting self-resetting on local `client.release()`.
- Dataflow/control/sink: authenticated tenant import -> `getClient()` -> session `search_path=tenant_X,public` -> release -> later raw public/admin query -> same-named tenant table wins name resolution.
- Verification: pool size 1; run an import/client checkout for tenant A and release; call raw `db.query('SELECT * FROM announcements')`; observe tenant A’s relation resolves instead of `public.announcements`.
- Counterevidence/uncertainty: normal tenant `query()`/`transaction()` use `SET LOCAL` (`tenant-db-manager-pg.js:58-87`), and `masterDb.query()` pins public locally; those paths are safe. The defect is specific to `getClient()` plus raw-pool reuse.
- Impact: cross-boundary reads/writes, misplaced admin audit/security events, and nondeterministic public control-plane behavior.
- Remediation direction: replace import manual checkout with `db.transaction`; or return a wrapper that begins a transaction and uses `SET LOCAL`, with controlled commit/rollback/release; at minimum reset to public before release in all outcomes.
- Regression tests: pool-size-one isolation test across tenant checkout then raw public query; error/rollback path; repeated tenant A/B alternation.

## BE-004 — WhatsApp webhooks acknowledge messages that cannot be tenant-routed

- Severity/confidence: Medium / High.
- Evidence: `backend/routes/registerAllRoutes.js:150-151` mounts webhooks before tenant middleware. `backend/routes/webhooks.js:537-563` accepts POST data and passes raw `db-pg` to messaging; `services/messaging.js:12-56` executes unqualified tenant-table queries. On failure, the route only logs (`webhooks.js:564-565`) and still returns success (`:570`). No tenant lookup analogous to `resolveTenantDbForGatewayRef()` is used.
- Conditions/affected scope: multi-tenant WhatsApp integration; all tenants. With a clean public search path, `message_threads`/`customers` are tenant-schema tables and the write fails. Under BE-003’s leaked search path, it may instead target an unrelated tenant.
- Dataflow/control/sink: unauthenticated POST -> parsed sender/message -> raw public pool -> tenant-only messaging queries -> caught error -> HTTP 200.
- Verification: POST a representative WhatsApp payload in MT mode with public search path; confirm logged relation error/no message row while response is 200.
- Counterevidence/uncertainty: GET verification token exists at `webhooks.js:524-534`; it does not authenticate POST delivery. POST signature verification was not found. Meta/Daraz POST handlers currently only log/ack and have no equivalent database sink.
- Impact: silent loss of inbound customer messages; senders/providers are told delivery succeeded. Combined with a stale pooled search path, spoofed/real messages can pollute an arbitrary tenant inbox.
- Remediation direction: verify Meta `X-Hub-Signature-256` over raw body, resolve the tenant from a configured phone/account identifier, use its scoped DB, and return non-2xx on durable-processing failure (or enqueue durably first).
- Regression tests: valid/invalid signature, unknown account, tenant A/B routing, DB failure response/retry, and clean-public-search-path delivery.

## BE-005 — Password-reset verification is unthrottled O(N) bcrypt work

- Severity/confidence: Medium / High.
- Evidence: `backend/routes/auth.js:730` registers reset with validation only (unlike forgot-password’s `authLimiter` at `:670`). It selects every active reset-token hash at `:748-750` and sequentially calls `bcrypt.compare` at `:752-758`. Global rate limiting permits substantially more traffic than an authentication-specific limiter.
- Conditions/affected scope: public endpoint; attacker needs a known tenant slug in MT mode. Cost scales with outstanding unexpired reset tokens for that tenant.
- Dataflow/control/sink: arbitrary token -> full active-token query -> sequential CPU-expensive bcrypt comparisons -> Node worker-pool/latency exhaustion.
- Verification: create N unexpired token rows; send invalid reset tokens concurrently; measure bcrypt calls and latency increasing linearly with N.
- Counterevidence/uncertainty: token length/shape is Zod-validated and a global limiter exists. Neither removes the per-request bcrypt amplification.
- Impact: tenant login/API latency or process availability degradation; a small number of concurrent requests can occupy bcrypt workers.
- Remediation direction: store a deterministic SHA-256 lookup digest (random 256-bit token remains safe), select one row by indexed digest, then atomically consume it; apply an auth/reset limiter keyed by IP and tenant.
- Regression tests: invalid token performs no bcrypt scan; rate-limit behavior; constant-query-count with many outstanding tokens; atomic single-use concurrency.

## BE-006 — Public setup status discloses the administrator’s name and email

- Severity/confidence: Medium / High.
- Evidence: setup is mounted before auth (`backend/routes/registerAllRoutes.js:199-206`). `backend/routes/setup.js:60-84` resolves a caller-supplied tenant, selects the first role-1 employee’s `name,email` at `:74-81`, and returns both as `admin_name,admin_email` at `:84` without a setup token or session.
- Conditions/affected scope: multi-tenant stores with guessable/known slug, before or after setup completion; tenant owner/admin PII.
- Dataflow/control/sink: anonymous `?tenant=slug` -> master tenant lookup -> tenant employees query -> JSON response.
- Verification: unauthenticated GET `/api/setup/status?tenant=<valid-slug>` and observe admin identity fields.
- Counterevidence/uncertainty: global rate limiting reduces bulk enumeration speed; it does not authorize disclosure. No caller-specific need for returning email to an unauthenticated browser was established in source.
- Impact: account/tenant enumeration, targeted phishing, and privacy exposure.
- Remediation direction: return only `setup_complete` publicly; require the high-entropy setup token (constant-time comparison) before returning prefill PII, or derive prefill solely from client-held signup state.
- Regression tests: anonymous status response excludes PII; valid setup token permits intended prefill; invalid tenant/token responses do not distinguish owner existence.

## BE-007 — Plan caps are check-then-act and fail open

- Severity/confidence: Medium / High.
- Evidence: `backend/middleware/plan-limits.js:57-80` reads a public limit, separately counts tenant rows (`:67-73`), then calls `next()`; actual inserts occur later in route handlers (`routes/employees.js:88+`, `routes/outlets.js:44+`, `routes/products.js:609+`). Lookup errors explicitly call `next()` at `plan-limits.js:82-85`.
- Conditions/affected scope: MT Free/capped plans; concurrent create requests, or master/tenant lookup degradation.
- Dataflow/control/sink: request A/B both count below cap -> both pass -> independent inserts -> cap exceeded; DB error -> unconditional pass.
- Verification: with count `limit-1`, synchronize two POST requests after count and release together; both succeed and final count is `limit+1`.
- Counterevidence/uncertainty: unit tests cover ordinary below/at-cap behavior (`tests/unit/middleware.test.js:184-261`) but no concurrency/lock path. This is licensing/billing integrity, not tenant data isolation.
- Impact: paid limits can be exceeded and enforcement becomes least reliable during database pressure.
- Remediation direction: reserve capacity atomically in the public tenant row in the same logical creation workflow, or enforce a serialized/advisory/row-lock transaction with compensation; fail closed with retryable 503 for cap lookup failures.
- Regression tests: parallel creates at boundary; insert failure compensation; transient lookup error returns 503; unlimited plans remain unaffected.

## BE-008 — FBR jobs can be lost before reaching the durable queue

- Severity/confidence: High / High.
- Evidence: `backend/services/fbr.js:177-182` commits the local `fbr_invoices` row, then dispatches pg-boss asynchronously at `:184-196`; enqueue failure is swallowed at `:197-199` with a claim that a legacy poller will pick it up. `backend/boot/workers.js:267-270` only registers the pg-boss FBR worker, and repository searches found no pending-row poller. `backend/workers/fbr-worker-boss.js:151-158` consumes only `fbr-invoice` queue jobs.
- Conditions/affected scope: `fbr_integration` tenants with `FBR_WORKER_ENABLED=1`; pg-boss unavailable/restarting or process exits between invoice insert and async `boss.send`.
- Dataflow/control/sink: sale/return -> committed pending FBR row -> detached enqueue -> swallowed failure/process exit -> no queue job -> worker never visits row.
- Verification: make `getBoss()`/`boss.send()` reject; call `enqueueFbrInvoice`; confirm pending row exists and no later code scans it into pg-boss.
- Counterevidence/uncertainty: manual retry routes can enqueue rows only after status becomes `failed` (`routes/fbr.js:231-260`), while this row remains `pending`; therefore the normal dashboard retry does not repair this state.
- Impact: legally required invoice posting may silently never occur, with local data appearing queued indefinitely.
- Remediation direction: transactional outbox or direct pg-boss enqueue coupled to a reconciler that periodically enqueues orphaned pending rows using a singleton key; never silently swallow without observable failed state/alert.
- Regression tests: enqueue failure, process-exit window, orphan reconciler, duplicate reconciliation idempotency, worker-disabled readiness signal.

## BE-009 — Token revocation checks fail open on any query error

- Severity/confidence: Medium / High.
- Evidence: `backend/middleware/tenant-auth.js:128-146` places both JTI revocation and `tokens_revoked_before` checks in one `try`; any query error is caught and ignored as “table/column may not exist,” after which permissions load and request handling continue.
- Conditions/affected scope: authenticated tenant routes; a revoked access token plus transient permission-DB failure specifically during revocation queries, or a tenant schema missing either revocation object.
- Dataflow/control/sink: signed but revoked token -> revocation DB error -> catch/fall-through -> permissions load succeeds -> protected route executes.
- Verification: mock the first revocation query to throw and subsequent employee/permission queries to succeed; assert middleware calls `next()` for a known revoked token.
- Counterevidence/uncertainty: invalid/expired JWTs are rejected and permission loading itself retries/fails closed with 503. The weakness is limited to revocation-state availability.
- Impact: logout/session revocation is not reliably enforced during schema skew or selective DB errors.
- Remediation direction: distinguish undefined-table/column SQLSTATEs only during a controlled migration window; otherwise fail closed with retryable 503. Prefer boot/readiness assertions that revocation schema exists.
- Regression tests: undefined object policy, transient error -> 503, revoked JTI, blanket cursor, and healthy unrevoked token.


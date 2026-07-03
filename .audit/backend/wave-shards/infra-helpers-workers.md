# Infra / helpers / workers deferred-file audit shard

Scope: every `status=deferred` production JavaScript row under `backend/middleware/**`, `backend/workers/**`, `backend/utils/**`, `backend/shopify/**`, `backend/boot/**`, and `backend/jobs/**` in `.audit/backend/file-coverage-ledger.csv`. Tests and archives excluded. No deferred `backend/boot/**` row existed. Existing BE-001 through BE-009 were treated as dedupe exclusions.

## New findings

### IHW-001 — Authenticated field check-in can escape the local upload root and write arbitrary files

- Severity: **High** (configuration-dependent); CWE-22, CWE-73.
- Affected locations: entrypoint `backend/routes/field.js:106-121`; source validation `backend/schemas/field.js:11-25`; key construction `backend/routes/field.js:171-179`; root control/sink `backend/utils/r2.js:44-51`.
- Entrypoint/source: an authenticated employee with `manage_field_sales` and the `wholesale_field_sales` feature can submit `client_uuid` and arbitrary base64 `selfie_base64` to `POST /api/field/check-in`. `client_uuid` is only length-checked (`min(8).max(64)`) and permits `../`, backslashes, drive-like segments, and separators.
- Broken control/sink: the route inserts `client_uuid` directly into the object key. When R2 credentials are absent, `uploadToR2` uses `path.dirname(key)` and `path.join(..., "exports", key)` followed by `mkdirSync`/`writeFileSync`, without resolving and proving containment beneath `backend/exports`.
- Impact: a permitted field employee can write attacker-chosen bytes outside the export directory wherever the Node process has filesystem permission. A key containing traversal segments can overwrite application/configuration files; a later restart may turn this into code execution. It can also corrupt tenant or service files.
- Remediation: make all upload keys server-generated opaque identifiers; reject separators and require an actual UUID for `client_uuid`; resolve the destination and require it to remain beneath a fixed export root before any directory creation/write. Apply the containment check inside `uploadToR2`, not only at callers.
- Counterevidence/limits: R2-backed production sends the string as an object key and is not a local traversal. The finding applies to the documented local fallback and any deployment/test/staging environment without complete R2 credentials. Route authentication and feature/permission gates reduce reachability but do not neutralize the file-write primitive.

### IHW-002 — Shopify connection domain permits SSRF and forwards the tenant's Shopify token

- Severity: **High**; CWE-918, CWE-200.
- Affected locations: entrypoint `backend/routes/shopify/config.js:32-48,65-86`; root control `backend/shopify/client.js:8-15`; sink `backend/shopify/client.js:25-46`; triggering endpoints `backend/routes/shopify/health.js:84-96,100-112,116-126`.
- Entrypoint/source: a tenant employee with `manage_inventory` can persist an arbitrary `shop_domain` through `PUT /api/integrations/shopify/config`, then trigger verify, locations, or live validation.
- Broken control/sink: `sanitizeShopDomain` strips a scheme and path but does not require a Shopify-owned hostname, reject IP literals/userinfo/ports, resolve and block private/link-local/loopback addresses, or defend against DNS rebinding. `fetch()` requests `https://${shopDomain}/...` and sends `X-Shopify-Access-Token`.
- Impact: the application can be made to connect to attacker-selected or internal HTTPS services and disclose the stored Shopify access token in a request header. Reachable internal services may also be probed or acted on through POST requests.
- Remediation: parse with `URL`; require an exact Shopify hostname policy (normally `<shop>.myshopify.com`), forbid userinfo and non-443 ports, resolve all A/AAAA records and block private/special ranges, re-check after redirects (prefer redirects disabled), and bind verification results to the canonical Shopify-reported domain.
- Counterevidence/limits: the request is HTTPS-only and requires `manage_inventory`; those are useful constraints, but neither proves destination trust. No redirect option is specified; Node fetch follows redirects by default.

### IHW-003 — Portal JWT authentication falls back to a public, known signing secret

- Severity: **Medium** (High impact with a deployment precondition); CWE-798, CWE-321.
- Affected locations: root controls `backend/middleware/customer-auth.js:20-30` and `backend/middleware/manufacturer-auth.js:24-34`; token verification/entrypoints `backend/middleware/customer-auth.js:85-105` and `backend/middleware/manufacturer-auth.js:89-109`; object checks `backend/middleware/customer-auth.js:110-139` and `backend/middleware/manufacturer-auth.js:114-151`.
- Entrypoint/source: customer and manufacturer portal bearer tokens are accepted on pre-tenant portal routes.
- Broken control/sink: when both the portal-specific secret and `JWT_SECRET` are absent, verification and signing silently use the literal `dev-insecure-secret`. The services warn but continue accepting authentication.
- Impact: in such a deployment, an unauthenticated attacker can sign arbitrary customer/manufacturer tokens, select a tenant, and impersonate an existing numeric customer/partner ID; the subsequent DB lookup confirms existence/status but cannot distinguish the forged token.
- Remediation: fail startup (and fail token verification closed) outside explicit test/development mode unless a strong portal secret is present. Do not ship a signing fallback. Prefer separate mandatory secrets per token audience plus explicit issuer/audience/algorithm checks.
- Counterevidence/limits: a configured portal secret or strong `JWT_SECRET` defeats the known-secret path; tenant ID and subject existence/status are cross-checked. Production configuration was not available in this read-only shard.

### IHW-004 — Feature and mode authorization falls back to the raw shared database after tenant resolution failure

- Severity: **Medium**; CWE-636, CWE-668.
- Affected locations: injected raw database evidence `backend/index.js:67-83`; broken feature control `backend/middleware/feature-flags.js:145-168,180-197`; broken mode control `backend/middleware/feature-flags.js:205-236,245-266`.
- Entrypoint/source: any tenant route guarded by `requireFeature` or `requireMode` after request tenant resolution.
- Broken control/sink: in multi-tenant mode, `tenantDbManager.getDb(tenantId)` failures are swallowed and the code falls back to `db`, which `index.js` supplies as the raw shared pool, not the tenant proxy. It then queries unqualified `feature_flags` or `tenant_modes`. Thus a transient tenant lookup failure changes which schema supplies an authorization decision rather than failing closed.
- Impact: a route can be enabled or disabled according to public/stale/leaked-schema rows belonging to no tenant or another tenant. For opt-in features/modes this can expose protected business capabilities across tenant policy boundaries.
- Remediation: never fall back across a tenant boundary. On tenant DB lookup failure return a service error/deny; require a validated tenant ID; use the already-resolved request-scoped DB; cache entries must be keyed only by validated tenant identity.
- Counterevidence/limits: ordinary successful `getDb` calls are tenant-scoped and cached results are keyed per tenant. Exploitation requires an operational lookup failure or contaminated raw connection, so this is a failover-path authorization defect rather than the steady-state path. BE-003 is related connection contamination but does not cover this explicit raw-DB fallback control.

### IHW-005 — Dead-tenant cleanup can delete a newly activated tenant and cannot atomically record the deletion

- Severity: **High**; CWE-367, CWE-362, CWE-664.
- Affected locations: candidate selection `backend/jobs/cleanup-dead-tenants.js:11-20`; mutable safety checks `backend/jobs/cleanup-dead-tenants.js:23-42`; destructive sink and later master writes `backend/jobs/cleanup-dead-tenants.js:50-64`; scheduler `backend/workers/cleanup-worker-boss.js:16-34`.
- Entrypoint/source: the daily pg-boss cleanup job processes every active tenant older than seven days.
- Broken control/sink: setup status and sales absence are checked in separate statements without a lock or deletion state transition. The schema is then dropped before the master tenant is marked deleted and before the audit row is written; all three operations are independent. A setup completion or first sale can race between the checks and `DROP SCHEMA`, and a failure after the drop leaves an active master row pointing to a missing schema.
- Impact: legitimate tenant data can be irreversibly dropped, or the registry/audit trail can contradict physical state. This is platform-wide destructive data-loss/availability impact.
- Remediation: atomically claim the tenant in the public registry (`deleting` state with a compare-and-set), revalidate setup/sales while writes are blocked, quiesce/close cached tenant DB access, and execute `DROP SCHEMA`, registry transition, and audit insert in one database transaction where possible. Require recoverable backups and use a delayed soft-delete/tombstone before physical deletion.
- Counterevidence/limits: setup-complete tenants and tenants with existing sales are normally skipped, each tenant error is isolated, and the pg-boss job itself is durable. Those checks do not close the race or post-drop partial-state window.

### IHW-006 — Database credentials are exposed in child-process command lines

- Severity: **Medium**; CWE-214, CWE-522.
- Affected locations: backup sink `backend/utils/backup-pg.js:29-42,93-104`; restore sink `backend/utils/backup-pg.js:52-68`.
- Entrypoint/source: backup/restore helpers read the credential-bearing `DATABASE_URL` environment variable.
- Broken control/sink: the complete URL is passed as an argv element to `pg_dump` and `pg_restore --dbname`. Process command lines are commonly visible to same-host users, process supervisors, crash diagnostics, `/proc`, and observability tooling.
- Impact: PostgreSQL credentials can leak outside the Node process secret boundary and enable direct database access with the application's privileges.
- Remediation: pass non-secret connection parameters separately and supply the password through a tightly permissioned temporary pgpass file (`PGPASSFILE`) or another libpq secret channel; ensure process/log collectors redact connection strings.
- Counterevidence/limits: `spawn` uses an argument array and no shell, so this is not command injection. Container/user isolation may reduce who can read argv, but it does not prevent supervisor/diagnostic exposure.

### IHW-007 — `pg_restore` exit code 1 is accepted as successful after destructive cleanup

- Severity: **Medium**; CWE-703, CWE-754.
- Affected locations: restore flags `backend/utils/backup-pg.js:57-67`; broken result control `backend/utils/backup-pg.js:69-78`; calling restore flow `backend/routes/barcode-expenses.js:469-507`.
- Entrypoint/source: an authorized backup-restore upload invokes `pg_restore --clean --if-exists` against the tenant schema.
- Broken control/sink: the helper treats every exit code `<= 1` as success. `pg_restore` uses nonzero status when errors occurred; code 1 is not a safe blanket "warnings only" signal. With `--clean`, objects may already have been dropped before a later restore error.
- Impact: a partially restored/corrupt tenant schema can be acknowledged and audited as a successful restore, delaying recovery and causing data loss or prolonged outage.
- Remediation: accept only exit code 0; use `--exit-on-error`; restore into a quarantined schema/database, validate it, then switch/promote transactionally. Preserve stderr in a protected audit artifact.
- Counterevidence/limits: the route pre-lists archive schemas and rejects unexpected/missing tenant schemas, and uses `spawn` without a shell. Those controls do not establish successful replay of all archive objects.

### IHW-008 — Concurrent Shopify order processing can decrement inventory more than once

- Severity: **Medium**; CWE-362.
- Affected locations: state read/control `backend/shopify/order-service.js:109-125`; inventory/state transaction `backend/shopify/order-service.js:175-196`; caller/upsert boundary `backend/shopify/order-service.js:205-307`.
- Entrypoint/source: duplicated/concurrent signed Shopify deliveries or simultaneous import/poll paths can invoke `upsertWebOrderFromShopifyPayload` for the same external order.
- Broken control/sink: `stock_applied` is read before the transaction and the order row is not locked. Two executions can both observe false, each increment/decrement `outlet_stock`, and then both set `stock_applied=true`. The state update has no compare-and-set predicate.
- Impact: inventory is understated (or over-restored on concurrent reversals), enabling overselling, incorrect replenishment, and financial/inventory integrity loss.
- Remediation: acquire `SELECT ... FOR UPDATE` on the order inside the same transaction as stock mutations, or atomically claim the state with `UPDATE ... WHERE stock_applied = expected RETURNING`; make each order transition idempotent with a unique stock-ledger event.
- Counterevidence/limits: the external order upsert itself uses a unique `(source, external_order_id)` conflict target and stock writes/state update are individually transactional. That does not serialize the pre-transaction policy decision.

### IHW-009 — Campaign email provider failures can be recorded as successful delivery

- Severity: **Medium**; CWE-252, CWE-703.
- Affected locations: correct negative control `backend/workers/email-worker-boss.js:42-49`; broken provider call `backend/workers/email-worker-boss.js:263-279`; incorrect success sink `backend/workers/email-worker-boss.js:281-317`.
- Entrypoint/source: durable `campaign-email` pg-boss jobs carrying a tenant campaign delivery.
- Broken control/sink: the generic email handler checks Resend's returned `{ error }`, but the campaign handler only catches thrown exceptions and ignores the returned error object. It then marks the delivery `sent` and may roll the whole campaign to `sent`.
- Impact: rejected campaign emails can be permanently reported as sent, preventing retry and falsifying tenant communication/audit state.
- Remediation: inspect the Resend result exactly as `handleEmailJob` does; throw on returned errors; persist provider message ID; transition delivery status only after a verified provider acceptance.
- Counterevidence/limits: thrown network errors are caught, written as failed, and rethrown. The defect is the SDK's non-throwing error result path.

### IHW-010 — Campaign emails can be sent repeatedly when tenant-state persistence fails

- Severity: **Medium**; CWE-362, CWE-664.
- Affected locations: external side effect `backend/workers/email-worker-boss.js:269-279`; later DB state update `backend/workers/email-worker-boss.js:281-320`.
- Entrypoint/source: a `campaign-email` job whose Resend request succeeds but tenant context acquisition or the delivery-row update fails.
- Broken control/sink: email is sent before any durable per-delivery claim/provider-id record. A subsequent DB failure rejects the job; pg-boss retries and sends the email again.
- Impact: recipients can receive duplicate marketing messages, exposing the tenant to spam complaints, provider reputation damage, and repeated billing.
- Remediation: use a transactional outbox/delivery state machine with an immutable idempotency key passed to a provider that supports it; claim `pending -> sending` atomically, persist provider response, and reconcile ambiguous sends rather than blindly resending.
- Counterevidence/limits: pg-boss provides durable retry and delivery rows exist, but neither makes the external Resend side effect atomic or idempotent.

### IHW-011 — Invoice reminder retries can enqueue duplicate emails

- Severity: **Medium**; CWE-362, CWE-664.
- Affected locations: reminder selection `backend/workers/email-worker-boss.js:324-350`; queue side effect `backend/workers/email-worker-boss.js:352-366`; later state update/retry `backend/workers/email-worker-boss.js:368-377`.
- Entrypoint/source: durable `invoice-reminder` jobs.
- Broken control/sink: the worker enqueues the generic email job, then separately updates the reminder row to `sent`. If the update or later context cleanup fails, pg-boss retries the reminder job and enqueues another email. The enqueue has no singleton/idempotency key tied to `reminderId`.
- Impact: customers can receive repeated invoice reminders and the tenant may incur repeated provider costs/reputation harm.
- Remediation: enqueue with a stable singleton/idempotency key derived from tenant and reminder ID and atomically transition the reminder to queued in the same durable outbox transaction; distinguish `queued`, `provider_accepted`, and `sent` states.
- Counterevidence/limits: paid/void invoices are skipped at execution time and the generic email queue is durable. Neither prevents duplicate enqueue after an ambiguous partial completion.

### IHW-012 — Course-release failures permanently suppress the kitchen dispatch

- Severity: **Medium**; CWE-703, CWE-664.
- Affected locations: scheduled entrypoint `backend/workers/course-release-worker-boss.js:27-50`; root control/sink `backend/services/restaurant-checks.js:387-417`.
- Entrypoint/source: due held restaurant courses swept every minute.
- Broken control/sink: the shared service marks the course `fired` before calling `sendToKitchen`. If KDS creation throws, the error is swallowed and the row remains fired, so the next sweep excludes it. The inline comment explicitly accepts losing this retry despite no proof that tickets were created.
- Impact: paid/active restaurant items can disappear from kitchen workflow, producing missed orders, customer harm, and revenue/refund loss.
- Remediation: make fire-state transition and deterministic ticket upserts one transaction; use unique ticket keys so `sendToKitchen` is safely retryable; otherwise retain a `dispatch_pending/dispatch_failed` state and reconcile it.
- Counterevidence/limits: marking fired first avoids duplicate KDS items only if ticket creation is non-idempotent. That is not counterevidence for acknowledging a failed dispatch; it identifies the missing unique/idempotent ticket design.

### IHW-013 — Rental overdue alerts are marked sent even when no email was queued

- Severity: **Medium**; CWE-703.
- Affected locations: selection/dispatch `backend/workers/rental-overdue-worker-boss.js:61-96`; false-success sinks `backend/workers/rental-overdue-worker-boss.js:98-104`.
- Entrypoint/source: daily overdue rental sweep.
- Broken control/sink: enqueue errors are caught and swallowed, and contracts without a customer email skip enqueue entirely, yet every selected contract is marked as having sent an overdue email and receives an `overdue_alert_sent` activity row.
- Impact: real overdue rentals can lose alerts for the suppression period while the audit trail falsely claims notification, delaying asset recovery and collections.
- Remediation: mark sent only after durable enqueue succeeds; record `no_recipient` and `enqueue_failed` separately; make mark + outbox insert atomic and retryable.
- Counterevidence/limits: enqueue errors are logged and the sweep repeats daily/according to service suppression logic, but the false sent marker is precisely what can suppress subsequent attempts.

### IHW-014 — Room overdue alerts are marked sent after zero or failed enqueues

- Severity: **Medium**; CWE-703.
- Affected locations: recipient/dispatch loop `backend/workers/room-overdue-checkout-worker-boss.js:73-116`; false-success sink `backend/workers/room-overdue-checkout-worker-boss.js:118-120`.
- Entrypoint/source: daily overdue room-checkout sweep.
- Broken control/sink: an empty recipient list or any/all enqueue failures still leads to `markOverdueEmailSent` and a success log.
- Impact: staff and guests can miss checkout-overdue alerts while the booking is suppressed from retry for the service's cooldown, delaying room availability/revenue recovery.
- Remediation: require at least one durable enqueue before marking notified; track per-recipient outcomes and retry failures through a transactional outbox.
- Counterevidence/limits: failures are logged and multiple recipients are attempted independently, but no aggregate success check gates the sent marker.

### IHW-015 — Reservation reminder SMS has no atomic claim and can send duplicates

- Severity: **Medium**; CWE-362, CWE-664.
- Affected locations: eligible-row query `backend/workers/reservation-reminder-worker-boss.js:18-33`; SMS side effect and later stamp `backend/workers/reservation-reminder-worker-boss.js:35-55`; scheduled entrypoint `backend/workers/reservation-reminder-worker-boss.js:66-101`.
- Entrypoint/source: scheduled 15-minute reminder jobs, including overlapping/catch-up execution or a retry after state-write failure.
- Broken control/sink: rows are selected without a transactional claim/lock, SMS is sent, and `sms_reminder_sent_at` is updated afterward. Concurrent runs can select the same row; a successful SMS followed by update failure also leaves it eligible.
- Impact: customers can receive duplicate transactional SMS messages and tenants can be charged multiple times or damage messaging reputation.
- Remediation: atomically claim rows with `FOR UPDATE SKIP LOCKED` inside a transaction and a `sending` state; persist a provider/idempotency key; reconcile ambiguous sends before retry.
- Counterevidence/limits: the timestamp prevents ordinary sequential duplicates, and send failures do not stamp the row. It does not cover concurrency or send-success/state-write-failure.

## Full-file receipts

Every path below was read in full. Evidence notes identify the main controls/sinks closed even when no new finding was promoted.

| Path | Evidence / disposition |
|---|---|
| `backend/jobs/cleanup-dead-tenants.js` | Candidate/sales checks and `DROP SCHEMA` sequence reviewed; IHW-005. |
| `backend/middleware/customer-auth.js` | Scope/type/tenant/revocation checks present; known-secret fallback is IHW-003. |
| `backend/middleware/feature-flags.js` | Cache, tenant DB selection, feature/mode denial and notification SQL reviewed; IHW-004. Parameterized notification values; generated placeholder count only. |
| `backend/middleware/manufacturer-auth.js` | Scope/type/tenant/status/revocation checks present; known-secret fallback is IHW-003. |
| `backend/middleware/rate-limit.js` | Global/auth/webhook/public/portal/PIN keys and limits reviewed. In-memory limiter deployment scaling remains an operational limitation, not promoted without topology proof. |
| `backend/middleware/request-id.js` | Forwarded request ID, structured serializers and log enrichment reviewed; bodies omitted and Pino JSON limits log-injection impact. |
| `backend/middleware/upload-validation.js` | MIME/extension filters, SVG exclusion variants and magic-byte checks reviewed. Text has no magic check by design; no independent dangerous caller in this shard. |
| `backend/middleware/validate.js` | Zod parse replaces body and returns structured 400; no issue promoted. |
| `backend/shopify/client.js` | All GraphQL request/query/mutation/pagination/inventory/order paths reviewed; IHW-002. Location ID interpolation at line 293 targets Shopify's query endpoint and was not promoted without a lower-privilege source/impact proof. |
| `backend/shopify/crypto.js` | Delegates encryption/decryption; structured event logger reviewed. No secret logging in this file. |
| `backend/shopify/order-service.js` | Mapping SQL is parameterized; upsert transaction and stock transition reviewed; IHW-008. |
| `backend/shopify/utils.js` | HMAC uses `timingSafeEqual`; timestamp helper, idempotency key, masking and decrypted connection fetch reviewed. Missing timestamp is accepted by design but signature verification remains the primary authenticity control. |
| `backend/utils/alertEmail.js` | Alert destination/config and non-throwing behavior reviewed; no untrusted privileged sink in file. |
| `backend/utils/backup-pg.js` | Shell-free argv handling, schema listing, backup/restore results reviewed; IHW-006 and IHW-007. |
| `backend/utils/digestEmail.js` | Full HTML interpolation reviewed. Values are tenant business data sent as email; no browser/server template execution sink proved. |
| `backend/utils/ics.js` | CR/LF, slash, semicolon and comma escaping reviewed; no ICS property injection found. |
| `backend/utils/r2.js` | R2 and local fallback writes/deletes reviewed; IHW-001. Current callers use generated keys except the field check-in key demonstrated above. |
| `backend/utils/receiptEmail.js` | Full receipt HTML/URL interpolation reviewed. No same-origin browser rendering sink established; email-client sanitization/deployment is external. |
| `backend/utils/resendEmail.js` | Password reset/welcome/verify builders and Resend returned-error checks reviewed. Callers determine link trust; no additional sink promoted. |
| `backend/utils/tz.js` | IANA validation, date parsing and UTC-bound calculations reviewed; no security boundary defect promoted. Documentation still references SQLite, a drift note only. |
| `backend/workers/abc-worker-boss.js` | Tenant iteration and all aggregates/upserts reviewed. Per-row upserts can be partial but are idempotent analytical recomputation. |
| `backend/workers/anomaly-worker-boss.js` | Tenant isolation, aggregation and conflict upserts reviewed. Per-tenant failures are logged; analytical results recompute nightly. |
| `backend/workers/attendance-auto-close-worker-boss.js` | Stale selection and updates reviewed. Conditional `check_out IS NULL` makes closes idempotent; open-session cleanup is best-effort but not a privilege boundary. |
| `backend/workers/cleanup-worker-boss.js` | Durable daily registration and error rethrow reviewed; destructive service sequence is IHW-005. |
| `backend/workers/course-release-worker-boss.js` | Tenant iteration, schedule and service call reviewed; IHW-012. |
| `backend/workers/email-worker-boss.js` | Generic, lifecycle, campaign, reminder, scheduled-send and renewal handlers reviewed; IHW-009 through IHW-011. Lifecycle state updates are idempotent predicates but email enqueue errors are logged/swallowed. |
| `backend/workers/hold-expiry-worker-boss.js` | Reservation release + hold status share a transaction and updates are idempotent. Initial `FOR UPDATE` is outside that transaction, but duplicate executions converge without an independent impact. |
| `backend/workers/kds-load-snapshot-worker-boss.js` | Tenant-scoped snapshots/retention reviewed; failures are telemetry-only and logged. |
| `backend/workers/marketplace-sync-worker-boss.js` | Both handlers, interpolated validated master slugs, schedules and error handling reviewed. Actual poll/feed calls are stubs, so swallowed outer failures were not promoted as a present data-loss finding. |
| `backend/workers/orphan-schema-scan-worker-boss.js` | Read-only schema inventory and parameterized size query reviewed; no drop occurs here. |
| `backend/workers/rental-overdue-worker-boss.js` | Dispatch/mark/activity ordering reviewed; IHW-013. |
| `backend/workers/reservation-reminder-worker-boss.js` | Eligibility, SMS send, timestamp ordering and tenant sweep reviewed; IHW-015. |
| `backend/workers/reservation-worker-boss.js` | Durable scheduler and tenant service delegation reviewed; service errors per tenant are logged for next periodic sweep. |
| `backend/workers/retail-digest-worker-boss.js` | Flag gate, recipient, recent-queue check, aggregates and enqueue reviewed. The check is not atomic, but weekly singleton scheduling and low-impact email side effect left it below promotion beside concrete email instances. |
| `backend/workers/room-overdue-checkout-worker-boss.js` | Recipient dispatch and mark ordering reviewed; IHW-014. |
| `backend/workers/shift-auto-close-worker-boss.js` | Flag/threshold gates, conditional close and audit reviewed. Conditional update is idempotent; audit count can overstate races but no protected boundary impact was found. |
| `backend/workers/subscription-grace-worker-boss.js` | Tenant plan selection and monotonic active→past_due→expired updates reviewed; periodic retries converge. |
| `backend/workers/tenant-job-context.js` | Slug regex, dedicated client, transaction wrapper, reset/release reviewed. It fixes the normal BE-003 pattern. Reset failure still releases best-effort, but no independently reachable exploit was promoted without proof pg retains that broken client. |
| `backend/workers/treatment-plan-worker-boss.js` | Upcoming/overdue selection and email enqueue reviewed. No per-row marker exists here, but daily windows and service intent did not prove an unintended duplicate distinct from IHW-010/011/015. |

## Count

- Files fully inspected: **39**.
- New findings: **15** (3 High, 12 Medium as labeled; IHW-003 is Medium with High conditional impact).

# Deployment and reliability findings

Audit date: 2026-07-03 (Asia/Karachi). This report is source/config evidence only. Runtime access failures in `../production-health.md` are treated as blockers, not outages.

## DR-001 — Railway's probe can declare an instance healthy while Postgres and background processing are unavailable

- Severity/confidence: High / High.
- Evidence: `backend/railway.toml:5-9` configures `/api/health`; the default branch at `backend/routes/registerAllRoutes.js:51-56` always returns HTTP 200 without a dependency check. Database validation exists only behind `?deep=true` (`:87-93,128-145`). The HTTP listener is opened before worker startup (`backend/index.js:317-321`), and pg-boss startup/registrations are detached from boot (`backend/boot/workers.js:244-257`); registration failures are caught and only logged (`:249-254`) and pg-boss startup rejection is caught without terminating the process (`:446`).
- Conditions/affected scope: database unavailable after migrations/start, pg-boss unavailable, or any enabled worker registration failure; Railway deployment/traffic routing and every feature backed by those dependencies.
- Verification: start the server with a database endpoint that becomes unavailable after startup, or make `getBoss()` reject; request `/api/health` and observe HTTP 200 while `/api/health?deep=true` returns 503 for DB and workers remain absent.
- Counterevidence/uncertainty: the observed public deep probe was healthy at audit time (`../production-health.md`), and `start.sh:3,8-14` prevents launch when the migration command itself exits non-zero. Neither makes the configured Railway probe dependency-aware. Worker status is available to authenticated super-admins (`backend/routes/admin/system.js:48-145`), but it is not part of readiness.
- Impact: a deployment can receive traffic and remain marked healthy while normal requests fail or asynchronous email, FBR, reservation, billing, and other workflows silently stop.
- Remediation: split liveness and readiness. Keep a cheap process liveness endpoint, configure Railway to a readiness endpoint that checks Postgres plus a boot-complete/required-worker registration state, and fail startup or readiness for required worker registration failures. Define which workers are critical versus optional.
- Regression tests: quick liveness remains 200 during dependency loss; readiness is 503 until DB and required workers are ready; rejected pg-boss startup and one failed required registration keep readiness false; optional worker failure reports degraded without blocking when explicitly configured optional.

## DR-002 — The service does not perform graceful shutdown even though pg-boss exposes it

- Severity/confidence: Medium / High.
- Evidence: `backend/services/boss.js:46-57` implements `shutdownBoss()` and explicitly documents it for SIGTERM at `:4-6`. Repository search found no production call to `shutdownBoss`, no `SIGTERM`/`SIGINT` handler, and no retained HTTP server handle; `backend/index.js:317-321` calls `app.listen()` without assignment and starts workers afterward. `backend/boot/workers.js:207-241,412-438` creates long-lived intervals without a shared stop path.
- Conditions/affected scope: Railway redeploy, restart, scale-down, or operator termination; HTTP requests, in-flight pg-boss handlers, and interval-based jobs.
- Verification: run a slow request/job, send SIGTERM, and observe that the application has no handler that stops accepting connections, drains the HTTP server, clears intervals, closes DB resources, and awaits `shutdownBoss()`.
- Counterevidence/uncertainty: pg-boss provides durable job semantics and may retry abandoned work; `start.sh:14` uses `exec`, so the Node process receives platform signals directly. These reduce some loss modes but do not create a drain path.
- Impact: requests can be severed during deploys; non-idempotent interval work can be interrupted; jobs may be retried after partially completed external side effects; database/queue clients are not deliberately closed.
- Remediation: retain the server handle; install idempotent SIGTERM/SIGINT handling that flips readiness false, stops new accepts, clears intervals, awaits HTTP drain with a deadline, calls `shutdownBoss()`, closes tenant/raw DB pools, then exits. Make job side effects idempotent.
- Regression tests: child-process termination test with an in-flight request and job; readiness flips before drain; boss/database stop invoked once; timeout forces bounded exit; repeat signal is harmless.

## DR-003 — Rate limiting and alert thresholds are process-local and reset on restart

- Severity/confidence: Medium / High.
- Evidence: every limiter in `backend/middleware/rate-limit.js:55-229` omits a `store`, so express-rate-limit uses its per-process default store. Alert windows are explicitly a module-local `Map` (`backend/services/alerting.js:14-37`), including the 10-errors/5-minute threshold at `:7-11,62-73`. Railway restart-on-failure is enabled (`backend/railway.toml:8-9`).
- Conditions/affected scope: more than one backend replica, crash/redeploy/restart during a window, or requests distributed across instances; auth/webhook/public/OTP/PIN limits and error-spike/health alerts.
- Verification: send requests or recorded errors alternately to two fresh processes; each process allows/counts up to its own threshold. Restart before the threshold and observe counters reset.
- Counterevidence/uncertainty: current Railway replica count could not be verified because CLI access was unauthorized (`../production-health.md`). A single stable process enforces the configured limits correctly, and IP/tenant keys are deliberately scoped.
- Impact: effective limits multiply by replica count; attackers can receive more authentication/OTP attempts; short spikes can evade alerting when split across processes or interrupted by a deploy.
- Remediation: use a shared, atomic, TTL-backed store for security-sensitive limiters and alert aggregation (or enforce at a trusted edge); add explicit store failure behavior and metrics. Retain local protection only as defense in depth.
- Regression tests: two-instance integration test shares counters; restart preserves the active window; TTL/cooldown expiry works; store outage behavior is explicit; trusted-proxy/IP tests remain green.

## DR-004 — A full backup can report success after writing only to ephemeral container storage

- Severity/confidence: High / High.
- Evidence: the admin backup route always calls the generic `uploadToR2()` (`backend/routes/admin/system.js:214-242`) and returns/logs success (`:243-266`). When any R2 credential is missing, that helper silently writes under `/app/exports` and returns a relative string (`backend/utils/r2.js:22-24,44-51`). The Docker workdir is `/app` (`backend/Dockerfile:13-18`), while Railway mounts persistence only at `/data` (`backend/railway.toml:11-12`). The env example labels R2 backup configuration optional (`backend/.env.example:34-38`).
- Conditions/affected scope: an operator invokes `POST /api/admin/backup` with incomplete/absent R2 credentials; platform-wide Postgres backup.
- Verification: unset one R2 credential, invoke the route in a disposable environment, and observe `200 {message:"Backup created", url:"exports/backups/..."}` with the archive under `/app/exports`; replace/redeploy the container and observe it disappear.
- Counterevidence/uncertainty: historical documentation says R2 credentials were configured in May, but current Cloudflare/Railway state was not verifiable (`../production-health.md`). With all credentials present and R2 reachable, this fallback is not taken.
- Impact: operators can believe an offsite disaster-recovery backup exists when the only copy is unreachable and erased on redeploy; backup history records the false success.
- Remediation: make the full-backup route require a configured remote backup target and reject otherwise; remove local fallback for backup-class keys. If local fallback is intentionally supported, write to a mounted persistent path, serve/admin-retrieve it safely, label it local/non-durable, and never record remote success.
- Regression tests: missing/partial R2 configuration returns non-2xx and no success log; successful R2 upload is read back/head-checked before success; container replacement test proves durability for every supported target.

## DR-005 — Platform-wide backup construction is unbounded in application memory and verification does not restore data

- Severity/confidence: Medium / High.
- Evidence: `backupAllSchemas()` streams `pg_dump` stdout (`backend/utils/backup-pg.js:93-104`), but the admin route accumulates every chunk and calls `Buffer.concat()` before upload (`backend/routes/admin/system.js:231-241`). `MAX_BACKUP_SIZE` is defined for tenant uploads (`backend/utils/backup-pg.js:16`) but is not applied to this full backup path. Verification only runs `pg_restore --list`/schema-name extraction (`backend/utils/backup-pg.js:107-138`; `backend/routes/admin/system.js:273-297`) and never restores into a disposable database or validates row/data integrity.
- Conditions/affected scope: growing production database or limited Railway container memory; full backup creation and disaster-recovery assurance.
- Verification: create a dump larger than safe Node/container headroom and record RSS while invoking the route; it grows with archive size. Corrupt data blocks while preserving enough TOC readability and observe that list-based verification cannot establish a successful restore.
- Counterevidence/uncertainty: current database/archive size and Railway memory limit were not accessible. Custom-format dumps are compressed and `pg_restore --list` catches grossly unreadable archives; the Docker image includes matching PostgreSQL 17 client tools (`backend/Dockerfile:10-12`).
- Impact: backups can OOM/restart the live API; a green verification result can overstate recoverability, leaving latent restore failures until an incident.
- Remediation: stream/multipart-upload the dump with byte limits and abort propagation instead of buffering; run scheduled restore drills into an isolated disposable database, execute integrity/smoke checks, record immutable checksum/size/tool version, and alert on failure.
- Regression tests: large generated stream stays within bounded memory; upload/pg_dump failure aborts and records failure; checksum/readback; automated disposable restore with expected schemas and sentinel rows.

## Cross-domain deployment blocker

`../backend/findings.md` BE-002 already documents that a tenant migration failure is swallowed and deployment can proceed with schema skew. It is not duplicated here, but it is launch-critical and should be included in the deployment gate.


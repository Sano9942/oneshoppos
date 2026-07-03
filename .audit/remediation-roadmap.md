# Prioritized Remediation Roadmap

## P0 — protect tenant and financial integrity

1. Fix BE-003 pooled-client `search_path` leakage and add pool-size-one cross-tenant regression tests.
2. Tenant-scope/migrate the offline queue (F-01); quarantine legacy unscoped rows before syncing.
3. Make billing webhook completion atomic and independently idempotent (BE-001).
4. Fail deployment/readiness on tenant migration failure (BE-002) and dependency/required-worker unavailability (DR-001).
5. Make FBR enqueue durable with an outbox/orphan reconciler (BE-008).
6. Prevent backup false success when R2 is unavailable (DR-004).

## P1 — reliability, auth hardening, and data-loss prevention

1. Correct field offline type routing/retry (F-02).
2. Verify and tenant-route WhatsApp POSTs; only acknowledge durable processing (BE-004).
3. Make revocation checks fail closed on operational errors (BE-009).
4. Replace bcrypt token scans and add reset-specific limiting (BE-005).
5. Serialize plan-cap enforcement and fail closed on lookup errors (BE-007).
6. Stream backups and add isolated restore drills (DR-005).
7. Add graceful shutdown and shared distributed rate-limit/alert state (DR-002/DR-003).

## P2 — UX, accessibility, and engineering controls

1. Fix shared dark-mode control tokens (F-05).
2. Repair raw upload-response handling (F-03/F-04).
3. Harden/migrate modal behavior and POS Escape handling (F-06/F-07).
4. Align restaurant route gating (F-08) and breadcrumb/loading semantics (F-09).
5. Restore or remove the broken parity scanner scripts (F-10).
6. Reduce the 825-error frontend lint backlog, starting with executable application code and CI gate restoration.
7. Triage and upgrade reachable dependency advisories; prioritize `multer`, `nodemailer`, router/build packages, and untrusted `xlsx` import paths.

## Verification gate

Before release, require backend/frontend type checks, unit tests, lint policy, restored parity check, disposable-Postgres integration tests, local/staging Playwright/axe runs, backup restore drill, and the formal deep-security scan once the host exposes at least six usable delegated slots.


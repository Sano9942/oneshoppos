# SanoPOS Evidence-Based Audit — Executive Report

## Current conclusion

The targeted audit confirmed 24 source-backed findings: 9 High, 13 Medium, and 2 Low. No Critical finding survived central severity calibration. The most consequential risks involve tenant boundary contamination through pooled PostgreSQL session state and browser offline data, non-atomic payment completion, deploys proceeding with stale tenant schemas, FBR queue-loss windows, readiness that ignores dependencies/workers, and backups that can falsely succeed on ephemeral storage.

Production evidence observed at audit time was positive where accessible: both Sentry projects reported no unresolved issues, visible Vercel production deployments were Ready, and the public deep-health endpoint reported application/database/Resend `ok`. Railway, Supabase, UptimeRobot, Cloudflare, and R2 could not all be independently verified because of authentication, connector, or timeout blockers.

Local quality gates were mixed: backend/frontend type checks pass; frontend builds; frontend unit tests pass 155/155; backend unit tests pass 519/521 with two expectation-drift failures. Full frontend lint fails with 825 errors and 119 warnings. PostgreSQL integration tests were not runnable because no local PostgreSQL/Docker capability was available.

## Completion boundary

This is not yet a literal every-file substantive audit. Per-file ledgers enumerate all scopes, but only 65 rows are recorded reviewed; 1,239 are explicitly deferred and 297 not applicable. The formal Codex Security Deep Scan is also deferred at capability preflight because the host exposes only three usable worker slots versus six required. These limitations are visible, not papered over.

## Immediate action

Treat BE-003, F-01, BE-001, BE-002, BE-008, DR-001, and DR-004 as the first remediation tranche. Do not fix them as one giant change: isolate tenant-routing, billing, migration/readiness, FBR, and backup patches with focused regression tests and staged rollout.


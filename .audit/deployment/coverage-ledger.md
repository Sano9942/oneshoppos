# Deployment/reliability coverage ledger

Audit mode: bounded, read-only source/config inspection. Only these three audit artifacts were written. No production, infrastructure, application/config, Git, or data mutation was performed.

| Domain | Evidence inspected | Result |
|---|---|---|
| Existing production snapshot | `.audit/production-health.md` | Used current observed Sentry/Vercel/deep-health results; preserved Railway/Supabase/UptimeRobot/Cloudflare access failures as blockers. |
| Railway/container | `backend/railway.toml`, `backend/Dockerfile`, `backend/start.sh`, `.dockerignore` | Build/start/volume/health/restart semantics traced. DR-001, DR-004; BE-002 cross-reference. |
| Vercel/Vite | `frontend/vercel.json`, `vite.config.js`, `package.json`, `src/config.js`, `src/main.jsx` | SPA routing, headers, build-time env, Sentry, service-worker and chunk recovery inspected. No new confirmed Vercel-source defect. |
| Health/readiness | `routes/registerAllRoutes.js:51-145`, `index.js:317-330`, health tests inventory | Shallow/deep behavior and startup ordering traced. DR-001. Existing `tests/integration/health.test.js` noted; tests were not rerun. |
| Worker lifecycle/visibility | `boot/workers.js`, `services/boss.js`, `routes/admin/system.js`, heartbeat search across `workers/*` | Env gates, registrations, heartbeats, queue history fallback, failure handling and shutdown traced. DR-001/002. Orphan-schema status omission recorded in matrix, not elevated due alternate cache visibility. |
| Logging/Sentry/alerts | `services/logger.js`, `services/alerting.js`, `utils/alertEmail.js`, `middleware/request-id.js`, global error handler, frontend Sentry init | Request-route observability verified; process-local alert aggregation and worker blind spots identified. DR-003 and DR-001 context. |
| Rate limiting/proxy | `middleware/rate-limit.js`, `index.js:87-95`, existing `pg-p29`/`pg-p30` test inventory | Keys, limits, trust-proxy and default-store behavior traced. DR-003. |
| R2/object delivery | `utils/r2.js`, `index.js:147-177`, `tests/integration/p23-r2-image-pipeline.test.js` inventory | Credential gate, fallback, URL choice, prefix restriction and deletion traced. DR-004. Live R2 blocked. |
| Backup/restore | `utils/backup-pg.js`, `routes/admin/system.js:213-312`, `routes/barcode-expenses.js:370-590`, `scripts/backup-all-tenants.js`, backup-log tests inventory | Manual platform/tenant flows, local fallback, memory behavior, TOC verification and Docker client availability traced. DR-004/005. Scheduled managed backups and restore drills blocked externally. |
| Runtime parity/env | `.env.example`, frontend/backend config readers, package scripts, docs searches | Required toggles and fallbacks mapped. Missing `backend/preflight.js` and incomplete example coverage recorded in matrix. Live values not exposed. |
| Process termination | repository search for `SIGTERM`, `SIGINT`, `process.on`, `shutdownBoss`, `server.close` outside tests | Only unused `shutdownBoss` production helper found. DR-002. |
| Tests | Existing health, rate-limit, R2, worker-status, worker-context, backup-log test sources/inventory | No tests executed to honor the read-only/no-unlisted-writes boundary. Proposed regressions are attached to each finding. |

## Explicitly not claimed

- Railway, Supabase, UptimeRobot, Cloudflare, or R2 are not labeled unhealthy; their live state was inaccessible.
- Historical walkthroughs and guides are counterevidence/context, not proof of current production configuration.
- No backup was downloaded, generated, restored, or deleted; no webhook, alert, worker, or failover was triggered.
- No secrets or environment-variable values were requested or printed.


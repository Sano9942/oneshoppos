# Production Health and Deployment Snapshot

Observed: 2026-07-03 Asia/Karachi. All checks were read-only. The skill's timestamp update was intentionally skipped.

| Service | Result | Evidence / limitation |
|---|---|---|
| Sentry backend | Healthy at check time | `sentry-cli issues list --project node-express --org sanopos --status unresolved` returned `No issues found`. |
| Sentry frontend | Healthy at check time | `sentry-cli issues list --project sanopos-frontend --org sanopos --status unresolved` returned `No issues found`. |
| Vercel | Healthy at check time | Production deployments aged 2 days and 11 days were both `Ready` (23s and 22s build durations). The bounded output did not expose a third production row. |
| Public API deep health | Healthy at check time | `https://api.sanopos.com/api/health?deep=true` returned status `ok`; database `ok` at 30ms and Resend `ok` at 355ms; timestamp `2026-07-02T21:43:21.357Z`. |
| Railway | Access deferred | CLI returned `Unauthorized. Please login with railway login`; status and logs were not inspected. This is an authentication blocker, not evidence of downtime. |
| Supabase | Access deferred | No Supabase MCP connector or CLI was available in this session. Project status/advisors were not inspected. |
| UptimeRobot | Access deferred | Both sandboxed and approved external requests failed/timed out. No monitor status was obtained; this is not evidence of downtime. |
| Cloudflare zone | Access deferred | Read-only zone request timed out twice, including a 30-second approved external retry. |
| Cloudflare R2 | Access deferred | Read-only bucket-list request timed out twice; presence of `sanopos-uploads` was not runtime-verified. |

## Interpretation

The directly observed application, database health probe, Resend probe, Sentry issue lists, and Vercel deployment rows were healthy. Railway, Supabase, UptimeRobot, Cloudflare, and R2 remain unverified because of authentication, missing connector, or network timeout conditions; they must not be represented as healthy or unhealthy without fresh evidence.


# Command and Test Results Ledger

| Time (Asia/Karachi) | Command/check | Exit | Classification | Evidence |
|---|---|---:|---|---|
| 2026-07-03 | `git status --porcelain=v2 --branch` | 0 | Pass | Main equals origin/main at `0485154`; 32 pre-existing modified documentation files and 5 untracked files preserved. |
| 2026-07-03 | Repository inventory via `rg --files` | 0 | Pass | 1,499 files: frontend 591, backend 577, docs 312, other 19. |
| 2026-07-03 | `git check-ignore -v .audit/` | 0 | Pass | `.gitignore:88` ignores `.audit/`. |
| 2026-07-03 | Toolchain preflight | mixed | Environment blocker | Node v22.22.2, npm 11.11.0, Python 3.13.5; `psql` and Docker unavailable; no local PostgreSQL listener detected. |
| 2026-07-03 | Codex Security `deep_security_scan` preflight | 1 | Environment blocker | 3 usable worker slots; 6 required. Configuration remediation applied, but host runtime remains capped at 4 total slots after restart. Durable scan remains paused. |
| 2026-07-03 | Sentry unresolved issues (backend/frontend) | 0 | Pass | Both projects returned `No issues found`. |
| 2026-07-03 | Vercel deployment list | 0 | Pass with bounded evidence | Two visible production deployments were `Ready` (ages 2d and 11d); third production row not captured. |
| 2026-07-03 | Public API deep health | 0 | Pass | Overall `ok`; database `ok`/30ms; Resend `ok`/355ms. |
| 2026-07-03 | Railway identity/status | 1 | Access blocker | CLI authentication stale; no status/log evidence collected. |
| 2026-07-03 | Supabase project/advisors | N/A | Access blocker | No connector or CLI available. |
| 2026-07-03 | UptimeRobot monitor request | timeout | Access blocker | No status obtained after approved read-only retry. |
| 2026-07-03 | Cloudflare zone and R2 requests | timeout | Access blocker | Both timed out twice; no runtime conclusion drawn. |
| 2026-07-03 | Backend `npm.cmd run typecheck` | 0 | Pass | TypeScript no-emit check passed. |
| 2026-07-03 | Backend `npm.cmd run test:unit` | 1 | Test expectation drift | 519/521 passed; wholesale modes and xPay enablement expectations differ from current implementation. |
| 2026-07-03 | Frontend `npm.cmd run build` | 0 | Pass | Vite production build passed; 3,279 modules transformed. |
| 2026-07-03 | Frontend `npm.cmd run lint` | 1 | Quality-gate failure | 944 problems: 825 errors, 119 warnings. |
| 2026-07-03 | Frontend `npm.cmd run typecheck` | 0 | Pass | TypeScript no-emit check passed. |
| 2026-07-03 | Frontend `npm.cmd run test:unit` | 0 | Pass with warnings | 18 files, 155/155 tests passed; repeated React `act(...)` warnings. |
| 2026-07-03 | Backend `npm.cmd audit --json` | 1 | Advisory inventory | 31: 14 high, 15 moderate, 2 low, 0 critical. Reachability not yet validated. |
| 2026-07-03 | Frontend `npm.cmd audit --json` | 1 | Advisory inventory | 15: 1 critical (Vitest dev tool), 9 high, 3 moderate, 2 low. Reachability not yet validated. |

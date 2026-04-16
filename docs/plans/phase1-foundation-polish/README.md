# Phase 1 — Foundation Polish

Parent plan: [sanopos-maturity-roadmap-2026-04-17.md](../sanopos-maturity-roadmap-2026-04-17.md)

Work branch: `phase1-foundation-polish` (off `main`)

## Sub-tracks

| Track | Doc | Status |
|-------|-----|--------|
| 1.1 Performance & UX baseline | [01-baseline.md](01-baseline.md) | Captured |
| 1.1 Production snapshot | [02-prod-snapshot.md](02-prod-snapshot.md) | Captured (DB, Sentry, uptime) — revised priority list |
| 1.1 Tier 1 + Tier 2 results | [03-tier1-tier2-results.md](03-tier1-tier2-results.md) | Tier 1 done (3/3), Tier 2 partial (1/3, 2 deferred with reasons) |
| 1.1 Tier 3.1 chunk-load handler | commit `c87c2db` | Done — fixes Sentry SANOPOS-FRONTEND-7 class of error after deploys |
| 1.2 Design system audit | [04-design-system-audit.md](04-design-system-audit.md) | Audit done — 346 divergence sites identified, 5-step execution plan |
| 1.2 Step 1 primitives | commit `f2f591d` | Modal/ConfirmDialog/TabBar + Button extensions, 24 unit tests |
| 1.2 Step 2 Billing pilot | [05-billing-pilot-results.md](05-billing-pilot-results.md) | Pilot done — refined audit with intentional-divergence carve-outs |
| 1.2 Step 2 remaining 4 pages | _(in progress)_ | CustomerInvoices, CommissionPlans, Marketing, SmartCollections |
| 1.3 Reliability hardening | _(pending)_ | Sentry top-10 = 0 unresolved; reframed in 02 |
| 1.4 The 1% details | _(pending)_ | Not started |

## How to run the slow-query inspector

```bash
DATABASE_URL=postgres://... node tools/inspect-slow-queries.js 20
```

Output: top 20 queries by total execution time from `pg_stat_statements`.
Safe to run against production (read-only, one extension query + one select).

## Phase 1 "done" definition

- Lighthouse Performance > 90 on the 11 key pages in [01-baseline.md](01-baseline.md)
- Web Vitals: LCP < 2.5s, INP < 200ms, CLS = 0
- Top 3 slowest queries each reduced ≥ 50%
- All `*Redesign.jsx` pages use canonical primitives only
- Top 10 Sentry errors from prior 30 days fixed
- Playwright smoke tests for 5 highest-revenue journeys running in CI
- Duplicate-payment / duplicate-sale detectors wired

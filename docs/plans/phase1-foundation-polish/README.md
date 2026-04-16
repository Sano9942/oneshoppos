# Phase 1 — Foundation Polish

Parent plan: [sanopos-maturity-roadmap-2026-04-17.md](../sanopos-maturity-roadmap-2026-04-17.md)

Work branch: `phase1-foundation-polish` (off `main`)

## Sub-tracks

| Track | Doc | Status |
|-------|-----|--------|
| 1.1 Performance & UX | [01-baseline.md](01-baseline.md) | Baseline captured, improvements TBD |
| 1.2 Design system convergence | _(pending)_ | Not started |
| 1.3 Reliability hardening | _(pending)_ | Not started |
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

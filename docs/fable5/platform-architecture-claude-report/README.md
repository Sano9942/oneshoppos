# Platform Architecture — Claude Audit Report

> **STATUS: VERIFIED CURRENT-STATE SNAPSHOT.**
> Audited at commit **`3b84732d`** (main) on **2026-07-29**, cross-checked against **live production** on the same date.
> This describes how the system **actually worked** on that date. It is **not** a target architecture and contains **no proposals** other than the clearly-labelled recommendations in §14 of the main report.
> **This is a snapshot and it will drift.** See "Re-verifying this report" below before trusting any specific number.

---

## What this is

A whole-system technical architecture audit of SanoPOS, produced by eight parallel read-only source-code audits, then independently re-verified against live production infrastructure.

Two ground rules governed the audit:

1. **Source code is the only evidence.** `CLAUDE.md`, `AGENTS.md`, and everything under `docs/` were deliberately excluded as evidence. Several findings in this report **contradict** those documents — see "Known documentation contradictions" below.
2. **Every claim is graded.** Nothing is asserted without saying how strongly it is known.

| Grade | Meaning |
|---|---|
| **CONFIRMED (live)** | Reproduced against production during the audit. Highest confidence. |
| **CONFIRMED (source)** | Re-read directly in source by the report author. |
| **REPORTED** | Found by a subsystem audit, not independently re-verified. High confidence, but verify before acting. |

## How to read this

| Read this | If you want |
|---|---|
| §1 and §12 of [`01-architecture-report.md`](01-architecture-report.md) | The verdict and the ranked risk register — start here |
| [`01-architecture-report.md`](01-architecture-report.md) in full | The complete system picture, 14 sections |
| [`02-verification-log.md`](02-verification-log.md) | The live evidence, **with runnable commands** to re-check it |
| [`subsystem-audits/`](subsystem-audits/) | The raw per-subsystem evidence base with file:line citations |

## Contents

```
platform-architecture-claude-report/
├── README.md                     ← you are here
├── 01-architecture-report.md     ← the main report (~10,000 words, 14 sections)
├── 02-verification-log.md        ← live production evidence + reproduction commands
└── subsystem-audits/             ← raw agent briefings (evidence base)
    ├── 01-backend-core.md            boot, middleware chain, multi-tenancy, auth primitives
    ├── 02-api-route-surface.md       1,344 endpoints, mount order, guard census
    ├── 03-services-and-workers.md    104 services, 27 workers, integrations
    ├── 04-data-model.md              327 tables, 137 migrations, integrity patterns
    ├── 05-frontend.md                React 19 SPA, POS architecture, design system
    ├── 06-security-posture.md        authN/authZ, crypto, webhooks, isolation
    ├── 07-testing-ci-tooling.md      334 test files, 2 CI workflows, drift guards
    └── 08-business-domains.md        sale write path, verticals, integrations
```

## Headline findings

Full detail in §1 and §12 of the main report. The five that most affect decisions:

1. **Scale vs. validated usage.** ~182k lines of backend, 1,344 endpoints, 327 tables, 137 migrations — against **59 sales, 81 products, 40 employees** across all 29 active tenants. Only 5 tenants have ever made a sale. Most risks below are **latent, not currently biting**. This should frame every other judgement.
2. **Three independent stock-movement implementations** — the shared `stock-ledger.js`, an un-migrated inline copy in the POS sale path (which the ledger was extracted *from*), and an unlocked bare `outlet_stock` upsert in the Shopify order service. Highest-value correctness risk in the codebase.
3. **Shopify order webhook is unreachable** (CONFIRMED live) — mounts behind the tenant auth wall, returns `AUTH_REQUIRED`, HMAC verification never runs. Blast radius today is **zero** (0 active connections); breaks the first merchant who connects.
4. **`GET /api/feature-flags` is effectively unauthenticated** (CONFIRMED live) — checks that an `x-employee-id` header is *present*, never what it contains.
5. **Single-instance-only by construction** — 8+ process-local caches with in-process-only invalidation, plus in-memory rate limiters. This is a *correctness* limit, not a performance one, and nothing fails loudly if a second instance is added.

## Relationship to the other architecture docs

| Document | Status | Use it for |
|---|---|---|
| **This report** | Verified current-state @ `3b84732d`, 2026-07-29, **+ live production verification** | What the system does now, and what is provably broken now |
| `docs/fable5/technical-architecture-report/` | Verified current-state, source-only (no live verification) | Developer-oriented current-state reference. Broadly consistent with this report. |
| `docs/fable5/platform-architecture-vnext/` | **Proposed target** — only ADR-002 accepted | Direction of travel **only**. Never implement from it or cite it as current behaviour. |

Precedence when they disagree: **source code wins**, then this report (for anything dated 2026-07-29 or verified live), then the current-state report, then `CLAUDE.md`. The vNext package is not evidence of current behaviour under any circumstances.

## Known documentation contradictions

The audit found these project-doc claims to be **wrong** as of 2026-07-29. Listed here because they are actively misleading, not merely stale:

| Claim in docs | Reality (verified) |
|---|---|
| Supabase allows ~200 Postgres connections | **`max_connections = 60`** (live query) |
| Background marketplace sync worker runs | The worker is an **honest stub** that schedules nothing and reports `mode:"manual"` |
| Stock-ledger consolidation is complete | The POS sale path **never migrated onto it**; a third implementation exists in Shopify order-service |

## Re-verifying this report

Everything here decays. Before relying on a specific number:

- **Live infrastructure claims** — re-run the commands in [`02-verification-log.md`](02-verification-log.md). They are all read-only and safe.
- **Source claims** — the report cites `file:line`. Line numbers drift with every commit; grep the named symbol rather than trusting the line number.
- **Counts** (endpoints, tables, tests) — regenerate with the commands recorded in the verification log.
- **Migration head** — was v137 with all 29 tenants in sync. Check `backend/migrate-pg.js` `MIGRATIONS` for the current head.

If you are a future session reading this: treat the *reasoning* as durable and the *numbers* as dated. Where this report says "CONFIRMED (live)", that was true on 2026-07-29 and may have been fixed since — check before repeating the finding.

## Method and limitations

Eight parallel read-only agents audited the subsystems listed above. Each was instructed to cite file and line, to treat documentation as non-evidence, and to state explicitly what it could not verify. The report author then independently re-verified the highest-severity claims against production.

**Limitations.** No code was executed beyond read-only HTTP probes and read-only SQL. The test suite was not run. Concurrency behaviour was not load-tested. A small number of cross-file claims (the `/api/approvals` route collision between `approval-policies.js` and `tier4/approvals.js`; the precise third `requirePlanLimit` call site) remain unverified and are flagged as such in the text. Business logic was assessed for structural correctness, **not** for domain-rule accuracy against Pakistani tax or labour regulation.

## Provenance

Generated by Claude (Fable 5) via Claude Code, 2026-07-29. Eight parallel read-only subsystem audits plus live verification against Supabase, Railway, Vercel, and Sentry. No source files were modified during the audit.

# Independent Assessment & Launch Decision Record

**Created:** 2026-07-29 · **Repo state:** branch `docs/platform-architecture-claude-report`, HEAD `d505b718`
**Status:** ACTIVE — this is the working plan, not a historical record.

---

## What this folder is

An outside-agency assessment of SanoPOS, plus the decisions taken as a result and the plan they produced. It exists so the reasoning survives — what we're doing, why, what we deliberately rejected, and what's left.

| File | Read it for |
|---|---|
| [`01-assessment.md`](01-assessment.md) | The findings. 4 P0s, ~12 P1s, ~30 P2/P3s, across engineering, security, privacy, ops, accessibility and commercial reality |
| [`02-decisions-and-rationale.md`](02-decisions-and-rationale.md) | **What was decided and why.** Including what was rejected and the reasoning behind it. Read this before changing course |
| [`03-action-plan.md`](03-action-plan.md) | The sequenced, hour-budgeted task list. Checkboxes. This is what to work against |
| [`04-open-questions.md`](04-open-questions.md) | Things not verified, and questions only the owner can answer |
| [`05-frontend-dependency-audit.md`](05-frontend-dependency-audit.md) | The frontend dep picture Phase 0 never covered. 15 vulnerabilities, **2 of them reach a browser**; `npm audit fix` clears 14 with no manifest edit. Read before reacting to the alert count |

## Precedence

**Source code wins.** Then this folder (for anything dated 2026-07-29 or later). Then `docs/fable5/platform-architecture-claude-report/`. Then `CLAUDE.md`.

`docs/fable5/platform-architecture-vnext/` remains **direction-of-travel only** — never implement from it. The one exception is **ADR-002, which is Accepted** and is a *product-scope* decision, not an implementation instruction. See [`02-decisions-and-rationale.md`](02-decisions-and-rationale.md) §D6.

## The one-paragraph situation

SanoPOS is a large, capable, genuinely well-crafted multi-tenant POS with **zero revenue and zero external merchants**. 8 of 10 shipped verticals have never held a row of production data. Four defects were found in code paths that have **never once worked** — invisible to a source-reading audit because reading tells you what code means to do, not what it does. The engineering instinct is above average; the verification loop is missing at every level, from unit tests to customers. The decision taken is to **sell now and fix in parallel**, keeping all code and the full fix scope, because the binding constraint is distribution, not features.

## Rules for this folder

1. **It self-destructs.** When the plan in `03` is executed, archive this folder. A stale plan is worse than none — that lesson is itself a finding in `01`.
2. **Keep it to these four files.** This repo already carries 397 markdown files and 151,194 lines of documentation against ~300,000 lines of code. Documentation volume is a named finding in `01` §4.1. Do not let this folder grow into another programme.
3. **Corrections go in the appendix of `01`, not silently into the text.** One claim in this assessment was already wrong (a deploy runbook does exist) and the correction is logged rather than edited out. Keep that habit.
4. **Numbers decay, reasoning doesn't.** Every count here was true on 2026-07-29. Re-derive before betting on one.

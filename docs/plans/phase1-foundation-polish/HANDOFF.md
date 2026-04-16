# Phase 1 Handoff — Resume in a Fresh Session

> **Written:** 2026-04-17
> **Why this exists:** the originating session got long. Read this doc + the linked plans, do NOT try to reconstruct conversation history.

---

## Parent plan

**SanoPOS Maturity Roadmap — From Scaffolding to Square/Shopify Parity**

- Repo path: [../sanopos-maturity-roadmap-2026-04-17.md](../sanopos-maturity-roadmap-2026-04-17.md)
- Local copy: `~/.claude/plans/we-have-made-allof-smooth-jellyfish.md`

The roadmap has 5 phases. We are inside **Phase 1 — Foundation Polish**.

---

## Where we are inside Phase 1

- Phase tracker + sub-doc index: [README.md](README.md)
- All sub-docs in this folder, numbered for read order:
  - [01-baseline.md](01-baseline.md) — bundle stats, schema indexes, slow-query script
  - [02-prod-snapshot.md](02-prod-snapshot.md) — live Supabase + Sentry + UptimeRobot pull, revised priority list
  - [03-tier1-tier2-results.md](03-tier1-tier2-results.md) — 3 backend perf wins shipped, frontend bundle work outcomes
  - [04-design-system-audit.md](04-design-system-audit.md) — 346 divergence sites, 5-step plan
  - [05-billing-pilot-results.md](05-billing-pilot-results.md) — first page conversion done, **lesson logged: audit overstates real work**

---

## What's already shipped (PR #13 merged to `main` at f437f68)

GitHub PR: https://github.com/Sano9942/oneshoppos/pull/13 (state: MERGED, 2026-04-17 21:22 UTC)

Concrete deliverables:
- Maturity roadmap doc + slow-query inspector tool (`tools/inspect-slow-queries.js`)
- Tier 1 backend perf: `/api/admin/infra` 5-min cache, `InfrastructurePanel` polling 60s + tab-hidden pause, orphan-schema scan moved to hourly pg-boss worker (migration v50, `public.infra_cache` table)
- Tier 2 frontend: lazy-load `xlsx` in COD `ImportWizard`
- Tier 3.1: stale-chunk auto-reload handler in `main.jsx` + `utils/chunkReload.js`
- Phase 1.2 Step 1: new primitives in `ui/primitives.jsx` — `Modal`, `ModalBody`, `ModalFooter`, `ConfirmDialog`, `TabBar` + `Button` extensions (`iconOnly`, `tone="link"`)
- Phase 1.2 Step 2 pilot: `BillingRedesign.jsx` upgrade modal converted to new `Modal` primitive
- 47 new unit tests (24 primitives + 11 chunk-reload + 5 backend + 7 misc), all passing

---

## What's next — pick up here

### Immediate next task: continue Phase 1.2 Step 2 (4 pages remaining)

Apply the same pattern as the Billing pilot ([05-billing-pilot-results.md](05-billing-pilot-results.md)) to the next 4 worst-offender pages:

1. `frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx` — 10 raw buttons + 9 raw inputs
2. `frontend/src/pages/redesign/CommissionPlansRedesign.jsx` — 9 buttons + 8 inputs
3. `frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx` — 9 buttons + 6 inputs
4. `frontend/src/pages/redesign/SmartCollectionsRedesign.jsx` — 7 buttons

**Workflow per page** (from [05-billing-pilot-results.md](05-billing-pilot-results.md) "Revised Step 2 plan"):
1. Find every `fixed inset-0 z-N` block — convert to `<Modal>` (drop-in, escape/focus/aria handled by primitive)
2. Convert any modal-internal save/cancel buttons to `<Button>` + `<ModalFooter>`
3. Look at raw `<button>` outside modals — categorize as:
   - **Drop-in convertible** (generic save/cancel/confirm) → convert to `<Button>`
   - **Needs different primitive** (toggle cards, radio groups) → leave with one-line comment
   - **Intentional visual signal** (state-colored CTAs like billing trial/grace/expired) → leave with one-line comment

**Critical lesson from the pilot:** the audit's raw-button count overstates real work. Many "divergences" are intentional UX. **Don't mechanically replace state-colored buttons with `tone="primary"`** — you'll erase real signal.

**Recommended cadence:** one commit per page. Each commit message includes before/after divergence counts and which buttons were intentional-keeps vs converted (mirror the BillingRedesign commit message style — see `git show 1a82326` for reference, or any of the commits in PR #13).

### Then: Phase 1.2 Step 3-5 ([04-design-system-audit.md](04-design-system-audit.md) §"Phased execution plan")

- Step 3: convert remaining ~84 pages in domain batches
- Step 4: ESLint rule blocking raw `<button>` / `<input>` in `src/pages/`
- Step 5: dark-mode walkthrough

### Deferred from Phase 1.1 (still on the backlog)

- **Tier 3.2:** Playwright smoke tests for top-5 user journeys, in CI. Needs GitHub Actions setup + secrets config + selecting 5 specs from the existing 28.
- **Tier 3.3:** duplicate-payment / duplicate-sale detector. Needs a brainstorm first (block vs alert? time window? per-outlet vs global?).
- **Per-tab `reports-*.js` split** ([03-tier1-tier2-results.md](03-tier1-tier2-results.md) §"Deferred"): real ~85 KB gzip savings but needs `React.lazy` + Suspense across ~20 files + revalidation of 17 standalone deep-link routes. Its own focused PR.

---

## Repo state right now

- Local `main` = `origin/main` = `f437f68` (PR #13 merged)
- No working-tree changes (a `.claude/settings.json` modification predates this work and is unrelated)
- Phase 1 work branch `phase1-foundation-polish` was deleted on remote after merge; local copy was reset

Safety tag: `local-main-pre-reset-2026-04-17` points at the old local-only Wave 5 history (16 commits) before we reset to `origin/main`. **Do not use it** unless you specifically need to inspect that history — those commits' content is already in `f437f68` via the squash.

---

## Verification before continuing

Run these once when you start the new session, just to confirm baseline:

```bash
cd d:/newprojects/oneshoppos
git status                                        # should show clean (or only .claude/settings.json)
git log --oneline -3                              # top should be f437f68
cd frontend && npx vitest run tests/unit/        # should pass 99 tests
cd .. && npx vitest run --dir backend/tests/unit  # should pass 351, 1 pre-existing fail (PAYMENT_GATEWAY=xpay) unrelated
cd frontend && npx vite build                     # should succeed
```

If any of those fail with new errors, don't continue Step 2 — investigate first.

---

## Key files to reference (the new primitives are the conversion target)

- [`frontend/src/ui/primitives.jsx`](../../frontend/src/ui/primitives.jsx) — `Modal`, `ConfirmDialog`, `TabBar`, `Button` (+ `iconOnly` + `tone="link"`)
- [`frontend/tests/unit/primitives-modal.test.jsx`](../../frontend/tests/unit/primitives-modal.test.jsx) — 24 unit tests showing how each primitive is meant to be used
- [`frontend/src/pages/redesign/BillingRedesign.jsx`](../../frontend/src/pages/redesign/BillingRedesign.jsx) — pilot conversion (see commit `1a82326` for the diff)

---

## Operational reminders for the resuming session

- Use `mcp__claude_ai_Supabase__execute_sql` (or the slow-query inspector) for prod DB checks — read-only is safe
- Sentry/UptimeRobot CLIs are auth'd via env vars in `.claude/settings.local.json`
- Don't push directly to `main` — open a PR for any sub-step that adds new files
- Per-page commits beat batch commits — easier to revert any single page if it regresses
- After 4-5 pages, push branch, open PR for review (don't accumulate 11+ commits like last time)
- `.claude/settings.json` has an unrelated dirty modification — leave it alone, don't include it in any commits

# Phase 1.2 Step 2 — Billing Pilot

> **Captured:** 2026-04-17
> **Branch:** `phase1-foundation-polish`
> **Goal:** Pilot the new Modal primitive on one high-traffic page before
> rolling out to the other 4 worst offenders.

---

## What changed

[frontend/src/pages/redesign/BillingRedesign.jsx](../../frontend/src/pages/redesign/BillingRedesign.jsx):

- Imported `Modal`, `ModalFooter`, `Button` from `ui/primitives`
- Replaced the inline `<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">` upgrade modal with `<Modal open={...} onClose={...} title="..." size="sm">`
- Replaced the modal's two raw `<button>` (Cancel + Send Request) with `<Button>` + `<Button tone="primary">`
- Wrapped the action buttons in `<ModalFooter>`
- Modal now also gets escape-key handling, focus restore on close, and
  backdrop click — none of which the inline version had.
- Auto-disable backdrop close when `submitting` (modal won't close
  mid-API-call) — was previously possible to dismiss mid-submit.

## What I deliberately did NOT change

The audit counted 8 raw `<button>` tags on this page. I kept 7 of them:

- **6 status-banner CTAs** (lines 254, 277, 298, 303, 357 — the trial /
  grace / expired / renewal "Pay Now" / "Subscribe" buttons). These use
  intentional brand colors per billing state — **amber for trial, red
  for grace/expired, emerald for normal upgrade, blue for trial banner**.
  This is deliberate visual urgency tied to billing semantics, not a
  divergence to fix. Replacing with `tone="primary"` would lose the
  signal that prompts users to pay before service interruption.
- **The cycle-card toggle buttons** (line 131) — they're plan-tier toggle
  cards with custom selected/unselected styling, "Best Value" badge,
  embedded pricing detail. Not a generic button. Would need a
  `<RadioCard>` primitive to converge cleanly. Out of scope.

The `<textarea>` (line 413) was also kept — there's no `Textarea`
primitive yet; adding one is one PR by itself.

---

## Lesson for the audit

The naive divergence count overstated the work needed. Of the 159 raw
`<button>` tags counted across all pages:
- A meaningful fraction are **state-colored CTAs** (billing, alerts,
  warnings) where the divergence is intentional UX, not drift.
- Some are **toggle / radio / pill controls** that need a different
  primitive (RadioCard, Pill, ToggleGroup).
- The rest are the genuine convergence targets — generic save/cancel/
  confirm buttons that should use `<Button>`.

Same for inline modals: the **fixed inset-0 z-N count is the right
target** — virtually every one is a true convergence opportunity (no
modal needs custom backdrop UX). Modal conversions are the highest-ROI
work in Phase 1.2.

---

## Revised Step 2 plan

Original: convert 5 worst-offender pages mechanically.
Revised: **focus on modal conversions across all 5 pages first**, then
audit the remaining raw buttons per-page to separate "intentional
divergence" from "real drift".

For each of the 5 pages, the workflow is:
1. Find every `fixed inset-0 z-N` block — convert to `<Modal>` (2-15
   minutes per modal).
2. Convert any modal-internal save/cancel buttons to `<Button>`.
3. Look at raw `<button>` outside of modals — categorize each as
   "drop-in convertible", "needs different primitive", or "intentional
   visual signal".
4. Drop-in convertible: convert. Other two categories: leave with a
   one-line comment noting why, so future audits don't re-flag them.

This avoids the trap of "the audit said convert N buttons, so I converted
N buttons" — which would have erased the trial/grace/expired urgency
colors on this page.

---

## Build / test verification

- `npx vite build`: passes, entry chunk unchanged at 82.45 KB gzip
  (was 82.48 — 0.03 KB savings from removing the inline modal markup).
- `npx vitest run tests/unit/`: all 99 frontend unit tests pass,
  including the 24 new Modal/ConfirmDialog/TabBar tests.
- No new test added for Billing specifically — the build's JSX
  validation + the Modal primitive's own unit tests cover the
  contract; mocking the full billing flow for a drop-in swap is
  high-effort, low-signal.

---

## Net effect on Billing

| Metric | Before | After |
|--------|--------|-------|
| Raw `<button>` tags | 8 | 7 (all retained intentionally) |
| Inline `fixed inset-0 z-N` modals | 1 | 0 |
| Modal handles Escape | no | yes |
| Modal restores focus on close | no | yes |
| Modal blocks backdrop close while submitting | no | yes |
| Lines changed | — | ~30 |

The user-visible improvement is small per-page but compounds across the
106 modals in the codebase. By the time Step 2 wraps the 5 worst
offenders, every Pro tenant interacting with billing/invoices/
subscriptions/marketing/smart collections will hit a modal that handles
escape key and focus correctly.

---

## Next: 4 remaining worst-offender pages

In order of impact:

1. `CustomerInvoicesRedesign.jsx` — 10 buttons (likely several modals)
2. `CommissionPlansRedesign.jsx` — 9 buttons + 8 inputs
3. `MarketingCampaignsRedesign.jsx` — 9 buttons + 6 inputs
4. `SmartCollectionsRedesign.jsx` — 7 buttons

Workflow: one commit per page, each documents its before/after counts
and which buttons were intentional-keeps vs converted.

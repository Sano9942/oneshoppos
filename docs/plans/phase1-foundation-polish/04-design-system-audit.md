# Phase 1.2 — Design System Convergence: Audit

> **Captured:** 2026-04-17
> **Branch:** `phase1-foundation-polish`
> **Goal:** scope the design-system convergence work before touching pages,
> so we know what "done" means and which pages to start with.

---

## What we have today

10 primitives in [frontend/src/ui/primitives.jsx](../../frontend/src/ui/primitives.jsx):

`PageShell`, `SectionCard`, `Button`, `Input`, `Select`, `Badge`, `TableToolbar`, `BulkActionBar`, `EmptyState`, `Skeleton`.

Adoption is widespread but not deep:

| Metric | Count |
|--------|-------|
| `*Redesign.jsx` pages | 89 |
| Pages importing primitives | **88 / 89** (99%) |
| Pages using `PageShell` | **84 / 89** (94%) |

**Adoption breadth is fine.** The problem is what each page does *between* importing primitives and rendering a one-off button.

---

## The actual divergence: 346 sites across 3 patterns

| Pattern | Total occurrences | Worst page | What it means |
|---------|-------------------|------------|---------------|
| Raw `<button>` (not `<Button>`) | **159** | CustomerInvoicesRedesign (10) | Every page rolls its own button styling |
| Raw `<input>` (not `<Input>`) | **81** | ReturnPoliciesRedesign (9), CustomerInvoicesRedesign (9) | Forms drift in spacing, focus rings, dark-mode |
| Inline modal `fixed inset-0 z-N` | **106** across 72 pages | n/a — almost everywhere | **No `Modal` primitive exists.** Every modal is bespoke. |

Hot pages (most divergence sites combined):

1. `CustomerInvoicesRedesign.jsx` — 10 buttons + 9 inputs
2. `CommissionPlansRedesign.jsx` — 9 buttons + 8 inputs
3. `MarketingCampaignsRedesign.jsx` — 9 buttons + 6 inputs
4. `SmartCollectionsRedesign.jsx` — 7 buttons
5. `BillingRedesign.jsx` — 8 buttons (this is high-traffic)
6. `SubscriptionsRedesign.jsx` — 7 buttons
7. `PostdatedChequesRedesign.jsx` — 6 buttons
8. `PurchaseOrdersRoute` (legacy) — 5 buttons
9. `ReturnPoliciesRedesign.jsx` — 9 inputs
10. `ReportBuilderRedesign.jsx` — 6 inputs

---

## Why this matters

- The user's exact complaint was **"Screens feel slow/rough vs Square polish"**. With 159 unique button styles, 81 unique input styles, and 106 unique modal styles across 89 pages, "rough" is mathematically inevitable.
- Backend perf wins (Tier 1 shipped) eliminate slow-feeling pages but not rough-looking ones.
- This is the single biggest leverage point against the original "feels rough" complaint.

---

## Two strategic moves before touching any page

### Move 1 — Add a `Modal` primitive

Biggest ROI: 106 inline modals across 72 pages have **no canonical pattern**. Every modal page reinvents:

- Backdrop (`fixed inset-0 bg-black/40 z-50`)
- Container (`flex items-center justify-center`)
- Card (`max-w-md rounded-xl bg-white p-5 shadow`)
- Close button (varies wildly)
- Escape-key handling (often missing)
- Focus trap (basically never)

Proposed primitives:

```jsx
<Modal open={open} onClose={...} title="...">
  <ModalBody>...</ModalBody>
  <ModalFooter>
    <Button variant="default" onClick={onClose}>Cancel</Button>
    <Button tone="primary" onClick={onSave}>Save</Button>
  </ModalFooter>
</Modal>

<ConfirmDialog
  open={confirmOpen}
  title="Delete this customer?"
  body="This cannot be undone."
  destructive
  onConfirm={...}
  onCancel={...}
/>
```

Replaces ~106 sites with one canonical implementation that handles backdrop, escape key, focus trap, and consistent styling.

### Move 2 — Extend `Button` for the missing real cases

Audit shows raw `<button>` usage is dominated by:

- **Icon-only buttons** in toolbars, table rows (Edit/Delete icons) — `<Button>` has no icon-only variant
- **Tab buttons** in tab strips — has its own visual language
- **Link-style buttons** ("Show more", "Cancel") — needs a `link` tone
- **Toggle buttons** (segmented controls)

Proposed `Button` API additions:

```jsx
<Button tone="primary" size="md">Save</Button>     // existing
<Button tone="link">Show more</Button>             // NEW: link tone
<Button iconOnly aria-label="Edit"><Pencil /></Button>  // NEW: icon-only
<TabBar value={tab} onChange={setTab}              // NEW: tab primitive
  tabs={[{value: 'a', label: 'A'}, ...]} />
```

After this, the 159 raw buttons are all replaceable with proper variants — no more "well it doesn't fit the current API so I'll just inline it".

---

## Phased execution plan

### Step 1 — Add the missing primitives (1 PR)

- New `Modal`, `ModalBody`, `ModalFooter`, `ConfirmDialog`
- New `Button` `tone="link"` variant + `iconOnly` prop
- New `TabBar` primitive (segmented control)
- Unit tests for each (open/close, escape key, focus trap, prop variants)
- Storybook-style demo page at `/dev/primitives` (admin-only) so we can eyeball them all in one place

### Step 2 — Convert 5 highest-divergence pages (1 PR)

CustomerInvoicesRedesign, CommissionPlansRedesign, MarketingCampaignsRedesign, BillingRedesign, SmartCollectionsRedesign.

Why these 5: they're the worst offenders **and** all are in active customer use. Every merchant interacting with billing/invoices/marketing today sees the rough version. Fixing them first delivers the most-noticed visual improvement.

Each page conversion = drop-in replacement, no logic change. Should be ~50 lines per page on average.

### Step 3 — Convert remaining pages in batches (3-4 PRs)

Group by domain (e.g. "all phase4 modal pages", "all reports tabs", "all admin pages"). Roll forward at a controlled pace; each PR includes screenshots before/after for the changed pages.

### Step 4 — Lint enforcement (1 PR)

Add an ESLint rule (custom or via existing plugin) that flags raw `<button>` and `<input>` in `src/pages/` files. Allow with `// eslint-disable-line` for the legitimate exceptions (which should be rare).

### Step 5 — Dark-mode QA pass (1 PR)

Walk every page in dark mode after the conversions. The new primitives use `--ui-text` / `--ui-surface` tokens correctly, so dark mode should "just work" — but bespoke styles in the legacy raw markup didn't. Catch any leftovers.

---

## Estimated total effort

- Step 1: 1-2 days (primitives + tests + demo page)
- Step 2: 1-2 days (5 high-traffic pages)
- Step 3: 4-6 days (~84 remaining pages, batched)
- Step 4: half day (lint rule + cleanup)
- Step 5: 1 day (dark-mode walkthrough)

**Total: ~10 working days for full convergence**, but Step 1 + Step 2 alone (~3-4 days) deliver the most user-visible improvement.

---

## What "Phase 1.2 done" means

- Zero raw `<button>` in `src/pages/` (or all flagged exceptions justified by ESLint disable comments)
- Zero raw `<input>` in `src/pages/` (same)
- Zero inline `fixed inset-0 z-N` modal markup — all modals use the `Modal` primitive
- Lint rule active in CI
- Dark-mode walkthrough documented in `06-dark-mode-pass.md`
- Before/after screenshots of the top 10 high-traffic pages

---

## What this audit deliberately does NOT recommend

- **No new visual design.** The `--ui-*` tokens stay as they are. Convergence ≠ redesign.
- **No POS reskin.** Per CLAUDE.md, POS uses hardcoded colors intentionally. Out of scope.
- **No legacy page conversions** (`Accounting.jsx`, `Approvals.jsx`, etc.). Only `*Redesign.jsx` files.
- **No animation library** (Framer Motion, etc.). The "feels slow" complaint is about response times, already addressed by Tier 1. Don't introduce animation overhead.

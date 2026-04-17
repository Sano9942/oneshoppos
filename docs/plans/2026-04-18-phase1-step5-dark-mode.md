# Phase 1.2 Step 5 — Dark Mode QA Pass Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 128 hardcoded Tailwind color classes across 27 redesign pages so every page renders correctly in dark mode.

**Architecture:** Mechanical token substitution — replace hardcoded `bg-white`, `text-gray-*`, `bg-slate-*`, etc. with `--ui-*` CSS variable equivalents. Pages that already use the `dark:` variant pattern get `dark:` overrides instead. No logic changes, no new components. Three batched PRs.

**Tech Stack:** React JSX, Tailwind CSS v4, `--ui-*` tokens in `frontend/src/ui/tokens.css`

---

## Token Substitution Reference (use this for every edit)

| Hardcoded class | Replace with |
|---|---|
| `bg-white` | `bg-(--ui-surface)` |
| `bg-slate-50`, `bg-gray-50` | `bg-(--ui-muted-surface)` |
| `bg-slate-100`, `bg-gray-100` | `bg-(--ui-muted-surface)` |
| `bg-slate-200`, `bg-gray-300` | `bg-(--ui-border)` |
| `border-slate-50`, `border-slate-100`, `border-gray-100` | `border-(--ui-border)` |
| `border-slate-200`, `border-slate-300`, `border-gray-200` | `border-(--ui-border)` |
| `text-slate-900`, `text-gray-900` | `text-(--ui-text)` |
| `text-slate-700`, `text-slate-800`, `text-gray-700` | `text-(--ui-text)` |
| `text-slate-500`, `text-slate-600`, `text-gray-500`, `text-gray-600` | `text-(--ui-text-muted)` |
| `text-slate-300`, `text-slate-400`, `text-gray-400` | `text-(--ui-text-muted)` |

**Leave untouched:** `text-red-*`, `text-blue-*`, `text-green-*`, `text-amber-*`, `text-emerald-*` — intentional semantic colors.

**Pattern rule:** If a page already uses `dark:` variant classes extensively, add `dark:` overrides to match (e.g. `text-gray-500 dark:text-slate-400`). Otherwise use `--ui-*` tokens. Do not mix patterns on the same page.

**Pages using `dark:` variants** (add `dark:` overrides, don't swap to tokens):
`FulfillmentRedesign.jsx`, `StockCountRedesign.jsx`, `PostdatedChequesRedesign.jsx`, `ChartOfAccountsRedesign.jsx`, `ProductFormPage.jsx`

**All other pages** (use `--ui-*` token substitution).

---

## Branch Setup

```bash
cd d:/newprojects/oneshoppos
git checkout main
git pull
git checkout -b phase1-step5-dark-mode
```

Expected: `Switched to a new branch 'phase1-step5-dark-mode'`

---

## Task 1: Batch 1 — Heavy hitters (FulfillmentRedesign, StockCountRedesign, PostdatedChequesRedesign)

**Files:**
- Modify: `frontend/src/pages/redesign/FulfillmentRedesign.jsx`
- Modify: `frontend/src/pages/redesign/StockCountRedesign.jsx`
- Modify: `frontend/src/pages/redesign/PostdatedChequesRedesign.jsx`

These three pages already use the `dark:` variant pattern — add `dark:` overrides to the remaining hardcoded classes.

### Step 1: Fix FulfillmentRedesign.jsx

All occurrences are `text-gray-400` or `text-gray-500` with no dark override. Add `dark:text-slate-400` after `text-gray-500`, `dark:text-slate-500` after `text-gray-400`.

Use replace_all=false and fix each occurrence. The lines to fix (grep confirms these have no dark: override):

```bash
cd d:/newprojects/oneshoppos/frontend
grep -n "text-gray-[45]00" src/pages/redesign/FulfillmentRedesign.jsx | grep -v "dark:"
```

For each `text-gray-500` found: replace with `text-gray-500 dark:text-slate-400`
For each `text-gray-400` found: replace with `text-gray-400 dark:text-slate-500`

### Step 2: Fix StockCountRedesign.jsx

```bash
grep -n "text-gray-[0-9]" src/pages/redesign/StockCountRedesign.jsx | grep -v "dark:"
```

- `text-gray-500` → `text-gray-500 dark:text-slate-400`
- `text-gray-600` → `text-gray-600 dark:text-slate-300`
- `text-gray-400` → `text-gray-400 dark:text-slate-500`

### Step 3: Fix PostdatedChequesRedesign.jsx

```bash
grep -n "text-gray-[0-9]" src/pages/redesign/PostdatedChequesRedesign.jsx | grep -v "dark:"
```

- `text-gray-500` → `text-gray-500 dark:text-slate-400`
- `text-gray-400` → `text-gray-400 dark:text-slate-500`
- Line with dynamic class `"text-gray-400"` string literal → `"text-gray-400 dark:text-slate-500"` (leave `text-red-500` and `text-amber-500` untouched)

### Step 4: Verify — expect zero unguarded hits

```bash
cd d:/newprojects/oneshoppos/frontend
grep -n "text-gray-[0-9]\|text-slate-[0-9]\|bg-gray-\|bg-slate-\|border-gray-\|border-slate-\|bg-white" \
  src/pages/redesign/FulfillmentRedesign.jsx \
  src/pages/redesign/StockCountRedesign.jsx \
  src/pages/redesign/PostdatedChequesRedesign.jsx \
  | grep -v "dark:"
```

Expected: no output.

### Step 5: Run unit tests

```bash
cd d:/newprojects/oneshoppos/frontend && npx vitest run tests/unit/ 2>&1 | tail -5
```

Expected: `99 passed`

### Step 6: Commit

```bash
cd d:/newprojects/oneshoppos
git add frontend/src/pages/redesign/FulfillmentRedesign.jsx \
        frontend/src/pages/redesign/StockCountRedesign.jsx \
        frontend/src/pages/redesign/PostdatedChequesRedesign.jsx
git commit -m "$(cat <<'EOF'
fix(dark-mode): batch 1 — add dark: overrides to 3 heavy-hitter pages

FulfillmentRedesign (33 fixes), StockCountRedesign (18), PostdatedChequesRedesign (11).
These pages used the dark: variant pattern — added dark:text-slate-400/500/300
to match their existing style. No logic changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Batch 2 — Mid-range pages (10 pages, ~44 fixes)

**Files:**
- Modify: `frontend/src/pages/redesign/CreditDebitNotesRedesign.jsx`
- Modify: `frontend/src/pages/redesign/ReportsPowerUpPanel.jsx`
- Modify: `frontend/src/pages/redesign/ReorderAlertsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx`
- Modify: `frontend/src/pages/redesign/ProductFormPage.jsx`
- Modify: `frontend/src/pages/redesign/ChartOfAccountsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/BillingRedesign.jsx`
- Modify: `frontend/src/pages/redesign/ContractsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/TreatmentPlansRedesign.jsx`
- Modify: `frontend/src/pages/redesign/FBRSettingsRedesign.jsx`

### Step 1: Fix CreditDebitNotesRedesign.jsx (6 hits — use tokens)

```bash
grep -n "text-gray-[0-9]" frontend/src/pages/redesign/CreditDebitNotesRedesign.jsx | grep -v "dark:"
```

All are `text-gray-500` → replace each with `text-(--ui-text-muted)`.

### Step 2: Fix ReportsPowerUpPanel.jsx (extensive slate-* — use tokens)

Read the file first, then apply the full substitution map using Edit with replace_all=true for each token class:
- `border-slate-200` → `border-(--ui-border)`
- `bg-white` → `bg-(--ui-surface)`
- `bg-slate-50` → `bg-(--ui-muted-surface)`
- `text-slate-800` → `text-(--ui-text)`
- `text-slate-700` → `text-(--ui-text)`
- `text-slate-600` → `text-(--ui-text-muted)`
- `text-slate-500` → `text-(--ui-text-muted)`

### Step 3: Fix ReorderAlertsRedesign.jsx (6 hits — use tokens)

```bash
grep -n "text-gray-\|border-gray-\|bg-gray-" frontend/src/pages/redesign/ReorderAlertsRedesign.jsx | grep -v "dark:"
```

- `text-gray-500` → `text-(--ui-text-muted)`
- `text-gray-900` → `text-(--ui-text)`
- `border-gray-200` → `border-(--ui-border)`
- `border-gray-100` → `border-(--ui-border)`

### Step 4: Fix WooCommerceIntegrationRedesign.jsx — use tokens

```bash
grep -n "slate-\|bg-white" frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx | grep -v "dark:"
```

- `text-slate-400` → `text-(--ui-text-muted)`
- `border-slate-200` → `border-(--ui-border)`
- `bg-slate-50` → `bg-(--ui-muted-surface)`
- `bg-white` → `bg-(--ui-surface)` (check line 67 — it's in a conditional active-tab string; replace correctly)
- `text-slate-900` → `text-(--ui-text)`
- `text-slate-500` → `text-(--ui-text-muted)`
- `text-slate-700` → `text-(--ui-text)`
- `border-slate-300` → `border-(--ui-border)`

**Note line 67 (active tab conditional):**
`"bg-white text-slate-900 shadow-sm"` → `"bg-(--ui-surface) text-(--ui-text) shadow-sm"`
`"text-slate-500 hover:text-slate-700"` → `"text-(--ui-text-muted) hover:text-(--ui-text)"`

### Step 5: Fix ProductFormPage.jsx — uses dark: pattern, add dark: overrides

```bash
grep -n "bg-slate-200\|bg-white\|hover:bg-slate-50" frontend/src/pages/redesign/ProductFormPage.jsx | grep -v "dark:"
```

- `bg-slate-200` (toggle off-state track) → `bg-slate-200 dark:bg-slate-600`
- `bg-white` (toggle knob — lines 431, 589, 728) → `bg-white dark:bg-slate-200`
- `bg-white` (dropdown popover — line 455) → `bg-white dark:bg-slate-800`
- `hover:bg-slate-50` (dropdown item hover) → `hover:bg-slate-50 dark:hover:bg-slate-700`
- Line 364: `bg-white` inside mixed `--ui-*` token string → `bg-(--ui-surface)` (this line uses tokens elsewhere)

### Step 6: Fix ChartOfAccountsRedesign.jsx — uses dark: pattern, add dark: overrides

```bash
grep -n "text-gray-[0-9]" frontend/src/pages/redesign/ChartOfAccountsRedesign.jsx | grep -v "dark:"
```

- `text-gray-400` → `text-gray-400 dark:text-slate-500`
- `text-gray-500` → `text-gray-500 dark:text-slate-400`

### Step 7: Fix BillingRedesign.jsx — use tokens

Read the file, then apply substitution map:
- `bg-slate-100` → `bg-(--ui-muted-surface)`
- `text-slate-600` → `text-(--ui-text-muted)`
- `text-slate-400` → `text-(--ui-text-muted)`
- `text-slate-500` → `text-(--ui-text-muted)`
- `text-slate-800` → `text-(--ui-text)`
- `text-slate-700` → `text-(--ui-text)`
- `border-slate-200` → `border-(--ui-border)`
- `border-slate-300` → `border-(--ui-border)`
- `border-slate-100` → `border-(--ui-border)`
- `bg-white` → `bg-(--ui-surface)` (check each — `bg-white/60` becomes `bg-(--ui-surface)/60`)
- `bg-slate-100 text-slate-700` in planColors map (free tier) → `bg-(--ui-muted-surface) text-(--ui-text-muted)`

### Step 8: Fix ContractsRedesign.jsx (4 hits — all `bg-white` in mixed token strings)

- All 4 `bg-white` occurrences → `bg-(--ui-surface)`

### Step 9: Fix TreatmentPlansRedesign.jsx — use tokens (extensive slate-*)

Read the file first. Apply replace_all=true for each:
- `text-slate-600` → `text-(--ui-text-muted)`
- `text-slate-500` → `text-(--ui-text-muted)`
- `text-slate-400` → `text-(--ui-text-muted)`
- `text-slate-700` → `text-(--ui-text)`
- `bg-slate-50` → `bg-(--ui-muted-surface)`
- `hover:bg-slate-50` → `hover:bg-(--ui-muted-surface)`
- `border-slate-200` → `border-(--ui-border)`
- `border-slate-300` → `border-(--ui-border)`
- `bg-white` → `bg-(--ui-surface)` (check each — modal wrapper, textarea, etc.)
- `text-slate-400 hover:text-slate-700` (close button in local modal) → `text-(--ui-text-muted) hover:text-(--ui-text)`

### Step 10: Fix FBRSettingsRedesign.jsx (3 hits)

```bash
grep -n "bg-gray-\|bg-white" frontend/src/pages/redesign/FBRSettingsRedesign.jsx | grep -v "dark:"
```

- `bg-gray-400` (toggle disabled/off state) → `bg-(--ui-border)`
- `bg-gray-300` (toggle off state) → `bg-(--ui-border)`
- `bg-white` (toggle knob) → leave as `bg-white` — toggle knobs need fixed white against colored track

### Step 11: Verify batch 2

```bash
cd d:/newprojects/oneshoppos/frontend
grep -n "text-gray-[0-9]\|text-slate-[0-9]\|bg-gray-\|bg-slate-\|border-gray-\|border-slate-\|bg-white" \
  src/pages/redesign/CreditDebitNotesRedesign.jsx \
  src/pages/redesign/ReportsPowerUpPanel.jsx \
  src/pages/redesign/ReorderAlertsRedesign.jsx \
  src/pages/redesign/WooCommerceIntegrationRedesign.jsx \
  src/pages/redesign/ProductFormPage.jsx \
  src/pages/redesign/ChartOfAccountsRedesign.jsx \
  src/pages/redesign/BillingRedesign.jsx \
  src/pages/redesign/ContractsRedesign.jsx \
  src/pages/redesign/TreatmentPlansRedesign.jsx \
  src/pages/redesign/FBRSettingsRedesign.jsx \
  | grep -v "dark:"
```

Expected: no output (or only intentional toggle-knob `bg-white` in FBRSettings).

### Step 12: Run unit tests

```bash
cd d:/newprojects/oneshoppos/frontend && npx vitest run tests/unit/ 2>&1 | tail -5
```

Expected: `99 passed`

### Step 13: Commit

```bash
cd d:/newprojects/oneshoppos
git add \
  frontend/src/pages/redesign/CreditDebitNotesRedesign.jsx \
  frontend/src/pages/redesign/ReportsPowerUpPanel.jsx \
  frontend/src/pages/redesign/ReorderAlertsRedesign.jsx \
  frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx \
  frontend/src/pages/redesign/ProductFormPage.jsx \
  frontend/src/pages/redesign/ChartOfAccountsRedesign.jsx \
  frontend/src/pages/redesign/BillingRedesign.jsx \
  frontend/src/pages/redesign/ContractsRedesign.jsx \
  frontend/src/pages/redesign/TreatmentPlansRedesign.jsx \
  frontend/src/pages/redesign/FBRSettingsRedesign.jsx
git commit -m "$(cat <<'EOF'
fix(dark-mode): batch 2 — token substitution on 10 mid-range pages

CreditDebitNotes, ReportsPowerUpPanel, ReorderAlerts, WooCommerce,
ProductFormPage, ChartOfAccounts, Billing, Contracts,
TreatmentPlans, FBRSettings.
bg-white→bg-(--ui-surface), slate/gray text→text-(--ui-text[-muted]),
slate/gray borders→border-(--ui-border). No logic changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Batch 3 — Tail pages (15 pages, ~22 fixes)

**Files:**
- Modify: `frontend/src/pages/redesign/SuppliersRedesign.jsx`
- Modify: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/PriceListsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx`
- Modify: `frontend/src/pages/redesign/CourierSettingsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/TaxLookupRedesign.jsx`
- Modify: `frontend/src/pages/redesign/SupplierPayablesRedesign.jsx`
- Modify: `frontend/src/pages/redesign/SalesHistoryRedesign.jsx`
- Modify: `frontend/src/pages/redesign/ReturnsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/ProjectsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/MyTicketsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/InventoryRedesign.jsx`
- Modify: `frontend/src/pages/redesign/CRMRedesign.jsx`
- Modify: `frontend/src/pages/redesign/AppointmentServicesRedesign.jsx`
- Modify: `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`

### Step 1: Fix SuppliersRedesign.jsx (2 hits)

Both `bg-white` inside mixed `--ui-*` token strings → `bg-(--ui-surface)`

### Step 2: Fix PrinterSettingsRedesign.jsx (5 hits)

- `hover:bg-gray-50` → `hover:bg-(--ui-muted-surface)` (2 occurrences)
- `border-slate-200` → `border-(--ui-border)`
- `text-slate-800` → `text-(--ui-text)`
- `text-slate-500` → `text-(--ui-text-muted)`

### Step 3: Fix PriceListsRedesign.jsx (2 hits)

- `bg-gray-100 text-gray-600` (TYPE_META fallback) → `bg-(--ui-muted-surface) text-(--ui-text-muted)`
- `bg-white` (toggle knob) → leave as `bg-white`

### Step 4: Fix CustomersRedesign.jsx (2 hits)

- `bg-gray-100 text-gray-700` (pos channel badge) → `bg-(--ui-muted-surface) text-(--ui-text)`
- `bg-gray-100 text-gray-600` (fallback channel color) → `bg-(--ui-muted-surface) text-(--ui-text-muted)`

### Step 5: Fix CourierSettingsRedesign.jsx (10 hits — use tokens)

- `text-slate-400` → `text-(--ui-text-muted)` (multiple)
- `text-slate-500` → `text-(--ui-text-muted)` (multiple)
- `bg-white` (toggle knob) → leave as `bg-white`

### Step 6: Fix TaxLookupRedesign.jsx (1 hit)

- `bg-white` inside mixed token string → `bg-(--ui-surface)`

### Step 7: Fix SupplierPayablesRedesign.jsx (1 hit)

- `bg-white` inside mixed token string → `bg-(--ui-surface)`

### Step 8: Fix SalesHistoryRedesign.jsx (1 hit)

- `bg-gray-300` (neutral status dot) → `bg-(--ui-border)`

### Step 9: Fix ReturnsRedesign.jsx (1 hit)

- `bg-white` (dropdown popover) → `bg-(--ui-surface)`

### Step 10: Fix ProjectsRedesign.jsx (3 hits)

- `bg-slate-200` (progress bar track) → `bg-(--ui-border)`
- `bg-white` (textarea) → `bg-(--ui-surface)`
- `text-slate-300 hover:text-slate-400` (milestone incomplete icon) → `text-(--ui-text-muted) hover:text-(--ui-text)`

### Step 11: Fix MyTicketsRedesign.jsx (12 hits — use tokens)

- `bg-slate-100 text-slate-500` (closed badge) → `bg-(--ui-muted-surface) text-(--ui-text-muted)`
- `text-slate-500` → `text-(--ui-text-muted)`
- `text-slate-400` → `text-(--ui-text-muted)`
- `border-slate-200 bg-white` → `border-(--ui-border) bg-(--ui-surface)`
- `border-slate-100` → `border-(--ui-border)`
- `border-slate-50` → `border-(--ui-border)`
- `text-slate-700` → `text-(--ui-text)`
- `text-slate-600` → `text-(--ui-text-muted)`

### Step 12: Fix InventoryRedesign.jsx (1 hit)

- `hover:bg-slate-50 bg-white` (non-selected row) → `hover:bg-(--ui-muted-surface) bg-(--ui-surface)`
- Leave `bg-emerald-50` (selected state) untouched

### Step 13: Fix CRMRedesign.jsx (1 hit)

- `bg-gray-100 text-gray-700` (note badge) → `bg-(--ui-muted-surface) text-(--ui-text)`

### Step 14: Fix AppointmentServicesRedesign.jsx (1 hit)

- `bg-white` → `bg-(--ui-surface)`

### Step 15: Fix IntegrationsHubRedesign.jsx (4 hits)

- All `text-slate-400` → `text-(--ui-text-muted)`

### Step 16: Verify batch 3

```bash
cd d:/newprojects/oneshoppos/frontend
grep -n "text-gray-[0-9]\|text-slate-[0-9]\|bg-gray-\|bg-slate-\|border-gray-\|border-slate-\|bg-white" \
  src/pages/redesign/SuppliersRedesign.jsx \
  src/pages/redesign/PrinterSettingsRedesign.jsx \
  src/pages/redesign/PriceListsRedesign.jsx \
  src/pages/redesign/CustomersRedesign.jsx \
  src/pages/redesign/CourierSettingsRedesign.jsx \
  src/pages/redesign/TaxLookupRedesign.jsx \
  src/pages/redesign/SupplierPayablesRedesign.jsx \
  src/pages/redesign/SalesHistoryRedesign.jsx \
  src/pages/redesign/ReturnsRedesign.jsx \
  src/pages/redesign/ProjectsRedesign.jsx \
  src/pages/redesign/MyTicketsRedesign.jsx \
  src/pages/redesign/InventoryRedesign.jsx \
  src/pages/redesign/CRMRedesign.jsx \
  src/pages/redesign/AppointmentServicesRedesign.jsx \
  src/pages/redesign/IntegrationsHubRedesign.jsx \
  | grep -v "dark:"
```

Expected: no output (or only intentional toggle-knob `bg-white` exceptions).

### Step 17: Run unit tests

```bash
cd d:/newprojects/oneshoppos/frontend && npx vitest run tests/unit/ 2>&1 | tail -5
```

Expected: `99 passed`

### Step 18: Commit

```bash
cd d:/newprojects/oneshoppos
git add \
  frontend/src/pages/redesign/SuppliersRedesign.jsx \
  frontend/src/pages/redesign/PrinterSettingsRedesign.jsx \
  frontend/src/pages/redesign/PriceListsRedesign.jsx \
  frontend/src/pages/redesign/CustomersRedesign.jsx \
  frontend/src/pages/redesign/CourierSettingsRedesign.jsx \
  frontend/src/pages/redesign/TaxLookupRedesign.jsx \
  frontend/src/pages/redesign/SupplierPayablesRedesign.jsx \
  frontend/src/pages/redesign/SalesHistoryRedesign.jsx \
  frontend/src/pages/redesign/ReturnsRedesign.jsx \
  frontend/src/pages/redesign/ProjectsRedesign.jsx \
  frontend/src/pages/redesign/MyTicketsRedesign.jsx \
  frontend/src/pages/redesign/InventoryRedesign.jsx \
  frontend/src/pages/redesign/CRMRedesign.jsx \
  frontend/src/pages/redesign/AppointmentServicesRedesign.jsx \
  frontend/src/pages/redesign/IntegrationsHubRedesign.jsx
git commit -m "$(cat <<'EOF'
fix(dark-mode): batch 3 — token substitution on 15 tail pages

SuppliersRedesign, PrinterSettings, PriceLists, Customers, CourierSettings,
TaxLookup, SupplierPayables, SalesHistory, Returns, Projects, MyTickets,
Inventory, CRM, AppointmentServices, IntegrationsHub.
1-2 fixes each. No logic changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Push and open PR

### Step 1: Final global grep — confirm zero unguarded hardcoded colors

```bash
cd d:/newprojects/oneshoppos/frontend
grep -rn "text-gray-[0-9]\|text-slate-[0-9]\|bg-gray-[0-9]\|bg-slate-\|border-gray-\|border-slate-\|bg-white" \
  src/pages/redesign/ \
  | grep -v "dark:\|POSRedesign\|KioskRedesign\|text-red-\|text-blue-\|text-green-\|text-amber-\|text-emerald-\|text-violet-" \
  2>&1 | head -20
```

Expected: zero output (or only intentional toggle-knob `bg-white` exceptions).

### Step 2: Run full unit test suite

```bash
cd d:/newprojects/oneshoppos/frontend && npx vitest run tests/unit/ 2>&1 | tail -8
```

Expected: `99 passed`

### Step 3: Push branch

```bash
cd d:/newprojects/oneshoppos && git push -u origin phase1-step5-dark-mode
```

### Step 4: Open PR

```bash
cd d:/newprojects/oneshoppos && gh pr create \
  --title "fix(dark-mode): Phase 1.2 Step 5 — QA pass across 27 redesign pages" \
  --body "$(cat <<'EOF'
## Summary
- Fixes 128 hardcoded Tailwind color classes across 27 redesign pages that were invisible in dark mode
- Token substitution: \`bg-white\` → \`bg-(--ui-surface)\`, \`text-slate-500\` → \`text-(--ui-text-muted)\`, \`border-slate-200\` → \`border-(--ui-border)\`, etc.
- Pages already using \`dark:\` variant pattern get \`dark:\` overrides instead (FulfillmentRedesign, StockCountRedesign, PostdatedChequesRedesign, ChartOfAccountsRedesign, ProductFormPage)
- Toggle knob \`bg-white\` intentionally preserved — knobs need fixed white against colored track
- Semantic status colors (\`text-red-*\`, \`text-blue-*\`, \`text-green-*\`, \`text-amber-*\`) left untouched

## Scope
- 27 redesign pages, 3 commits
- POS and Kiosk excluded (hardcoded colors intentional)
- Zero logic changes

## Test plan
- [ ] \`npx vitest run tests/unit/\` — 99 tests pass
- [ ] Toggle dark mode in browser — verify worst-offender pages (Fulfillment, StockCount, PostdatedCheques, Billing, TreatmentPlans) render correctly
- [ ] Global grep confirms zero unguarded hardcoded colors remain

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification Checklist

- [ ] All 3 commits on branch `phase1-step5-dark-mode`
- [ ] `npx vitest run tests/unit/` → 99 passed
- [ ] Global grep returns zero unguarded hardcoded colors
- [ ] PR open on GitHub
- [ ] Manual dark mode toggle shows no white boxes / invisible text on: Fulfillment, StockCount, Billing, TreatmentPlans, MyTickets

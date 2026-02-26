# OneShopPOS Complete Shopify-Style Redesign Plan (All Non-Placeholder Modules)

## Summary

Redesign the full app UX/UI and interaction model to Shopify-style patterns while preserving existing business logic and permissions, excluding only:

- Placeholder modules: `/lookup`, `/custom-fields`, `/partners`, `/shopcast`
- Pending feature `3.1`: email/SMS receipts

Implementation will be **phased with feature flags**, using **Tailwind + internal design system**, with **Inventory as pilot module**.  
Each module is done only when it passes: visual parity spec + regression checks + UAT smoke checklist.

## Scope (Locked)

In scope:

- App shell/layout/nav/header
- Dashboard, POS, Sales History, Cash Management
- Inventory, Categories, Taxes, Brands, Attribute Sets, Promotions, Expenses
- Orders, Suppliers, Purchase Orders, Supplier Payables, Returns, Returned Stock, Stock Adjustments, Transfers, Approvals
- Reports
- Employees, Outlets, Administrator, Action History, Backup/Restore
- Shopify Integration
- Tier 4 modules: Accounting, CRM, Quotations, HR, Company Settings
- Auth pages (`/login`, access-denied) for visual consistency

Out of scope:

- Placeholder routes listed above
- Email/SMS receipt implementation

---

## Phase 0 — Baseline and Guardrails

1. Freeze feature behavior contracts:
   - Capture current route inventory, permission gates, feature-flag behavior, key API response shapes.
2. Create redesign branch strategy:
   - `redesign/foundation`
   - `redesign/wave-*` per module wave
3. Add rollout flags:
   - `ui_redesign_enabled`
   - module-level flags (example: `ui_redesign_inventory`, `ui_redesign_orders`, etc.)
4. Define module Done Checklist template:
   - Visual acceptance
   - Workflow pass list
   - Regression test list
   - Permission/role check list
   - Performance check

---

## Phase 1 — Design System Foundation (No Module Rewrite Yet)

1. Create internal design system package/folder:
   - Tokens: color, spacing, radius, elevation, typography, motion, z-index
   - CSS variables + Tailwind utility conventions
2. Build reusable primitives:
   - `PageShell`, `SectionCard`, `DataTable`, `TableToolbar`, `BulkActionBar`
   - `Button`, `IconButton`, `Input`, `Select`, `Tabs`, `Badge`, `Toast`, `Modal`, `Drawer`, `EmptyState`, `Skeleton`, `Pagination`
3. Standardize interaction patterns:
   - Search/filter bars
   - Saved views pattern (if needed)
   - Sort indicators and table density controls
   - Bulk select behavior (header + row)
4. App-level behavior components:
   - Global notification/toast stack
   - Error boundary and retry surfaces
   - Loading/skeleton strategy for list/detail pages

---

## Phase 2 — App Shell Redesign

1. Redesign `AppLayout` to Shopify-like IA patterns:
   - Persistent nav, collapsible sections, consistent breadcrumbs, command actions
2. Normalize nav metadata:
   - One nav config source for title, icon, permission, feature flag, route group
3. Redesign top bar:
   - Search entry point, notifications, profile menu, environment/system sync state
4. Accessibility baseline:
   - Keyboard focus states, ARIA roles for nav/menu/table controls, color contrast checks
5. Mobile/tablet behavior:
   - Drawer nav and responsive breakpoints for operational pages

---

## Phase 3 — Pilot Module (Inventory)

1. Implement full Shopify-style list UX in Inventory:
   - Server-backed search/sort/filter
   - Select-all/current-page + bulk action bar
   - Bulk status/category/delete/export actions
   - Empty/loading/error states
2. Lock reusable patterns extracted from pilot:
   - Table + toolbar + bulk bar + filter chips + pagination pattern docs
3. Validate pilot with full checklist:
   - Role constraints
   - API failures and retries
   - Large dataset behavior
4. Approve pilot as canonical pattern before wave rollout

---

## Phase 4 — Module Waves

## Wave A: Core Commerce

1. POS
2. Orders
3. Customers
4. Sales History
5. Cash Management
6. Returns

For each module:

- Rebuild UI with shared design system
- Keep existing API endpoints unless gap is confirmed
- Add parity checks for create/edit/void/close workflows
- Validate role-based visibility and action permissions

## Wave B: Inventory and Procurement Ecosystem

1. Categories, Brands, Taxes, Attribute Sets
2. Stock Adjustments, Transfers, Returned Stock
3. Suppliers, Purchase Orders, Supplier Payables
4. Promotions, Expenses

## Wave C: Analytics and Admin

1. Dashboard
2. Reports (all report tabs + standalone routes)
3. Employees, Outlets, Administrator, Action History
4. Backup/Restore
5. Shopify Integration

## Wave D: Tier 4 Modules

1. Accounting
2. CRM
3. Quotations
4. HR Leave/Payroll
5. Company Settings

Each wave closes only after:

- Visual review pass
- Regression pass
- UAT checklist signoff
- Feature-flag rollback test

---

## Phase 5 — Hardening and Final Cutover

1. Enable redesign flags progressively by module group.
2. Run full regression suite + manual UAT matrix.
3. Track and fix P1/P2 defects in dedicated stabilization sprint.
4. Flip global `ui_redesign_enabled` to default ON.
5. Remove legacy UI code paths only after 1 full release cycle stability.

---

## Public APIs / Interfaces / Types (Planned Changes)

1. Frontend interface additions:
   - Central `ui/nav-config.ts`
   - `ui/tokens.ts` + CSS variable layer
   - Shared table/filter type contracts
2. Backend API changes:
   - Prefer no path changes; keep existing endpoints
   - Where needed, standardize list query contract:
     - `search`, `sort`, `order`, pagination params, filter params
   - Standardize error envelope across redesigned modules:
     - `{ error: string, code?: string, details?: object }`
3. Feature flags:
   - Add module-level UI rollout flags in feature-flag storage and UI.
4. Permission model:
   - No semantic permission changes without explicit approval; only UI wiring consistency.

---

## Testing and Acceptance Scenarios

1. Visual/UX acceptance:
   - Layout consistency, table behavior, responsive breakpoints, hover/focus states.
2. Workflow regression (per module):
   - CRUD paths, status transitions, destructive action confirms, export/import flows.
3. Permission and role checks:
   - Hidden/disabled actions by role, unauthorized route handling.
4. Data-scale checks:
   - Large table performance, filter/sort responsiveness, pagination correctness.
5. Failure-mode tests:
   - API timeout/500/403 handling, optimistic vs conservative updates, retry UX.
6. Cross-module navigation consistency:
   - Breadcrumb correctness, back/forward navigation, deep links.
7. Release gates:
   - Existing backend tests + frontend build/lint + wave-specific UAT signoff.

---

## Step-by-Step Execution Checklist (Engineer-Ready)

1. Establish redesign flags and module checklist template.
2. Build token system + core primitives.
3. Redesign `AppLayout` and global shell.
4. Implement Inventory pilot and lock shared table pattern.
5. Execute Wave A modules one by one.
6. Execute Wave B modules one by one.
7. Execute Wave C modules one by one.
8. Execute Wave D modules one by one.
9. Run full regression + UAT + bugfix hardening.
10. Enable redesign by default and begin old UI deprecation cycle.

---

## Risks and Mitigations

1. Scope overload:
   - Mitigation: strict wave gating and pilot-first pattern lock.
2. Regressions in operational flows:
   - Mitigation: module checklists + role/path regression suites.
3. UI inconsistency across many pages:
   - Mitigation: force shared components, ban one-off patterns unless approved.
4. Rollout risk:
   - Mitigation: feature flags per module + rollback path maintained until stabilization complete.

---

## Assumptions and Defaults

1. All non-placeholder modules are included in redesign.
2. Placeholders and email/SMS receipts remain deferred.
3. Existing backend behavior/paths are preserved unless a documented gap forces change.
4. Tailwind + internal design system is the chosen stack.
5. Rollout is phased with module-level feature flags.
6. Inventory is the pilot module and reference pattern for all subsequent table-heavy screens.

---

## Incident Resolution Update (2026-02-27)

Context:
- Legacy page cleanup was interrupted when the agent/editor session became unresponsive mid-delete sequence.
- Forensic capture was recorded at:
  - `docs/archive/legacy-ui-cleanup-incident-2026-02-27_001049.md`

Resolved findings:
1. Root cause pattern: route-surface legacy pages were bulk-deleted while a small set of redesign pages still depended on retained legacy logic files.
2. Current dependency truth:
   - Retained logic dependencies in redesign layer:
     - `AccountingRedesign -> ../Accounting`
     - `ReportsRedesign -> ../Reports`
     - `SalesHistoryRedesign -> ../InvoiceView`
     - `ShopifyIntegrationRedesign -> ../ShopifyIntegration`
3. Import-graph safety check passed for deleted route-surface pages:
   - No deleted `frontend/src/pages/*.jsx` candidate is imported via `./<Page>` or `../<Page>` in `frontend/src`.
4. Build gate passed:
   - `frontend`: `npm run build`
5. Manual route smoke remains required before final release signoff:
   - `/dashboard`, `/inventory`, `/reports`, `/accounting`, `/sales-history`, `/integrations/shopify`

Deletion criteria now locked:
1. Delete only files that are both:
   - route-surface legacy pages, and
   - unreferenced by import graph.
2. Do not delete retained legacy logic dependencies until redesign wrappers are refactored to remove those imports.

# Sidebar Regroup — Design

**Date**: 2026-05-06
**Status**: Designed, ready for implementation plan
**Sequencing**: Ships **before** the order-kiosk PR (`2026-05-06-order-kiosk-design.md`)
**Estimated size**: ~50 LOC change in one file (`frontend/src/ui/nav-config.js`)

## Why

The sidebar in `frontend/src/ui/nav-config.js` has accumulated 19 groups and 105 nav items over Phase 2–5 development. Several items live in groups that don't match user mental models, making "where does X live?" a recurring source of friction:

- **Cash Management** under Commerce, but it's a treasury function
- **Taxes** under Inventory, but it's a compliance concern
- **Promotions, Price Lists, Smart Collections, Scheduled Changes** under Inventory, but they're catalog/marketing concerns
- **Employees** in Setup, but **Attendance + HR + Scheduling + Commissions** in Operations — fragmented people management
- **CRM, Customer Invoices, Subscriptions, Loyalty, Gift Cards, Campaigns, Inbox, Review Moderation** scattered across Operations, Marketing & Billing, Commerce, and Inventory — fragmented customer relationship surface
- **Notifications** in Operations — it's cross-cutting, not operational
- **Retail Risk** in Admin — it's analytics, not admin tooling
- **Admin** as a section name is overloaded (it currently mixes super-admin features with tenant-level account settings)

Three smaller gaps were also found during the audit:

- `/treatment-plans/templates` is a built, routable page (`frontend/src/routes/appRoutes.jsx:284`) but has no sidebar entry, so clinic-mode tenants can't reach it from the nav
- Five placeholder routes still ship as dead scaffolds: `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` — all render `PlaceholderPage`
- The dead order-kiosk shadow route at `appRoutes.jsx:256` (separate concern, addressed in the kiosk design doc)

This design covers the regroup itself plus the missing Treatment Plan Templates link. The placeholder cleanup is documented as a follow-up (separate PR after the regroup ships).

## What changes

**Only one file is edited**: `frontend/src/ui/nav-config.js`. No backend changes. No path renames. Same flag/perm/mode gates preserved on every item — purely a reorganization.

The filter logic at `frontend/src/components/AppLayoutRedesign.jsx:92-98` already auto-hides empty groups (`g.items.length` filter), so vertical-specific sections (Restaurant, Appointments, Rentals, Rooms, Clinical) only render for tenants whose preset includes the relevant `requiredMode`. A retail tenant won't see Clinical even though the section exists in the config.

## Final group list (proposed)

20 sections, 105 existing items + 1 new (Treatment Plan Templates) = 106 items. Mode-gated sections marked.

1. **Overview** — Dashboard, Notifications
2. **Sell** — POS, Kiosk, Orders, Quotations, Parked Sales, Holds & Layaway, Returns, Return Policies, Sales History
3. **Customers** — Customers, Customer Groups, CRM, Loyalty Tiers, Gift Cards, Customer Invoices, Subscriptions, Inbox, Campaigns, Review Moderation
4. **Catalog** — Products, Categories, Brands, Attribute Sets, Promotions, Price Lists, Smart Collections, Scheduled Changes
5. **Inventory** — Inventory Audit, Stock Adjustments, Transfers, Reorder Alerts, Intelligence
6. **Procurement** — Suppliers, Purchase Orders, Supplier Returns, Supplier Payables
7. **Fulfillment** — Fulfillment, Courier Settings, COD Settlements
8. **Online Store** — View Storefront
9. **Restaurant** *(mode: restaurant)* — Floor Plan, Checks, 86'd Items, Modifiers, Menu Schedules, Reservations, Waitlist, Online Inbox, Void/Comp Reasons, KDS, Tip Pools, **Order Kiosks** *(added by the kiosk PR)*
10. **Appointments** *(mode: appointments)* — Services, Calendar, Bookings
11. **Service Operations** — Service Tickets *(mode: workflow_tickets)*, Projects *(mode: service_projects)*, Contracts *(mode: service_projects)*
12. **Rentals** *(mode: rentals)* — Rental Items, Contracts, Timeline
13. **Rooms / Hospitality** *(mode: room_management)* — Rooms, Rates, Bookings, Calendar, Arrivals/Departures
14. **Clinical** *(mode: treatment_plans)* — Treatment Plans, Calendar, Lab Orders, **Templates** *(new)*
15. **Finance** — Cash Management, Expenses, Approvals, Accounting, Chart of Accounts, Journal Entries, Credit/Debit Notes, Post-Dated Cheques
16. **Insights** — Reports, Report Builder, Retail Risk
17. **People** — Employees, Attendance, Scheduling, Commissions, HR
18. **Compliance** — Taxes, FBR Settings, FBR Invoices, Tax Lookup
19. **Setup** — Outlets, Company Profile, Outlet Tax Profiles, Integrations, POS Layouts, Receipt Templates, Barcode Templates, Printer Settings, Import Data, Import from Shopify/Square, Backup & Restore
20. **Account** — Billing, My Tickets, Administrator, Action History

## What each tenant type sees

The mode-filter handles vertical-specific sections automatically. Approximate visible-section counts:

| Tenant type | Visible sections |
|---|---|
| Retail (general_retail) | Overview, Sell, Customers, Catalog, Inventory, Procurement, Fulfillment, Online Store, Finance, Insights, People, Compliance, Setup, Account = **14** |
| Restaurant | Above + Restaurant = **15** |
| Clinic | Above (retail-base) + Clinical + Appointments = **16** |
| Hotel | Retail-base + Rooms + Appointments = **16** |
| Service / repair shop | Retail-base + Service Operations + Appointments = **16** |

## Moves catalogued

| Item | From → To | Reason |
|---|---|---|
| Cash Management | Commerce → Finance | Treasury function |
| CRM | Operations → Customers | Customer-relationship surface |
| Loyalty Tiers | Commerce → Customers | Customer-relationship surface |
| Gift Cards | Commerce → Customers | Customer-relationship surface |
| Customer Invoices | Marketing & Billing → Customers | Customer-facing |
| Subscriptions | Marketing & Billing → Customers | Customer-facing |
| Inbox (messaging) | Marketing & Billing → Customers | Customer-facing |
| Campaigns | Marketing & Billing → Customers | Customer-facing marketing |
| Review Moderation | Inventory → Customers | Customer feedback, not stock |
| Promotions | Inventory → Catalog | Pricing/marketing, not stock |
| Price Lists | Inventory → Catalog | Pricing |
| Smart Collections | Inventory → Catalog | Catalog grouping |
| Scheduled Changes | Inventory → Catalog | Pricing/catalog change scheduler |
| Inventory Audit | Stock Control → Inventory | Stock count, fits Inventory |
| Stock Adjustments | Stock Control → Inventory | Stock movement |
| Transfers | Stock Control → Inventory | Stock movement |
| Reorder Alerts | Stock Control → Inventory | Stock signal |
| Intelligence | Stock Control → Inventory | Stock analytics |
| Purchase Orders | Stock Control → Procurement | Supplier-facing |
| Supplier Returns | Stock Control → Procurement | Supplier-facing |
| Supplier Payables | Stock Control → Procurement | Supplier-facing A/P |
| Fulfillment | Commerce → Fulfillment | New section |
| Courier Settings | Setup → Fulfillment | Belongs with shipping |
| COD Settlements | Commerce → Fulfillment | Belongs with shipping |
| Expenses | Procurement → Finance | Money flow |
| Approvals | Procurement → Finance | Money flow approvals |
| Accounting | Insights → Finance | Money flow |
| Chart of Accounts | Insights → Finance | Money flow |
| Journal Entries | Insights → Finance | Money flow |
| Credit/Debit Notes | Insights → Finance | Money flow |
| Post-Dated Cheques | Insights → Finance | Money flow |
| Taxes | Inventory → Compliance | Joins FBR + Tax Lookup |
| Employees | Setup → People | People management |
| Attendance | Operations → People | People management |
| Scheduling | Operations → People | People management |
| Commissions | Operations → People | People management |
| HR | Operations → People | People management |
| Kiosk (attendance) | Operations → Sell | Sell-side surface (and consistent with the new Order Kiosks under Restaurant) |
| Quotations | Operations → Sell | Sales channel |
| Notifications | Operations → Overview | Cross-cutting |
| Retail Risk | Admin → Insights | Analytics, not admin |
| Marketing & Billing group | dissolved | Members redistributed (Customers + Account) |
| Admin → Account | renamed | "Admin" was overloaded; "Account" is clearer for tenant-level admin |

## Three additions on top of the regroup

1. **Add Templates to Clinical** — new entry `{ name: "Templates", path: "/treatment-plans/templates", icon: ClipboardList, requiredFlag: "phase4_treatment_plans", requiredPerm: "manage_treatment_plans", requiredMode: "treatment_plans" }`. Route exists at `frontend/src/routes/appRoutes.jsx:284`, just no nav entry.
2. **Reserve "Order Kiosks" slot in Restaurant** — placeholder note in the design; actual entry added by the kiosk PR after this one ships.
3. **Placeholder cleanup is a separate follow-up** — `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` all render `PlaceholderPage`. Not in this PR (they're not sidebar entries today). Recommend a third small PR after both ship.

## Critical files to read before implementing

- `frontend/src/ui/nav-config.js` — the only file edited
- `frontend/src/components/AppLayoutRedesign.jsx:79-99` — filter logic. Verify it handles AND-of-all-gates correctly (it does as of this commit). No edits expected.
- `frontend/src/ui/Breadcrumbs.jsx` — `LABELS` map. No new entries needed since no paths change.

## Out of scope

- Renaming any existing routes/paths (zero path changes — labels only)
- Removing or merging items (every existing item gets a home)
- Changing icons (keep current ones)
- Backend changes (none — this is purely a frontend nav reshuffle)
- Placeholder route deletion (separate follow-up PR)

## Verification

1. **Manual on `livetest1` (general_retail)**: log in, scroll the sidebar, confirm 14 sections render in the new order, every item present, no orphans
2. **Manual mode-gate sweep**: in admin, set a test tenant's preset to each of `restaurant`, `appointments`, `rentals`, `room_management`, `treatment_plans`, `service_projects`, `workflow_tickets`. For each, confirm the corresponding section appears.
3. **Regression**: full Playwright sweep `cd frontend && npx playwright test` — ensure no test that navigates by group label or sidebar selector breaks. Likely candidates to check first: tests that rely on `getByRole("link", { name: ... })` for Cash Management, Taxes, Employees.
4. **Visual review**: take screenshots of the sidebar in light + dark mode at 1280×720 and 768×1024 (tablet) viewports. Confirm group-header spacing still reads cleanly with the new section count.

## Risk

Low. One file edited, no schema changes, no path renames, no backend coupling. Worst case: a Playwright test that hardcodes a sidebar group label fails — fixed in the same PR. Rollback is `git revert`.

# Reports V2 Plan for OneShopPOS

## Purpose

Define a complete, implementation-ready plan for modernizing the reporting system in OneShopPOS.

This plan covers:

- report feature gaps created by recent product evolution
- UI modernization of the reports experience
- hierarchical category reporting
- SaaS-ready, retail-generic reporting priorities
- feature-flag integration
- RBAC and safety considerations
- export/drilldown behavior
- implementation phases
- acceptance criteria

This file is intended to be the working source of truth for future reporting work.

---

## Current Context

OneShopPOS has recently changed in ways that directly affect reporting:

- internal categories are now hierarchical
- sibling-level category name uniqueness is now allowed
- products must belong to leaf categories only
- category filters now expand to descendant leaves
- the current development dataset includes a toy-store taxonomy, but the product must remain universal for SaaS
- products now carry more useful merchandising metadata:
  - `brand_id`
  - `product_type`
  - `vendor`
  - `tags`
- promotions are leaf-category aware
- Shopify import has been made safer and more conservative
- **Shopify SKU-based Import (Mar 2026):** Catalog sync now supports products with only SKUs (no barcodes), ensuring 100% data coverage for merchants with SKU-only catalogs.
- **Shopify Data Integrity Fix (Mar 2026):** Leading zero preserved for SKUs and barcodes (e.g., "002590"), ensuring accurate reporting and stock matching.
- reports already have a partial “power-up” system with feature flags

Because of that, the current reports page is functionally behind the rest of the application.

---

## Primary Goals

### Functional Goals

- Make reports fully aware of hierarchical categories
- Add missing reports for merchandising, promotions, catalog quality, and sync exceptions
- Make reports useful across multiple retail business types in a SaaS environment
- Make filters consistent across report types
- Improve CSV/export behavior and drilldown paths
- Integrate the existing power-up reports into one coherent reporting experience

### UX Goals

- Replace the legacy “giant tab page” feel with a modern reporting workspace
- Make reports easier to scan, filter, export, and navigate
- Improve visual clarity, grouping, and prioritization
- Make the page feel intentional and current, not like an old admin utility

### Technical Goals

- Reduce ambiguity from flat category labels
- Keep report queries safe for SQLite
- Preserve backward compatibility where practical
- Avoid breaking existing routes until replacements are verified

---

## Non-Goals

- Do not redesign Shopify taxonomy itself in this phase
- Do not fully replace all backend reporting SQL in one step
- Do not add heavy BI infrastructure, warehouses, or external analytics tools
- Do not remove existing report routes until V2 replacements are validated
- Do not turn reports into chart-heavy dashboards with weak table support

---

## Current Reports Architecture

### Frontend

Primary files:

- `frontend/src/pages/Reports.jsx`
- `frontend/src/pages/redesign/ReportsRedesign.jsx`
- `frontend/src/pages/redesign/ReportsPowerUpPanel.jsx`

Current shape:

- `ReportsRedesign.jsx` wraps the legacy `Reports.jsx`
- `ReportsPowerUpPanel.jsx` adds feature-flagged advanced analytics above the legacy reports UI
- March 2026 update: **Advanced Reporting Dashboard Shipped.** Implemented 11 new React-based analytics tabs including Heatmaps, Retail Matrix, and Comparative Trends. Backend endpoints now support core industry-standard metrics for SaaS/Retail.

### Backend

Primary file:

- `backend/routes/reports.js`

Current shape:

- a large multi-domain reports router
- route logic is centralized in one file
- several endpoints now support hierarchical category filtering
- some endpoints were recently patched to return path-aware category labels

---

## Reports V2 Principles

1. Category paths everywhere

- Use path-aware category labels consistently in UI and exports
- Avoid flat labels where ambiguity can occur

2. Filters must behave consistently

- Same filter semantics across report types unless there is a documented reason not to

3. Tables remain first-class

- Charts support insight
- Tables remain authoritative for export, audit, and operations

4. Drilldown over duplication

- Summary views should lead into detailed filtered views instead of creating multiple nearly-identical reports

5. Domain-first navigation

- Reports should be grouped by business purpose, not just historical tab order

6. Safe for SQLite

- Heavy reports must be paged, scoped, or optimized

7. Universal core first

- The default reporting system must work for any retail tenant
- Vertical-specific needs should be layered as optional packs, not treated as the default

8. Tenant-safe design

- The information architecture should support SaaS tenants across multiple verticals
- Retail-specific terminology should be isolated where possible

9. Roll out incrementally

- Build V2 around existing capability, not as a risky all-at-once rewrite

---

## Report Domains for V2

### 1. Executive

Purpose:

- fast overview for owner/admin

Reports:

- sales snapshot
- gross profit snapshot
- stock health snapshot
- top category paths
- top brands
- low-stock alerts
- exception counts

### 2. Sales

Purpose:

- core revenue and transaction visibility

Reports:

- sales summary
- sales detail
- item-wise sales
- category-wise sales
- outlet comparison
- employee sales performance

### 3. Inventory

Purpose:

- stock quantity, value, risk, aging, movement

Reports:

- on-hand inventory
- inventory dump
- sales & stock
- stock aging
- stockout risk
- replenishment smart
- dead stock
- inventory loss
- wastage
- product movement

### 4. Catalog

Purpose:

- product structure, category, brand, completeness, and merchandising quality

Reports:

- product specification
- category performance by path
- top-level category performance
- brand performance
- product type performance
- tag insights
- product metadata completeness
- uncategorized / generic category products

### 5. Promotions

Purpose:

- understand discount effect and promo usage

Reports:

- promotion effectiveness
- promotion usage by category
- discount leakage
- promo-driven revenue
- promo margin impact

### 6. Customers

Purpose:

- buying behavior and value

Reports:

- customer sales summary
- wallet activity
- loyalty activity
- RFM / top customers
- repeat purchase behavior

### 7. Staff

Purpose:

- employee reporting tied to store operations

Reports:

- attendance summary
- session/break behavior
- cashier sales performance
- leave and payroll support reports

### 8. Finance

Purpose:

- cost, margin, payable, and reconciliation visibility

Reports:

- gross profit layer
- net profit layer
- supplier payable summaries
- purchase vs sales profitability
- reconciliation status summaries

### 9. Exceptions

Purpose:

- detect bad data, risky transactions, and control failures

Reports:

- negative margin sales
- high discount orders
- frequent returns
- frequent voids
- missing category / brand / tags / product_type
- parent-category assignment exceptions if any appear
- Shopify import exceptions

### 10. Shopify / Sync

Purpose:

- operational sync visibility

Reports:

- imported products summary
- unmapped imported products
- ambiguous category matches
- sync failures / retry queue
- inventory mismatch / reconciliation summary

### 11. Governance / Audit

Purpose:

- saved views, schedules, report definitions, and delivery logs

Reports:

- scheduled exports
- saved views
- report definitions
- delivery log
- action history links where relevant

---

## Current-to-V2 Mapping

### Keep and modernize

- dashboard summary
- sales summary
- sales detail
- item-wise
- category-wise
- inventory dump
- sales & stock
- product spec
- cash / shift reports
- customer reports
- profitability reports
- inventory health reports
- exception reports

### Merge or re-group

- current power-up analytics should become part of the main report navigation
- category-wise and merchandising views should sit under `Catalog` and `Sales` logically
- inventory health reports should move under `Inventory`
- governance/schedules/saved views should move under `Governance / Audit`

### Add

- brand performance
- product type performance
- tag insights
- metadata completeness
- top-level category performance
- promotion effectiveness
- Shopify import exception reporting

---

## Core Universal Reporting Priorities

Because this product is intended for SaaS, Reports V2 must prioritize reporting that works across retail verticals by default.

### Category priorities

- top-level category rollups
- parent/child category performance
- category-path sales and profit
- category-path stock value and stock risk

### Merchandising priorities

- top brands
- top product types
- metadata completeness
- assortment breadth by category
- unclassified / generic catalog exceptions

### Tag priorities

- tag adoption
- top-performing tags
- missing-tag exceptions
- optional multi-tag filtering later

### Inventory priorities

- slow-moving stock
- high-stock / low-sales SKUs
- category-level dead stock
- stockout risk by category and brand

---

## Vertical Reporting Packs

The SaaS product should support optional vertical-specific report packs layered on top of the universal core.

Examples:

- Toys
- Grocery
- Fashion
- Electronics
- Pharmacy
- Beauty / Cosmetics
- Home / Lifestyle

### Vertical Pack Rules

- vertical packs must not replace the universal report foundation
- vertical packs can add:
  - filters
  - KPIs
  - domain summaries
  - tag-based views
  - merchandising-specific drilldowns
- vertical pack reports should still use the same shell, export behavior, and permission model

### Toy Store Pack Example

If a tenant is toy-focused, the toy pack can add:

- `Toys & Games` branch rollups
- age-tag analysis
- play-pattern tags like `STEM`, `Puzzle`, `Outdoor`
- gift / seasonal pack reporting
- slow-moving toy inventory
- toy brand comparisons

### Grocery Pack Example

Possible additions:

- perishables aging
- expiry risk
- fast-moving essentials
- wastage by category

### Fashion Pack Example

Possible additions:

- size/color variant sell-through
- seasonal collections
- markdown sensitivity

### Electronics Pack Example

Possible additions:

- accessory attach rate
- brand/vendor margin comparison
- warranty / serialized inventory support later

---

## Global Filter Model

Reports V2 should use a shared filter bar.

### Standard Filters

- date range
- outlet
- employee
- category
- brand
- product type
- tags
- product status
- promotion

### Behavior Rules

- selecting a parent category includes all descendant leaf categories
- category dropdown uses `path_label`
- brand filter is exact match
- product type filter is exact or search-driven
- tags filter should support one or multiple tags later
- outlet and employee filters apply only where relevant

### UX Rules

- active filters show as chips
- filters are sticky at the top of report content
- saved views preserve filter state
- “clear all” is always available

---

## RBAC and Feature Flags

### RBAC

Reports V2 must respect business sensitivity.

Examples:

- finance and profit reports: restricted
- payroll and staff reports: restricted
- approvals and reconciliation: restricted
- governance/admin reports: restricted
- basic sales/inventory reports: broader access

### Feature Flags

Existing report power-up flags should be mapped into the V2 structure instead of existing as a separate visual block.

Flags currently affecting reporting should be reviewed and assigned to domains:

- profitability
- inventory health
- exceptions
- scheduled exports
- governance

Decision:

- V2 UI should render one unified reports workspace
- flagged modules appear within it, not outside it

---

## UI / UX Redesign Plan

### Current Problem

The current reports experience is large, legacy-heavy, and visually fragmented.

### V2 Layout

Recommended page structure:

1. Header area

- page title
- summary subtitle
- quick actions:
  - export
  - refresh
  - save view
  - schedule

2. KPI summary row

- sales
- gross profit
- stock value
- low-stock count
- exception count

3. Domain navigation

- sidebar or segmented domain nav

4. Shared filter bar

- sticky on scroll

5. Main content area

- overview cards first
- then table/chart modules
- drilldown links inside each module

6. Empty and loading states

- each report section must have clean loading, empty, and error treatment

### Visual Direction

- cleaner spacing
- stronger hierarchy
- modern cards instead of old dense blocks
- lighter, more deliberate table framing
- better typography and alignment
- fewer overloaded screens

### Mobile / Small Screen Rules

- KPI cards collapse to stacked cards
- filters become stacked controls
- wide tables use horizontal scroll
- summary cards remain readable before table content

---

## Table and Chart Rules

### Use charts when:

- comparing a small number of categories or brands
- showing trends over time
- showing distribution or ranking

### Use tables when:

- exports matter
- auditability matters
- there are many rows
- exact values matter more than visual trend

### Rule

- every chart-driven report should still have a table representation or drilldown

---

## Export Rules

Every meaningful report should support export.

### Export Requirements

- CSV at minimum
- clear headers
- path-aware category labels
- applied-filter metadata where useful
- stable file naming

### Recommended Naming

- `category-wise.csv`
- `inventory-dump.csv`
- `brand-performance.csv`
- `category-root-performance.csv`

### Consistency Rules

- do not export ambiguous flat category labels when path labels are available
- exports should reflect the same filters shown in UI

---

## Drilldown Rules

Reports should connect.

Examples:

- category performance -> filtered item-wise or sales detail
- brand performance -> product spec or inventory dump filtered by brand
- stockout risk -> replenishment detail
- discount leakage -> sales detail
- top-level category performance -> product listing filtered to that path

---

## Performance and Query Safety

SQLite is the current datastore, so Reports V2 must stay realistic.

### Safe Patterns

- pagination on large detail reports
- summary-first rendering
- async loading by report section
- shared filter parsing
- reuse existing indexes where possible

### Reports that may need extra care

- item-wise detail
- product specification
- inventory dump
- profitability by product
- Shopify reconciliation / mismatch reports

### Potential follow-up needs

- new indexes for common filters
- query splitting by domain
- route-level refactor of `backend/routes/reports.js`

---

## Backend Refactor Direction

Do not split `reports.js` immediately unless actively working in those areas, but V2 should eventually move toward domain files.

Suggested future split:

- `reports-sales.js`
- `reports-inventory.js`
- `reports-catalog.js`
- `reports-customers.js`
- `reports-staff.js`
- `reports-finance.js`
- `reports-exceptions.js`
- `reports-governance.js`

For the first implementation wave, keep behavior changes incremental and safe.

---

## Frontend Refactor Direction

Suggested V2 component structure:

- `Reports.jsx` (Orchestrator, ~500 lines)
- `reports/ReportShared.jsx` (Shared UI primitives: TableShell, CardShell, MetricCard, Formatters)
- `reports/ReportsSales.jsx` (Sales, Detail, Item-wise, Transitions)
- `reports/ReportsInventory.jsx` (On-hand, Aging, Replenishment, Stock & Sales)
- `reports/ReportsCatalog.jsx` (Product Spec, Category-wise, Brand performance)
- `reports/ReportsOperations.jsx` (Wastage, Loss, Movement)
- `reports/ReportsPurchasing.jsx` (Purchase vs Sales, PO analysis)
- `reports/ReportsStaff.jsx` (Attendance, Performance)
- `reports/ReportsCustomers.jsx` (RFM, Acquisition, Loyalty)
- `reports/ReportsAnalytics.jsx` (Heatmaps, Matrix, Trends, Leaks)

---

## Missing Reports to Add

### Highest Priority

- brand performance
- product type performance
- metadata completeness
- top-level category performance
- promotion effectiveness
- Shopify import exceptions

### Nice to Have After Core V2

- tag insights
- vertical-pack seasonal/gift reporting
- vendor performance
- trend comparison across periods

---

## Implementation Phases

### Phase 1: Audit and Information Architecture

- inventory all current tabs and endpoints
- map each route to a business domain
- identify duplicates and low-value reports
- define final V2 navigation and naming

Deliverable:

- report inventory map
- keep/merge/add list

### Phase 2: Shared Foundation

- build shared filter bar
- standardize category path behavior
- standardize export helpers
- standardize loading/error/empty states

Deliverable:

- reusable reporting shell

### Phase 3: Shell and Navigation Redesign [DONE]

- redesign reports landing page
- add domain-based navigation
- integrate KPI overview
- integrate existing power-up modules into the new shell

Deliverable:

- modern V2 reports shell

### Phase 4: Core Report Modernization [DONE]

- update core sales and inventory reports
- update category-wise and product-spec views
- update category labels and exports everywhere

Deliverable:

- hierarchy-safe existing reports

### Phase 5: New Catalog and Merchandising Reports [DONE]

- brand performance
- product type performance
- metadata completeness
- top-level category performance

Deliverable:

- universal merchandising intelligence layer

### Phase 6.1: Reports Restoration & Data Key Unification [DONE]

- standardize all response keys across 4 modules (`items`, `sales`, `orders`)
- implement aggregation for `sales-summary` and `comparative-trends`
- restore missing `grn-report`
- cleanup legacy routes

Deliverable:

- stable, functional, and consistent Reports API

### Phase 7: Final Migration Sign-off [DONE]

- global syntax check
- cleanup debug logs
- project documentation update

Deliverable:

- project completion and stable codebase

Deliverable:

- extensible vertical reporting model

### Phase 7: Promotions and Exceptions [DONE]

- promotion effectiveness
- discount leakage improvements
- missing-category / metadata exception views
- Shopify import exception views (enhanced Mar 2026 for SKU-based tracking)

Deliverable:

- control and exception reporting layer

### Phase 8: Governance and Scheduling Integration [DONE]

- move saved views / schedules / definitions / delivery log into the new structure

Deliverable:

- unified reporting admin experience

### Phase 9: Testing and Polish

- backend accuracy tests
- Playwright smoke tests
- UI polish
- mobile cleanup

Deliverable:

- stable Reports V2

---

## Testing Plan

### Backend Tests

- category path labels returned consistently
- parent category filters include descendants
- brand/product-type reports aggregate correctly
- metadata completeness counts are correct
- promotion effectiveness math is correct
- Shopify exception reports handle null/ambiguous mappings correctly

### Frontend Tests

- report navigation renders expected domains
- shared filters propagate correctly
- category path labels render in tables
- exports trigger correctly
- drilldown links preserve filters

### Playwright Smoke Coverage

Required smoke specs:

- hierarchical categories smoke
- inventory + reports smoke
- category-wise export smoke
- brand/product-type reporting smoke
- promotion reporting smoke
- one optional vertical-pack smoke later if that pack is enabled

---

## Acceptance Criteria

Reports V2 is considered complete when:

1. Reports are grouped into clear business domains
2. Shared filters are consistent and hierarchy-aware
3. Category path labels are used consistently in UI and exports
4. The old “power-up” analytics are integrated into the main reporting experience
5. Brand, product type, metadata completeness, and top-level category reports exist
6. Promotion and Shopify exception reporting exist at an operationally useful level
7. Exports work consistently across major report types
8. Core report routes are covered by backend accuracy tests
9. Core user flows are covered by Playwright smoke tests
10. The page looks modern, clear, and usable on both desktop and smaller screens
11. Vertical-specific reporting remains optional and does not distort the universal reporting core

---

## Current Remaining Work

As of March 4, 2026, the remaining Reports V2 work is Phase 9 only.

### Still Open

- backend accuracy tests for hierarchy-aware filters, merchandising aggregates, promotion math, and Shopify exception cases
- Playwright smoke coverage for main report navigation, exports, and governance flows
- UI polish on dense report tables and small-screen behavior
- mobile cleanup for the tab strip, filter bar, and wide report content areas

### Recently Completed

- governance and scheduling tools are now part of the main reports workspace instead of living only in the legacy power-up block
- saved views, schedules, definition versions, and delivery log are now under the `Governance / Audit` domain

---

## Recommended First Implementation Slice

If work begins later and only one slice should be done first, do this:

1. redesign the reports shell
2. add the shared filter bar
3. modernize:
   - category-wise
   - inventory dump
   - product spec
   - sales & stock
4. add:
   - brand performance
   - product type performance
   - metadata completeness

This gives the highest value with the least risk.

---

## Final Recommendation

Do not treat Reports V2 as a visual cleanup only.

It should be implemented as:

- a reporting architecture upgrade
- a hierarchy-aware data presentation upgrade
- a universal retail reporting foundation for SaaS
- an optional vertical-pack reporting model
- a gradual modernization of one of the most business-critical parts of the app

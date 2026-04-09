# Phase 2 Operational Depth Implementation Plan

**Date:** 2026-04-09  
**Audience:** Implementation engineers, future agents, reviewers  
**Status:** Execution plan aligned to the current `omnichannel-phase1` branch  
**Companion design doc:** `docs/plans/2026-04-09-phase2-operational-depth-design.md`

---

## 1. Summary

This plan turns the Phase 2 Operational Depth design into an execution sequence against the current SanoPOS codebase.

Phase 2 in this plan includes:

- scheduling and time-off coordination
- geofenced attendance and overtime alerts
- outlet-aware pricing and catalog rules
- synced draft orders
- POS approval policies
- auto-apply promotions
- returns policy and return reasons
- staff attribution and commissions
- labor-vs-sales dashboards
- smart collections
- scheduled catalog updates
- custom report builder
- smart grid POS layouts
- checkout item suggestions

The plan intentionally extends existing systems instead of replacing them.

Recommended delivery cut:

- `Phase 2A`:
  - scheduling
  - time-off integration
  - geofence
  - overtime alerts
  - outlet-aware pricing
  - synced draft orders
  - POS approval policies
  - auto-apply promotions
  - return policies
  - labor-vs-sales
  - staff attribution
- `Phase 2B`:
  - smart collections
  - outlet visibility
  - outlet tax rules
  - scheduled catalog changes
  - commissions
  - custom report builder
  - smart grid layouts
  - item suggestions

---

## 2. Implementation Principles

- Reuse and extend current routes, tables, and UI flows wherever possible.
- Keep all new behavior behind feature flags until each workstream is stable.
- Prefer additive migrations and compatibility shims over hard replacements.
- Treat `parked_sales`, current price lists, leave requests, and reports governance as migration foundations.
- Make each workstream independently testable.

---

## 3. Required Public Interfaces and Data Contracts

These are the main new or expanded interfaces that Phase 2 must deliver.

### Workforce

- `GET /api/schedules`
- `POST /api/schedules`
- `PUT /api/schedules/:id`
- `POST /api/schedules/publish`
- `GET /api/schedules/open-shifts`
- existing leave endpoints remain primary and gain scheduling-aware fields

### Pricing and catalog

- `GET /api/price-list-assignments`
- `POST /api/price-list-assignments`
- `PUT /api/price-list-assignments/:id`
- `GET /api/products/:id/outlet-visibility`
- `PUT /api/products/:id/outlet-visibility`
- `GET /api/smart-collections`
- `POST /api/smart-collections`
- `PUT /api/smart-collections/:id`
- `GET /api/catalog/scheduled-changes`
- `POST /api/catalog/scheduled-changes`
- `PUT /api/catalog/scheduled-changes/:id`
- `GET /api/outlet-tax-profiles`
- `PUT /api/outlet-tax-profiles/:id`

### Drafts and approvals

- `GET /api/draft-orders`
- `POST /api/draft-orders`
- `PUT /api/draft-orders/:id`
- `POST /api/draft-orders/:id/claim`
- `POST /api/draft-orders/:id/complete`
- `GET /api/approval-policies`
- `POST /api/approval-policies`
- `PUT /api/approval-policies/:id`
- `POST /api/approvals/pos-authorize`

### Returns and attribution

- `GET /api/return-policies`
- `POST /api/return-policies`
- `PUT /api/return-policies/:id`
- `GET /api/return-reasons`
- `POST /api/return-reasons`
- `PUT /api/return-reasons/:id`
- `POST /api/returns/quote`

### Reports and POS merchandising

- `GET /api/reports/labor-vs-sales`
- `GET /api/reports/staff-attribution`
- `GET /api/reports/builder/datasets`
- `POST /api/reports/builder/run`
- `GET /api/reports/builder/definitions`
- `POST /api/reports/builder/definitions`
- `GET /api/pos-layouts`
- `POST /api/pos-layouts`
- `PUT /api/pos-layouts/:id`
- `GET /api/pos/suggestions`

---

## 4. Schema and Migration Work

## 4.1 New Tables

Target migration version: **v19** (current highest is v18).

Add migrations and schema updates for:

- `scheduled_shifts`
- `price_list_assignments`
- `outlet_product_visibility`
- `smart_collections`
- `smart_collection_rules`
- `scheduled_catalog_changes`
- `draft_orders`
- `draft_order_items`
- `approval_policies`
- `approval_events`
- `return_policies`
- `return_reasons`
- `commission_plans`
- `commission_plan_rules`
- `commission_earnings`
- `custom_report_definitions`
- `custom_report_widgets`
- `pos_layouts`
- `product_affinities`
- `outlet_tax_profiles`
- `outlet_tax_profile_lines`

## 4.2 Existing Table Extensions

Extend:

- `leave_requests`
- `outlets`
- `price_lists`
- `returns`
- optionally `sales` or attribution event tables for richer staff attribution

## 4.3 Feature Flags

Add default feature flags in backend and frontend:

- `phase2_scheduling`
- `phase2_outlet_pricing`
- `phase2_draft_orders`
- `phase2_pos_approvals`
- `phase2_returns_policy`
- `phase2_report_builder`

---

## 5. Execution Order

## 5.1 Phase 2A

Implement all Phase 2A workstreams before starting Phase 2B. This is the lowest-risk cut that still closes the biggest competitive gaps.

## 5.2 Workstream 1: Workforce Scheduling and Time Control

### Backend

Target files:

- `backend/routes/attendance.js`
- `backend/routes/tier4/hr.js`
- `backend/routes/registerAllRoutes.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

Tasks:

- add `scheduled_shifts` persistence and scheduling routes
- extend `leave_requests` for schedule-aware time-off
- add geofence fields to outlets
- add geofence validation in kiosk and employee self-status flows
- add overtime-threshold configuration and alert generation
- create schedule publish and open-shift endpoints

### Frontend

Target files:

- `frontend/src/pages/redesign/HRManagementRedesign.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/ui/nav-config.js`

Tasks:

- add a schedule calendar view
- add draft vs published schedule states
- integrate leave requests into schedule conflicts
- surface overtime warnings and geofence failures

### Acceptance criteria

- managers can draft schedules privately, then publish them
- approved leave blocks overlapping assignments
- clock-in can validate against outlet geofence when enabled
- overtime warnings appear before payroll generation

## 5.3 Workstream 2: Outlet-Aware Pricing, Catalog Visibility, and Tax Context

### Backend

Target files:

- `backend/routes/products.js`
- `backend/services/quote.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

Tasks:

- create `/api/price-lists` admin CRUD routes (tables exist but no admin management routes yet)
- keep current price-list data intact
- add assignment model for outlet, channel, customer, and group scope
- centralize price resolution precedence in shared pricing logic

### Frontend

Target files:

- `frontend/src/pages/redesign/PriceListsRedesign.jsx`
- new smart collections and scheduled changes screens or tabs
- `frontend/src/pages/redesign/pos/POSContext.jsx`

Tasks:

- expand price-list management to include scope assignments
- surface outlet and channel precedence
- make POS consume final resolved price, not only customer-linked overrides

### Acceptance criteria

- a product can have different active prices by outlet or customer scope

## 5.4 Workstream 3: Synced Draft Orders and Approval Policy Engine

### Backend

Target files:

- `backend/routes/parked-sales.js`
- new draft-order routes module
- `backend/routes/tier4/approvals.js`
- `backend/routes/promotions.js`
- `backend/services/quote.js`

Tasks:

- add `draft_orders` and `draft_order_items`
- create list, save, update, claim, and complete flows
- preserve `parked_sales` restore compatibility during transition
- add generic approval-policy CRUD
- add `pos-authorize` approval endpoint
- move auto-apply promotion evaluation into shared cart or quote logic

### Frontend

Target files:

- `frontend/src/pages/redesign/pos/POSContext.jsx`
- `frontend/src/pages/redesign/ParkedSalesRedesign.jsx`
- `frontend/src/pages/redesign/ApprovalsRedesign.jsx`

Tasks:

- switch primary POS draft behavior from parked sale to draft order
- add claim and resume semantics in the POS UI
- add approval modal for override-required actions
- surface automatic promotion application in cart review

### Acceptance criteria

- terminal A can save a draft and terminal B can resume it
- only one actor can complete a claimed draft at a time
- approval-required actions cannot proceed without authorized override
- automatic promotions apply consistently in the shared logic path

## 5.5 Workstream 4: Returns Policy, Structured Reasons, and Attribution

### Backend

Target files:

- `backend/routes/returns.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

Tasks:

- add return-policy CRUD
- add structured return reasons
- add return quote or preflight endpoint
- add eligibility checks before create
- log who processed and who approved exception returns
- add attribution hooks for discounts, voids, returns, and approvals

### Frontend

Target files:

- `frontend/src/pages/redesign/ReturnsRedesign.jsx`
- `frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx`

Tasks:

- add return-policy preview
- add structured reason selection
- show policy-blocked and approval-required states
- show attributed processor and approver in return detail

### Acceptance criteria

- the system can block or escalate out-of-policy returns
- return reasons are standardized
- no-receipt or out-of-window flows require approval if policy says so
- attribution is visible in reports and audit history

## 5.6 Workstream 5: Labor Analytics and Staff Attribution

### Backend

Target files:

- `backend/routes/reports/staff.js`
- `backend/routes/reports/sales.js`
- new commission routes module
- `backend/routes/tier4/hr.js`

Tasks:

- add labor-vs-sales endpoint using current labor foundations
- extend staff-attribution reporting for discount, return, and void ownership

### Frontend

Target files:

- `frontend/src/pages/reports/ReportsStaff.jsx`
- `frontend/src/pages/redesign/HRManagementRedesign.jsx`

Tasks:

- add labor-vs-sales dashboard cards and tables
- expose attribution metrics in staff and governance reporting

### Acceptance criteria

- staff reporting shows revenue, labor, returns, voids, and overrides by employee

## 5.7 Phase 2B

Start Phase 2B only after Phase 2A is stable in test and staging.

## 5.8 Workstream 6: Catalog Depth and Scheduled Merchandising

### Backend

Target files:

- `backend/routes/products.js`
- `backend/services/quote.js`
- new smart-collections or catalog-rules module

Tasks:

- add outlet product visibility rules
- add outlet tax profiles
- add smart collections
- add scheduled catalog and price changes

### Frontend

Target files:

- `frontend/src/pages/redesign/PriceListsRedesign.jsx`
- new smart collections and scheduled changes screens or tabs

Tasks:

- add product visibility management
- allow preview of scheduled changes
- add smart-collection management UI

### Acceptance criteria

- outlet visibility can hide a product without deleting it globally
- outlet tax resolution is deterministic
- scheduled catalog changes activate automatically at the intended time
- smart collections evaluate rules consistently

## 5.9 Workstream 7: Commissions

### Backend

Target files:

- new commission routes module
- `backend/routes/tier4/hr.js`
- reporting routes as needed

Tasks:

- add commission plan and earnings models
- connect finalized earnings into payroll export paths without blocking payroll generation

### Frontend

Target files:

- `frontend/src/pages/redesign/HRManagementRedesign.jsx`
- reporting UI files as needed

Tasks:

- add commission plan management
- add commission earnings view

### Acceptance criteria

- commission plans can be defined and calculated
- payroll exports can include commission totals when enabled

## 5.10 Workstream 8: Custom Report Builder, Smart Grid, and Item Suggestions

### Backend

Target files:

- `backend/routes/reports/governance.js`
- new report-builder service or routes module
- new POS layout and suggestion routes module

Tasks:

- add dataset registry for report builder
- add run endpoint for controlled report composition
- add saved builder definition persistence
- reuse governance scheduling for builder outputs
- add POS layout persistence
- add simple affinity-based suggestion service

### Frontend

Target files:

- `frontend/src/pages/Reports.jsx`
- `frontend/src/pages/reports/ReportsGovernance.jsx`
- `frontend/src/pages/redesign/pos/POSContext.jsx`
- POS UI component files for layout and suggestions

Tasks:

- add builder UI for choosing dataset, dimensions, measures, and filters
- save builder definitions into the governance model
- allow scheduling from saved definitions
- add configurable smart grid layout UI
- show item suggestions in checkout context

### Acceptance criteria

- users can build a constrained custom report without writing SQL
- saved reports can be exported and scheduled
- POS tile layouts can be configured and restored
- item suggestions appear from deterministic affinity data

---

## 6. Reference Anchors

Use these references while implementing the associated workstreams:

- scheduling:
  - https://developer.squareup.com/docs/labor-api/scheduling
  - https://developer.squareup.com/docs/labor-api/manage-scheduled-shifts
- pricing and catalog:
  - https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist
  - https://shopify.dev/docs/apps/build/markets/catalogs-different-markets
  - https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection (GraphQL; REST SmartCollection deprecated Oct 2024)
- drafts, approvals, and promotions:
  - https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder
  - https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions
  - https://shopify.dev/docs/api/functions/latest/discount
- returns:
  - https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/migrate-to-return-processing
- report builder and configurable layouts:
  - https://github.com/metabase/metabase
  - https://github.com/lightdash/lightdash
  - https://github.com/react-grid-layout/react-grid-layout
  - https://github.com/fullcalendar/fullcalendar

## 7. Migration and Compatibility Plan

### 6.1 Draft-order transition

- keep `parked_sales` endpoints alive initially
- add a migration or compatibility reader so old parked data remains visible
- move POS save and restore actions to `draft_orders` once the new endpoints are live

### 6.2 Price-list transition

- preserve `customers.price_list_id`
- backfill assignments into `price_list_assignments`
- update price resolution to read the new precedence order while still honoring old customer mappings

### 6.3 Leave-request transition

- do not replace `leave_requests`
- extend it for partial-day and scheduling overlap logic
- keep current HR UI working while scheduling screens are introduced

### 6.4 Reports transition

- keep current report tabs and governance endpoints intact
- layer builder definitions on top of existing report governance tables

---

## 8. Testing Plan

## 7.1 Unit Tests

- schedule publish and overlap rules
- leave-request time-window handling
- geofence validation
- price precedence resolution
- smart-collection rule matching
- scheduled catalog activation logic
- approval-policy matching
- return-policy eligibility
- commission calculations
- item-affinity ranking
- report-builder dataset validation

## 7.2 Integration Tests

- schedule draft -> publish -> assign workflow
- approved leave blocks schedule assignment
- draft order save -> claim -> complete across devices
- POS approval flow for discount and return exceptions
- automatic promotion application in shared quote logic
- outlet visibility and outlet tax profile resolution
- return preflight then final return creation
- custom report save, run, and schedule creation

## 7.3 Frontend and E2E Tests

- HR scheduling and leave approval flow
- geofence error and success states
- draft order resume on another terminal
- manager approval modal in POS
- return policy escalation path
- smart grid layout persistence
- item suggestions rendering
- report builder save and export

---

## 9. Risks and Controls

### Risk: scope sprawl

Control:

- keep Phase 2A and Phase 2B separate
- do not begin Phase 2B feature work before Phase 2A acceptance criteria are met
- ship by workstream behind feature flags
- land shared infrastructure before UI polish

### Risk: duplicated business logic

Control:

- centralize pricing, promotion, approval, and return-policy logic in backend services

### Risk: breaking existing POS flows

Control:

- keep parked-sales compatibility until draft orders are production-stable
- keep current price-list behavior as a fallback path during migration

### Risk: overbuilding custom reporting

Control:

- constrain builder to approved datasets and measures
- do not allow arbitrary SQL in v1

---

## 10. Done Criteria

Phase 2A is complete when:

- schedules, time-off, geofence, and overtime alerts work end to end
- pricing resolves correctly by outlet and scope
- server-owned drafts replace parked sales as the primary POS draft mechanism
- POS approvals enforce sensitive actions
- return policies and structured reasons are active
- labor-vs-sales and staff attribution reporting are visible
- all new surfaces are covered by automated tests and gated rollout controls

Phase 2B is complete when:

- visibility and tax rules resolve correctly by outlet
- smart collections and scheduled catalog changes are operational
- commission plans and earnings are operational
- users can compose and save constrained custom reports
- smart grid layouts and item suggestions are live

---

## 11. Final Recommendation

Implement Phase 2 in the order listed above and resist the temptation to ship isolated UI features first.

The highest-leverage sequence is:

1. Phase 2A:
   schema and policy foundations
   workforce control
   outlet-aware pricing
   synced drafts and approvals
   returns policy and attribution
   labor analytics
2. Phase 2B:
   catalog depth
   commissions
   report builder
   merchandising UX

That order gives SanoPOS the greatest competitive lift while staying aligned with the current codebase instead of fighting it.

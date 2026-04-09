# Phase 2 Operational Depth Design

**Date:** 2026-04-09  
**Audience:** Product owner, implementation engineers, future agents  
**Status:** Repo-specific design baseline for the next SanoPOS competitive wave  
**Companion sources:** `competitive-analysis-2.md`, `feature-development-references.md`

---

## 1. Purpose

This document defines the Phase 2 design for SanoPOS after Phase 1 omnichannel.

Phase 2 is not limited to the 7-item roadmap summary. For this design, Phase 2 follows the broader **Operational Depth** scope from `feature-development-references.md`, then adapts it to the current repo and the actual systems already present in SanoPOS.

This document is based on:

- the current `omnichannel-phase1` branch
- a fresh repo inspection of backend, frontend, schema, and reports
- a fresh re-check of the live external references listed below

---

## 2. Re-Research Summary

### 2.1 What Phase 2 Covers

This Phase 2 design includes:

- shift scheduling UI
- time-off request management
- location-specific pricing
- synced draft orders
- manager approval workflow
- auto-apply promotions
- return rules and policies
- smart collections
- custom report builder
- location-specific product visibility
- location-specific tax rules
- staff performance attribution
- geofenced clock-in
- commission tracking
- labor vs. sales dashboard
- smart grid / customizable POS tile layout
- sale item suggestions at checkout
- scheduled price and product updates
- overtime alerts

### 2.2 Corrections After Fresh Repo Review

Several items that look missing in the competitive docs are already partially present in this repo.

#### Already present as foundations

- Price lists already exist through `price_lists` and `price_list_items`, with POS consumption in `frontend/src/pages/redesign/pos/POSContext.jsx`.
- Server-backed parked sales already exist in `backend/routes/parked-sales.js`.
- Approval workflows already exist for purchase orders, stock transfers, and reconciliation fixes in `backend/routes/tier4/approvals.js`.
- HR already has `leave_requests`, payroll, attendance sessions, and a combined HR page.
- Labor-performance and loss-prevention reporting already exist in `backend/routes/reports/staff.js`.
- Reports governance already exists through `report_schedules`, `saved_report_views`, `report_definition_versions`, and delivery logs.
- Sales channels and channel publications already exist and can be reused for location-aware visibility rules.

#### Still genuinely missing

- draft and published shift scheduling
- outlet-aware pricing precedence beyond customer-linked price lists
- true synced draft orders with claim and finalize semantics
- reusable POS approval policies for discounts, returns, voids, and exceptions
- return policy engine
- smart collections
- timed catalog/price activation
- custom report composition layer on top of the existing reporting system
- smart POS tile layout configuration
- checkout item suggestions
- complete commission subsystem linked to payroll

#### Important implication

Phase 2 should **extend existing foundations**, not restart them.

---

## 3. Fresh External Validation

The following references were rechecked and remain the right modeling inputs for Phase 2.

### Shopify

- PriceList: https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist
- Catalogs for different markets: https://shopify.dev/docs/apps/build/markets/catalogs-different-markets
- DraftOrder GraphQL Admin API: https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder
- Discount Functions: https://shopify.dev/docs/api/functions/latest/discount
- Return processing migration: https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/migrate-to-return-processing
- POS permissions: https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions
- Smart collections: https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection (GraphQL; REST SmartCollection API is deprecated since Oct 2024)

### Square

- Labor scheduling: https://developer.squareup.com/docs/labor-api/scheduling

### Open-source references

- FullCalendar: https://github.com/fullcalendar/fullcalendar
- Cal.com: https://github.com/calcom/cal.com
- Medusa: https://github.com/medusajs/medusa
- Saleor: https://github.com/saleor/saleor
- Metabase: https://github.com/metabase/metabase
- Lightdash: https://github.com/lightdash/lightdash
- React Grid Layout: https://github.com/react-grid-layout/react-grid-layout

### Product-model conclusion

- Use **Square** as the primary reference for scheduling and labor workflows.
- Use **Shopify** as the primary reference for pricing scope, draft-order behavior, approval-style controls, discount logic, returns policy thinking, and catalog rules.
- Use the OSS projects for architecture and UX patterns only, not direct code copying.

---

## 4. Current Repo Baseline

### Backend foundations to reuse

- `backend/routes/attendance.js`
- `backend/routes/tier4/hr.js`
- `backend/routes/tier4/approvals.js`
- `backend/routes/parked-sales.js`
- `backend/routes/products.js`
- `backend/routes/promotions.js`
- `backend/routes/returns.js`
- `backend/routes/reports/governance.js`
- `backend/routes/reports/staff.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

### Frontend foundations to reuse

- `frontend/src/pages/redesign/HRManagementRedesign.jsx`
- `frontend/src/pages/redesign/PriceListsRedesign.jsx`
- `frontend/src/pages/redesign/ReturnsRedesign.jsx`
- `frontend/src/pages/redesign/ApprovalsRedesign.jsx`
- `frontend/src/pages/redesign/ParkedSalesRedesign.jsx`
- `frontend/src/pages/redesign/pos/POSContext.jsx`
- `frontend/src/pages/Reports.jsx`
- `frontend/src/pages/reports/ReportsGovernance.jsx`
- `frontend/src/pages/reports/ReportsStaff.jsx`

### Core design principle

Every new Phase 2 subsystem must attach to an existing operational path:

- scheduling attaches to attendance and HR
- outlet pricing attaches to current price lists
- synced drafts attach to the current parked-sale concept
- POS approvals attach to the current approvals and action-history model
- return rules attach to the current returns engine
- custom reporting attaches to current governance and reporting

---

## 5. Scope Cut Recommendation

Phase 2 is broad enough that it should be delivered in two internal cuts, even if product positioning still calls all of it "Phase 2".

### 5.1 Phase 2A: Core operational depth

Ship first:

- shift scheduling UI
- time-off request management
- geofenced clock-in
- overtime alerts
- location-specific pricing
- synced draft orders
- manager approval workflow
- auto-apply promotions
- return rules and policies
- labor vs. sales dashboard
- staff performance attribution

### 5.2 Phase 2B: Depth and polish

Ship after Phase 2A is stable:

- smart collections
- location-specific product visibility
- location-specific tax rules
- commission tracking
- custom report builder
- smart grid / customizable POS tile layout
- sale item suggestions at checkout
- scheduled price and product updates

### 5.3 Why this cut is recommended

- Phase 2A is built mostly on already-existing repo foundations.
- Phase 2B contains more configuration systems and UI-heavy surfaces.
- This split reduces implementation risk while still closing the most visible competitive gaps early.

---

## 6. Phase 2 Architecture by Workstream

## 6.1 Workforce Scheduling and Time Control

### Goal

Close the largest HR gap by introducing scheduling, time-off coordination, geofenced clock-in, and overtime alerting without replacing the current attendance stack.

### Delivery cut

Phase 2A

### External anchors

- Square scheduling lifecycle (BETA API — may change): https://developer.squareup.com/docs/labor-api/scheduling
- Square publish semantics (BETA): https://developer.squareup.com/docs/labor-api/manage-scheduled-shifts
- Calendar UI reference: https://github.com/fullcalendar/fullcalendar
- Availability and absence workflow reference: https://github.com/calcom/cal.com

### Design decisions

- Add a new `scheduled_shifts` table with draft and published states.
- Keep `leave_requests` as the time-off model and extend it for scheduling use instead of creating a new parallel table.
- Add optional outlet geofence settings directly on outlets.
- Keep attendance sessions as the system of record for actual work done.
- Overtime alerts are notification-driven and policy-based, not hard attendance blockers.

### New or changed interfaces

- `GET /api/schedules`
- `POST /api/schedules`
- `PUT /api/schedules/:id`
- `POST /api/schedules/publish`
- `GET /api/schedules/open-shifts`
- `GET /api/hr/leave`
- `POST /api/hr/leave`
- `PUT /api/hr/leave/:id/status`
- `POST /api/attendance/pin-checkin` gains optional geofence validation

### Data model additions

- `scheduled_shifts`
- outlet fields:
  - `latitude`
  - `longitude`
  - `geofence_radius_meters`
- leave-request extensions:
  - `partial_day`
  - `start_time`
  - `end_time`
  - `schedule_impact_status`

### Default behavior

- Schedules are drafted privately, then published.
- Published schedules become visible to staff and enforce schedule-aware warnings.
- On publish, the system should support notification audience control (affected staff only, all staff, or none) following Square's publish notification pattern.
- Approved time-off blocks staff assignment during overlapping windows.
- Unscheduled clock-ins are allowed initially but flagged, with future approval-policy support.

## 6.2 Pricing, Visibility, and Tax Context

### Goal

Move from customer-only price overrides to a proper outlet-aware catalog and pricing system.

### Delivery cut

- Phase 2A:
  - location-specific pricing
- Phase 2B:
  - location-specific product visibility
  - location-specific tax rules
  - smart collections
  - scheduled catalog changes

### External anchors

- Shopify PriceList: https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist
- Shopify markets and catalogs: https://shopify.dev/docs/apps/build/markets/catalogs-different-markets
- Shopify smart collections: https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection (GraphQL; REST SmartCollection API is deprecated since Oct 2024)
- Medusa pricing architecture: https://github.com/medusajs/medusa
- Saleor channel and catalog architecture: https://github.com/saleor/saleor

### Design decisions

- Reuse `price_lists` as the base primitive.
- Add `price_list_assignments` so one list can target outlet, channel, customer, or customer group.
- Preserve `customers.price_list_id` for compatibility during migration.
- Add outlet-scoped visibility rules instead of duplicating product records per outlet.
- Add smart collections as rule-based saved catalog segments.
- Add scheduled catalog changes for time-based activation of prices and publish states.
- Implement outlet tax rules through outlet tax profiles, not checkout-only ad hoc overrides.

### New or changed interfaces

- `GET /api/price-lists`
- `POST /api/price-lists`
- `PUT /api/price-lists/:id`
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

### Data model additions

- `price_list_assignments`
- `outlet_product_visibility`
- `smart_collections` (includes `disjunctive` boolean for AND vs OR rule logic)
- `smart_collection_rules` (supports standard columns plus metafield-based rules)
- `scheduled_catalog_changes`
- `outlet_tax_profiles`
- `outlet_tax_profile_lines`

### Price precedence

The system should resolve price in this order:

1. active scheduled override
2. outlet and channel assignment
3. customer or customer-group assignment
4. product or variant base price

## 6.3 Synced Draft Orders and POS Approval Policies

### Goal

Upgrade current parked sales into server-authoritative draft orders and introduce reusable manager-approval rules for sensitive POS actions.

### Delivery cut

Phase 2A

### External anchors

- Shopify DraftOrder GraphQL Admin API: https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder
- Shopify POS Draft Order context (read-only reference): https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis/contextual-apis/draft-order-api
- Shopify POS permissions model: https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions
- Shopify Discount Functions: https://shopify.dev/docs/api/functions/latest/discount
- Medusa draft-order and promotions patterns: https://github.com/medusajs/medusa

### Design decisions

- Keep `parked_sales` readable and restorable during migration, but treat it as legacy once draft orders ship.
- Introduce `draft_orders` with explicit ownership, claim, and completion semantics.
- Build a generic approval policy engine using `allowed`, `denied`, and `approval_required`.
- Apply approval policies to (aligned with Shopify's granular POS permissions):
  - manual discounts (custom discounts and discount codes)
  - returns outside policy (including unverified/no-receipt returns)
  - voids and order cancellations
  - tax edits
  - offline exceptions
  - no-receipt returns
- Auto-apply promotions should run through shared quote/cart logic so POS and future channels behave consistently.

### New or changed interfaces

- `GET /api/draft-orders`
- `POST /api/draft-orders`
- `PUT /api/draft-orders/:id`
- `POST /api/draft-orders/:id/claim`
- `POST /api/draft-orders/:id/complete`
- `GET /api/approval-policies`
- `POST /api/approval-policies`
- `PUT /api/approval-policies/:id`
- `POST /api/approvals/pos-authorize`
- `POST /api/promotions/auto-quote`

### Data model additions

- `draft_orders`
- `draft_order_items`
- `approval_policies`
- `approval_events`

### Default behavior

- Draft orders are server-owned and resumable on any authorized terminal.
- Claiming prevents concurrent completion.
- Approval requests must be logged into action history.
- Promotion auto-apply should remain deterministic and auditable.

## 6.4 Returns Policy and Structured Attribution

### Goal

Turn returns from a pure transaction flow into a policy-aware, staff-attributed operational system.

### Delivery cut

Phase 2A

### External anchors

- Shopify return-management migration guidance: https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/migrate-to-return-processing
- Existing SanoPOS return flow remains the base implementation path

Note: Shopify's `returnProcess` mutation (API 2025-07+) is now the canonical path, combining disposition and financial processing in one call. The older `returnRefund` and `refundCreate` mutations are legacy. The `POST /api/returns/quote` endpoint should follow Shopify's `suggestedFinancialOutcome` pattern (replaces `suggestedRefund`).

### Design decisions

- Keep `returns` and `return_items` as the base transaction model.
- Add return policies and structured return reasons.
- Add policy evaluation before final return creation.
- Model the return quote endpoint after Shopify's `suggestedFinancialOutcome` pattern.
- Treat out-of-window, no-receipt, or refund-method mismatch cases as approval-driven exceptions.
- Capture staff attribution for discounts, returns, voids, and overrides in structured events.

### New or changed interfaces

- `GET /api/return-policies`
- `POST /api/return-policies`
- `PUT /api/return-policies/:id`
- `GET /api/return-reasons`
- `POST /api/return-reasons`
- `PUT /api/return-reasons/:id`
- `POST /api/returns/quote`
- `POST /api/returns`

### Data model additions

- `return_policies`
- `return_reasons`
- return extensions:
  - `policy_id`
  - `policy_result`
  - `approval_event_id`
  - `processed_by_employee_id`
  - `approved_by_employee_id`

## 6.5 Labor Analytics, Commission Rules, and Staff Attribution

### Goal

Deepen labor controls and reporting by connecting scheduling, attendance, sales, returns, and payroll-adjacent commission logic.

### Delivery cut

- Phase 2A:
  - labor vs. sales dashboard
  - staff performance attribution
- Phase 2B:
  - commission tracking

### External anchors

- Square labor concepts remain the primary modeling reference
- Current SanoPOS labor-performance reporting is the base implementation path

### Design decisions

- Build labor-vs-sales dashboards on top of current `labor-performance` reporting.
- Add commission plans and earnings as explicit models rather than assuming a legacy `sale_commissions` table is ready.
- Keep commissions tied to finalized sale attribution, not draft transactions.
- Staff attribution should feed reporting first, then payroll exports and payout workflows.

### New or changed interfaces

- `GET /api/reports/labor-vs-sales`
- `GET /api/reports/staff-attribution`
- `GET /api/commission-plans`
- `POST /api/commission-plans`
- `PUT /api/commission-plans/:id`
- `GET /api/commissions/earnings`

### Data model additions

- `commission_plans`
- `commission_plan_rules`
- `commission_earnings`

### Important note

`backend/scripts/sqlite-to-pg.js` references `sale_commissions`, but the active Postgres model does not expose a complete commission workflow in the current app. Phase 2 should normalize this area rather than assuming it already exists.

## 6.6 Custom Report Builder and Merchandising UX

### Goal

Extend the current reports workspace into a constrained report builder and add operator-facing merchandising controls in POS.

### Delivery cut

Phase 2B

### External anchors

- Metabase UX reference: https://github.com/metabase/metabase
- Lightdash UX reference: https://github.com/lightdash/lightdash
- React Grid Layout reference: https://github.com/react-grid-layout/react-grid-layout

### Design decisions

- Reuse current governance structures:
  - `report_schedules`
  - `saved_report_views`
  - `report_definition_versions`
- Add a report-builder layer that works from approved datasets and metrics, not arbitrary SQL.
- Add smart grid layout configuration per outlet, role, or employee.
- Add deterministic item suggestions using affinity rules, not ML.

### New or changed interfaces

- `GET /api/reports/builder/datasets`
- `POST /api/reports/builder/run`
- `GET /api/reports/builder/definitions`
- `POST /api/reports/builder/definitions`
- `GET /api/pos-layouts`
- `POST /api/pos-layouts`
- `PUT /api/pos-layouts/:id`
- `GET /api/pos/suggestions`

### Data model additions

- `custom_report_definitions`
- `custom_report_widgets`
- `pos_layouts`
- `product_affinities`

### Builder scope for v1

- choose dataset
- choose dimensions
- choose measures
- apply filters
- save a definition
- export CSV
- schedule via the existing governance layer

---

## 7. Cross-Cutting Policies

### 6.1 Feature Flags

Phase 2 should ship behind dedicated flags:

- `phase2_scheduling`
- `phase2_outlet_pricing`
- `phase2_draft_orders`
- `phase2_pos_approvals`
- `phase2_returns_policy`
- `phase2_report_builder`

### 6.2 Auditability

All approval-required or policy-driven actions must leave machine-readable audit evidence.

Required captured metadata:

- actor
- target entity
- rule matched
- outcome
- reason or note
- timestamp
- outlet

### 6.3 Compatibility

Phase 2 must preserve:

- current parked-sale restore behavior until draft orders fully replace it
- current customer-linked price-list behavior
- current leave request approvals
- current reporting tabs and governance endpoints

---

## 8. Out of Scope

Phase 2 does not include:

- restaurant mode
- appointments
- service-business contracts
- BNPL, banking, loans, or payment-gateway ownership
- a full BI warehouse or arbitrary-SQL analytics product
- AI recommendation systems

Items listed under Phase 2B are not out of scope overall, but they are intentionally not part of the recommended first implementation cut.

---

## 9. Final Recommendation

The best Phase 2 path for this repo is to build a small number of shared operational subsystems instead of many disconnected features.

The recommended delivery order is:

1. Phase 2A:
   workforce scheduling and time policy
   outlet-aware pricing
   synced drafts and reusable approvals
   returns policy and attribution
   labor-vs-sales and staff attribution
2. Phase 2B:
   catalog depth
   commissions
   report builder
   smart grid and item suggestions

That keeps Phase 2 aligned with the competitive gaps, reuses the strongest code already in the repo, and avoids rebuilding systems SanoPOS already partially has.

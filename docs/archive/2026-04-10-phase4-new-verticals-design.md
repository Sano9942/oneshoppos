# Phase 4 New Verticals Design

**Date:** 2026-04-10  
**Audience:** Product owner, implementation engineers, reviewers, future agents  
**Status:** Repo-specific design baseline for the next competitive wave  
**Companion sources:** `competitive-analysis-2.md`, `feature-development-references.md`

---

## 1. Purpose

This document defines **Phase 4** for SanoPOS after the current Phase 1 omnichannel, Phase 2 operational-depth, and Phase 3 engagement and financial foundations.

Phase 4 is the first wave that intentionally expands SanoPOS into **new business verticals**, not just deeper retail POS depth.

The purpose of this design is to make Phase 4:

- aligned with the competitive analysis
- grounded in the actual repo state
- explicit about reuse of existing SanoPOS systems
- split into deliverable internal cuts instead of one oversized all-at-once project

Phase 4 in this design covers:

- restaurant mode
- appointment booking
- service-business workspace

This document is based on:

- the current repo inspection of backend routes, schema, feature flags, storefront, fulfillment, POS, HR, CRM, invoicing, subscriptions, and messaging
- the current competitive phase definitions in `competitive-analysis-2.md`
- the curated reference mapping in `feature-development-references.md`
- a fresh re-check of the vendor and GitHub sources listed below

---

## 2. Scope Decision

### 2.1 What Phase 4 Covers

Phase 4 is one umbrella wave with three internal delivery cuts:

- `Phase 4A` Restaurant Mode
- `Phase 4B` Appointment Booking
- `Phase 4C` Service-Business Workspace

### 2.2 Why Phase 4 Should Stay Umbrella-Shaped

The competitive roadmap already positions Phase 4 as the "new verticals" wave. That positioning is still correct after repo review because all three verticals can reuse the same existing foundations:

- public surfaces from storefront
- staff and schedule primitives from HR and scheduling
- customer communication from messaging and campaigns
- billing from customer invoices and subscriptions
- estimate-to-order foundations from quotations
- draft order and approval patterns from POS and Phase 2

The correct strategy is **one wave, three controlled cuts**, not three disconnected roadmap phases.

### 2.3 Delivery Order

The recommended execution order is fixed:

1. `Phase 4A` Restaurant Mode
2. `Phase 4B` Appointment Booking
3. `Phase 4C` Service-Business Workspace

This order is recommended because:

- restaurant mode depends mostly on POS and public-ordering foundations already in the repo
- appointment booking depends on the scheduling and reminder foundations already introduced in earlier phases
- service-business workspace gets strongest value once customer invoicing and subscriptions are already treated as stable business primitives

### 2.4 What Phase 4 Does Not Cover

Phase 4 does not include:

- separate native mobile apps
- real-time websocket infrastructure as a hard requirement
- payment-gateway-owned features such as guaranteed no-show fee capture or universal preauthorization
- third-party restaurant delivery marketplace aggregation
- Google Calendar sync as a mandatory v1 requirement
- a full contract-lifecycle platform comparable to DocuSign
- a separate second invoice engine or second estimate engine

---

## 3. Re-Research Summary

### 3.1 Square Remains the Primary Product-Model Reference

Square remains the best product-model reference for Phase 4 because it provides the clearest commercial packaging and lifecycle guidance across all three verticals:

- Restaurants: table management, seats, check split, KDS, kiosk, QR ordering, bar tabs
- Bookings: service catalog, staff-linked availability, availability search, booking lifecycle
- Service business: invoice lifecycle, subscription billing patterns, project-style workflows

Important design implication:

- use **Square for product modeling**
- use **GitHub projects for architecture and UX patterns**
- do **not** copy direct code from AGPL/GPL/Elastic licensed repos

### 3.2 Corrected Understanding After Fresh Validation

The recheck surfaced several important corrections that the implementation should not miss:

- **Seat tracking is a first-class restaurant requirement**, not a minor add-on to split checks
- **KDS needs station roles** like prep and expo, not just a generic kitchen ticket queue
- **Bar tab preauthorization should be provider-gated**, because the repo does not have a reusable card-hold primitive today
- **Booking must be availability-search-first**, not a naive create-appointment-first flow
- **Service-business billing must reuse Phase 3 invoice and subscription primitives**, not create parallel billing models
- **Contracts should start with internal signature capture and auditability**, not external enterprise-grade signing integrations

---

## 4. Reference Mapping

### 4.1 Vendor References

Use these vendor references directly when defining lifecycle, API shape, and product behavior.

#### Square Restaurants

- Square Restaurants product overview: https://squareup.com/us/en/point-of-sale/restaurants
- Table-management settings: https://squareup.com/help/us/en/article/8146-customize-table-management-settings
- Seat management: https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant
- Split payment and split check guidance: https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants
- KDS setup and routing concepts: https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android
- Bar-tab preauthorization: https://squareup.com/help/us/en/article/8455-enable-and-configure-preauthorization-for-bar-tabs
- QR ordering / self-serve ordering: https://squareup.com/help/us/en/article/7142-set-up-self-serve-ordering-and-qr-codes-with-square-online

#### Square Bookings

- Bookings API overview: https://developer.squareup.com/docs/bookings-api/what-it-is
- Using the Bookings API: https://developer.squareup.com/docs/bookings-api/use-the-api
- Bookings webhooks: https://developer.squareup.com/docs/bookings-api/use-webhooks

#### Square Billing

- Invoices API overview: https://developer.squareup.com/docs/invoices-api/overview
- Subscriptions API reference: https://developer.squareup.com/reference/square/subscriptions-api
- Subscription billing concepts: https://developer.squareup.com/docs/subscriptions-api/subscription-billing

### 4.2 Open-Source GitHub References

Use these as architecture and workflow references only.

#### Restaurant

- URY ERP: https://github.com/ury-erp/ury
- URY Mosaic: https://github.com/ury-erp/mosaic
- OpenKDS: https://github.com/BenClementt/OpenKDS
- FoodStreams: https://github.com/calvincchong/FoodStreams

#### Appointment Booking

- Cal.com: https://github.com/calcom/cal.com
- Square sample bookings app: https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_bookings

#### Service Business

- Invoice Ninja: https://github.com/invoiceninja/invoiceninja

#### Public Surface Patterns

- Shopify Hydrogen: https://github.com/Shopify/hydrogen

### 4.3 License Guidance For Phase 4

Several of the best OSS references are under restrictive licenses.

Treat these as **study-only architecture references**:

- `ury-erp/ury` — AGPL
- `ury-erp/mosaic` — AGPL
- `BenClementt/OpenKDS` — GPL
- `calcom/cal.com` — AGPL/commercial
- `invoiceninja/invoiceninja` — Elastic license

Practical rule for Phase 4:

- copy **ideas, workflows, entity shapes, and UX patterns**
- do **not** copy direct implementation code from these repos into SanoPOS

---

## 5. Current Repo Baseline

### 5.1 Backend Foundations To Reuse

The repo already has strong operational primitives that Phase 4 should extend.

Primary foundations:

- `backend/routes/draft-orders.js`
- `backend/routes/sales.js`
- `backend/routes/returns.js`
- `backend/routes/approval-policies.js`
- `backend/routes/schedules.js`
- `backend/routes/attendance.js`
- `backend/routes/fulfillment.js`
- `backend/routes/storefront.js`
- `backend/routes/customer-display.js`
- `backend/routes/customer-invoices.js`
- `backend/routes/subscriptions.js`
- `backend/routes/marketing.js`
- `backend/routes/messaging.js`
- `backend/routes/tier4/crm.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

### 5.2 Frontend Foundations To Reuse

Primary frontend bases:

- `frontend/src/pages/redesign/pos/POSContext.jsx`
- `frontend/src/pages/redesign/FulfillmentRedesign.jsx`
- `frontend/src/pages/redesign/QuotationsRedesign.jsx`
- `frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx`
- `frontend/src/pages/redesign/SubscriptionsRedesign.jsx`
- `frontend/src/pages/redesign/SchedulingRedesign.jsx`
- `frontend/src/pages/CustomerDisplayPage.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/ui/nav-config.js`

### 5.3 Existing Phase 2 And Phase 3 Foundations Already In Repo

These are especially important for Phase 4:

- `scheduled_shifts` already exists and should be reused for working-window overlays
- `draft_orders` already exists and should be extended for restaurant order context
- `approval_policies` already exists and should gate exceptions in restaurant and service flows
- `customer_invoices` already exists and should remain the billing engine for projects and milestone billing
- `customer_subscriptions` already exists and should remain the recurring-billing engine for service work
- `quotations` already exists and should remain the estimate foundation
- public storefront tenant resolution already exists and should be reused for public booking and QR ordering pages

### 5.4 Core Phase 4 Design Principle

Phase 4 must **extend the current operational and public systems** instead of building disconnected mini-products inside the same repo.

That means:

- restaurant builds on `draft_orders`, POS, and public ordering
- appointments builds on `employees`, `scheduled_shifts`, reminders, and public routing
- service-business builds on `quotations`, invoices, subscriptions, messaging, and reminders

---

## 6. Architecture By Vertical

## 6.1 Phase 4A — Restaurant Mode

### Goal

Expand SanoPOS from retail checkout into a restaurant-capable operating flow with:

- floor plans
- table sessions
- seat tracking
- course timing
- tabs
- check split
- kitchen display routing
- QR ordering
- kiosk ordering
- quick-service checkout mode

### Product-Model Conclusion

Restaurant mode should **not** introduce a second order engine. The right model for this repo is:

- keep `draft_orders` as the cart and pre-sale container
- add restaurant-specific context, sessioning, and ticket routing on top
- convert to finalized sales through the same core completion path already used by POS

### Delivery Cuts

#### Phase 4A1 — Restaurant MVP

Ship first:

- floor plans and sections
- table and session states
- seat tracking and cover count
- server assignment
- open checks and open tabs
- hold and fire by course
- split check by item and seat
- KDS prep and expo stations
- quick-service mode

#### Phase 4A2 — Restaurant Expansion

Ship after 4A1 is stable:

- QR ordering tied to table tokens
- kiosk ordering
- kitchen performance reports
- recipe costing and ingredient usage
- waste logging
- provider-gated preauthorization for tabs

### Data Model

Add these new tables:

- `restaurant_floor_plans`
- `restaurant_floor_sections`
- `restaurant_tables`
- `restaurant_table_sessions`
- `restaurant_check_seats`
- `restaurant_check_adjustments`
- `restaurant_course_fires`
- `restaurant_tabs`
- `restaurant_preauth_holds`
- `kds_stations`
- `kds_station_routes`
- `kds_tickets`
- `kds_ticket_events`

Extend `draft_orders` with:

- `order_context`
- `table_id`
- `table_session_id`
- `tab_id`
- `seat_count`
- `dining_option`
- `source_token_id`

### Design Decisions

- `draft_orders` remain the source of editable cart state.
- `restaurant_table_sessions` track occupancy, guest count, server assignment, and elapsed state.
- `restaurant_check_seats` store per-seat grouping so seat transfer and split-by-seat are deterministic.
- `restaurant_check_adjustments` store check-level service charges, gratuity, rounding, and shared adjustments so splits stay mathematically correct.
- `restaurant_tabs` model open tabs independently from table occupancy so a guest can have a bar tab without a seated-table workflow.
- `restaurant_preauth_holds` should exist in schema from the start, but real card-hold behavior remains provider-gated.
- KDS must support station roles:
  - `prep`
  - `expo`
- KDS tickets should be evented, not just mutable rows, so speed and station analytics can be derived later.

### Public And Operator Surfaces

Operator surfaces:

- floor plan board
- table detail drawer
- open checks view
- KDS station screen
- quick-service POS mode

Public surfaces:

- table QR menu
- kiosk ordering page

### New Or Changed Interfaces

- `GET /api/restaurant/floor-plans`
- `POST /api/restaurant/floor-plans`
- `PUT /api/restaurant/floor-plans/:id`
- `GET /api/restaurant/tables`
- `POST /api/restaurant/tables`
- `PUT /api/restaurant/tables/:id`
- `GET /api/restaurant/table-sessions`
- `POST /api/restaurant/table-sessions`
- `PUT /api/restaurant/table-sessions/:id`
- `GET /api/restaurant/checks`
- `POST /api/restaurant/checks`
- `PUT /api/restaurant/checks/:id`
- `POST /api/restaurant/checks/:id/send-to-kitchen`
- `POST /api/restaurant/checks/:id/fire-course`
- `POST /api/restaurant/checks/:id/split`
- `GET /api/kds/stations`
- `POST /api/kds/stations`
- `PUT /api/kds/stations/:id`
- `GET /api/kds/tickets`
- `POST /api/kds/tickets/:id/bump`
- public `GET /api/public/restaurant/menu/:token`
- public `POST /api/public/restaurant/checks/:token/items`

### Operational Defaults

- v1 should use **DB-backed state plus polling** for floor updates, QR ordering, and KDS tickets.
- Do not architect KDS around the current in-memory customer-display store.
- QR ordering should default to a **table-bound token model**.
- Quick-service mode should be a POS mode variant that skips table/session requirement.

---

## 6.2 Phase 4B — Appointment Booking

### Goal

Add a booking business flow that supports:

- public self-service booking
- internal staff booking
- availability search
- service catalog
- multi-staff calendars
- waitlists
- classes
- reminders
- resource scheduling

### Product-Model Conclusion

Do not build a separate staffing system. The repo already has employees, attendance, and scheduling primitives. Appointment booking should:

- reuse employees as service providers
- reuse scheduling as the starting point for work windows
- add booking-specific availability, blocks, services, and reservations on top

### Delivery Cuts

#### Phase 4B1 — Booking MVP

Ship first:

- service catalog
- service-to-staff assignment
- availability rules
- admin booking calendar
- public booking page
- booking creation, reschedule, cancel
- appointment reminders
- cancellation windows and policy messaging

#### Phase 4B2 — Booking Expansion

Ship after 4B1 is stable:

- waitlists
- resources
- class sessions
- multi-service appointments
- Google Calendar sync
- provider-gated no-show fee and payment-hold behaviors

### Data Model

Add these tables:

- `booking_services`
- `booking_service_variants`
- `booking_staff_assignments`
- `booking_resources`
- `booking_resource_assignments`
- `booking_availability_rules`
- `appointment_blocks`
- `appointments`
- `appointment_segments`
- `appointment_reminders`
- `appointment_waitlist_entries`
- `class_sessions`
- `class_session_bookings`
- `calendar_sync_accounts`

### Design Decisions

- Public booking must follow:
  - search availability
  - reserve a slot
  - create booking
- `booking_services` should define duration, padding, default outlet, and whether booking requires confirmation.
- `appointment_segments` should support multi-service appointments without forcing all services into a single indivisible time block.
- `appointment_blocks` should cover manual closures, staff unavailability, and operational blackout windows.
- `booking_resources` should model rooms, chairs, equipment, or stations that can be allocated alongside staff.
- Reminders should reuse the existing scheduler pattern already used elsewhere in the repo.
- Cancellation policy should be stored as rule data and presented clearly to staff and public users, even if no-show fee charging is not yet active.

### New Or Changed Interfaces

- `GET /api/booking-services`
- `POST /api/booking-services`
- `PUT /api/booking-services/:id`
- `GET /api/appointments/availability`
- `GET /api/appointments/calendar`
- `GET /api/appointments`
- `POST /api/appointments`
- `PUT /api/appointments/:id`
- `POST /api/appointments/:id/cancel`
- `POST /api/appointments/:id/reschedule`
- `GET /api/appointments/waitlist`
- `POST /api/appointments/waitlist`
- public `GET /api/public/bookings/config`
- public `GET /api/public/bookings/availability`
- public `POST /api/public/bookings`

### Operational Defaults

- Internal admin-created bookings can default to accepted.
- Public bookings can default to accepted unless business configuration requires manual review.
- Google Calendar sync must be optional and feature-flagged.
- No-show fee capture must be optional and provider-gated.

---

## 6.3 Phase 4C — Service-Business Workspace

### Goal

Add a project-oriented business layer for service businesses with:

- estimates
- approval flow
- project workspaces
- milestone billing
- recurring service billing
- contracts
- signatures
- internal activity tracking

### Product-Model Conclusion

This repo already has the correct financial foundations:

- `quotations` for estimates
- `customer_invoices` for invoices, deposits, reminders, and payment links
- `customer_subscriptions` for recurring billing

The correct design is to **wrap these systems in a project workspace**, not create parallel business objects for billing.

### Delivery Cuts

#### Phase 4C1 — Service Workspace MVP

Ship first:

- project workspace
- quotation-as-estimate workflow
- estimate approval flow
- milestone records
- milestone-based invoicing
- project-linked recurring service billing
- project activity feed

#### Phase 4C2 — Contract Expansion

Ship after 4C1 is stable:

- contract templates
- generated contracts
- signer workflow
- internal signature capture
- AI clause assistance

### Data Model

Add these tables:

- `service_projects`
- `project_contacts`
- `project_milestones`
- `project_activities`
- `contract_templates`
- `contracts`
- `contract_signers`
- `contract_events`
- `project_files`

Extend these existing tables:

- `quotations`
  - `project_id`
  - `estimate_status`
  - `approved_at`
  - `approved_by`
- `customer_invoices`
  - `project_id`
  - `milestone_id`
  - `invoice_kind`
- `customer_subscriptions`
  - `project_id`
  - `billing_template_id`

### Design Decisions

- `quotations` stay the estimate foundation. No second estimate table should be introduced.
- Approved estimates can create or attach to a project workspace.
- `project_milestones` should store amount, due trigger, dependency notes, and invoicing state.
- `customer_invoices` should be reused for milestone invoices and deposit collection.
- `customer_subscriptions` should be reused for recurring service contracts such as monthly retainers.
- Contracts should start as document records with signer capture and audit trail.
- AI-generated clauses should be feature-gated and additive to templates, never silently overwriting approved legal text.

### New Or Changed Interfaces

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `POST /api/projects/:id/milestones`
- `PUT /api/projects/:id/milestones/:mid`
- `POST /api/quotations/:id/approve`
- `POST /api/quotations/:id/convert-to-project`
- `POST /api/customer-invoices/:id/attach-to-project`
- `GET /api/contracts`
- `POST /api/contracts`
- `PUT /api/contracts/:id`
- `POST /api/contracts/:id/send`
- `POST /api/contracts/:id/sign`

### Operational Defaults

- Project workspace is the parent surface for estimates, invoices, subscriptions, contracts, files, and notes.
- Internal signature capture is sufficient for v1.
- External e-sign integrations are out of scope.

---

## 7. Shared Architecture Decisions

### 7.1 No Duplicate Core Engines

Phase 4 must not create duplicate systems for:

- cart/order handling
- staffing
- invoice generation
- recurring billing
- public tenant resolution

Instead:

- restaurant uses `draft_orders`
- appointments uses employees and scheduled windows
- service-business uses quotations, invoices, and subscriptions

### 7.2 Public Route Strategy

Reuse the existing public pattern already used by storefront:

- tenant resolution by slug
- public config endpoints
- public availability/menu endpoints
- public create action endpoints

Recommended public surfaces:

- `/menu/:token`
- `/book/:tenantSlug`

### 7.3 Realtime Strategy

For v1, prefer:

- database-backed state
- short polling
- deterministic event tables

Do not make websockets a Phase 4 blocker.

### 7.4 Auditability

Every policy-driven or customer-visible phase 4 mutation must produce machine-readable audit records.

Required audit capture:

- actor
- target entity
- action
- outlet
- status change
- timestamp
- metadata payload

### 7.5 Permissions

Phase 4 should reuse current permission style instead of inventing a second permission framework.

Recommended new permission areas:

- `manage_restaurant`
- `manage_kds`
- `manage_bookings`
- `manage_projects`
- `manage_contracts`

---

## 8. Feature Flags

Add these flags to the feature-flag registry:

- `phase4_restaurant`
- `phase4_restaurant_qr`
- `phase4_restaurant_kds`
- `phase4_restaurant_preauth`
- `phase4_appointments`
- `phase4_appointments_waitlists`
- `phase4_appointments_classes`
- `phase4_google_calendar_sync`
- `phase4_service_projects`
- `phase4_service_contracts`
- `phase4_contract_ai`

Flag intent:

- core vertical surfaces stay dark until complete enough for internal use
- expansion items remain independently activatable
- provider-gated features are clearly distinguishable from buildable core features

---

## 9. Frontend Surface Recommendation

Add these operator routes:

- `/restaurant/floor`
- `/restaurant/checks`
- `/kds`
- `/kiosk`
- `/appointments/services`
- `/appointments/calendar`
- `/appointments/bookings`
- `/projects`
- `/contracts`

Add these public routes:

- `/menu/:token`
- `/book/:tenantSlug`

### 9.1 UI Direction

The new vertical surfaces should follow the existing redesign patterns and route registration approach already used in:

- POS
- Fulfillment
- Scheduling
- Customer Invoices
- Subscriptions

That means:

- keep the current shell and permission-guard patterns
- add new pages through `appRoutes.jsx`
- add nav entries through `nav-config.js`
- keep feature-flag gating at both route and page level

---

## 10. Acceptance Criteria

Phase 4 design is satisfied when implementation can deliver all of the following without requiring a second planning pass:

- Restaurant can manage tables, sessions, seats, tabs, kitchen routing, and quick-service checkout using the existing POS foundations.
- Appointment booking can expose staff-linked public availability and create appointments without double-booking.
- Service-business workflows can move from estimate to project to milestone billing using existing billing foundations.
- Public ordering and public booking both reuse the repo’s current tenant-aware public routing model.
- Provider-gated features degrade safely when provider capability is missing.

---

## 11. Final Recommendation

The best Phase 4 path for this repo is:

1. extend `draft_orders` into restaurant-aware order context
2. extend scheduling into booking-aware availability
3. extend quotations, invoices, and subscriptions into a project-based service workspace

This is the lowest-risk and highest-leverage approach because it builds new verticals from systems the repo already has instead of creating isolated sub-products that would later need to be merged back into the platform.

Phase 4 should therefore ship as:

- `Phase 4A1` restaurant MVP
- `Phase 4A2` restaurant expansion
- `Phase 4B1` booking MVP
- `Phase 4B2` booking expansion
- `Phase 4C1` service workspace MVP
- `Phase 4C2` contract expansion

That keeps the roadmap aligned with Square-class product breadth while staying realistic for the current SanoPOS architecture.

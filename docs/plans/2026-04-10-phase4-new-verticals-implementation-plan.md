# Phase 4 New Verticals Implementation Plan

**Date:** 2026-04-10  
**Audience:** Implementation engineers, future agents, reviewers  
**Status:** Execution plan aligned to the current repo state after Phase 1 through Phase 3 foundations  
**Companion design doc:** `docs/plans/2026-04-10-phase4-new-verticals-design.md`

---

## 1. Summary

This plan turns the Phase 4 new-verticals design into an implementation sequence against the current SanoPOS codebase.

Phase 4 includes:

- restaurant mode
- appointment booking
- service-business workspace

This plan intentionally **extends existing systems** instead of introducing parallel engines.

Recommended delivery sequence:

- `Phase 4A` Restaurant Mode
- `Phase 4B` Appointment Booking
- `Phase 4C` Service-Business Workspace

Recommended internal cuts:

- `4A1` floor, checks, seats, tabs, coursing, KDS, quick-service
- `4A2` QR, kiosk, kitchen analytics, recipe costing, waste, provider-gated preauth
- `4B1` service catalog, availability, calendar, public booking, reminders
- `4B2` waitlists, resources, classes, multi-service, Google Calendar sync, no-show charge hooks
- `4C1` projects, estimate approval, milestone billing, recurring service billing
- `4C2` contracts, signature capture, AI clause assist

---

## 2. Implementation Principles

- Reuse existing repo primitives before adding new abstractions.
- Keep all Phase 4 work feature-flagged until each workstream is stable.
- Use additive migrations only.
- Do not create a second order engine, second staffing system, second invoice engine, or second recurring-billing engine.
- Prefer DB-backed event state and polling for v1 realtime surfaces.
- Make each vertical independently testable before moving to the next one.

---

## 3. Public Interfaces And Data Contracts

These are the required new or changed interfaces for Phase 4.

### Restaurant

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

### Appointments

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

### Service Workspace

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

---

## 4. Schema And Migration Sequence

Target migration sequence after current `v21`:

- `v22` Restaurant schema and order-context extensions
- `v23` Appointment-booking schema
- `v24` Service-workspace schema and billing-link extensions

### 4.1 Migration v22 — Restaurant Foundations

Modify:

- `backend/schema-pg.sql`
- `backend/migrate-pg.js`
- `backend/middleware/feature-flags.js`

Add these tables:

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

Seed flags:

- `phase4_restaurant`
- `phase4_restaurant_qr`
- `phase4_restaurant_kds`
- `phase4_restaurant_preauth`

### 4.2 Migration v23 — Appointment Foundations

Modify:

- `backend/schema-pg.sql`
- `backend/migrate-pg.js`
- `backend/middleware/feature-flags.js`

Add:

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

Seed flags:

- `phase4_appointments`
- `phase4_appointments_waitlists`
- `phase4_appointments_classes`
- `phase4_google_calendar_sync`

### 4.3 Migration v24 — Service Workspace Foundations

Modify:

- `backend/schema-pg.sql`
- `backend/migrate-pg.js`
- `backend/middleware/feature-flags.js`

Add:

- `service_projects`
- `project_contacts`
- `project_milestones`
- `project_activities`
- `contract_templates`
- `contracts`
- `contract_signers`
- `contract_events`
- `project_files`

Extend:

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

Seed flags:

- `phase4_service_projects`
- `phase4_service_contracts`
- `phase4_contract_ai`

---

## 5. Shared Foundations Before Vertical Work

## Task 1: Shared Phase 4 Foundations

**Goal:** Add migration scaffolding, flags, route stubs, nav placeholders, and common helpers before building any vertical.

**Files:**

- Modify: `backend/schema-pg.sql`
- Modify: `backend/migrate-pg.js`
- Modify: `backend/middleware/feature-flags.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`
- Create: `backend/services/phase4-polling.js`
- Create: `backend/services/public-tenant-context.js` if current storefront resolver cannot be cleanly reused

### Required outcomes

- route registration order is ready for new modules
- feature flags exist for all Phase 4 domains
- public tenant resolution is reusable for restaurant QR and public booking
- a shared helper exists for DB-backed "recent changes since timestamp" polling patterns

### Done criteria

- migrations can be added cleanly without route implementation yet
- frontend routes can be added behind flags without breaking build

---

## 6. Phase 4A — Restaurant Mode

## Task 2: Restaurant Domain Services

**Goal:** Introduce the restaurant service layer before routes and UI.

**Files:**

- Create: `backend/services/restaurant-floor.js`
- Create: `backend/services/restaurant-checks.js`
- Create: `backend/services/restaurant-kds.js`
- Create: `backend/services/restaurant-qr.js`
- Create: `backend/schemas/restaurant.js`

### Required service responsibilities

- floor-plan CRUD and table layout normalization
- table-session lifecycle
- draft-order restaurant context attachment
- seat assignment and seat transfer
- split-check computation using explicit adjustment rows
- course hold/fire handling
- KDS ticket creation, routing, and bump behavior
- QR token validation and public check creation/update

### Important implementation notes

- split-check logic must preserve tax, discount, service charge, and gratuity math
- KDS service must support station role routing:
  - `prep`
  - `expo`
- `restaurant_preauth_holds` schema should be usable but charge-hold execution remains provider-gated

## Task 3: Restaurant Backend Routes

**Files:**

- Create: `backend/routes/restaurant.js`
- Create: `backend/routes/kds.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: `backend/routes/draft-orders.js`
- Modify: `backend/routes/approval-policies.js` if restaurant exception hooks are needed

### Route requirements

- floor-plan routes
- table routes
- table-session routes
- check routes
- split route
- send-to-kitchen route
- course-fire route
- KDS station and ticket routes

### Integration rules

- checks must remain based on `draft_orders`
- restaurant routes must not bypass current auth/perm patterns
- mutation routes must log to `action_history`
- outlet scoping must be explicit on all restaurant data

## Task 4: POS And Check Completion Integration

**Files:**

- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`
- Modify: restaurant-specific POS pages to be added
- Modify: `backend/routes/sales.js` only as needed for restaurant completion metadata
- Modify: `backend/routes/customer-display.js` only if restaurant customer view uses the same endpoint family

### Required behavior

- POS can start a restaurant check against a table or tab
- POS can resume a restaurant draft order
- POS can send selected items or courses to kitchen
- POS can complete a restaurant check into finalized sale(s)
- quick-service mode can skip table/session workflow

## Task 5: Restaurant Frontend Surfaces

**Files:**

- Create: `frontend/src/pages/redesign/RestaurantFloorRedesign.jsx`
- Create: `frontend/src/pages/redesign/RestaurantChecksRedesign.jsx`
- Create: `frontend/src/pages/redesign/KDSRedesign.jsx`
- Create: `frontend/src/pages/redesign/KioskRedesign.jsx`
- Create route wrappers under `frontend/src/pages/`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

### UI requirements

- floor plan board with sections and occupancy state
- table detail drawer with session, covers, elapsed time, and assigned server
- check editor with seats, courses, hold/fire, split tools
- KDS station page with timers and station filters
- quick-service variant of checkout
- kiosk surface for self-ordering

## Task 6: QR Ordering Public Surface

**Files:**

- Extend or reuse storefront public routing modules
- Create: public restaurant menu page component(s)
- Create QR token management service and route hooks

### Required behavior

- QR token resolves tenant + outlet + table context
- public menu respects published restaurant menu visibility
- guest can add items to a table/session-bound draft order
- kitchen receives routed tickets after confirmed public submission

## Task 7: Restaurant Tests

**Files:**

- Create integration tests under `backend/tests/integration/`
- Add frontend or E2E coverage for restaurant MVP flow

### Minimum test scenarios

- table session creation and close
- seat assignment and transfer
- split by item
- split by seat
- course fire lifecycle
- prep/expo KDS routing
- QR ordering to kitchen flow
- quick-service checkout
- provider-gated preauth disabled behavior

### Phase 4A done criteria

- restaurant floor, check, and KDS flows work without creating a second order engine
- public QR flow is tenant-safe
- all restaurant mutations are audited

---

## 7. Phase 4B — Appointment Booking

## Task 8: Booking Domain Services

**Files:**

- Create: `backend/services/booking-services.js`
- Create: `backend/services/booking-availability.js`
- Create: `backend/services/booking-reminders.js`
- Create: `backend/schemas/bookings.js`

### Required service responsibilities

- service catalog CRUD
- staff assignment resolution
- availability search
- overlap detection
- appointment creation, reschedule, cancel
- reminder scheduling
- waitlist enqueue and promotion scaffolding
- resource reservation scaffolding

### Availability engine rules

- build availability from:
  - service duration and padding
  - outlet and service availability rules
  - employee assignment
  - existing appointments
  - appointment blocks
  - optional scheduled-shift overlays

### Important implementation note

- public booking must always use search-availability-first behavior

## Task 9: Booking Backend Routes

**Files:**

- Create: `backend/routes/bookings.js`
- Create: `backend/routes/public-bookings.js`
- Modify: `backend/routes/registerAllRoutes.js`
- Modify: reminder worker registration if a dedicated booking reminder queue is needed

### Route groups

- booking service admin routes
- appointment admin routes
- waitlist routes
- public booking config, availability, and create routes

### Required behavior

- admin appointment create and edit
- public appointment create
- cancel and reschedule
- reminder scheduling
- tenant-safe public access

## Task 10: Booking Frontend Surfaces

**Files:**

- Create: `frontend/src/pages/redesign/AppointmentServicesRedesign.jsx`
- Create: `frontend/src/pages/redesign/AppointmentsCalendarRedesign.jsx`
- Create: `frontend/src/pages/redesign/AppointmentsRedesign.jsx`
- Create route wrappers in `frontend/src/pages/`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`
- Create public booking page component(s)

### UI requirements

- services management page
- admin booking calendar
- appointment detail and lifecycle tools
- public booking page with service selection, staff selection, slot selection, and confirmation

## Task 11: Booking Expansion Hooks

**Files:**

- Extend the booking domain and UI behind flags

### Features to wire behind flags now

- waitlists
- resources
- classes
- multi-service appointments
- Google Calendar sync account models

### Implementation rule

- these hooks may land with partial UI, but core 4B1 should not depend on them

## Task 12: Booking Tests

### Minimum test scenarios

- availability search excludes blocked or occupied slots
- overlapping appointments are rejected
- reschedule updates availability correctly
- reminders are scheduled once
- public booking is tenant-safe
- waitlist promotion is idempotent
- class capacity is enforced
- Google Calendar sync disabled behavior is clear when flag or credentials are absent

### Phase 4B done criteria

- staff-linked availability and public booking work safely
- reminders and cancellation windows operate without external dependencies
- expansion features are gated and non-blocking

---

## 8. Phase 4C — Service-Business Workspace

## Task 13: Service Workspace Domain Services

**Files:**

- Create: `backend/services/projects.js`
- Create: `backend/services/contracts.js`
- Create: `backend/services/project-billing.js`
- Create: `backend/schemas/projects.js`
- Create: `backend/schemas/contracts.js`

### Required service responsibilities

- project CRUD and activity logging
- estimate approval on top of quotations
- quotation-to-project conversion
- milestone creation and billing linkage
- project-linked invoice attachment
- project-linked subscription linkage
- contract generation from templates
- signature capture and audit trail

### Important implementation rules

- `quotations` remain the estimate model
- `customer_invoices` remain the invoice model
- `customer_subscriptions` remain the recurring-billing model
- do not build a separate billing scheduler for service projects

## Task 14: Service Workspace Backend Routes

**Files:**

- Create: `backend/routes/projects.js`
- Create: `backend/routes/contracts.js`
- Modify: `backend/routes/tier4/crm.js`
- Modify: `backend/routes/customer-invoices.js`
- Modify: `backend/routes/subscriptions.js`
- Modify: `backend/routes/registerAllRoutes.js`

### Required route behavior

- project create/read/update
- milestone create/update
- quotation approval
- quotation to project conversion
- invoice attachment to project/milestone
- contract create/update/send/sign

## Task 15: Service Workspace Frontend Surfaces

**Files:**

- Create: `frontend/src/pages/redesign/ProjectsRedesign.jsx`
- Create: `frontend/src/pages/redesign/ContractsRedesign.jsx`
- Create route wrappers in `frontend/src/pages/`
- Modify: `frontend/src/pages/redesign/QuotationsRedesign.jsx`
- Modify: `frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx`
- Modify: `frontend/src/pages/redesign/SubscriptionsRedesign.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`
- Modify: `frontend/src/ui/Breadcrumbs.jsx`

### UI requirements

- projects list and detail workspace
- milestones panel
- linked estimates, invoices, and recurring billing panel
- contracts list and signer state
- quotation approval entry point

## Task 16: Contract Expansion Hooks

### Features to gate behind flags

- AI clause assistant
- advanced signer workflows
- richer document generation helpers

### Implementation rule

- AI clause generation must be opt-in and append or suggest content only

## Task 17: Service Workspace Tests

### Minimum test scenarios

- quotation approval changes estimate state correctly
- quotation converts to project safely
- milestone invoice generation links to project and milestone
- recurring service billing reuses existing subscription invoice fallback
- contract send and sign are audited
- contract AI flag disabled behavior is safe and explicit

### Phase 4C done criteria

- service-business workflow works from estimate to project to billed work
- contracts are captured and auditable
- no duplicate financial engine was introduced

---

## 9. Frontend Route And Navigation Work

These routes must be added as part of implementation:

- `/restaurant/floor`
- `/restaurant/checks`
- `/kds`
- `/kiosk`
- `/appointments/services`
- `/appointments/calendar`
- `/appointments/bookings`
- `/projects`
- `/contracts`

Public surfaces:

- `/menu/:token`
- `/book/:tenantSlug`

Implementation rules:

- add routes to `appRoutes.jsx`
- add nav items to `nav-config.js`
- add breadcrumb labels to `Breadcrumbs.jsx`
- gate routes by both permission and feature flag

---

## 10. Permissions, Audit Logging, And Notifications

## Task 18: Permissions And Audit

**Files:**

- Modify: `backend/middleware/permissions.js`
- Modify: all new Phase 4 routes
- Modify: `frontend` route wrappers if needed for new permission checks

### New permission areas

- `manage_restaurant`
- `manage_kds`
- `manage_bookings`
- `manage_projects`
- `manage_contracts`

### Minimum audit events

- restaurant:
  - `restaurant_session_opened`
  - `restaurant_check_split`
  - `restaurant_course_fired`
  - `kds_ticket_bumped`
- bookings:
  - `appointment_created`
  - `appointment_rescheduled`
  - `appointment_cancelled`
  - `waitlist_promoted`
- projects/contracts:
  - `project_created`
  - `estimate_approved`
  - `milestone_created`
  - `contract_sent`
  - `contract_signed`

## Task 19: Notifications

**Files:**

- Modify or extend current notification and worker flows

### Required notifications

- table/session alerts as needed for internal views
- booking reminders
- booking status changes
- project milestone reminders
- contract signature prompts

---

## 11. Documentation Updates

## Task 20: Repo Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `backend/CLAUDE.md`
- Modify: `frontend/CLAUDE.md`

### Required updates

- new migrations `v22`, `v23`, `v24`
- new feature flags
- new routes
- new frontend pages
- new service modules
- updated route tree and domain summary

---

## 12. Test Plan Summary

### Restaurant

- floor plan CRUD
- table occupancy state changes
- seat assignment and seat transfer
- split by item
- split by seat
- service charge and discount preservation after split
- hold and fire by course
- KDS prep routing
- KDS expo routing
- QR order to table/session
- quick-service completion
- preauth disabled behavior

### Appointments

- service catalog CRUD
- availability search
- double-book prevention
- public booking create
- admin booking create
- reschedule
- cancel
- reminder scheduling
- waitlist promotion
- class capacity

### Service Workspace

- project CRUD
- quotation approval
- quotation to project conversion
- milestone creation
- milestone invoice linkage
- recurring service billing reuse of existing subscription flow
- contract send/sign audit trail
- AI clause flag disabled behavior

### Cross-Cutting

- feature-flag gating
- permission enforcement
- audit logging
- tenant isolation for public routes
- polling-based freshness behavior

---

## 13. Execution Order Summary

| Task Group | Phase | Depends On |
|---|---|---|
| Shared foundations + v22/v23/v24 scaffolding | All | — |
| Restaurant services + routes | 4A | Shared foundations |
| Restaurant frontend + QR + tests | 4A | Restaurant backend |
| Booking services + routes | 4B | Shared foundations, 4A stable |
| Booking frontend + public flow + tests | 4B | Booking backend |
| Projects/contracts services + routes | 4C | Shared foundations, 4B stable |
| Projects/contracts frontend + tests | 4C | Service backend |
| Permissions, audit, notifications, docs | All | Parallel after each domain starts |

Strict sequencing rule:

- do not begin 4B feature work before 4A acceptance criteria are met
- do not begin 4C feature work before 4B acceptance criteria are met

---

## 14. Final Recommendation

Implement Phase 4 as a layered extension of existing SanoPOS systems in this order:

1. restaurant-aware order context on top of `draft_orders`
2. booking-aware availability on top of employee and scheduling foundations
3. project-aware service workflows on top of quotations, invoices, and subscriptions

That path keeps the implementation aligned with the repo’s strongest existing architecture, closes the biggest remaining competitive gaps, and avoids long-term fragmentation of the platform.

# SanoPOS Phase Branch Interconnection Map

**Phase range:** `b1b2763^..35f9874` (Phases 1–5, ~68 commits)
**Fix-signal range:** `35f9874..a134250` (30 fix commits, signals only)
**Generated:** 2026-04-11

---

## 1. Migration Dependency Chain

### v18 — Omnichannel (Phase 1)

**Tables created:** `sales_channels`, `channel_publications`, `inventory_reservations`, `web_order_allocations`, `customer_addresses`, `storefront_carts`, `storefront_cart_items`

**Columns added to pre-existing tables:**
- `web_orders`: `channel_id`, `delivery_method`, `pickup_outlet_id`, `fulfillment_outlet_id`, `customer_name_snapshot`, `customer_phone_snapshot`, `customer_email_snapshot`, `shipping_address_json`, `pickup_ready_at`, `picked_up_at`, `curbside_arrived_at`, `public_order_token` (11 new columns on a pre-existing table — **cross-seam point**)
- `returns`: `web_order_id` (pre-existing table — **cross-seam point**)
- `picklist_items`: `allocation_id` column added conditionally (table existed from v16, column was absent) — FK to `web_order_allocations` added in same migration AFTER table creation

**Critical FK ordering issue (confirmed fixed by `116863c`):** v16 created `picklist_items` without `allocation_id`. v18 adds `allocation_id` and then the FK to `web_order_allocations` in the same migration. The v16 inline DDL in `schema-pg.sql` (static snapshot) included `allocation_id INTEGER REFERENCES web_order_allocations(id)` even though `web_order_allocations` is only created in v18 — this makes fresh schema installs from `schema-pg.sql` fail if run against an empty DB that hasn't applied migrations in order. The migration adds the column + FK conditionally via `DO $$ ... END $$` blocks which is correct, but `schema-pg.sql` (the base) has the FK baked in, creating a dual-source-of-truth risk.

**FKs referencing earlier migrations:**
- `channel_publications.channel_id → sales_channels.id` (same v18) — safe
- `inventory_reservations.web_order_id → web_orders.id` (pre-v1) — safe
- `web_order_allocations.web_order_item_id → web_order_items.id` (pre-v1) — safe
- `storefront_carts.channel_id → sales_channels.id` (same v18) — safe
- `returns.web_order_id → web_orders.id` (pre-v1) — safe

**Backfill:** v18 attempts `UPDATE web_orders SET channel_id = sc.id FROM sales_channels sc WHERE wo.source = sc.code` — wrapped in try/catch because `source` column may not exist in all schemas.

---

### v19 — Phase 2A (scheduling, pricing, draft orders, approval policies, return policies)

**Tables created:** `scheduled_shifts`, `price_list_assignments`, `draft_orders`, `draft_order_items`, `approval_policies`, `approval_events`, `return_policies`, `return_reasons`

**Columns added to pre-existing tables:**
- `outlets`: `latitude`, `longitude`, `geofence_radius_meters` (pre-existing — **cross-seam point**)
- `leave_requests`: `partial_day`, `start_time`, `end_time`, `schedule_impact_status` (pre-existing HR table — **cross-seam point**; bug `73b1d0a` was a date-cast issue in shift join queries touching this seam)
- `returns`: `policy_id`, `policy_result`, `approval_event_id`, `processed_by_employee_id`, `approved_by_employee_id`, `return_reason_id` (second extension of `returns` across phases — **multi-phase cross-seam point**)

**FKs referencing v16 tables:**
- `price_list_assignments.price_list_id → price_lists.id` (v16) — safe, v16 applied first
- `return_policies` → no external FKs; `returns.policy_id → return_policies.id` (same v19) — safe
- `approval_events.policy_id → approval_policies.id` (same v19) — safe

**Feature flag gap (confirmed fixed by `d71b2b1`):** v19 and v20 created all Phase 2 tables but did NOT seed the 13 `phase2_*` feature flags into the `feature_flags` table. The flags existed only in `DEFAULT_FEATURE_FLAGS` in `feature-flags.js`. Any DB-level query against the `feature_flags` table for these keys returned nothing, so the `getFeatureFlagsMap` merge would use the JS default (all `false`). This meant no Phase 2 feature could be enabled from the admin panel until v26 was applied.

---

### v20 — Phase 2B (smart collections, outlet tax, commissions, report builder, POS layouts)

**Tables created:** `smart_collections`, `smart_collection_rules`, `outlet_product_visibility`, `outlet_tax_profiles`, `outlet_tax_profile_lines`, `scheduled_catalog_changes`, `commission_plans`, `commission_plan_rules`, `commission_earnings`, `custom_report_definitions`, `custom_report_widgets`, `pos_layouts`, `product_affinities`

**Columns added to pre-existing tables:**
- `employees`: `commission_plan_id INTEGER REFERENCES commission_plans(id)` (pre-existing table — **cross-seam point**)

**FKs referencing earlier phase tables:**
- `outlet_tax_profile_lines.profile_id → outlet_tax_profiles.id` (same v20) — safe
- `outlet_tax_profile_lines.category_id → categories.id` (pre-v1) — safe
- `outlet_tax_profile_lines.tax_id → taxes.id` (pre-v1) — safe
- `commission_earnings.sale_id → sales.id` (pre-v1) — safe
- `commission_earnings.plan_id → commission_plans.id` (same v20) — safe

**No feature flags seeded** — part of the v26 gap.

---

### v21 — Phase 3 (marketing, messaging, customer invoicing, subscriptions)

**Tables created:** `marketing_templates`, `marketing_campaigns`, `marketing_campaign_audiences`, `marketing_campaign_deliveries`, `message_threads`, `message_entries`, `customer_invoices`, `customer_invoice_items`, `customer_invoice_payments`, `customer_invoice_payment_links`, `customer_invoice_reminders`, `subscription_plans`, `customer_subscriptions`, `subscription_runs`

**Columns added to pre-existing tables:**
- `customers`: `email_consent`, `sms_consent`, `whatsapp_consent` (third wave of extensions to `customers` across v16, v21 — **multi-phase cross-seam point**)
- `quotations`: `converted_invoice_id` (pre-existing tier4 table — **cross-seam point**; `quotations` also touched by v24)

**FKs referencing earlier phase tables:**
- `customer_invoices.quotation_id → quotations.id` (pre-existing tier4) — safe
- `customer_subscriptions.plan_id → subscription_plans.id` (same v21) — safe
- `subscription_runs.invoice_id → customer_invoices.id` (same v21) — safe

**Feature flags seeded in v21:** `marketing_campaigns`, `customer_messaging`, `customer_invoicing`, `payment_links`, `subscription_billing`, `sms_campaigns`, `subscription_autocharge` — 7 flags. These were correctly registered in both the migration and `DEFAULT_FEATURE_FLAGS`.

---

### v22 — Phase 4A (restaurant mode + draft_orders context extension)

**Tables created:** `restaurant_floor_plans`, `restaurant_floor_sections`, `restaurant_tables`, `restaurant_table_sessions`, `restaurant_check_seats`, `restaurant_check_adjustments`, `restaurant_course_fires`, `restaurant_tabs`, `restaurant_preauth_holds`, `kds_stations`, `kds_station_routes`, `kds_tickets`, `kds_ticket_events`

**Columns added to pre-existing tables (Phase 2 tables):**
- `draft_orders`: `order_context`, `table_id`, `table_session_id`, `tab_id`, `seat_count`, `dining_option`, `source_token_id` — **7 columns added to a Phase 2 table from a Phase 4 migration** (critical cross-phase seam — see Section 6)
- `draft_order_items`: `seat_number`, `course_name`, `kitchen_status` — **3 columns added to Phase 2 table from Phase 4 migration**

**FKs:**
- `restaurant_check_seats.draft_order_id → draft_orders.id` (v19) — requires v19 to have run; safe in linear migration order
- `kds_tickets.draft_order_id → draft_orders.id` (v19) — same
- `draft_orders.table_id → restaurant_tables.id` (same v22) — FK added after `restaurant_tables` creation; safe
- `draft_orders.table_session_id → restaurant_table_sessions.id` (same v22) — safe

**Feature flags seeded:** `phase4_restaurant`, `phase4_restaurant_qr`, `phase4_restaurant_kds`, `phase4_restaurant_preauth` — all correctly registered in both migration and DEFAULT_FEATURE_FLAGS.

---

### v23 — Phase 4B (appointment booking)

**Tables created:** `booking_services`, `booking_service_variants`, `booking_staff_assignments`, `booking_resources`, `booking_resource_assignments`, `booking_availability_rules`, `appointment_blocks`, `appointments`, `appointment_segments`, `appointment_reminders`, `appointment_waitlist_entries`, `class_sessions`, `class_session_bookings`, `calendar_sync_accounts`

**No columns added to pre-existing tables** — this migration is self-contained.

**FKs referencing pre-existing tables only** (`employees`, `outlets`, `customers`) — all safe.

**Feature flags seeded:** `phase4_appointments`, `phase4_appointments_waitlists`, `phase4_appointments_classes`, `phase4_google_calendar_sync` — correctly registered.

---

### v24 — Phase 4C (service workspace)

**Tables created:** `service_projects`, `project_contacts`, `project_milestones`, `project_activities`, `contract_templates`, `contracts`, `contract_signers`, `contract_events`, `project_files`

**Columns added to pre-existing Phase 3 tables:**
- `quotations`: `project_id`, `estimate_status`, `approved_at`, `approved_by` — **second extension of `quotations`, first was v21** (**cross-phase seam**)
- `customer_invoices`: `project_id`, `milestone_id`, `invoice_kind` — **second extension of `customer_invoices`, first was v21** (**cross-phase seam**)
- `customer_subscriptions`: `project_id`, `billing_template_id` — **second extension of `customer_subscriptions`, first was v21** (**cross-phase seam**)

**FKs referencing v21 tables:**
- `customer_invoices.project_id → service_projects.id` (same v24) — safe
- `customer_invoices.milestone_id → project_milestones.id` (same v24) — safe
- `customer_subscriptions.project_id → service_projects.id` (same v24) — safe

**Feature flags seeded:** `phase4_service_projects`, `phase4_service_contracts`, `phase4_contract_ai` — correctly registered.

---

### v25 — Phase 5 (Pakistan shipping, COD, payment expansion, SMS)

**Tables created:** `order_shipments`, `shipment_tracking_events`, `cod_settlement_batches`, `cod_settlement_lines`, `payment_webhook_events`, `storefront_payment_sessions`, `sms_provider_messages`

**Columns added to pre-existing tables (multiple phases):**
- `courier_integrations` (pre-v1, extended in v5 and v17): adds `supports_booking`, `supports_tracking`, `supports_cancellation`, `supports_labels`, `provider_category`, `flat_shipping_rate`, `encrypted_config_json`, `last_healthcheck_at`, `last_healthcheck_status` — **third extension of `courier_integrations`** (**multi-phase cross-seam point**)
- `web_orders` (pre-v1, extended in v5 and v18): adds `active_shipment_id`, `shipping_provider_status` — **third extension of `web_orders`** (**multi-phase cross-seam point**)
- `loadsheets` (v16): adds `reconciliation_status`, `reconciled_at`, `reconciled_by`, `expected_cod`, `received_cod`, `cod_difference` — **cross-phase extension**
- `payment_intents` (public schema, v11): adds `provider`, `provider_status`, `last_event_at` — **cross-phase extension**
- `customer_invoice_payment_links` (v21): adds `provider`, `completed_at`, `raw_completion_payload` — **cross-phase extension of Phase 3 table**
- `web_order_transactions` (pre-v1): adds `provider_ref`, `payment_context`, `webhook_event_id` — **cross-phase extension**

**Feature flags seeded:** `phase5_shipping_automation`, `phase5_cod_reconciliation`, `phase5_payment_gateways`, `phase5_sms_providers` — correctly registered.

---

### v26 — Backfill Fix (between phases, Range B)

Adds 13 missing Phase 2 feature flags to the `feature_flags` table. This migration exists because v19 and v20 never seeded them. Any tenant that applied v19+v20 before v26 had these flags in `DEFAULT_FEATURE_FLAGS` (JS defaults, all `false`) but not in the DB, making them impossible to enable via admin panel until v26.

---

## 2. Shared-File Touch Map

### `backend/schema-pg.sql`

- **Phase 1 (v18):** Added `sales_channels`, `channel_publications`, `inventory_reservations`, `web_order_allocations`, `customer_addresses`, `storefront_carts`, `storefront_cart_items`; extended `web_orders`, `returns`; added `allocation_id` FK to `picklist_items` (the static snapshot bakes in this FK which depends on v18 being run)
- **Phase 2 (v19, v20):** Added `scheduled_shifts`, `draft_orders`, `draft_order_items`, `approval_policies`, `return_policies`, `smart_collections`, `commission_plans`, `pos_layouts`, etc.; extended `outlets`, `leave_requests`, `returns`, `employees`
- **Phase 3 (v21):** Added 14 marketing/messaging/invoicing/subscription tables; extended `customers`, `quotations`
- **Phase 4 (v22, v23, v24):** Added 27 restaurant/KDS/booking/workspace tables; extended `draft_orders`, `draft_order_items`, `quotations`, `customer_invoices`, `customer_subscriptions`
- **Phase 5 (v25):** Added 7 tables; extended `courier_integrations`, `web_orders`, `loadsheets`, `payment_intents`, `customer_invoice_payment_links`, `web_order_transactions`

The `schema-pg.sql` file is a STATIC SNAPSHOT that must stay in sync with migrations. Any new column in a migration that is not reflected in the schema-pg.sql creates divergence for fresh installs. The `allocation_id FK` issue in v16/v18 is the canonical example of this drift.

### `backend/routes/registerAllRoutes.js`

- **Phase 1:** Added `storefront`, `public-restaurant`, `public-bookings` mounts (public, before auth middleware)
- **Phase 2:** Added `return-policies`, `price-lists`, `price-list-assignments`, `draft-orders`, `smart-collections`, `outlet-tax-profiles`, `commissions`, `report-builder`, `pos-layouts`, `schedules`, `approval-policies`, `outlet-visibility`, `scheduled-changes`, `item-suggestions`
- **Phase 3:** Added `marketing`, `messaging`, `customer-invoices`, `subscriptions`
- **Phase 4:** Added `restaurant`, `kds`, `bookings`, `projects`, `contracts`
- **Phase 5:** No new route file mounts in registerAllRoutes (Phase 5 extended `couriers.js` and `fulfillment.js` in place)

The critical issue here is that public routes (storefront, public-restaurant, public-bookings) are mounted before `loadTenantAndPerms`. They resolve tenant context manually via `resolvePublicTenantDb`. Any authenticated route mistakenly placed in these files would bypass auth.

### `backend/middleware/feature-flags.js`

- **Pre-phase (existing):** Defined `DEFAULT_FEATURE_FLAGS` with pre-existing flags
- **Phase 2:** Added 13 `phase2_*` keys to `DEFAULT_FEATURE_FLAGS` (in code) — but NO corresponding migration seeds (gap fixed by v26)
- **Phase 3:** Added `marketing_campaigns`, `customer_messaging`, `customer_invoicing`, `payment_links`, `subscription_billing`, `sms_campaigns`, `subscription_autocharge` to `DEFAULT_FEATURE_FLAGS` — correctly backed by v21 seeds
- **Phase 4:** Added 11 `phase4_*` keys to `DEFAULT_FEATURE_FLAGS` — correctly backed by v22/v23/v24 seeds
- **Phase 5:** Added 4 `phase5_*` keys to `DEFAULT_FEATURE_FLAGS` — correctly backed by v25 seeds

### `backend/middleware/permissions.js`

- **Phase 4 only:** Added `manage_restaurant`, `manage_kds`, `manage_bookings`, `manage_projects`, `manage_contracts` to `DEFAULT_ROLE_PERMISSIONS` (Manager role) and added `PERMISSION_RULES` entries for `/api/restaurant`, `/api/kds`, `/api/booking-services`, `/api/appointments`, `/api/projects`, `/api/contracts`
- **No other phases touched this file** — Phases 1, 2, 3, 5 relied on existing permissions (`manage_orders`, `manage_inventory`, `all_access`)

### `backend/boot/workers.js`

- **Phase 1:** Added `RESERVATION_WORKER_ENABLED` block — registers `registerReservationWorker` from `workers/reservation-worker-boss.js`
- **Phase 2:** Added `SCHEDULED_CATALOG_WORKER_ENABLED` block — inline `setInterval` for catalog changes, sets `global.__catalogSchedulerStatus`
- **No other phases touched boot/workers.js** — Phase 3 worker additions (campaign-email, invoice-reminder, subscription-renewal) were added inside `email-worker-boss.js` as additional `boss.work()` registrations, not as new entries in `boot/workers.js`

### `backend/workers/email-worker-boss.js`

- **Pre-phase (existing):** Had `email` and `billing-lifecycle-check` queues
- **Phase 3:** Added `campaign-email`, `campaign-scheduled-send`, `invoice-reminder`, `subscription-renewal` queues — all `createQueue` calls and `boss.work` registrations added to the same `registerEmailWorker` function. The Phase 3 worker additions are NOT separately env-gated; they start whenever `EMAIL_WORKER_ENABLED=1`

### `backend/routes/couriers.js`

- **Pre-phase (existing):** Full courier CRUD and dispatch
- **Phase 5:** Added `requireFeature("phase5_shipping_automation")` gates on booking, tracking, cancellation, and label routes. Extended courier adapter usage with new fields from `encrypted_config_json`

### `frontend/src/ui/nav-config.js`

- **Phase 1:** Added "Online Store" group with `__STOREFRONT__` special path
- **Phase 2:** Added "Price Lists", "Smart Collections", "Scheduled Changes", "Return Policies", "Outlet Tax Profiles", "POS Layouts", "Scheduling", "Commissions", "Report Builder"
- **Phase 3:** Added "Marketing & Billing" group with "Campaigns", "Inbox", "Customer Invoices", "Subscriptions"
- **Phase 4:** Added "Restaurant" group (Floor Plan, Checks, KDS), "Appointments" group (Services, Calendar, Bookings), "Service Work" group (Projects, Contracts)
- **Phase 5:** Added "COD Settlements" to Commerce group with `requiredFlag: "phase5_cod_reconciliation"`

### `frontend/src/routes/appRoutes.jsx`

- **Phase 1:** No direct route additions (storefront is a public route in publicRoutes.jsx)
- **Phase 2:** Added `/price-lists`, `/smart-collections`, `/settings/outlet-tax-profiles`, `/settings/pos-layouts`, `/scheduled-changes`, `/commissions`, `/report-builder`, `/scheduling`, `/return-policies`
- **Phase 3:** Added `/marketing/campaigns`, `/messaging/inbox`, `/customer-invoices`, `/subscriptions`
- **Phase 4:** Added `/restaurant/floor`, `/restaurant/checks`, `/kds`, `/kiosk` (KioskOrderingRoute), `/appointments/services`, `/appointments/calendar`, `/appointments/bookings`, `/projects`, `/contracts`
- **Phase 5:** Added `/cod-settlements`

---

## 3. Feature Flag Graph

| Flag | Registering Phase | Migration That Seeds It | Where `requireFeature()` Is Called | Gap? |
|---|---|---|---|---|
| `phase2_scheduling` | Phase 2 (DEFAULT_FEATURE_FLAGS) | v26 (backfill — NOT v19/v20) | `routes/schedules.js` line 4 | YES — registered in JS defaults but not seeded in DB until v26 |
| `phase2_outlet_pricing` | Phase 2 | v26 | `routes/price-list-assignments.js` line 4 | YES — same gap |
| `phase2_draft_orders` | Phase 2 | v26 | `routes/draft-orders.js` line 4 | YES — same gap |
| `phase2_pos_approvals` | Phase 2 | v26 | `routes/approval-policies.js` (4 routes) | YES — same gap |
| `phase2_returns_policy` | Phase 2 | v26 | `routes/return-policies.js` line 4 | YES — same gap |
| `phase2_smart_collections` | Phase 2 | v26 | `routes/smart-collections.js` line 6 | YES — same gap |
| `phase2_outlet_visibility` | Phase 2 | v26 | `routes/outlet-visibility.js` line 3 | YES — same gap |
| `phase2_outlet_tax` | Phase 2 | v26 | `routes/outlet-tax-profiles.js` line 3 | YES — same gap |
| `phase2_scheduled_changes` | Phase 2 | v26 | `routes/scheduled-changes.js` line 3 | YES — same gap |
| `phase2_commissions` | Phase 2 | v26 | `routes/commissions.js` line 6 | YES — same gap |
| `phase2_report_builder` | Phase 2 | v26 | `routes/report-builder.js` line 154 | YES — same gap |
| `phase2_pos_layouts` | Phase 2 | v26 | `routes/pos-layouts.js` line 3 | YES — same gap |
| `phase2_item_suggestions` | Phase 2 | v26 | `routes/item-suggestions.js` line 3 | YES — same gap |
| `marketing_campaigns` | Phase 3 | v21 (correctly) | `routes/marketing.js` line 26 | No |
| `customer_messaging` | Phase 3 | v21 | `routes/messaging.js` line 17 | No |
| `customer_invoicing` | Phase 3 | v21 | `routes/customer-invoices.js` line 32 | No |
| `payment_links` | Phase 3 | v21 | `routes/customer-invoices.js` line 318 (stacked on top of `customer_invoicing` gate) | No |
| `subscription_billing` | Phase 3 | v21 | `routes/subscriptions.js` line 29 | No |
| `sms_campaigns` | Phase 3 | v21 | `routes/integrations/credentials.js` line 96 | No |
| `subscription_autocharge` | Phase 3 | v21 | Not called by any route in the phase work — seeded but not yet consumed | Partial — seeded but no consuming `requireFeature` |
| `phase4_restaurant` | Phase 4 | v22 | `routes/restaurant.js` line 16 | No |
| `phase4_restaurant_qr` | Phase 4 | v22 | `routes/public-restaurant.js` (no `requireFeature` — public endpoint; flag is checked inline as a config query) | Asymmetric — seeded but enforcement is inline |
| `phase4_restaurant_kds` | Phase 4 | v22 | `routes/kds.js` line 8 | No |
| `phase4_restaurant_preauth` | Phase 4 | v22 | Seeded but no `requireFeature` call found in any route | Potential gap |
| `phase4_appointments` | Phase 4 | v23 | `routes/bookings.js` line 9 | No |
| `phase4_appointments_waitlists` | Phase 4 | v23 | Seeded but no `requireFeature` found — feature is gated inline in availability queries only | Asymmetric enforcement |
| `phase4_appointments_classes` | Phase 4 | v23 | Seeded but no `requireFeature` found | Asymmetric enforcement |
| `phase4_google_calendar_sync` | Phase 4 | v23 | Seeded but no `requireFeature` found | Asymmetric enforcement |
| `phase4_service_projects` | Phase 4 | v24 | `routes/projects.js` line 9 | No |
| `phase4_service_contracts` | Phase 4 | v24 | `routes/contracts.js` line 8 | No |
| `phase4_contract_ai` | Phase 4 | v24 | Seeded but no `requireFeature` call found | Seeded but not consumed |
| `phase5_shipping_automation` | Phase 5 | v25 | `routes/couriers.js` (4 routes: book, track, cancel, labels) | No |
| `phase5_cod_reconciliation` | Phase 5 | v25 | `routes/fulfillment.js` lines 971, 1270 | No |
| `phase5_payment_gateways` | Phase 5 | v25 | Not found in any route — seeded but not consumed | Gap — flag exists but never gates anything |
| `phase5_sms_providers` | Phase 5 | v25 | `routes/integrations/credentials.js` line 96 | No |

**Summary of flag gaps:**
1. All 13 `phase2_*` flags: registered in JS code, not in DB until v26 (fixed, but any tenant that applied v19+v20+v21 before v26 had a window where flags could not be DB-enabled)
2. `subscription_autocharge`: seeded in v21, appears in DEFAULT_FEATURE_FLAGS, but no `requireFeature("subscription_autocharge")` call exists in any route
3. `phase4_restaurant_preauth`: seeded in v22, no consuming route gate found
4. `phase4_appointments_waitlists`, `phase4_appointments_classes`, `phase4_google_calendar_sync`: seeded but not enforced via `requireFeature`
5. `phase4_contract_ai`: seeded in v24, no consuming route gate
6. `phase5_payment_gateways`: seeded in v25, no consuming `requireFeature` found

---

## 4. pg-boss Queue Inventory

| Queue Name | Introducing Phase | Worker File | `createQueue` Call | `boss.work` Call | Registered in `boot/workers.js` | Gap? |
|---|---|---|---|---|---|---|
| `email` | Pre-phase | `workers/email-worker-boss.js` | line 215 | line 223 | Yes — `EMAIL_WORKER_ENABLED=1` | No |
| `billing-lifecycle-check` | Pre-phase | `workers/email-worker-boss.js` | line 216 | line 239 | Yes — same | No |
| `fbr-invoice` | Pre-phase (v9) | `workers/fbr-worker-boss.js` | line 132 | line 134 | Yes — `FBR_WORKER_ENABLED=1` | No |
| `cleanup-dead-tenants` | Pre-phase | `workers/cleanup-worker-boss.js` | line 17 | line 22 | Yes — `CLEANUP_WORKER_ENABLED=1` | No |
| `marketplace-sync` | Pre-phase (v17) | `workers/marketplace-sync-worker-boss.js` | line 24 | line 38 | Yes — `MARKETPLACE_SYNC_WORKER_ENABLED=1` | No |
| `marketplace-feed-check` | Pre-phase (v17) | `workers/marketplace-sync-worker-boss.js` | line 25 | line 86 | Yes — same | No |
| `expire-reservations` | Phase 1 | `workers/reservation-worker-boss.js` | line 21 | line 26 | Yes — `RESERVATION_WORKER_ENABLED=1` | Partial — worker registered but **not reported in `GET /api/admin/worker-status`** endpoint |
| `campaign-email` | Phase 3 | `workers/email-worker-boss.js` | line 217 | line 249 | Yes — piggybacks on `EMAIL_WORKER_ENABLED=1`, no separate env var | Concern — Phase 3 queues start whenever email worker starts, no independent toggle |
| `campaign-scheduled-send` | Phase 3 | `workers/email-worker-boss.js` | line 218 | line 343 | Yes — same | Same concern |
| `invoice-reminder` | Phase 3 | `workers/email-worker-boss.js` | line 219 | line 292 | Yes — same | Same concern |
| `subscription-renewal` | Phase 3 | `workers/email-worker-boss.js` | line 220 | line 358 | Yes — same | Same concern |

**Callers that `boss.send()` to these queues:**
- `campaign-scheduled-send`: `routes/marketing.js` line 168 (when scheduling a campaign)
- `invoice-reminder`: `services/customer-invoicing.js` line 214 (via `scheduleReminders`)
- `subscription-renewal`: `services/subscriptions.js` lines 84, 128; `routes/subscriptions.js` line 158
- `email` (from booking reminders): `services/booking-reminders.js` line 20 — **but `processPendingReminders` is defined and never called from any worker or boot sequence** — the appointment reminder polling loop is dead code

**Dead code finding — `services/booking-reminders.js`:** `processPendingReminders(db, boss)` is exported but has zero callers. There is no `boss.work("appointment-reminder", ...)` or `boss.schedule(...)` for appointment reminders. The `appointment_reminders` table is written to by `services/booking-services.js:40` but the polling/dispatch loop is unreachable.

---

## 5. Shared Service / Adapter Reuse

### `services/payment-gateway.js`

**Interface exported:** `createCheckout(opts)`, `createInvoiceCheckout({invoiceId, amount, ...})`, `verifyWebhook(gateway, headers, rawBody)`, `isEnabled()`

**Phase 3 caller — `routes/customer-invoices.js` line 343:**
```
paymentGateway.createInvoiceCheckout({ invoiceId, amount, currency, description, returnUrl, cancelUrl, linkToken })
```
Uses the `createInvoiceCheckout` wrapper. Returns `{ checkout_url, gateway_ref }`.

**Phase 1 caller — `routes/storefront.js` line 841:**
```
paymentGateway.createCheckout({ amount, currency, reference, description, returnUrl, cancelUrl })
```
Uses `createCheckout` directly. Returns `{ checkout_url, gateway_ref }`.

**Pre-existing caller — `routes/billing.js` line 247:**
```
paymentGateway.createCheckout({ amount, currency, plan, cycle, outlet_count, reference, returnUrl, cancelUrl })
```

**Pre-existing caller — `routes/webhooks.js` line 24:**
```
paymentGateway.verifyWebhook("xpay", req.headers, rawBody)
```

**Phase 5 impact:** v25 added `provider`, `provider_status`, `last_event_at` to `payment_intents` and `provider_ref`, `payment_context`, `webhook_event_id` to `web_order_transactions`. The `webhooks.js` handler was updated to write `provider_ref` and `payment_context` on the insert. However, the `billing.js` checkout path that creates `payment_intents` records does not yet populate the new `provider` column (v25 adds it but no calling code was updated).

**Shape agreement:** All phases agree on the `{ checkout_url, gateway_ref }` return shape. The `createInvoiceCheckout` wrapper correctly delegates to `createCheckout`. No shape mismatch detected.

---

### `services/couriers/` adapter pattern

**Phase 1 consumer — `routes/storefront.js`:** Storefront does NOT directly use the courier service adapter for booking; it writes `tracking_number` directly to `web_orders`. The full adapter-based booking is in `routes/couriers.js`.

**Phase 5 consumer — `routes/couriers.js`:** Added Phase 5 booking routes (`POST /api/couriers/:id/book`, etc.) that use `getAdapter(key)` from `services/couriers/index.js`. The new routes gate on `phase5_shipping_automation`. Phase 5 also added `encrypted_config_json` to `courier_integrations` and individual adapter initialization code reads this field.

**Adapter interface expected:** `adapter.book(payload)`, `adapter.track(trackingNumber)`, `adapter.cancel(ref)`, `adapter.getLabel(ref)`. Adapters for leopards/tcs/blueex/trax/postex/callcourier/mnp/rider/swyft/dhl/fedex were updated to implement these; pakpost/bykea adapters are stubs.

**Cross-phase concern:** Phase 1 writes `tracking_number` to `web_orders` directly (pre-Phase 5 path). Phase 5 introduces `order_shipments` as a separate durable record and `web_orders.active_shipment_id` FK. The two tracking models coexist without migration to consolidate existing Phase 1 tracking data into `order_shipments`.

---

### `services/email.js` / `email_queue` (public schema)

**Pre-existing consumers:** `services/fbr.js`, `routes/auth.js`, `routes/admin/`, `routes/support.js`, `routes/email.js`

**Phase 3 consumers:**
- `routes/marketing.js` line 23: `const { enqueueEmail } = require("../services/email")` — used for sending campaign delivery records after building the audience
- `routes/customer-invoices.js` line 29: `const { enqueueEmail } = require("../services/email")` — used for invoice send + reminder dispatch
- `services/customer-invoicing.js`: sends reminder emails via `boss.send("invoice-reminder", ...)` which then calls the `email` queue internally

**Phase 4 consumer:**
- `services/booking-reminders.js` line 20: `boss.send("email", {...})` — sends appointment reminders directly to the `email` queue via pg-boss (not via `enqueueEmail`). This bypasses the `enqueueEmail` helper and writes directly to pg-boss, which means these emails do NOT go through `email_queue` DB table — they are pg-boss jobs only.

**Interface inconsistency:** Phase 3 uses `enqueueEmail()` which writes to `email_queue` table then dequeues via pg-boss worker. Phase 4 booking-reminders uses `boss.send("email", ...)` which writes directly to pg-boss (no `email_queue` table record). Both end up processed by the same `boss.work("email")` handler but follow different audit trails.

---

### `services/crypto.js`

**Pre-existing consumers:** `routes/integrations/` (hub, credentials, daraz, facebook, whatsapp, google-merchant) — all use `encryptSecret`/`decryptSecret` for marketplace credentials.

**Phase 5 consumer:** `routes/couriers.js` — reads `courier_integrations.encrypted_config_json` field added in v25. Uses the same AES-256-GCM key (`INTEGRATION_SECRET_KEY`). The encrypt/decrypt call signature is identical to the integrations hub usage. No interface mismatch.

**Not used by:** Phase 3 (marketing/messaging/invoicing/subscriptions — no credential storage), Phase 4 restaurant/bookings/workspace, Phase 1 storefront.

---

### `category-tree.js` — `resolveInheritedField`

**Pre-existing consumers:** `services/fbr.js` (resolves `hs_code` from category hierarchy), `routes/categories.js`, `routes/products.js`, `routes/promotions.js`, `routes/sales.js`, `routes/returns.js`, `routes/reports/helpers.js`

**New phase consumers:** None. Phases 1–5 do not call `resolveInheritedField`. The KDS/restaurant domain (Phase 4) assigns items to categories for routing but does not use inherited field resolution. The Phase 5 shipping/COD domain does not touch category inheritance.

---

### `ui/primitives.jsx`

**All phases** use the existing `PageShell`, `SectionCard`, `Button`, `Input`, `Badge`, `EmptyState` primitives without adding new exports. The Phase 4 contracts frontend (`ContractsRoute`) uses `react-signature-canvas` as an external dependency — this is the only external UI library added beyond `lucide-react` icons.

No new primitives were introduced in the phase work. All pages follow the `PageShell` + `SectionCard` pattern.

---

## 6. Draft Orders Context Extension

### Shape of `draft_orders` after Phase 2 (v19)

Columns: `id`, `outlet_id`, `customer_id`, `created_by`, `claimed_by`, `claimed_at`, `status` (open/claimed/completed/cancelled), `notes`, `subtotal`, `tax_total`, `discount_total`, `total`, `created_at`, `updated_at`

`draft_order_items`: `id`, `draft_order_id`, `product_id`, `variant_id`, `product_name`, `quantity`, `price`, `discount`, `effective_tax_rate`, `notes`, `created_at`

### Shape of `draft_orders` after Phase 4 migration v22 (additional columns)

7 new columns: `order_context` (default `'retail'`), `table_id → restaurant_tables.id`, `table_session_id → restaurant_table_sessions.id`, `tab_id → restaurant_tabs.id`, `seat_count` (default 0), `dining_option`, `source_token_id`

3 new columns on `draft_order_items`: `seat_number`, `course_name` (default `'main'`), `kitchen_status` (default `'pending'`)

### Every caller of `draft_orders` and which shape they handle

**`routes/draft-orders.js`** (Phase 2 route):
- INSERT at line 86: `INSERT INTO draft_orders (outlet_id, customer_id, created_by, notes, subtotal, tax_total, discount_total, total)` — **does NOT set `order_context`**, so all Phase 2-created draft orders get `order_context = 'retail'` by DEFAULT. This is correct behavior but requires v22 to have been applied (default value exists in column definition).
- UPDATE at line 145: updates `customer_id`, `notes`, totals only — does NOT touch restaurant columns. Safe.
- SELECT at line 156: `SELECT * FROM draft_orders` — returns all columns including restaurant columns. Frontend `DraftOrdersRedesign` would receive these but likely ignores them.

**`services/restaurant-checks.js`** (Phase 4 service):
- INSERT at line 8: `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, seat_count, dining_option, status)` — uses all 7 v22 columns explicitly. This INSERT FAILS if v22 has not been applied (column `order_context` does not exist pre-v22).
- Query at line 20: filters `WHERE order_context != 'retail'` — will silently return empty results on a pre-v22 schema.

**`routes/public-restaurant.js`** (Phase 4 public route):
- Queries `WHERE d.order_context IN ('dine_in','bar')` at line 17 — requires v22.
- Queries `WHERE source_token_id = $1` at line 70 — requires v22 `source_token_id` column.

**`routes/draft-orders.js` claim/complete/cancel operations:** Use `UPDATE draft_orders SET status = ...` which works regardless of shape — safe across both v19 and v22 schemas.

**Shape agreement summary:** Phase 2 callers (`draft-orders.js`) produce retail draft orders that are compatible with v22 schema (default values fill restaurant columns). Phase 4 callers (`restaurant-checks.js`, `public-restaurant.js`) require v22 to have been applied and will fail or return empty results on a v19-only schema. No caller explicitly handles both shapes — they each assume their own minimum version.

---

## 7. Frontend ↔ Backend Contract Surfaces

### Phase 1 — Storefront / Omnichannel

| Endpoint | Method | Backend file | Frontend file | Shape notes |
|---|---|---|---|---|
| `/api/storefront/config` | GET | `routes/storefront.js` | `StorefrontLayout.jsx` | Returns `{ name, currency, logo_url, is_active }` — no auth, tenant via `?tenant=slug` query param |
| `/api/storefront/products` | GET | `routes/storefront.js` | `StorefrontProducts.jsx`, `StorefrontHome.jsx` | Returns `{ products: [...], total, page, limit }` — frontend uses `API_BASE` + `/api/storefront/products` correctly |
| `/api/storefront/products/:id` | GET | `routes/storefront.js` | `StorefrontProductDetail.jsx` | Returns product with variants |
| `/api/storefront/categories` | GET | `routes/storefront.js` | `StorefrontLayout.jsx` | Returns category list |
| `/api/storefront/cart` | GET/POST/PUT/DELETE | `routes/storefront.js` | `useStorefrontCart.js` | Hook exists and is used by StorefrontCart, StorefrontLayout, StorefrontCheckout |
| `/api/storefront/pickup-locations` | GET | `routes/storefront.js` | `StorefrontCheckout.jsx` line 41 | Returns outlet list |
| `/api/storefront/shipping-methods` | GET | `routes/storefront.js` | `StorefrontCheckout.jsx` line 52 | Returns available shipping |
| `/api/storefront/checkout` | POST | `routes/storefront.js` | `StorefrontCheckout.jsx` line 131 | Body: `{ cart_token, customer, delivery_method, ... }`. Response: `{ order_id, order_token, grand_total, payment_enabled }`. **Response key `order_token` used by frontend — must match backend field `public_order_token` aliased as `order_token`** |
| `/api/storefront/orders/:orderToken` | GET | `routes/storefront.js` | `StorefrontOrderStatus.jsx` line 34 | Public endpoint, tenant via query param |
| `/api/storefront/orders/:orderToken/arrive` | POST | `routes/storefront.js` | `StorefrontOrderStatus.jsx` line 63 | Curbside arrival notification |
| `/api/storefront/orders/:orderToken/pay` | POST | `routes/storefront.js` | Not yet wired in frontend — endpoint exists on backend but no frontend component calls it | **Unwired endpoint** |

**Known contract fixes in Range B:** `bc4ee08`, `f313daf`, `0a64e33` fixed storefront response shapes. The specific fields fixed are not visible from the commit hashes alone but the pattern was response object key mismatches (e.g., camelCase vs snake_case, missing fields).

### Phase 2 — Operations (sampling key endpoints)

| Endpoint | Method | Backend file | Frontend file | Shape notes |
|---|---|---|---|---|
| `/api/schedules` | GET/POST/PUT | `routes/schedules.js` | `SchedulingRedesign.jsx` | Feature-gated `phase2_scheduling` |
| `/api/draft-orders` | GET/POST/PUT | `routes/draft-orders.js` | `DraftOrdersRedesign.jsx` | Feature-gated `phase2_draft_orders` |
| `/api/price-lists` | GET/POST/PUT/DELETE | `routes/price-lists.js` | `PriceListsRedesign.jsx` | Feature-gated `phase2_outlet_pricing` |
| `/api/commissions` | GET/POST | `routes/commissions.js` | `CommissionPlansRoute.jsx` | Feature-gated `phase2_commissions` |
| `/api/report-builder` | GET/POST/PUT | `routes/report-builder.js` | `ReportBuilderRoute.jsx` | Feature-gated `phase2_report_builder` |
| `/api/return-policies` | GET/POST/PUT | `routes/return-policies.js` | `ReturnPoliciesRoute.jsx` | Feature-gated `phase2_returns_policy` |

**Range B fix `73b1d0a`** signals that schedule queries joining `leave_requests` used date column casting incorrectly when Phase 2 `start_time`/`end_time` columns were added.

### Phase 3 — Marketing & Engagement

| Endpoint | Method | Backend file | Frontend file | Shape notes |
|---|---|---|---|---|
| `/api/marketing/campaigns` | GET/POST/PUT | `routes/marketing.js` | `MarketingCampaignsRoute.jsx` | Feature-gated; body: `{ name, channel, template_id, subject, body_html, scheduled_at }` |
| `/api/messaging/threads` | GET/POST | `routes/messaging.js` | `MessagingInboxRoute.jsx` | Feature-gated |
| `/api/customer-invoices` | GET/POST/PUT | `routes/customer-invoices.js` | `CustomerInvoicesRoute.jsx` | Feature-gated |
| `/api/customer-invoices/:id/payment-link` | POST | `routes/customer-invoices.js` | (unknown — no frontend file verified) | Double feature gate: `customer_invoicing` + `payment_links` |
| `/api/subscriptions` | GET/POST/PUT | `routes/subscriptions.js` | `SubscriptionsRoute.jsx` | Feature-gated |

### Phase 4 — Restaurant/Bookings/Workspace

| Endpoint | Method | Backend file | Frontend file | Shape notes |
|---|---|---|---|---|
| `/api/restaurant/floor-plans` | GET/POST | `routes/restaurant.js` | `RestaurantFloorRoute.jsx` | Feature-gated `phase4_restaurant` + `manage_restaurant` |
| `/api/restaurant/sessions` | GET/POST/PUT | `routes/restaurant.js` | `RestaurantChecksRoute.jsx` | Feature-gated |
| `/api/kds/stations` | GET/POST | `routes/kds.js` | `KDSRoute.jsx` | Feature-gated `phase4_restaurant_kds` |
| `/api/kds/tickets` | GET/PUT | `routes/kds.js` | `KDSRoute.jsx` | SSE polling via `services/phase4-polling.js` |
| `/api/booking-services` | GET/POST/PUT | `routes/bookings.js` | `AppointmentServicesRoute.jsx` | Feature-gated `phase4_appointments` |
| `/api/appointments` | GET/POST/PUT | `routes/bookings.js` | `AppointmentsRoute.jsx` | Feature-gated |
| `/api/projects` | GET/POST/PUT | `routes/projects.js` | `ProjectsRoute.jsx` | Feature-gated `phase4_service_projects` |
| `/api/contracts` | GET/POST/PUT | `routes/contracts.js` | `ContractsRoute.jsx` | Feature-gated `phase4_service_contracts`; signature data stored as base64 string |
| `/qr/:token` (public) | GET/POST | `routes/public-restaurant.js` | `KioskOrderingRedesign.jsx` | No auth; tenant resolved via token lookup in `draft_orders.source_token_id` |
| `/public/book` | GET/POST | `routes/public-bookings.js` | (public booking page, route not in appRoutes.jsx) | Public route; uses `resolvePublicTenantDb` |

**Range B fix `bfa9b97`** fixed "Add to Cart" in a Phase 1/4 storefront or kiosk component that was a placeholder `alert()` call — confirms unfinished Phase 1 implementation shipped.

### Phase 5 — Pakistan Shipping/COD

| Endpoint | Method | Backend file | Frontend file | Shape notes |
|---|---|---|---|---|
| `/api/couriers/:id/book` | POST | `routes/couriers.js` | (unknown frontend) | Feature-gated `phase5_shipping_automation` |
| `/api/couriers/:id/track/:tracking` | GET | `routes/couriers.js` | (unknown frontend) | Feature-gated |
| `/api/fulfillment/cod-batches` | GET/POST | `routes/fulfillment.js` | `CODSettlementsRoute.jsx` | Feature-gated `phase5_cod_reconciliation` + `manage_orders` |
| `/api/fulfillment/cod-batches/:id/match` | POST | `routes/fulfillment.js` | `CODSettlementsRoute.jsx` | Auto-match logic |
| `/api/fulfillment/cod-batches/:id/approve` | POST | `routes/fulfillment.js` | `CODSettlementsRoute.jsx` | Approve batch |

---

## 8. Known-Weak Seams List (from 30 Range B fix commits)

### Migration Ordering Errors

- **`116863c`** — "add allocation_id column before FK in v18": v16's `picklist_items` table was created in `schema-pg.sql` (static snapshot) WITH the `allocation_id FK` baked in, but `web_order_allocations` only existed after v18. Fix added conditional column add in v18 before the FK. **Pattern: static schema snapshot diverged from migration sequence; FK target didn't exist at column declaration time.**
- **Directive:** For every FK in `schema-pg.sql` where the referenced table appears AFTER the referencing table in migration order, verify the FK is guarded by a conditional `DO $$ BEGIN...END $$` block in the migration that creates the target table.

### Schema/Query Column Drift

- **`c53c9bc` + `cc53036`** — "resolve 18 column mismatch + route order bugs": 18 column names in queries did not match the table schema. **Pattern: queries written against assumed column names that differed from actual DDL.**
- **`3ec70b8`** — "products table has no created_at column": query assumed `created_at` existed on `products`; the column is `deleted_at` + timestamps on the migration but not `created_at`. **Pattern: query authors assumed the standard `created_at` column on pre-existing tables without checking DDL.**
- **`41ba68c`** — "product detail query column mismatches": similar — `SELECT col` where `col` does not exist on `products`.
- **Directive:** For every new route touching a pre-existing table, grep `schema-pg.sql` for the actual column list before writing SELECT queries. The `products` table does NOT have `created_at`. The `sales` timestamp column is `timestamp` not `created_at`.

### Feature Flag Registration Gaps

- **`d71b2b1`** — "backfill missing Phase 2 feature flags in v26": all 13 `phase2_*` flags existed only in `DEFAULT_FEATURE_FLAGS` (JS defaults), never seeded to the DB. The `getFeatureFlagsMap` merge logic correctly merges defaults with DB rows, but DB-side flag toggling (admin panel) silently did nothing because `INSERT ... ON CONFLICT DO NOTHING` was never run.
- **`1490a9a`** — "missing requireFeature destructure in fulfillment.js": `requireFeature` was used in `fulfillment.js` without being destructured from `deps`. **Pattern: routes importing `requireFeature` from `deps` directly (`const { requireFeature } = deps`) vs. requiring from the module directly (`const { requireFeature } = require("../middleware/feature-flags")`) — inconsistency in import style causing silent `undefined` at runtime.**
- **Directive:** Grep all new phase route files for `requireFeature` usage. Verify each file either destructures it from `deps` AND that `deps` includes `requireFeature`, or requires it from the middleware module directly. These two patterns are both present in the codebase (Phase 2 uses `deps`, Phase 3/4 require directly).

### Frontend ↔ Backend Contract Drift

- **`a16d9d0`** — "missing /api/ prefix + storefront sidebar link": frontend called `/storefront/...` instead of `/api/storefront/...`. **Pattern: frontend built against assumed URL prefix without checking backend route registration.**
- **`bc4ee08` + `f313daf` + `0a64e33`** — "storefront response shape fixes": backend response keys didn't match what frontend expected. **Pattern: Phase 1 storefront frontend was built in parallel with or ahead of backend implementation, with assumed response shapes.**
- **Directive:** For every Phase 1 storefront endpoint, manually compare the `res.json(...)` shape in `routes/storefront.js` against the destructured fields in `StorefrontCheckout.jsx`, `StorefrontProductDetail.jsx`, `StorefrontOrderStatus.jsx`. The `/pay` endpoint has no frontend consumer at all.

### Placeholder / Unfinished Code Shipped

- **`bfa9b97`** — "wire Add to Cart to real cart hook (was placeholder alert)": a button in a Phase 1 or Phase 4 page called `alert("Add to cart not implemented")` instead of the real cart hook. **Pattern: feature UI scaffolded with placeholder callbacks before implementation was ready; shipped without replacement.**
- **Directive:** Grep all new Phase page components for `alert(`, `console.log("TODO`, `// TODO`, `throw new Error("not implemented"`, and any button `onClick` returning early without state mutation. These are canary signs of placeholder shipping.

### Cross-Phase Integration with Pre-Existing Code

- **`73b1d0a`** — "cast leave_requests dates in shift joins": Phase 2 added `start_time`/`end_time` TIME columns to `leave_requests`. A query in `routes/schedules.js` joining `scheduled_shifts` with `leave_requests` used `date(leave_requests.start_date::date)` date casting which conflicted with the new TIME columns. **Pattern: Phase 2 extended a pre-existing HR table (`leave_requests`) and a Phase 2 query joining that table used incorrect date handling for the new columns.**
- **Directive:** For every `ALTER TABLE <pre-existing-table>` in v19–v25, find all query files that SELECT from that table and verify column references are consistent with the new shape.

### Other

- **All other fix commits in range** that are not categorized above likely fall into either additional column mismatch patterns or query logic bugs specific to individual domain routes. The dominant pattern across all 30 fixes is **schema-vs-query drift**: queries written without cross-referencing the actual DDL.

---

## 9. Blind Spot Summary — Top 10 Highest-Risk Cross-Phase Seams

Ranked by: (a) number of phases involved, (b) whether Range B fixes already hit this seam, (c) blast radius if broken.

**1. `draft_orders` / `draft_order_items` shape split (Phase 2 creates, Phase 4 extends)**
- Phases involved: 2, 4
- Range B hit: Not directly — but `c53c9bc` shows column mismatch is common pattern
- Blast radius: All restaurant checks, POS draft order creation, QR ordering
- Risk: `draft-orders.js` INSERT does not include `order_context`; relies on DB default `'retail'`. If DB default is absent (e.g. column added without DEFAULT in some migration path), all retail draft orders fail. Phase 4 restaurant queries filter `order_context != 'retail'` — if a retail draft order gets `NULL` for `order_context` instead of `'retail'`, it appears in restaurant check lists.

**2. All 13 Phase 2 feature flags — DB vs. JS default gap (v19/v20 no-seed)**
- Phases involved: 2 (all sub-features)
- Range B hit: `d71b2b1` (fixed)
- Blast radius: All Phase 2 features uncontrollably disabled until v26 applied
- Risk: Fixed by v26, but any tenant between v20 and v26 application had this gap. Also, the pattern may repeat: verify Phase 3, 4, 5 flags are seeded in their respective migrations (confirmed for Phase 3 v21, Phase 4 v22/23/24, Phase 5 v25 — but reviewer should spot-check).

**3. `web_orders` — triple-phase extension (v5, v18, v25) with multiple callers**
- Phases involved: Pre-phase, 1, 5
- Range B hit: `bc4ee08`, `f313daf` (storefront response shape), `c53c9bc` (column mismatches)
- Blast radius: All order management, fulfillment, COD settlements, storefront checkout, Shopify sync
- Risk: v25 adds `active_shipment_id` but no existing query that writes `web_orders` has been updated to also write this column. The column will be NULL for all orders created via Phase 1 storefront checkout. COD settlement matching logic that joins `web_orders` to `order_shipments` via `active_shipment_id` will find no matches for these orders.

**4. `payment_gateway.js` — three-phase consumer disagreement on when gateway must be enabled**
- Phases involved: Pre-phase (billing), 1 (storefront), 3 (customer invoices), 5 (extends payment_intents)
- Range B hit: Not directly
- Blast radius: Payment flows for billing renewals, storefront checkout, invoice payment links
- Risk: All three callers check `paymentGateway.isEnabled()` before calling `createCheckout`. However, Phase 5 added `provider` column to `payment_intents` and the billing.js path that inserts `payment_intents` does not set `provider`. Phase 5 added `provider_ref` to `web_order_transactions` and the pre-Phase-5 insert in `orders.js` line 576 likely does not set this column.

**5. `services/booking-reminders.js` dead code — appointment reminders never fire**
- Phases involved: 4
- Range B hit: Not in Range B — likely undiscovered
- Blast radius: All appointment reminder functionality (Phase 4B feature)
- Risk: `processPendingReminders` is exported and implemented but never called. There is no `boss.work("appointment-reminder", ...)`, no cron schedule, no `setInterval`. The `appointment_reminders` table is populated on appointment creation (via `services/booking-services.js`) but reminders are never sent. This is a complete silent failure of a feature.

**6. `quotations` table — multi-phase extension (Phase 3 v21, Phase 4 v24)**
- Phases involved: Pre-phase (tier4/crm.js), 3, 4
- Range B hit: Not directly
- Blast radius: Quotation → invoice conversion flow, project billing
- Risk: v21 adds `converted_invoice_id`; v24 adds `project_id`, `estimate_status`, `approved_at`, `approved_by`. The `tier4/crm.js` quotation routes do NOT include these columns in SELECT lists for quotation responses — if any frontend component expects `project_id` in a quotation response, it will receive `undefined`. The `customer-invoices.js` route references `quotations.id` via FK but does not JOIN back to get `project_id`.

**7. `courier_integrations` — triple-phase extension (v5, v17, v25) with adapter pattern dependency**
- Phases involved: Pre-phase (v5), v17, 5
- Range B hit: Not in Range B
- Blast radius: All courier dispatch (Phase 5 booking/tracking gates)
- Risk: v25 adds `encrypted_config_json` for secure credential storage. The 11 updated adapters are expected to read credentials from this field, but existing courier rows (seeded in v5 and v17) have `NULL` for this column. Any Phase 5 booking attempt on an existing courier without re-configuring credentials will fail with a null-dereference or silent auth failure inside the adapter.

**8. `email-worker-boss.js` — Phase 3 queues piggyback on EMAIL_WORKER_ENABLED**
- Phases involved: Pre-phase (email queue), 3 (campaign-email, invoice-reminder, subscription-renewal)
- Range B hit: Not in Range B
- Blast radius: Phase 3 marketing campaigns, invoice reminders, subscription renewals — all gated by a pre-existing env var
- Risk: No independent toggle for Phase 3 worker functions. If EMAIL_WORKER_ENABLED is turned off for maintenance, Phase 3 campaign sends, invoice reminders, and subscription renewals also stop. Conversely, turning on EMAIL_WORKER_ENABLED on a system that hasn't had Phase 3 migrations (v21) applied will cause `campaign-email` and `invoice-reminder` workers to start processing but find empty/missing tables and throw on every tick.

**9. `customer_invoices` / `customer_subscriptions` / `quotations` — Phase 4 extension of Phase 3 tables**
- Phases involved: 3 (creates), 4 (extends)
- Range B hit: Not in Range B
- Blast radius: All service workspace billing (projects → milestones → invoices flow)
- Risk: v24 adds `project_id` and `invoice_kind` to `customer_invoices`, but the Phase 3 customer-invoices route INSERT does not set these columns (they default to NULL / 'standard'). The Phase 4 project billing service (`services/project-billing.js`) creates invoices with `project_id` set, but the frontend CustomerInvoicesRoute was built for Phase 3 and may not display or pass `project_id`. The two phases have diverging assumptions about what a "customer invoice" is.

**10. Public routes mounting position — storefront, public-restaurant, public-bookings bypass auth middleware**
- Phases involved: 1 (storefront), 4 (public-restaurant, public-bookings)
- Range B hit: `a16d9d0` (URL prefix fix) suggests these public routes had implementation errors
- Blast radius: Any tenant data leak if a route in these files is accidentally auth-required
- Risk: All three public route files mount before `loadTenantAndPerms`. They resolve tenant context manually via `resolvePublicTenantDb`. If any route handler in these files contains a query that does not go through the manual tenant resolver (e.g., uses `deps.db` directly), it will operate on the wrong tenant schema or throw. The `public-restaurant.js` file queries `draft_orders.source_token_id` — the token is the only auth gate; if tokens are guessable (short entropy), orders from other tables can be accessed.

---

*End of SanoPOS Phase Branch Interconnection Map.*
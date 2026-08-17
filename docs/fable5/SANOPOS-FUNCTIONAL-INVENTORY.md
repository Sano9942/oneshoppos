# SanoPOS Functional Inventory

**Purpose:** a complete, unsorted inventory of functionality evidenced in the Fable 5 research and current project guides. This is a factual baseline for later grouping into modules, plans, industries, and customer-configurable settings.

**Code verification update — 2026-07-10:** the original Fable documents correctly described the state at the time they were written, but much of the planned vertical-depth and hardening work has since been implemented. This inventory was rechecked against current mounted routes, services, UI surfaces, migrations, and dedicated integration tests. The 30 focused core tests for stock/money/AI passed. A larger parallel vertical test run was constrained by local PostgreSQL shared-memory capacity while provisioning isolated test schemas; it did not expose feature-test assertion failures.

**Status language**

- **Built** — source-traced or flow-verified in the Fable research.
- **Built, verify** — present and wired, but the research explicitly asks for live verification or identifies a limited seam.
- **Planned / not inventory** — deliberately excluded from the built list; recorded at the end so future work is not mistaken for current capability.

This is a product inventory, not a marketing claim sheet. A built capability can still have a known hardening, UX, integration, or vertical-fit gap.

---

## 1. Platform, tenancy, access, and onboarding

- **Built:** schema-per-tenant SaaS architecture on PostgreSQL; each tenant has its own tenant schema, while the public schema holds platform, billing, queue, and administration data.
- **Built:** tenant lifecycle: self-service signup, CAPTCHA/rate-limit support, email verification, setup token, onboarding wizard, sample data, setup completion gate, and cleanup of abandoned tenants.
- **Built:** company profile setup: business identity, country/city, timezone, currency, cash denominations, fiscal-year start, tax mode, NTN/STRN, outlets, and industry selection.
- **Built:** 23 industry presets: general retail, grocery, butcher, sweet shop, textile, wholesale, restaurant, cafe, salon, gym, photography studio, clinic, dental clinic, veterinary, physiotherapy, repair shop, car rental, equipment hire, furniture rental, party supplies, hotel, guesthouse, and hostel.
- **Built:** 10 coarse operating modes: restaurant, appointments, commissions, service projects, subscriptions, workflow tickets, rentals, room management, treatment plans, and wholesale.
- **Built:** feature-flag system, mode gating, plan limits, role permissions, outlet context, and industry vocabulary/layout settings.
- **Built:** industry-based labels, POS layouts, visible report groups, dashboard-widget configuration, onboarding steps, and preset sample categories/products.
- **Built:** multi-outlet support, outlet assignment, outlet-specific context, outlet pricing/visibility capabilities, and context enforcement.
- **Built:** employee authentication with access and refresh tokens, password reset, employee PINs, POS re-auth/manager PIN overrides, kiosk PIN access, and token revocation.
- **Built:** separate identity realms for employees, super-admins, customer portal users, manufacturer portal users, and selected public routes.
- **Built:** editable roles and role permissions; shipped Administrator, Manager, Cashier, and Field Rep roles.
- **Built:** global dark mode, breadcrumbs, toast notifications, subscription/status banners, support widget, and responsive React application shell.

## 2. POS, selling, payments, receipts, and shifts

- **Built:** browser-based POS with grid/list layouts, keyboard shortcuts, barcode/SKU/omni search, product tiles, variants, weighted/decimal quantities, customer attachment, notes, discounts, and tax snapshots.
- **Built:** retail, restaurant, appointment, field-order, room-folio, rental, and treatment-plan commercial flows all converge on the core sale/invoice spine where applicable.
- **Built:** parked sales, holds/layaway, draft orders, quotations, sales returns, exchanges, voids, refunds, price overrides, approval policies, override reasons, and action history.
- **Built:** split payments, cash/card and configured tender flows, stored-value/wallet-related flows, on-account wholesale sales, gift cards, loyalty redemption, deposits, and payment gateway checkout paths.
- **Built:** manager PIN approval for protected POS actions such as voids, comps, and price overrides.
- **Built:** receipts rendered from stored sale data; thermal/network printing support, email receipt, WhatsApp share link, and public shareable receipt page.
- **Built:** cashier shifts and attendance-aware checkout controls; optional open-shift and clocked-in cashier checks.
- **Built:** IndexedDB offline queue for sale, return, check-in, and field-order operations; reconnect replay. The main POS remains connectivity-dependent for live catalog lookup and is not a full offline-first replicated POS.
- **Built:** preset-driven checkout behavior: retail grid/list choices, restaurant table/check overlays, and specialized unit vocabulary for weight/length-selling industries.

## 3. Catalog, pricing, inventory, purchasing, and production

- **Built:** product catalog, variants, attribute sets, hierarchical categories, brands, suppliers, barcode fields, images, units, product visibility, and product import/export.
- **Built:** price lists/books, channel/outlet/customer/customer-group price resolution, scheduled price changes, smart collections, promotions, discounts, and promotion application snapshots.
- **Built:** barcode label designer and product label/expense-related utilities.
- **Built:** multi-outlet inventory, stock transfers, stock adjustments, stock counts, stock reservations, stock aging, shrinkage tracking, and stock movement/audit records.
- **Built:** serialized inventory with serial-number tracking across products and sale items.
- **Built:** inventory intelligence: ABC classification, reorder intelligence, reorder/safety-stock related data, and inventory dashboard/reporting surfaces.
- **Built:** purchase orders, goods-received notes (GRN), supplier payables, supplier returns, supplier management, and purchasing reports.
- **Built:** weighted and decimal-unit sales for kg/g/lb/oz/m/cm; tare capture for relevant presets; butcher, sweet shop, and textile vocabulary.
- **Built:** inventory kit/BOM/recipe engine and batch/lot/expiry/FEFO stock engine, including tracked-batch consumption, returns, expiry alerts, and batch-stock drift checks.
- **Built:** shared transactional stock ledger used by inventory transfers/adjustments, purchasing receipts, quotations, supplier returns, stock conversions, sales, returns, and holds; it locks stock, blocks insufficient stock, and keeps stock records aligned across product/variant/batch paths.
- **Built:** server-authoritative sale repricing, tax and payment validation, loyalty and wallet protection, refund caps, store-credit wallet posting, partial PO receipt handling, and variant-aware stock paths. Dedicated core tests passed for stock ledger, sales money paths, and return/store-credit flows.
- **Built:** grocery PLU rapid entry, PLU barcode/scale mapping, embedded barcode schemes, and age-restricted product confirmation at POS.
- **Built:** AI supplier invoice/challan image extraction into the existing import-preview flow, with a human review/import step rather than automatic posting.

## 4. Customers, CRM, loyalty, marketing, and customer-facing surfaces

- **Built:** customer CRM, customer profiles, account activity, balances, customer groups, pricing groups, customer statements, and credit controls for wholesale.
- **Built:** loyalty points and tiers, gift cards with public balance lookup, promotions, vouchers/campaign capabilities, and customer engagement reporting.
- **Built:** email campaigns, SMS provider integration/campaigns, scheduled/customer status notifications, receipt email, digest emails, lifecycle emails, and support/broadcast email flows.
- **Built:** customer portal with secure customer authentication and preset-specific tabs for orders, invoices, appointments, memberships, bookings, treatment plans, repair tickets, rental agreements, and stays where applicable.
- **Built:** headless storefront, public product/order flows, customer reorder/cart handoff, customer-group catalog visibility, and public receipt pages.
- **Built:** public booking, restaurant QR menu, restaurant reservations/waitlist, selected gift-card lookup, country-pack lookup, and public webhooks.
- **Built:** public photography inquiry form to CRM lead, project-triggered questionnaires, staff gallery upload/client-visibility controls, customer photo-proofing/selection portal, and related customer notifications.
- **Built:** CRM leads, activities, quotations, conversion to projects, service projects, milestones, files, project billing, contracts, templates, e-signatures, multi-signer flows, and contract event history.
- **Built, verify:** the Fable integration audit identifies marketplace inbound order capture and selected WhatsApp/Daraz/Meta paths as incomplete or previously failing; do not market these as universally automated until live verification is complete.

## 5. Employees, attendance, scheduling, commissions, approvals, and HR

- **Built:** employee records, outlet assignments, roles, permissions, password/PIN changes, and employee profile self-service.
- **Built:** attendance clock-in/out, kiosk attendance, local-time attendance records, attendance reporting, auto-close workers, and shift workflows.
- **Built:** field-rep attendance with GPS, selfie, geofence checks, visit logs, routes, and mobile/PWA order capture.
- **Built:** schedules, appointment staff availability, appointment blocks/breaks/closures, availability rules, and overlap prevention.
- **Built:** commission plans, staff assignment, commission earnings ledger, calculation/status flows, and restaurant tip pooling/distribution into the earnings workflow.
- **Built:** approvals framework, approval policies, override controls, risk controls, and auditable action history.
- **Built:** appointment resources (chairs, beds, bays), group classes/timetables, class booking/cancellation/no-show handling, class and appointment waitlists with offer/claim/expiry flow, and appointment-to-sale completion links.
- **Built:** packages/session-pass consumption can link to appointments, classes, and sales; membership failed-payment/dunning handling is present.
- **Built:** client service history and salon formula notes, including automatic service-record skeletons created when an appointment is paid through POS.

## 6. Reporting, accounting, tax, compliance, insights, and AI

- **Built:** sales, inventory, purchasing, customer, employee, attendance, wholesale/AR, restaurant, clinical, accounting, and FBR report modules, with CSV export support.
- **Built:** report builder and automated insight-card infrastructure.
- **Built:** AI insights endpoint/chat capability backed by an external model provider, alongside pre-built analytics cards. It is feature-gated.
- **Built:** double-entry accounting, accounting-ledger capabilities, post-dated cheque support, customer invoices, invoice reminders, supplier payables, payment history, and business financial reporting.
- **Built:** tax modes, per-line tax snapshots, tax configuration, tax rate lookup, country packs, outlet tax profiles, and FBR-oriented tax structures.
- **Built:** FBR Digital Invoicing configuration, invoice queue, retry/backoff worker, dashboard/retry actions, compliance tax-rate administration, and FBR CSV export.
- **Built, verify:** Fable claim-audit material identified a historical front-end flag-union problem that hid the FBR dashboard despite FBR data being active. Verify the current visibility path in a Pakistani tenant.

## 7. Orders, fulfillment, logistics, couriers, and omnichannel commerce

- **Built:** orders, allocation, picklists, loadsheets, dispatch, shipment tracking, delivery workflows, and COD settlement/reconciliation.
- **Built:** wholesale backorders/partial fulfilment, oldest-first fulfilment suggestions, customer notification on backorder creation, van outlets, van day opening/reconciliation, sell-from-van, and proof-of-delivery/failed-delivery handling.
- **Built:** courier integration hub and adapters for Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, and FedEx.
- **Built:** Shopify integration: connection, credentials, product/order/inventory-oriented sync facilities, and webhook handling.
- **Built:** WooCommerce product import/sync and inventory connection.
- **Built:** integration hub for marketplace/channel connections: Daraz, Facebook/Meta commerce, WhatsApp, Google Merchant, Shopify, WooCommerce, couriers, and credentials management.
- **Built:** integration credential encryption architecture for current integration settings.
- **Built, verify:** inbound marketplace webhooks, automated sync-worker processing, and every courier adapter need per-provider production testing. The Fable audit distinguishes working adapters/routes from decorative or silent-failure paths.

## 8. Restaurant and cafe operations

- **Built:** restaurant floor plans, sections, tables, table sessions, restaurant checks, tabs, seat/item split bills, courses, and restaurant-specific checkout behavior.
- **Built:** kitchen display system: stations, tickets, routing rules, bump/recall, load snapshots, KDS analytics, and kitchen workflow.
- **Built:** modifiers with required/min/max rules and price effects; 86/unavailable items; day-part menu schedules; menu engineering reports.
- **Built:** course timing and automatic course-release worker.
- **Built:** void/comp workflows with manager PIN, tip capture, tip pooling, and tip distribution.
- **Built:** self-order kiosk, QR menu, pay-at-table, public reservations, waitlist, public restaurant pages, online-order inbox for owned channels, and restaurant delivery-oriented infrastructure.
- **Built:** foodpanda inbound order injection with HMAC/replay protection, tenant/store resolution, idempotency, optional auto-accept into KDS and sales, stock/recipe-component consumption, and FBR enqueueing when enabled. Careem payload normalisation/inbound handling is implemented, while Careem outbound automation remains dependent on partner API access.
- **Built, verify:** drive-through has a feature flag but Fable research specifically calls for confirming the depth behind it before offering it as a finished capability.

## 9. Appointments, salon, gym, and personal services

- **Built:** service catalog with duration, padding, price, deposit configuration, per-service staff assignment, and service variants.
- **Built:** booking availability engine, staff/outlet/service rules, 15-minute slots, appointment creation/reschedule/cancel/no-show lifecycle, calendar feeds, and public booking.
- **Built:** booking payment/deposit intent flow and scheduled email reminders.
- **Built:** salon service history/appointment workflows, retail-at-POS alongside services, commissions, client portal appointments, loyalty/gift-card capabilities, and service vocabulary.
- **Built:** membership plans, recurring subscriptions, trials, enrolment, pause/resume, cancellation, renewal history, saved-payment auto-charge capability, generated invoices, and membership statistics.
- **Built:** gym/PT session booking and customer portal membership/class-booking surfaces.
- **Built:** group class timetables, class/session rosters, waitlists, member codes, front-desk member lookup/check-in, public kiosk check-in, package/session passes, custom forms/waivers, and membership dunning/failed-payment notifications.

## 10. Clinical, dental, veterinary, and physiotherapy

- **Built:** patient subjects for self, dependents, and pets; pet species/breed/sex/weight/identifier/photo data.
- **Built:** treatment-plan lifecycle, diagnosis notes/codes, planned/completed sessions, estimates, templates, and default activities.
- **Built:** treatment sessions with SOAP notes, chief complaint, appointment linkage, complete/no-show/cancel lifecycle, and vital signs.
- **Built:** dental, veterinary body, and general-body chart presets with chart entries.
- **Built:** prescriptions, lab orders/results, consent-form templates, clinical documents, clinical dashboard/reporting surfaces, and patient portal treatment-plan view.
- **Built:** treatment-plan folios, attach-sale/settle flows, invoices, gateway deposit pre-authorisation/capture, reminders, and overdue-plan worker.
- **Built, verify:** Fable research previously found chart-preset and clinical-report visibility leaks for some clinical presets. Confirm veterinary/physiotherapy chart selection and clinical report visibility on fresh tenants.

## 11. Repair and service operations

- **Built:** service-ticket board and CRUD with intake, approval, in-progress, on-hold, completed, invoiced, and cancelled states.
- **Built:** ticket descriptions/notes, customer/outlet/technician assignment, expected/actual completion, manual deposit recording, and ticket activity log.
- **Built:** invoice generation from resolved service tickets and customer portal repair-ticket status tab.
- **Built:** generic service projects, contracts, files, milestones, project billing, and e-signature flows can support broader service businesses.
- **Built:** device-specific intake (type, brand, model, IMEI/serial, encrypted passcode, accessories, condition, photos, and history), ticket parts/labour/fee lines, stock decrement/reversal, customer estimates, estimate notification, warranty dates/history, and repair status-change notification infrastructure.
- **Built, verify:** technician dispatch/route optimisation and a formal warranty-claims programme beyond device warranty history are not confirmed as dedicated repair features.

## 12. Rentals and asset hire

- **Built:** rental items with hourly/daily/weekly rates, deposits, upfront/on-return policies, and item configuration.
- **Built:** asset records with serial/label, status, condition notes, availability state, and maintenance/retired states.
- **Built:** date-range availability check, multi-line rental contracts, asset allocation, rate/deposit snapshots, reserve-to-confirm-to-checkout-to-return lifecycle, cancellation, invoices, and contract timeline/activity log.
- **Built:** late-fee calculation/override and overdue detection with email alerts.
- **Built:** customer portal rental-agreement/equipment-rental tabs and preset vocabulary across car, equipment, furniture/event, and party-supply rental variants.
- **Built:** condition inspections at checkout/return, damage capture against deposits, asset maintenance logs/due-asset handling, online rental booking, and car-rental vehicle/legal data including driver identity/licence details and agreement generation.
- **Built, verify:** delivery/collection route optimisation and a broader fleet-maintenance planning system are not confirmed as dedicated rental features.

## 13. Hotels, guesthouses, and hostels

- **Built:** room types with capacity, base rate, deposit, amenities, tax-inclusive setting, rate overrides, and stay quotation.
- **Built:** rooms with number/floor, occupancy status, housekeeping status, and housekeeping updates.
- **Built:** booking availability, reserve/confirm/check-in/check-out/cancel/no-show lifecycle, booking timeline, and room operations.
- **Built:** payment-gateway deposit pre-authorisation at booking and capture at checkout.
- **Built:** guest folios with room-night, POS, manual, discount, and tax lines; attach sale to folio; folio settlement and invoicing.
- **Built:** overdue-checkout detection/email worker and customer portal My Stays view with booking/folio totals.
- **Built:** direct public room booking, race-safe availability handling, iCal import/export channel feeds, channel blocks, room/bed-level hostel inventory, dorm maps, guest registration enforcement, occupancy reporting, night-audit snapshots/history, and nightly audit worker.
- **Built, verify:** channel sync is iCal feed-based rather than a full OTA/channel-manager integration; final folio-tax policy should be checked against the current compliance requirements before launch claims.

## 14. Super-admin, support, billing, platform operations, and reliability

- **Built:** super-admin authentication, tenant list/detail/create/suspend/delete controls, tenant notes, plan/billing control, payment recording, upgrade-request review, and tenant feature-flag management.
- **Built:** tenant impersonation with short-lived revocable token, visible impersonation banner, and audit trail.
- **Built:** admin activity/security logs, support ticket administration/replies, email queue/dead-letter tools, announcements/broadcasts, and selected targeted announcement capability.
- **Built:** worker heartbeat/status display, queue depth, tenant lifecycle/adoption data foundations, orphaned-schema discovery/cleanup, infrastructure diagnostics, database/schema/slow-query monitoring, and backup facilities.
- **Built:** Pino structured logging, request IDs, Sentry integration, alerting for error spikes/database pressure, health endpoints, UptimeRobot-compatible monitoring, R2-aware upload/storage utilities, and API documentation.
- **Built:** subscription model: Free plan caps; Pro trial/grace/expired-read-only lifecycle; global subscription banner; manual upgrade/payment path; payment gateway checkout; HMAC-verified payment webhook; automated lifecycle and renewal emails.
- **Built, verify:** global flag kill switch, portions of tenant-360 intelligence, and other admin-roadmap entries remain future work; they are not included as current customer functionality.

## 15. Public, partner, and integration-facing interfaces

- **Built:** public landing, signup, reset-password, email-verification, setup, receipt, booking, QR-menu, pay-at-table, and selected storefront routes.
- **Built:** customer portal and manufacturer-partner portal, each with separate authentication and scope.
- **Built:** API-level Zod validation across many domains, role/permission middleware, feature/mode gates, plan limits, subscription write protection, upload validation, rate limiting, request IDs, CORS, security headers, and webhook raw-body handling.
- **Built:** xPay webhook signature verification; marketplace and channel webhook endpoints exist.
- **Built, verify:** Fable security research identified signature verification as incomplete for some aggregator/marketplace webhook paths; all third-party inbound webhook sources should be validated before enterprise claims.

---

## Remaining planned or incomplete items — deliberately not counted as built

The following survived the current-code review. They are important, but must not be presented as existing functionality:

- Customer merge/deduplication.
- A per-product, customer-configurable negative-stock policy (the system detects/prevents insufficient-stock paths, but a clear per-product allow/block policy was not found).
- A fully autonomous marketplace background-sync worker. The current worker explicitly operates in **manual-only** mode; staff-triggered integration actions exist, but scheduled polling is intentionally not implemented.
- Production verification for every external marketplace, courier, WhatsApp, and webhook provider. Code and manual actions exist, but credentials, provider behaviour, signatures, and live accounts cannot be proven from local source.
- Full OTA/channel-manager connectivity beyond the implemented iCal room channel feeds.
- Restaurant drive-through completion and production verification; the flag exists but the complete operational surface remains unconfirmed.
- Delivery/collection route optimisation for rentals and a broader fleet-maintenance planning capability.
- Repair technician dispatch/route optimisation and a complete warranty-claims programme beyond the existing device/warranty history.
- A customer-facing Business Modules / workspace-customisation layer. The existing feature flags, modes, presets, and permissions are the technical foundation, but the Square-like tenant settings experience is not yet counted as built.
- A provider-neutral AI gateway, customer-supplied AI credentials, and ChatGPT/Claude/Gemini external tool interfaces. Current AI is SanoPOS-hosted functionality, including Claude-backed insights and invoice extraction.

## Evidence used

- `docs/fable5/platform-study/sanopos-platform-audit.md`
- `docs/fable5/archive/core-research/*`
- `docs/fable5/vertical-depth/findings/*`
- `docs/fable5/archive/claim-audit/*`
- `docs/fable5/completion/*` and `docs/fable5/vertical-depth/plans/*` to distinguish current capability from planned work.
- Root and backend/frontend `AGENTS.md` project guides for current architecture and route/domain context.

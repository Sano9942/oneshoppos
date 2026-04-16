COMPLETE TOUR OF TENANT PRESET ENGINE V1 + V2 (Current State)
Current Status (as of 2026-04-16)
v1 COMPLETE — Milestones 1-4 shipped on 2026-04-14
v2 IN PROGRESS — Milestones 5-10 shipped between 2026-04-14 and 2026-04-15

What's Been Built (Milestone Summary)
Milestone Status Delivery What It Unlocks
M1 ✅ Done 2026-04-14 Preset engine v1 + 3 presets (retail, restaurant, salon)
M2 ✅ Done 2026-04-14 Workflow tickets + subscription polish
M3 ✅ Done 2026-04-14 7 more presets (grocery, cafe, clinic, repair, gym, wholesale, photo)
M4 ✅ Done 2026-04-14 Country packs, receipt labels, reports, POS search, sample data, clinic extension
M5 ✅ Done 2026-04-14 Weight-based selling + 3 new presets (butcher, sweet_shop, textile)
M6 ✅ Done 2026-04-14 Online public booking page (/book/:slug) with email confirmation + ICS download
M7 ✅ Done 2026-04-14 Rentals mode + 4 rental presets (car_rental, equipment_hire, furniture, party_supplies)
M8 ✅ Done 2026-04-15 Customer portal (/portal/:slug) with invoice pay, self-service appointments, profile editing
M9 ✅ Done 2026-04-15 Room management mode + 3 hospitality presets (hotel, guesthouse, hostel)
M10 ✅ Done 2026-04-15 Treatment plans mode + 3 clinical presets (dental_clinic, veterinary, physiotherapy)
M11 ⏸️ Deferred N/A Manufacturing mode (bakery, small factory) — only when customer commits
Current Coverage (v2 State)
What Count Examples
Industry presets 23 live retail, grocery, wholesale, restaurant, cafe, salon, clinic, repair_shop, gym, photography_studio, butcher, sweet_shop, textile, car_rental, equipment_hire, furniture_rental, party_supplies_rental, hotel, guesthouse, hostel, dental_clinic, veterinary, physiotherapy
Business modes 9 operational retail (implicit), restaurant, appointments, service_projects, subscriptions, workflow_tickets, rentals, room_management, treatment_plans
Country packs 23 configured PK, US, GB, CA, AU, IN, AE, SA, BD, NG, KE, GH, ZA, EG, DE, FR, NL, SG, MY, ID, PH, NZ, OTHER
Adaptation surfaces 16 implemented Nav, labels, dashboard widgets, POS layout, onboarding, receipts, reports, POS search, sample data, clinic fields, unit vocabulary, public booking labels, rental asset UX, portal tabs, room inventory, clinical config
Industries covered ~48 of 54 Full support for: all retail variants, all F&B, all appointment-based, all rental/hospitality, all clinical verticals, repairs, subscriptions. Missing: manufacturing (6 industries).
Architecture: Three Layers

Industry Preset (salon, cafe, repair_shop)
↓ determines defaults
Business Modes (appointments, commissions, retail)
↓ determines what's visible + enabled
Nav / Labels / Dashboard / POS Layout / Portal Tabs / Reports
↓ further filtered by
Permissions (role-based) + Feature Flags (operational toggles)
Key separation:

Presets = merchant identity (labels, nav, onboarding, sample data)
Modes = operational capabilities (workflow tables, APIs, features)
Country packs = compliance, localization, payment/courier availability
Nine Business Modes (All Built Except Manufacturing)
Mode What It Does Example Preset
retail POS, inventory, purchasing General retail, grocery, wholesale
restaurant Floor plans, checks, KDS, coursing Restaurant, cafe
appointments Calendar, services, public booking Salon, clinic, gym, photography
service_projects Quotations, projects, contracts Photography studio, event venue
subscriptions Recurring billing, memberships Gym, coworking, tuition center
workflow_tickets Intake, status board, deposits Repair shop, tailor, laundry
rentals Asset checkout/return, duration pricing Car rental, equipment hire, party supplies
room_management Room inventory, booking calendar, folios Hotel, guesthouse, hostel
treatment_plans Multi-visit plans, charting, consent Dental clinic, vet, physiotherapy
23 Live Presets (by Category)
Retail (4): retail, grocery, wholesale, textile

Food & Beverage (3): restaurant, cafe, butcher (meat shop)

Confections (2): sweet_shop, ice cream (via sweet_shop)

Services (7): salon, clinic, repair_shop, car_wash, gym, driving_school, photography_studio

Hospitality (3): hotel, guesthouse, hostel

Clinical (3): dental_clinic, veterinary, physiotherapy

Rentals (4): car_rental, equipment_hire, furniture_rental, party_supplies_rental

What Each Vertical Gets (M10 Complete Example — Clinical)
Dental Clinic Preset + Treatment Plans Mode
Tables added (M10):

treatment_plans — plan lifecycle (draft → active → on_hold → completed → invoiced)
treatment_sessions — per-visit charting
patient_subjects — pet/dependent entities
vital_signs — BP, HR, O2, temp, weight
prescriptions — medication tracking
chart_areas — per-tooth areas (32 adult + 20 primary, Universal notation) or body regions (physio) or dog/cat anatomy (vet)
session_chart_entries — treatment per area (code + status + notes)
lab_orders — procedure tracking
consent_forms — signature capture (native SignaturePad, R2-backed)
clinical_documents — PDF/image uploads (50MB cap)
treatment_folios — consolidate session fees + POS charges
treatment_folio_lines — detail line items
Frontend surfaces:

Plan detail tab UI (7 tabs: Overview / Sessions / Chart / Labs / Consent / Documents / Folio)
DentalChart component — interactive tooth diagram (32 adult + 20 primary)
BodyChart component — region grid for physio
POS context picker — "Charge to treatment plan" at checkout
Portal tab — "/portal/:slug/treatment-plans" with timeline, SOAP notes, chart (read-only), prescriptions, shared docs/labs
Workflows:

Create plan (draft) → add sessions → chart findings per-tooth/region → order labs → get consent signature → mark complete → generate folio + settle → invoice
Per-session SOAP notes (Subjective + Objective + Assessment + Plan)
Deposit pre-auth (adapter-agnostic, uses sandbox/xpay/manual)
Overdue worker + email notifications
Patient portal whitelists SOAP subjective, chart, prescriptions, and shared-only labs/docs
10 Adaptation Surfaces Across All Presets
Sidebar nav — Mode-gated items: Hospital shows "Floor Plan", clinic shows "Treatment Plans"
Labels — "Product" vs "Menu Item" vs "Service" vs "Treatment"
Dashboard widgets — Retail shows inventory alerts; service presets hide them
POS layout — Retail = grid (barcode search), restaurant = list (menu-style)
Onboarding steps — Restaurant: "Add menu item", "Set up floor plan", "Make order"
Receipt wording — "Customer:" vs "Patient:" vs "Guest:"
Reports visibility — Service presets hide Procurement, Multi-Channel
POS search fields — Service presets hide barcode + SKU
Sample data seeding — Restaurant gets 3 menu items + 2 modifiers; salon gets 5 services
Portal tabs — Apartment gets invoice pay + appointments + wallet; treatment gets invoice pay + appointments + treatment plans + stays
Public Customer-Facing Surfaces (New in v2)
Surface URL What It Does Presets Using
Public receipt /receipt/:invoiceNumber Shareable receipt link All
Public booking page /book/:tenantSlug Self-service appointment book appointment-based (salon, clinic, gym, car wash, etc.)
Customer portal /portal/:tenantSlug Invoice pay, self-service appts, profile, wallet All (preset-driven tabs)
My Stays /portal/:tenantSlug/stays Room booking history + linked invoices hotel, guesthouse, hostel
Treatment Plans /portal/:tenantSlug/treatment-plans Plan timeline, SOAP notes, chart, prescriptions, shared docs dental_clinic, veterinary, physiotherapy
Three Major Gaps Fixed After Audit (2026-04-15)
Nav gate fix (Gap 14.1) — Subscriptions nav now requires requiredMode: "subscriptions" + flag defaults to false to prevent all tenants seeing it
API exposure fix (Gap 8) — 5 phase4 flags flipped to false; API endpoints now gate on requireMode() not just flag
Data integrity fix (Items 9-10) — Decimal quantity columns widened to NUMERIC(10,3) for weighted selling (stock, returns, adjustments)
19 High-Priority Items Shipped in M10 Closeout (2026-04-15)
Wave 1: Flag architecture + data integrity (5 flags gated, stock columns widened, migration v44-45)
Wave 2: Clinical readiness (clinical nav, portal "My Stays" + "Treatments", signature capture, E2E clinical onboarding tests, migration v33)
Wave 3: Demand-driven (treatment templates, nav split for service_projects, booking deposits schema, PWA prompt, wallet top-up, reserved room page schema, POS staff_id, saved-card tokenization)
Current Development Direction (Post-M10)
NOT building 54 separate mini-products.

Building: One strong shared core + preset configuration layers.

Next priorities:

POS offline durability — Replace localStorage with IndexedDB
Payment lifecycle maturity — Finish xPay saved-card integration
POS state architecture — Split large POS context into domain modules
Audit + reconciliation — Duplicate-payment detection, reconciliation screens
Typed API contracts — Zod/OpenAPI for high-risk flows
Operational observability — Metrics + alerts for checkout latency, failed payments, queue depth
Device/hardware layer — Scanner/printer/cash-drawer integration
Manufacturing only on demand — Build M11 when factory customer commits
Code Artifacts (What Actually Exists)
Backend files added/modified:

backend/config/industry-config.js — Preset definitions (23 presets, all labels, modes, dashboard, onboarding)
backend/config/country-packs.js — 23 country configs
backend/routes/treatment-plan-templates.js — Template CRUD
backend/routes/service-tickets.js — Ticket workflow
backend/routes/rentals.js — Asset checkout/return
backend/routes/rooms.js — Room inventory + booking
backend/routes/treatment-plans.js — Clinical plans
backend/routes/customer-portal/ — 8 portal endpoints
backend/seeds/preset-seed-data.js — Sample data per preset
Migrations v31-49 (19 migrations across 10 features)
Frontend files added/modified:

frontend/src/contexts/PresetContext.jsx — Label + mode provider
frontend/src/pages/SetupWizard.jsx — 5-step wizard with industry picker
frontend/src/pages/portal/PortalLayout.jsx — Portal auth + preset-driven tabs
frontend/src/pages/portal/PortalStays.jsx — Room booking history
frontend/src/pages/RentalsRedesign.jsx — Asset checkout/return UI
frontend/src/pages/RoomsRedesign.jsx — Room inventory + calendar
frontend/src/pages/TreatmentPlansRedesign.jsx — 7-tab plan detail
frontend/src/components/DentalChart.jsx — Interactive tooth diagram
frontend/src/components/BodyChart.jsx — Region grid for physio
frontend/src/ui/PwaInstallPrompt.jsx — App install banner
Navigation filters in AppLayoutRedesign.jsx check requiredMode
SanoPay Sandbox Infrastructure (Critical for Future Features)
Both local dev AND Railway have PAYMENT_GATEWAY=sandbox wired for end-to-end payment testing without real money. Every payment-touching feature must have tests driven through the sandbox.

Files:

backend/services/payment-gateway.js — Adapter dispatcher (sandbox, xpay, manual)
backend/routes/sandbox.js — Fake payment page + webhook simulator
backend/tests/integration/pg-sandbox-payment.test.js — Template for all payment tests
Key Rule Going Forward
Before adding a new preset, ask:

Can an existing mode handle this with labels, nav, sample data, portal defaults?
Is the missing piece a small extension to a current mode?
Is this actually a new operational mode?
Will improving the core solve this for many industries at once?
Build a new mode only when #3 is clearly yes. Otherwise, improve the core or add preset configuration.

TL;DR: You have a three-layer preset engine shipping 23 presets across 9 business modes covering ~48 of 54 industries. Every appointment-based business has a public booking URL, every rental business has asset tracking, every hospitality business has a room management system, and every clinical practice has a full treatment planning platform with multi-visit charting, SOAP notes, consent forms, and a patient portal. The architecture is stable, the core is strong, and the next work is hardening that core rather than adding more vertical sprawl.

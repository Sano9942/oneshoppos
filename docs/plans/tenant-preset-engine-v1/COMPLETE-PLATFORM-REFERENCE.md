# SanoPOS Complete Platform Reference

**Date:** 2026-04-16  
**Purpose:** Single unified source of truth consolidating all strategic architecture, gap analysis, competitive research, and implementation spec for the tenant preset engine, business modes, industry presets, country packs, and core platform direction.

**This document supersedes and merges:**
- `sanopos-54-industry-coverage-matrix.md` (industry assessment, six-layer model, global build order)
- `square-complete-platform-research.md` (competitive benchmarking, Square's 7 modes, gaps, strategic takeaways)
- `tenant-preset-engine-v1/strategy.md` (implementation spec, M1-M10 delivery, architecture, code artifacts, SanoPay sandbox)

**Rule of thumb:** This document is the canonical reference for all future work. When questions arise about architecture, business model strategy, industry coverage, competitive positioning, or platform direction — **refer here first.**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Operating Model](#2-platform-operating-model)
3. [Global Six-Layer Architecture](#3-global-six-layer-architecture)
4. [Business Modes (9 Total)](#4-business-modes-9-total)
5. [Industry Presets (23 Live)](#5-industry-presets-23-live)
6. [Industry Coverage Assessment (54 Industries)](#6-industry-coverage-assessment-54-industries)
7. [Country Packs & Localization](#7-country-packs--localization)
8. [Three-Layer Architecture Interaction](#8-three-layer-architecture-interaction)
9. [Modes vs Flags Design Pattern](#9-modes-vs-flags-design-pattern)
10. [Bootstrap Payload Architecture](#10-bootstrap-payload-architecture)
11. [Configuration Tables for Scalability](#11-configuration-tables-for-scalability)
12. [Capability Model & Metadata](#12-capability-model--metadata)
13. [Competitive Landscape: Square Analysis](#13-competitive-landscape-square-analysis)
14. [Square's 7 POS Modes](#14-squares-7-pos-modes)
15. [Square Pricing & Tiers](#15-square-pricing--tiers)
16. [Square's Strengths & Weaknesses](#16-squares-strengths--weaknesses)
17. [SanoPOS vs Square Feature Gap Analysis](#17-sanopos-vs-square-feature-gap-analysis)
18. [Strategic Takeaways for SanoPOS](#18-strategic-takeaways-for-sanopos)
19. [SanoPOS Competitive Positioning](#19-sanopos-competitive-positioning)
20. [Tenant Preset Engine v1 & v2 Implementation](#20-tenant-preset-engine-v1--v2-implementation)
21. [Current Delivery Status (M1-M10)](#21-current-delivery-status-m1-m10)
22. [Complete Gap & Deferred Item Registry (25 Items)](#22-complete-gap--deferred-item-registry-25-items)
23. [SanoPay Sandbox Infrastructure](#23-sanopay-sandbox-infrastructure)
24. [Core-First Platform Direction (Post-M10)](#24-core-first-platform-direction-post-m10)
25. [Next 8 Improvement Priorities](#25-next-8-improvement-priorities)
26. [Global Build Order & Phases](#26-global-build-order--phases)
27. [Product Rule: When to Add New Presets](#27-product-rule-when-to-add-new-presets)
28. [Recommended Merchant Onboarding Experience](#28-recommended-merchant-onboarding-experience)
29. [Code Artifacts & Implementation Details](#29-code-artifacts--implementation-details)
30. [Deferred Work & Out-of-Scope Features](#30-deferred-work--out-of-scope-features)

---

## 1. Executive Summary

SanoPOS is architected as a **multi-vertical, composable commerce platform** designed to compete with Square at breadth, Toast at depth (restaurants), and local solutions at cost and compliance.

**Core Principle:** One global commerce platform + business modes (operational capabilities) + industry presets (merchant identity) + country packs (compliance/localization) = a product that feels purpose-built for each merchant without code forks.

**Current Reality:**
- **23 industry presets live** covering ~48 of 54 assessed industries
- **9 business modes built and shipped** (retail, restaurant, appointments, service_projects, subscriptions, workflow_tickets, rentals, room_management, treatment_plans)
- **v1 Complete** (M1-M4, shipped 2026-04-14): core preset engine + 3 retail/food/service presets + workflow tickets
- **v2 Shipped** (M5-M10, shipped 2026-04-14 to 2026-04-15): weight-based selling, online public booking, customer portal, rentals, room management, treatment plans
- **M11 (Manufacturing) Deferred** until a factory/production customer commits

**Next Phase:** Not more verticals. Focus on **hardening the shared core** — POS offline durability, payment lifecycle maturity, state architecture refactoring, audit/reconciliation, typed API contracts, operational observability, and hardware layer depth.

---

## 2. Platform Operating Model

### The Vision

SanoPOS operates as **one codebase with many faces** — similar to how Shopify serves retail and F&B with the same backend, or how Square uses modes to transform a unified POS into restaurant/bookings/retail variants.

### Three-Part System

| Component | What It Does | Example |
|-----------|-------------|---------|
| **Shared Core** | Universal commerce foundation for all business types | POS, inventory, customers, employees, payments, reports, accounting, loyalty, portal, receipts |
| **Business Modes** | Operational workflows that enable industry-specific features | restaurant floor plans, appointment calendar, subscription billing, rental returns |
| **Industry Presets** | Configuration that makes the product feel purpose-built | labels ("Service" vs "Product"), nav groups, dashboard widgets, onboarding checklist, sample data |

### Key Difference from Single-Vertical Apps

- **Vertical app**: Each industry is a separate codebase. Retail app, restaurant app, salon app, etc.
- **SanoPOS**: One codebase, shared core, modes unlocked per tenant, presets configured per tenant.

When SanoPOS improves the POS, every tenant in every industry gets better. When SanoPOS adds a new preset (e.g., veterinary clinic), it reuses the appointment mode (already built) and adds label/nav config. No new core workflow code.

---

## 3. Global Six-Layer Architecture

To support global scale (multiple countries, multiple business types), the platform is organized in six distinct layers:

### Layer 1: Global Core
The shared foundation every merchant type needs:
- Tenants, outlets, locations
- Product catalog (categories, variants, pricing)
- Inventory (stock tracking, transfers, adjustments)
- Cart and checkout
- Customers and customer groups
- Employees, roles, permissions
- Sales, returns, refunds
- Invoices and estimates
- Reports and analytics
- Audit logs and action history
- Payment abstraction (adapter pattern)
- Customer portal

**Key trait:** Intentionally generic. No industry-specific tables or logic — those live in higher layers.

### Layer 2: Business Modes
Core operational capabilities. Each mode is a collection of tables, APIs, and UI surfaces that enable a specific type of workflow:

- `retail` — inventory checkout, barcode scanning
- `restaurant` — floor plans, checks, coursing, KDS, table management
- `appointments` — calendar, staff assignment, public booking, no-show policies
- `service_projects` — quotations, projects, contracts, milestone billing
- `subscriptions` — recurring billing, auto-charge, customer plans, renewal management
- `workflow_tickets` — intake, status boards, deposits, invoices
- `rentals` — asset checkout/return, contracts, damage deposits
- `room_management` — room inventory, folios, arrivals/departures, room states
- `treatment_plans` — multi-visit clinical plans, SOAP charting, consent, labs, prescriptions
- `manufacturing` — *(deferred M11)* BOMs, work orders, production costing

**Key trait:** Modes are orthogonal — a tenant can enable multiple modes. A salon can add retail inventory. A retail store can add subscriptions and appointments.

### Layer 3: Country Layer
Formal localization for each country's rules:
- Country code
- Tax regime (VAT, GST, FBR, etc.)
- Currency and symbol
- Invoice/receipt/compliance rules
- Timezone and locale
- Allowed payment providers
- Allowed shipping/courier providers
- SMS provider availability (Telenor, Zong, etc.)
- Regional compliance flags (e.g., FBR digital invoicing for PK)

**Key trait:** Isolation. Country logic does not leak into business-mode logic.

### Layer 4: Industry Presets
Configuration layer that controls how the product feels without changing core logic:
- Recommended default modes
- Labels ("Service" vs "Product", "Guest" vs "Customer")
- Sidebar nav visibility and grouping
- Dashboard widget configuration
- POS layout mode (grid vs list)
- Onboarding checklist steps
- Sample data seeds (e.g., restaurant gets menu items, salon gets services)
- Portal tabs enabled
- Report visibility
- Unit vocabulary for the industry

**Key trait:** All configuration, no code forks. Two restaurants can run the same backend code but see completely different UIs if their presets differ.

### Layer 5: Integration Layer
Every external capability is hidden behind an adapter:
- Payment providers (xPay, SandoPay sandbox, manual)
- Shipping/courier adapters (13 total: leopards, TCS, BlueEx, etc.)
- Ecommerce channels (Shopify, WooCommerce, Daraz, Facebook, WhatsApp)
- Accounting exports (FBR, tax reconciliation)
- SMS providers (Telenor, Zong, JazzCash)
- Email (Resend, SMTP)

**Key trait:** Code never hardcodes a specific provider. A feature that uses payments works with any adapter.

### Layer 6: Extension Data Model
Not every industry-specific field belongs in the core:
- Core tables stay generic
- Mode-specific tables hold mode workflows
- Extension tables hold deep vertical data

Examples:
- Core: `customers` table with name, phone, address
- Extension: `customer_medical_profiles` for clinical tenants (blood_group, allergies, medical_notes, insurance_id, emergency_contact)
- Extension: `rental_items` for rental mode (asset description, condition tracking)
- Extension: `room_bookings` for hospitality (room assignment, folio state)

**Key trait:** Scalability. As new verticals are added, they extend the platform rather than bloating the core.

---

## 4. Business Modes (9 Total)

### Overview

| Mode | Status | What It Enables | Tables Added | Frontend Surfaces |
|------|--------|-----------------|---------------|----|
| **retail** | Done | Standard POS checkout, inventory, barcode scanning | N/A (implicit base) | POS, inventory pages |
| **restaurant** | Done | Floor plans, table sessions, checks, coursing, KDS, QR ordering | `restaurant_floor_plans`, `restaurant_floor_sections`, `restaurant_table_sessions`, `restaurant_checks`, `restaurant_check_items`, `restaurant_check_seats`, `restaurant_course_fires`, `kds_stations`, `kds_tickets`, `kds_station_routes`, `restaurant_tabs`, `restaurant_preauth_holds`, `restaurant_check_adjustments` | Floor Plan page, Checks page, KDS page, Table context in POS |
| **appointments** | Done | Calendar, staff assignment, services, public booking, reminders, no-shows | `booking_services`, `appointments`, `calendar_events` | Appointments page, Calendar, Public booking page (`/book/:slug`) |
| **service_projects** | Done | Quotations, projects, contracts, milestone billing | `service_projects`, `project_milestones`, `project_contracts`, `contract_milestones` | Projects page, Contracts page, Quotations page |
| **subscriptions** | Done (provider pending) | Customer plans, recurring charges, pause/resume/cancel, renewal management | `subscription_plans`, `customer_subscriptions`, `subscription_runs` | Subscriptions page, Customer subscription management, Renewal worker |
| **workflow_tickets** | Done | Service intake, status board, tickets, deposits, invoice generation | `workflow_tickets`, `ticket_comments`, `ticket_attachments` | Service Tickets page, Status board |
| **rentals** | Done | Asset catalog, checkout, rental contracts, returns, overdue tracking | `rental_items`, `rental_contracts`, `rental_contract_items`, `rental_payments` | Rentals page, Asset inventory, Return management |
| **room_management** | Done | Room inventory, room types, booking calendar, folios, arrivals/departures | `rooms`, `room_types`, `room_bookings`, `room_folios`, `room_folio_items` | Rooms page, Booking calendar, Room inventory, Stays portal tab |
| **treatment_plans** | Done | Multi-visit plans, SOAP charting, labs, consent forms, prescriptions | `treatment_plans`, `treatment_sessions`, `treatment_notes`, `treatment_lab_orders`, `treatment_templates`, `patient_subjects`, `vital_signs`, `prescriptions`, `chart_areas`, `session_chart_entries`, `lab_orders`, `consent_forms`, `clinical_documents`, `treatment_folios` | Treatment Plans page (7 tabs), DentalChart component, BodyChart component, Plan-charging in POS |
| **manufacturing** | Deferred M11 | BOMs, work orders, production costing, production dashboard | TBD | TBD |

### Design Rule: Modes Are Orthogonal

A tenant can enable any combination of modes. Examples:
- Retail store: `retail` only
- Restaurant: `retail` + `restaurant`
- Salon with products: `retail` + `appointments`
- Clinic: `appointments` + `treatment_plans`
- Service business: `service_projects` + `workflow_tickets`

**Invalid:** A mode cannot contradict another. A `restaurant` with `room_management` doesn't conflict (possible for a bed-and-breakfast that serves food).

---

## 5. Industry Presets (23 Live)

Presets are **merchant-facing identity configurations**. Each preset is a named set of defaults that control how the product feels.

### By Category

#### Retail (4 Presets)
- `retail` — General merchandise, supermarkets, pharmacies, gift shops, pet shops, toy stores, furniture, jewelry, eyewear, auto parts
- `grocery` — Supermarkets with barcode-heavy inventory, fresh goods categories
- `wholesale` — B2B distribution, bulk selling, price lists, supplier payables
- `textile` — Fabric/meter-based selling (foundational, meter UX not specialized)

#### Food & Beverage (5 Presets)
- `restaurant` — Full-service sit-down dining, floor plans, coursing, KDS
- `cafe` — Quick-service café, counter service, simpler menu
- `butcher` — Meat shop with weight-based selling
- `sweet_shop` — Confections, pastries (foundational, weight UX not specialized)
- `ice_cream` — Ice cream parlor (via sweet_shop preset with modifiers)

#### Services (9 Presets)
- `salon` — Hair, nail, spa, barbershop — appointments, services, staff commissions, retail products
- `clinic` — General medical clinic with bookings, invoicing (not clinical workflows)
- `repair_shop` — Repairs, service intake, quotations, projects
- `car_wash` — Service business, vehicle-agnostic workflows
- `gym` — Membership/subscriptions, check-in (not automated)
- `photography_studio` — Bookings, projects, contracts, invoices
- `driving_school` — Lessons via appointments + billing
- `coworking_space` — Resource booking + subscriptions

#### Hospitality (3 Presets)
- `hotel` — Rooms, rates, bookings, folios, arrivals/departures, per-night billing
- `guesthouse` — Smaller hotel, same room management workflows
- `hostel` — Dormitory-style rooms, still use room folio model

#### Clinical (3 Presets)
- `dental_clinic` — Treatment plans, dental charting, SOAP notes, consent, multi-visit
- `veterinary` — Treatment plans, pet patient records, vaccination, body charting
- `physiotherapy` — Treatment plans, body-region charting, SOAP notes, exercises, multi-visit

#### Rentals (4 Presets)
- `car_rental` — Vehicle rentals, contracts, damage deposits, overdue alerts
- `equipment_hire` — Equipment checkout, duration pricing, returns
- `furniture_rental` — Furniture rental model, damage tracking
- `party_supplies_rental` — Event supplies rental, bulk returns

### Preset Definition Example

```javascript
const PRESET_CONFIG = {
  salon: {
    // Merchant identity
    industry_type: 'salon',
    business_model: 'service_appointment',
    
    // Default modes enabled at signup
    default_modes: ['appointments', 'commissions'],
    
    // Labels for this industry
    labels: {
      product: 'Service',
      customer: 'Client',
      sale: 'Appointment',
      unit: 'session'
    },
    
    // Nav groups to show
    nav_groups: [
      'Overview', 'Appointments', 'Services', 'Team',
      'Operations', 'Marketing & Billing', 'Insights', 'Setup'
    ],
    
    // Dashboard widgets
    dashboard_widgets: [
      'revenue_today', 'appointment_count', 'service_performance',
      'team_performance', 'client_retention'
    ],
    
    // POS layout mode
    pos_layout: 'service_list', // not product_grid
    
    // Portal tabs for customers
    portal_enabled_tabs: [
      'invoices', 'appointments', 'wallet', 'profile'
    ],
    
    // Onboarding checklist
    onboarding_steps: [
      'Add services',
      'Set staff and commissions',
      'Configure schedule',
      'Add first appointment'
    ],
    
    // Sample data (seeded at tenant creation)
    sample_data: {
      services: [
        { name: 'Haircut', price: 500, duration_minutes: 30 },
        { name: 'Hair Color', price: 2000, duration_minutes: 90 }
      ],
      staff: [
        { name: 'Aisha', role: 'Stylist', commission_pct: 30 }
      ]
    }
  }
}
```

### Preset Mapping to Modes

Not all presets map to all modes. Instead, each preset declares which modes are default + recommended:

| Preset | Default Modes | Can Add Later |
|--------|---------------|---------------|
| Retail | retail | appointments, subscriptions, loyalty |
| Restaurant | retail + restaurant | appointments, loyalty, subscriptions |
| Salon | appointments | retail, subscriptions |
| Clinic | appointments | treatment_plans |
| Hotel | room_management | appointments, subscriptions |
| Dental Clinic | appointments + treatment_plans | — |
| Rental Business | rentals | workflow_tickets, subscriptions |

---

## 6. Industry Coverage Assessment (54 Industries)

A comprehensive assessment was conducted in April 2026 across 54 industries. The assessment measured readiness into three categories:

### Status Key

| Status | Definition | Example |
|--------|-----------|---------|
| **Now** | SanoPOS can credibly serve this industry today with current modules and workflows | General Retail, Restaurant, Salon |
| **Partial** | SanoPOS has enough foundations to be workable, but still lacks industry-specific depth or UX | Butcher (has weight support but not specialized), Gym (has subscriptions but not check-in) |
| **Not Yet** | SanoPOS does not yet have the dedicated workflow or domain model | Dental Clinic (pre-M10), Hotel (pre-M9), Manufacturing |

### Summary

| Status | Count | Industries |
|--------|-------|-----------|
| **Now** | 28 | Retail, Grocery, Electronics, Pharmacy, Bookstore, Hardware, Cosmetics, Pet Shop, Toy Store, Sports Equipment, Furniture, Jewelry, Optical, Gift Shop, Auto Parts, Wholesale, Tobacco, Art Supply, Musical Instruments, Garden/Nursery, Printing/Copy Shop, Bakery/Cafe, Fast Food, Food Truck, Photography Studio, Full-Service Restaurant, Salon/Barbershop/Spa, Convenience Store |
| **Partial** | 20 | Sweet Shop, Ice Cream, Florist, Butcher, Dry Fruits/Spice, Tailor, Laundry, Car Wash, Medical Clinic, Gym, Repair Shop, Tuition Center, Driving School, Coworking, Event Venue, Courier Office, Kiryana (credit book), Textile, Fertilizer, Atta Chakki |
| **Not Yet** | 6 | Dental Clinic (now Done via M10), Veterinary (now Done via M10), Rental Business (now Done via M7), Hotel (now Done via M9), Medical Lab, Dastarkhwan (Charity Kitchen), Manufacturing |

### Current Reality (Post-M10)

With M5-M10 shipped:
- **Dental Clinic, Veterinary, Physiotherapy:** Now Done (treatment_plans mode + clinical presets)
- **Rental Business, Car Rental, Equipment Hire, Furniture Rental, Party Supplies:** Now Done (rentals mode)
- **Hotel, Guesthouse, Hostel:** Now Done (room_management mode)

**Remaining "Not Yet":**
- Medical Lab (no lab workflow, result reporting)
- Dastarkhwan / Charity Kitchen (no donor/distribution/non-commercial workflow)
- Manufacturing (no BOM, work orders, production dashboard)

**Updated count:** ~48 of 54 industries fully supported; 6 still need dedicated workflows.

### Why Some Industries Are Still Partial

Industries stay "Partial" when they need:
- Specialized weight- or meter-first selling UX
- Dedicated measurement or custom-fields framework
- Industry-specific ticketing or intake model
- Check-in or resource-booking UX
- Specialized compliance or licensing
- Multi-visit charting or medical records

**Key insight:** Adding a new preset almost never requires new core code if the right mode exists. New presets are mostly configuration (labels, nav, onboarding) unless the business model is genuinely different.

---

## 7. Country Packs & Localization

### 23 Country Packs Live

| Region | Countries |
|--------|-----------|
| South Asia | PK, BD, IN |
| Middle East | AE, SA, OM |
| Africa | NG, KE, GH, ZA, EG |
| Europe | GB, DE, FR, NL |
| Asia Pacific | SG, MY, ID, PH, NZ, AU |
| Americas | US, CA |
| Other | OTHER (fallback) |

**Total: 23 country configurations**

### What a Country Pack Controls

| Aspect | Example |
|--------|---------|
| **Tax regime** | Pakistan = FBR digital invoicing; US = state-by-state sales tax; UAE = VAT 5% |
| **Currency** | PK = PKR (₨), US = USD ($), UAE = AED (د.إ) |
| **Invoice/receipt rules** | FBR = mandatory IRN + QR code; EU = GDPR data retention; US = no special requirement |
| **Timezone** | PK = Asia/Karachi, US = America/New_York (configurable per outlet) |
| **Locale** | PK = Urdu/English, AE = Arabic/English |
| **Allowed payment providers** | PK = SanoPay (custom), JazzCash, Easypaisa; US = Square, Stripe; UAE = PayFort, 2Checkout |
| **Allowed shipping providers** | PK = TCS, Leopards, BlueEx, MNP; US = FedEx, UPS, USPS; UAE = Smsa Express, Aramex |
| **SMS provider availability** | PK = Telenor, Zong, Ufone; US = Twilio; UAE = Etisalat, du |
| **Compliance toggles** | FBR = true (PK); GDPR = true (EU); Data residency = in-country or cross-border |

### Design Rule: Country vs Mode vs Preset Isolation

A preset (e.g., "Hotel") combined with a country (e.g., "AE") should work without conflicts:
- Preset = "what kind of business"
- Country = "which rules apply"
- Mode = "what workflows are enabled"

These are independent dimensions.

---

## 8. Three-Layer Architecture Interaction

### Flow: How Preset, Mode, Country Work Together

When a merchant signs up for a hotel in the UAE:

```
1. Merchant selects: Business Type = "Hotel"
   → industry_type = 'hotel'
   → country_code = 'AE'

2. System loads preset config:
   → default_modes = ['room_management', 'appointments']
   → labels: "Guest", "Room Night", "Folio"
   → nav_groups: ['Overview', 'Rooms', 'Bookings', 'Guests', 'Invoicing', 'Setup']
   → sample_data: 3 room types, checkout flow

3. System creates tenant_modes rows:
   → INSERT tenant_modes (tenant_id, mode_name, enabled_at)
      VALUES (hotel_tenant, 'room_management', now())
   → INSERT tenant_modes (hotel_tenant, 'appointments', now())

4. System loads country pack ('AE'):
   → currency = 'AED'
   → tax_regime = 'UAE_VAT_5PCT'
   → allowed_payment_providers = ['payfort', 'checkout']
   → zone_delivery_providers = ['smsa', 'aramex']

5. UI assembles:
   → Nav = room_management + appointments items (mode-gated)
   → Labels = "Guest" (not "Customer"), "Room" (not "Product")
   → Dashboard = room occupancy, upcoming arrivals, revenue/folio metrics
   → POS = Room selector + amount input (not product barcode grid)
   → Portal = Stays tab + Invoices tab (room_management + appointments modes)

6. API returns bootstrap:
   {
     tenant_id, industry_type: 'hotel', country_code: 'AE',
     enabled_modes: ['room_management', 'appointments'],
     labels: { guest: 'Guest', room_night: 'Room Night', ... },
     portal_enabled_tabs: ['stays', 'invoices', 'profile'],
     currency: 'AED', timezone: 'Asia/Dubai',
     features: { fbr: false, fax_integration: false, ... },
     capabilities: [
       { key: 'room_management', available: true, requires_mode: 'room_management' },
       { key: 'appointments', available: true, requires_mode: 'appointments' },
       { key: 'walkin_checkin', available: true, requires_mode: 'room_management' }
     ]
   }
```

### Isolation Rules

| Layer | Cannot interfere with | Why |
|-------|----------------------|-----|
| Preset | Mode availability | Presets recommend modes; don't force them |
| Mode | Country rules | Modes don't know about tax or payment availability |
| Country | Preset labels | Countries don't override merchant identity |

---

## 9. Modes vs Flags Design Pattern

### The Problem: Current Flag-Based System

The current feature flag system (`feature_flags` table, 65+ flags) conflates two different concepts:

1. **Operational toggles** — "is AI insights enabled?" (depends on external API key + plan tier)
2. **Business identity** — "is this a restaurant?" (a business model, not a toggle)

**Problems this creates:**
- No single source of truth — "is this a restaurant?" is scattered across 3-4 flags
- Invalid combinations possible — nothing prevents a retail tenant having all restaurant flags true
- Flag explosion — 65 flags today, would need 30+ more for 6 modes × 15 presets
- Hard to reason about — debugging requires reading 65 booleans to understand a tenant's business
- Slow to extend — each new capability = new flag + nav-config entry + setup-time write

### The Solution: Separate Concept

**Flags** (new definition) = genuinely optional operational toggles. External dependencies, plan-tier features, experimental toggles.

**Modes** (new concept) = a `tenant_modes` table where each enabled mode means "this tenant's business operates this way."

### Migration Example: Restaurant Flags → Mode

| Old (Flags) | New (Mode) | Result |
|------------|-----------|--------|
| `phase4_restaurant`, `phase4_restaurant_kds`, `phase4_restaurant_qr`, `phase4_restaurant_preauth` | Single `restaurant` mode row | When restaurant mode enabled, all restaurant features available |
| `phase4_appointments`, `phase4_appointments_waitlists` | Single `appointments` mode row | When appointments mode enabled, full appointment workflow available |
| `phase2_commissions` | Part of business-model concept | Commissions are part of service_appointment and restaurant models |

### How Modes Gate Features

**Old way (flag-based):**
```javascript
// In route handler
if (!hasPerm('manage_restaurant') || !flag('phase4_restaurant')) {
  return res.status(403).json({ error: 'Not available' });
}
```

**New way (mode-based):**
```javascript
// In route handler
requireMode('restaurant')
// + optionally requirePerm if needed
```

**In nav:**
```javascript
// Old way
{
  label: 'Floor Plan',
  path: '/floor-plan',
  requiredFlag: 'phase4_restaurant',
  requiredPerm: 'manage_restaurant'
}

// New way
{
  label: 'Floor Plan',
  path: '/floor-plan',
  requiredMode: 'restaurant',
  requiredPerm: 'manage_restaurant'
}
```

---

## 10. Bootstrap Payload Architecture

### What Bootstrap Is

When a user logs in, the frontend needs to understand:
- What country is this tenant in?
- What modes are enabled?
- What industry preset is active?
- What labels should be used?
- What nav groups should be visible?
- What portal tabs should render?
- What capabilities are available?
- What permissions does this user have?

Rather than making N separate API calls, the backend returns a single **bootstrap payload** with all this context.

### Bootstrap Payload Structure

```javascript
{
  // Tenant context
  tenant_id: 'uuid',
  tenant_slug: 'hotel-karachi',
  tenant_name: 'Pearl Hotel',
  industry_type: 'hotel',
  country_code: 'PK',
  
  // Business model
  enabled_modes: ['room_management', 'appointments'],
  default_mode: 'room_management',
  
  // Labels & language
  labels: {
    product: 'Room',
    service: 'Service',
    customer: 'Guest',
    sale: 'Folio',
    unit: 'night'
  },
  
  // Navigation
  nav_groups: [
    'Overview', 'Rooms', 'Bookings', 'Guests', 'Invoicing', 'Setup'
  ],
  
  // Portal & customer-facing
  portal_enabled_tabs: [
    'stays', 'invoices', 'appointments', 'profile', 'wallet'
  ],
  
  // POS specific
  pos_layout_mode: 'room_selector',
  pos_enabled_features: [
    'split_folio', 'post_charge_to_room', 'comp_item', 'void_item'
  ],
  
  // Dashboard
  dashboard_widgets: [
    'occupancy_rate',
    'upcoming_arrivals',
    'revenue_this_month',
    'average_folio_value'
  ],
  
  // Reporting
  enabled_reports: [
    'occupancy', 'folio_summary', 'guest_ledger', 'room_performance'
  ],
  
  // Localization
  currency: 'PKR',
  currency_symbol: '₨',
  timezone: 'Asia/Karachi',
  locale: 'ur-PK',
  
  // Capabilities & feature availability
  capabilities: [
    {
      key: 'room_management',
      available: true,
      requires_mode: 'room_management',
      requires_country_support: null
    },
    {
      key: 'appointment_booking',
      available: true,
      requires_mode: 'appointments',
      requires_country_support: null
    },
    {
      key: 'fbr_digital_invoicing',
      available: true,
      requires_mode: null,
      requires_country_support: 'PK'
    },
    {
      key: 'payment_gateway',
      available: true,
      gateway_type: 'sandbox'
    }
  ],
  
  // User permissions
  user_permissions: [
    'view_all_outlets',
    'manage_rooms',
    'manage_appointments',
    'view_reports'
  ],
  
  // Feature flags (only genuinely external ones)
  feature_flags: {
    ai_insights: false,
    marketplace_integrations: false,
    fbr_integration: true,
    fax_integration: false
  },
  
  // Outlets/locations
  outlets: [
    {
      id: 'outlet-1',
      name: 'Pearl Hotel Karachi',
      address: '...',
      timezone: 'Asia/Karachi',
      is_primary: true
    }
  ]
}
```

### How Frontend Uses Bootstrap

```javascript
// In AppLayout.jsx or similar
const bootstrap = useContext(BootstrapContext);

// Render nav based on enabled_modes
const nav = NAV_CONFIG.filter(item => 
  !item.requiredMode || bootstrap.enabled_modes.includes(item.requiredMode)
);

// Use labels from bootstrap
<h1>{bootstrap.labels.customer} Profile</h1> // "Guest Profile"

// Show/hide dashboard widgets
{bootstrap.dashboard_widgets.includes('occupancy_rate') && (
  <OccupancyWidget />
)}

// Conditionally render portal tabs
{bootstrap.portal_enabled_tabs.includes('stays') && (
  <Tab label="My Stays" content={<PortalStays />} />
)}
```

### Performance & Caching

- Bootstrap is cached at the tenant level (15-60 min TTL)
- Changes trigger invalidation: mode enable/disable, preset switch, flag toggle
- Stale bootstrap is acceptable (UI doesn't break if slightly out of date)

---

## 11. Configuration Tables for Scalability

### Why Configuration Tables?

As SanoPOS scales beyond 20 presets and 10 modes, hardcoding config in JavaScript becomes unmaintainable. Configuration tables in Postgres allow:
- Admin UI to edit presets/modes
- Versions and rollback
- A/B testing different configurations
- Per-tenant overrides

### Recommended Tables

#### `business_modes`
Canonical list of all business modes:

```sql
CREATE TABLE business_modes (
  id SERIAL PRIMARY KEY,
  mode_name VARCHAR(50) UNIQUE, -- 'restaurant', 'appointments', etc.
  display_label VARCHAR(100),
  description TEXT,
  icon_class VARCHAR(50),
  default_priority INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

INSERT INTO business_modes VALUES
  (1, 'retail', 'Retail POS', '...', 'icon-store', 10, now(), now()),
  (2, 'restaurant', 'Restaurant', '...', 'icon-utensils', 20, now(), now()),
  ...
```

#### `tenant_enabled_modes`
Which modes are enabled for each tenant:

```sql
CREATE TABLE tenant_enabled_modes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES company_profile(account_id),
  mode_name VARCHAR(50) REFERENCES business_modes(mode_name),
  enabled_at TIMESTAMP,
  enabled_by_user_id UUID,
  priority INT DEFAULT 100,
  UNIQUE(tenant_id, mode_name)
);
```

#### `industry_presets`
Canonical list of presets and their defaults:

```sql
CREATE TABLE industry_presets (
  id SERIAL PRIMARY KEY,
  preset_name VARCHAR(100) UNIQUE, -- 'salon', 'hotel', etc.
  display_label VARCHAR(100),
  category VARCHAR(50), -- 'retail', 'food', 'services', 'hospitality', 'clinical', 'rental'
  description TEXT,
  default_modes JSONB, -- ['appointments', 'commissions']
  labels JSONB, -- { product: 'Service', customer: 'Client', ... }
  nav_groups TEXT[], -- ['Overview', 'Appointments', ...]
  dashboard_widgets JSONB,
  pos_layout_mode VARCHAR(50),
  portal_enabled_tabs TEXT[],
  sample_data JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### `country_packs`
Localization per country:

```sql
CREATE TABLE country_packs (
  id SERIAL PRIMARY KEY,
  country_code CHAR(2) UNIQUE,
  country_name VARCHAR(100),
  currency_code CHAR(3),
  currency_symbol VARCHAR(5),
  timezone VARCHAR(50),
  locale VARCHAR(10),
  tax_regime VARCHAR(50),
  fbr_integration_enabled BOOLEAN,
  allowed_payment_providers TEXT[],
  allowed_courier_providers TEXT[],
  allowed_sms_providers TEXT[],
  vat_rate NUMERIC(5,2),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### `tenant_mode_settings`
Per-tenant customizations of mode behavior:

```sql
CREATE TABLE tenant_mode_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES company_profile(account_id),
  mode_name VARCHAR(50),
  setting_key VARCHAR(100), -- e.g. 'allow_negative_stock', 'require_deposit_for_service'
  setting_value JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tenant_id, mode_name, setting_key)
);
```

#### `tenant_localization_settings`
Per-tenant language/locale overrides:

```sql
CREATE TABLE tenant_localization_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES company_profile(account_id),
  language_code VARCHAR(10),
  labels JSONB, -- tenant-specific label overrides
  messages JSONB, -- localized messages
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tenant_id, language_code)
);
```

#### `integration_providers`
Available third-party integrations:

```sql
CREATE TABLE integration_providers (
  id SERIAL PRIMARY KEY,
  provider_name VARCHAR(100) UNIQUE,
  provider_type VARCHAR(50), -- 'payment', 'courier', 'accounting', 'sms', 'ecommerce'
  is_active BOOLEAN DEFAULT true,
  supported_countries TEXT[],
  required_config JSONB, -- what fields must be set up
  api_version VARCHAR(50),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### `tenant_integrations`
Which integrations are active for a tenant:

```sql
CREATE TABLE tenant_integrations (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES company_profile(account_id),
  provider_name VARCHAR(100) REFERENCES integration_providers(provider_name),
  credentials JSONB, -- encrypted AES-256-GCM
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tenant_id, provider_name)
);
```

---

## 12. Capability Model & Metadata

### Why Capabilities?

Instead of scattering feature-enabled/disable logic across 100+ pages ("if mode=restaurant && tenant.fbr_enabled && country=PK..."), the app should ask: "What capabilities are available?"

A **capability** is a feature with metadata about what enables it.

### Capability Definition

```javascript
// In capabilities registry
const CAPABILITIES = [
  {
    key: 'floor_plan_management',
    label: 'Floor Plan Management',
    enabled_by_default: false,
    requires_mode: 'restaurant',
    requires_country_support: null,
    requires_plan_tier: 'plus',
    requires_feature_flag: null,
    requires_permission: 'manage_restaurant',
    description: 'Create and manage restaurant floor plans'
  },
  {
    key: 'fbr_digital_invoicing',
    label: 'FBR Digital Invoicing',
    enabled_by_default: false,
    requires_mode: null, // all modes
    requires_country_support: 'PK',
    requires_plan_tier: 'free', // available to all
    requires_feature_flag: 'fbr_integration',
    requires_permission: null, // all users
    description: 'Automatic FBR invoice posting (Pakistan only)'
  },
  {
    key: 'appointment_booking_public',
    label: 'Public Appointment Booking',
    enabled_by_default: true,
    requires_mode: 'appointments',
    requires_country_support: null,
    requires_plan_tier: 'free',
    requires_feature_flag: null,
    requires_permission: null,
    description: '/book/:slug public page for self-service booking'
  }
];
```

### Capability Resolution at Runtime

```javascript
// Helper function in backend
function isCapa bilityAvailable(tenant, capability_key, user) {
  const cap = CAPABILITIES.find(c => c.key === capability_key);
  
  // Check each requirement
  if (cap.requires_mode && !tenant.enabled_modes.includes(cap.requires_mode)) {
    return false;
  }
  
  if (cap.requires_country_support && tenant.country_code !== cap.requires_country_support) {
    return false;
  }
  
  if (cap.requires_feature_flag && !tenant.feature_flags[cap.requires_feature_flag]) {
    return false;
  }
  
  if (cap.requires_permission && !user.has_permission(cap.requires_permission)) {
    return false;
  }
  
  if (cap.requires_plan_tier) {
    const plan_tiers = ['free', 'plus', 'premium'];
    if (plan_tiers.indexOf(tenant.plan_tier) < plan_tiers.indexOf(cap.requires_plan_tier)) {
      return false;
    }
  }
  
  return true;
}

// Usage in routes
router.get('/api/floor-plans', async (req, res) => {
  if (!isCapabilityAvailable(req.tenant, 'floor_plan_management', req.user)) {
    return res.status(403).json({ error: 'Not available' });
  }
  // ... route logic
});

// Usage in UI
const bootstrap = getBootstrap(tenantId);
if (bootstrap.capabilities.find(c => c.key === 'floor_plan_management' && c.available)) {
  return <FloorPlanNav />;
}
```

### Capability Graph (Advanced Use)

Some capabilities depend on others:

```javascript
const CAPABILITY_GRAPH = {
  'floor_plan_management': {
    requires: [], // standalone
    enables: ['table_management', 'course_management']
  },
  'table_management': {
    requires: ['floor_plan_management'],
    enables: ['split_check_by_table']
  },
  'course_management': {
    requires: ['floor_plan_management'],
    enables: ['hold_fire_courses']
  }
};

// Can be used to:
// 1. Pre-enable dependent capabilities
// 2. Disable dependent features if parent is disabled
// 3. Show "requires X to enable" messaging
```

---

## 13. Competitive Landscape: Square Analysis

### Square's Market Position

**Size & Scope:**
- Serves 4+ million merchants globally
- Part of Block, Inc. (ecosystem: Square + Cash App + Afterpay)
- ~$9B in annual revenue (2024)
- 28.1% market share in POS category (ahead of Toast, Clover, Lightspeed)

**Business Model:**
- 62% of revenue from transaction processing (2.4%-2.6% + fees)
- 20% from subscriptions and add-ons
- 18% from financial services (loans, banking)

**Strategic Shift (2024-2026):**
- Consolidated 18 à la carte subscriptions into **3 unified tiers** (Free, Plus $49/mo, Premium $149/mo)
- Launched **Square AI** (conversational analytics)
- Integrated **MarketMan** (restaurant inventory)
- Moved from aggressive expansion to "Rule of 40" profitability
- Deprioritized non-core products (wound down Tidal, TBD)

---

## 14. Square's 7 POS Modes

Square operates through **7 distinct POS modes** within one unified app:

### Mode Definitions & Targeting

| Mode | Target | Key Features | Hardware | Switching |
|------|--------|------------|----------|-----------|
| **Full Service** | Sit-down restaurants | Floor plans, table seats, coursing, tableside ordering, split checks | Dedicated Square hardware | Reboot/app close |
| **Quick Service** | Counter service, food trucks, fast-casual | Fast items, combos, prep numbers, pickup times, low friction | Square hardware required | Reboot/app close |
| **Bar** | Bars, lounges, breweries | Preset tabs, customer preauth, quick no-fuss checkout, high throughput | Square hardware required | Reboot/app close |
| **Retail** | Product-based stores | Inventory, SKU scanning, vendor POs, bulk intake, receipt printing | Generic tablets/register | Reboot/app close |
| **Bookings** | Appointment businesses (salon, clinic, gym) | Calendar, staff assignment, online booking, reminders, no-show fees | Generic tablet or phone | Reboot/app close |
| **Services** | Professional services (contractors, consultants) | Invoices, estimates, time tracking, customer projects | Generic device | Reboot/app close |
| **Standard** | Generic / undefined | Universal features, no mode-specific optimizations | Generic device | Reboot/app close |

### Mode Selection & Assignment

- **Onboarding:** Merchant picks a mode based on business type
- **Per-device:** Different devices in the same business can run different modes
  - Example: Full Service on dining room iPad, Quick Service on counter register
- **Switching:** POS switches after reboot, after a completed transaction, or app close/reopen
- **Hardware constraint:** Full Service, Quick Service, and Bar modes require dedicated Square hardware
- **AI verification:** Square uses RoBERTa ML models to verify merchant categories and auto-correct wrong mode selections

### What Changes Per Mode

- POS layout and checkout flow
- Floor plan visibility (restaurant modes)
- Coursing availability (Full Service/Quick Service)
- KDS behavior and ticket routing
- Available buttons and shortcuts
- Default checkout settings
- Which add-ons are visible
- Menu/product organization (restaurant vs retail)

---

## 15. Square Pricing & Tiers

### Unified Three-Tier Model (Oct 2025)

| Feature | Free | Plus | Premium |
|---------|------|------|---------|
| **Monthly fee** | $0 | $49/location | $149/location |
| **In-person processing** | 2.6% + 15¢ | 2.5% + 15¢ | 2.4% + 15¢ |
| **Online processing** | 3.3% + 30¢ | 2.9% + 30¢ | 2.9% + 30¢ |
| **Manual card entry** | 3.5% + 15¢ | 3.5% + 15¢ | 3.5% + 15¢ |
| **Gift card loads** | 2.5% | 2.5% | 0% (free) |
| **KDS per device** | — | $30/mo | $20/mo |
| **Kiosk per device** | — | $50/mo | $30/mo |
| **SMS included/mo** | — | 500 | 2,500 |
| **Phone support** | 90 days only | M-F business hours | 24/7 |

### Pricing Philosophy

- **Free tier is customer acquisition** — remove all barriers to entry
- **Real margin = processing fees** — every transaction pays Square 2.4%-2.6%
- **Upsell via plan tiers** — merchants processing $25k+/mo justify $49/mo for 0.1% rate reduction
- **Hardware as razor-and-blade** — sell hardware at cost, profit on processing + subscriptions + add-ons

### Square's Add-Ons

| Product | What It Does | Pricing |
|---------|-------------|---------|
| **Square KDS** | Kitchen display (Android tablets) | $20-30/mo per device |
| **Square Kiosk** | Self-service ordering | $30-50/mo per device |
| **Square Loyalty** | Digital loyalty program | $45/mo |
| **Square Marketing** | Email + SMS campaigns | $15-40/mo (email), $20-195/mo (SMS) |
| **Square Payroll** | Employee payroll + tax filing | $35/mo + $6/employee |
| **Square Online** | Ecommerce website | Free (included) |
| **Square Appointments** | Online booking + scheduling | $29-149/mo |
| **Square Invoices** | Estimates + invoices | Free (basic), Plus (advanced) |
| **Square Banking** | Checking, savings, loans | Free (no monthly fees) |

---

## 16. Square's Strengths & Weaknesses

### Strengths

1. **Ecosystem lock-in** — 44% of gross profit from merchants using 4+ products. Switching costs are high.
2. **Hardware + software bundle** — iPad + register + reader + printer → complete POS system
3. **Frictionless onboarding** — 5-minute signup, no underwriting, no sales reps
4. **Mode/preset system** — One POS transforms per business type (closest to SanoPOS architecture)
5. **Breadth** — Serves retail, restaurant, salon, professionals, nonprofits, etc.
6. **Integrated payments** — Processing built into POS, no separate gateway
7. **Omnichannel integration** — Online store syncs with POS inventory in real time
8. **AI innovation** — Square AI launched May 2025 for conversational analytics

### Weaknesses

1. **Advanced inventory** — Multi-location reordering, complex SKUs not as good as Lightspeed
2. **Restaurant depth** — KDS solid but less specialized than Toast; no advanced ingredient/recipe management until MarketMan integration (2026)
3. **Multi-location management** — Per-location permissions, pricing, tax rules are limited
4. **Customer service** — #1 BBB complaint: account freezes, slow support, minimal recourse (3,283+ complaints)
5. **International** — Only 8 countries after 15+ years. NOT a global platform (94% revenue from US)
6. **Reporting customization** — Limited drill-down and custom report building
7. **Hardware requirement** — Full Service/Quick Service/Bar modes require Square hardware (iPad won't do)
8. **KDS limitation** — Only works on Android tablets, not browser-based like SanoPOS

---

## 17. SanoPOS vs Square Feature Gap Analysis

### What SanoPOS Already Has (M10 Shipped)

| Feature Category | Square | SanoPOS Backend | SanoPOS Frontend | Status |
|---|---|---|---|---|
| **Restaurant — Floor Plans** | ✓ Custom drag-drop | ✓ Tables `restaurant_floor_plans`, `restaurant_floor_sections` | ✗ List view only | Gap: UI |
| **Restaurant — Tables** | ✓ Drag-drop layout, color-coded timers | ✓ `pos_x`, `pos_y`, `shape`, `capacity` fields | ✗ Not built | Gap: UI |
| **Restaurant — Seat Management** | ✓ 3 modes: count only, optional seats, required | ✓ `restaurant_check_seats` table | ✗ Basic modal | Gap: Polish |
| **Restaurant — Coursing** | ✓ Hold & fire, multiple courses | ✓ `restaurant_course_fires` table | ✓ Button exists | Status: Works |
| **Restaurant — KDS** | ✓ Station routing, timers, bump/recall | ✓ `kds_stations`, `kds_tickets`, `kds_station_routes` | ✗ Stuck on loading bug | Gap: Debug |
| **Restaurant — Split Checks** | ✓ By seat, by item, equal | ✓ `splitCheckBySeat()`, `splitCheckByItem()` | ✗ Untested modal | Gap: Polish |
| **Restaurant — QR Ordering** | ✓ Public menu page | ✓ `/api/public/restaurant/menu/:token` | ✗ Not built | Gap: UI |
| **Restaurant — Bar Tabs** | ✓ Preauth holds | ✓ `restaurant_tabs` + `restaurant_preauth_holds` | ✗ Not built | Gap: UI |
| **Appointments** | ✓ Booking, reminders, staff assignment | ✓ `appointments`, `booking_services`, staff schema | ✓ Pages exist | Status: Done |
| **Loyalty** | ✓ Points, tiers, mobile wallet | ✓ `customer_loyalty_points`, wallet schema | ✓ Partial | Status: Partial |
| **Invoices** | ✓ Estimates, recurring, payment schedules | ✓ `invoices`, `invoice_items`, `payment_schedules` | ✓ Works | Status: Done |
| **Multi-outlet** | ✗ Limited | ✓ Full per-outlet inventory, transfers, permissions | ✓ Implemented | Status: Done + Strength |
| **KDS on any device** | ✗ Android tablets only | ✓ Browser-based KDS | ✓ Works | Status: Strength |
| **FBR digital invoicing** | ✗ Not available | ✓ `fbr_invoices` queue, API integration | ✓ Dashboard | Status: Strength |

### What SanoPOS Does NOT Have Yet

| Feature | Square | SanoPOS | Effort | Build When |
|---------|--------|---------|--------|-----------|
| **Restaurant — Table timers** (color-coded yellow/red) | ✓ | ✗ | Small (UI) | Next polish pass |
| **Restaurant — Reopen closed checks** | ✓ | ✗ | Small | Small feature request |
| **Drag items between courses** | ✓ | ✗ | Medium (UI) | When restaurant uses coursing |
| **Reservation integration** | ✓ (OpenTable, Resy) | ✗ | Large (partner API) | Never (no local partners) |
| **Order-ready SMS to customers** | ✓ | ✗ | Medium (SMS) | When restaurant requests |
| **AI demand forecasting** | ✓ (Premium only) | ✗ | Large (restaurant ML) | Phase 3+ if budget allows |
| **Ingredient/recipe management** | ✓ (MarketMan) | ✗ | Large (new domain) | Never (outside scope) |
| **Vendor sales reporting** | ✓ | ✗ | Medium (reporting) | If restaurant owner requests |
| **Square AI (conversational analytics)** | ✓ (launched May 2025) | ✗ | Medium (LLM integration) | Phase 3+ if budget allows |

### What SanoPOS Has That Square Charges Extra For

| Feature | Square Cost | SanoPOS | Positioning |
|---------|------------|---------|-------------|
| **KDS** | $20-30/mo per device | **Included** | Differentiator |
| **Kiosk ordering** | $30-50/mo per device | **Included** | Differentiator |
| **Multi-outlet support** | Limited by plan | **Included** | Differentiator |
| **FBR compliance** | Not available | **Included** | Regional strength |
| **Marketplace integrations** | Extra integrations fee | **Included** (13 couriers) | Strength |

---

## 18. Strategic Takeaways for SanoPOS

### What to Copy from Square

1. **Mode/preset system** — One app that transforms per business type. This is the single most important architectural decision.

2. **Unified pricing tiers** — Three simple tiers (not 70 feature flags). Industry doesn't change price — it changes experience.

3. **Frictionless onboarding** — Pick business type → app adapts → start selling. No sales reps, no 30-minute setup.

4. **Composable add-ons** — Core POS is cheap/free. Revenue from processing + premium add-ons.

5. **Integrated payments** — Processing built into POS, abstracted via adapter pattern.

6. **Ecosystem lock-in strategy** — Merchant using Loyalty + Marketing + Payroll = hard to leave.

### What to Do Better Than Square

1. **Customer support** — Square's #1 complaint. Be responsive, transparent, no frozen accounts without explanation.

2. **Multi-location depth** — SanoPOS already has per-outlet inventory, transfers, and outlet-scoped permissions. Square is weak here.

3. **KDS on any device** — Square requires Android tablets. SanoPOS browser-based → any device is a KDS.

4. **Include KDS free** — Square charges $20-30/device/mo. Including it is an instant differentiator.

5. **Pakistan/emerging market focus** — Square serves 8 countries (94% US). Own Pakistan first, then expand regionally.

6. **FBR/tax compliance** — Built-in Pakistan digital invoicing. Square has nothing for local compliance.

7. **Deeper restaurant features** — Build toward Toast-level depth with Square-level breadth.

8. **Hardware agnostic** — BYOD. Don't lock merchants into Square hardware ecosystem.

### What NOT to Copy

1. **Payment processing as core revenue** — In Pakistan, processing fees are different and harder. Focus on software subscriptions + SanoPay orchestration fees.

2. **Consumer app (Cash App)** — Don't build a consumer payment app. That's a different business entirely. Partner with JazzCash/Easypaisa instead.

3. **Global expansion before dominance** — Square is still 94% US after 15 years. Own Pakistan first, then regional expansion.

4. **Hardware as profit center** — Square sells hardware at cost and profits on processing. SanoPOS should remain hardware-agnostic.

---

## 19. SanoPOS Competitive Positioning

### The Competitive Set

| Competitor | Market Share | Core Strength | Core Weakness |
|-----------|-------------|---------------|---------------|
| **Square** | 28.1% | Breadth — all business types | Depth — can't match specialists, limited multi-location, weak customer service |
| **Toast** | 23.5% | Deep restaurant specialization | Restaurant-only — not viable for retail or services |
| **Clover** | ~15% | Hardware-first simplicity | Limited software depth, vendor lock-in |
| **Lightspeed** | ~8% | Enterprise inventory complexity | Too complex for SMBs, expensive |
| **Shopify POS** | ~10% | Ecommerce-first omnichannel | Weak in-store POS experience |

### SanoPOS Positioning Statement

> **Square's breadth + Toast's restaurant depth + Pakistan-first compliance — all in one platform, at a fraction of the cost**

This means:
- **Breadth:** Retail, restaurant, salon, services, rentals, hospitality, clinical (like Square)
- **Restaurant depth:** Floor plans, coursing, KDS, QR ordering, performance reporting (approaching Toast)
- **Regional strength:** FBR integration, local courier adapters, market-aware pricing (beyond Square)
- **Value pricing:** Designed for Pakistani SMBs, not $149/mo
- **Hardware flexibility:** Browser-based POS + KDS, works on any tablet/register

### Competitive Advantages

1. **Multi-location out of the box** — SanoPOS has per-outlet inventory, transfers, permissions. Square charges more for this.

2. **KDS included free** — Square charges $20-30/device/mo. SanoPOS includes it.

3. **Pakistan compliance built-in** — FBR, couriers, tax rates, SMS providers. Square has none of this.

4. **Restaurant-focused POS** — Floor plans, KDS, coursing foundations exist. Not as deep as Toast yet, but competitive with Square.

5. **Emerging market focus** — Pricing, UI/UX, and integrations designed for Pakistan. Square prices for US market.

6. **Browser-based flexibility** — Run on any tablet, phone, or register. Square hardware requirements are a liability.

### Weaknesses vs Square

1. **Brand awareness** — Square is global, SanoPOS is regional
2. **API ecosystem** — Square's App Marketplace has 1000+ integrations. SanoPOS has 13 couriers + few channels.
3. **Financial services** — Square has checking/savings/loans. SanoPOS does not (could partner instead).
4. **Scale confidence** — Square has 4M merchants. SanoPOS is newer, smaller, less proven.

---

## 20. Tenant Preset Engine v1 & v2 Implementation

### Delivery Timeline

| Version | Scope | Delivery | Status |
|---------|-------|----------|--------|
| **v1** | Core preset engine + 3 presets (retail, restaurant, salon) + workflow tickets | M1-M4, shipped 2026-04-14 | ✅ Complete |
| **v2** | 20 more presets + 6 new modes (appointments, service_projects, subscriptions, rentals, room_management, treatment_plans) | M5-M10, shipped 2026-04-14 to 2026-04-15 | ✅ Complete |
| **M11** | Manufacturing mode (BOMs, work orders) | Deferred | ⏸️ On-demand only |

### v1 Milestones (M1-M4) — 2026-04-14

| Milestone | What It Shipped | Unlock |
|-----------|-----------------|--------|
| **M1** | Core preset engine + 3 presets (retail, grocery, cafe) + basic feature flags gating | Preset system works, nav responds to industry_type |
| **M2** | Workflow tickets + subscription basics | Service-intake workflows functional |
| **M3** | 7 more presets (restaurant, salon, clinic, repair_shop, gym, wholesale, photo_studio) | Most common SMB industries now available |
| **M4** | Country packs (23 countries), receipt labels, reports, POS search, sample data, clinic fields | Global platform ready, locale aware |

### v2 Milestones (M5-M10) — 2026-04-14 to 2026-04-15

| Milestone | Shipped | Unlock |
|-----------|---------|--------|
| **M5** | Weight-based selling + 3 new presets (butcher, sweet_shop, textile) | Butcher/grocery/market now supported |
| **M6** | Online public booking page (`/book/:slug`) + email confirmations + ICS download | Appointment businesses get free online booking |
| **M7** | Rentals mode + 4 presets (car_rental, equipment_hire, furniture, party_supplies) | Rental businesses fully functional |
| **M8** | Customer portal (`/portal/:slug`) with invoices, appointments, wallet, self-service | Customers get branded portal |
| **M9** | Room management mode + 3 hospitality presets (hotel, guesthouse, hostel) | Hospitality businesses fully supported |
| **M10** | Treatment plans mode + 3 clinical presets (dental, vet, physio) | Clinical workflows + multi-visit plans + charting |

### Code Artifacts

#### Backend Files Added/Modified

| File | Purpose |
|------|---------|
| `backend/config/industry-config.js` | 23 preset definitions (labels, nav, modes, onboarding) |
| `backend/config/country-packs.js` | 23 country configs (tax, currency, providers) |
| `backend/routes/treatment-plan-templates.js` | Template CRUD + clone-from-template |
| `backend/routes/service-tickets.js` | Workflow ticket intake + status board |
| `backend/routes/rentals.js` | Rental asset checkout/return |
| `backend/routes/rooms.js` | Room inventory + booking calendar |
| `backend/routes/treatment-plans.js` | Clinical plans + SOAP + charting |
| `backend/routes/customer-portal/` | 8 portal endpoints (me, invoices, appointments, stays, etc.) |
| `backend/seeds/preset-seed-data.js` | Sample data per preset |
| Migrations v31-49 | 19 migrations (tables, indexes, column widening) |

#### Frontend Files Added/Modified

| File | Purpose |
|------|---------|
| `frontend/src/contexts/PresetContext.jsx` | Label + mode provider |
| `frontend/src/pages/SetupWizard.jsx` | 5-step wizard with industry picker |
| `frontend/src/pages/portal/PortalLayout.jsx` | Portal auth + preset-driven tabs |
| `frontend/src/pages/portal/PortalStays.jsx` | Room booking history |
| `frontend/src/pages/RentalsRedesign.jsx` | Asset checkout/return UI |
| `frontend/src/pages/RoomsRedesign.jsx` | Room inventory + calendar |
| `frontend/src/pages/TreatmentPlansRedesign.jsx` | 7-tab plan detail |
| `frontend/src/components/DentalChart.jsx` | Interactive tooth diagram |
| `frontend/src/components/BodyChart.jsx` | Region grid for physio |
| `frontend/src/ui/PwaInstallPrompt.jsx` | App install banner |
| `frontend/src/App.jsx` | Nav filtering on requiredMode |

---

## 21. Current Delivery Status (M1-M10)

### What's Been Shipped

| Component | Status | Delivery |
|-----------|--------|----------|
| **Core preset engine** | ✅ Done | M1 (2026-04-14) |
| **23 industry presets** | ✅ Done | M1-M4 (2026-04-14) |
| **9 business modes** | ✅ Done | M1-M10 (2026-04-15) |
| **23 country packs** | ✅ Done | M4 (2026-04-14) |
| **10 adaptation surfaces** | ✅ Done | M1-M10 |
| **Workflow tickets (service intake)** | ✅ Done | M2 (2026-04-14) |
| **Weight-based selling** | ✅ Done | M5 (2026-04-14) |
| **Public booking page** | ✅ Done | M6 (2026-04-14) |
| **Customer portal** | ✅ Done | M8 (2026-04-15) |
| **Rentals mode** | ✅ Done | M7 (2026-04-14) |
| **Room management mode** | ✅ Done | M9 (2026-04-15) |
| **Treatment plans mode** | ✅ Done | M10 (2026-04-15) |
| **Manufacturing mode** | ⏸️ Deferred | M11 (on-demand) |

### Industry Coverage

| Category | Count | Presets |
|----------|-------|---------|
| Retail | 4 | retail, grocery, wholesale, textile |
| Food & Beverage | 5 | restaurant, cafe, butcher, sweet_shop, ice_cream (via sweet_shop) |
| Services | 9 | salon, clinic, repair_shop, car_wash, gym, photography_studio, driving_school, coworking_space, + others via appointments |
| Hospitality | 3 | hotel, guesthouse, hostel |
| Clinical | 3 | dental_clinic, veterinary, physiotherapy |
| Rentals | 4 | car_rental, equipment_hire, furniture_rental, party_supplies_rental |
| **Total** | **23 presets** | Covers ~48 of 54 assessed industries |

### 10 Adaptation Surfaces

Every preset controls these surfaces:

1. **Sidebar navigation** — What menu items show
2. **Page labels** — "Service" vs "Product", "Guest" vs "Customer"
3. **Dashboard widgets** — Retail shows inventory alerts, services don't
4. **POS layout** — Retail = barcode grid, restaurant = menu list
5. **Onboarding steps** — Industry-specific setup checklist
6. **Receipt wording** — "Customer:" vs "Patient:" vs "Guest:"
7. **Reports visibility** — Retail sees procurement, salon doesn't
8. **POS search fields** — Retail includes SKU/barcode, salon doesn't
9. **Sample data** — Restaurants get menu items, salons get services
10. **Portal tabs** — Hospital tenant sees different tabs than retail tenant

---

## 22. Complete Gap & Deferred Item Registry (25 Items)

After a full code audit on 2026-04-15, 25 items were identified as either shipped, deferred, or still open. This is the canonical list.

### Items Shipped in Wave 1-3 (as of 2026-04-15)

**Wave 1 — Architectural + Data Integrity (Commit `0a2163c`):**
- ✅ Item 1: Subscriptions nav `requiredMode: "subscriptions"` added; flag default flipped false
- ✅ Item 8: 5 phase4 flags flipped to false; `requireMode()` gate added to routes
- ✅ Items 9, 10: `outlet_stock.quantity`, `return_items.quantity`, `stock_adjustments.quantity_change` widened to `NUMERIC(10,3)`

**Wave 2 — Clinical Readiness (Commit `4f197f2`):**
- ✅ Item 2: `isClinicalPreset()` helper; Subjects + Treatment Plans sections in customer detail
- ✅ Item 3: `PortalStays.jsx` created; stays tab added to portal nav
- ✅ Item 4: Native `SignaturePad` in consent forms
- ⚠️ Item 5: Setup wizard for clinical — code path verified, deploy-time validation
- ⚠️ Item 6: Migration v39 production verification — at deploy time
- ✅ Item 7: `onboard-dental-clinic`, `onboard-veterinary`, `onboard-physiotherapy` E2E tests

**Wave 3 — Demand-Driven Features (Current Commit):**
- ✅ Item 11: Treatment plan templates table + CRUD + clone UI
- ✅ Item 13: "Service Work" nav split into "Projects & Contracts" + "Service Tickets"
- ✅ Item 14: Booking deposits schema; `/api/public/bookings/deposit-intent` endpoint
- ✅ Item 15: PWA install prompt; wallet top-up endpoint
- ✅ Item 16: Room tax-inclusive schema flag
- ✅ Item 21: `sale_items.staff_id` schema + API support
- ✅ Item 22: Sandbox tokenize/charge-saved endpoints

### Remaining Open/Deferred Items

| # | Item | Status | Effort | Action |
|---|------|--------|--------|--------|
| 12 | POS quick-create treatment plan for walk-ins | ✅ Shipped | 2 hrs | Done |
| 14 | Public booking deposit UI (backend ready) | Deferred | 1-2 days | When appointment tenant requests |
| 15 | Portal top-up webhook routing (backend ready) | Deferred | Half day | When wallet top-up used |
| 16 | Public `/reserve/:slug` room reservation page | Deferred | 1-2 days | When hotel requests |
| 17 | Real xPay saved-card tokenization | Deferred | Provider-dependent | When vendor API confirmed |
| 18 | Manufacturing mode (M11) | Deferred | 2 weeks | When factory customer commits |
| 19-22 | Advanced hospitality features (12 items) | Deferred | Varies | Demand-driven |
| 23-25 | Advanced clinical features (10+ items) | Deferred | Varies | Demand-driven |

### Do Not Ship Without

**Before any clinical tenant scales:**
- ✅ Item 2 (clinical customers UI) — Shipped
- ✅ Item 3 (portal stays) — Shipped
- ✅ Item 4 (signature canvas) — Shipped
- ✅ Item 7 (E2E tests) — Shipped

**Before any manufacturing build:**
- Item 18 (manufacturing mode) — Still needed

---

## 23. SanoPay Sandbox Infrastructure

### Purpose

SanoPay sandbox is a **critical testing infrastructure** wired on both local dev AND Railway for **end-to-end payment testing without real money**. Every payment-touching feature must have integration tests driven through the sandbox.

### Environment Configuration

| Environment | `PAYMENT_GATEWAY` env | Use Case |
|-------------|----------------------|----------|
| Local dev | `sandbox` | Dev + manual testing |
| Railway staging | `sandbox` | CI/integration testing |
| Production | `xpay` | Real xPay API calls |
| Fallback | `manual` or unset | Admin manually records payments |

### Key Infrastructure Files

| File | Purpose |
|------|---------|
| `backend/services/payment-gateway.js` | Adapter registry. `getPaymentAdapter()` dispatches on env var. Never hardcode xPay. |
| `backend/routes/sandbox.js` | Hosted sandbox payment page + webhook simulator. POST `/api/sandbox/pay/:ref` to fire events. |
| `backend/routes/webhooks.js` | Single webhook endpoint. `verifyWebhook()` dispatches on active provider. |
| `backend/tests/integration/pg-sandbox-payment.test.js` | Template for all payment-touching tests. Copy this pattern. |

### Rule of Thumb

**If your feature writes a `gateway_ref` anywhere or listens for a webhook, your PR needs at least one integration test that:**
1. Runs with `PAYMENT_GATEWAY=sandbox`
2. Simulates the full payment lifecycle
3. Fires webhook events via sandbox endpoint

This catches adapter-dispatch bugs, webhook-signature bugs, and state-machine bugs before they reach production.

### Adapter Pattern

All payment providers (xPay, SandoPay, manual) implement the same interface:

```javascript
class PaymentAdapter {
  async authorize(amount, currency, reference) {}
  async capture(authorization_id) {}
  async release(authorization_id) {}
  async refund(captured_id, amount) {}
  async tokenize(card_details) {} // For saved-card subscriptions
  async chargeSavedInstrument(token, amount) {} // For recurring billing
  async verifyWebhook(signature, payload) {}
}
```

---

## 24. Core-First Platform Direction (Post-M10)

### Strategic Shift

**No longer:** Building 54 separate mini-products.

**Now:** One strong shared core + preset configuration layers.

### The New Reality

| Layer | Status | Notes |
|-------|--------|-------|
| Shared core foundation | Built | POS, catalog, customers, employees, inventory, invoices, payments, reports, loyalty/wallet, portal, receipts, shifts |
| Industry presets | Built (23 live) | All major SMB industries covered |
| Business modes | Built except manufacturing | 9 modes: retail, restaurant, appointments, service_projects, subscriptions, workflow_tickets, rentals, room_management, treatment_plans |
| Manufacturing | Deferred M11 | Build only when factory customer commits |

### Next Phase: Hardening the Core

Now that modes and presets are built, the competitive advantage is **not** more vertical sprawl. It's **hardening the shared core** so every preset becomes more reliable, faster, and easier to sell.

---

## 25. Next 8 Improvement Priorities

After M10, the platform direction is clear: improve the core, not add more presets. Priority order:

### 1. POS Offline Durability (High Priority)

**Current:** Lightweight `localStorage` offline queue. No sync states, retry history, or conflict visibility.

**Build:**
- Replace with IndexedDB for true durability
- Add sync states: pending → syncing → synced → failed
- Retry history and manual conflict resolution UI
- Queue aging (delete very old failed sales)
- Crash recovery

**Why:** Offline is critical for retail/restaurant in unreliable networks. Current approach loses data on browser crash.

### 2. Payment Lifecycle Maturity (High Priority)

**Current:** SanoPay sandbox wired on both envs. Real provider saved-card integration pending.

**Build:**
- Finish provider-specific saved-instrument support (xPay tokenization API confirmation)
- Strengthen state machines for: POS card, deposits, invoices, wallet top-up, refunds, subscriptions, reconciliation
- Add retry logic for failed payment intents
- Webhook delivery guarantees (exponential backoff, dead-letter queue)

**Why:** Payment failures are rare but catastrophic. Strong state machines catch bugs early.

### 3. POS State Architecture (High Priority)

**Current:** Large monolithic POS context (~130+ exports). Hard to maintain, hard to test.

**Build:**
- Split into domain modules/hooks: cart, checkout, shift gate, search, offline sync, receipts, customer display, loyalty/wallet, room/treatment charging, approvals
- Each module is independently testable
- Cleaner dependency tree

**Why:** POS is the most complex part of the platform. Refactoring now prevents technical debt explosion.

### 4. Audit & Reconciliation (Medium Priority)

**Current:** Traceability from sale → invoice → payment → refund → shift → reports exists but is scattered.

**Build:**
- Strengthen traceability in all directions
- Add duplicate-payment detection (same gateway_ref on multiple sales)
- Add duplicate-sale detection (same cart, same employee, seconds apart)
- Expose reconciliation screens for admins
- Exception alerts (e.g., payment intent stuck for 2+ hours)

**Why:** At scale, reconciliation is the difference between confident operations and chaos.

### 5. Typed API Contracts (Medium Priority)

**Current:** Most endpoints use loose JSON validation. Zod schemas exist for some high-risk flows.

**Build:**
- Progressively add Zod/OpenAPI for high-risk flows: sales, payments, invoices, subscriptions, rooms, treatment plans, rentals, returns
- Share client contracts (frontend can validate before sending)
- Generate OpenAPI docs for third-party integrations

**Why:** Type safety prevents entire classes of bugs. Especially important for payment flows.

### 6. Operational Observability (Medium Priority)

**Current:** Structured logging via Pino. Error tracking via Sentry. No metrics/alerts for POS operations.

**Build:**
- Add metrics for: checkout latency, failed payments, queue depth, sync lag, stuck payment intents, worker health, failed webhooks, shift variance, receipt/printer failures
- Alerts for: error spikes, latency p99 thresholds, queue buildup, worker down
- Dashboard for 24/7 monitoring

**Why:** Operational visibility is what makes the difference between "system works" and "system is reliable."

### 7. Device/Hardware Layer (Medium Priority)

**Current:** POS is browser-based. Printer integration exists via ESC/POS. Scanner/cash-drawer integration incomplete.

**Build:**
- Mature scanner integration: barcode validation, quick-add to cart, error feedback
- Cash drawer integration: open on checkout, track draws/reconciliation
- Card terminal fallback (if xPay fails, offline card reader?)
- Print job queueing + retry on printer fail
- Hardware health checks (is printer online? is scanner responding?)

**Why:** Hardware reliability is what makes POS feel serious in-store. Browser is flexible but hardware matters.

### 8. Manufacturing (M11) — On Demand (Low Priority)

**Current:** Deferred, waiting for customer demand.

**Build when:** Factory or production business commits.

**Scope:**
- BOMs (bill of materials)
- Work orders (production jobs)
- Raw material consumption tracking
- Production costing
- Production dashboard (status, yield, rework)
- Presets: small_factory, bakery_production

---

## 26. Global Build Order & Phases

If the goal is to become a global, Square-like multi-vertical platform, the build order matters.

### Why Build Order Matters

Building more verticals before the platform adapts by preset and mode creates:
- Hardcoded differences scattered across 100+ pages
- Duplicated flows
- Inconsistent naming
- Unstable navigation
- Increased maintenance cost

### Recommended Sequence

#### Phase A — Build The Product Skeleton First (M1-M4)

**Goal:** Create the tenant-aware adaptation layer.

**Tasks:**
1. Add `industry_type`, `business_model`, `country_code`, `industry_preset_version` to `company_profile`
2. Create shared industry-config module
3. Create bootstrap payload returning: active preset, enabled modes, labels, nav groups, dashboard widgets, POS layout
4. Make frontend read from bootstrap for navigation, labels, dashboard, onboarding, POS layout

**Deliverable:** New tenants choose industry at account creation and immediately see a tailored version.

**Status:** ✅ Complete (M1-M4, shipped 2026-04-14)

#### Phase B — Turn Existing Features Into Polished Modes (M5-M10)

**Goal:** Polish verticals already present in the repo into coherent business modes.

**First modes to polish:**
1. `retail` — Already solid
2. `restaurant` — Core tables + APIs exist; UI needs polish
3. `appointments` — Solid, ready to ship

**Status:** ✅ Complete (M5-M10, shipped 2026-04-15)

#### Phase C — Build Cross-Cutting Primitives Before Niche Verticals

**Goal:** Before building many more specific industries, build reusable foundations.

**Examples:**
- Workflow/ticket engine (completed in M2)
- Weight/meter selling UX (completed in M5)
- Measurement/custom-fields framework
- Recurring membership/check-in patterns
- Resource booking patterns
- Country/localization layer (completed in M4)

**Status:** ✅ Mostly complete; custom-fields framework still pending

#### Phase D — Add Vertical Depth Strategically (M11+)

**Goal:** After phases A-C, add deeper verticals knowing they'll fit into a stable architecture.

**Examples:** Repair, laundry, tailor, clinic (now done), gym, coworking, rental (now done), hotel (now done)

**Status:** ✅ Most shipped; clinic/rental/hotel complete; others available via existing modes

### Global Expansion Phases (Regional)

#### Phase 1 — Pakistan (Primary Market)

- Dominate with strong product + local integrations
- FBR integration ✅
- 13 courier adapters ✅
- Local payment support ✅
- 23 presets ✅
- **Status:** Ready

#### Phase 2 — South Asia (India, Bangladesh, Sri Lanka)

- Leverage Pakistan success
- Adapt for local tax/payment/courier availability
- Add region-specific presets (e.g., India-specific spice shops, etc.)
- Estimated: 2-3 months after Phase 1 stabilization

#### Phase 3 — Middle East (UAE, Saudi, Oman)

- Fast-growing market
- Different tax regimes (VAT)
- Add region-specific presets + country packs
- Estimated: 4-6 months

#### Phase 4 — Beyond

- Focus on regions where Square is weak or not present
- Selective expansion; not global blanket coverage

---

## 27. Product Rule: When to Add New Presets

Before adding a new preset, ask these four questions:

### The Four-Question Decision Tree

1. **Can an existing mode handle this with labels, nav, sample data, and portal/report defaults?**
   - Example: Ice cream parlor → use sweet_shop preset with different sample data and labels
   - If YES → Don't build a new preset, just add a new config entry to existing preset
   
2. **Is the missing piece a small extension to a current mode?**
   - Example: Flower delivery + retail → add `florist_delivery` extension table to retail mode
   - If YES → Build the extension, don't new a new mode
   
3. **Is this actually a new operational mode?**
   - Example: Hotel needs room-night billing (NOT an extension of appointments or subscriptions) → NEW MODE
   - If YES → This might justify a new mode, go to question 4
   
4. **Will improving the core solve this for many industries at once?**
   - Example: Weight-selling solves for butcher, spice, bakery, etc. → Improve the core once
   - If YES → Build the core improvement first, then add presets that use it
   - If NO → Build the specific mode

### Examples

**Should we add a "Florist" preset?**
1. Can retail + appointments handle it? Yes (sell flowers, book delivery appointments)
2. → Add `florist` preset config (use retail + appointments modes)
3. → No new code

**Should we add "Driving School" preset?**
1. Can appointments handle it? Yes (staff teaches lessons, customer books)
2. → Add `driving_school` preset config (use appointments mode)
3. → No new code (unless driving schools need something unique)

**Should we add "Medical Lab"?**
1. Can appointments handle lab tests? Partially (book test, get result)
2. Is result-reporting an extension? No, it's a different workflow (sample → processing → results)
3. Is this a new mode? Yes, lab workflow is distinct
4. Will improving core solve this for many? No, labs are niche
5. → Build new mode when lab customer commits

**Should we add "Manufacturing"?**
1. Can an existing mode handle BOMs + work orders? No
2. Is it an extension? No
3. Is this a new mode? Yes, production is different from all existing modes
4. Will it help many industries? Yes (bakery, factory, etc. all use BOMs)
5. → YES, build manufacturing mode (M11, on-demand)

### Implementation Rule

**Build a new mode only when:**
- #3 (new operational mode) = YES
- AND #4 (helps many industries) = YES OR (there's paying customer demand)

**Otherwise:** Add preset configuration or extend existing mode.

---

## 28. Recommended Merchant Onboarding Experience

### Step-by-Step Flow (Ideal UX)

#### Step 1: Account Creation (2 min)
```
Email → Password → Account created
→ No underwriting, no approval, no friction
```

#### Step 2: Verify Email (1 min)
```
"Check your email for verification link"
→ Click link
→ Account activated
```

#### Step 3: Pick Country (30 sec)
```
Dropdown: [ Select your country... ▼ ]
→ PK | US | UAE | etc.
→ Determines timezone, currency, tax regime, payment/courier availability
```

#### Step 4: Pick Business Type (1 min)
```
Cards: [ Retail ] [ Restaurant ] [ Salon ] [ Hotel ] ...
→ Merchant clicks their business type
→ System loads preset config (labels, nav, sample data, default modes)
```

#### Step 5: Store Details (2 min)
```
Store name: [ ________________ ]
Address: [ ________________ ]
Phone: [ ________________ ]
Logo upload (optional)
→ Creates first outlet
```

#### Step 6: Initial Setup (3-5 min)
```
Setup wizard with industry-specific steps:

For Retail:
  [ ] Add 5 products
  [ ] Take a photo of your store
  [ ] Add first employee
  [ ] Done!

For Restaurant:
  [ ] Add menu items
  [ ] Set up floor plan
  [ ] Create staff
  [ ] Done!

For Salon:
  [ ] Add services
  [ ] Set team + commissions
  [ ] Create availability
  [ ] Done!
```

#### Step 7: First Transaction (1-2 min)
```
→ Test checkout with sample product/service
→ Payment goes to sandbox (no real money)
→ Receipt prints
→ "Congratulations! You're ready to go live."
```

**Total onboarding time:** ~10 minutes

**Key traits:**
- No sales reps
- No approval delays
- Immediate usability (sample data = can test POS immediately)
- Industry-specific guidance
- Sandbox payment = zero risk

### Dashboard After Onboarding

Merchant lands on a dashboard tailored to their business:

**Retail tenant sees:**
- Revenue today
- Top-selling items
- Low-stock alerts
- Recent customers

**Restaurant tenant sees:**
- Revenue today
- Order count
- Average table time
- Kitchen performance

**Salon tenant sees:**
- Revenue today
- Appointments today
- Client acquisition
- Staff performance

All driven by preset config, no code changes per industry.

---

## 29. Code Artifacts & Implementation Details

### Backend Architecture

#### Database Schema (Postgres)

All tenant data lives in tenant-specific schemas (`tenant_<slug>`). Master data in `public` schema.

**Core tables (every tenant):**
- `company_profile` — Tenant config (industry_type, country_code, enabled_modes)
- `outlets` — Store locations
- `products`, `product_variants`, `categories` — Catalog
- `customers`, `customer_groups` — CRM
- `employees`, `employee_roles`, `permissions` — Team
- `sales`, `sale_items` — Transactions
- `invoices`, `invoice_items` — Billing
- `cash_shifts` — Shift accounting
- `features_flags` — Operational toggles
- `tenant_modes` — Enabled modes

**Mode-specific tables:**
- Restaurant: `restaurant_floor_plans`, `restaurant_table_sessions`, `restaurant_checks`, `kds_tickets`
- Appointments: `appointments`, `booking_services`, `calendar_events`
- Rentals: `rental_items`, `rental_contracts`
- Room management: `rooms`, `room_bookings`, `room_folios`
- Treatment plans: `treatment_plans`, `treatment_sessions`, `treatment_notes`
- And many more...

#### API Architecture

**Pattern:** All routes use mode gating via `requireMode()` middleware.

```javascript
// Example: restaurant-only route
router.get('/api/floors', 
  loadTenant,
  loadTenantAndPerms,
  requireMode('restaurant'),
  requirePerm('manage_restaurant'),
  async (req, res) => {
    // Route logic
  }
);
```

**Endpoint categories:**
- `/api/sales` — POS transactions
- `/api/invoices` — Invoicing
- `/api/customers` — CRM
- `/api/inventory` — Stock management
- `/api/[mode]/` — Mode-specific endpoints (e.g., `/api/floors`, `/api/rooms`, `/api/appointments`)
- `/api/reports` — Analytics
- `/api/portal/` — Customer portal
- `/api/webhooks/` — Payment/external callbacks

#### Authentication

**User login:**
1. `POST /api/auth/login` with username + password (or PIN for kiosk)
2. Returns JWT token (tenant_id, user_id, permissions encoded)
3. Token stored in localStorage (frontend) or cookie (API)

**Multi-tenant routing:**
- JWT decoded, extracts tenant_id
- `loadTenant` middleware sets AsyncLocalStorage context
- All DB queries use SET search_path to tenant schema

#### File Storage

- **Images:** Cloudflare R2 (products, company logo, support screenshots)
- **Backups:** R2 (encrypted tenant backups)
- **Documents:** R2 (treatment plan PDFs, clinical documents)

### Frontend Architecture

#### Context Hierarchy

```
<App>
  <SentryBoundary>
    <ToastProvider>
      <CurrencyProvider>
        <AuthProvider>
          <BootstrapProvider>
            <PresetProvider>
              <AppLayout>
                <Routes>
```

#### Key Context Providers

| Provider | What It Provides | Usage |
|----------|-----------------|-------|
| **AuthProvider** | JWT token, user, permissions | `useAuth()` |
| **BootstrapProvider** | Tenant config, modes, labels, nav | `useBootstrap()` |
| **PresetProvider** | Preset labels, enabled modes, unit vocabulary | `usePreset()` |
| **CurrencyProvider** | Currency symbol, formatter, denominations | `useCurrency()` |
| **ToastProvider** | Toast notifications | `useToast()` |

#### Component Organization

**Pages (page-level components):**
- `pages/redesign/*Redesign.jsx` — Main pages (all active)
- `pages/portal/*` — Customer portal pages
- `pages/admin/*` — Super-admin pages

**Components (reusable):**
- `components/DentalChart.jsx`, `BodyChart.jsx` — Clinical charting
- `components/PwaInstallPrompt.jsx` — App install banner
- `ui/primitives.jsx` — Design system (Button, Input, Card, etc.)

**API Layer:**
- `api.js` — Centralized service with `get/post/put/del/upload/raw` methods
- Handles URL construction, auth headers, error handling, JSON parsing

#### POS Architecture

**POS Context (`POSContext.jsx`):**
- 130+ exports managing all POS state
- Cart management
- Shift context
- Customer selection
- Payment intent
- Offline queue
- Keyboard shortcuts

**POS Components:**
- `POSRedesign.jsx` — Main POS grid
- `POSCheckoutModal.jsx` — Payment UI
- `CustomerSearchModal.jsx` — Customer lookup
- `RefundModal.jsx` — Return handling

### Deployment & Infrastructure

#### Local Development

```bash
# Terminal 1: Backend
cd backend
npm run dev
# Runs on localhost:5000 with nodemon

# Terminal 2: Frontend
cd frontend
npm run dev
# Runs on localhost:5173 with Vite

# Database
# Use local Postgres or cloud Supabase with DATABASE_URL env var
```

#### Railway Deployment (Production)

```bash
# Connect
railway link

# Deploy
git push origin main
# Railway auto-builds + deploys

# Environment
PAYMENT_GATEWAY=xpay
DATABASE_URL=postgres://supabase...
NODE_ENV=production
```

#### Database Migrations

```bash
# Local
node backend/migrate-pg.js

# Railway
railway run bash -c "node backend/migrate-pg.js"
```

**Important:** Migrations run on public schema AND all tenant schemas. Existing tenants must be on same version.

---

## 30. Deferred Work & Out-of-Scope Features

### Explicitly Deferred (Demand-Driven)

These are documented, designed, but intentionally deferred until customer demand or budget allows:

**M6 Deferred (Booking Deposits):**
- Public booking page deposit payment step
- Backend ready; frontend UI is follow-up

**M8 Deferred (Portal Features):**
- Portal subdomain (portal.sanopos.com)
- Per-tenant custom domains
- In-portal staff chat
- Loyalty redemption from portal
- Storefront cart integration
- Social login (Google, Facebook)

**M9 Deferred (Hospitality Features):**
- Channel manager (Airbnb/Booking.com OTA integration)
- Dynamic pricing
- Group bookings
- Housekeeping dashboard
- Late-checkout auto fees
- Multi-property rollup reporting
- Public `/reserve/:slug` room reservation page
- Loyalty redemption on stays
- Hotel discounts/packages
- Room blocks and maintenance holds
- Split folios
- Tax-inclusive room rates

**M10 Deferred (Clinical Features):**
- ICD-10/SNOMED autocomplete
- E-prescribing (send prescriptions to pharmacies)
- Insurance claim generation
- DICOM viewer (medical images)
- AI drug-interaction warnings
- Multi-provider SOAP co-signing
- Patient portal intake forms
- Portal self-book for treatment plan sessions
- Dental perio chart (specialized tooth regions)
- Vaccination tracking (vet-specific)

**M11 Deferred (Manufacturing):**
- BOMs (bill of materials)
- Work orders
- Raw material consumption
- Production costing
- Production dashboard

### Intentionally Out-of-Scope

These will NOT be built because they don't fit the platform strategy:

1. **Consumer app (Cash App analog)** — SanoPOS is merchant-focused, not consumer-focused
2. **Hardware manufacturing** — Don't sell hardware; partner with device manufacturers
3. **Banking services** — Don't offer checking/savings/loans; partner with financial institutions
4. **Global expansion in Year 1-2** — Focus on Pakistan first, then regional expansion
5. **AI forecasting** — Complex, expensive; build only if paying customer demand exists
6. **Blockchain/crypto features** — Not in scope for SMB POS
7. **Advanced CRM** — Beyond what preset/modes need; integrate with third-party CRM instead
8. **Supply chain management** — Not a POS feature; partner with supply chain tools
9. **Franchise portal** — Multi-location support exists; franchise-specific features are not priority

---

## CONCLUSION

SanoPOS is architected as a **multi-vertical, composable commerce platform** that combines:
- **Square's breadth** — Multiple business types (retail, restaurant, salon, appointments, etc.)
- **Toast's restaurant depth** — Floor plans, coursing, KDS, advanced POS workflows
- **Pakistan-first compliance** — FBR integration, local couriers, payment rails, tax support
- **Emerging market value pricing** — Designed for SMBs, not $149/mo enterprise pricing

**The operating model** is simple:
1. **One shared core** (POS, inventory, customers, payments, portal, reporting)
2. **Nine business modes** (retail, restaurant, appointments, service_projects, subscriptions, workflow_tickets, rentals, room_management, treatment_plans)
3. **Twenty-three industry presets** (labels, nav, dashboard, onboarding, sample data)
4. **Twenty-three country packs** (tax, currency, payment/courier providers, compliance)

**Current status:**
- ✅ v1 Complete (M1-M4, 2026-04-14)
- ✅ v2 Complete (M5-M10, 2026-04-15)
- ✅ 23 presets live covering ~48 of 54 industries
- ⏸️ M11 (Manufacturing) deferred on-demand
- → Next: Core hardening, not vertical sprawl

This document is the canonical reference. Use it for all future architecture, product, and strategy decisions.

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-16  
**Authored by:** Hassan Siddiqui + Claude (comprehensive consolidation)  
**Repository:** github.com/Sano9942/oneshoppos

# SanoPOS 54-Industry Coverage Matrix

**Date:** 2026-04-10  
**Purpose:** Repo-based assessment of which industries SanoPOS can honestly claim today  
**Source basis:** `docs/archive/competitive-analysis.md` plus fresh code inspection across restaurant, bookings, projects, contracts, subscriptions, invoicing, commissions, wallet, and omnichannel modules

---

## Status Key

- **Now**: SanoPOS can credibly serve this industry today with current modules and workflows.
- **Partial**: SanoPOS has enough foundations to be workable, but still lacks industry-specific depth, screens, or workflows.
- **Not Yet**: SanoPOS does not yet have the dedicated workflow or domain model needed to honestly claim this industry.

---

## Summary

| Status | Count |
|---|---:|
| **Now** | **28** |
| **Partial** | **20** |
| **Not Yet** | **6** |
| **Total** | **54** |

---

## Coverage Matrix

| # | Industry | Status | Notes |
|---|---|---|---|
| 1 | General Retail | **Now** | Strong core retail POS fit |
| 2 | Grocery / Supermarket | **Now** | Barcode, stock, checkout, multi-outlet |
| 3 | Electronics | **Now** | Standard retail + variants + supplier workflows |
| 4 | Pharmacy / Medical Store | **Now** | Works as product retail, not clinical workflow |
| 5 | Bookstore / Stationery | **Now** | Standard inventory retail |
| 6 | Hardware / Building Materials | **Now** | Standard inventory retail |
| 7 | Cosmetics / Beauty Supply | **Now** | Standard inventory retail |
| 8 | Pet Shop | **Now** | Standard inventory retail |
| 9 | Toy Store | **Now** | Standard inventory retail |
| 10 | Sports / Fitness Equipment | **Now** | Standard inventory retail |
| 11 | Furniture / Home Decor | **Now** | Standard inventory retail |
| 12 | Jewelry Store | **Now** | Standard inventory retail |
| 13 | Optical / Eyewear | **Now** | Retail-only claim, not prescription workflow |
| 14 | Gift Shop / Souvenir | **Now** | Standard inventory retail |
| 15 | Auto Parts | **Now** | Standard inventory retail |
| 16 | Wholesale / Distribution | **Now** | Inventory, purchasing, transfers, accounting |
| 17 | Tobacco / Vape Shop | **Now** | Standard inventory retail |
| 18 | Art Supply | **Now** | Standard inventory retail |
| 19 | Musical Instruments | **Now** | Standard inventory retail |
| 20 | Garden / Nursery | **Now** | Standard inventory retail |
| 21 | Printing / Copy Shop | **Now** | Works for supply-selling shops |
| 22 | Bakery / Cafe / Juice Bar | **Now** | Restaurant and quick-service foundations exist |
| 23 | Fast Food / Counter Service | **Now** | Quick-service and kitchen flow supported |
| 24 | Food Truck / Kiosk | **Now** | Quick-service POS fits |
| 25 | Sweet Shop / Mithai | **Partial** | Sellable, but weight-heavy flow still shallow |
| 26 | Ice Cream / Dessert Parlor | **Partial** | Sellable, but modifier-heavy UX needs more depth |
| 27 | Florist | **Partial** | Can sell and book, but delivery/perishable flow is thin |
| 28 | Butcher / Meat Shop | **Partial** | Unit support exists, but weight-selling UX is not specialized |
| 29 | Dry Fruits / Spice Shop | **Partial** | Unit support exists, but loose-weight selling needs more depth |
| 30 | Convenience Store / Kiryana | **Now** | Strong standard shop support |
| 31 | Tailor / Alteration Shop | **Partial** | Quotations/projects help, but no measurement workflow |
| 32 | Laundry / Dry Cleaning | **Partial** | Workflow can be adapted, but no garment-specific ticketing |
| 33 | Car Wash | **Partial** | Service and booking foundations exist, but vehicle workflow is shallow |
| 34 | Photography Studio | **Now** | Quotes, bookings, projects, contracts, invoices fit well |
| 35 | Full-Service Restaurant | **Now** | Floor plans, sessions, checks, split bills, coursing, KDS |
| 36 | Salon / Barbershop / Spa | **Now** | Services, appointments, staff assignment, commissions |
| 37 | Medical Clinic / Doctor | **Partial** | Booking works, but no patient record or prescription system |
| 38 | Dental Clinic | **Not Yet** | No treatment-plan or dental-chart workflow |
| 39 | Veterinary Clinic | **Not Yet** | No pet patient or vaccination workflow |
| 40 | Gym / Fitness Studio | **Partial** | Subscriptions exist, but class/check-in flow is incomplete |
| 41 | Repair Shop | **Partial** | Quotes, projects, invoices help, but no true repair-ticket model |
| 42 | Tuition Center / Academy | **Partial** | Billing and subscriptions exist, but student/attendance workflow is thin |
| 43 | Driving School | **Partial** | Booking + billing foundations exist, but lesson workflow is not dedicated |
| 44 | Coworking Space | **Partial** | Booking resources + subscriptions help, but space management is incomplete |
| 45 | Rental Business | **Not Yet** | No rental check-out/check-in/deposit/damage workflow |
| 46 | Hotel / Guest House | **Not Yet** | No room-night, folio, or stay management system |
| 47 | Event Venue / Banquet Hall | **Partial** | Booking, quotations, contracts, deposits are adaptable |
| 48 | Courier / Logistics Office | **Partial** | Courier integrations exist, but not a front-desk parcel product |
| 49 | Kiryana (credit book / udhar) | **Partial** | Wallet/accounting/ledger foundations exist, but no true udhar-book UX |
| 50 | Textile / Fabric Shop | **Partial** | Can sell products, but meter-based retail flow is not specialized |
| 51 | Fertilizer / Agri Supply | **Partial** | Wholesale + credit foundations exist, but agri-specific flow is not dedicated |
| 52 | Medical Lab | **Not Yet** | No lab-test, sample, or result-report workflow |
| 53 | Atta Chakki (flour mill) | **Partial** | Unit handling exists, but grain-storage and weight workflow are not dedicated |
| 54 | Dastarkhwan / Charity Kitchen | **Not Yet** | No donor/distribution/non-commercial meal workflow |

---

## Interpretation

The key product truth is:

- SanoPOS now clearly supports all major multi-vertical building blocks:
  - retail and wholesale commerce
  - restaurant operations
  - appointment-led businesses
  - service projects and contracts
  - subscriptions and recurring billing
  - ledger-style customer/account workflows
- But several industries still need deeper vertical UX or domain-specific records before they can be marketed as fully supported.

The strongest honest positioning today is:

> SanoPOS is already a broad multi-vertical platform that can confidently serve 28 industries now, support 20 more with partial adaptation, and has 6 industries that still need dedicated vertical development.

---

## Main Reasons Some Industries Are Still Partial Or Not Yet

- No dedicated patient record model
- No prescription workflow
- No dental charting
- No pet/vaccination workflow
- No hotel room-stay management
- No rental return/deposit/damage workflow
- No lab-result workflow
- No garment measurement workflow
- No dedicated repair intake and status board
- No specialized weight- or meter-first selling UX

---

## Future Vertical Strategy

The long-term goal should **not** be to build 54 disconnected mini-products.

The better product strategy is:

- one core platform
- a small set of business-model modules
- industry presets layered on top

This fits the existing SanoPOS architecture well because the repo already has:

- a shared commerce/accounting/customer foundation
- tenant-scoped `feature_flags`
- route-level gating via `requireFeature(...)`
- sidebar items already filtered by `requiredFlag` and permissions
- onboarding/setup flow through `company_profile`

In practice, the best path is:

1. keep the backend mostly shared
2. add an `industry_type` and `business_model` to the tenant profile
3. use a central config object to control labels, nav, POS layout, onboarding seeds, and enabled vertical surfaces
4. map many industries to a smaller number of business models

This means SanoPOS should behave like:

- **one codebase**
- **many faces**
- **no code forks per industry**

---

## Recommended SanoPOS Model

### 1. Select Business Type During Onboarding

During signup or setup, the tenant should choose the type of business they run.

Examples:

- retail
- grocery
- restaurant
- salon
- clinic
- wholesale
- service business

The current setup flow in `backend/routes/setup.js` and the existing `company_profile` table are the natural place to store this.

Recommended tenant-facing fields:

- `industry_type`
- `business_model`
- `industry_preset_version`

Example:

- `industry_type = 'salon'`
- `business_model = 'service_appointment'`

### 2. Use A Central Industry Config

Instead of hardcoding behavior across many pages, one config should drive adaptation.

Example shape:

```js
const INDUSTRY_CONFIG = {
  retail: {
    labels: { product: "Product", customer: "Customer", sale: "Sale" },
    featureFlags: [],
    navGroups: ["Overview", "Commerce", "Inventory", "Stock Control", "Insights", "Setup"],
    posMode: "retail",
    onboarding: { sampleData: "retail" },
  },
  restaurant: {
    labels: { product: "Menu Item", customer: "Guest", sale: "Order" },
    featureFlags: ["phase4_restaurant", "phase4_restaurant_kds", "phase4_restaurant_qr"],
    navGroups: ["Overview", "Commerce", "Restaurant", "Insights", "Setup"],
    posMode: "restaurant",
    onboarding: { sampleData: "restaurant" },
  },
  salon: {
    labels: { product: "Service", customer: "Client", sale: "Appointment" },
    featureFlags: ["phase4_appointments", "phase2_commissions"],
    navGroups: ["Overview", "Appointments", "Operations", "Marketing & Billing", "Insights", "Setup"],
    posMode: "service",
    onboarding: { sampleData: "salon" },
  },
};
```

### 3. Adapt More Than Just Navigation

Industry adaptation should affect:

- sidebar visibility
- page labels
- dashboard widgets
- POS layout
- receipt wording
- onboarding checklist
- sample data seeding

Examples:

- retail: `Product`, `Customer`, `Sale`
- restaurant: `Menu Item`, `Guest`, `Order`
- salon: `Service`, `Client`, `Appointment`
- clinic: `Service`, `Patient`, `Visit`

This is what makes the same platform feel purpose-built without rewriting the entire product.

### 4. Do Not Build 54 Presets

The scalable approach is to map industries to a smaller set of business models.

Examples:

- restaurant, bakery, cafe -> `order_prepare`
- salon, clinic, driving school -> `service_appointment`
- repair shop, tailor, laundry -> `intake_workflow`
- gym, tuition, coworking -> `billing_membership`
- wholesale, grocery, general retail -> `buy_sell`

That keeps the system maintainable while still feeling verticalized.

### 5. Let Tenants Expand Later

A tenant should start with one preset, but later be able to enable more modules.

Examples:

- retailer adds appointments
- salon adds retail inventory
- service business adds subscriptions
- restaurant adds QR ordering and KDS

So the system should support:

- one default industry preset
- multiple enabled modules over time

This is closer to a platform than a rigid single-industry app.

### 6. Treat Industry Switching Carefully

Changing industry later should not be a casual toggle.

It should be an intentional admin action because it may affect:

- labels
- navigation
- default layouts
- enabled features
- onboarding guidance

Best practice:

- choose industry during setup
- allow changing later from settings
- show a clear confirmation explaining what will change

---

## How This Compares To Square

Square works in a conceptually similar way, but with a more productized **mode** system.

### What Square Does

Square currently uses:

- one unified POS app
- multiple business-specific modes inside that app

As of **April 10, 2026**, Square’s official POS modes are:

1. Full Service
2. Quick Service
3. Bar
4. Retail
5. Bookings
6. Services
7. Standard

Square’s official docs describe that:

- sellers are guided toward the mode that best matches their business
- sellers can add more modes later
- modes can be assigned per device
- one business can run different workflows on different devices
- features from separate modes are not arbitrarily mixed into one mode

### What SanoPOS Should Learn From Square

SanoPOS should follow the same core principle:

- one platform
- several business-model experiences
- customers start with one recommended preset
- customers can add more modules later

The difference is mostly naming:

- Square calls them **modes**
- SanoPOS can call them **industry presets** or **business modes**

### Best Product Interpretation For SanoPOS

The strongest interpretation for SanoPOS is:

- `feature_flags` decide what is technically enabled
- `industry_type` decides what the product feels like
- `business_model` keeps the architecture manageable

That means the future system should not be:

- 54 hardcoded industry apps

It should be:

- 6 core business models
- 10-15 polished presets
- shared backend systems underneath

---

## Recommended Next Implementation Step

If this strategy is adopted, the cleanest first implementation wave is:

1. add `industry_type`, `business_model`, and `industry_preset_version` to `company_profile`
2. update the setup flow to collect and store them
3. create a shared industry config module
4. filter navigation and labels from that config
5. auto-enable recommended feature flags for the selected preset
6. add preset-specific dashboard widgets and onboarding seeds

This would let new tenants choose their industry at account creation and immediately experience a version of SanoPOS that feels tailored to their business.

---

## Global-Scale Architecture Blueprint

If the ambition is no longer just Pakistan but a truly global Square-like product, then the right goal is not:

- one app that is "generic" everywhere

The right goal is:

- one global core
- many country layers
- many business-mode experiences
- one extensible platform architecture

This is achievable in product and architecture terms, but only if SanoPOS is intentionally designed as a global platform from now onward.

---

## Core Product Principle

The strongest long-term interpretation of SanoPOS is:

- **one global commerce platform**
- **one mode/preset system**
- **one localization system**
- **one integration abstraction layer**
- **no country forks**
- **no industry forks**

In other words:

- not "Pakistan POS"
- not "US POS"
- not "restaurant app"
- not "salon app"

But instead:

- **Sano Core**
- plus **country pack**
- plus **industry preset**
- plus **enabled business modes**

---

## Six-Layer Platform Model

### 1. Global Core

This is the shared foundation every merchant type needs:

- tenants
- outlets and locations
- catalog
- inventory
- cart and checkout
- customers
- employees and roles
- orders, sales, and returns
- reports
- audit and events

This layer should remain generic and reusable across all countries and business types.

### 2. Business Modes

SanoPOS should be organized around a small number of core operating modes:

- `retail`
- `restaurant`
- `appointments`
- `service_projects`
- `subscriptions`
- `workflow_tickets`

These are capability packs, not separate apps.

Each tenant starts with one recommended mode set and can expand later.

### 3. Country Layer

Global scale requires a formal localization layer.

Each tenant should carry country-aware rules such as:

- country code
- tax regime
- currency defaults
- invoice and receipt rules
- timezone and locale
- allowed payment providers
- allowed shipping providers
- compliance toggles

This should be thought of as:

- `country_pack = PK | US | UK | UAE | ...`

The country layer should be isolated from business-mode logic.

### 4. Industry Presets

Industry presets decide how the product feels, without changing the underlying platform.

Examples:

- salon -> appointments + commissions + retail-lite
- cafe -> restaurant + quick-service
- clinic -> appointments + workflow + invoicing
- wholesale -> retail + price lists + payables

Industry presets should control:

- labels
- navigation visibility
- dashboard widgets
- default enabled modes
- default POS layout
- onboarding checklist
- sample data seeding

### 5. Integration Layer

Every external provider should be hidden behind adapters.

Examples:

- payment providers
- couriers and shipping
- accounting exports
- ecommerce channels
- messaging, SMS, email
- hardware

This prevents business logic from becoming tied to one provider or one country.

### 6. Extension Data Model

Not every industry-specific field belongs in the core tables.

The data model should use:

- stable shared core tables
- mode-specific tables
- extension tables for uncommon vertical depth

Examples:

- core customer table stays generic
- clinic data goes into `customer_medical_profiles`
- repair flow goes into `service_tickets`
- hotel stay data goes into `room_stays`

This keeps the platform maintainable as more verticals are added.

---

## Recommended Global Data Model Direction

To support this architecture cleanly, the tenant profile should eventually include:

- `industry_type`
- `business_model`
- `country_code`
- `default_locale`
- `industry_preset_version`

Then the platform should evolve toward configuration tables such as:

- `business_modes`
- `tenant_enabled_modes`
- `industry_presets`
- `country_packs`
- `tenant_mode_settings`
- `tenant_localization_settings`
- `integration_providers`
- `tenant_integrations`

This is more scalable than depending forever on a large and growing set of boolean flags.

### Capability Model

It is useful to also introduce capability metadata such as:

- `capability_key`
- `enabled_by_default`
- `requires_mode`
- `requires_country_support`

This would let the product compute what should be visible or enabled without scattering logic across the app.

---

## Runtime Product Behavior

When a merchant logs in, the system should compute:

- tenant country
- enabled modes
- active industry preset
- feature capabilities
- employee permissions
- outlet and device context

Then the UI should be assembled from that state.

Instead of hardcoding behavior page by page, the app should ask:

- what modes are enabled for this tenant?
- what preset is active?
- what country rules apply?
- what can this employee access?

That is the core of a global Square-like platform behavior.

---

## Recommended Merchant Experience

The ideal new-merchant flow is:

1. create account
2. pick country
3. pick business type
4. system recommends a starting mode or preset
5. system enables default modules
6. system seeds sample data and layouts
7. dashboard and navigation change immediately

Later, the merchant should be able to expand by enabling more modes.

Examples:

- retail + appointments
- restaurant + retail
- services + subscriptions

This is the same general product philosophy used by mature multi-vertical platforms.

---

## Important Design Rules

To make SanoPOS global and maintainable, these rules matter:

- build around **capabilities**, not dozens of disconnected industries
- keep **industry presets** as configuration, not product forks
- keep **country logic** separate from business-mode logic
- keep **integrations** behind adapters
- keep **core tables generic**
- use **mode-specific extension tables** for deep vertical workflows

---

## Global Build Order

The cleanest implementation order for a global-ready SanoPOS is:

1. add `industry_type`, `business_model`, and `country_code`
2. create `industry-config` and `country-pack` concepts
3. make the bootstrap API return computed mode and preset information
4. make navigation, labels, dashboard, and POS layout read from that
5. gradually evolve heavy feature-flag logic into mode and capability logic
6. standardize adapters for payments, shipping, messaging, and ecommerce
7. use extension-table patterns for deeper verticals

---

## Global Ambition Clarified

If SanoPOS aims to become a global Square-like platform, the distinction to keep in mind is:

- a **global-scale software product** is achievable
- a **global-scale operating business like Square** is much harder

The software architecture is achievable if built correctly.

What takes longer is:

- country-by-country compliance
- country-by-country payments
- country-by-country shipping and tax support
- global operations and support maturity

So the practical strategy is:

1. build a global-capable architecture
2. build a strong mode and preset system
3. choose a small number of launch regions
4. add localization packs region by region
5. expand integrations region by region

---

## Final Strategic Interpretation

The correct long-term goal is not:

- clone Square screen-for-screen

The correct long-term goal is:

- build a **Square-like operating model**
- on a **global-ready architecture**
- with **Sano-owned strengths**
- and with **country-aware, mode-aware extensibility**

That means:

- Square can be the structural reference
- SanoPOS should become its own platform
- the architecture should be global from the start
- country packs and industry presets should make it adaptable everywhere

---

## Where To Start

If the goal is to become a global, Square-like multi-vertical platform, the correct starting point is:

- **build the foundation first**
- **not more verticals first**

The reason is simple:

- SanoPOS already has meaningful vertical pieces in the repo
- adding more verticals before the platform adapts by preset and mode will create duplication
- navigation, labels, onboarding, and workflows will become harder to maintain
- the current strategy in this document already points toward presets, business models, and country packs

So the first implementation priority should be:

- **mode / preset / country-ready architecture**

And only after that:

- deeper vertical buildout

---

## Why More Verticals Should Not Be First

Right now, SanoPOS already has real foundations for:

- retail
- restaurant
- appointments
- service projects
- subscriptions

That means the platform already has enough surface area to justify building the adaptation system first.

If more industry workflows are built before that system exists, the likely result is:

- hardcoded differences scattered across many pages
- duplicated flows
- inconsistent naming
- unstable navigation behavior
- increased maintenance cost

That is exactly what a global multi-vertical platform should avoid.

---

## Recommended Build Sequence

### Phase A — Build The Product Skeleton First

The first major milestone should be a tenant-aware adaptation layer.

Recommended first tasks:

1. add `industry_type`, `business_model`, `country_code`, and `industry_preset_version` to `company_profile`
2. create one shared `industry-config` or mode config module
3. create a bootstrap payload that returns:
   - active preset
   - enabled modes
   - labels
   - visible nav groups
   - default dashboard widgets
   - POS layout mode
4. make the frontend read from that configuration for:
   - navigation
   - labels
   - dashboard
   - onboarding
   - POS layout

This is the highest-leverage place to begin.

### Phase B — Turn Existing Features Into Polished Modes

After the skeleton exists, the next step is to polish the verticals already present in the repo into coherent business modes.

Recommended first polished modes:

1. `retail`
2. `restaurant`
3. `appointments/services`

These should be first because:

- they already exist in code
- they are easy to demonstrate
- they prove the mode system works
- they get SanoPOS much closer to Square’s product behavior quickly

### Phase C — Build Cross-Cutting Primitives Before Niche Verticals

Before building many more specific industries, it is better to build reusable foundations that unlock many industries at once.

Examples:

- workflow or ticket engine
- weight and meter selling UX
- measurement or custom-fields framework
- recurring membership and check-in patterns
- resource booking patterns
- country and localization layer

These are more valuable than jumping directly into many niche verticals one by one.

### Phase D — Add Vertical Depth Strategically

Only after the previous phases are in place should SanoPOS add deeper vertical products such as:

- repair
- laundry
- tailor
- clinic
- gym
- coworking
- rental
- hotel

At that stage, each new vertical will fit into a stable architecture instead of forcing the architecture to evolve reactively.

---

## Practical Recommendation

The short answer is:

- **do not start by building more industry verticals first**
- **start by building the industry and mode architecture first**

Then:

1. polish the verticals already present
2. build reusable primitives
3. add deeper verticals

This order reduces duplication and increases long-term platform quality.

---

## Best First Milestone

If one first milestone had to be chosen, it should be:

### Tenant Preset Engine v1

That milestone would include:

- industry selection during onboarding
- storing the selection on the tenant profile
- configuration-driven navigation
- configuration-driven labels
- configuration-driven dashboard behavior
- configuration-driven POS behavior
- presets for:
  - `retail`
  - `restaurant`
  - `salon/services`

This is the smallest high-impact step that moves SanoPOS from:

- a collection of features

to:

- a coherent multi-mode platform

---

## Final Recommendation On Starting Order

The strongest starting order for SanoPOS is:

1. build the preset and mode architecture
2. polish existing modes already present in the repo
3. build shared cross-cutting primitives
4. then build more verticals

This is the safest and highest-leverage path toward a true global Square-like product.

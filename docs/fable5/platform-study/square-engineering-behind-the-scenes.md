# How Square Is Built Behind the Scenes — Engineering Patterns Research

> Compiled 2026-07-06. Part 1 is grounded in public sources (Square's engineering blog "The Corner",
> developer docs, open-source repos, conference talks). Part 2 is educated inference from industry
> knowledge, clearly marked. Hardware and payments/fintech internals deliberately excluded.
> Companion files: `square-software-audit.md`, `sanopos-vs-square-comparison.md`.

---

## PART 1 — What is publicly verifiable

### 1. Repo & code organization: a few giant monorepos, not one repo per app

Square does NOT have "a project folder" like a solo project. They have **several platform-scoped
monorepos, each with millions of lines of code**:

- A **Java/Kotlin backend monorepo** (hundreds of microservices live together in one repo)
- A **Go monorepo**
- An **Android monorepo** (the entire Point of Sale app + all Android apps)
- An **iOS monorepo**
- Historically a **Ruby/Rails monorepo** (the original 2009–2013 monolith, gradually broken up)

Source: [Evolution of Developer Productivity at Square](https://developer.squareup.com/blog/evolution-of-developer-productivity-at-square-part-one/)

Key implications of the monorepo pattern:
- One team can change a shared library and every consumer in one commit.
- Build tooling (Bazel for the big monorepos) computes exactly which targets a commit touches and
  builds/tests only those — this is what makes a multi-million-line repo usable.
- Code ownership is enforced per-directory (OWNERS files / CODEOWNERS): the "folder structure" IS
  the org chart. `//catalog/...` is owned by the Catalog team, `//labor/...` by the Labor team, etc.

### 2. Backend: microservices behind a service mesh, RPC-first

- Square runs **hundreds of microservices in Java, Ruby, and Go**, migrated onto an
  **Envoy service mesh** for cross-language service-to-service calls, mTLS, retries, and traffic
  routing. Source: [The Road to an Envoy Service Mesh](https://developer.squareup.com/blog/the-road-to-an-envoy-service-mesh/)
- Service boundaries follow **business domains**, not layers: Catalog service, Orders service,
  Inventory service, Labor/Timecards service, Customers service, Locations service, Team/Permissions
  service. Each owns its own database — no service reaches into another service's tables.
- Cash App (Block sibling) open-sourced **Misk** ("Microservice Kontainer"), the Kotlin service
  framework used at Square/Block scale (40k+ QPS), with built-in modules for endpoints, persistence
  (Hibernate/Vitess), queueing, feature flags, leasing, clustering. This is what "starting a new
  backend service" looks like there: `misk` gives you the skeleton so every service is shaped the
  same. Source: [cashapp/misk](https://github.com/cashapp/misk)
- Example migration story: [Square Payroll's migration from a monolith to microservices](https://developer.squareup.com/blog/square-payrolls-migration-from-a-monolith-to-microservices/)
  — the pattern is the classic **strangler fig**: new domain services extracted from the Rails
  monolith one bounded context at a time, with the monolith proxying to them until it's hollow.

### 3. The client apps: state machines all the way down (Workflow)

Square open-sourced their POS app architecture: **Workflow**
([square.github.io/workflow](https://square.github.io/workflow/),
[workflow-kotlin](https://github.com/square/workflow-kotlin),
[workflow-swift](https://github.com/square/workflow-swift)).

- Every screen and every flow (checkout, refund, clock-in, item edit) is a **composable state
  machine**: immutable state, data flows one direction (state → UI), events flow the other
  (UI → business logic).
- Workflows compose recursively — the checkout workflow contains the cart workflow contains the
  line-item workflow. Navigation itself is just "which child workflow is currently rendered."
- Why they did it: with hundreds of engineers in one POS app, ad-hoc screen wiring collapses. A
  state machine per feature means each team's feature is testable in isolation (pure
  state-transition unit tests, no emulator) and features compose without knowing about each other.
  Source: [Why Workflow?](https://developer.squareup.com/blog/why-workflow/)
- Square's Android team also birthed much of the modern Android OSS stack from this app's needs:
  OkHttp, Retrofit, Dagger (DI), LeakCanary, Wire (protobuf). Pattern: **when the platform tooling
  isn't good enough at their scale, they build a library and open-source it.**

### 4. Verticals (retail / restaurant / services): ONE platform + modes, not separate products

This answers the core question directly:

- As of 2025 Square markets **a single unified POS app with "modes"**: standard, bars,
  quick-service restaurant, full-service restaurant, retail, health & beauty, professional
  services. The seller picks a mode at onboarding; switching modes later is a settings change.
  Sources: [squareup.com/us/en/point-of-sale](https://squareup.com/us/en/point-of-sale),
  [NerdWallet Square for Restaurants review](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)
- A "mode" is **not a separate codebase**. It is:
  1. a **preset of enabled features** (KDS, coursing, floor plans ON for restaurants; exchanges,
     vendor management ON for retail),
  2. a **different POS layout/navigation default** (table map vs item grid vs appointment calendar),
  3. **vertical-specific fields on the shared data model** (e.g. Catalog `product_type =
     FOOD_AND_BEV` unlocks calorie/ingredient/dietary attributes on the same CatalogItem object),
  4. a **pricing/subscription entitlement** (mode features gate on what plan you pay for).
- The underlying spine — catalog, orders, payments, inventory, customers, employees, locations —
  is **the same objects for every vertical**. Verticals are additive layers, never forks.

### 5. The shared data model (visible through their public APIs)

Square's public API IS a window into their internal model — they are famously "API-first"; the
dashboard and POS use the same object model the public API exposes.

**Catalog** ([Catalog API docs](https://developer.squareup.com/docs/catalog-api/what-it-does)):
- Everything is a generic **`CatalogObject` envelope with a `type`** (ITEM, ITEM_VARIATION,
  MODIFIER_LIST, MODIFIER, CATEGORY, DISCOUNT, TAX, IMAGE, ITEM_OPTION, PRICING_RULE...). One
  polymorphic table/store, one sync mechanism, one versioning scheme for the whole catalog.
- **Item → Variations**: the item is the abstract product ("Shirt"), variations are the sellable
  SKUs ("Polo, L, Red"). **Item Options** (color/size) auto-generate the variation matrix.
- **Modifiers** are first-class objects attached via modifier lists, with per-modifier pricing and
  min/max selection rules — the same mechanism serves "extra shot" in a café and "engraving" in
  retail. Source: [Enable modifiers](https://developer.squareup.com/docs/catalog-api/enable-modifiers-on-items)
- Every CatalogObject carries a **`version` for optimistic concurrency** — writes must present the
  version they read, so concurrent dashboard/POS/API edits can't silently clobber each other.
- **Custom attributes** let verticals and third parties bolt fields onto the shared objects without
  schema changes. Source: [Add custom attributes](https://developer.squareup.com/docs/catalog-api/add-custom-attributes)

**Orders** ([Orders API docs](https://developer.squareup.com/docs/orders-api/what-it-does)):
- The **Order is the single top-level container** for every kind of sale — POS sale, online order,
  invoice, restaurant tab. Line items, taxes, discounts, service charges, tips, fulfillments all
  hang off it. There is no separate "restaurant check" object vs "retail sale" object.
- **Orders are state machines**: OPEN → COMPLETED/CANCELED, with fulfillments (PICKUP, SHIPMENT,
  DELIVERY) each having their own state machine inside the order.
- **Calculations are server-authoritative**: clients send line items + discount/tax references, the
  Orders service computes totals. One pricing engine, every surface.
- **Every create/update takes an `idempotency_key`** — retries (flaky POS networks!) can never
  double-create an order. This is pervasive across all Square write APIs.
- **Webhooks** broadcast order/fulfillment events so other services (and third parties) react
  asynchronously instead of being called inline.
  Source: [Orders webhooks](https://developer.squareup.com/reference/square/orders-api/webhooks)

**Labor / clock-in-clock-out** ([Labor API](https://developer.squareup.com/docs/labor-api/build-with-labor)):
- Two separate objects: **ScheduledShift** (planned, from the scheduler) and **Timecard** (actual,
  created the moment someone clocks in). Reconciling planned vs actual is what powers
  "prevent early clock-in", "alert on unscheduled shift", and labor-cost-vs-sales reports.
- A Timecard records start/end, **breaks (paid/unpaid, against configurable BreakType policy
  objects)**, declared cash tips, and a **wage snapshot** (the wage at the time of the shift is
  frozen onto the timecard — later raises don't rewrite history; same snapshot philosophy as
  prices/taxes on orders).
- Clock-in surfaces: passcode on the register, or the separate **Square Team App** on the
  employee's own phone — **enforced with geofencing**. Timecard edits by staff go through a
  manager **approval request flow**, not direct edits.
  Sources: [Set up time tracking](https://squareup.com/help/us/en/article/8389-set-up-time-tracking),
  [Clock in and out](https://squareup.com/help/us/en/article/8395-clock-in-and-out-for-team-members),
  [Request timecard edits](https://squareup.com/help/us/en/article/5643-timecard-management-with-square)
- Fine-grained OAuth-style permission scopes even internally: `TIMECARDS_READ/WRITE`,
  `TIMECARDS_SETTINGS_READ/WRITE` — every domain has its own scoped permissions.

### 6. CI/CD and testing

- Square built **Kochiku**, an open-source CI system that **shards giant test suites across
  hundreds of EC2 workers** so a multi-hour suite finishes in minutes.
  Sources: [Kochiku: CI for long test suites](https://developer.squareup.com/blog/kochiku-ci-for-long-test-suites/),
  [square/kochiku](https://github.com/square/kochiku)
- The pattern: at monorepo scale, CI must be (a) incremental (only affected targets), (b) parallel
  (sharded), (c) merge-gated (nothing lands on main without green). Deploys are continuous per
  service, decoupled from each other — the mesh + backward-compatible protobuf APIs make it safe
  for service A v2 to talk to service B v1.

---

## PART 2 — Educated inference (industry knowledge, not directly documented by Square)

These are high-confidence inferences from how Square's public artifacts behave, their OSS, ex-employee
talks, and how every company at this scale works. Treat as "very likely", not gospel.

### 7. Multi-tenancy: shared tables + merchant_token, NOT schema-per-tenant

- Square almost certainly uses **shared tables where every row carries a `merchant_id` /
  `merchant_token`**, sharded horizontally (Vitess-style MySQL sharding — note `misk-vitess`
  exists) with the merchant ID as shard key. Schema-per-tenant does not survive millions of
  sellers; at that scale tenancy is a **column + a middleware-enforced scope**, and horizontal
  scaling comes from sharding, not schemas.
- Every internal RPC carries the merchant context in metadata; services refuse queries without it.

### 8. Internal comms: protobuf contracts everywhere

- Service-to-service APIs are defined as **protobuf schemas in a shared registry** (Square built
  Wire, their own protobuf compiler). The .proto file is the contract; backward-compatibility rules
  (never reuse field numbers, only add optional fields) are what let hundreds of services deploy
  independently. The public JSON API is a translation layer over the same protos.

### 9. Feature flags & experimentation

- Square runs **percentage-rollout feature flags evaluated per merchant/employee/device**, with an
  internal flag service (Misk's Wisp module has a feature-flag abstraction; LaunchDarkly is used in
  parts of Block). The distinction that matters:
  - **Flags** = temporary, for rollout safety (kill switch, 1% → 10% → 100%), deleted after launch.
  - **Entitlements** = permanent, driven by subscription plan + mode (does this merchant get KDS?).
  - **Settings** = merchant-controlled toggles.
  These are three separate systems, not one flags table doing all three jobs.

### 10. POS offline mode

- The register keeps a **local replica of the catalog** (the CatalogObject envelope + version
  numbers is exactly the shape you build incremental sync on: "give me everything changed since
  version N").
- Sales made offline are **queued locally with client-generated UUIDs + idempotency keys** and
  replayed when connectivity returns — the server-side idempotency guarantee is what makes naive
  "replay the queue" safe. Payments taken offline are stored-and-forwarded with a risk time window.
- Server stays authoritative for money math; the device computes provisional totals with the same
  (shared, versioned) pricing rules shipped to it as data.

### 11. Data & analytics

- Every service emits **domain events to a Kafka-style bus**; a data platform lands them in a
  warehouse; the seller dashboard's reports/analytics run off read-optimized projections, not the
  transactional DBs. Reports are eventually consistent by design.

### 12. Org/process patterns worth copying at any scale

1. **The data model is the product.** One canonical object per concept (Order, CatalogObject,
   Timecard, Customer, Location) — every surface and every vertical reuses it. New verticals add
   fields and presets, never parallel tables.
2. **Idempotency keys on every write path.** Non-negotiable for anything touching money or stock.
3. **Optimistic versioning on shared mutable objects** (catalog `version`) instead of last-write-wins.
4. **Snapshot at transaction time** (wage on timecard, price/tax on line item) — history never
   rewrites when config changes.
5. **State machines for anything with a lifecycle** (orders, fulfillments, shifts, disputes) —
   explicit states + allowed transitions, enforced server-side.
6. **Server-authoritative calculation, client-provisional display.** One pricing engine.
7. **Planned vs actual as separate objects** (ScheduledShift vs Timecard) reconciled by reports.
8. **Modes/presets = flags + layout + vocabulary over one spine**, switchable at runtime.
9. **Flags ≠ entitlements ≠ settings** — three lifecycles, three systems.
10. **Directory ownership = team ownership**; code review is gated by owners of the touched paths.
11. **Contract-first internal APIs** (protobuf/OpenAPI) with backward-compat rules so components
    deploy independently.
12. **CI that scales by sharding + affected-target selection**, merge-gated main.
13. **Webhooks/events for cross-domain side effects** instead of inline calls from the sale path.
14. **Extract-and-open-source**: when a shared problem recurs, build a library with a boundary
    (OkHttp, Workflow, Misk, Kochiku) rather than copy-pasting solutions.

---

## Sources

- https://developer.squareup.com/blog/ (The Corner — Square engineering blog)
- https://developer.squareup.com/blog/evolution-of-developer-productivity-at-square-part-one/
- https://developer.squareup.com/blog/square-payrolls-migration-from-a-monolith-to-microservices/
- https://developer.squareup.com/blog/the-road-to-an-envoy-service-mesh/
- https://developer.squareup.com/blog/why-workflow/
- https://square.github.io/workflow/ · https://github.com/square/workflow-kotlin · https://github.com/square/workflow-swift
- https://github.com/cashapp/misk
- https://developer.squareup.com/blog/kochiku-ci-for-long-test-suites/ · https://github.com/square/kochiku
- https://developer.squareup.com/docs/catalog-api/what-it-does · /design-a-catalog · /enable-modifiers-on-items · /item-options · /add-custom-attributes
- https://developer.squareup.com/docs/orders-api/what-it-does · /how-it-works · /fulfillments
- https://developer.squareup.com/reference/square/orders-api/webhooks
- https://developer.squareup.com/docs/labor-api/build-with-labor · /manage-scheduled-shifts
- https://squareup.com/help/us/en/article/8389-set-up-time-tracking · /8395-clock-in-and-out-for-team-members · /5643-timecard-management-with-square · /6140-employee-timecard-reporting
- https://squareup.com/us/en/point-of-sale · https://squareup.com/us/en/point-of-sale/restaurants · https://squareup.com/us/en/point-of-sale/retail
- https://www.nerdwallet.com/business/software/reviews/square-for-restaurants
- https://square.github.io/ (Square open source index)

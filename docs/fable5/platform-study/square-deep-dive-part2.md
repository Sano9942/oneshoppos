# Square Deep Dive Part 2 — Offline Sync, Entitlements, Competitors, Permissions

> Compiled 2026-07-06. Follow-up to `square-engineering-behind-the-scenes.md`.
> Same rules: public sources first, marked inference where sources run out.
> Covers the four gap areas: (1) offline-first sync internals, (2) entitlements/plan gating,
> (3) how Toast and Shopify solve the same problems, (4) Square's permission model.

---

## 1. Offline-first sync — how Square actually does it

### The published facts

- **Offline is a bounded session, not an unbounded mode.** When connectivity drops, the device
  automatically enters an "offline payment session" with a **visible countdown clock**. Payments
  process automatically when the device reconnects **within 24 hours; hard cap 72 hours** — after
  that, queued card payments expire and are lost.
  Sources: [Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode),
  [Offline Payments (Mobile Payments SDK)](https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments)
- **Risk is explicitly transferred to the merchant, with configurable exposure.** The seller opts
  into offline mode and sets a **max amount per offline transaction ($1–$50,000)**. If a
  stored-and-forwarded card payment later declines or is disputed, **the merchant eats it**. Square
  doesn't try to make offline risk-free — they make the risk visible, bounded, and configurable.
- **Store-and-forward with encryption at capture.** Card data is encrypted on-device at swipe/tap
  time, stored in the app, uploaded on reconnect, then **securely deleted from the device**.
  Offline payments show as **"pending" in the local payment history** until synced, then flip to
  completed/declined — the UI is honest about sync state instead of pretending everything is final.
- **Not everything works offline, on purpose.** No refunds, no records/reports, no catalog edits,
  restricted device features during an offline session. The offline feature-set is a deliberately
  small, hand-picked subset (take payment, print receipt) — not "the whole app minus network."

### The architecture pattern (inference, high confidence)

1. **Catalog: full local replica, incremental version-based pull.** The CatalogObject envelope with
   a monotonic `version` on every object is exactly the shape for "give me everything changed since
   version N" delta sync. Shopify POS documents the same design (see §3). Sync is
   **pull-with-cursor**, not event streaming to devices.
2. **Writes: append-only local queue of client-UUID'd operations + idempotency keys.** Each offline
   sale is a self-contained record with a client-generated ID; replay on reconnect is safe purely
   because the server dedupes on idempotency key. No fancy CRDTs for sales — a sale is created once
   by one device, so there is no merge conflict, only the duplicate-delivery problem.
3. **Conflicts only exist for shared mutable objects** (catalog, open restaurant tabs shared across
   devices). Catalog handles it with optimistic versioning (reject stale writes). Shared open
   tickets are the genuinely hard case — Square historically limited what open tickets can do
   across devices while offline rather than solving distributed consensus.
4. **Totals are computed locally with rules-shipped-as-data** (tax tables, discounts synced as
   catalog objects), then recomputed authoritatively server-side on ingest. Local math is
   provisional; server math is the ledger.

**Transferable lessons:** bound the offline window and show a countdown; cap per-transaction
exposure with a merchant-set limit; make sync state visible ("pending") instead of faking finality;
shrink the offline feature-set to the money-critical path; version every catalog object so delta
sync is trivial; idempotency keys make replay safe without conflict resolution.

---

## 2. Entitlements & plan gating — how "mode + plan → features" is modeled

### The published facts

- **2025 repackaging: 18 à-la-carte subscriptions collapsed into 3 plans** — Square Free, Square
  Plus ($49/mo/location), Square Premium ($149/mo/location). Sellers can no longer mix-and-match
  features between tiers; the plan strictly determines the feature set.
  Sources: [Unified Plans & Pricing press release](https://squareup.com/us/en/press/unified-pricing-and-packaging),
  [The thinking behind our new pricing](https://squareup.com/us/en/the-bottom-line/inside-square/pricing-plans),
  [Switch to the new plans](https://squareup.com/help/us/en/article/8569-switch-to-the-new-square-subscription-plans)
- **Priced per active location**, not per user or per device.
- **Plans carry metered allowances, not just booleans**: Plus includes 500 marketing texts/month
  then 3¢ each; Premium includes 2,500 then 1.5¢. So the entitlement system supports
  **quota + overage pricing**, not only on/off gates.
- **30-day free trial of paid tiers, switch/cancel anytime** — entitlement changes are instant and
  self-service, no sales call.
- The interesting history: before 2025 Square ran YEARS with per-product subscriptions
  (Appointments Plus, Retail Plus, Restaurants Plus, Loyalty, Marketing, Payroll each billed
  separately). They **consolidated because the entitlement matrix became a sales/comprehension
  problem, not an engineering one** — the engineering system had to support both worlds during
  migration, which is only possible if entitlements are data, not code.

### The architecture pattern (inference, high confidence)

The three-layer model, restated with what each layer keys on:

| Layer | Keyed on | Lifecycle | Example |
|---|---|---|---|
| **Entitlement** | merchant's plan + location count | permanent, billing-driven | "this merchant may use floor plans" |
| **Mode/preset** | business type chosen at onboarding | semi-permanent, seller-switchable | "restaurant mode surfaces coursing UI" |
| **Setting** | merchant admin toggles | ad hoc | "tipping ON, 15/18/20%" |
| **(Rollout flag)** | percentage/cohort, internal | temporary, deleted post-launch | "new checkout to 5% of sellers" |

- A feature check is therefore a **conjunction**: `entitled(plan) AND surfaced(mode) AND
  enabled(setting)` — and each condition is owned by a different team (billing, product, seller).
- Entitlements are **served as a computed profile** ("this merchant's capability set") cached on
  device/session, recomputed on billing events — clients never inspect the plan name, they ask
  "can(feature)". That indirection is what let Square swap 18 subscriptions for 3 plans without
  touching feature code.
- **Grandfathering is a first-class state**: legacy per-product subscribers keep their old
  entitlement profiles until they migrate. This confirms entitlements are rows, not if-statements.
- Quotas (texts/month) mean the entitlement record carries **limits + usage counters + overage
  price**, unified with billing.

**Transferable lessons:** never check the plan name in feature code — resolve plan → capability
profile in one place; model entitlements as data rows so repackaging is a data migration; support
quota-typed entitlements, not just booleans; keep rollout flags in a separate, deletable system.

---

## 3. Competitors: Toast and Shopify POS

### Toast — the offline-first extreme (restaurant-only)

- **Vertical monogamy as an architecture choice.** Toast does restaurants only. No modes, no
  presets — the entire data model is restaurant-native (checks, courses, seats, kitchen routing).
  The cost: zero reuse across verticals. The benefit: no abstraction tax.
- **Android-only, proprietary hardware.** One OS, devices they control end-to-end (Flex terminals,
  Tap readers, KDS screens, handhelds). Controlling hardware means they can guarantee the offline
  story. Source: [Toast, Inc. — Wikipedia](https://en.wikipedia.org/wiki/Toast,_Inc.)
- **The most aggressive offline mode in the industry — via a local mesh, not per-device queues.**
  Toast's documented design: restaurant devices talk to each other over the **local network**; when
  the cloud/ISP dies, the platform detects it and the venue keeps operating as a unit — orders
  still flow POS → KDS → printer, checks still split, because that traffic is LAN-local. One
  device effectively acts as the local source of truth, syncing to cloud when back.
  Sources: [Toast offline mode overview](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html),
  [Offline mode](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html)
  This is a fundamentally different topology from Square's "each device queues independently":
  restaurants need device-to-device coordination offline (a check opened on the floor must reach
  the kitchen), retail mostly doesn't.
- Backend is cloud SaaS (JVM-heavy, microservices — inference from their hiring/talks), but the
  differentiating engineering is all at the edge/venue layer.

### Shopify — the modular monolith (the realistic template for a small team)

- **One Rails monolith, ~2.8M+ lines, deliberately NOT microservices.** Shopify runs one of the
  world's largest commerce platforms as a single deployable app, organized internally into
  **~37 "components"** — folders like `orders/`, `checkout/`, `merchandising/`, each a commerce
  domain with a **declared public interface**; everything else in the component is private.
  Source: [Under Deconstruction: The State of Shopify's Monolith](https://shopify.engineering/shopify-monolith)
- **Boundaries enforced by a CI tool, not by network calls.** They open-sourced **Packwerk**, a
  static analyzer that fails CI on two violation types: *dependency violations* (you referenced a
  package you didn't declare a dependency on) and *privacy violations* (you reached into another
  package's private internals instead of its public entrypoint). The core monolith has 48 packages
  with 30 boundary enforcements, checked on every commit.
  Source: [Enforcing Modularity in Rails Apps with Packwerk](https://shopify.engineering/enforcing-modularity-rails-apps-packwerk)
- The stated philosophy: **you get ~90% of microservices' organizational benefits (clear ownership,
  independent reasoning, controlled coupling) with ~10% of the operational cost** (one deploy, one
  DB transactionally consistent, no distributed tracing/service mesh/RPC versioning). Scaling is
  handled by sharding the monolith per-shop ("pods"), not by splitting services.
- **Shopify POS: React Native app on an offline-capable local DB.** POS started as a hackathon
  project for mom-and-pop stores and grew to billions in transactions — they rebuilt it in React
  Native ("iterative porting": new features in RN while old ones migrate) rather than starting
  over. Offline support = **local database routinely synchronized with the server**; their sync
  manager rewrite took initial sync for a medium store from 30+ seconds to 2–3 seconds (delta
  cursors + parallelized entity sync).
  Sources: [Migrating our Largest Mobile App to React Native](https://shopify.engineering/migrating-our-largest-mobile-app-to-react-native),
  [React Native is the Future of Mobile at Shopify](https://shopify.engineering/react-native-future-mobile-shopify),
  [Migrating to React Native's New Architecture](https://shopify.engineering/react-native-new-architecture)

### The three-way pattern comparison

| | Square | Toast | Shopify |
|---|---|---|---|
| Verticals | one platform + modes | restaurant only | retail-first + apps |
| Backend shape | 100s of microservices + mesh | cloud SaaS, edge-heavy | **modular monolith (Packwerk)** |
| POS client | native, Workflow state machines | Android on own hardware | React Native + local DB |
| Offline unit | per-device queue, bounded session | **whole venue via LAN mesh** | per-device local DB + delta sync |
| Scale mechanism | service decomposition | venue-local autonomy | per-shop sharding (pods) |

The meta-lesson: **all three converge on the same data-model patterns** (idempotent writes,
versioned catalog sync, server-authoritative totals, snapshot-at-sale) while diverging completely
on deployment topology — which proves topology is a team-size decision, and the data-model
discipline is the actual "modern way."

---

## 4. Square's permission & roles model

### The published facts

- **Permission sets, not hardcoded roles.** Square ships tiered starting points (Standard /
  Enhanced / Full access) that owners can clone and customize per-permission into custom
  **permission sets**; team members are assigned a set. (Advanced/custom sets are a paid-tier
  entitlement — permissions and billing gate together.)
  Sources: [Create and edit permission sets](https://squareup.com/help/us/en/article/5822-employee-permissions),
  [Square Advanced Access](https://squareup.com/us/en/staff/advanced-access)
- **A permission set declares its access points.** When customizing a set, the owner selects which
  **surfaces** it applies to: Point of Sale, Square Team app, online Dashboard, Dashboard mobile
  app. Dashboard access is itself a grantable permission — POS access and back-office access are
  **independently gated per role**, not implied by each other.
- **Two authentication tiers on the register:**
  - **Personal passcode** — per-employee PIN; every sale, clock-in, refund, and action is
    attributed to that individual.
  - **Team passcode** — one shared PIN mapped to a shared "team permissions" set for
    low-accountability floors; explicitly documented as NOT supporting per-person sales/time/action
    tracking. The trade-off (convenience vs attribution) is surfaced to the owner as a product
    choice rather than hidden.
  Source: [Require passcodes at point of sale](https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale)
- **Sensitive actions re-prompt for an authorized passcode inline** — refunds, discounts, voids can
  require a manager-permission passcode mid-transaction without the cashier logging out (the
  manager-override pattern).
- **Delegated administration**: owners can grant team members the ability to manage *other* team
  members (Delegated Team Management) — permission to grant permissions is itself a permission.
  Source: [Delegated Team Management](https://squareup.com/help/us/en/article/6170-delegated-employee-management)
- **The API mirrors it with OAuth-style scopes** per domain (`TIMECARDS_READ`, `TIMECARDS_WRITE`,
  `TIMECARDS_SETTINGS_READ/WRITE`, same pattern for orders/catalog/customers) — read, write, and
  settings-write are distinct scopes for every domain.

### The architecture pattern (inference, high confidence)

- Internally this is one flat vocabulary of fine-grained permission strings, grouped into
  **permission-set rows** (set = named bundle + list of grants + list of surfaces + location
  scope). Checks are `hasPermission(actor, perm, surface, location)` — never `role ==
  "manager"`.
- The **actor can be a device session + passcode-elevation**: the register runs under a device
  identity all day, and individual actions get attributed/elevated by whoever's passcode approves
  them. Separating *device authentication* from *person attribution* is the key POS-specific move.
- Every permission check failure is an **upsell surface** (feature exists, greyed with "upgrade to
  unlock") — permissions, entitlements, and billing share the gate UI.

**Transferable lessons:** permission sets as data (clonable templates), not enum roles; declare
per-surface applicability (POS vs dashboard vs employee app) on the set; separate device auth from
person attribution with inline passcode elevation for sensitive actions; make read / write /
settings-write separate grants per domain; delegated admin as an explicit permission.

---

## Sources (this document)

- https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode
- https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments
- https://developer.squareup.com/docs/pos-api/cookbook/offline-mode
- https://squareup.com/help/us/en/article/8551-view-offline-payments
- https://squareup.com/us/en/press/square-brings-offline-payments
- https://squareup.com/us/en/press/unified-pricing-and-packaging
- https://squareup.com/us/en/the-bottom-line/inside-square/pricing-plans
- https://squareup.com/help/us/en/article/8569-switch-to-the-new-square-subscription-plans
- https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html
- https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html
- https://en.wikipedia.org/wiki/Toast,_Inc.
- https://shopify.engineering/shopify-monolith
- https://shopify.engineering/enforcing-modularity-rails-apps-packwerk
- https://shopify.engineering/migrating-our-largest-mobile-app-to-react-native
- https://shopify.engineering/react-native-future-mobile-shopify
- https://shopify.engineering/react-native-new-architecture
- https://squareup.com/help/us/en/article/5822-employee-permissions
- https://squareup.com/us/en/staff/advanced-access
- https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale
- https://squareup.com/help/us/en/article/6170-delegated-employee-management
- https://squareup.com/help/us/en/article/8356-add-and-manage-team-members

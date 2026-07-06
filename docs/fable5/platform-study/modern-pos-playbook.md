# The Modern POS Playbook — How Square/Toast/Shopify Do It, In Plain Language

> Distilled 2026-07-06 from `square-engineering-behind-the-scenes.md` and
> `square-deep-dive-part2.md`. This is the synthesis: everything grouped into 8 categories,
> each with the core idea, the concrete patterns, and a one-line "rule of thumb".
> No SanoPOS comparisons here — pure reference.

---

## The one-paragraph summary

Square, Toast, and Shopify disagree completely about *deployment* (microservices vs edge-heavy
cloud vs one big monolith) but agree almost completely about the *data model and discipline*:
one canonical object per business concept, every write idempotent, every shared object versioned,
every money-affecting value snapshotted at transaction time, every lifecycle an explicit state
machine, and features gated by data (entitlements/modes/settings) instead of code branches.
The topology is a team-size decision. The discipline is the "modern way."

---

## Category 1 — How the code is organized

**Core idea:** the folder structure IS the org chart, and boundaries are *enforced*, not hoped for.

| Company | Shape | Boundary enforcement |
|---|---|---|
| Square | several giant monorepos (backend, Go, Android, iOS), 100s of microservices | service = domain, own DB, mesh RPC, protobuf contracts |
| Shopify | ONE Rails monolith, ~37 domain "components" | Packwerk fails CI if a component touches another's privates |
| Toast | cloud SaaS + very smart edge devices | vertical monogamy — restaurant-only, no cross-domain problem |

Patterns:
- Code is grouped by **business domain** (orders/, catalog/, labor/), never by layer (controllers/, models/).
- Each domain has a **declared public interface**; everything else inside it is private.
- **A tool enforces the boundary in CI** — humans don't get to "just reach in this once."
- Directory ownership = team ownership (OWNERS files gate review).
- Shopify's stated math: modular monolith = ~90% of microservices' organizational benefit at ~10% of the operational cost. Microservices are a headcount solution, not a quality solution.

**Rule of thumb:** split by domain, enforce with tooling, and stay a monolith until team size forces otherwise.

---

## Category 2 — The data model (the real crown jewels)

**Core idea:** one canonical object per business concept; every vertical and surface reuses it.

The canonical objects (Square's, but all three converge):
- **CatalogObject** — one polymorphic envelope (`type` = ITEM, VARIATION, MODIFIER_LIST, CATEGORY,
  DISCOUNT, TAX, IMAGE, PRICING_RULE). Item = abstract product; Variation = sellable SKU;
  Options auto-generate the variation matrix; Modifiers are shared by café and retail alike.
- **Order** — the single container for EVERY sale type (POS sale, online order, invoice, restaurant
  tab). No parallel "restaurant check" table. Fulfillments (pickup/shipment/delivery) live inside it.
- **Timecard** vs **ScheduledShift** — actual vs planned, always two separate objects, reconciled by reports.
- **Customer, Location, TeamMember** — one each, shared everywhere.

The five iron rules attached to these objects:
1. **Idempotency key on every write** — retries can never double-create an order/payment/adjustment.
2. **Optimistic version on every shared mutable object** — stale writes are rejected, not merged silently.
3. **Snapshot at transaction time** — price, tax, wage are frozen onto the line item/timecard;
   changing config later never rewrites history.
4. **State machines for anything with a lifecycle** — explicit states + allowed transitions,
   enforced server-side (order OPEN→COMPLETED, fulfillment states, shift states).
5. **Server-authoritative math** — clients show provisional totals; the server's pricing engine is
   the only truth. One engine, every surface.

**Rule of thumb:** new vertical = new fields and presets on existing objects, never new parallel tables.

---

## Category 3 — Verticals & feature gating (four systems, not one)

**Core idea:** "does this merchant see feature X?" is a conjunction of four independent gates,
each owned by a different lifecycle:

| Gate | Question | Owned by | Lifecycle |
|---|---|---|---|
| **Entitlement** | did they pay for it? | billing/plan | permanent, changes on billing events |
| **Mode/preset** | does their business type surface it? | onboarding choice | seller-switchable anytime |
| **Setting** | did the merchant turn it on? | merchant admin | ad hoc |
| **Rollout flag** | have we shipped it to them yet? | engineering | temporary — deleted after launch |

How Square does verticals concretely:
- ONE app, seller picks a **mode** (standard / bar / QSR / FSR / retail / health & beauty /
  professional services) at onboarding — switchable later in settings.
- A mode = feature preset + default POS layout + vertical fields on shared objects
  (`product_type=FOOD_AND_BEV` unlocks calories/ingredients on the same CatalogItem) + vocabulary.
- Entitlements: 3 plans (Free / Plus / Premium, per location), resolved into a **capability
  profile** — feature code asks `can(feature)`, never `plan == "premium"`. That indirection is why
  they could collapse 18 subscriptions into 3 plans without touching feature code.
- Entitlements support **quotas** (500 texts/mo then 3¢), not just booleans.
- Gated-but-visible UI: locked features show greyed with "upgrade to unlock" — the permission
  failure IS the upsell surface.

**Rule of thumb:** entitlements are data rows resolved in one place; flags are temporary and deleted; never mix the four systems.

---

## Category 4 — Offline

**Core idea:** don't make offline risk-free — make it bounded, visible, and small.

Square's model (per-device):
- Offline is a **session with a countdown clock**, not a silent mode. 24h to sync, 72h hard cap.
- Merchant opts in and sets a **max amount per offline transaction** — exposure is configurable.
- If a queued card payment later declines, **the merchant eats it** — risk is transferred openly.
- Offline feature-set is tiny by design: take payment, print receipt. No refunds, no reports, no
  catalog edits.
- Queued sales carry client UUIDs + idempotency keys → replay is trivially safe.
- UI shows offline payments as **"pending"** — honest sync state, never fake finality.

Toast's model (per-venue — the restaurant twist):
- Devices form a **local network mesh**; when the cloud dies, the venue keeps working as a unit
  (floor → kitchen → printer all LAN-local). One device acts as local source of truth.
- Needed because restaurants require device-to-device coordination offline; retail mostly doesn't.

Shopify's model (per-device local DB):
- POS keeps a **local database routinely delta-synced** (cursor-based); their sync rewrite took a
  medium store's initial sync from 30s to 2–3s.

Catalog sync everywhere: **versioned objects + "give me everything since version N"** pull.

**Rule of thumb:** version the catalog, UUID the writes, bound the window, shrink the offline surface to the money path.

---

## Category 5 — Permissions & staff identity

**Core idea:** permission sets as data; device auth ≠ person attribution.

- **Permission sets**, not enum roles: shipped templates (Standard/Enhanced/Full) that owners clone
  and customize per-grant. Custom sets are themselves a paid entitlement.
- Each set declares its **surfaces**: POS, Dashboard, Team app, Dashboard mobile — independently gated.
- Per-domain grants split **read / write / settings-write** (mirrored in API scopes:
  `TIMECARDS_READ`, `TIMECARDS_WRITE`, `TIMECARDS_SETTINGS_WRITE`).
- **Two register auth tiers**: personal passcode (full attribution of every sale/clock-in/refund)
  vs shared team passcode (convenience, explicitly no attribution — trade-off shown to the owner).
- **Inline elevation**: refunds/voids/discounts prompt for a manager-permission passcode
  mid-transaction; the cashier never logs out.
- **Delegated admin** is an explicit permission — permission to grant permissions.

**Rule of thumb:** the device is logged in all day; people are attributed per action by passcode.

---

## Category 6 — Time & labor (clock in/out)

**Core idea:** planned vs actual are separate objects; wages snapshot; edits go through approval.

- **ScheduledShift** (the plan) and **Timecard** (created at clock-in) are distinct records —
  reconciliation between them powers "prevent early clock-in", "unscheduled shift alert", and
  labor-cost-vs-sales reporting.
- A Timecard records start/end, **breaks against configurable BreakType policy objects**
  (paid/unpaid, duration rules), declared cash tips, and a **wage snapshot** frozen at shift time.
- Clock-in surfaces: register passcode, or the employee's own phone via Team app with **geofencing**.
- Staff can't edit their own timecards directly — they file an **edit request** a manager approves.

**Rule of thumb:** never store "hours worked" as one editable number — store the immutable event trail plus an approval workflow on top.

---

## Category 7 — The POS client itself

**Core idea:** the register app is a composition of state machines over a local replica.

- Square: **Workflow** (open source) — every screen/flow is a composable state machine, immutable
  state, unidirectional data flow; navigation is "which child workflow renders". Features are unit-
  testable as pure state transitions, and hundreds of engineers ship in one app without collisions.
- Shopify: React Native on a local DB, migrated via **"iterative porting"** (new features in the
  new stack while old ones move over) — never a big-bang rewrite.
- Both: the client renders from local state and syncs in the background; totals shown are
  provisional until the server confirms.
- Square's pattern when platform tooling falls short: **extract a library with a hard boundary and
  open-source it** (OkHttp, Retrofit, Dagger, Workflow all came out of the POS app).

**Rule of thumb:** state machines + local replica + background sync; rewrite by strangling, never big-bang.

---

## Category 8 — Shipping it (CI, deploys, events)

**Core idea:** merge-gated main, incremental CI, async side effects.

- CI must be **incremental** (build/test only affected targets) and **sharded** (Square's Kochiku
  splits giant suites across hundreds of workers); nothing lands without green.
- Deploys are per-service/continuous, made safe by **backward-compatible contracts**
  (protobuf rules: never reuse field numbers, only add optional fields).
- **Webhooks/domain events** handle cross-domain side effects (order created → loyalty, email,
  inventory, kitchen) instead of inline calls in the sale path — the checkout path stays short.
- Reports/analytics run off **read-optimized projections** fed by the event stream, not the
  transactional tables; reports are eventually consistent on purpose.

**Rule of thumb:** the sale path does the minimum synchronously; everything else reacts to events.

---

## The cheat sheet (all 8 on one screen)

1. **Code**: split by domain, enforce boundaries with tooling, stay a monolith as long as possible.
2. **Data**: one canonical object per concept; idempotency + versioning + snapshots + state machines + server math.
3. **Gating**: entitlement ∧ mode ∧ setting ∧ flag — four systems, four lifecycles.
4. **Offline**: bounded, visible, tiny surface; versioned catalog + UUID'd write queue.
5. **Permissions**: sets as data, per-surface, read/write/settings split; device auth ≠ person attribution.
6. **Labor**: planned vs actual objects, wage snapshots, approval-gated edits, geofenced clock-in.
7. **POS client**: state machines over a local replica; strangle, don't rewrite.
8. **Shipping**: gated main, incremental CI, events for side effects, projections for reports.

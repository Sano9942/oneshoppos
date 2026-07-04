# Vertical Depth — Does Each Industry Actually Work For Its Industry?

> A **per-industry depth audit**, parallel to but distinct from [`../completion/`](../completion/README.md). The completion effort audits **wiring correctness** ("does what exists connect end-to-end") + Square parity. **This** effort audits **industry depth**: for each vertical, what SanoPOS actually has today (from code) vs. what a real business in that industry genuinely needs to operate — and the gap, ranked by impact. **Findings only** — no implementation plans, no fixes, until the register is approved.

## The two axes (kept cleanly separate in every finding)

1. **What's built** — derived **only from code** (routes, services, pages, schema, flags, preset config). Every claim cites a code location. Never trust CLAUDE.md/memory for a "built" claim.
2. **What the industry needs** — derived from domain knowledge of how the industry operates + targeted research on the category-leading software per vertical. Every claim cites domain reasoning or a competitor/source.

## Impact tiers

- **P0 table-stakes** — a real business in this vertical cannot credibly run on SanoPOS / would reject it in a demo without this.
- **P1 competitive** — category-leading vertical software has it; absence loses deals but the tool still functions.
- **P2 differentiator/polish** — delight, edge cases, nice-to-have.

## Readiness verdict scale

`Not-viable` → `Minimum-viable` → `Competitive` → `Category-leading`.

> **Plans:** implementation plans generated 2026-07-04 from these findings live in [`plans/`](plans/) (7 foundations F01–F07 + 10 verticals V01–V10); the plans register + full program sequencing is [ROADMAP.md](ROADMAP.md). Awaiting approval.

## Register

> Audit run 2026-07-04 (code-mapped from routes/services/schema/preset-config + competitor research). Status: `findings` → `approved` → (later) `planned`. P0/P1 counts are gap rows in each file's table; scoped counts (e.g. "car only") noted in the file.

| Industry group | Presets | Owned completion plan | P0 | P1 | Readiness | Status |
|---|---|---|---|---|---|---|
| [General retail](findings/01-general-retail.md) | general_retail | 00 (+11 growth) | 0 | 1 | **Competitive** | findings |
| [Retail sub-types](findings/02-retail-subtypes.md) | grocery, butcher, sweet_shop, textile | 00 | 3 | 4 | grocery **Not-viable** (as supermarket); butcher/sweet/textile **Minimum-viable** | findings |
| [Wholesale](findings/03-wholesale.md) | wholesale | 04 | 1 | 2 | **Competitive** | findings |
| [Food service](findings/04-food-service.md) | cafe, restaurant | 02 | 2 | 1 | restaurant **Competitive**; cafe/QSR **Minimum-viable+** | findings |
| [Salon](findings/05-salon.md) | salon | 03 | 2 | 4 | **Minimum-viable** | findings |
| [Clinical](findings/06-clinical.md) | clinic, dental_clinic, veterinary, physiotherapy | 08 (+03 booking) | 3 | 4 | dental/physio **Competitive**; vet **Minimum-viable**; clinic **Not-viable** (as clinical) | findings |
| [Repair shop](findings/07-repair-shop.md) | repair_shop | 05 | 3 | 3 | **Not-viable** | findings |
| [Gym](findings/08-gym.md) | gym | 10 (+03 booking) | 2 | 4 | studio **Not-viable**; plain gym **Minimum-viable** | findings |
| [Photography](findings/09-photography.md) | photography_studio | 09 (+03 booking) | 0 | 3 | **Competitive** | findings |
| [Rentals](findings/10-rentals.md) | car_rental, equipment_hire, furniture_rental, party_supplies | 06 | 2 | 4 | equipment/furniture/party **Minimum-viable**; car_rental **Not-viable** | findings |
| [Lodging](findings/11-lodging.md) | hotel, guesthouse, hostel | 07 | 3 | 3 | guesthouse **Minimum-viable**; hotel/hostel **Not-viable** | findings |

**Why this cut (23 presets → 11 files):**
- Grouped where presets share one mode + one code stack and mostly one requirements set: the 4 rental presets (identical `rentals` mode, pure label skins), the 3 lodging presets (`room_management`), the 4 retail sub-types (mode-less skins over the core spine differing only in units/tare), and cafe+restaurant (identical 13-flag `restaurant` mode; counter vs. table service split by verdict, not by file).
- `clinic` is grouped **with** the clinical trio rather than with salon, because its defining finding is exclusion from the clinical stack it sits next to (`modes: ["appointments"]` — no charting/prescriptions).
- Split where one engine serves divergent industries: car_rental gets its own verdict inside the rentals file (vehicle-legal needs the shared engine can't model), hostel inside lodging (bed-level inventory).
- Salon, gym, photography stay separate despite all touching `appointments` — their P0s are entirely different (checkout link vs. classes/check-in vs. nothing).

**Cross-cutting observations (patterns spanning files):**
1. **Dead schema, unshipped features** — `class_sessions`, `class_session_bookings`, `appointment_waitlist_entries`, `booking_resources`, `booking_resource_assignments`, `appointment_segments`, `calendar_sync_accounts` all exist in `schema-pg.sql` with **zero** route/service references. Someone designed the right things and never built them.
2. **One missing kit/BOM engine, four verticals hurt** — restaurant recipes/combos, retail bundles, sweet-shop boxes, butcher disassembly all trace to the same absent component→product entity.
3. **One missing package/pass entity, three verticals hurt** — gym class packs, salon packages, physio session bundles.
4. **One missing form-builder, three verticals hurt** — clinical intake, gym waivers, photography questionnaires (consent-template machinery is the 80% starting point).
5. **Deposit pre-auth exists twice, missing twice** — rooms and treatment plans have gateway pre-auth (`room-deposits.js`, `treatment-plan-deposits.js`); rentals and appointments (no-show protection) don't.
6. **The "demo-killer" P0s cluster in exactly the verticals the user suspected** — repair, car rental, hostel/hotel, gym-as-studio, and grocery-as-supermarket are name-promises the current depth can't keep.

## Cross-effort note

Wiring defects are owned by [`../completion/`](../completion/README.md) plans `00`–`11`. This audit **references** them and does **not** re-report them — it only covers industry-depth gaps (missing capability a real business in the vertical needs), not broken wiring of existing capability. Notably not re-reported here: the marketplace sync-worker stubs, the rental/room/treatment folio-tax pause item, the portal tickets-tab fix, and everything in plan 11's growth list.

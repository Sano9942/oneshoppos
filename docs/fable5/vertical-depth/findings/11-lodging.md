# Lodging (Hotel · Guesthouse · Hostel)

**Presets:** `hotel`, `guesthouse`, `hostel` — grouped on one `room_management` mode (`phase4_room_management` — `mode-registry.js:59`) with identical onboarding and portal tabs (`industry-config.js:479-574`). Hostel's verdict splits below — its inventory unit is the bed, which the engine doesn't model.
**Surfaces:** POS (charges → folio) · portal (My Stays, read-only) · admin
**Owned wiring plan:** [completion 07-room-management.md](../../completion/plans/07-room-management.md)

## What's built today (from code)

- Room types: capacity, base rate, deposit, amenities, tax-inclusive flag; seasonal/date rate overrides + stay quote — `room_types`/`room_rate_overrides` (`schema-pg.sql:4300-4348`), `/api/room-types` + `/rate-overrides` + `/quote` (`routes/rooms.js:32-103`) — works
- Rooms: number/floor, occupancy status, housekeeping status `clean/dirty/inspected/out_of_order` — `rooms` (`schema-pg.sql:4317-4331`), `PUT /api/rooms/:id/housekeeping` — works
- Bookings: reserve → confirm → check-in → check-out, cancel, **no-show**, availability search, timeline — `routes/rooms.js:174-253`, `room_bookings` (`schema-pg.sql:4350-4385`), `services/room-service.js` — works
- **Gateway deposit pre-auth**: authorize at booking, webhook, capture at checkout — `POST /api/room-bookings/:id/deposit/preauth` (`routes/rooms.js:263`), `services/room-deposits.js`, `deposit_status` state machine (`schema-pg.sql:4369`) — works
- **Guest folios**: room-night + POS + manual + discount + tax lines, POS sale attach (`sales.folio_id` — `schema-pg.sql:4422`), settle → invoice — `guest_folios`/`folio_lines` (`schema-pg.sql:4387-4420`), `/api/room-bookings/:id/folio*` — works (folio tax linkage flagged by completion plan 01 — pause-listed, not re-reported here)
- Overdue-checkout worker + email — `workers/room-overdue-checkout-worker-boss.js` — works
- Portal "My Stays": read-only list of bookings + folio totals — `routes/customer-portal/stays.js` (header comment: "Read-only v1") — works

## What this industry needs (domain + research)

Benchmarks: Cloudbeds, Little Hotelier, Mews (small-property PMS); Hostelworld-connected systems for hostels.

- Reservations + folios + housekeeping status + rate controls + clean reporting — "must-have PMS features: reliable reservations and folios, real-time housekeeping status, solid rate controls" — source: [HotelMinder small-hotel PMS guide](https://www.hotelminder.com/best-small-hotels-pms), [TechMagic small-hotel PMS](https://www.techmagic.co/blog/small-hotel-pms) — **largely met**
- **Channel manager / OTA connectivity** — "selling rooms through OTAs requires a channel manager maintaining rate parity and availability across platforms (Booking.com, Expedia)"; Cloudbeds and Little Hotelier both *bundle* PMS + booking engine + channel manager as one product — source: [HotelMinder](https://www.hotelminder.com/best-small-hotels-pms), [Cloudbeds](https://www.cloudbeds.com/)
- **Direct booking engine** (guest books on the property's own page) — bundled in every leader — source: [Little Hotelier positioning](https://thehotelgm.com/tools/best-small-hotel-management-software/)
- Night audit / daily reconciliation — named among the daily workflows that matter — source: [HotelMinder](https://www.hotelminder.com/best-small-hotels-pms)
- Guest registration with ID at check-in — universal front-desk workflow; in Pakistan, hotels are legally required to record guest CNIC/passport details and report to authorities — domain reasoning + PK regulatory practice
- Hostel: **per-bed dorm inventory** ("dorms multiplied by beds per dorm", per-bed rates, mixed dorms, Hostelworld channel) — source: [Cloudbeds accommodation types](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360038464274-Create-and-manage-your-accommodation-types), [Hostel Mate comparison](https://hostelmate.co/hostel-property-management-system-comparison)
- Group/multi-room bookings, occupancy reporting — standard PMS — source: HotelMinder daily workflows (group block)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| OTA channel manager (Booking.com at minimum; Hostelworld for hostels) — even iCal sync | no | grep `ical` (word) / channel-manager backend → nothing beyond `utils/ics.js` (calendar-invite emails, not availability feeds); marketplace adapters are commerce-only (`services/marketplace/`) | **P0 (hotel, hostel)**, P1 (guesthouse) | most PK small properties live on Booking.com; without inventory sync the PMS creates double-booking risk rather than removing it |
| Direct online booking engine for rooms | no | `routes/public-bookings.js` reads `booking_services`/`appointments` only (verified table usage) — no public room-booking endpoint; portal stays are read-only (`customer-portal/stays.js:4`) | **P0** | every benchmark bundles it; currently 100% of bookings are staff-entered |
| Per-bed dorm inventory (hostel): beds within dorms, per-bed rates, dorm occupancy | no | booking references a single `room_id` (`schema-pg.sql:4356`); no bed entity — the `hostel` preset just relabels rooms as "Beds" (`industry-config.js:549`), so one dorm = N fake "rooms" with no dorm-level view | **P0 (hostel)** | the Cloudbeds "shared accommodation" model is the reference shape |
| Guest registration / ID capture at check-in (CNIC/passport, legally required in PK) | no | check-in endpoint flips status only (`routes/rooms.js:229`, `services/room-service.js:checkInBooking`); no per-stay guest-registration record; `customers.cnic` exists but is an FBR field, not a stay record with document capture | P1 | compliance + police-reporting reality for PK properties |
| Group / multi-room bookings | no | one room per booking row (`schema-pg.sql:4356`); no booking-group entity | P1 | families and events are routine even at guesthouses |
| Night audit + occupancy/ADR reporting | no | grep `occupancy` in `routes/reports/` → 0 files; no audit/rollover job | P1 | owners currently reconstruct occupancy from booking lists |
| Housekeeping task management (assignments, checklists) | partial | status enum + update endpoint only (`routes/rooms.js:164`); no task/assignment entity | P2 | status flip covers small properties |
| Extra-person / meal-plan / package rates | partial | `folio_lines.manual_charge` can carry them by hand (`schema-pg.sql:4409`); no rate-plan modeling | P2 | |
| Rates+overrides, booking lifecycle, no-show, pre-auth deposits, folios+POS attach, overdue worker, portal stays | yes | files above | — | the on-property core is genuinely good — better than the rentals engine |

## Readiness verdict

**Guesthouse: Minimum-viable** — a walk-in-driven property can run front desk + folio + POS today. **Hotel: Not-viable for any OTA-dependent property** (i.e., most of them) — no channel manager and no direct booking engine means the PMS manages a calendar it doesn't control. **Hostel: Not-viable** — additionally lacks the bed-level inventory that defines the segment.

# V10 — Lodging Depth (Channel Sync · Direct Booking · Beds · Night Audit)

**Covers:** findings [11-lodging](../findings/11-lodging.md) — the PMS that "manages a calendar it doesn't control": OTA channel connectivity, direct booking engine, hostel bed-level inventory, guest registration, group bookings, occupancy reporting.
**Presets/modes:** `hotel`, `guesthouse`, `hostel` — mode `room_management`; new flags `room_channel_sync`, `room_online_booking` (defaults per preset at approval).
**Surfaces:** admin (front desk) · public (booking engine) · portal (My Stays) · external (OTA iCal/API) · POS (folio)
**Closes findings rows:** [11] "OTA channel manager — even iCal sync" (**P0 hotel/hostel**, P1 guesthouse) · "Direct online booking engine" (**P0**) · "Per-bed dorm inventory (hostel)" (**P0 hostel**) · "Guest registration / ID capture at check-in" (P1, PK legal) · "Group / multi-room bookings" (P1) · "Night audit + occupancy/ADR reporting" (P1) · "Housekeeping task management" (P2) · "Extra-person / meal-plan / package rates" (P2).
**Depends on:** F05 (guest comms), completion plan 07 executed. Room folio TAX linkage is completion-01's open pause item — same coordination rule as V09.
**Branch:** booking-engine + front-desk UI ride `redesign/square`; backend/schema off `main`.
**Model:** **Fable, effort high.** Two-way availability sync without double-booking + a bed-level inventory remodel + the existing booking race are exactly the concurrency/cross-system class that goes to the strongest model.

---

## Tasks

### P0 — stop the double-booking exposure, then connect the calendar
1. **Fix the booking race first** (hardening promoted to task #1 because everything below multiplies write paths): `services/room-service.js:createBooking` (:474-496) checks availability inside a transaction but locks nothing — two concurrent creates both read "available" and both insert. Fix: `pg_advisory_xact_lock(hashtext('room-' || room_id))` per candidate room (or room_type for type-level bookings) before the availability check, single choke-point service fn for ALL booking writers (front desk, booking engine, iCal import, group bookings). Failure today: two front-desk tabs book the last room for the same dates → both succeed.
2. **Direct booking engine** — public pages: `GET /api/public/rooms/:tenant/availability?from&to` (room types, rates from `resolveRateForDate`, photos) + `POST …/book` → `reserved` booking through the choke point + F04-style deposit intent (rooms already have the deposit stack — reuse `room-deposits.js` on the public path) + confirmation email/SMS (F05). Frontend: booking page like the appointments public page (`public-bookings.js` mount/limiter pattern). Findings: today 100% of bookings are staff-entered.
3. **iCal channel sync (v1 channel manager)** — the pragmatic PK answer before a certified Booking.com API partnership:
   - **Export:** per room/room-type signed iCal feed URL (bookings as VEVENTs) — OTAs and Google Calendar consume these; reuse `utils/ics.js` generation, extend for feed (multiple events + REFRESH semantics).
   - **Import:** per-room OTA iCal URL polled by `workers/channel-sync-worker-boss.js` (10-min cadence): external events → `channel_blocks` (below) that the availability engine treats as occupancy. Import conflicts (external event overlapping a local booking) → dead-letter + urgent notification, never silent.
   - Schema (pause-list): `room_channel_feeds` (room_id/room_type_id, direction, url/secret, last_synced_at, status) + `channel_blocks` (room_id, source_feed_id, external_uid, start_date, end_date, summary).
   - Full Booking.com/Hostelworld API connectivity: explicitly OUT of v1 (partner-program gated); the hub entry states "iCal sync" honestly (plan-11 lesson: no decorative integrations).
4. **Hostel beds** — model beds as bookable sub-units WITHOUT forking the engine: `rooms.parent_room_id` (nullable, pause-list) — a dorm is a room; beds are child rooms sharing the dorm's type/rate; dorm-level view aggregates children (occupancy “7/10 beds”); housekeeping stays dorm-level (children inherit). Booking targets a bed (child room id) — every existing lifecycle/folio path works unmodified. Hostel preset labels already say "Beds" (industry-config.js:549); this makes the label true. Availability + choke-point lock operate on the child id; dorm map UI on the front desk.

### P1
5. **Guest registration at check-in** — schema (pause-list): `booking_guests` (booking_id, name, cnic_passport, nationality, phone, document_photos JSONB, is_primary). Check-in flow requires primary-guest document capture (photo → R2, staff-only access); registry report (date-range list for the police-reporting reality, findings: PK legal requirement); reuses field.js photo pipeline.
6. **Group bookings** — `booking_groups` (id, name, customer_id, notes) + `room_bookings.group_id` (pause-list): create N rooms in one flow (each through the choke point), group folio option (route charges to a master folio — `guest_folios` already supports lines from multiple sources), group check-in list.
7. **Night audit + occupancy/ADR** — nightly worker snapshot (rooms available/occupied/ooo, arrivals/departures/no-shows, ADR, RevPAR, folio balances) → `night_audit_snapshots` (pause-list) + a Reports tab (occupancy % / ADR / RevPAR over range; grep `occupancy` in reports → 0 today). Manual "run audit now" for the front desk; flags unsettled folios of departed guests.

### P2
8. Housekeeping tasks — assignment rows on top of the status enum (assignee, due, notes) + a housekeeping list view.
9. Rate plans (extra-person, meal-plan) — structured `rate_plan` on room_types feeding `calculateStayTotal`; until then `folio_lines.manual_charge` remains the documented path.

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Booking lifecycle + folios + deposits | `services/room-service.js`, `room-deposits.js` | findings [11] built rows |
| Rates | `resolveRateForDate`, `calculateStayTotal` | services/CLAUDE.md |
| ICS generation | `utils/ics.js` | backend/CLAUDE.md |
| Worker + dead-letter | worker checklist + `/admin/dead-letters` | backend/CLAUDE.md |
| Public mount + limiter | `public-bookings.js` pattern | backend/CLAUDE.md |
| Photo/ID capture | field.js → R2 + upload-validation | routes/field.js:168-175 |
| Overdue-checkout worker (audit sibling) | `workers/room-overdue-checkout-worker-boss.js` | findings [11] |

## Harden what's built
- **P0 — the createBooking race** (task 1 — promoted). Evidence: room-service.js:474-496, availability check inside `db.transaction` but no row lock, no exclusion constraint on date overlap.
- **P0 — no-show and cancel must release channel state.** With iCal export, a cancelled local booking must drop from the feed promptly or the OTA keeps the room blocked. Feed generation reads live state (no caching beyond minutes) + `expireStaleReservations`-style discipline for `reserved` public bookings that never pay (TTL → auto-cancel, or front-desk queue) — otherwise the public engine becomes a denial-of-inventory vector (anyone reserves every room with no payment). Define the TTL rule in-plan.
- **P1 — check-in/out date boundaries.** `check_in_date`/`check_out_date` are DATEs; overlap math must treat checkout day as exclusive (guest leaves 11am, room resellable same night). Verify `checkRoomAvailability`'s comparison operators at execution — off-by-one here manufactures phantom conflicts or true double-bookings on back-to-back stays. Add the back-to-back test (A checks out on the day B checks in → allowed).
- **P1 — folio settle vs pending charges**: `settleFolio` locks the folio (:838 FOR UPDATE) — good; but checkout with an unsettled folio + an authorized deposit must follow one documented order (capture → settle → status) so a crash mid-checkout can't strand a captured-but-unposted deposit. Idempotent re-run test.

## Cross-surface lens
- **Availability truth:** front desk · public engine · iCal import · group flow — ONE choke-point fn (task 1); any new writer added later inherits the lock by construction.
- **Tax:** folio/room tax linkage = completion-01 open pause item; night-audit revenue numbers must use whatever that resolution produces — coordinate migrations.
- **Notifications:** booking confirm / check-in / checkout receipt / audit alerts via F05.
- **Portal:** My Stays remains read-only v1 EXCEPT it can deep-link the public engine for a new booking (no new portal write path).
- **PII:** guest documents staff-only; registry report permission-gated (`requirePerm`), never in portal payloads.

## Verification bar
- Test tenants: fresh `hotel` + fresh `hostel`.
- Walkthrough: public engine: search dates → book with deposit → front desk sees `reserved` → confirm → check-in w/ CNIC capture → POS charge to folio → checkout captures deposit + settles → invoice; iCal: export feed shows the stay; import feed with an external event blocks those dates in availability + front desk calendar; conflicting import → dead-letter + notification; hostel: 10-bed dorm → book 7 beds (mixed public/front-desk) → dorm map shows 7/10 → 8th concurrent pair of bookings for the last bed → one winner; group: 5-room wedding block → master folio; night audit: run → occupancy/ADR report matches hand math; back-to-back stays on one room allowed.
- Abuse: unpaid public reservations expire per TTL; feed URLs unguessable.
- Empty states: audit with zero bookings; dorm map empty; channel page before any feed configured (honest "iCal sync" copy).

# F06 — Scheduling Engine Activation (Classes · Waitlist · Resources · Segments · Appointment↔Sale Link)

**Covers:** cross-cutting observation #1 in [../README.md](../README.md) — the dead scheduling schema. `class_sessions`, `class_session_bookings`, `appointment_waitlist_entries`, `booking_resources`, `booking_resource_assignments`, `appointment_segments`, `calendar_sync_accounts` all exist in `schema-pg.sql:3598-3738` with **zero route/service references** (grep re-confirmed 2026-07-04: only schema-pg.sql, migrate-pg.js, and the orphan flag `phase4_google_calendar_sync` at feature-flags.js:77). Plus the one shared column the appointments engine is missing: the appointment↔sale checkout link.
**Modes/flags:** `phase4_appointments` (existing) + new sub-flags `appointments_classes`, `appointments_waitlist`, `appointments_resources` (default OFF; verticals seed). `phase4_google_calendar_sync` finally gets a feature or gets deleted (P2 decision below).
**Surfaces:** admin calendar · public booking page · portal · POS (checkout link) · kiosk (member check-in consumes class data in V07)
**Closes findings rows:**
- [08-gym](../findings/08-gym.md) → "Group class scheduling + capacity + member booking" (**P0**), "Waitlists for full classes" (P1)
- [05-salon](../findings/05-salon.md) → "Appointment → POS checkout link" (**P0**), "Waitlist" (P1), "Google Calendar sync for staff" (P2), "Recurring appointments / rebooking prompt" (P2 — recurrence generator shared with classes)
- [06-clinical](../findings/06-clinical.md) → resources (rooms/chairs) support the booking half; consumed by V05
- [09-photography](../findings/09-photography.md) → booking surface consumer (no row of its own)
**Depends on:** completion plan 03 executed first (it verifies the live appointments engine this builds on and triages the overlap-race confirm item).
**Consumed by:** V04, V05, V07, V08, F02 (redemption points).
**Branch:** backend + schema off `main`; calendar/timetable UI rides `redesign/square` (net-new screens, heavy UI).
**Model:** **Fable, effort high.** Capacity/overlap correctness under concurrent public traffic + a checkout-link column that four verticals' revenue attribution will sit on. The dead tables give the shape but the concurrency contract is being written from scratch.

---

## Design notes (the schema already exists — read it, don't redesign it)

The seven tables (schema-pg.sql:3598-3738) are usable nearly as-is. Deltas needed:

```sql
-- appointment↔sale link (the salon P0; findings: appointments has no sale column, sales has no appointment_id)
ALTER TABLE sales ADD COLUMN appointment_id INTEGER REFERENCES appointments(id);
ALTER TABLE appointments ADD COLUMN sale_id INTEGER REFERENCES sales(id);   -- backlink set at checkout
CREATE INDEX idx_sales_appointment ON sales(appointment_id) WHERE appointment_id IS NOT NULL;

-- classes: recurrence + booking uniqueness + price
ALTER TABLE class_sessions ADD COLUMN recurrence_rule TEXT,          -- 'weekly:1,3,5' simple encoding, not RRULE
  ADD COLUMN price NUMERIC(12,2), ADD COLUMN notes TEXT;
ALTER TABLE class_session_bookings ADD COLUMN booked_via TEXT DEFAULT 'admin'
  CHECK (booked_via IN ('admin','portal','public','kiosk')),
  ADD COLUMN customer_package_id INTEGER REFERENCES customer_packages(id),  -- F02 redemption (nullable pre-F02)
  ADD CONSTRAINT uq_class_booking UNIQUE (class_session_id, customer_id);

-- waitlist offer flow
ALTER TABLE appointment_waitlist_entries ADD COLUMN class_session_id INTEGER REFERENCES class_sessions(id),
  ADD COLUMN offered_at TIMESTAMPTZ, ADD COLUMN offer_expires_at TIMESTAMPTZ;
```

**Concurrency contract (the load-bearing part):**
- Class booking: `SELECT … FROM class_sessions WHERE id=$1 FOR UPDATE` → `COUNT(*)` confirmed bookings → insert if `< max_capacity`. One transaction. The UNIQUE constraint kills double-booking by the same member.
- Appointment overlap: `booking-services.js:createAppointment` currently does check-then-insert with **no lock and no transaction** (booking-services.js:39-43 → `checkOverlap` → insert). Fix here: wrap in `db.transaction` + `pg_advisory_xact_lock(hashtext('appt-emp-' || employee_id))` before the overlap check (transaction-scoped advisory lock is safe under the Supavisor transaction pooler *because* it's xact-scoped — cross-statement session locks are the thing the pooler forbids, per backend/CLAUDE.md). Completion 03 lists this race as confirm-during-execution; the FIX lands here either way.

## Tasks

### P0 — classes + checkout link
1. Schema deltas + flags. PAUSE for approval.
2. `routes/classes.js` — session CRUD (+ recurrence generator materializing N weeks ahead — worker or on-save loop), cancel-session (notifies booked members via F05), roster view; booking endpoints: admin book/cancel, portal self-book (`customer-portal/` module, own limiter), public book (mount pattern of `public-bookings.js`). All bookings through one `services/class-bookings.js:bookIntoSession` implementing the locking contract above — three entry paths, ONE service fn ([[feedback_parallel_paths]]).
3. **Appointment→POS checkout** — POS entry point "today's appointments" (`pos/` — list view of confirmed/in-progress appointments for the outlet) → tap → cart prefilled: service price line (booking_services.price), provider as commission-attributed employee, customer attached → normal checkout; on sale commit: set `sales.appointment_id`, `appointments.sale_id`, status → `completed`. Commission attribution rides the existing per-line employee mechanism the commissions engine reads (verify exact column at execution — completion 03's walkthrough documents it).
4. Timetable UI (admin): week grid of class sessions w/ fill counts; roster drawer with book/cancel/no-show.
5. Preset vocabulary: gym "Classes"/"Timetable", labels via `PresetContext` — config only.

### P1 — waitlist + resources
6. **Waitlist** — `services/waitlist.js`: join (from full class or unavailable slot, all three surfaces), offer flow: cancellation frees a spot → oldest `waiting` entry → `offered` + `offer_expires_at = now()+X` + F05 notification with public claim link → claim books it (same locked path) → expiry sweep (worker or lazy check) re-offers to next. Admin list + manual offer.
7. **Resources** — wire `booking_resources` + assignments into `booking-availability.js`: a service requiring a resource is bookable only when BOTH staff and a resource instance are free; `appointments.resource_id` already exists (schema:3647). Availability query extension + admin CRUD screen. (Salon chairs, physio beds, photography studio bays.)
8. **Segments** — `appointment_segments` for multi-service visits (color+cut): one appointment, N segments each with service+staff+time; availability checks all segments. UI: "add service" in the booking modal. Scope tightly — no cross-staff optimization, just sequential segments.

### P2
9. Recurring appointments (recurrence on `appointments` via the same generator) + "rebook same slot next month" prompt at checkout (uses the appointment↔sale link).
10. **Calendar sync decision** — `calendar_sync_accounts` + `phase4_google_calendar_sync`: building real Google OAuth sync is a project of its own. Recommend: ship one-way ICS feed per employee (signed URL, reuse `utils/ics.js`) and DELETE the dead flag; full OAuth sync only on customer demand. Decide at approval.

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| The tables themselves | schema-pg.sql:3598-3738 (7 dead tables) | grep confirms zero refs |
| Availability engine | `services/booking-availability.js` (rules/blocks/overlap) | findings 05 "works" row |
| Appointment lifecycle + reminders | `services/booking-services.js`, `booking-reminders.js` | findings 05 |
| Public booking mount + limiter | `routes/public-bookings.js` + `publicBookingLimiter` | backend/CLAUDE.md |
| Long-poll refresh for calendar | `services/phase4-polling.js:getChangesSince` | services/CLAUDE.md |
| ICS generation | `utils/ics.js` | backend/CLAUDE.md utils |
| Commission attribution at checkout | commissions engine via completion plan 03's map | completion/plans/03 |

## Harden what's built

- **P0 — appointment double-book race** — `booking-services.js:createAppointment:39-43` and `rescheduleAppointment:148-150`: `checkOverlap` runs outside any transaction/lock. Failure: two customers submit the same public slot within the same second → both pass overlap → two confirmed appointments, one stylist. Fix = the advisory-lock contract above, applied to create AND reschedule. (Completion 03 confirm-item; fix owned here.)
- **P1 — 15-min slot granularity is hardcoded** (`booking-availability.js`, services/CLAUDE.md). Failure: 20-minute physio follow-ups and 45-min classes misalign — a 20-min service books a 30-min hole. Surface granularity as a service-level setting only if trivial; otherwise document the constraint in the booking UI (don't silently misrender).
- **P1 — cancellation doesn't ripple.** Today cancelling an appointment frees the slot implicitly (overlap query excludes cancelled). With waitlists, EVERY cancel path (admin calendar, portal, public with token, no-show marking) must trigger the offer flow — grep all four cancel call sites and route through one service fn.
- **P2 — `appointments.source` CHECK lacks 'kiosk'** (schema:3656) — V07's check-in kiosk booking will violate it; extend the CHECK in this plan's migration while the table is being touched.

## Cross-surface lens
- **Slots/capacity:** admin calendar · portal · public page · (V07) kiosk — all four read/write through the same two service fns; no route-local availability math.
- **Pricing/tax:** class price and appointment service price enter sales only via POS checkout (tax via `tax-snapshot.js`); portal/public class bookings are reservations, never money writes (payment happens at POS or via F02 packages / F04 deposits).
- **Commissions:** checkout link makes attribution automatic — verify one earning per sale line, no double-write with tip pooling (`commission_earnings` is shared — completion 03's lens).
- **Notifications:** class cancel / waitlist offer / booking confirm all via F05 rules.

## Verification bar
- Test tenant: fresh `gym` (classes) + fresh `salon` (checkout link + segments).
- Walkthrough: create weekly class ×3 occurrences → book to capacity from admin + portal + public (three paths) → capacity rejection with clear message → join waitlist → cancel a booking → offer fires (notification logged) → claim within window books it → expiry re-offers; salon: book color+cut segments → both staff blocked correctly → day-of: open in POS from appointments list → checkout with a retail add-on → sale carries `appointment_id`, commission earning attributed to the stylist, appointment `completed` with `sale_id` → reports tie revenue to the booking.
- Concurrency: scripted parallel bookings on last class spot and same appointment slot — exactly one winner each (local PG).
- Empty states: timetable with no classes; roster of empty class; waitlist page empty state.

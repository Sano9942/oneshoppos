# 03 — Appointments + Commissions modes

**Covers:** mode `appointments` (presets `salon`, `clinic`, `gym`†, `photography_studio`†, `dental_clinic`†, `veterinary`†, `physiotherapy`†) **merged with** mode `commissions` (preset `salon` only). † = these presets carry appointments as a secondary mode; their primary vertical is covered by plans 07/08/09 — this plan owns their *booking* surface only.
**Why merged:** `commissions` is a single flag (`phase2_commissions`) enabled by one preset (`salon`), and every commission flow (plan → earning → payout report) is walked with the same salon tenant as the appointments checklist — a separate plan would duplicate the tenant + walkthrough.
**Modes/flags in scope:** `phase4_appointments`, `phase2_commissions`
**Surfaces touched:** admin app · public booking page (`/book/:tenantSlug`) · customer portal (appointments tab) · POS (service checkout + commission attribution) · reports
**Branch strategy:** backend/wiring off `main`; any calendar-UI work stays off `redesign/square` unless already-tokenized pages are touched (state per-fix).

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Service catalog | `AppointmentServicesRedesign` | `/api/bookings/services*` | `bookings.js` → `services/booking-services.js` | duration/price/staff-assignable persisted | ☐ |
| Staff availability | scheduling screens | `/api/schedules`, availability endpoints | `services/booking-availability.js` | 15-min slot granularity; overlaps rejected | ☐ |
| Admin booking | `AppointmentsCalendarRedesign` | `POST /api/bookings` | `booking-services.js:createAppointment` | bypasses public time guards; reminder auto-scheduled (1h before) | ☐ |
| Public booking | `PublicBookingPage` (`/book/:tenantSlug`) | `public-bookings.js` (pre-tenant-middleware, `publicBookingLimiter`) | same service | 15-min minimum notice enforced; confirmation email enqueued (non-fatal); preset `public_booking_labels` render (Stylist vs Provider vs Trainer) | ☐ |
| Reschedule / cancel | calendar | booking endpoints | `rescheduleAppointment`/`cancelAppointment` | reminder re-scheduled/cancelled with it | ☐ |
| Reminders | (worker) | — | `services/booking-reminders.js` via boot/workers | email sent; **known documented bug: SMS channel silently skipped but marked `sent` — decide fix vs document** | ☐ |
| Portal: my appointments | `PortalAppointments` | `portalApi` → `customer-portal/appointments.js` | — | customer sees/cancels own bookings; tab gated `phase4_appointments` (mapping correct — `data.js:30`) | ☐ |
| Appointment → checkout | POS | `POST /api/sales` from booking | `sales.js` | booking marked completed/paid; service line taxed via v83 chain | ☐ |
| Deposits at booking | booking flow | deposit endpoints | gateway (`isEnabled()`) | deposit taken when gateway on; graceful otherwise | ☐ |
| Commission plan CRUD | `CommissionPlansRedesign` (`phase2_commissions`) | `/api/commissions/*` | `commissions.js` | plan rates persist; employee assignment works | ☐ |
| Earning on sale | POS sale w/ staff attribution | `POST /api/sales` → earning insert | `commissions.js` + sales path | `commission_earnings` row per attributed line; walk-in staff assignment | ☐ |
| Earnings review/payout | `/commissions` page + `ReportsCommissions` (`from`/`to` params) | `GET /api/commissions/earnings`, `PUT /api/commissions/earnings/:id/status` | `commissions.js:134-188` | status transitions; payroll (`tier4/hr.js`) picks up approved earnings incl. tip-type rows | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this planning run's tool results. (Booking-reminder SMS mis-marking is pre-documented intentional behavior guarded by a unit test — triage during execution, don't "fix" blind.)

## Feature-parity gaps (P1)
- **No-show fees / cancellation policy** — 🟡 §5: deposits exist for rooms/treatments; appointment no-show *fee* flow thin · reuse: gateway pre-auth pattern from `room-deposits.js`.
- **Class/group booking** — ❌ §5: no group-session capacity model · reuse: `bookings.js` + a `capacity` column on services; gym preset is the customer.
- **Prepaid packages** — 🟡 §5: only via subscriptions/treatment plans · reuse: a package = N-visit counter on customer, decremented at checkout.
- **Generic intake forms at booking** — 🟡 §5: clinical doc capture exists; generic form builder missing · reuse: treatment-plan document tables.
- **Google Calendar sync** — ❌ §5 · smallest version: ICS attachment on confirmation email (`utils/ics.js` already exists — check wiring first).
- Square Assistant AI auto-reply — ❌ §5, low priority; skip unless asked.

## Polish & consistency (P2)
- Public booking page label coverage: all 7 appointment-carrying presets define `public_booking_labels` — verify each renders (esp. veterinary "Book your pet").
- Calendar empty/loading states; timezone display on slots (`req.company.timezone`).
- Commission plan page has no earnings drill-down link to the report tab — navigation polish.

## Confirm during execution
- `utils/ics.js` (calendar invite generation) — is it actually attached to booking confirmation emails, or dead util?
- Booking overlap check under concurrent public bookings (race).
- Whether gym's "Class Bookings" portal label (`PORTAL_LABEL_OVERRIDES.gym`) renders against the standard appointments tab.
- Commission earning behavior on returns/voids (reversal row or orphaned earning?).

## Cross-surface lens (mandatory)
- **Bookings** → admin calendar + public page + portal tab all hit the same service — cancellation from each surface must free the slot everywhere.
- **Tax** → service-line sales through the appointment→checkout path use the same chain as POS (01 owns).
- **Commissions** → written by POS sales AND tip pools (`services/tips.js`) AND read by payroll — one earning, one payout.
- **Reminders** → email worker shared with core (email_queue) — failures visible in admin email queue.

## Verification bar (execution)
- Test tenant: fresh `salon` signup (walks both modes with one tenant).
- Walkthrough: create service+staff → public booking as customer → reminder enqueued → reschedule → checkout at POS w/ commission attribution → earning approved → payroll shows it → portal shows appointment history.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `salon` — [ ] labels (Service/Client/Appointment) [ ] dashboard (appointments_today) [ ] onboarding (01-D2) [ ] portal tabs (appointments/invoices/loyalty/profile, "My Bookings") [ ] booking CTA "Book an appointment"/Stylist
- `clinic` — [ ] labels (Patient/Visit) [ ] appointments_today widget [ ] portal "My Appointments"/"Book a visit" [ ] clinical field detection on `CustomersRedesign`
- `gym` (booking surface only) — [ ] Trainer/Member labels [ ] portal "Class Bookings"
- `photography_studio` (booking surface only) — [ ] Photographer labels [ ] portal "Photo Shoots"
- `dental_clinic`/`veterinary`/`physiotherapy` (booking surface only) — [ ] booking CTAs per preset [ ] provider vocab

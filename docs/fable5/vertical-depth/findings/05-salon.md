# Salon / Personal Services

**Presets:** `salon`  **Modes/flags:** modes `appointments` + `commissions` → `phase4_appointments`, `phase2_commissions` (`mode-registry.js:22-33`); salon signups get **no** retail seed flags (loyalty/gift cards exist but ship OFF — `seedRetailFlags` only runs for `general_retail`)
**Surfaces:** POS · public booking page · portal (appointments/invoices/loyalty/profile) · admin
**Owned wiring plan:** [completion 03-appointments-commissions.md](../../completion/plans/03-appointments-commissions.md)

## What's built today (from code)

- Service catalog: duration, padding, price, per-service staff assignment, variants table, deposit fields — `routes/bookings.js` (`/api/booking-services`), `booking_services` + `booking_staff_assignments` (`schema-pg.sql:3564-3596`) — works
- Availability engine: weekly rules per staff/outlet/service, blocks/breaks/closures, 15-min slot granularity, overlap check — `services/booking-availability.js` (reads `booking_availability_rules`, `appointment_blocks`, `appointments`) — works
- Appointment lifecycle: create/reschedule/cancel/no-show statuses, calendar feed — `routes/bookings.js`, `services/booking-services.js` — works
- Public booking page with per-preset labels ("Book an appointment", Stylist/Client) + **booking deposits via gateway payment intent** — `routes/public-bookings.js:128` (`/api/public/bookings/deposit-intent`, `require_deposit`/`deposit_amount` on service) — works
- Automated reminders: 1-hour-before email auto-scheduled — `services/booking-services.js` + `services/booking-reminders.js` — works (email only)
- Commissions: plans, assignment, earnings ledger, status transitions, calculate endpoint; tips flow into `commission_earnings` — `routes/commissions.js` (`/api/commission-plans`, `/api/commissions/earnings`), `services/tips.js:distributeTipPool` — works
- Retail product sales at POS alongside services — core spine — works
- Portal: client sees/books appointments — `routes/customer-portal/appointments.js` — works

## What this industry needs (domain + research)

- Calendar-first operation with online booking, deposits/no-show protection, reminders — Fresha's core; its Plus plan headline is no-show protection — source: [Fresha best-salon-software guide](https://www.fresha.com/for-business/salon/best-salon-software), [GlossGenius Fresha-vs-Vagaro](https://glossgenius.com/blog/fresha-vs-vagaro)
- **Appointment → checkout in one flow** — the daily loop of every salon front desk: finish the service, tap the appointment, take payment (services + retail add-ons), commission auto-attributes to the stylist — domain reasoning; this is the spine of Fresha/Vagaro/GlossGenius POS
- **Client service history + notes/formulas** — colorists must see "what formula did we use last time"; every category leader keeps per-client service records — source: [Fresha guide](https://www.fresha.com/for-business/salon/best-salon-software) (client profiles), domain reasoning
- Packages & memberships (5-facial pack, monthly unlimited) — "increasingly important for revenue stability"; Vagaro sells both natively — source: [GoodCall Vagaro-vs-Fresha](https://www.goodcall.com/appointment-scheduling-software/vagaro-vs-fresha)
- SMS reminders — in PK, SMS/WhatsApp is *the* reminder channel; email is secondary — domain reasoning
- Recurring/repeat bookings and rebooking prompts — retention mechanics standard in Fresha/Vagaro — source: [thesalonbusiness.com comparison](https://thesalonbusiness.com/vagaro-vs-fresha/)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Appointment → POS checkout link (one-tap checkout; sale carries appointment/provider) | no | `appointments` table has no sale/invoice column (`schema-pg.sql:3641-3661`); `routes/bookings.js` has zero `sale\|invoice\|checkout` references (grep → 0); `routes/sales.js` has no `appointment_id` (grep → 0) | **P0** | the daily loop is broken in the middle: front desk re-rings services as free-text/product lines, commission attribution depends on the cashier picking the right employee, and reports can't tie revenue to bookings |
| Client service history / formula notes | no | no per-appointment service record beyond the appointment row; `customers` CRM notes are generic free-text (`routes/customers.js`); nothing links "last visit's service + notes" into the next booking | **P0** | a colorist demo fails at "show me her last formula" |
| SMS reminders | partial | `appointment_reminders.channel` supports `'sms'` (`schema-pg.sql:3681`) but `services/booking-reminders.js` silently skips SMS and still marks `sent` (documented behavior; `services/sms.js` exists and is used by campaigns) | P1 | plumbing exists on both sides; the worker just never connects them |
| Packages / session packs / memberships | no | `subscription_plans` (`schema-pg.sql:2986`) is recurring-only and not enabled for salon preset (modes exclude `subscriptions`); no session-count package entity | P1 | shared gap with gym (PT packs) and physio (session bundles) |
| Waitlist | no | `appointment_waitlist_entries` table exists (`schema-pg.sql:3689`) but zero routes/services reference it (grep backend → schema+migrate only) | P1 | dead table — schema built, feature never shipped |
| No-show fee auto-charge (card on file) | no | deposits are prepaid intents only (`public-bookings.js:128`); no tokenized card-on-file for appointments (`payment-gateway.js:tokenize` exists, unused here) | P1 | deposits are the viable PK substitute; still a Fresha headline |
| Recurring appointments / rebooking prompt | no | no recurrence fields on `appointments`; no rebook endpoint | P2 | |
| Google Calendar sync for staff | no | `calendar_sync_accounts` table exists (`schema-pg.sql:3726`) with zero route/service references — dead table | P2 | |
| Online booking, deposits, availability, reminders (email), commissions, tips | yes | files above | — | genuinely solid engine underneath |

## Readiness verdict

**Minimum-viable.** The booking engine and commission machinery are real, but the vertical's daily loop dead-ends at payment: **no appointment→checkout link** means every service rings up disconnected from the calendar — that plus absent client service history is what a Fresha-aware salon owner notices in the first ten minutes.

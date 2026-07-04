# Gym / Fitness Studio

**Presets:** `gym`  **Modes/flags:** modes `subscriptions` + `appointments` → `subscription_billing`, `phase4_appointments` (`mode-registry.js:41,22`)
**Surfaces:** POS · public booking · portal (subscriptions/invoices/appointments) · admin
**Owned wiring plan:** [completion 10-subscriptions.md](../../completion/plans/10-subscriptions.md) (memberships) + [03-appointments-commissions.md](../../completion/plans/03-appointments-commissions.md) (booking surface)

## What's built today (from code)

- Membership plans: price, billing interval (monthly/quarterly/yearly), trial days — `routes/subscriptions.js` (`/api/subscription-plans`), `subscription_plans` (`schema-pg.sql:2986`) — works
- Member subscriptions: enroll, pause/resume (freeze), cancel, renewal history, per-customer view, stats — `routes/subscriptions.js:88-263` — works
- Renewal engine: pg-boss jobs with singleton dedupe; **auto-charge via saved gateway token** when `auto_charge` + `gateway_token` set, else generates an invoice — `services/subscriptions.js:processRenewal` (lines 133-155 charge via `paymentGateway.chargeSavedInstrument`), `subscription_runs.charge_status` — works (failed-charge → dunning cadence **confirm live**; `subscription_runs.error` is recorded but no retry/dunning worker found in `workers/`)
- PT/class-as-appointment: single-slot bookings with Trainer labels, public "Book a session" page — `routes/bookings.js`, `public_booking_labels` (`industry-config.js:211`) — works (1:1 sessions only)
- Portal: "My Memberships" + "Class Bookings" tabs — `PORTAL_ENABLED_TABS_BY_PRESET.gym`, `PORTAL_LABEL_OVERRIDES.gym` (`industry-config.js:760,785`) — works
- Retail (supplements/gear) at POS — core spine — works

## What this industry needs (domain + research)

- **Group class scheduling with capacity, member self-booking, waitlists, no-show handling** — the operating unit of every studio; Glofox/Mindbody core — source: [Glofox fitness class scheduling](https://www.glofox.com/blog/fitness-class-scheduling-software/), [G2 gym software evaluation](https://learn.g2.com/best-gym-management-software)
- **Member check-in / access validation** — front-desk scan answering "is this membership active?"; leaders integrate door access (Kisi) — source: [Glofox vs Mindbody](https://www.glofox.com/blog/abc-glofox-vs-mindbody-boutique-fitness/)
- Recurring billing with failed-payment reporting, card auto-update, dunning — "failed payment reporting and automated card updates" are named ABC Glofox capabilities — source: [Swipe Savvy gym software comparison](https://swipesavvy.com/resources/blog/savvy-life-gym-fitness-management/)
- Session packs (10-class pass, 5-PT-pack) with remaining-count tracking — standard studio revenue model — domain reasoning + [Glofox membership management](https://www.glofox.com/blog/best-gym-management-software/)
- Liability waivers signed at join — standard onboarding artifact — source: G2 evaluation criteria
- Branded member app / push — Glofox differentiator — source: [Glofox](https://www.glofox.com/blog/abc-glofox-vs-mindbody-boutique-fitness/)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Group class scheduling + capacity + member booking | no | `class_sessions` + `class_session_bookings` tables exist (`schema-pg.sql:3704-3724`) but **zero** routes/services reference them (grep `class_session` backend routes+services → 0) — dead schema; appointments are strictly 1:1 slots | **P0** | the vertical's core object was schema'd and never built; a studio cannot run a timetable |
| Member check-in / active-membership validation at the door | no | attendance stack is employees-only (`routes/attendance.js`, kiosk PIN = staff clock-in); no member check-in route or member-facing scan | **P0** | every gym's front desk minute-one workflow; a status-lookup endpoint + kiosk skin over existing machinery is the shape |
| Failed-payment dunning (retry cadence, member notification, auto-suspend) | partial | `processRenewal` records `charge_status`/`error` on `subscription_runs` but no retry/dunning worker exists in `workers/` (only tenant-level `subscription-grace-worker-boss.js`, which is SaaS billing, not member billing) | P1 | involuntary churn is the #1 studio revenue leak; **confirm live** what happens after a failed charge |
| Session packs (n-class/PT passes with balance) | no | `subscription_plans` is interval-recurring only (`schema-pg.sql:2992`); no pack/credit-balance entity | P1 | shared gap with salon packages and physio bundles — one "package" entity serves all three |
| Waitlists for full classes | no | `appointment_waitlist_entries` dead table (see [05-salon](05-salon.md)) | P1 | blocked on classes existing at all |
| Liability waivers | no | grep `waiver` repo `*.js/jsx` → only storefront/Terms false-positives; consent machinery exists but is treatment-plan-scoped (`consent_forms` FK → `treatment_plans`) | P1 | consent-template machinery is 80% reusable |
| Branded member app / push notifications | no | portal is responsive web (`pages/portal/`); no push | P2 | acceptable substitute short-term |
| Membership plans, freeze/resume, auto-charge renewals, portal self-view, PT 1:1 booking | yes | files above | — | billing spine is real |

## Readiness verdict

**Not-viable for a class-based studio, Minimum-viable for a plain-floor gym.** Recurring membership billing genuinely works, but the two P0s — no class timetable (dead tables) and no member check-in — are the first two things any Glofox/Mindbody-aware owner asks to see.

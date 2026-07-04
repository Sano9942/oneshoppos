# V07 — Gym Depth (Timetable · Member Check-In · Dunning)

**Covers:** findings [08-gym](../findings/08-gym.md) — class timetable (engine in F06, gym surface here), member check-in / active-membership validation (this plan's own P0), dunning (F02), packs (F02), waivers (F03).
**Presets/modes:** `gym` — modes `subscriptions`+`appointments`; new flag `member_checkin` (default OFF, gym seeds ON).
**Surfaces:** kiosk (member check-in — NEW member-facing surface) · admin · portal · public booking
**Closes findings rows:** [08] "Group class scheduling + capacity + member booking" (**P0** — F06 engine; gym timetable UX + portal/public booking verified here) · "Member check-in / active-membership validation" (**P0**) · "Failed-payment dunning" (P1 — F02 task 6; verified here) · "Session packs" (P1 — F02) · "Waitlists" (P1 — F06) · "Liability waivers" (P1 — F03) · "Branded member app / push" (P2 — portal remains the substitute; not built).
**Depends on:** F06 (hard), F02 (hard for dunning/packs), F03 (waivers), completion plan 10 executed.
**Branch:** check-in kiosk + timetable UI ride `redesign/square`; backend off `main`.
**Model:** **Opus, effort high.** Foundations carry the hard parts; check-in is a status-lookup endpoint + kiosk skin over existing machinery (findings' own shape suggestion).

---

## Tasks

### P0 — member check-in
1. **Schema (pause-list):**
```sql
CREATE TABLE member_checkins (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  class_session_id INTEGER REFERENCES class_sessions(id),   -- NULL = floor visit
  method TEXT NOT NULL DEFAULT 'kiosk' CHECK (method IN ('kiosk','staff','portal')),
  membership_status_at_checkin TEXT,                         -- snapshot: active/grace/expired
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE customers ADD COLUMN member_code TEXT;           -- scannable/typable id; barcode = member card
CREATE UNIQUE INDEX uq_customers_member_code ON customers(member_code) WHERE member_code IS NOT NULL;
```
2. **Status endpoint + check-in** — `POST /api/members/lookup` (member_code or phone) → membership status derived from `customer_subscriptions` (active/paused/expired + expiry date) + active packages (F02) + today's class bookings (F06); `POST /api/members/check-in` writes the row. Front-desk (staff) mode is authed; **kiosk mode** follows the kiosk lesson exactly: POST endpoints under a `?tenant=` public path, per [[cross_surface_traps_plan01]] traps 3+4 — attendance-prefix GETs are blanket-guarded and allowlist ≠ public; copy the `pin-outlets`/`pin-checkin` pattern from `routes/attendance.js`, rate-limited.
3. **Check-in kiosk UI** — member-facing screen (route alongside the existing staff kiosk, e.g. `/member-checkin?tenant=`): enter code / scan barcode → big green "Welcome, {name}" with plan + expiry, or red "Membership expired {date} — see front desk" (+ optional grace policy: allow N grace check-ins, tenant setting). Class mode: if booked into a class starting within X min, check-in also marks the class booking attended.
4. **Front-desk widget** — today's check-ins feed + live count on the gym dashboard (dashboard_widgets config).

### P1 — consume foundations, gym-skinned
5. **Timetable** — F06 classes with gym vocabulary; portal self-booking tab ("Class Bookings" label exists — industry-config.js:785); public timetable page (F06 public path) linked from storefront/booking page.
6. **Dunning live** — F02 task 6 verified on gym: failing sandbox card → retries → auto-pause → front-desk sees "payment failed" flag at check-in (status endpoint includes it — the check-in surface is where dunning becomes collectable: member is physically present).
7. **Packs** — F02: PT-pack sold at POS, redeemed on class/PT booking, balance at check-in screen.
8. **Waivers** — F03: waiver template auto-attached at membership enroll (`auto_attach='membership_enroll'`); unsigned-waiver flag at check-in (status endpoint surfaces it).
9. **Waitlist** — F06 offer flow on a full class, gym labels.

### P2
10. Attendance analytics report (visits/member/month, class fill rates — from `member_checkins` + F06 rosters).
11. Door-access hardware — explicitly OUT (Kisi-class integration only on customer demand); the check-in screen is the v1 gate.

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Kiosk public-endpoint pattern | `routes/attendance.js` `pin-status`/`pin-checkin`/`pin-outlets` (POST, ?tenant=) | [[cross_surface_traps_plan01]] trap 3 |
| Membership status | `routes/subscriptions.js` per-customer view | findings [08] built rows |
| Classes/waitlist/packs/waivers | F06 / F02 / F03 | plans |
| Kiosk UI shell | `KioskRedesign.jsx` (staff kiosk, tokenized on redesign/square) | git status (modified on branch) |
| Barcode scan input | POS omni-input scan handling pattern | findings [01] |
| Dashboard widget config | `dashboard_widgets` per preset | industry-config.js |

## Harden what's built
- **P0 — status truth at the door.** The check-in verdict must derive from the SAME logic the billing engine uses (grace windows, paused, dunning-pending) — findings [08] partial row: `processRenewal` records failures nobody acts on. Failure: member's card failed 3 weeks ago, subscription row still `active` (no dunning yet) → door says welcome forever. Dependency stated: dunning (F02) must land before or with this, else the status endpoint knowingly lies — if sequenced otherwise, surface `last charge failed` from `subscription_runs` directly in the status derivation (one extra join) so the desk sees it even pre-F02.
- **P1 — billing-date drift hits gyms hardest** — F02 task 7 (calendar-month fix); verify on this tenant with a mid-month and a month-end (31st) enrollment.
- **P1 — member_code collisions/enumeration.** Kiosk lookup is public: member codes must be non-sequential (random 6–8 digits), rate-limited, and the lookup response minimal (first name + status only — no phone/balance on the public path). Failure: sequential codes let anyone enumerate the member list from the lobby.
- **P2 — pause/freeze UX**: freeze exists (`pauseSubscription`); check-in of a frozen member should say "frozen until X" not "expired" — status mapping table in the endpoint.

## Cross-surface lens
- **Auth:** the kiosk path is public-by-tenant-param — both layers (allowlist + route auth) verified per trap 4; POSTs only per trap 3.
- **Capacity:** class check-in marks attendance on the same F06 booking rows the portal/admin see — one source.
- **Billing:** dunning status surfaces at check-in + portal + admin list — same derivation fn everywhere.
- **Notifications:** dunning notices + waitlist offers via F05; check-in itself does not notify.

## Verification bar
- Test tenant: fresh `gym`, sandbox gateway.
- Walkthrough (the Glofox demo): create membership plans + weekly timetable → enroll member (waiver auto-attached, signed via F03 public link) → member self-books a class on portal → checks in at kiosk by code (green, class attendance marked) → expired member (clock-shifted) gets red screen → failing-card member: dunning retries logged, check-in shows payment-failed flag, front desk collects → PT pack sold, redeemed, balance shown at check-in → full class → waitlist → offer → claim.
- Abuse: sequential-code lookup attempts rate-limited; public response contains no PII beyond first name/status.
- Empty states: timetable empty; zero check-ins today widget.

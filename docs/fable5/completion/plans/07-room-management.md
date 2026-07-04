# 07 — Room management mode

**Covers:** mode `room_management` + presets `hotel`, `guesthouse`, `hostel`
**Modes/flags in scope:** `phase4_room_management`
**Surfaces touched:** admin app · POS (charge-to-room / folio) · customer portal (stays tab)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Room types + rooms | `/rooms`, `/rooms/rates` | `/api/rooms*` | `rooms.js` (mode + flag + `manage_rooms`) → `services/room-service.js` | types, rate overrides, `resolveRateForDate` picks override > base | ☐ |
| Booking lifecycle | `/rooms/bookings`, `/rooms/calendar` | `POST /api/room-bookings` → `/confirm` → `/checkin` → `/checkout` (`rooms.js:200-245`) | `createBooking`…`checkOutBooking` | availability blocks double-book; `calculateStayTotal` incl. tax-inclusive room rates | ☐ |
| No-show / cancel | booking detail | `/noshow`, `/cancel` | `markNoShow`/`cancelBooking` | room freed; deposit disposition correct | ☐ |
| Deposit pre-auth | booking detail | `POST /api/room-bookings/:id/deposit/preauth` (`rooms.js:263`) | `services/room-deposits.js` → gateway | pre-auth when `isEnabled()`; captured at checkout; webhook path (`findBookingByIntent`) resolves | ☐ |
| Folio charges | booking folio | `GET/POST /api/room-bookings/:id/folio*` (`rooms.js:277-297`) | `openFolio`/`addFolioLine`/`attachSaleToFolio`/`settleFolio` | POS sale charged-to-room lands on folio (`useFolioCharging` hook in POSContext); settle closes balance | ☐ |
| Arrivals/departures | `/rooms/arrivals-departures` | timeline/day endpoints | `rooms.js:185` (`/api/room-bookings/timeline`) | today's ins/outs render | ☐ |
| Overdue/stay checks | (worker) | — | room overdue worker (`boot/workers.js`) | overstays flagged | ☐ |
| Portal: my stays | `PortalStays` | `customer-portal/stays.js` (tab `stays` → `phase4_room_management`, mapping correct — `data.js:33`) | — | guest sees bookings + folio; "Guest Portal" title override renders | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results.

## Feature-parity gaps (P1)
- None — Square has no lodging product (§10 exceeds-Square). Wiring-only plan.

## Polish & consistency (P2)
- `hostel` preset sells Beds not Rooms — verify Bed vocabulary on booking forms/receipts.
- Room-mgmt presets set `top_products: false` — confirm dashboard renders sensibly with that widget off.
- Calendar drag interactions error states.

## Confirm during execution
- Tax-inclusive room rates (migration wave item) flow into folio settle totals correctly.
- POS `useFolioCharging`: which POS layout exposes charge-to-room, and is it hidden for non-room presets?
- Deposit behavior with gateway OFF (manual adapter throws on `createCheckout` — graceful?).
- `GET /api/room-bookings/:id` route ordering vs `/timeline` (`rooms.js:185-192` — `/timeline` registered before `/:id`, so OK; verify no other shadow).

## Cross-surface lens (mandatory)
- **Tax** → `room-service.js` + folio settle in the 01 tax-chain diff (never explicitly audited).
- **Payments** → deposit pre-auth shares `payment-gateway.js` + webhook path with billing/treatments — webhook routing by intent must not cross-match.
- **Portal** → stays data scoped to guest; folio amounts match admin view.

## Verification bar (execution)
- Test tenant: fresh `hotel` signup; spot-check `hostel` bed vocab.
- Walkthrough: room type + rate override → booking → confirm → check-in → POS charge-to-folio → add folio line → checkout w/ deposit capture → portal shows stay + folio.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `hotel` — [ ] labels (Room/Guest/Charge/Booking) [ ] dashboard (top_products off) [ ] onboarding room/rate/checkin steps (01-D2) [ ] portal "Guest Portal"/"My Stays"/"Book a stay"
- `guesthouse` — [ ] same, CTA "Book a room"
- `hostel` — [ ] Bed/Beds labels [ ] CTA "Book a bed"

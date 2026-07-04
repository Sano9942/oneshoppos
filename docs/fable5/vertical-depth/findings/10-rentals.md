# Rentals (Car Rental · Equipment Hire · Furniture/Events · Party Supplies)

**Presets:** `car_rental`, `equipment_hire`, `furniture_rental`, `party_supplies` — grouped because all four are pure skins over one `rentals` mode (`phase4_rentals` — `mode-registry.js:53`) with identical onboarding/tabs and only label differences (`industry-config.js:374-477`). Car rental's verdict splits below — its asset class carries legal/operational needs the shared engine doesn't model.
**Surfaces:** POS · portal (contracts/invoices) · admin
**Owned wiring plan:** [completion 06-rentals.md](../../completion/plans/06-rentals.md)

## What's built today (from code)

- Rental items with hourly/daily/weekly rates, deposit amount, upfront/on-return payment policy — `rental_items` (`schema-pg.sql:4091-4107`), `/api/rental-items` CRUD (`routes/rentals.js:23-53`) — works
- Per-unit assets: serial number, label, status `available/rented/maintenance/retired`, condition notes — `rental_assets` (`schema-pg.sql:4111-4121`), `/api/rental-items/:id/assets` — works
- Availability check per item/date-range — `/api/rental-items/:id/availability` (`routes/rentals.js:61`), `services/rental-service.js` — works
- Contract lifecycle: reserve → confirm → checkout → return → complete/invoice/cancel, with rate/deposit snapshots per line, multi-line contracts, asset-level allocation — `routes/rentals.js:97-193`, `rental_contracts`/`rental_contract_lines` (`schema-pg.sql:4127-4181`) — works
- Late fees: computed + overridable (`computeLateFee`, `late_fee_overridden` — `schema-pg.sql:4147`) — works
- Overdue detection + email alert worker — `workers/rental-overdue-worker-boss.js`, `overdue_email_sent_at` — works
- Invoice generation from contract — `POST /api/rental-contracts/:id/invoice` → `customer_invoices` — works
- Timeline view + activity log — `/api/rental-contracts/timeline`, `rental_contract_activities` — works
- Portal: "Rental Agreements"/"Equipment Rentals" contracts tab per preset — `PORTAL_ENABLED_TABS_BY_PRESET` (`industry-config.js:766-769`) — works

## What this industry needs (domain + research)

Benchmarks: Booqable/HireHop (equipment/events), Camasys/EasyRentPro/Speed Auto (vehicles).

- Live availability calendar preventing double-booking; assets by serial/barcode — source: [Booqable equipment rental](https://booqable.com/equipment-rental-software/) — **met**
- **Deposit authorization holds** ("authorize and hold deposits… capture funds without chasing customers") — source: [Booqable](https://booqable.com/)
- **Maintenance scheduling** ("schedule downtime… track the last time an item was serviced") — source: [Booqable](https://booqable.com/equipment-rental-software/), [HireHop comparison](https://crozdesk.com/compare/booqable-vs-hirehop-equipment-rental-software)
- **Online booking by customers** ("customers see availability in real time and reserve outside business hours") — source: [Reservety equipment-rental guide](https://reservety.com/guides/rental-business/equipment-rental-software.html)
- Car rental specifically: **driver-license/ID scan into the agreement, e-signed rental agreement, photo-verified damage inspection at pickup/return, odometer+fuel capture, per-vehicle maintenance/service reminders** — source: [AltexSoft car-rental system anatomy](https://www.altexsoft.com/blog/car-rental-reservation-system/), [EasyRentPro](https://www.easyrentpro.com/car-rental-software/), [Auto Rental News on digital damage inspection](https://www.autorentalnews.com/10202946/how-one-rental-service-uses-a-new-digital-tool-to-detect-vehicle-damage)
- Furniture/party: delivery & setup scheduling per event date — domain reasoning (event rentals are delivered, not collected)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Vehicle-grade agreement: license/CNIC capture, e-sign, odometer/fuel out-in | no | `rental_contracts` has no driver/vehicle fields (`schema-pg.sql:4127-4156`); grep `preauth` in `routes/rentals.js` → 0; `rental_assets` is serial+label only — no plate/odometer (`:4111-4121`); note `services/contracts.js` e-sign exists but is service-contracts, unlinked to rentals | **P0 (car_rental)** | a car can't legally/safely leave the lot on this data model; customers.cnic (FBR column) is not a license record |
| Condition/damage inspection at checkout + return (photos, checklist) | no | only free-text `condition_notes` on the asset (`schema-pg.sql:4118`); no per-contract inspection entity, no photo capture (upload machinery exists in `middleware/upload-validation.js`) | **P0 (car_rental)**, P1 (others) | disputes are the economics of rental deposits; field-PWA selfie capture (`routes/field.js`) is reusable plumbing |
| Gateway deposit pre-auth (hold, not charge) | no | rentals deposits are manual amount+method (`deposit_collected/deposit_method`); rooms and treatment plans both have `deposit/preauth` endpoints + services — rentals is the one rental-deposit vertical without it | P1 (all four) | `services/room-deposits.js` is the copy-from pattern |
| Maintenance scheduling / service reminders per asset | no | `status='maintenance'` enum flag only (`schema-pg.sql:4117`); no service-interval/date fields, no worker | P1 (car, equipment) | Booqable/HireHop both ship it |
| Customer online booking of rentals | no | no public rental endpoints (`routes/CLAUDE.md` public mount list: storefront/bookings/restaurant only); portal contracts tab is read-only | P1 | equipment/party customers expect to self-reserve |
| Delivery & setup scheduling (event rentals) | no | couriers (`routes/couriers.js`) are parcel-shipment adapters; no delivery-run/crew scheduling on contracts | P1 (furniture, party) | |
| Availability, per-asset serials, contract lifecycle, late fees, overdue emails, invoicing, portal | yes | files above | — | a genuinely solid generic engine |

## Readiness verdict

**Equipment hire / Furniture / Party supplies: Minimum-viable** — the contract engine covers the core loop; pre-auth deposits + damage inspection + online booking are what separate it from Booqable. **Car rental: Not-viable** — no license capture, no vehicle fields, no inspection record means the preset can't produce a defensible rental agreement, which is the product in that industry.

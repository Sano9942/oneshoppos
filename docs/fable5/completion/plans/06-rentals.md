# 06 — Rentals mode

**Covers:** mode `rentals` + presets `car_rental`, `equipment_hire`, `furniture_rental`, `party_supplies`
**Modes/flags in scope:** `phase4_rentals`
**Surfaces touched:** admin app · POS (rental charges) · customer portal (contracts tab)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Rental items + assets | `/rentals/items` | `/api/rentals/items*` | `rentals.js` (mode `rentals` + flag + `manage_rentals`) → `services/rental-service.js` | item → asset units w/ serials; availability by date range | ☐ |
| Contract create → confirm | `/rentals/contracts` | `POST /api/rentals/contracts`, confirm | `confirmContract` | contract number generated; asset(s) reserved for window | ☐ |
| Check-out | contract detail | checkout endpoint | `checkoutContract` | asset status out; condition notes; deposit taken | ☐ |
| Return + late fee | contract detail | return endpoint | `returnContract` + `computeLateFee` | late fee = rate × overdue units; damage charge addable | ☐ |
| Complete / cancel | contract detail | endpoints | `completeContract`/`cancelContract` | invoice generated; asset freed | ☐ |
| Overdue detection | (worker) | — | rental overdue worker (`boot/workers.js`) | overdue contracts flagged + notification | ☐ |
| Timeline view | `/rentals/timeline` | timeline endpoint | `rentals.js` | bookings render on asset × date grid | ☐ |
| Portal: my rentals | portal contracts tab | `customer-portal/data.js` (`contracts` → `phase4_rentals` — mapping correct, `data.js:32`) | — | customer sees contracts + due dates; preset label override renders (Rental Agreements / Equipment Rentals / Rental Contracts / Event Bookings) | ☐ |
| Rental invoice → payment | POS / invoices | `/api/sales` or invoice endpoints | v83 tax chain | totals incl. late fees taxed consistently | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results.

## Feature-parity gaps (P1)
- None — rentals is a §10 exceeds-Square vertical. Wiring-only plan.

## Polish & consistency (P2)
- Four presets share one mode — vocab spread is wide (Vehicle/Fleet vs Equipment vs Item): verify each on POS, contracts list, receipts.
- Availability conflicts: friendly error, not 500, on double-book.
- Timeline empty state.

## Confirm during execution
- Deposit flow: does rentals use the gateway pre-auth pattern (like rooms) or manual deposit lines? Verify against `rental-service.js` invoice generation.
- Asset serial ↔ `product_serials.js` — separate systems or linked?
- Late-fee edge: return exactly at cutoff, TZ-sensitive (`req.company.timezone`).

## Cross-surface lens (mandatory)
- **Tax** → `rental-service.js` invoice generation in the 01 tax-chain diff (explicitly never audited per memory).
- **Stock** → rental assets must NOT hit `outlet_stock` sale decrements; check-out/return is its own ledger.
- **Portal** → contracts tab labels per preset; portal data scoped to the logged-in customer only.

## Verification bar (execution)
- Test tenant: fresh `car_rental` signup (richest labels), spot-check `party_supplies` labels.
- Walkthrough: item+2 assets → contract → confirm → checkout w/ deposit → late return w/ fee → invoice → portal shows agreement.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `car_rental` — [ ] labels (Vehicle/Fleet/Renter/Contract) [ ] dashboard (inventory_alerts OFF) [ ] onboarding rental_item/contract/checkout steps (01-D2) [ ] portal "Rental Agreements"
- `equipment_hire` — [ ] labels (Equipment/Hire Contract) [ ] portal "Equipment Rentals"
- `furniture_rental` — [ ] labels (Item/Client/Rental Order) [ ] portal "Rental Contracts"
- `party_supplies` — [ ] labels (Item/Rental Order) [ ] portal "Event Bookings"

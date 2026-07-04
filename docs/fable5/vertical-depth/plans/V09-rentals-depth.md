# V09 — Rentals Depth (Vehicle-Legal · Inspections · Maintenance · Online Booking)

**Covers:** findings [10-rentals](../findings/10-rentals.md) — car_rental's Not-viable verdict (no defensible rental agreement) plus the shared-engine gaps: condition inspections, maintenance scheduling, customer online booking, delivery scheduling.
**Presets/modes:** `car_rental`, `equipment_hire`, `furniture_rental`, `party_supplies` — mode `rentals` (`phase4_rentals`); new flags `rental_inspections`, `rental_online_booking` (defaults per preset at approval).
**Surfaces:** admin (contracts) · portal · public (online reservation) · POS
**Closes findings rows:** [10] "Vehicle-grade agreement: license/CNIC capture, e-sign, odometer/fuel out-in" (**P0 car_rental**) · "Condition/damage inspection at checkout + return" (**P0 car**, P1 others) · "Gateway deposit pre-auth" (P1 — F04 task 3; verified here) · "Maintenance scheduling / service reminders per asset" (P1) · "Customer online booking of rentals" (P1) · "Delivery & setup scheduling" (P1 furniture/party).
**Depends on:** F04 (deposits — hard for the deposit row), F05 (notifications), completion plan 06 executed. Note: rental folio/invoice TAX linkage is completion-01's open pause item (`rental_items` have no tax linkage) — resolve that schema decision BEFORE or WITH this plan's migration wave (same tables, one migration review).
**Branch:** contract/inspection UI rides `redesign/square` (`RentalsRedesign.jsx`); backend/schema off `main`.
**Model:** **Opus, effort high.** Extensions to a solid engine (findings: "a genuinely solid generic engine"); e-sign and photo machinery both exist to reuse.

---

## Tasks

### P0 — car_rental legal-grade agreement
1. **Schema (pause-list):**
```sql
-- vehicle identity on assets (generic keys, car preset uses them)
ALTER TABLE rental_assets ADD COLUMN attributes JSONB DEFAULT '{}';  -- {plate, vin, odometer, fuel_capacity, color…}
-- driver/agreement data per contract
CREATE TABLE rental_contract_drivers (
  id SERIAL PRIMARY KEY,
  rental_contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, cnic TEXT, license_number TEXT, license_expiry DATE,
  phone TEXT, document_photos JSONB DEFAULT '[]',   -- R2 keys: license front/back, CNIC
  is_primary BOOLEAN DEFAULT TRUE
);
ALTER TABLE rental_contract_lines ADD COLUMN checkout_reading JSONB DEFAULT '{}', -- {odometer, fuel_pct}
  ADD COLUMN return_reading JSONB DEFAULT '{}';
ALTER TABLE rental_contracts ADD COLUMN contract_document_id INTEGER; -- FK to contracts(id) — e-sign link
```
2. **Agreement flow (car preset)** — checkout gains required steps: driver record (CNIC + license + document photos, expiry validated), odometer/fuel readings, then **e-signed agreement**: generate a contract from a rental agreement template via the EXISTING e-sign stack (`services/contracts.js:createContract/sendContract/signContract` — findings [10] evidence explicitly notes it exists unlinked) with contract variables (vehicle, driver, dates, rates, deposit); signature on-screen at the counter (staff-assisted sign) or via link. Return captures return readings; km-overage/fuel-shortfall charges computed to the invoice (per-item rate config).
3. **Preset gating** — driver/readings steps required for `car_rental`, hidden elsewhere (preset config, not code forks — one `requires_driver_record` style flag on the preset or rental settings).

### P0/P1 — inspections
4. **Schema (pause-list):**
```sql
CREATE TABLE rental_inspections (
  id SERIAL PRIMARY KEY,
  rental_contract_id INTEGER NOT NULL REFERENCES rental_contracts(id),
  rental_asset_id INTEGER REFERENCES rental_assets(id),
  phase TEXT NOT NULL CHECK (phase IN ('checkout','return')),
  checklist JSONB DEFAULT '{}',                  -- per-preset template: body panels / equipment condition
  photos JSONB DEFAULT '[]',                     -- R2 keys
  damage_notes TEXT, damage_charge NUMERIC(12,2),
  inspected_by INTEGER REFERENCES employees(id),
  customer_ack_signature TEXT,                   -- R2 key (consent-style canvas)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
5. **Inspection flow** — checkout: photos + checklist + customer acknowledgment signature; return: side-by-side with checkout record, damage notes → damage charge → flows to invoice AND to F04 deposit capture (capture exactly the damage amount, release remainder). Checklist templates per preset (car body map later; JSONB checklist v1).

### P1
6. **Deposit pre-auth** — F04 task 3 verified here end-to-end with damage-capture linkage (task 5).
7. **Maintenance scheduling** — on `rental_assets`: `service_interval_days`, `service_due_at`, `last_serviced_at`, usage-based interval for cars (odometer delta) (pause-list columns). Worker check (extend `rental-overdue-worker-boss.js` or sibling) flags due assets → status `maintenance` suggestion + notification; maintenance log rows (reuse `rental_contract_activities` shape or a small `asset_maintenance_log`). Booqable-parity row.
8. **Online rental booking** — public availability + reserve: `GET /api/public/rentals/:tenant/items` + availability + `POST …/reserve` (creates a `reserved` contract pending staff confirm — the existing lifecycle's first state, findings [10] built row) with F04 deposit intent optional. Mount/limiter per `public-bookings.js` pattern. Portal "book again" for existing customers.
9. **Delivery & setup scheduling (furniture/party)** — on contracts: `delivery_required`, `delivery_at`, `setup_notes`, `delivery_status` (pause-list columns) + a day-view "Deliveries" screen (event-date driven). Crew assignment = employee multi-select on the contract. Courier adapters explicitly NOT reused (findings: parcel adapters don't fit event logistics).

### P2
10. Vehicle body-map damage picker (SVG zones) replacing JSONB checklist for cars.
11. Utilization report per asset (rented days / available days).

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| E-sign stack | `services/contracts.js:signContract` + templates + signer events | findings [10] evidence note |
| Photo capture → R2 | field.js selfie pipeline + upload-validation | routes/field.js:168-175 |
| Ack signature | consent canvas → R2 flow | routes/treatment-plans.js:310-317 |
| Deposit engine | F04 (`deposit-engine.js`) | plans/F04 |
| Overdue worker | `workers/rental-overdue-worker-boss.js` | findings [10] built rows |
| Contract lifecycle + FOR UPDATE discipline | `services/rental-service.js` (:281,414,462,553,591 all locked) | grep this session |
| Public mount pattern | `public-bookings.js` + limiter | backend/CLAUDE.md |

## Harden what's built
- **P0 — availability check vs contract creation race.** `rental-service.js` locks `rental_items` FOR UPDATE at contract creation (:291) which serializes per item — good — but VERIFY the availability re-check happens inside that lock for the requested date range (lock-then-stale-check is still a race if the range query ran before the lock). Failure: two staff reserve the last excavator for overlapping weeks within a second → both contracts confirm → one customer stranded. Read `:281-300` at execution; if check precedes lock, move it inside (one-line reorder + test).
- **P0 — online booking multiplies the race.** Task 8's public reserve path MUST go through the same locked service fn — never a route-local availability check ([[feedback_parallel_paths]]).
- **P1 — late-fee/damage/deposit interaction on the invoice.** `computeLateFee` is overridable (`late_fee_overridden` — findings built row); damage charges (task 5) and deposit capture (F04) now also feed the same invoice. Failure: deposit captured for damage AND damage line added to invoice = double-charge. Rule: captured deposit posts as a *payment* against the invoice, damage as a *line*; assert the math in an integration test.
- **P1 — timeline/availability display staleness**: `/api/rental-contracts/timeline` must include `reserved` (pending-confirm) online bookings or staff double-book over them. One status-filter check.

## Cross-surface lens
- **Stock/assets:** asset status transitions (available/rented/maintenance) now have three writers (contracts, maintenance worker, inspections) — single service fn for status change with activity log.
- **Tax:** rental invoice tax = completion-01 OPEN pause item; this plan's invoice-touching tasks (damage/overage lines) must land on whatever resolution that item gets — coordinate the two migrations.
- **Auth/PII:** driver CNIC/license photos are sensitive — staff-only endpoints, never portal-exposed; document photos live under a non-guessable R2 prefix.
- **Notifications:** reservation received (staff), confirm/checkout/return/overdue (customer) via F05.

## Verification bar
- Test tenant: fresh `car_rental` + spot-check `party_supplies` (delivery scheduling + labels).
- Walkthrough (the "can a car legally leave the lot" demo): create vehicle asset with plate/odometer → online reservation by customer (deposit intent) → staff confirms → checkout: driver record w/ license photos + odometer/fuel + inspection photos + customer ack + e-signed agreement (PDF/print view) → return: readings + damage found → damage charge → deposit partially captured, remainder released → invoice shows rental + overage + damage − deposit-as-payment correctly → maintenance: service-due asset flagged, blocked from new contracts until cleared; party_supplies: contract with delivery date → deliveries day-view shows it → crew assigned.
- Concurrency: parallel reserve of the same asset/date-range — one winner (scripted).
- Empty states: deliveries day with none; inspection view with no checkout record (old contracts) degrades gracefully.

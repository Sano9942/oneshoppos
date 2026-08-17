# Vertical Modes — connectivity into the spine (NOT re-depth)

Read-only + six driven behavior flows on fresh local tenants, 2026-07-08, main @ v126. The question is
narrow: is each of the 10 modes wired correctly into the shared spine (sales ↔ folio ↔ tax ↔
inventory ↔ commissions ↔ notifications), assuming its depth is done? Findings only.

**Headline:** the mode↔spine seams are in good shape. Six marquee flows were driven end-to-end and all
six connect correctly. The cross-module issues found are (a) the money/stock races already logged in
`01-CORE-SPINE.md` that these flows sit on top of, and (b) a small number of mode-specific seam bugs.

---

## Driven flows (all PASS) — proof the modes connect

| Mode(s) | Flow driven | Result |
|---|---|---|
| retail (weight) | butcher: 1.375 kg @ 2400 → sale | **PASS** — total 3300.00 exact, gross/tare persisted (NUMERIC 10,3), decimal stock decrement 50→48.625, GET sale returns weights |
| wholesale | on-account sale → AR → over-limit block | **PASS** — `customer_invoices` INV-AR-1 linked via `sales.customer_invoice_id`, cashier over-limit → 403 `CREDIT_LIMIT_EXCEEDED`, aging report reflects balance |
| treatment_plans | dental tooth charting | **PASS** — tooth 26 caries→restoration charted+superseded, plan sessions 0→1, session fee posted to treatment folio |
| appointments + commissions | salon appt → checkout → commission | **PASS** — sale links `appointment_id`, appointment auto-completed with `sale_id` backlink, `commission_earnings` for the STYLIST (not cashier) = exactly 200 (10% of 2000) |
| room_management | hotel folio run | **PASS** — check-in opens folio, POS sale with `folio_id` lands as a folio line, checkout settles to exact 6000, `charge_to_room` sale has zero `sale_payments` (no revenue double-count) |
| rentals | car rental checkout → late return | **PASS** — status chain reserved→…→invoiced, late fee 4000 per `computeLateFee`, inspection 500 damage, overlap → 409 |

The seams that matter — sale→folio, sale→appointment→commission, sale→AR invoice, weighted
sale→stock, rental→invoice — are all real writes to real tables, verified in DB.

---

## Mode-specific seam bugs found

### V1 · Clinical `chart_preset` not consumed → vet/physio charting loads a dental chart
`TreatmentPlansRedesign.jsx:373-374` hardcodes `preset:"dental_adult"` instead of the tenant's
`clinical_config.chart_preset`. (Full write-up + two adjacent gaps — `vet_body` seeds 0 areas, and the
`"dental"`↔`"dental_adult"` key names don't match — in the claim-audit `LEAKS.md #1`.) This is a
mode↔UI seam: the treatment_plans mode is wired to the spine, but the chart-area selection ignores the
preset the mode belongs to.

### V2 · Unaudited credit-limit override on the wholesale seam
`sales.js:1332-1336`: an `all_access` holder bypasses a `hard` credit block silently — 200,
`creditWarning:null`, **no `approval_events` row** — while the manager-PIN path (`:1356-1372`) writes
one. The credit↔sale seam works (403 for cashiers) but the override audit is asymmetric.

### V3 · `customers.balance` isn't the AR source of truth
Wholesale AR lives entirely in `customer_invoices.balance_due`; `customers.balance` stays 0 even at
160% utilization. Any spine consumer reading `customers.balance` as exposure (e.g. a future dashboard
card) will be wrong.

### V4 · Rental invoice deposit math breaks the payment invariant
`rental-service.js` ~710: `balance_due` is netted by the deposit but `amount_paid` stays 0 and no
payment row is written → `amount_paid + balance_due ≠ total_amount`, contradicting the code's own
comment that the deposit "posts as a PAYMENT". The rental→invoice seam is wired; the money bookkeeping
on it is off.

### V5 · Overdue rentals free availability (rental↔availability seam)
`rental-service.js:502` checkout does no availability re-check; availability uses scheduled windows
only, so a unit still physically out (overdue) can be re-contracted for a window starting after its
expected return.

### V6 · Booking-service ↔ POS product-type seam friction
A salon booking service linked to a default-type product 400s `insufficient_stock` at POS until the
product is `product_type='service'`; booking-service creation gives no warning. The appointment→sale
seam works only once the linked product is correctly typed.

### V7 · Folio bucket columns don't sum (room_management)
Manual folio charges land only in `grand_total`, not `room_charge_total`/`pos_charge_total`;
`folio_lines.tax_inclusive_at_charge` snapshots `true` even on a tax-exclusive room (no money impact on
the zero-tax test tenant, but a latent tax-seam bug).

---

## POS gating architecture note (affects every mode)
Three different gating systems coexist on the POS checkout screen and are easy to conflate:
- **preset `enabled_modes`** (`hasMode`) → folio dropdowns (room/treatment), restaurant tip block,
  restaurant routing.
- **feature flags** (`posFlags`) → appointments checkout button (`phase4_appointments`), gift cards,
  wholesale credit tender, holds, price override.
- **literal `industry_type`** → salon walk-in "Performed by" (`POSCheckoutModal.jsx:93`).

A tenant whose preset enables a mode but whose corresponding flag is off (or vice-versa) gets an
inconsistent screen. Today the seeding keeps them aligned (zero drift, per claim-audit), but the
coupling is fragile — the appointments *data model* belongs to the mode while its POS *entry point*
keys off the flag.

Rentals notably have **zero POS integration** (no rental code in `pos/`) — a rental "register" is the
plain retail register; contracts live entirely on the Rentals page. This is by design but worth noting
as a seam that doesn't exist.

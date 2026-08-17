# Folio-tax proposal — rentals / rooms / treatment plans (plan-01 open item 2)

**Status: ✅ APPROVED 2026-07-04 AND IMPLEMENTED.** Shipped as **migration v118** (verified present in
`backend/migrate-pg.js`, 2026-08-17); the completion register's plan-06 row records the folio-tax gap
as "resolved via the approved proposal in v118".
*(Header corrected 2026-08-17 — it still said "Not yet implemented".)*

~~**Status: APPROVED 2026-07-04 (schema columns + no-backfill stance + FBR out-of-scope, all three as proposed). Not yet implemented.**~~ Implementation happens in the gated later steps (rentals V09, lodging V10, clinical V05 — plan-01 steps 18/19/20); the migration below is the agreed design for that work.

## Verified current state (2026-07-04, code-confirmed)

| Vertical | Revenue lines | Tax today |
|---|---|---|
| Rentals | `rental_contract_lines` (rate_snapshot × duration) → `generateInvoiceFromContract` | `customer_invoices.tax_total` **hardcoded 0** (`rental-service.js:610`); `rental_items` has no tax column |
| Rooms | `folio_lines` (`room_night`, `manual_charge`; `pos_sale` lines reference real sales) → `settleFolio` | `guest_folios.tax_total` = SUM of **manually added** `line_type='tax'` lines only (`room-service.js:784`). `room_types.tax_inclusive` exists (v49) but nothing computes tax from it |
| Treatment | `treatment_folio_lines` (`session_fee`, `lab_cost`, `manual_charge`) → `settleFolio` | Same manual-'tax'-lines-only aggregate; invoice items written with **`tax_rate = 0` hardcoded** (`treatment-plan-service.js:1108`) |

Common shape: `pos_sale` lines are already correct (the underlying `sales` rows carry the v83 snapshot). The vertical's **own** charges (room nights, rental duration, session fees) have no tax source, no per-line snapshot, and settle into `customer_invoices` with zero or manual-only tax. On any tenant with `tax_mode != 'none'`, GST/FBR reporting silently understates these verticals' revenue tax.

## Proposed design

Principle: same v83 philosophy as sales — **resolve at charge time, snapshot on the line, aggregate at settle**. These charges are not products, so the product/category steps of the cascade don't apply; the entities get a direct `taxes` FK, and `services/tax-snapshot.js` gains one small entry point that resolves from an explicit tax_id instead of a product id (the mode/inclusive/rounding math is reused, not forked).

### 1. Schema (one migration, ~vNext)

Tax source columns (nullable FK; NULL = untaxed, preserving today's behavior exactly):

- `rental_items.tax_id INTEGER REFERENCES taxes(id)`
- `room_types.tax_id INTEGER REFERENCES taxes(id)` (pairs with existing `room_types.tax_inclusive`)
- `treatment_plans.tax_id INTEGER REFERENCES taxes(id)` + same on `treatment_plan_templates` (template seeds the plan)

Per-line snapshot columns (mirror `sale_items` naming):

- `rental_contract_lines`: `tax_rate_at_charge NUMERIC(6,3) DEFAULT 0`, `tax_amount_at_charge NUMERIC(12,2) DEFAULT 0`
- `folio_lines`: same two columns
- `treatment_folio_lines`: same two columns

No changes to `guest_folios` / `treatment_folios` headers (their `tax_total` stays, now fed by computed line tax + any legacy manual 'tax' lines) and none to `customer_invoices` (already has `tax_total`; `customer_invoice_items.tax_rate` already exists and starts being populated).

### 2. Resolution chain (services/tax-snapshot.js)

New export `resolveTaxForExplicitRate(client, { taxId, price, quantity, taxMode, taxInclusive })`:
1. `tax_mode = 'none'` → 0 (same override as sales)
2. `taxId` → `taxes.rate`; NULL → 0
3. inclusive/exclusive per-line amount math **reused from the existing module** (single rounding implementation)

Write points (each stamps the line columns at creation):
- rental: contract line creation in `rental-service.js` (rate × duration base)
- rooms: `addFolioLine` / room-night posting in `room-service.js`; `tax_inclusive` honored per `room_types.tax_inclusive`, else `company_profile.tax_mode`
- treatment: `session_fee` / `lab_cost` / `manual_charge` line creation in `treatment-plan-service.js`

Settle/invoice points:
- `recalcFolioTotals` (both folio services): `tax_total = SUM(tax_amount_at_charge) + SUM(legacy manual 'tax' lines)`
- `settleFolio` ×2: copy per-line `tax_rate_at_charge` into `customer_invoice_items.tax_rate` (replacing the hardcoded 0)
- `generateInvoiceFromContract`: compute from line snapshots instead of hardcoded 0
- `pos_sale` folio lines keep referencing their sale's own snapshot — **no double-taxing**: the folio line for a POS charge carries rate 0 and the linked sale carries the tax (invoice copies the folio line as-is, matching today's totals).

### 3. Backfill stance: **NO backfill**

- Historical folio lines / rental lines / settled invoices stay as written (tax 0 or manual). Rewriting settled invoices would retroactively change issued documents and A/R balances — same reason v83 didn't backfill `sale_items`.
- The migration is column-add only, `DEFAULT 0`, no data rewrite → safe on every tenant, no lock pressure beyond ALTER TABLE ADD COLUMN.
- Open folios at deploy time: lines created before deploy keep 0; recalc only adds computed tax for lines created after. Acceptable — same transition v83 made.

### 4. FBR stance (explicitly out of scope here)

These invoices flow through `customer_invoices`, not `sales` → they do NOT enter the `fbr_invoices` queue today, and this proposal does not change that. If rental/room/clinic tenants ever need FBR DI on folio invoices, that's a separate decision (it would also need HS-code sources for non-product charges).

### 5. Verification plan (when approved)

- Integration test per vertical: taxed entity → charge → folio/contract totals → settle → `customer_invoices.tax_total` + `customer_invoice_items.tax_rate` correct in exclusive, inclusive, and `tax_mode='none'` tenants; `pos_sale` line not double-taxed.
- Walkthrough on a clinic + rental test tenant (per plan-01 verification bar).

## Decision needed

1. Approve schema columns as listed (3 tax_id sources + 3 line-snapshot pairs)?
2. Approve no-backfill stance?
3. Confirm FBR out-of-scope for folio invoices?

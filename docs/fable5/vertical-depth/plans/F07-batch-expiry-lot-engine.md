# F07 — Batch / Expiry / Lot Engine (FEFO + Rolls)

**Covers:** the biggest single gap of the retail sub-type family ([02-retail-subtypes](../findings/02-retail-subtypes.md)): batch+expiry capture at GRN, FEFO consumption, near-expiry alerting/markdown, write-off — plus the textile roll/lot variant (divisible lot with remaining length).
**Modes/flags:** new flag `batch_expiry_tracking` (default OFF; grocery/butcher/sweet_shop seed ON, textile seeds ON with `lot` vocabulary). Per-product opt-in via `products.track_batches` so mixed catalogs don't pay the cost on every SKU.
**Surfaces:** GRN · POS (decrement + optional batch pick) · storefront/portal (decrement) · transfers/adjustments · returns · reports · admin alerts
**Closes findings rows:**
- [02-retail-subtypes](../findings/02-retail-subtypes.md) → "Expiry/batch tracking + FIFO + near-expiry alerts" (**P0 grocery/butcher/sweet_shop**), "Roll/lot tracking (textile)" (P1)
**Depends on:** F01 recommended first (both rewire the sales decrement block; sequencing avoids a 3-way merge in `routes/sales.js`). Completion 00/01 walkthroughs done (decrement paths proven before being extended).
**Consumed by:** V01.
**Branch:** off `main` (backend + schema); GRN/alerts UI rides `redesign/square`.
**Model:** **Fable, effort xhigh.** This touches EVERY stock-decrement path in the product under concurrency — the most dangerous cross-surface change in the program ([[feedback_parallel_paths]] is literally about this class).

---

## Design

Batch = a received quantity of a product with identity (`batch_number`), optional `expiry_date`, and its own remaining quantity per outlet. Textile roll = the same entity with `lot_type='roll'` and quantity measured in length; "23.5 m left on roll 4" is `remaining_qty` on a roll row. Consumption policy: **FEFO** (first-expiry-first-out; falls back to FIFO by received date when no expiry).

**Key decision — parallel ledger, not replacement:** `outlet_stock.quantity` remains the authoritative total (every existing consumer keeps working); batches are a *decomposition* of it for tracked products. Invariant: `Σ batch.remaining_qty = outlet_stock.quantity` for tracked products, enforced by writing both inside the same transaction that already locks `outlet_stock FOR UPDATE`. A drift-check report catches violations.

### Schema (pause-list at execution)

```sql
ALTER TABLE products ADD COLUMN track_batches BOOLEAN DEFAULT FALSE,
  ADD COLUMN shelf_life_days INTEGER;          -- default expiry suggestion at GRN

CREATE TABLE stock_batches (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  lot_type TEXT NOT NULL DEFAULT 'batch' CHECK (lot_type IN ('batch','roll')),
  batch_number TEXT NOT NULL,
  expiry_date DATE,
  received_qty NUMERIC(12,4) NOT NULL,
  remaining_qty NUMERIC(12,4) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost NUMERIC(12,4),
  grn_id INTEGER,                              -- provenance (FK to GRN line if shape allows — verify at execution)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','expired','written_off')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_batches_fefo ON stock_batches(product_id, outlet_id, expiry_date NULLS LAST, id) WHERE status='active';

CREATE TABLE batch_movements (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receive','sale','return','transfer_out','transfer_in','adjust','write_off','convert')),
  quantity NUMERIC(12,4) NOT NULL,             -- signed
  ref_type TEXT, ref_id INTEGER,               -- sale/transfer/adjustment/conversion id
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### The consumption service (single choke point)

`services/batch-stock.js:consumeBatches(client, { productId, variantId, outletId, qty, refType, refId, batchId? })`
— called INSIDE the caller's existing transaction, AFTER the caller's `outlet_stock FOR UPDATE` (which already serializes concurrent access to the product/outlet pair — no extra locks needed). Allocates FEFO across batches, splits across batches when needed, writes movements, flips `depleted`. `batchId` param = manual pick (butcher chooses the specific carcass batch). If tracked product has batch shortfall vs `outlet_stock` (drift), consume what exists + log a drift warning — never block the sale on ledger drift.

## Tasks

### P0 — capture + consume + alert
1. Schema + flag. PAUSE for approval.
2. **GRN capture** — `routes/grn.js`: per-line optional `batch_number` + `expiry_date` (+ auto-suggest expiry from `shelf_life_days`); creates `stock_batches` rows in the same transaction that bumps stock. Frontend: two fields on the GRN line editor, shown only for tracked products.
3. **Consumption wiring** — call `consumeBatches` from every decrement path: `routes/sales.js` (inside the FOR UPDATE block :1232-1344), `services/reservation.js:convertReservations` (storefront), holds settle, quotation convert, pay-at-table (all three now share the sales insert path post-completion-01 — verify), `routes/returns.js` restock (movement `return` — into the original batch when resolvable via `batch_movements`, else newest active), transfers (out/in movements preserving batch identity + expiry across outlets), adjustments (adjust/write_off with reason).
4. **Near-expiry alerting** — `workers/expiry-alert-worker-boss.js` (standard checklist): daily scan for batches expiring within product-level threshold → notification (`createNotification` — feature-flags.js helper) + digest email section; "Expiring soon" page (mirror `ReorderAlerts` page shape) listing batch/qty/days with actions: markdown (link to price change / `scheduled-changes`) or write-off (adjustment with reason code).
5. **Expiry report** + stock-by-batch drill-down on the product page; drift-check report (invariant above).

### P1 — rolls + POS batch pick
6. **Textile rolls** — GRN receives N rolls (each its own row, `lot_type='roll'`, `received_qty` = length); POS sale of 3.5 m decrements a chosen roll (POS roll-picker for tracked-roll products — cashier picks which thaan was cut); remnant view per product ("Roll 4: 23.5 m"). Roll-level barcode label (label designer) P2-adjacent but listed here for the roll workflow to be usable.
7. POS manual batch pick for `batch` type too (butcher: today's carcass) — optional modal, defaults to FEFO silently.
8. FEFO cost flow: `unit_cost` per batch feeds margin reports for tracked products (actual batch cost vs product-level `cost`) — report-only in v1, no accounting change.

### P2
9. Near-expiry auto-markdown suggestions (percentage ladder by days-to-expiry) surfaced on the Expiring-soon page — suggestion only, applies via existing price-change flows.
10. Batch recall search (which sales contained batch X — via `batch_movements` ref join). One query + one admin screen.

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| Decrement lock discipline | `routes/sales.js` FOR UPDATE block | :1232-1344 |
| Alert page shape | `ReorderAlerts` page + `inventory-intelligence.js` | findings 01 built rows |
| Notification fan-out | `createNotification` (middleware/feature-flags.js export) | backend/CLAUDE.md |
| Worker scaffold | `workers/abc-worker-boss.js` (same daily-scan shape) | findings 01 |
| Markdown mechanism | `routes/scheduled-changes.js` + price lists | findings 01 built rows |
| Reason-coded write-offs | adjustments + return reason codes machinery | migrations list ("return reason codes") |
| Labels for rolls | `routes/barcode-expenses.js` label designer | findings 02 partial row |

## Harden what's built

- **P0 — decrement path census must be re-run at execution.** [[cross_surface_traps_plan01]] trap 5 lists the known non-POS stock writers; completion 01 fixed tax there but stock semantics for quotation-convert (no FOR UPDATE, can go negative) and pay-at-table (no decrement) were *documented, not fixed*. Batch consumption bolted onto a broken decrement inherits the breakage. Failure: quotation-convert decrements `outlet_stock` without lock → batch ledger writes against a racing total → invariant drift on day one. **Gate:** before wiring `consumeBatches` into a path, that path's base decrement must be correct — fix or explicitly exclude + document, coordinating with completion-01's open items.
- **P0 — transfers must move identity, not just quantity.** `routes/inventory.js` transfers adjust `outlet_stock` totals; naive wiring would decrement FEFO at source and create an anonymous batch at destination, losing expiry. Failure: mithai transferred between branches loses its 2-day expiry → sold stale. Transfer must copy batch_number/expiry/unit_cost to the destination row.
- **P1 — stock counts vs batches.** Stock-count sessions (`StockCount` page) reconcile `outlet_stock`; a count correction on a tracked product must also correct batches (apply delta to newest/oldest per sign, or force batch-level counting for tracked products). Failure: count fixes total to 40, batches still sum 50 → drift alarm noise forever. Decide the rule in-plan review.
- **P1 — offline queue sales** (`utils/offlineQueue.js` replays sales later): FEFO allocation at replay time may differ from sale time — acceptable (document), but replay must not bypass `consumeBatches`.

## Cross-surface lens
- **Stock:** the whole plan is the stock lens — the census in Harden #1 IS the checklist; every path gets an integration test asserting the invariant after the operation.
- **Tax/pricing:** untouched (batch is quantity/cost decomposition only).
- **Reports:** inventory-dump / product-movement reports gain optional batch columns for tracked products — additive, don't reshape existing responses (frontend contract).
- **Kits (F01):** kit component consumption calls the same `consumeBatches` per component — one integration test with a kit of tracked components.

## Verification bar
- Test tenant: fresh `grocery` (+ `textile` for rolls, `butcher` labels spot-check).
- Walkthrough: GRN 2 batches different expiries → POS sells across the boundary (FEFO splits) → movements correct → invariant holds; storefront order consumes batches; transfer preserves expiry at destination; return restocks the right batch; near-expiry worker flags tomorrow's batch → write-off with reason → stock + batch + report all agree; textile: receive 3 rolls → sell 3.5 m off roll 2 → remnant view correct; drift-check report clean at the end of the whole walkthrough.
- Concurrency: parallel sales draining one batch — no negative `remaining_qty`, invariant holds (scripted, local PG).
- Untracked products: entire walkthrough of a normal product unchanged (regression).

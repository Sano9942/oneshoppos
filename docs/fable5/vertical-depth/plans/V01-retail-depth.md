# V01 — Retail Depth (General Retail · Grocery · Butcher · Sweet Shop · Textile)

**Covers:** the vertical-specific remainder of findings [01-general-retail](../findings/01-general-retail.md) + [02-retail-subtypes](../findings/02-retail-subtypes.md) after F01/F07 land: grocery checkout hardware loop (scale, price-embedded barcodes, PLU), consumption wiring of kits + batches per preset, exchange-flow depth.
**Presets/modes:** `general_retail`, `grocery`, `butcher`, `sweet_shop`, `textile` — no modes; flag seeding decision below.
**Surfaces:** POS (main) · storefront · admin
**Closes findings rows:** [02] "Scale hardware integration" (**P0 grocery**, P1 butcher/sweet) · [02] "Price-embedded barcode decode" (**P0 grocery**) · [02] "PLU rapid-entry pad" (P1) · [02] "Shelf/deli label printing" (P2) · [01] "Item-swap exchange flow" (P2 partial) · [01] "Age-verification prompt" (P2). Consumes F01 for [01]/[02] kit/disassembly rows and F07 for expiry/roll rows (closed there, *activated per preset* here).
**Depends on:** F01, F07.
**Branch:** POS work rides `redesign/square` (POS is the most-reskinned surface); backend parsing/config off `main`.
**Model:** **Opus, effort high.** Hardware protocol + barcode parsing are pinpointed builds; the engines they feed are already designed.

---

## Tasks

### P0 — the grocery lane loop
1. **Price-embedded barcode decode** — EAN-13 prefix-2x parsing in the POS scan path: `pos/POSOmniInput.jsx` (grep `weight|embedded` → 0 hits today, findings [02]) + backend `routes/products.js` scan endpoint. Config on company profile or POS-device level: prefix digits (20–29), scheme (`price` vs `weight` embedded, decimal places), item-code length. Decode → resolve product by embedded item code (SKU/PLU) → line with decoded weight/price. Backend does the authoritative decode (shared by any client); FE parses only for instant feedback. Schema: one JSONB config column (`company_profile.barcode_scheme` or per-device via `pos_devices`) — pause-list.
2. **Scale integration (lane scale)** — browser-side via WebSerial/HID for common serial-protocol scales (CAS/ANKER-class, 9600-baud weight polls): `frontend/src/utils/scale.js` + a "weigh" button on weighted-product lines in `POSCartTable.jsx` filling the qty field. Feature-detect + graceful manual fallback (current behavior). NO backend change. Document supported protocol(s); this is explicitly a v1 for one protocol class, extensible adapter shape like `services/couriers/`.
3. **Preset flag seeding** — findings [02] header: grocery/butcher/sweet/textile skip `seedRetailFlags` entirely (setup.js runs it only for `general_retail`). Decide + implement: run the retail seeder for all four mode-less retail presets, minus flags that don't fit (verify list with user at approval). Also seed `kit_bom_engine` (butcher/sweet), `batch_expiry_tracking` (grocery/butcher/sweet), textile lot vocabulary. Config-only but touches signup path — verify against `services/retail-flag-preset.js` + `routes/setup.js`.

### P1
4. **PLU rapid entry** — numeric short-code pad in POS (grid layout mode already exists; add a PLU quick-pad panel for grocery preset): type `4011` + qty/weight → line. Backend: products get optional `plu_code` column (pause-list) + scan endpoint accepts PLU lookup; `pos_search_config` gains `show_plu` for grocery/butcher/sweet presets.
5. **Disassembly + box workflows per preset** (consume F01): butcher — disassembly run screen vocabulary ("Break carcass"), yield presets per source product; sweet_shop — assorted-box kit at POS with per-kg contents (kit of weighted components priced by weight + box); verify with the preset's unit vocabulary.
6. **Roll workflow polish** (consume F07): textile POS roll-picker labeled "Thaan", remnants report.

### P2
7. **Shelf/deli labels** — extend label designer templates with price-per-unit + expiry fields (F07 data); scale-printed label decode already covered by task 1.
8. **Exchange flow depth** — `pos/POSReturnExchangeModal.jsx` rated thin (findings [01] partial): even-exchange in one transaction (return + new sale netted), price-difference settlement both directions. Confirm live first (comparison doc 🟡 §2) — if it already nets correctly, this collapses to polish.
9. **Age-verification prompt** — per-product `age_restricted` flag → POS confirm modal (cashier attests). One column (pause-list) + one modal.

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Weighted qty + tare in cart | `pos/POSCartTable.jsx`, `pos/hooks/useCart.js` | findings [02] built rows |
| Scan endpoint | `routes/products.js` scan/search (rate-limit exempt burst path) | backend/CLAUDE.md limiter skip list |
| Adapter shape for scale protocols | `services/couriers/` base→named pattern | services/CLAUDE.md |
| Label designer | `routes/barcode-expenses.js` + `BarcodeTemplatesRedesign` | findings [02] |
| Flag seeding | `services/retail-flag-preset.js:seedRetailFlags` | findings [02] header |
| Return/exchange modal | `pos/POSReturnExchangeModal.jsx` | findings [01] |

## Harden what's built
- **P0 — decoded-price lines vs promotions/tax.** A price-embedded barcode carries a *final* price; the POS pricing pipeline (price lists → promotions → tax snapshot) must treat it as a fixed-price line (like a price override) or promotions could re-discount pre-priced deli packs. Failure: 10%-off-storewide promo stacks on a scale-priced chicken pack → margin loss on every weighed item all day. Cite: promotions apply per-line in the POS cart math (`pos/cartMath.js`); define the interaction explicitly (decoded lines excluded from percentage promos by default, toggleable).
- **P1 — tare double-application.** `show_tare` presets let cashiers enter tare manually; scale-embedded labels ALREADY net tare at the deli counter. Failure: cashier applies tare again on a pre-packed item → undercharge. UI rule: decoded lines lock the tare field.
- **P1 — decimal rounding at the lane.** Weight 0.1235 kg × Rs 999.99/kg — rounding must match the receipt total math in `pos/cartMath.js` (extracted pure fns — findings [01]); add unit tests at 4-decimal weights (cartMath is already unit-tested, extend).
- **P2 — offline queue + decoded barcodes**: `utils/offlineQueue.js` replays sales; decoded fixed-price lines must replay with their decoded price, not re-resolve (snapshot in the queued payload — verify shape).

## Cross-surface lens
- **Pricing:** decoded/fixed-price lines POS-only by design; storefront never sees scale items (weighed at counter) — assert storefront hides `sold_by_weight && track_batches` products or shows "in-store only" (decide; visibility flag exists).
- **Stock:** all decrement changes live in F01/F07 — this plan adds no new stock paths.
- **Receipts:** weight + unit price per line on receipts (`utils/receipt.js` sections) for weighed lines — legal expectation at a grocery counter.

## Verification bar
- Test tenants: fresh `grocery` + fresh `textile`; [[livetestauto_credentials]]-style scripted POS runs.
- Walkthrough: scan a 21-prefix price-embedded barcode → correct product/weight/price line, tare locked, storewide promo does NOT restack; PLU pad sells produce by code+weight; scale-button fills weight (or manual fallback path verified where no hardware); butcher disassembly → cuts sellable; sweet shop assorted box sale decrements components (F01); textile roll cut decrements the chosen thaan (F07); exchange nets price difference both directions; age-restricted product prompts.
- Empty/error: unknown embedded item-code → clear "unmapped scale item" error, not a silent zero-price line.

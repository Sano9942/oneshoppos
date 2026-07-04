# Retail Sub-Types (Grocery · Butcher · Sweet Shop · Textile)

**Presets:** `grocery`, `butcher`, `sweet_shop`, `textile`  **Modes/flags:** no modes (all four have `modes: []` — `backend/config/industry-config.js:92,293,320,349`); differentiation is preset-skin only: labels, `unit_vocabulary`, `pos_search_config.show_tare`, POS layout mode. None of the four run the `seedRetailFlags` seeder (`routes/setup.js` calls it only for `general_retail` — see `services/retail-flag-preset.js` header comment), so they get **fewer** default flags than general retail.
**Surfaces:** POS · storefront · portal (invoices/orders[/loyalty] per `PORTAL_ENABLED_TABS_BY_PRESET`) · admin
**Owned wiring plan:** [completion 00-core-spine](../../completion/plans/00-core-spine.md) (these presets are skins over the spine; no mode plan owns them)

## What's built today (from code)

- Weighted/decimal quantity selling — `WEIGHTED_UNITS = [kg,g,lb,oz,m,cm]` (`backend/config/industry-config.js:701`), per-preset `unit_vocabulary` (butcher `[kg,g,lb,pcs]`, sweet `[kg,g,dozen,pcs,pack]`, textile `[m,cm,pcs,pack]`), decimal qty + tare handling in POS (`frontend/src/pages/redesign/pos/POSCartTable.jsx`, `pos/hooks/useCart.js` — both match `tare|weighted`) — works
- Tare input at POS — `pos_search_config.show_tare: true` for butcher/sweet_shop (`industry-config.js:314,342`) — works
- Preset vocabulary (Cut/Sweet/Fabric labels, "Weight"/"Length" qty label) — `industry-config.js` labels + `PresetContext.jsx` — works
- Everything the general-retail spine has (barcode scan, variants, promotions, loyalty flag available, suppliers/PO/GRN, FBR tax) — see [01-general-retail](01-general-retail.md) — works

## What this industry needs (domain + research)

- **Scale integration** (cashier weighs at counter, weight flows into the line automatically) — the defining hardware workflow of a grocery/butcher counter; manual weight typing is slow and fraud-prone — source: [IT Retail — grocery POS with scale integration](https://www.itretail.com/blog/grocery-pos-systems-with-scale-integration), [Nile Solutions — grocery POS features that matter](https://nilesolutionsgroup.com/2026/02/18/grocery-store-pos-systems-features-that-actually-matter-for-independent-markets/)
- **Price-embedded barcode parsing** (EAN-13 prefix-2x labels printed by deli/butcher scale: barcode encodes item + weight/price; POS must decode it) — standard supermarket receiving-to-checkout loop — source: same IT Retail / POSZEO guides
- **PLU rapid entry** — produce sold by 4-digit PLU codes with a fast numeric lookup pad; 30–50k SKU stores depend on it — source: [POSZEO grocery POS guide](https://www.poszeo.com/blog-channel/best-grocery-store-pos-systems-complete-guide-for-2026/)
- **Expiry / batch tracking + FIFO + near-expiry alerts and markdowns** — perishables are the core margin risk of grocery, butcher, and sweet shops; category software records batch+expiry at GRN and alerts before write-off — source: [EloERP grocery buyer's guide](https://eloerp.net/blog/grocery-store-pos-system-buyers-guide/) + domain reasoning (mithai has 1–3 day shelf life)
- **Production/disassembly (yield) tracking** — butcher buys a carcass and sells cuts; sweet shop produces trays from ingredients; both need a convert-stock step (whole → cuts/trays with yield %) — domain reasoning; supported in specialist meat-shop POS
- **Assorted-box / kit selling (sweet shop)** — the standard mithai transaction is a mixed box priced per kg of contents plus box; needs kit/bundle handling — domain reasoning
- **Roll/lot tracking (textile)** — fabric is bought and sold from identifiable rolls (thaan); remnant lengths per roll matter for what's actually sellable — domain reasoning; textile-specific ERPs track lot/roll

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Expiry/batch tracking + FIFO + near-expiry alerts | no | grep `expiry_date\|batch_number\|batch_id` in `schema-pg.sql` → only COD settlement batches (lines 3966, 3981); nothing on products/GRN | **P0 (grocery, butcher, sweet_shop)** | biggest single gap of the sub-type family; a supermarket or mithai shop cannot manage perishables |
| Scale hardware integration | no | no scale/serial-HID protocol code anywhere in `frontend/src` or `backend/services/printer.js` (only printer hardware exists) | **P0 (grocery), P1 (butcher/sweet)** | PK butcher/mithai counters often type weight manually, so P1 there; a supermarket lane needs it |
| Price-embedded barcode decode at POS | no | `pos/POSOmniInput.jsx` has no `weight`/`embedded` handling (grep → 0 hits) | **P0 (grocery)** | pairs with scale labels; without it every weighed pre-pack is a manual entry |
| PLU rapid-entry pad | partial | product search by SKU/barcode exists (`routes/products.js` search/scan); no short-code numeric pad UX | P1 | SKU-as-PLU is a workaround; confirm live how fast lookup is on a numeric code |
| Production / disassembly with yield (carcass → cuts; batch → trays) | no | no BOM/recipe/conversion table (grep `recipe\|ingredient\|bill_of_materials` backend → 0); `adjustments` can fake it manually | P1 (butcher, sweet_shop) | shares the missing kit/BOM engine with restaurant + retail bundles |
| Assorted-box/kit SKU (sweet shop) | no | same missing kit engine; `smart-collections.js` is display-only | P1 (sweet_shop) | |
| Roll/lot tracking (textile) | no | no lot/roll entity; `product_serial_numbers` (`routes/product-serials.js`) tracks unit serials, not divisible rolls with remaining length | P1 (textile) | serials can't represent "23.5 m left on roll 4" |
| Weighted selling, tare, decimal qty, length units | yes | `industry-config.js:701` + POS files above | — | this part is genuinely done |
| Shelf/deli label printing | partial | barcode label designer exists (`routes/barcode-expenses.js`, `BarcodeTemplatesRedesign`) but can't print weight-embedded labels from a scale | P2 | depends on scale integration landing first |

## Readiness verdict

**Butcher / Sweet Shop / Textile: Minimum-viable** — they can transact today (weighted/length selling works), but each is one flagship feature short of credible (expiry for perishables, rolls for fabric). **Grocery: Not-viable for a real supermarket** (fine for a kiryana counter) — the scale + price-embedded-barcode + expiry trio is table-stakes for the segment the preset name promises.

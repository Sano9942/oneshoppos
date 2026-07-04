# F01 — Kit / BOM / Recipe Engine

**Covers:** the single missing component→product entity (cross-cutting observation #2 in [../README.md](../README.md)) — sellable kits/bundles, recipes with ingredient decrement + plate costing, production (assembly) and disassembly (yield) runs.
**Modes/flags:** core spine (no mode) + new flag `kit_bom_engine` (default OFF; seeded ON by presets that consume it — see V01/V03). Recipe-costing surface additionally gated by `restaurant` mode where it renders in menu engineering.
**Surfaces:** POS · storefront · portal reorder · field-rep · KDS (recipe lines don't change tickets) · admin (ProductForm, new Production screen, reports)
**Closes findings rows:**
- [01-general-retail](../findings/01-general-retail.md) → "True bundle/kit SKUs" (P1)
- [02-retail-subtypes](../findings/02-retail-subtypes.md) → "Production / disassembly with yield" (P1 butcher/sweet), "Assorted-box/kit SKU" (P1 sweet_shop)
- [04-food-service](../findings/04-food-service.md) → "Recipe/BOM ingredient inventory + food cost" (P0 restaurant / P1 cafe), "Combo/meal-deal builder" (P1)
**Depends on:** completion plan 01's `services/tax-snapshot.js` extraction (committed) — kit sale lines must go through the shared tax resolver like any other line.
**Consumed by:** V01 (retail depth), V03 (food service depth).
**Branch:** backend + schema off `main`. ProductForm/Production UI: ProductForm is already tokenized on `redesign/square` (commit d13f0d0) — new tabs/screens ride `redesign/square` to avoid double-skinning.
**Model:** **Fable, effort xhigh.** Net-new inventory engine whose decrement semantics must hold across every sales write path under concurrency — exactly the class of work the completion effort proved needs the strongest model ([[cross_surface_traps_plan01]] trap 5).

---

## Design (build once)

One entity, three consumption modes, selected per product via `products.product_type`:

| `product_type` | Behavior at sale | Behavior in stock |
|---|---|---|
| `standard` (default) | decrement own stock (unchanged) | as today |
| `kit` | decrement **components** at sale time; kit itself holds no stock | sellable qty = `min(floor(component_stock / qty_per))` |
| `assembled` | decrement own stock (pre-made trays, boxed sets) | stock created by **production runs** that consume components |

Disassembly (butcher carcass → cuts) is a production run in reverse: consume 1 source unit, output N products with yield quantities.

### Schema (pause-list at execution — completion-spec §5)

```sql
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (product_type IN ('standard','kit','assembled'));

CREATE TABLE product_components (
  id SERIAL PRIMARY KEY,
  parent_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES products(id),
  component_variant_id INTEGER REFERENCES product_variants(id),
  quantity NUMERIC(12,4) NOT NULL CHECK (quantity > 0),   -- decimal: 0.25 kg flour
  unit TEXT,                                              -- display only; stock unit is the component's
  is_substitutable BOOLEAN DEFAULT FALSE,                 -- combos: swap via modifier group
  modifier_group_id INTEGER REFERENCES modifier_groups(id), -- optional choice slot (QSR combo "any drink")
  UNIQUE(parent_product_id, component_product_id, component_variant_id)
);

CREATE TABLE stock_conversions (          -- production + disassembly runs
  id SERIAL PRIMARY KEY,
  conversion_type TEXT NOT NULL CHECK (conversion_type IN ('assembly','disassembly')),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  source_product_id INTEGER REFERENCES products(id),      -- disassembly: the carcass
  source_qty NUMERIC(12,4),
  output_product_id INTEGER REFERENCES products(id),      -- assembly: the tray/box
  output_qty NUMERIC(12,4),
  notes TEXT, status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE stock_conversion_lines (     -- the other side of the run
  id SERIAL PRIMARY KEY,
  conversion_id INTEGER NOT NULL REFERENCES stock_conversions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity NUMERIC(12,4) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('consume','produce')),
  unit_cost NUMERIC(12,4)                 -- cost allocation for yield accounting
);
```

No recipe-versioning table in v1 — `sale_items` already snapshots price; component snapshot for costing comes from `stock_conversion_lines.unit_cost` and the theoretical-usage report reads current recipe (state this limitation in the report header).

## Tasks

### P0 — engine core (this IS the deliverable)
1. **Schema above** + flag `kit_bom_engine` in `DEFAULT_FEATURE_FLAGS` (default false) + `schema-pg.sql` seed row. PAUSE for approval before applying.
2. **Component CRUD** — `routes/products.js`: `GET/PUT /api/products/:id/components` (admin/manager perms, mirror existing variant endpoints in the same file). Validation: no cycles (walk parent chain), components must be `standard` (no nested kits in v1 — reject with clear error).
3. **Kit decrement at sale** — `routes/sales.js` decrement loop (~line 1232, the FOR UPDATE block): when `product_type='kit'`, expand to components and lock/decrement each component row **in a stable sort order** (product_id, variant_id) to avoid deadlocks — same discipline `services/reservation.js:releaseReservations` already uses. Insert `sale_items` for the kit line at kit price; write component decrements to a `sale_item_components` audit… **no** — reuse `stock_conversions`? No: cheapest correct audit is extending the existing stock-movement trail the sale already leaves. Record component usage in `stock_conversion_lines`-shaped rows keyed by sale? Decision: add nullable `sale_id` to `stock_conversions` and log each kit sale's component consumption as a `conversion_type='assembly'`-style row ONLY when `kit_audit` needed → simpler v1: derive component usage analytically (recipe × sold qty); no per-sale audit rows. Executor: implement the analytic version; flag the audit-row option in the report if variance investigations demand it.
4. **Kit availability** — `GET /api/products` + POS search/scan responses: for kits, computed `available_qty = min(floor(stock/qty_per))` per outlet. Storefront/portal quantity checks (`services/reservation.js`) must reserve **components**, not the kit (reservation rows per component, converted/released together).
5. **Production/disassembly runs** — new `routes/stock-conversions.js`: `POST /api/stock-conversions` (assembly: consume components FOR UPDATE → produce output stock; disassembly: consume source → produce lines with per-line qty + optional unit_cost split by weight/value), `GET` list. All inside one `deps.db.transaction`. Negative-stock rejection identical to sales.
6. **Frontend** — ProductForm "Components / Recipe" tab (kit + assembled types); new "Production" screen under Inventory nav (`nav-config.js`) for assembly/disassembly runs with yield entry; POS: kit line shows component availability error verbatim from API.

### P1 — costing + combos
7. **Plate cost / recipe costing** — extend `reports/menu-engineering.js`: join `product_components` × component cost (products.cost) → plate cost, margin per menu item. Add cost column to the ProductForm recipe tab (live sum).
8. **Theoretical vs actual usage report** — new tab in `routes/reports/`: theoretical = Σ(recipe qty × units sold in range) per component; actual = opening stock + GRN − closing (from `outlet_stock` + adjustments); variance %. This is the Toast-parity food-cost headline ([04-food-service](../findings/04-food-service.md) "what the industry needs").
9. **Combos** — a `kit` whose component rows carry `modifier_group_id` (choice slot). POS: selecting the combo opens the existing modifier-selection UI (`services/modifiers.js` constraint validation reused as-is); resolved choice decrements the chosen component. Fixed combo price on the kit product.

### P2
10. Kit "exploded" receipt rendering option (`utils/receipt.js` section builder) — show components indented under kit line, toggle in receipt template designer.
11. Assembly-run barcode labels for produced trays (reuse label designer, see reuse map).

## Reuse map (grep-confirmed)

| Need | Reuse — do NOT rebuild | Evidence |
|---|---|---|
| Row-lock decrement pattern | `routes/sales.js` FOR UPDATE block | sales.js:1232-1344 |
| Deadlock-safe multi-row locking | `services/reservation.js` sorted lock keys | services/CLAUDE.md ("sorts stock keys before locking") |
| Choice slots in combos | `services/modifiers.js` group constraint validation | modifiers.js (min/max/required) |
| Tax on kit sale lines | `services/tax-snapshot.js` (plan-01 extraction) | untracked file in working tree — commit first |
| Menu item margin report | `reports/menu-engineering.js` | findings 04 "works" row |
| Produced-goods labels | `routes/barcode-expenses.js` label designer | findings 02 gap table row "Shelf/deli label printing" |

## Harden what's built (existing features this touches)

- **P0 — every non-POS sales writer must get kit expansion or reject kits.** `holds.js` settle, `restaurant/pay-at-table.js`, `tier4/crm.js` quotation-convert, storefront `web_orders` insert sales/reserve stock via their own paths ([[cross_surface_traps_plan01]] trap 5 — those paths just got tax-fixed by completion 01, stock semantics still diverge: quotation-convert decrements without FOR UPDATE, pay-at-table doesn't decrement). **Failure scenario:** kit sold through storefront → reservation reserves the kit product id which has no stock rows → either 400s a valid order or oversells components. Executor must either wire expansion into `reservation.js`/`allocation.js`/holds-settle or hard-reject `product_type != 'standard'` on paths not yet wired, with an explicit error. Do not fix quotation-convert's missing FOR UPDATE here silently — that's completion-01 documented scope; coordinate.
- **P1 — variant kits.** `product_components.component_variant_id` exists but POS variant-picker flow (`pos/POSCartTable.jsx` weighted/variant handling) assumes the sold line owns the variant. Failure: kit containing "Coke 500ml (variant)" decrements the parent product's `outlet_stock` row instead of `variant_outlet_stock` if the decrement branch keys on the sale line's variant only. Cover with an integration test: kit with a variant component → `variant_outlet_stock` decremented.
- **P1 — decimal component quantities × weighted units.** Recipes use 0.25 kg; `WEIGHTED_UNITS` handling exists in cart math but `outlet_stock.quantity` NUMERIC precision must round consistently (`ROUND(expr::numeric, 4)`). Failure: 1000 naan sales × 0.251 kg drift accumulates visible phantom stock. Define rounding in one place in the engine service.

## Cross-surface lens
- **Stock:** POS sale · storefront reservation/allocation · field-rep order · holds settle · quotation convert · returns restock (returning a kit must restock components, not the kit — extend `routes/returns.js` restock branch) · transfers/adjustments (kits have no stock — block transfer of `kit` type with clear error).
- **Tax:** kit line = one taxable line at kit price through `tax-snapshot.js`; components carry no tax lines.
- **Pricing/promotions:** kit price participates in promotions like any product; promo engine fork (completion-01 open pricing item) applies — verify on POS path only, reference completion 01 for the fork.
- **Visibility/MOQ:** kits respect `products.visibility` + MOQ rows like standard products (both services key on product id — confirm no `product_type` assumptions).

## Verification bar
- Test tenants: fresh `sweet_shop` (assembly + assorted box) + reuse [[restaurant_test_tenant]] (recipe costing + combo).
- Walkthrough: define recipe on 2 menu items → sell at POS → component stock decremented exactly; combo with drink choice → chosen drink decremented; assembly run produces tray stock + consumes ingredients; disassembly run (1 carcass → 4 cuts with yield) → cuts in stock; kit availability = component min on POS and storefront; sell kit on storefront → components reserved then decremented on order accept; return a kit → components restocked; theoretical-vs-actual report reconciles to hand math after the above.
- Concurrency: two parallel `POST /api/sales` for the last kit's components — exactly one succeeds (scripted, local PG).
- Empty states: product with type `kit` and zero components is not sellable (clear POS error, not a silent 0-decrement sale).

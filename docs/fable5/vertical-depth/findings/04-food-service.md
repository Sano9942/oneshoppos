# Food Service (Cafe / QSR · Full-Service Restaurant)

**Presets:** `cafe`, `restaurant` — grouped because they enable the identical mode with the identical 13 flags (`mode-registry.js:4-21`); they differ only in preset skin (`pos_layout_mode: "counter"` vs `"list"`, floor-plan widget, onboarding steps — `industry-config.js:114-139` vs `30-55`) and get the same `RESTAURANT_SEED_FLAGS` (`services/retail-flag-preset.js:57`). Verdicts split below where the two segments' needs diverge.
**Surfaces:** POS · KDS · customer kiosk · QR menu/pay (public) · online-ordering inbox · portal (orders/loyalty) · admin
**Owned wiring plan:** [completion 02-restaurant.md](../../completion/plans/02-restaurant.md)

## What's built today (from code)

The second-deepest vertical:

- Floor plans, sections, tables, table sessions — `services/restaurant-floor.js`, `restaurant_floor_plans/sections/tables` (`schema-pg.sql:3037-3060`) — works
- Check lifecycle: open/split (by item and by seat)/fire course/tabs/recalc — `services/restaurant-checks.js` — works (×100 recalc bug fixed by completion plan 01)
- KDS: stations, tickets, bump/recall, routing rules, load snapshot worker, KDS analytics report — `services/restaurant-kds.js`, `routes/kds.js`, `workers/kds-load-snapshot-worker-boss.js`, `reports/kds-analytics.js` — works
- Modifiers with min/max/required constraints, price deltas baked into draft lines — `services/modifiers.js` — works
- Course timing + auto-release — `workers/course-release-worker-boss.js` — works
- 86/availability, void/comp with manager PIN (`services/manager-pin.js`), day-parting menu schedules (`services/menu-schedule-resolver.js`), menu engineering report (`reports/menu-engineering.js`) — works
- Tips: capture, pooling, distribution → `commission_earnings` payroll link — `services/tips.js` — works
- Self-order kiosk (counter mode), QR menu + pay-at-table, native reservations + waitlist — `routes/restaurant-kiosk.js`, `routes/restaurant/pay-at-table.js`, `routes/restaurant/reservations.js`, `routes/restaurant/waitlist.js`, `routes/public-restaurant.js` — works
- Online ordering inbox for own channels — `routes/restaurant-inbox.js`, `services/online-inbox.js` — works
- Drive-thru — flag `phase4_restaurant_drive_thru` exists (`mode-registry.js:18`) but the Square comparison rates Drive-Thru ❌; depth behind the flag **confirm live**

## What this industry needs (domain + research)

- Floor/KDS/coursing/splits/tips/kiosk/QR — Toast and Square for Restaurants table-stakes — source: [sanopos-vs-square-comparison.md §4](../../../research/sanopos-vs-square-comparison.md) — **SanoPOS is at or beyond parity on all of these**
- **Recipe/ingredient-level inventory + food costing** — "consistently updated ingredient prices enable recipe costing tools to provide near real-time COGS per menu item… plate costs, waste, actual vs theoretical inventory" — the #1 back-of-house profit lever; Toast ships it via native inventory + Recipe Costing integration — source: [Toast inventory](https://pos.toasttab.com/products/inventory-management), [Toast recipe costing](https://pos.toasttab.com/blog/on-the-line/achieve-restaurant-recipe-costing)
- **Delivery-aggregator integration (foodpanda above all, in Pakistan)** — "your POS should integrate directly with third-party delivery platforms (foodpanda, Careem) so online orders land in the kitchen queue without re-entry"; foodpanda publishes a POS integration API; the local competitor (Foodnerd) leads its pitch with FBR + foodpanda integration — source: [EloERP restaurant buyer's guide](https://eloerp.net/blog/restaurant-pos-system-buyers-guide/), [foodpanda integration docs](https://integration.foodpanda.com/documentation/), [Foodnerd Pakistan](https://www.foodnerdpos.com/pakistan)
- Combo meals / meal deals (QSR) — the standard QSR menu unit — domain reasoning; modifiers approximate but don't bundle-price

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| foodpanda (+ Careem) order injection → KDS | no | marketplace adapters are Daraz/Meta/WhatsApp/Google only (`services/marketplace/`); `restaurant-inbox.js` serves own channels only | **P0 (cafe/QSR), P1 (FSR)** | in PK, delivery-led QSRs live on foodpanda; manual tablet re-entry is the dealbreaker the local competitor attacks. Aggregator webhook → `online-inbox.js` is a natural fit |
| Recipe/BOM ingredient inventory + food cost (actual vs theoretical) | no | grep `recipe\|ingredient\|bill_of_materials` backend → 0 hits; menu items decrement as whole products via `outlet_stock` | **P0 (restaurant), P1 (cafe)** | without it "inventory" is meaningless for a kitchen — you stock flour, you sell naan. Menu-engineering report exists but runs on sale prices, not plate costs |
| Combo/meal-deal builder | no | no kit/bundle entity; `services/modifiers.js` handles options, not multi-product fixed-price bundles | P1 | shares the missing kit engine with retail bundles + sweet-shop boxes |
| Floor, KDS, coursing, splits, 86, tips, kiosk, QR pay, reservations, waitlist, dayparts | yes | files above | — | exceeds Square (native reservations) |
| Card-preauth bar tabs | no | tabs exist (`restaurant-checks.js:openTab`) with no gateway pre-auth hold | P2 | comparison doc §4 🟡; low card penetration in PK bars/cafes |
| Caller-ID phone ordering | no | no telephony integration anywhere | P2 | inbox covers typed-in phone orders |

## Readiness verdict

**Full-service restaurant: Competitive** — dine-in operations exceed Square; the biggest thing between it and category-leading is recipe-level food costing. **Cafe/QSR: Minimum-viable-plus** — counter flow, kiosk, and KDS are strong, but a delivery-led PK QSR will reject the demo the moment foodpanda orders need manual re-entry.

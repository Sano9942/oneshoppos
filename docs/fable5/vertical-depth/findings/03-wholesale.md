# Wholesale / B2B Distribution

**Presets:** `wholesale`  **Modes/flags:** mode `wholesale` → `wholesale_credit_controls` (`mode-registry.js:71`); signup additionally seeds `WHOLESALE_SEED_FLAGS` = credit controls, field sales, schemes, secondary sales **on top of** `seedRetailFlags` (`services/retail-flag-preset.js:111`)
**Surfaces:** POS · storefront (B2B reorder) · portal · **field** (rep PWA) · manufacturer portal · admin
**Owned wiring plan:** [completion 04-wholesale.md](../../completion/plans/04-wholesale.md)

## What's built today (from code)

The deepest non-retail vertical — built in deliberate tiers (0 → 2):

- Credit & AR: customer credit limits/block modes/payment terms, on-account sales, AR aging, customer statements — `routes/customers.js` (credit columns), `routes/customer-invoices.js`, AR reports — works
- Field sales: rep mobile PWA with GPS+selfie geofenced check-in/out, routes, visit log, order capture posting to `POST /api/sales` with `field_visit_uuid` — `routes/field.js`, `services/geo.js`, `pages/redesign/field/` — works
- Schemes: slab/tier promotions with brand scope + priority + frozen application snapshots — `routes/promotions.js` (`slab_percent`, `tier_rules`), `sale_promotion_applications` table — works
- Manufacturer-partner portal: brand-scoped secondary-sales monitoring with isolated JWT scope, 5 data endpoints, admin CRUD — `routes/manufacturer-portal/`, `routes/manufacturer-partners.js`, `middleware/manufacturer-auth.js` — works
- B2B ordering: customer portal + storefront reorder (web + in-store UNION, `?adopt=` cart handoff), MOQ + case-pack enforcement (`services/moq.js`), customer-group catalog visibility (`services/product-visibility.js`) — works
- Pricing: price-list cascade outlet → channel → customer → group → base (`services/quote.js:resolvePriceForContext`), customer-group/loyalty stacking (`services/pricing.js`) — works
- Quotations → invoice (`routes/tier4/crm.js` convert), batch invoicing with idempotency guard (`services/customer-invoicing.js:createBatchInvoices`), invoice payment reminders (`scheduleReminders`) — works
- Fulfillment: picklists, loadsheets, dispatch, COD settlement reconciliation, 13 courier adapters — `routes/fulfillment.js`, `services/couriers/` — works
- Post-dated cheques (a very PK-wholesale instrument) — `postdated_cheques` in accounting (`routes/tier4/accounting.js`, `PostdatedCheques` page) — works

## What this industry needs (domain + research)

- Credit management, statements, price tiers, customer-specific catalogs/B2B portal — inFlow's headline wholesale features are private B2B showrooms per customer with customer-specific prices; Unleashed leads with margin-by-customer/channel — source: [inFlow wholesale](https://www.inflowinventory.com/use-cases/wholesale-software), [Unleashed wholesale distribution](https://www.unleashedsoftware.com/wholesale-distribution-software/) — **SanoPOS has all of these**
- **Backorders & partial fulfillment** — "systems should handle bulk orders, backorders, and split shipments with minimal intervention"; a distributor routinely takes orders it can only part-fill and owes the remainder — source: [SimplyDepo wholesale software guide](https://simplydepo.com/industry/wholesale-distribution-software-features-pricing-reviews/) + domain reasoning
- **Van sales / load-out stock** — PK FMCG distribution runs two models: order-booker (built) and van sales, where the rep carries stock, sells off the van, and reconciles load-out vs. cash at day end — domain reasoning (the field PWA currently only books orders)
- Route/delivery management with delivery confirmation — source: SimplyDepo guide (routes exist for reps; loadsheets exist for dispatch)
- Tight accounting sync — source: [Unleashed](https://www.unleashedsoftware.com/industry/wholesale-inventory-management/) — SanoPOS has native double-entry accounting, stronger than sync

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Backorders / partial fulfillment | no | `services/reservation.js` + `services/allocation.js` both enforce "no partial fulfillment" (400 on shortfall); `routes/sales.js:2068` only surfaces `insufficient_stock` for an oversell modal; no backorder entity in `schema-pg.sql` | **P0** | the one structural hole: a distributor with a 60%-fillable order today must either oversell or lose the line record |
| Van-sales mode (rep load-out, sell-from-van, end-of-day reconcile) | no | `routes/field.js` is check-in + order capture only; no van/vehicle stock location; `outlet_stock` has no mobile-location concept | P1 | second distribution model in the wedge market; order-booker model is fully served |
| Delivery-run management with proof-of-delivery | partial | loadsheets + dispatch + tracking events in `routes/fulfillment.js`; no POD capture (signature/photo) on delivery | P1 | rep check-in selfie machinery (`routes/field.js`) is reusable |
| Credit / AR / statements / terms | yes | Tier 0 stack above | — | |
| Slab schemes, MOQ, case-pack, per-customer catalog+prices | yes | Tiers 1.3–2 stack above | — | matches inFlow's flagship B2B portal feature |
| Retrospective rebates (period-end volume rebates) | no | deferred by design (Tier 1.3.5 note — no `rebate` table in schema) | P2 | deliberately parked until a customer asks |
| Catch-weight (order by case, invoice by actual kg) | no | weighted units exist per-line but no dual-unit qty on `sale_items` | P2 | matters for meat/produce distribution only |

## Readiness verdict

**Competitive.** Credit, field sales, schemes, B2B portal, and manufacturer visibility collectively exceed inFlow/Unleashed for the Pakistan distribution wedge; the single thing keeping it from category-leading operationally is **backorders/partial fulfillment** — every real distributor hits a short-stock order in week one.

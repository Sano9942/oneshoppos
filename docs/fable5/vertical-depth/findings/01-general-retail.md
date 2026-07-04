# General Retail

**Presets:** `general_retail`  **Modes/flags:** no modes; 19 seed flags via `RETAIL_SEED_FLAGS` (`backend/services/retail-flag-preset.js:30`) — omni input, variant picker, price override, gift cards, loyalty, holds, inventory intelligence, label designer, draft orders, approvals, risk controls, COD/shipping/SMS integrations
**Surfaces:** POS · storefront · portal (invoices/orders/loyalty/profile) · kiosk (attendance) · admin
**Owned wiring plan:** [completion 00-core-spine](../../completion/plans/00-core-spine.md) (spine) + [11-growth-surface](../../completion/plans/11-growth-surface.md) (consumer/marketing gaps)

## What's built today (from code)

This is the reference vertical — the deepest build in the product. Everything below verified in source:

- Full POS with offline queue, weighted items, variants, omni input, holds/layaway, returns+exchange modal, price override, approvals — `frontend/src/pages/redesign/pos/` (62 files incl. `POSCartTable.jsx`, `POSReturnExchangeModal.jsx`, `POSOmniInput.jsx`, `POSHoldCreateModal.jsx`) — works
- Catalog: variants, attribute sets, hierarchical categories, brands, price lists/books, smart collections, scheduled changes, barcode label designer — `routes/products.js`, `price-lists.js`, `smart-collections.js`, `scheduled-changes.js`, `barcode-expenses.js` — works
- Inventory: multi-outlet stock, transfers, adjustments, stock counts, serialized inventory, ABC classification + reorder intelligence (`routes/inventory-intelligence.js`, `workers/abc-worker-boss.js`), stock aging, shrinkage — works
- Purchasing: POs, GRN, supplier payables, supplier returns — `routes/purchase-orders.js`, `grn.js`, `supplier-returns.js` — works
- Customer engagement: gift cards (`routes/gift-cards.js` + public balance lookup), loyalty points + tiers (`routes/loyalty.js`), promotions (`routes/promotions.js`), SMS/email campaigns (`routes/marketing.js`, `services/sms.js`) — works
- Omnichannel: headless storefront (`routes/storefront.js`), customer portal, marketplace channels (Daraz/Meta/WhatsApp/Google), Shopify/Woo import, 13 courier adapters + fulfillment + COD reconciliation — works (marketplace sync worker handlers are stubs — owned by completion plan 11)
- Finance: full double-entry accounting, FBR digital invoicing, tax snapshot architecture — `routes/tier4/accounting.js`, `routes/fbr.js`, `services/tax-snapshot.js` — works
- Governance: risk controls, override reasons, approval policies, action history — works

## What this industry needs (domain + research)

A general retail store needs fast checkout, accurate stock, returns, promotions, staff control, and increasingly a consumer web presence. The Square comparison ([sanopos-vs-square-comparison.md](../../../research/sanopos-vs-square-comparison.md)) already benchmarks this vertical exhaustively — SanoPOS matches or exceeds Square on core commerce and inventory. The genuine industry needs *not* met are the consumer-facing growth surface (§11 of that doc): website builder, marketing automations, review collection, payment links, wallet passes.

## Gap analysis (ranked)

Depth gaps here are already owned by the completion effort — this file exists mainly as the baseline other verticals are contrasted against. Not re-reported: everything in completion plan 11 (website builder, marketing automations, reviews, payment links, wallet passes, AI cataloging) and plan 00's P0/P1 rows.

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Core POS/inventory/purchasing/finance loop | yes | files above | — | at or beyond Square parity |
| True bundle/kit SKUs (sell a made-up assortment, decrement components) | no | no BOM/recipe/kit table anywhere (grep `recipe\|ingredient\|bill_of_materials` backend → 0 hits); `smart-collections.js` is display grouping only | P1 | shared gap with sweet shop (assorted boxes) and restaurant (combos) — one kit/BOM engine would serve all three |
| Item-swap exchange flow | partial | `pos/POSReturnExchangeModal.jsx` exists; comparison doc rates it thin (🟡 §2) | P2 | confirm live |
| Age-verification prompt (tobacco/etc.) | no | no hit in `routes/sales.js` or POS modals | P2 | niche in PK market |

## Readiness verdict

**Competitive.** The single biggest thing between this vertical and category-leading is the consumer growth surface (website builder + marketing automations) — already scoped as completion plan 11, not a new finding here.

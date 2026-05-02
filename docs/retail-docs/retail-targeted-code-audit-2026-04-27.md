# Retail Targeted Code Audit - 2026-04-27

This audit verifies [sanopos-retail-master-reference.md](sanopos-retail-master-reference.md) against live source code.

Important evidence rule: **no `CLAUDE.md` files were used as authority**. They are stale for this purpose. Evidence came from route registries, route files, frontend routes, navigation, feature flags, retail seeders, workers, schema/migrations, and direct frontend API calls.

## Retail Launch PR Context

After reviewing the local retail-launch PR trail from PR 0 through PR 9, the launch model is:

- PR 0 is infrastructure-only. It is not a git code change, but it is launch-critical because it enables the worker env vars behind seeded retail features: `RETAIL_DIGEST_WORKER_ENABLED`, `ANOMALY_WORKER_ENABLED`, `HOLD_EXPIRY_WORKER_ENABLED`, `RESERVATION_WORKER_ENABLED`, `MARKETPLACE_SYNC_WORKER_ENABLED`, and `SCHEDULED_CATALOG_WORKER_ENABLED`. It also calls for `INTEGRATION_SECRET_KEY` and `SHOPIFY_SECRET_KEY`.
- PR 1 makes signup Free-forever: every new tenant starts on `plan='free'`, `payment_status='active'`, `trial_ends_at=NULL`, with 1 outlet, 3 employees, and 100 products.
- PR 2 seeds the 19 retail launch flags only during setup completion when `industry_type === "general_retail"`. Other business-type tiles are shown as coming soon and are not selectable at launch.
- PR 5 seeds the 5 multi-outlet flags only after the tenant actually creates a second outlet: `context_selection_required`, `context_header_enforced`, `phase2_outlet_pricing`, `phase2_outlet_visibility`, and `phase2g_price_books`. `kiosk_context_locked` is intentionally excluded.
- PR 6 through PR 9 harden onboarding: setup auto-login, dashboard onboarding/FBR prompts, email verification before setup, Terms/Privacy links, optional Turnstile CAPTCHA, and setup-link resend.

Practical audit meaning: the retail seed itself is code-backed, but launch readiness depends on PR 0 environment alignment. If the worker env vars are not enabled in production, some seeded features can appear enabled while their background jobs do not run.

## Executive Result

The master reference is broadly accurate as a retail map. The main retail pillars are present in code and wired through backend routes, frontend routes, navigation, flags, workers, or public routes.

The audit found several important precision issues:

- some feature flags are seeded/defaulted but have no runtime enforcement,
- some surfaces described as flagged are actually only partially gated,
- a few documented maturity claims should stay "Partial",
- the marketplace sync worker is still a stub,
- one headline page count has drifted or was counted differently.

No product code was changed.

## Findings First

### 1. `*Redesign.jsx` count is currently 97, not 99

The master reference says there are 99 `*Redesign.jsx` pages. A current filesystem count of `frontend/src/pages/redesign/*Redesign.jsx` returns 97.

Practical meaning: this is not a product bug, but the headline snapshot should be refreshed or the counting rule should be clarified.

Evidence:
- [frontend/src/pages/redesign/](../frontend/src/pages/redesign/)
- [sanopos-retail-master-reference.md](sanopos-retail-master-reference.md)

### 2. `phase2g_label_designer` is not a real runtime gate today

The flag exists in defaults, schema/migration seed data, tests, and the retail seed list. I found no frontend or backend runtime check for `phase2g_label_designer`.

The barcode template surface is real, routed, visible in nav, and backed by `/api/barcode-templates`, but it is not hidden or enforced by `phase2g_label_designer`.

Practical meaning: the master reference should not describe "Label designer" as a flagged feature unless code is updated to gate it. Today it behaves like a shipped barcode-template surface, not a flag-controlled rollout.

Evidence:
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [retail-flag-preset.js](../backend/services/retail-flag-preset.js)
- [barcode-expenses.js](../backend/routes/barcode-expenses.js)
- [nav-config.js](../frontend/src/ui/nav-config.js)

### 3. `phase2g_receipt_barcode_lookup` is not a real runtime gate today

The flag exists in defaults, schema/migration seed data, tests, and the retail seed list. I found no runtime `requireFeature()` or frontend flag check for it.

The receipt/barcode lookup behavior is real: POS return exchange calls `/api/sales/by-barcode/:code`, and `sales.js` implements that endpoint. But the lookup is not gated by `phase2g_receipt_barcode_lookup`.

Practical meaning: the capability is present, but the flag/maturity wording is misleading. It is not currently a rollout-controlled feature.

Evidence:
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [retail-flag-preset.js](../backend/services/retail-flag-preset.js)
- [POSReturnExchangeModal.jsx](../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx)
- [sales.js](../backend/routes/sales.js)

### 4. `phase5_payment_gateways` is a defined flag with no runtime checks

The flag exists in `DEFAULT_FEATURE_FLAGS` and migrations, but I found no `requireFeature("phase5_payment_gateways")` call and no frontend check.

Payment gateway code is real and used by billing, customer invoices, storefront checkout, POS card payments/refunds, public booking flows, and webhooks. The gateway availability is currently env/provider/config driven, not controlled by this flag.

Practical meaning: describe payment gateways as connection/env-based, not feature-flag-gated by `phase5_payment_gateways`, unless a real gate is added.

Evidence:
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [payment-gateway.js](../backend/services/payment-gateway.js)
- [billing.js](../backend/routes/billing.js)
- [webhooks.js](../backend/routes/webhooks.js)

### 5. Serialized inventory is less strictly gated than the master reference says

The master reference lists `product-serials.js` as gated by `phase2g_serialized_inventory`. In live code, `product-serials.js` does not call `requireFeature()` and does not even destructure it from deps.

Related serial endpoints are also split:

- `GET /api/products/:id/serials`, `GET /api/sales/:id/serials`, and `PUT /api/products/:id/serial-required` live in `product-serials.js` without the feature gate.
- `POST /api/products/:id/serials` lives in `barcode-expenses.js`, also without the feature gate.
- POS serial-entry UI checks `posFlags.phase2g_serialized_inventory`.
- `sales.js` and `returns.js` read serial-related flags at runtime for sale/return behavior.

Practical meaning: serialized inventory is real, but not cleanly backend-gated as a whole. Direct API access can reach some serial-management endpoints even when the flag is off.

Evidence:
- [product-serials.js](../backend/routes/product-serials.js)
- [barcode-expenses.js](../backend/routes/barcode-expenses.js)
- [POSSerialEntryModal.jsx](../frontend/src/pages/redesign/pos/POSSerialEntryModal.jsx)
- [sales.js](../backend/routes/sales.js)
- [returns.js](../backend/routes/returns.js)

### 6. Loyalty tiers are not gated by `phase2g_loyalty`

The master reference labels `LoyaltyTiersRedesign.jsx` as `phase2g_loyalty`. In live code:

- nav shows "Loyalty Tiers" with `requiredPerm: "all_access"` but no `requiredFlag`;
- frontend route `/loyalty-tiers` has permission gating only;
- the page calls `/api/loyalty/tiers`;
- `/api/loyalty/tiers` CRUD endpoints live in `customers.js` and are not feature-gated;
- only loyalty ledger/adjust endpoints in `loyalty.js` are gated by `phase2g_loyalty`.

Practical meaning: loyalty tiers/admin are reachable without the loyalty flag, while deeper loyalty ledger operations are gated. The reference should split "loyalty tiers/config" from "loyalty ledger/adjustment/POS loyalty behavior".

Evidence:
- [nav-config.js](../frontend/src/ui/nav-config.js)
- [appRoutes.jsx](../frontend/src/routes/appRoutes.jsx)
- [LoyaltyTiersRedesign.jsx](../frontend/src/pages/redesign/LoyaltyTiersRedesign.jsx)
- [customers.js](../backend/routes/customers.js)
- [loyalty.js](../backend/routes/loyalty.js)

### 7. Marketplace background sync is still a stub

The master reference already calls this out, and live code confirms it. `marketplace-sync-worker-boss.js` registers jobs and logs polling/check messages, but the actual Daraz/Meta/Google calls are comments.

Practical meaning: marketplace manual routes/UI are real, but background marketplace sync should remain "Partial / manual-only".

Evidence:
- [marketplace-sync-worker-boss.js](../backend/workers/marketplace-sync-worker-boss.js)
- [integrations/](../backend/routes/integrations/)
- [marketplace services](../backend/services/marketplace/)

### 8. `offline_returns` has no dedicated worker

The flag exists and POS return exchange UI reads it, but there is no dedicated offline-returns worker. Offline support is the frontend IndexedDB queue path.

Practical meaning: the master reference's Known Gaps section is correct, but the Capability Matrix wording "offline_returns worker" should be corrected. Offline returns are UI/queue behavior, not a backend worker capability.

Evidence:
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [offlineQueue.js](../frontend/src/utils/offlineQueue.js)
- [useOfflineQueue.js](../frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js)
- [POSReturnExchangeModal.jsx](../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx)
- [backend/workers/](../backend/workers/)

### 9. FBR flag seeding is still special-case

The master reference says `fbr_integration` is not in `DEFAULT_FEATURE_FLAGS`, and code confirms it. FBR settings/status endpoints exist before the flag gate so setup can configure the integration, while invoice/dashboard endpoints are behind `requireFeature("fbr_integration")`.

Practical meaning: this is intentional enough to launch, but documentation should keep calling it a seeding inconsistency and not treat it like normal default flags.

Evidence:
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [fbr.js](../backend/routes/fbr.js)
- [schema-pg.sql](../backend/schema-pg.sql)
- [migrate-pg.js](../backend/migrate-pg.js)

### 10. Route-level React gates are usually weaker than nav/backend gates

This pattern appears across many flagged pages. `nav-config.js` hides items by feature flag, and backend routes enforce important flags, but `appRoutes.jsx` usually gates only auth/permission.

Examples:

- `/gift-cards` route is permission-only, but nav and the page itself check `phase2g_gift_cards`, and backend gift-card APIs enforce the flag.
- `/customer-groups/:groupId/price-book` route is permission-only, but the page checks `phase2g_price_books`, and backend price-book routes enforce the flag.
- `/inventory-intelligence` route is permission-only, but nav and backend enforce `phase2g_inventory_intelligence`.

Practical meaning: this is acceptable if intentional, but direct URLs can still render page shells/disabled states. Backend remains the source of enforcement.

Evidence:
- [appRoutes.jsx](../frontend/src/routes/appRoutes.jsx)
- [nav-config.js](../frontend/src/ui/nav-config.js)
- [GiftCardsAdminRedesign.jsx](../frontend/src/pages/redesign/GiftCardsAdminRedesign.jsx)
- [CustomerGroupPriceBookRedesign.jsx](../frontend/src/pages/redesign/CustomerGroupPriceBookRedesign.jsx)

## Confirmed Accurate

These master-reference claims held up against live code:

- Retail setup is locked to `general_retail` in the setup UI, with other tiles marked coming soon.
- `routes/setup.js` seeds the 19 retail launch flags only when `industry_type === "general_retail"`.
- Free plan defaults are 1 outlet, 3 employees, 100 products.
- Billing usage endpoint and frontend banner exist.
- Add-outlet purchase flow exists and multi-outlet flags seed when the tenant creates a second outlet.
- POS core, returns, parked sales, holds, shifts, POS layouts, POS devices, and customer display are mounted.
- Catalog, pricing, inventory, purchasing, customers, reports, storefront, public receipt, public gift-card lookup, billing, support, employees, attendance, and integrations all have live code surfaces.
- Shopify is connection-based rather than feature-flag-based.
- Worker registration is centralized in `backend/boot/workers.js`.
- Schema table count, migration marker, test counts, default feature flag count, and worker count match the master reference.

Verified counts:

| Surface | Current count | Evidence |
|---|---:|---|
| `*Redesign.jsx` pages | 97 | `frontend/src/pages/redesign/*Redesign.jsx` |
| Top-level backend route files, excluding `registerAllRoutes.js` | 88 | `backend/routes/*.js` |
| Top-level backend route files, including `registerAllRoutes.js` | 89 | `backend/routes/*.js` |
| Worker `*-boss.js` files | 18 | `backend/workers/*-boss.js` |
| Backend integration test files | 122 | `backend/tests/integration/*.test.js` |
| Frontend spec/test files | 68 | `frontend/tests/**/*.{spec,test}.js(x)` |
| Default feature flags | 84 | `DEFAULT_FEATURE_FLAGS` |
| Schema tables | 271 | `CREATE TABLE` in `schema-pg.sql` |
| Current migration marker | v78 | `backend/migrate-pg.js` |

## Coverage Ledger

| Area | Backend evidence | Frontend evidence | Nav/public evidence | Verdict |
|---|---|---|---|---|
| Retail presets/setup | `industry-config.js`, `setup.js`, `retail-flag-preset.js` | `SetupWizard.jsx` | setup public route | Accurate |
| Signup/email verification | `auth.js` | `SignupPage.jsx`, `VerifyEmail.jsx` | public routes | Accurate |
| Plan caps/free forever | `plan-limits.js`, `auth.js`, `billing.js` | `BillingRedesign.jsx`, `PlanUsageBanner.jsx` | billing nav | Accurate |
| Add outlet | `billing.js`, `webhooks.js`, `outlets.js` | `OutletsRedesign.jsx` | Outlets nav | Accurate |
| POS sale | `sales.js` | `POSRedesign.jsx`, POS context/hooks | `/pos` public route plus POS nav | Accurate |
| Returns | `returns.js`, `return-policies.js` | returns pages and POS return modal | Returns nav | Accurate |
| Receipt barcode lookup | `sales.js` | `POSReturnExchangeModal.jsx` | POS-only | Real, but flag not enforced |
| Parked sales | `parked-sales.js` | `ParkedSalesRedesign.jsx`, POS modal | Parked Sales nav | Accurate |
| Holds/layaway | `holds.js`, hold worker | `HoldsRedesign.jsx`, POS hold modals | Holds nav gated | Accurate |
| POS approvals | `approval-policies.js` | POS approval/override modals | backend/POS-only | Real, flagged |
| Serialized inventory | `product-serials.js`, `barcode-expenses.js`, `sales.js`, `returns.js` | POS serial modal, inventory serial modal, GRN receive | POS/inventory embedded | Real, but gating mismatch |
| Draft orders | `draft-orders.js` | POS context, ParkedSales page | embedded | Accurate |
| Item suggestions | `item-suggestions.js` | POS cart hook | embedded | Accurate |
| POS layouts/devices | `pos-layouts.js`, `pos-devices.js` | `POSLayoutsRedesign.jsx`, POS device registration | settings nav | Accurate |
| Catalog/products | `products.js` | inventory/product pages | Products nav | Accurate |
| Categories/brands/attributes | route files | redesign pages | Inventory nav | Accurate |
| Promotions/smart collections/scheduled changes | route files plus catalog scheduler | redesign pages | gated nav where applicable | Accurate |
| Price lists/books/outlet pricing | route files | price-list and customer-group price-book pages | mixed nav/direct route | Accurate, with direct-route caveat |
| Review moderation | `products.js` review endpoints | `ReviewModerationRedesign.jsx` | Inventory nav | Accurate |
| Stock ops | `inventory.js` | stock count, adjustment, transfer, reorder pages | Stock Control nav | Accurate |
| Inventory intelligence | `inventory-intelligence.js`, `abc-worker-boss.js` | `InventoryIntelligenceRedesign.jsx` tabs | gated nav | Accurate, still partial by tab depth |
| Purchasing/suppliers/GRN | route files | PO/supplier/payables pages | Stock/Procurement nav | Accurate |
| Customers/groups | `customers.js` | customer/group pages | Commerce nav | Accurate |
| Loyalty | `customers.js`, `loyalty.js`, `sales.js` | loyalty tier page, customer/POS loyalty reads | Loyalty nav | Real, but tiers not flag-gated |
| Gift cards | `gift-cards.js`, public gift-card route, `sales.js` | admin page, public page, POS tender | gated nav plus public route | Accurate |
| CRM/quotations/invoices | tier4 CRM, customer invoices | pages | gated nav | Accurate |
| Payment links | `customer-invoices.js` | invoice page button checks flag | hidden unless flag on | Accurate |
| Marketing/messaging | `marketing.js`, `messaging.js` | campaign/inbox pages | gated nav | Accurate |
| Dashboard/reports | `insights.js`, reports route tree | dashboard and reports pages | Reports nav and deep links | Accurate |
| AI insights | `insights-ai.js` soft DB check | dashboard AI panel checks `flags.ai_insights` | dashboard embedded | Partial/experimental |
| Receipt templates/public receipt | `receipt-templates.js`, `receipts.js` | receipt template/public receipt pages | settings nav/public route | Accurate |
| Barcode templates | `barcode-expenses.js` | barcode template page | settings nav | Real, but label flag not enforced |
| Printer/customer display/kiosk | `printer.js`, `customer-display.js`, `attendance.js` | pages/POS hooks | public/special routes | Accurate |
| Storefront | `storefront.js` | storefront pages | public `/store/:tenantSlug` and nav placeholder | Accurate |
| Customer portal | customer-portal routes | portal pages | public `/portal/:tenantSlug` | Accurate, retail tab subset only |
| Shopify | shopify route folder | Shopify page via integration hub | hub link/direct route | Accurate |
| WooCommerce | `woocommerce.js` | WooCommerce page via integration hub | hub link/direct route | Accurate |
| Marketplace hub | integrations routes/services | integration hub | Integrations nav | Manual routes accurate; worker partial |
| Couriers/fulfillment/COD | `couriers.js`, `fulfillment.js` | courier/fulfillment/COD pages | nav gated where applicable | Accurate |
| Payment gateways | gateway service/webhooks | billing/invoices/storefront/POS usage | connection/env based | Real, but flag not enforced |
| FBR/tax/e-invoicing | `fbr.js`, tax routes, export route | FBR/tax pages | compliance nav | Accurate, special flag seeding |
| Support/admin | support/admin route trees | support/admin pages | merchant/admin nav | Accurate |
| Workforce/accounting/backup/import | route files | pages | nav gated by perm/flag | Accurate |
| Workers | `boot/workers.js`, worker files | none | env vars | Accurate except marketplace stub/offline worker wording |

## Retail Code Possibly Missing From Reference

These are code surfaces that are retail-relevant or retail-adjacent and should be considered when refreshing the master reference:

- `phase2g_label_designer` and `phase2g_receipt_barcode_lookup` are currently flag records without runtime gates. The reference should either remove the "flagged" claim or a future code change should enforce the flags.
- `phase5_payment_gateways` is a flag record without runtime gates. Payment behavior is real but currently controlled by gateway configuration and code paths, not the flag.
- `BackupStatusCard.jsx` reads `/api/backup-status`, which is backed by `barcode-expenses.js`; this is dashboard-visible operational status, not just the Backup/Restore page.
- Shopify and WooCommerce direct routes are reachable via the integrations hub, not direct sidebar entries. That is fine, but the reference should describe them as hub-linked/direct routes rather than primary nav items.

## Intentional Exclusions

The following live surfaces were inspected and should remain outside retail-only launch claims unless explicitly sold later:

- Restaurant POS, floor, checks, 86-list, KDS, reservations, waitlist, modifiers, pay-at-table, restaurant inbox, and tip pools.
- Appointment booking/services/calendar routes.
- Projects, contracts, service tickets, rentals, rooms, and treatment plans.
- Non-retail customer portal tabs: appointments, treatments, stays, and other vertical-specific pages.
- Public booking, public restaurant menu, reservation booking, and pay-at-table pages.

These are real code surfaces but are mode-gated or vertical-specific, not baseline retail.

## Recommended Follow-up Fixes

Documentation-only updates:

- Refresh the `*Redesign.jsx` count from 99 to 97, or document the exact counting rule if wrappers are included.
- Change Label Designer and Receipt Barcode Lookup wording from "Flagged" to "real surface / no runtime flag gate" unless gates are added.
- Change Payment Gateways wording from `phase5_payment_gateways`-gated to connection/env-based.
- Split loyalty into "loyalty tiers/config" and "loyalty ledger/adjustment/POS loyalty behavior".
- Correct the Capability Matrix row that implies an `offline_returns` worker exists.

Code follow-up candidates:

- Add runtime gates for `phase2g_label_designer`, `phase2g_receipt_barcode_lookup`, and `phase5_payment_gateways`, or remove/retire those flags.
- Add consistent `phase2g_serialized_inventory` backend enforcement to serial-management endpoints if the feature should truly be gated.
- Add `requiredFlag: "phase2g_loyalty"` to the Loyalty Tiers nav and route/page behavior if loyalty tiers should be hidden when loyalty is off.
- Implement real marketplace worker polling calls or keep marketplace sync documented as manual-only.

## Verification Notes

This was a static source audit, not a live execution test.

Commands used were read-only searches/counts such as `rg`, `Get-Content`, `Get-ChildItem`, and `Select-String`. No tests, migrations, formatters, code generators, or product-code edits were run.

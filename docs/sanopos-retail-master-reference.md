# SanoPOS Retail Master Reference — 2026-04-24

This is the **single day-to-day retail reference** for the repo.

If you want one file that answers "what have I actually built for retail?", start here.

The older retail docs have been archived under:
- [docs/archive/retail-reference/sanopos-retail-surface-map.md](archive/retail-reference/sanopos-retail-surface-map.md)
- [docs/archive/retail-reference/sanopos-retail-capability-matrix.md](archive/retail-reference/sanopos-retail-capability-matrix.md)
- [docs/archive/retail-reference/audits/sanopos-retail-gap-audit-2026-04-23.md](archive/retail-reference/audits/sanopos-retail-gap-audit-2026-04-23.md)
- [docs/archive/retail-reference/audits/sanopos-retail-completeness-check-2026-04-23.md](archive/retail-reference/audits/sanopos-retail-completeness-check-2026-04-23.md)

The prior 2026-04-23 version of this file is preserved at [docs/archive/retail-reference/sanopos-retail-master-reference-2026-04-23.md](archive/retail-reference/sanopos-retail-master-reference-2026-04-23.md).

> **Re-audit note (2026-04-24, refreshed 2026-04-25):** This file was fully rewritten on 2026-04-24 against live source files (every backend route, every `*Redesign.jsx` page, every worker, every feature flag). CLAUDE.md docs in the repo were treated as stale and NOT used as authority. The 2026-04-25 refresh folded in the retail launch (PRs 1–9, merged 2026-04-24/25), corrected stale Known Gaps, and added an env-var column to the Workers table. Spot-check any claim against the cited paths before acting on it.

## What Counts As Retail Here

**In scope**
- The 6 retail presets: `general_retail`, `grocery`, `wholesale`, `butcher`, `sweet_shop`, `textile`
- Retail core: POS, returns, pricing, inventory, customers, reports, omnichannel, hardware, compliance
- Retail-adjacent merchant operations: billing, notifications, support, workforce/scheduling, portal, and admin/support breadth where it materially affects retail tenants
- Public/customer-facing retail surfaces: storefront, public receipts, gift-card balance lookup, customer-display, kiosk, retail-relevant portal tabs

**Out of retail claims**
- Restaurant mode and restaurant POS/KDS/floor/check/reservation flows
- Appointment-first verticals
- Rentals, rooms, treatment plans, service tickets, projects/contracts
- Non-retail portal tabs such as appointments, subscriptions, contracts, stays, treatments, and tickets

## Headline Snapshot

Verified directly from live source files on 2026-04-24:

| Surface | Count |
|---|---:|
| Retail presets | 6 |
| Total industry presets | ~22 |
| `*Redesign.jsx` pages | 99 (total — includes non-retail like restaurant, KDS, rentals, treatments) |
| Top-level backend route files | 89 |
| Worker `-boss.js` files | 18 |
| Backend integration test files | 122 |
| Frontend `*.spec.js` / `*.test.js(x)` | 68 |
| Default feature flags | 84 |
| Schema tables (CREATE TABLE in schema-pg.sql) | 271 |
| Current migration marker | v78 |
| Courier adapter files | 16 (base + generic + 13 named adapters + index) |
| Shopify integration files | 10 |
| Integrations hub files | 8 |
| Marketplace client files | 5 (base + daraz + meta-commerce + whatsapp + google-merchant) |
| Customer portal backend files | 6 |
| Admin (super-admin) backend files | 11 |
| Tier 4 backend files | 8 |
| Report backend files | 18 |

## Retail launch (PRs 1–9, merged 2026-04-24/25)

The 2026-04-24 retail launch shipped 9 code PRs + 1 infra PR ([retail-launch-build-plan.md](retail-launch-build-plan.md)). The plan locked the Free-forever pricing model, narrowed signup to `general_retail` only, and added the 19-flag retail seed. Surfaces that landed:

| PR | What it shipped | Key files |
|---|---|---|
| PR 0 | Railway env vars: 6 retail workers + `INTEGRATION_SECRET_KEY` + `SHOPIFY_SECRET_KEY` placeholder + optional `ADMIN_ALLOWED_IPS` | (infra-only, no code) |
| PR 1 | Free-forever lifecycle. `plan = 'free'` is permanent (`payment_status='active'`, `trial_ends_at=null`). `requireActiveSubscription` early-returns for free. `subscription-grace-worker-boss` skips free tenants. SubscriptionBanner returns `null` for free. Free `max_products` default lowered to 100. | [routes/auth.js](../backend/routes/auth.js), [middleware/plan-limits.js](../backend/middleware/plan-limits.js), [workers/subscription-grace-worker-boss.js](../backend/workers/subscription-grace-worker-boss.js), [ui/SubscriptionBanner.jsx](../frontend/src/ui/SubscriptionBanner.jsx) |
| PR 2 | 19-flag retail seed (only for `general_retail`). Setup wizard tile gating: 21 of 22 industry tiles disabled with "Coming soon" badge. FBR settings save flips `fbr_integration` ON when valid NTN+token+province present. | [services/retail-flag-preset.js](../backend/services/retail-flag-preset.js), [routes/setup.js](../backend/routes/setup.js), [routes/fbr.js](../backend/routes/fbr.js), [SetupWizard.jsx](../frontend/src/pages/SetupWizard.jsx) |
| PR 3 | Cap-hit UX. New `GET /api/billing/usage` returns `{ employees, products, outlets } × { used, limit }`. Global 403 interceptor opens upgrade modal. Soft amber banner at ≥80% usage. | [routes/billing.js](../backend/routes/billing.js), [components/PlanLimitModalInterceptor.jsx](../frontend/src/components/PlanLimitModalInterceptor.jsx), [pages/dashboard/PlanUsageBanner.jsx](../frontend/src/pages/dashboard/PlanUsageBanner.jsx) |
| PR 4 | Free→Pro upgrade card on `/billing` with monthly (8000 PKR) / annual (80000 PKR, 17% off) toggle. Routes through existing `POST /api/billing/create-checkout` to xPay. | [BillingRedesign.jsx](../frontend/src/pages/redesign/BillingRedesign.jsx) |
| PR 5 | Add-outlet flow. `POST /api/billing/add-outlet` creates a payment intent; webhook bumps `tenants.max_outlets`. On 2nd outlet creation, 5 multi-outlet flags auto-flip ON: `context_selection_required`, `context_header_enforced`, `phase2_outlet_pricing`, `phase2_outlet_visibility`, `phase2g_price_books`. `kiosk_context_locked` stays OFF (merchant opt-in). `multi_outlet_flags_seeded` column on `company_profile` prevents re-seeding. | [routes/billing.js](../backend/routes/billing.js), [routes/webhooks.js](../backend/routes/webhooks.js), [routes/outlets.js](../backend/routes/outlets.js), [OutletsRedesign.jsx](../frontend/src/pages/redesign/OutletsRedesign.jsx), [ui/MultiOutletEnabledBanner.jsx](../frontend/src/ui/MultiOutletEnabledBanner.jsx) |
| PR 6 | Auto-login after setup wizard. `/api/setup/complete` returns access + refresh tokens; SetupWizard navigates to `/dashboard` directly, no re-login. | [routes/setup.js](../backend/routes/setup.js), [SetupWizard.jsx](../frontend/src/pages/SetupWizard.jsx) |
| PR 7 | Onboarding checklist extended to 7 steps (added `customer` and `receipt`). Test-print writes `company_profile.test_receipt_printed_at`. FBR prompt banner for PK tenants on dashboard with two CTAs ("Set up FBR" / "Not required"). New column `company_profile.fbr_banner_dismissed` + `PUT /api/company-profile/fbr-banner-dismiss`. | [config/industry-config.js](../backend/config/industry-config.js), [routes/printer.js](../backend/routes/printer.js), [ui/FBRPromptBanner.jsx](../frontend/src/ui/FBRPromptBanner.jsx), [DashboardOnboarding.jsx](../frontend/src/pages/dashboard/DashboardOnboarding.jsx) |
| PR 8 | Email verification before account activation. New columns `email_verified_at`, `email_verification_token`. Setup blocked until verified. New page `VerifyEmail.jsx` at `/verify-email?token=X`. SignupPage shows "Check your email" screen on submit instead of redirecting to setup. | [routes/auth.js](../backend/routes/auth.js), [pages/VerifyEmail.jsx](../frontend/src/pages/VerifyEmail.jsx), [pages/SignupPage.jsx](../frontend/src/pages/SignupPage.jsx) |
| PR 9 | Pre-public-launch hygiene. New public pages [Terms.jsx](../frontend/src/pages/public/Terms.jsx) and [Privacy.jsx](../frontend/src/pages/public/Privacy.jsx). TOS checkbox + Cloudflare Turnstile widget on SignupPage. Backend Turnstile siteverify in `routes/auth.js` signup. New rate-limited `POST /api/auth/resend-setup-link`. Env vars `TURNSTILE_SECRET_KEY` (backend) + `VITE_TURNSTILE_SITE_KEY` (frontend). | [routes/auth.js](../backend/routes/auth.js), [SignupPage.jsx](../frontend/src/pages/SignupPage.jsx), [SetupWizard.jsx](../frontend/src/pages/SetupWizard.jsx) |

**Plan model after launch**: Free is permanent, capped (3 emp / 100 prod / 1 outlet). Pro is 8000 PKR/mo or 80000 PKR/yr **per outlet** (1 outlet default; pay-per-outlet for additional). Feature access is identical between Free and Pro — plan only gates resource caps.

**Flags that intentionally stay OFF (not in the 19-flag seed)**: `phase2g_serialized_inventory`, `phase2_commissions`, `phase5_payment_gateways`, `shift_auto_close`, `offline_returns`, `payment_links`, `fbr_integration`. Each is merchant opt-in or pending external prerequisites.

## Presets

| Preset | Business model | POS layout | Notes |
|---|---|---|---|
| `general_retail` | `buy_sell` | `grid` | Baseline retail |
| `grocery` | `buy_sell` | `grid` | Barcode-heavy, stock-heavy |
| `wholesale` | `b2b_distribution` | `grid` | Invoicing / B2B weighted |
| `butcher` | `buy_sell` | `list` | Weight / tare sensitive |
| `sweet_shop` | `buy_sell` | `grid` | Weight plus packaged goods |
| `textile` | `buy_sell` | `grid` | Unit / measurement sensitive |

Shared retail defaults (from `backend/config/industry-config.js`):
- Dashboard widgets enable `inventory_alerts`, `top_products`, `trends`, `attendance`
- Non-retail widgets like `floor_plan` and `appointments_today` are off
- Retail labels remain product / customer / sale centric
- Portal tabs: `[invoices, orders, loyalty, profile]` for `general_retail`, `grocery`, `sweet_shop`; `[invoices, orders, profile]` (no loyalty) for `wholesale`, `butcher`, `textile`

**Important — preset launch state**: all 6 retail presets ship with `modes: []`. After the 2026-04-24 retail launch, `routes/setup.js` now calls `seedRetailFlags(client)` from [services/retail-flag-preset.js](../backend/services/retail-flag-preset.js) — but **only when `industry_type === 'general_retail'`**. The 19-flag seed (8 polish + 7 opt-in + 4 integrations) does NOT fire for the other 5 retail presets. As a result:

- `general_retail`: 19 retail flags seeded ON at signup
- `grocery`, `wholesale`, `butcher`, `sweet_shop`, `textile`: zero retail flags seeded — admin must flip each one manually per tenant via the admin feature-flags UI

At launch, only `general_retail` is clickable in the setup wizard; the other 21 industry tiles (including the 5 sister retail presets) are marked "Coming soon" and disabled. So the unseeded-presets gap is theoretical for new merchants, but real for any tenant created via admin/API bypass.

## What You Built

Each section lists the shipped surfaces with their concrete file paths, feature-flag gate (if any), and maturity label.

### 1. POS and checkout

**Frontend shell**
- [POSRedesign.jsx](../frontend/src/pages/redesign/POSRedesign.jsx) with [pos/POSContext.jsx](../frontend/src/pages/redesign/pos/POSContext.jsx) and ~60 POS modal/component files under `frontend/src/pages/redesign/pos/`
- [POSShortcutsOverlay.jsx](../frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx) — F-key help
- [ParkedSalesRedesign.jsx](../frontend/src/pages/redesign/ParkedSalesRedesign.jsx) — parked cart management
- [HoldsRedesign.jsx](../frontend/src/pages/redesign/HoldsRedesign.jsx) — layaway / cart holds
- [CashManagementRedesign.jsx](../frontend/src/pages/redesign/CashManagementRedesign.jsx)

**Backend routes**
- [sales.js](../backend/routes/sales.js) — core POS sale endpoint with FOR UPDATE stock lock
- [returns.js](../backend/routes/returns.js) — gated by `phase2_returns_policy`
- [return-policies.js](../backend/routes/return-policies.js) — gated by `phase2_returns_policy`
- [parked-sales.js](../backend/routes/parked-sales.js) — `pos_park` perm
- [holds.js](../backend/routes/holds.js) — gated by `phase2g_holds` (Flagged)
- [shifts.js](../backend/routes/shifts.js)
- [override-reasons.js](../backend/routes/override-reasons.js) — gated by `phase2g_price_override` (Flagged)
- [approval-policies.js](../backend/routes/approval-policies.js) — gated by `phase2_pos_approvals` (Flagged)
- [draft-orders.js](../backend/routes/draft-orders.js) — gated by `phase2_draft_orders` (Flagged)
- [product-serials.js](../backend/routes/product-serials.js) — gated by `phase2g_serialized_inventory` (Flagged)
- [pos-devices.js](../backend/routes/pos-devices.js) — POS device registration / heartbeat
- [pos-layouts.js](../backend/routes/pos-layouts.js) — gated by `phase2_pos_layouts`
- [tips.js](../backend/routes/tips.js)
- [modifiers.js](../backend/routes/modifiers.js)
- [item-suggestions.js](../backend/routes/item-suggestions.js) — gated by `phase2_item_suggestions` (Flagged)
- [customer-display.js](../backend/routes/customer-display.js)

**Frontend-only POS flag gates** (client-side UI toggles, no backend requireFeature)
- `phase2g_omni_input` → [POSSearchArea.jsx](../frontend/src/pages/redesign/pos/POSSearchArea.jsx)
- `phase2g_variant_picker` → [POSVariantMatrixModal.jsx](../frontend/src/pages/redesign/pos/POSVariantMatrixModal.jsx)

**Offline continuity**
- [utils/offlineQueue.js](../frontend/src/utils/offlineQueue.js) — frontend queue layer (best-effort sync)
- `offline_returns` flag (default OFF) — flag exists in `DEFAULT_FEATURE_FLAGS`, but **there is no dedicated offline-returns worker**. The frontend queue is the only offline path today.

**Maturity**: core POS is **Shipped**. Holds, serials, price override, draft orders, approvals, item suggestions, and POS layouts are **Flagged** (real code, default OFF). Full offline-first is **Partial** — queue exists, not full autonomy.

### 2. Catalog, pricing, and merchandising

**Frontend**
- [InventoryRedesign.jsx](../frontend/src/pages/redesign/InventoryRedesign.jsx), [ProductFormPage.jsx](../frontend/src/pages/redesign/ProductFormPage.jsx)
- [CategoriesRedesign.jsx](../frontend/src/pages/redesign/CategoriesRedesign.jsx), [BrandsRedesign.jsx](../frontend/src/pages/redesign/BrandsRedesign.jsx)
- [AttributeSetsRedesign.jsx](../frontend/src/pages/redesign/AttributeSetsRedesign.jsx)
- [PromotionsRedesign.jsx](../frontend/src/pages/redesign/PromotionsRedesign.jsx)
- [SmartCollectionsRedesign.jsx](../frontend/src/pages/redesign/SmartCollectionsRedesign.jsx) — `phase2_smart_collections`
- [ScheduledChangesRedesign.jsx](../frontend/src/pages/redesign/ScheduledChangesRedesign.jsx) — `phase2_scheduled_changes`
- [PriceListsRedesign.jsx](../frontend/src/pages/redesign/PriceListsRedesign.jsx)
- [CustomerGroupPriceBookRedesign.jsx](../frontend/src/pages/redesign/CustomerGroupPriceBookRedesign.jsx) — `phase2g_price_books`
- [ReviewModerationRedesign.jsx](../frontend/src/pages/redesign/ReviewModerationRedesign.jsx)

**Backend routes**
- [products.js](../backend/routes/products.js) — core catalog (~1579 lines)
- [categories.js](../backend/routes/categories.js), [brands.js](../backend/routes/brands.js), [attribute-sets.js](../backend/routes/attribute-sets.js)
- [promotions.js](../backend/routes/promotions.js)
- [smart-collections.js](../backend/routes/smart-collections.js) — `phase2_smart_collections`
- [scheduled-changes.js](../backend/routes/scheduled-changes.js) — `phase2_scheduled_changes`
- [price-lists.js](../backend/routes/price-lists.js) — `manage_inventory` perm, no feature flag
- [price-books.js](../backend/routes/price-books.js) — `phase2g_price_books`
- [price-list-assignments.js](../backend/routes/price-list-assignments.js) — `phase2_outlet_pricing`
- [outlet-visibility.js](../backend/routes/outlet-visibility.js) — `phase2_outlet_visibility`

**Workers**
- [catalog-scheduler.js (service)](../backend/services/catalog-scheduler.js) + its `-boss` worker — applies scheduled price / availability changes at their fire time

**Maturity**: core catalog is **Shipped**. Price books, smart collections, scheduled changes are **Flagged**. Review moderation is **Shipped** (admin-only UI).

### 3. Inventory and purchasing

**Frontend**
- [StockAdjustmentsRedesign.jsx](../frontend/src/pages/redesign/StockAdjustmentsRedesign.jsx)
- [StockCountRedesign.jsx](../frontend/src/pages/redesign/StockCountRedesign.jsx)
- [TransfersRedesign.jsx](../frontend/src/pages/redesign/TransfersRedesign.jsx)
- [ReorderAlertsRedesign.jsx](../frontend/src/pages/redesign/ReorderAlertsRedesign.jsx)
- [InventoryIntelligenceRedesign.jsx](../frontend/src/pages/redesign/InventoryIntelligenceRedesign.jsx) with tabs: ABC, aging, cycle counts, reorder — `phase2g_inventory_intelligence`
- [PurchaseOrdersRedesign.jsx](../frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx)
- [SuppliersRedesign.jsx](../frontend/src/pages/redesign/SuppliersRedesign.jsx)
- [SupplierPayablesRedesign.jsx](../frontend/src/pages/redesign/SupplierPayablesRedesign.jsx) — `supplier_payables`
- [ApprovalsRedesign.jsx](../frontend/src/pages/redesign/ApprovalsRedesign.jsx) — `approvals`
- [ReturnedStockRedesign.jsx](../frontend/src/pages/redesign/ReturnedStockRedesign.jsx)

**Backend routes**
- [inventory.js](../backend/routes/inventory.js) — stock, transfers, adjustments, counts, reservations (5-min expiry)
- [inventory-intelligence.js](../backend/routes/inventory-intelligence.js) — `phase2g_inventory_intelligence`
- [purchase-orders.js](../backend/routes/purchase-orders.js)
- [suppliers.js](../backend/routes/suppliers.js)
- [grn.js](../backend/routes/grn.js) — includes `supplier_payables` gated endpoints
- [supplier-returns.js](../backend/routes/supplier-returns.js)

**Workers**
- [abc-worker-boss.js](../backend/workers/abc-worker-boss.js) — ABC classification
- [hold-expiry-worker-boss.js](../backend/workers/hold-expiry-worker-boss.js) — expires stale holds (gated by `phase2g_holds`)
- [reservation-worker-boss.js](../backend/workers/reservation-worker-boss.js) — inventory reservation expiry

**Maturity**: stock + purchasing core is **Shipped**. Inventory intelligence tabs are **Flagged**; each sub-view (ABC / aging / cycle counts / reorder) ships with the single flag above.

### 4. Customers, loyalty, gift cards, and B2B follow-through

**Frontend**
- [CustomersRedesign.jsx](../frontend/src/pages/redesign/CustomersRedesign.jsx)
- [CustomerGroupsRedesign.jsx](../frontend/src/pages/redesign/CustomerGroupsRedesign.jsx)
- [CRMRedesign.jsx](../frontend/src/pages/redesign/CRMRedesign.jsx) — `crm_quotations`
- [QuotationsRedesign.jsx](../frontend/src/pages/redesign/QuotationsRedesign.jsx) — `crm_quotations`
- [CustomerInvoicesRedesign.jsx](../frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx) — `customer_invoicing`
- [LoyaltyTiersRedesign.jsx](../frontend/src/pages/redesign/LoyaltyTiersRedesign.jsx) — `phase2g_loyalty`
- [GiftCardsAdminRedesign.jsx](../frontend/src/pages/redesign/GiftCardsAdminRedesign.jsx) — `phase2g_gift_cards`
- [MessagingInboxRedesign.jsx](../frontend/src/pages/redesign/MessagingInboxRedesign.jsx) — `customer_messaging`

**Backend routes**
- [customers.js](../backend/routes/customers.js) — includes wallet ledger + loyalty tier logic
- [customer-invoices.js](../backend/routes/customer-invoices.js) — `customer_invoicing` (also reads `payment_links`)
- [loyalty.js](../backend/routes/loyalty.js) — `phase2g_loyalty`
- [gift-cards.js](../backend/routes/gift-cards.js) — admin endpoints, `phase2g_gift_cards`, `manage_gift_cards` perm
- [gift-cards-public.js](../backend/routes/gift-cards-public.js) — public balance lookup (no auth)
- [tier4/crm.js](../backend/routes/tier4/crm.js) — `crm_quotations`
- [messaging.js](../backend/routes/messaging.js) — `customer_messaging`

**Maturity**: customer master is **Shipped**. Loyalty tiers, gift cards, price books, quotations, customer invoicing are all **Flagged**. Quote-to-invoice works but is **SMB B2B follow-through**, not full AR automation.

### 5. Reporting and insights

**Frontend**
- [ReportsRedesign.jsx](../frontend/src/pages/redesign/ReportsRedesign.jsx) — report hub
- `frontend/src/pages/reports/` — 20+ tab components (sales core/detail/overview, inventory health, finance, operations, governance, exceptions, FBR export, commissions, etc.)
- [ReportBuilderRedesign.jsx](../frontend/src/pages/redesign/ReportBuilderRedesign.jsx) — `phase2_report_builder`
- [DashboardRedesign.jsx](../frontend/src/pages/redesign/DashboardRedesign.jsx) + 20+ widgets under `frontend/src/pages/dashboard/` (KPI, cash, trends, inventory alerts, AIChatPanel, BackupStatusCard)
- [RetailRiskRedesign.jsx](../frontend/src/pages/redesign/RetailRiskRedesign.jsx) — `phase2g_risk_controls`
- [AIChatPanel.jsx](../frontend/src/pages/dashboard/AIChatPanel.jsx) — dashboard widget only (no standalone page); `ai_insights` soft DB check

**Backend routes**
- `backend/routes/reports/` — 18 report files including analytics.js, sales.js, inventory.js, finance.js, governance.js, exceptions.js, fbr-export.js, commissions.js
- [report-builder.js](../backend/routes/report-builder.js) — `phase2_report_builder`
- [insights.js](../backend/routes/insights.js) — 5 pre-built analytics cards
- [insights-ai.js](../backend/routes/insights-ai.js) — `ai_insights` (soft DB check, not a `requireFeature`)
- [risk-controls.js](../backend/routes/risk-controls.js) — `phase2g_risk_controls`

**Workers**
- [retail-digest-worker-boss.js](../backend/workers/retail-digest-worker-boss.js) — weekly (Mon 08:00 UTC) retail digest email, gated by `retail_weekly_digest` (default OFF)
- [anomaly-worker-boss.js](../backend/workers/anomaly-worker-boss.js) — shrink / fraud scoring for risk controls

**Feature-flagged reports sub-features**
- `reports_enhanced_filters`, `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions`, `reports_scheduled_exports`

**Maturity**: dashboard + core reports are **Shipped**. Report builder and the 5 `reports_*` enhancement flags are **Flagged**. AI insights is **Partial** — soft DB gate, real but experimental.

### 6. Hardware, receipts, kiosk, and public retail surfaces

**Frontend**
- [ReceiptTemplatesRedesign.jsx](../frontend/src/pages/redesign/ReceiptTemplatesRedesign.jsx)
- [PrinterSettingsRedesign.jsx](../frontend/src/pages/redesign/PrinterSettingsRedesign.jsx)
- [BarcodeTemplatesRedesign.jsx](../frontend/src/pages/redesign/BarcodeTemplatesRedesign.jsx)
- [KioskRedesign.jsx](../frontend/src/pages/redesign/KioskRedesign.jsx) — employee clock-in kiosk
- [KioskOrderingRedesign.jsx](../frontend/src/pages/redesign/KioskOrderingRedesign.jsx) — self-serve ordering
- [CustomerDisplayPage](../frontend/src/pages/) — customer-facing live display
- Public pages:
  - [ReceiptPublicPage.jsx](../frontend/src/pages/ReceiptPublicPage.jsx) — `/receipt/:invoiceNumber`, no auth
  - [GiftCardBalancePage.jsx](../frontend/src/pages/) — `/gift-card/:code`, no auth
  - `frontend/src/pages/storefront/` — full storefront (StorefrontLayout, Home, Products, ProductDetail, Cart, Checkout, OrderStatus)

**Backend routes**
- [receipts.js](../backend/routes/receipts.js) — public receipt endpoint (mounted before tenant middleware)
- [receipt-templates.js](../backend/routes/receipt-templates.js)
- [printer.js](../backend/routes/printer.js) — thermal + network TCP/IP
- [barcode-expenses.js](../backend/routes/barcode-expenses.js) — gated by `phase2g_receipt_barcode_lookup`, `phase2g_label_designer`, `backup_restore`, `e_invoicing_export`
- [customer-display.js](../backend/routes/customer-display.js)
- [storefront.js](../backend/routes/storefront.js) — public
- [gift-cards-public.js](../backend/routes/gift-cards-public.js) — public balance lookup
- [pos-devices.js](../backend/routes/pos-devices.js)

**Services**
- [services/printer.js](../backend/services/printer.js) — ESC/POS + TCP printing, renders FBR QR when `fbr_qr_code` present
- [utils/receipt.js](../frontend/src/utils/receipt.js) — single source for receipt sections / HTML

**Public retail surfaces (the 6)**
1. `/store/:slug` — storefront
2. `/receipt/:invoiceNumber` — shareable public receipt
3. `/gift-card/:code` — public gift card balance lookup
4. `/portal/:slug` — customer self-service portal (separate auth)
5. `/kiosk` — self-serve kiosk (employee clock-in and kiosk ordering)
6. `/customer-display` — customer-facing display at POS terminal

**Maturity**: all 6 public surfaces are **Shipped**. `receipt_designer_v2` is the default-ON v2 renderer (v1 EOL). Receipt barcode lookup and label designer are **Flagged**.

### 7. Omnichannel, marketplace, shipping, and compliance

**Frontend**
- [OrdersRedesign.jsx](../frontend/src/pages/redesign/OrdersRedesign.jsx)
- [FulfillmentRedesign.jsx](../frontend/src/pages/redesign/FulfillmentRedesign.jsx) — `phase5_shipping_automation`
- [CODSettlementsRedesign.jsx](../frontend/src/pages/redesign/CODSettlementsRedesign.jsx) — `phase5_cod_reconciliation`
- [IntegrationsHubRedesign.jsx](../frontend/src/pages/redesign/IntegrationsHubRedesign.jsx) — `marketplace_integrations`
- [ShopifyIntegrationRedesign.jsx](../frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx)
- [WooCommerceIntegrationRedesign.jsx](../frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx)
- [CourierSettingsRedesign.jsx](../frontend/src/pages/redesign/CourierSettingsRedesign.jsx)
- [FBRSettingsRedesign.jsx](../frontend/src/pages/redesign/FBRSettingsRedesign.jsx)
- [FBRDashboardRedesign.jsx](../frontend/src/pages/redesign/FBRDashboardRedesign.jsx)
- [TaxLookupRedesign.jsx](../frontend/src/pages/redesign/TaxLookupRedesign.jsx)

**Backend routes**
- [orders.js](../backend/routes/orders.js)
- [fulfillment.js](../backend/routes/fulfillment.js) — `phase5_shipping_automation`, `phase5_cod_reconciliation`
- [couriers.js](../backend/routes/couriers.js)
- [integrations/](../backend/routes/integrations/) — 8 files (hub, credentials, daraz, facebook, whatsapp, google-merchant, index + helpers)
- [shopify/](../backend/routes/shopify/) — 10 files (config, health, import, index, mappings, orders, reconciliation, sync, webhooks + helpers)
- [woocommerce.js](../backend/routes/woocommerce.js)
- [fbr.js](../backend/routes/fbr.js) — `fbr_integration`
- [tax-lookup.js](../backend/routes/tax-lookup.js)
- [taxes.js](../backend/routes/taxes.js)
- [outlet-tax-profiles.js](../backend/routes/outlet-tax-profiles.js) — `phase2_outlet_tax`
- [webhooks.js](../backend/routes/webhooks.js) — payment gateway webhooks (no auth, signature-verified)
- [country-packs.js](../backend/routes/country-packs.js) — locale/currency config for signup

**Services**
- [services/marketplace/](../backend/services/marketplace/) — 6 files (base, daraz, meta-commerce, whatsapp, google-merchant, index)
- [services/couriers/](../backend/services/couriers/) — 16 files (base + generic + 14 adapters: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex, + index)
- [services/payment-gateway.js](../backend/services/payment-gateway.js) — xPay impl, extensible
- [services/fbr.js](../backend/services/fbr.js) — FBR API client + payload builders
- [services/crypto.js](../backend/services/crypto.js) — AES-256-GCM for integration credentials
- [shopify/crypto.js](../backend/shopify/crypto.js) — Shopify secret encryption + event logging

**Workers**
- [fbr-worker-boss.js](../backend/workers/fbr-worker-boss.js) — async FBR posting with exponential backoff (gated by `fbr_integration`)
- [marketplace-sync-worker-boss.js](../backend/workers/marketplace-sync-worker-boss.js) — Shopify / Daraz / FB / WhatsApp / Google Merchant poll, `MARKETPLACE_SYNC_WORKER_ENABLED=1`

**Maturity**: omnichannel core (orders, Shopify, WooCommerce, couriers) is **Shipped**. Phase 5 flags (shipping automation, COD reconciliation, payment gateways, SMS providers) are **Flagged** with **connection-based** dependencies (env vars + API credentials). FBR is **Shipped for PK tenants** who configure NTN / token. This is credible SMB omnichannel retail + Pakistan commerce depth — **not** enterprise OMS breadth or global tax coverage.

### 8. Retail-adjacent operations that still matter

**Billing + plan lifecycle**
- [BillingRedesign.jsx](../frontend/src/pages/redesign/BillingRedesign.jsx), [billing.js](../backend/routes/billing.js)
- Subscription lifecycle enforced by `middleware/plan-limits.js` (`requireActiveSubscription`, `requirePlanLimit`)
- [subscription-grace-worker-boss.js](../backend/workers/subscription-grace-worker-boss.js) — customer subscription grace transitions

**Notifications**
- [NotificationsRedesign.jsx](../frontend/src/pages/redesign/NotificationsRedesign.jsx) — `notifications`
- [tier4/notifications.js](../backend/routes/tier4/notifications.js)
- Low-stock notifications auto-created on sale via `notifyLowStockForSale` in [middleware/feature-flags.js](../backend/middleware/feature-flags.js)

**Support**
- [MyTicketsRedesign.jsx](../frontend/src/pages/redesign/MyTicketsRedesign.jsx), [support.js](../backend/routes/support.js)
- Floating SupportWidget on all authenticated pages ([ui/SupportWidget.jsx](../frontend/src/ui/SupportWidget.jsx))
- Screenshots uploaded to R2

**Workforce / scheduling / attendance / commissions / tip pools / expenses**
- [EmployeesRedesign.jsx](../frontend/src/pages/redesign/EmployeesRedesign.jsx), [AttendanceRedesign.jsx](../frontend/src/pages/redesign/AttendanceRedesign.jsx)
- [SchedulingRedesign.jsx](../frontend/src/pages/redesign/SchedulingRedesign.jsx) — `phase2_scheduling`
- [CommissionPlansRedesign.jsx](../frontend/src/pages/redesign/CommissionPlansRedesign.jsx) — `phase2_commissions` (also gated by `commissions` mode)
- [HRManagementRedesign.jsx](../frontend/src/pages/redesign/HRManagementRedesign.jsx) — `advanced_hr` (Pro tier)
- [ExpensesRedesign.jsx](../frontend/src/pages/redesign/ExpensesRedesign.jsx)
- Backend: [employees.js](../backend/routes/employees.js), [attendance.js](../backend/routes/attendance.js), [schedules.js](../backend/routes/schedules.js), [commissions.js](../backend/routes/commissions.js), [tips.js](../backend/routes/tips.js), [barcode-expenses.js](../backend/routes/barcode-expenses.js), [tier4/hr.js](../backend/routes/tier4/hr.js)

**Accounting (Pro tier)**
- [ChartOfAccountsRedesign.jsx](../frontend/src/pages/redesign/ChartOfAccountsRedesign.jsx), [JournalEntriesRedesign.jsx](../frontend/src/pages/redesign/JournalEntriesRedesign.jsx), [CreditDebitNotesRedesign.jsx](../frontend/src/pages/redesign/CreditDebitNotesRedesign.jsx), [PostdatedChequesRedesign.jsx](../frontend/src/pages/redesign/PostdatedChequesRedesign.jsx) — all gated by `accounting_core`
- [tier4/accounting.js](../backend/routes/tier4/accounting.js)

**Customer portal**
- [routes/customer-portal/](../backend/routes/customer-portal/) — 6 files (auth, data, payments, appointments, stays, treatments)
- [frontend/src/pages/portal/](../frontend/src/pages/portal/) — isolated auth via PortalAuthProvider
- Retail-relevant tabs per `PORTAL_ENABLED_TABS_BY_PRESET` in [industry-config.js](../backend/config/industry-config.js): invoices, orders, loyalty (where applicable), profile
- Invoices tab further gated by `customer_invoicing` flag ([data.js](../backend/routes/customer-portal/data.js) `TAB_FEATURE_FLAGS`)

**Super-admin oversight + support operations**
- `routes/admin/` — 11 files (auth, tenants, monitoring, billing, operations, compliance, messaging, system, helpers, notes, index)
- `frontend/src/pages/admin/` — AdminLogin, AdminLayout, AdminDashboard, AdminTenantList, AdminTenantDetail, AdminActivity, AdminEmails, AdminSupportTickets, AdminDeadLetters, AdminTaxRates, AdminStuckPayments
- Tenant feature-flag toggles exposed at `PUT /api/admin/tenants/:id/feature-flags` → UI in [AdminTenantDetail.jsx](../frontend/src/pages/admin/AdminTenantDetail.jsx)
- Admin activity + security logs in public schema
- Impersonation with amber banner
- Announcements, tenant notes, support ticket replies

**Marketing**
- [MarketingCampaignsRedesign.jsx](../frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx) — `marketing_campaigns`
- [marketing.js](../backend/routes/marketing.js) — runtime-reads `sms_campaigns` flag

**Setup + settings**
- [OutletsRedesign.jsx](../frontend/src/pages/redesign/OutletsRedesign.jsx)
- [CompanySettingsRedesign.jsx](../frontend/src/pages/redesign/CompanySettingsRedesign.jsx) — `multi_company`
- [BackupRestoreRedesign.jsx](../frontend/src/pages/redesign/BackupRestoreRedesign.jsx) — `backup_restore`
- [ImportRedesign.jsx](../frontend/src/pages/redesign/ImportRedesign.jsx), [ImportFromCompetitorRedesign.jsx](../frontend/src/pages/redesign/ImportFromCompetitorRedesign.jsx)

**Maturity**: billing, notifications, support, portal, and admin breadth are **Shipped**. Accounting, HR, multi-company are **Pro-tier gates** (Shipped but entitled). Marketing + messaging are **Flagged** (default ON but still rollout-gated).

## Workers that power retail

All 18 worker files live in `backend/workers/`. Breakdown:

**Retail-relevant (11)**

Workers have **two-layer gating**: the Railway env var must be set for the worker to start, AND the tenant feature flag must be ON for it to fire for that tenant. Flipping a flag in the admin UI does nothing if the env var is unset — the worker simply isn't running.

| Worker | Env var (must be `1`) | Tenant flag | Flag default | Purpose |
|---|---|---|---|---|
| [retail-digest-worker-boss.js](../backend/workers/retail-digest-worker-boss.js) | `RETAIL_DIGEST_WORKER_ENABLED` | `retail_weekly_digest` | OFF | Weekly retail digest email to owner (Mon 08:00 UTC) |
| [shift-auto-close-worker-boss.js](../backend/workers/shift-auto-close-worker-boss.js) | `SHIFT_AUTO_CLOSE_WORKER_ENABLED` | `shift_auto_close` | OFF | Auto-closes idle cash shifts (>36h) |
| [hold-expiry-worker-boss.js](../backend/workers/hold-expiry-worker-boss.js) | `HOLD_EXPIRY_WORKER_ENABLED` | `phase2g_holds` | OFF | Expires stale holds, frees inventory |
| [anomaly-worker-boss.js](../backend/workers/anomaly-worker-boss.js) | `ANOMALY_WORKER_ENABLED` | `phase2g_risk_controls` | OFF | Shrink / fraud anomaly scoring |
| [abc-worker-boss.js](../backend/workers/abc-worker-boss.js) | `ABC_WORKER_ENABLED` | `phase2g_inventory_intelligence` | OFF | ABC inventory classification |
| [reservation-worker-boss.js](../backend/workers/reservation-worker-boss.js) | `RESERVATION_WORKER_ENABLED` | — | ON | 5-min inventory reservation expiry |
| [fbr-worker-boss.js](../backend/workers/fbr-worker-boss.js) | `FBR_WORKER_ENABLED` | `fbr_integration` | OFF (seeded in migration) | FBR invoice posting, **fixed 60s retry, max 5 attempts** |
| [marketplace-sync-worker-boss.js](../backend/workers/marketplace-sync-worker-boss.js) | `MARKETPLACE_SYNC_WORKER_ENABLED` | `marketplace_integrations` | ON | Shopify / Daraz / FB / WhatsApp / Google Merchant poll — **see ⚠️ stub note below** |
| [email-worker-boss.js](../backend/workers/email-worker-boss.js) | `EMAIL_WORKER_ENABLED` | — | ON | Transactional email queue processor |
| [cleanup-worker-boss.js](../backend/workers/cleanup-worker-boss.js) | `CLEANUP_WORKER_ENABLED` | — | ON | Dead tenant cleanup (>7 days without setup) |
| [orphan-schema-scan-worker-boss.js](../backend/workers/orphan-schema-scan-worker-boss.js) | (always on) | — | ON | Ops hygiene — orphan schema detection |

**Catalog scheduling**: `phase2_scheduled_changes` (default ON) is also gated by `SCHEDULED_CATALOG_WORKER_ENABLED` env var via the [catalog-scheduler.js](../backend/services/catalog-scheduler.js) service. If the env var is unset, scheduled price/availability changes never fire even though the flag is ON.

**Encryption keys**: `INTEGRATION_SECRET_KEY` and `SHOPIFY_SECRET_KEY` env vars must be set for marketplace + courier credentials to be encrypted at rest. If unset, [services/crypto.js](../backend/services/crypto.js) falls back to plaintext storage (verified at line 26: `if (!key) return value;`). PR 0 of the retail launch set these — verify they remain set on Railway after any env wipe.

**⚠️ Marketplace-sync worker is a stub.** [marketplace-sync-worker-boss.js](../backend/workers/marketplace-sync-worker-boss.js) registers the cron jobs and logs "Polling Daraz orders" / "Checking Google Merchant feed status", but the actual `DarazClient.pullOrders()` / `MetaCommerceClient.pullOrders()` / `GoogleMerchantClient.checkFeedStatus()` calls are **commented out**. The cron fires but no orders are imported and no feeds checked. The marketplace UI works (manual operations via routes/integrations/* are real), but background sync is not implemented. Treat marketplace integrations as **Partial / manual-only** until the worker handlers are completed.

**⚠️ `requireActiveSubscription` async race.** [middleware/plan-limits.js:116](../backend/middleware/plan-limits.js) uses `masterDb.query(...).then(...).catch(() => next())` — the lookup runs but `next()` is called inside the `.then()` callback. `requirePlanLimit` and `requireActiveSubscription` therefore work correctly in practice (Express awaits the promise via the middleware chain). Documented as a quirk in [middleware/CLAUDE.md](../backend/middleware/CLAUDE.md) — be aware when modifying.

**Non-retail (7) — listed for completeness only**

`course-release-worker-boss.js`, `kds-load-snapshot-worker-boss.js`, `rental-overdue-worker-boss.js`, `room-overdue-checkout-worker-boss.js`, `subscription-grace-worker-boss.js`, `treatment-plan-worker-boss.js`, `reservation-reminder-worker-boss.js`. Each is gated on its respective mode / flag and never fires for retail-only tenants.

## Known gaps and quirks

These are real, verified in source, and worth keeping in your head when describing the product.

1. **Only `general_retail` gets the retail flag seed.** Fixed for `general_retail` by retail-launch PR 2 (2026-04-24): [services/retail-flag-preset.js](../backend/services/retail-flag-preset.js) exports `RETAIL_SEED_FLAGS` (19 flags), and `routes/setup.js` calls `seedRetailFlags(client)` inside the setup transaction when `industry_type === 'general_retail'`. The 5 other retail presets (`grocery`, `wholesale`, `butcher`, `sweet_shop`, `textile`) still ship with `modes: []` and no seed — they are scaffolded but unseeded. Cosmetically hidden behind the "Coming soon" wizard tile gate, but a tenant created via admin or API for one of these presets gets the bare-bones default-flag set.

2. **`fbr_integration` is NOT in `DEFAULT_FEATURE_FLAGS`.** All 84 other flags live in [middleware/feature-flags.js](../backend/middleware/feature-flags.js). `fbr_integration` is seeded only via [schema-pg.sql](../backend/schema-pg.sql) INSERT + a migration. Fresh tenants whose migrations haven't yet run may not see the flag until the seed completes. Not a crash, just a seeding inconsistency worth knowing.

3. **`phase2g_omni_input` and `phase2g_variant_picker` are frontend-only gates.** They have no `requireFeature()` call anywhere in backend routes; they gate only POS UI client-side. Not orphans — just single-layer gating. Fine for UI-only toggles, but don't rely on server-side enforcement.

4. **`ai_insights` is a soft DB check, not a `requireFeature`.** [insights-ai.js](../backend/routes/insights-ai.js) queries a row instead of using middleware. AI should still be described as **Partial / experimental**.

5. **`phase2g_per_line_restock` is a runtime-only flag with no dedicated surface.** Flag exists in `DEFAULT_FEATURE_FLAGS` (default OFF) but has neither a frontend page nor a dedicated backend route — it is checked inline inside `returns.js` to decide per-item restock behavior. Capability Matrix lists it for completeness; treat it as a behavior toggle, not a feature surface.

6. **No admin UI to toggle workers directly.** `retail_weekly_digest`, `shift_auto_close`, `offline_returns`, `phase2g_holds` (hold-expiry worker), `phase2g_risk_controls` (anomaly worker) — each has a worker but no dedicated admin control. Toggle happens through the generic feature-flags list in [AdminTenantDetail.jsx](../frontend/src/pages/admin/AdminTenantDetail.jsx).

7. **Inventory intelligence ships one flag, four tabs.** `phase2g_inventory_intelligence` covers ABC, aging, cycle counts, reorder. Backend + worker exist for each; frontend tab UIs exist but some are thinner than others. Treat as **Flagged / Partial depending on tab**.

8. **"Pro-tier" features are actually default-ON feature flags, not plan-gated.** `accounting_core`, `advanced_hr`, `multi_company`, `backup_restore`, `supplier_payables`, `approvals`, `crm_quotations`, `notifications` are all `true` in `DEFAULT_FEATURE_FLAGS` for every tenant regardless of plan. The true Pro/Free differentiator lives in [middleware/plan-limits.js](../backend/middleware/plan-limits.js) `PLAN_DEFAULTS` — Free is capped at 3 employees / 100 products / 1 outlet, Pro is unlimited. A Free tenant can use accounting and HR; they just can't add a 4th employee. If you want a feature to be paywalled, you need to add a plan check — feature flags alone won't enforce it.

9. **`shopify_integration` flag is gone from `DEFAULT_FEATURE_FLAGS`.** Shopify routes are now gated by a live connection check, not a feature flag. Old references in docs / tests are stale.

10. **POS keyboard shortcuts and offline queue exist but are not full offline-first.** [offlineQueue.js](../frontend/src/utils/offlineQueue.js) queues sales locally; sync is best-effort. For true offline-first retail (multi-day disconnection), this is **Partial**.

## Capability Matrix (~45 rows)

One line per retail capability, with the key surfaces and the gate.

| Capability | Frontend | Backend | Gate (default) | Maturity |
|---|---|---|---|---|
| POS sale | POSRedesign.jsx | sales.js | — | Shipped |
| Parked sales | ParkedSalesRedesign.jsx | parked-sales.js | perm: `pos_park` | Shipped |
| Holds / layaway | HoldsRedesign.jsx | holds.js + hold-expiry-worker-boss.js | `phase2g_holds` (OFF) | Flagged |
| Returns | ReturnsRedesign.jsx | returns.js | `phase2_returns_policy` (ON) | Shipped |
| Return policies | ReturnPoliciesRedesign.jsx | return-policies.js | `phase2_returns_policy` (ON) | Shipped |
| POS approvals | — | approval-policies.js | `phase2_pos_approvals` (OFF) | Flagged |
| POS price override | — | override-reasons.js | `phase2g_price_override` (OFF) | Flagged |
| Serialized inventory | — | product-serials.js | `phase2g_serialized_inventory` (OFF) | Flagged |
| Per-line restock | — | returns.js runtime | `phase2g_per_line_restock` (OFF) | Flagged |
| Draft orders | — | draft-orders.js | `phase2_draft_orders` (OFF) | Flagged |
| Item suggestions | — | item-suggestions.js | `phase2_item_suggestions` (OFF) | Flagged |
| POS layouts | POSLayoutsRedesign.jsx | pos-layouts.js | `phase2_pos_layouts` (ON) | Shipped |
| POS devices | — | pos-devices.js | — | Shipped |
| Omni search (POS) | POSSearchArea.jsx | — (frontend gate only) | `phase2g_omni_input` (OFF) | Flagged |
| Variant picker (POS) | POSVariantMatrixModal.jsx | — (frontend gate only) | `phase2g_variant_picker` (OFF) | Flagged |
| Catalog (products) | InventoryRedesign.jsx, ProductFormPage.jsx | products.js | — | Shipped |
| Categories / brands | CategoriesRedesign.jsx, BrandsRedesign.jsx | categories.js, brands.js | — | Shipped |
| Attribute sets | AttributeSetsRedesign.jsx | attribute-sets.js | — | Shipped |
| Promotions | PromotionsRedesign.jsx | promotions.js | — | Shipped |
| Smart collections | SmartCollectionsRedesign.jsx | smart-collections.js | `phase2_smart_collections` (ON) | Shipped |
| Scheduled changes | ScheduledChangesRedesign.jsx | scheduled-changes.js + catalog-scheduler | `phase2_scheduled_changes` (ON) | Shipped |
| Price lists | PriceListsRedesign.jsx | price-lists.js | perm only | Shipped |
| Price books | CustomerGroupPriceBookRedesign.jsx | price-books.js | `phase2g_price_books` (OFF) | Flagged |
| Outlet pricing | — | price-list-assignments.js | `phase2_outlet_pricing` (OFF) | Flagged |
| Outlet visibility | — | outlet-visibility.js | `phase2_outlet_visibility` (OFF) | Flagged |
| Outlet tax profiles | OutletTaxProfilesRedesign.jsx | outlet-tax-profiles.js | `phase2_outlet_tax` (ON) | Shipped |
| Review moderation | ReviewModerationRedesign.jsx | (via products.js) | — | Shipped |
| Stock ops | Stock*, Transfers*, Reorder* | inventory.js | — | Shipped |
| Inventory intelligence | InventoryIntelligenceRedesign.jsx | inventory-intelligence.js + abc-worker-boss | `phase2g_inventory_intelligence` (OFF) | Flagged / Partial |
| Purchase orders | PurchaseOrdersRedesign.jsx | purchase-orders.js | — | Shipped |
| Suppliers + GRN | SuppliersRedesign.jsx | suppliers.js, grn.js | — | Shipped |
| Supplier payables | SupplierPayablesRedesign.jsx | grn.js subset | `supplier_payables` (ON, Pro) | Shipped |
| Supplier returns | — | supplier-returns.js | — | Shipped |
| Approvals | ApprovalsRedesign.jsx | tier4/approvals.js | `approvals` (ON, Pro) | Shipped |
| Customers | CustomersRedesign.jsx | customers.js | — | Shipped |
| Customer groups | CustomerGroupsRedesign.jsx | customers.js subset | — | Shipped |
| CRM / quotations | CRMRedesign.jsx, QuotationsRedesign.jsx | tier4/crm.js | `crm_quotations` (ON, Pro) | Shipped |
| Customer invoicing | CustomerInvoicesRedesign.jsx | customer-invoices.js | `customer_invoicing` (ON) | Shipped |
| Payment links | — | customer-invoices.js runtime | `payment_links` (OFF) | Flagged |
| Messaging inbox | MessagingInboxRedesign.jsx | messaging.js | `customer_messaging` (ON) | Shipped |
| Marketing campaigns | MarketingCampaignsRedesign.jsx | marketing.js | `marketing_campaigns` (ON) | Shipped |
| SMS campaigns | — | marketing.js runtime | `sms_campaigns` (OFF) | Flagged (connection-based) |
| Loyalty tiers | LoyaltyTiersRedesign.jsx | loyalty.js | `phase2g_loyalty` (OFF) | Flagged |
| Gift cards (admin) | GiftCardsAdminRedesign.jsx | gift-cards.js | `phase2g_gift_cards` (OFF) | Flagged |
| Gift cards (public balance) | GiftCardBalancePage.jsx | gift-cards-public.js | — | Shipped |
| Subscriptions | SubscriptionsRedesign.jsx | subscriptions.js | `subscription_billing` (OFF, mode-gated) | Flagged |
| Dashboard | DashboardRedesign.jsx + widgets | insights.js | — | Shipped |
| Reports (core) | ReportsRedesign.jsx + tabs | reports/ (18 files) | — | Shipped |
| Report builder | ReportBuilderRedesign.jsx | report-builder.js | `phase2_report_builder` (ON) | Shipped |
| Reports enhancements | — | reports/ runtime | `reports_enhanced_filters`, `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions`, `reports_scheduled_exports` (all OFF) | Flagged |
| Retail risk | RetailRiskRedesign.jsx | risk-controls.js + anomaly-worker-boss | `phase2g_risk_controls` (OFF) | Flagged |
| AI insights | AIChatPanel (dashboard) | insights-ai.js | `ai_insights` soft DB check | Partial |
| Weekly digest | — | retail-digest-worker-boss | `retail_weekly_digest` (OFF) | Flagged |
| Shift auto-close | — | shift-auto-close-worker-boss | `shift_auto_close` (OFF) | Flagged |
| Offline returns | — | offline_returns worker | `offline_returns` (OFF) | Flagged / Partial |
| Receipt designer v2 | ReceiptTemplatesRedesign.jsx | receipts.js | `receipt_designer_v2` (ON, v1 EOL) | Shipped |
| Receipt barcode lookup | — | barcode-expenses.js | `phase2g_receipt_barcode_lookup` (OFF) | Flagged |
| Label designer | BarcodeTemplatesRedesign.jsx | barcode-expenses.js | `phase2g_label_designer` (OFF) | Flagged |
| Printer / thermal | PrinterSettingsRedesign.jsx | printer.js + services/printer.js | — | Shipped |
| Customer display | CustomerDisplayPage | customer-display.js | — | Shipped |
| Kiosk (clock-in + self-serve) | KioskRedesign.jsx, KioskOrderingRedesign.jsx | attendance.js | — | Shipped |
| Storefront | storefront/ | storefront.js | — | Shipped |
| Public receipt | ReceiptPublicPage.jsx | receipts.js | — | Shipped |
| Customer portal | portal/ | customer-portal/ (6 files) | per-tab flags | Shipped |
| Shopify | ShopifyIntegrationRedesign.jsx | shopify/ (10 files) | connection-based | Shipped |
| WooCommerce | WooCommerceIntegrationRedesign.jsx | woocommerce.js | connection-based | Shipped |
| Marketplace hub (Daraz/FB/WA/Google) | IntegrationsHubRedesign.jsx | integrations/ (8 files) + services/marketplace/ (6 files) | `marketplace_integrations` (ON, connection-based) | Shipped |
| Courier dispatch | CourierSettingsRedesign.jsx | couriers.js + services/couriers/ (16 files, 14 adapters) | connection-based | Shipped |
| Shipping automation | FulfillmentRedesign.jsx | fulfillment.js | `phase5_shipping_automation` (OFF) | Flagged |
| COD reconciliation | CODSettlementsRedesign.jsx | fulfillment.js | `phase5_cod_reconciliation` (OFF) | Flagged |
| Payment gateways | — | payment-gateway.js + webhooks.js | `phase5_payment_gateways` (OFF, connection-based) | Flagged |
| SMS providers | — | services/sms | `phase5_sms_providers` (OFF, connection-based) | Flagged |
| FBR digital invoicing | FBRSettingsRedesign.jsx, FBRDashboardRedesign.jsx | fbr.js + services/fbr.js + fbr-worker-boss | `fbr_integration` (seeded, OFF) | Shipped (for PK) |
| Tax lookup | TaxLookupRedesign.jsx | tax-lookup.js | — | Shipped |
| E-invoicing export | — | reports/fbr-export.js, barcode-expenses.js | `e_invoicing_export` (ON) | Shipped |
| Billing / subscription | BillingRedesign.jsx | billing.js | — | Shipped |
| Notifications | NotificationsRedesign.jsx | tier4/notifications.js | `notifications` (ON, Pro) | Shipped |
| Support tickets | MyTicketsRedesign.jsx | support.js | — | Shipped |
| Employees / attendance | EmployeesRedesign.jsx, AttendanceRedesign.jsx | employees.js, attendance.js | — | Shipped |
| Scheduling | SchedulingRedesign.jsx | schedules.js | `phase2_scheduling` (ON) | Shipped |
| Commissions | CommissionPlansRedesign.jsx | commissions.js | `phase2_commissions` (OFF, `commissions` mode) | Flagged |
| Tip pools | — | tips.js | — | Shipped (restaurant-heavy but route exists) |
| Advanced HR | HRManagementRedesign.jsx | tier4/hr.js | `advanced_hr` (ON, Pro) | Shipped |
| Expenses | ExpensesRedesign.jsx | barcode-expenses.js | `manage_inventory` perm | Shipped |
| Accounting core | ChartOfAccountsRedesign.jsx + 3 more | tier4/accounting.js | `accounting_core` (ON, Pro) | Shipped |
| Multi-company | CompanySettingsRedesign.jsx | tier4/company-profile.js | `multi_company` (ON, Pro) | Shipped |
| Backup / restore | BackupRestoreRedesign.jsx | barcode-expenses.js endpoints | `backup_restore` (ON, Pro) | Shipped |
| Bulk import | ImportRedesign.jsx | import.js | `manage_inventory`+`all_access` | Shipped |
| Competitor import | ImportFromCompetitorRedesign.jsx | — | — | Partial |
| Super-admin panel | admin/ (11 backend + 11 frontend) | admin/ | super-admin JWT + IP allow | Internal-only |

## Gate and Maturity Rules

When you describe the product, use this mental model:

- `default-on`: core baseline retail behavior
- `feature-flag`: real surface, but rollout-gated
- `connection-based`: depends on marketplace / courier / payment / provider setup
- `admin-only`: internal platform breadth, not merchant-facing capability

And these maturity boundaries:

- `Shipped`: credible live surface with strong structural evidence
- `Flagged`: real, but not universal / default
- `Partial`: real, but should be described carefully due to gaps, known bugs, or immature defaults
- `Internal-only`: useful platform breadth, not merchant-facing product capability

## Confidence

**High confidence on**
- The major retail picture
- The 6 retail presets and their config
- All 8 capability sections
- Every surface in the Capability Matrix (verified to live source 2026-04-24)
- Every worker in the Workers table

**Medium confidence on**
- Total exhaustiveness at the last edge-case / helper / branch level
- Every hidden route or shared-module behavior being perfectly classified forever
- Sub-tab maturity within Inventory Intelligence and Reports

**Why**
- This reference is grounded in live source files, route registries, feature flags, workers, schema / migrations, and existing tests, all rechecked on 2026-04-24
- It is still a static documentation pass, not a full end-to-end execution audit
- Some routes inherit flag runtime-checks inside handler bodies; those are listed in the matrix but not always separable from the parent route

## If You Update Retail Again

Refresh this file when any of these change:

- New retail page or public / customer-facing retail route
- New retail backend route or worker
- Flag default flipped (especially `phase2g_*` flags rolling from OFF to ON)
- Feature flag added or deleted in `DEFAULT_FEATURE_FLAGS`
- Capability moves from Flagged → Shipped (rollout confidence reached)
- Scope boundaries between retail and non-retail modes
- New mode added to `mode-registry.js` that would otherwise hide behind a preset
- Migration marker advances and the new migration touches retail tables

If you ever need the deeper evidence trail again, use the archived retail-reference files rather than rebuilding the whole mental model from scratch.

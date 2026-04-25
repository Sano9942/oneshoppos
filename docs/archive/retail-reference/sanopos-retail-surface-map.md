# SanoPOS Retail Surface Map (Inventory Layer) - 2026-04-23

## Context

This file is the **inventory layer** for retail: it answers **where retail lives in the codebase**. It is not the final maturity or market-claim document.

Use it together with:
- [docs/sanopos-retail-capability-matrix.md](sanopos-retail-capability-matrix.md) for the primary capability truth source
- [docs/audits/sanopos-retail-gap-audit-2026-04-23.md](audits/sanopos-retail-gap-audit-2026-04-23.md) for what the previous report missed, overstated, or left weakly proven
- [docs/audits/sanopos-retail-completeness-check-2026-04-23.md](audits/sanopos-retail-completeness-check-2026-04-23.md) for the current coverage-verification pass against live repo sources

**Scope**
- All 6 retail presets equally: `general_retail`, `grocery`, `wholesale`, `butcher`, `sweet_shop`, `textile`
- Retail core plus retail-adjacent merchant and customer-facing surfaces a retail tenant can realistically depend on
- Mode-gated non-retail modules excluded from retail claims unless they directly support a retail flow

**Method**
- Recounted live repo surfaces on 2026-04-23
- Mapped frontend pages, route registries, backend mounts, workers, schema tables, feature flags, portal/admin surfaces, and test files
- Cross-checked a representative sample from UI -> route -> table/test trail before promoting it into the capability matrix

**Evidence limits**
- Counts below are directly recounted from the repo
- Groupings below are exhaustive at the surface/category level, but not a full endpoint-by-endpoint API reference
- Where line counts or long-tail route/table details are omitted, treat this file as a map, not as the final proof artifact

---

## Headline Counts

| Surface | Live count | Notes |
|---|---:|---|
| Retail presets | 6 | From [backend/config/industry-config.js](../backend/config/industry-config.js) |
| Redesign pages | 97 | `frontend/src/pages/redesign/*Redesign.jsx` |
| Top-level backend routes | 89 | `backend/routes/*.js` |
| Worker files | 18 | `backend/workers/*-boss.js` |
| Worker helper files | 1 | `backend/workers/tenant-job-context.js` |
| POS hooks | 8 | `frontend/src/pages/redesign/pos/hooks/*` |
| Frontend test files | 68 | `frontend/tests/**/*.spec.js|*.test.js|*.test.jsx` |
| Default feature flags | 84 | `DEFAULT_FEATURE_FLAGS` in [backend/middleware/feature-flags.js](../backend/middleware/feature-flags.js) |
| Current migration marker | v76 | Verified in [backend/migrate-pg.js](../backend/migrate-pg.js) |

**Headline takeaway**
- The retail surface is materially deeper than a classic POS-only stack. The product now spans POS, returns, pricing, inventory intelligence, public receipts, gift-card lookup, portal, reporting, omnichannel, compliance, billing, support, notifications, and admin oversight.

---

## 1. Industry Presets

Source: [backend/config/industry-config.js](../backend/config/industry-config.js)

| Preset | Business model | POS layout | Retail notes |
|---|---|---|---|
| `general_retail` | `buy_sell` | `grid` | Baseline retail flow |
| `grocery` | `buy_sell` | `grid` | Barcode-heavy, stock-heavy retail |
| `wholesale` | `b2b_distribution` | `grid` | B2B and invoicing-weighted retail |
| `butcher` | `buy_sell` | `list` | Weight/tare-sensitive selling |
| `sweet_shop` | `buy_sell` | `grid` | Weight/tare plus packaged goods |
| `textile` | `buy_sell` | `grid` | Unit/measurement-sensitive selling |

Shared retail defaults:
- Dashboard widgets: `inventory_alerts`, `top_products`, `trends`, `attendance`
- Non-retail widgets suppressed: `floor_plan`, `appointments_today`
- Retail labels remain product/customer/sale centric

Related gating/config:
- [backend/config/mode-registry.js](../backend/config/mode-registry.js)
- [backend/config/country-packs.js](../backend/config/country-packs.js)

---

## 2. POS Surface

Primary frontend surface:
- [frontend/src/pages/redesign/POSRedesign.jsx](../frontend/src/pages/redesign/POSRedesign.jsx)

Retail POS core lives in:
- [frontend/src/pages/redesign/pos/POSContext.jsx](../frontend/src/pages/redesign/pos/POSContext.jsx)
- [frontend/src/pages/redesign/pos/cartMath.js](../frontend/src/pages/redesign/pos/cartMath.js)
- [frontend/src/pages/redesign/pos/hooks/useCart.js](../frontend/src/pages/redesign/pos/hooks/useCart.js)
- [frontend/src/pages/redesign/pos/hooks/useCheckout.js](../frontend/src/pages/redesign/pos/hooks/useCheckout.js)
- [frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js](../frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js)
- [frontend/src/pages/redesign/pos/hooks/useShiftGate.js](../frontend/src/pages/redesign/pos/hooks/useShiftGate.js)

Key POS modal surfaces:
- Checkout and receipt: `POSCheckoutModal`, `POSReceiptModal`, `POSEmailReceiptModal`, `POSReceiptRetryModal`
- Cart control: `POSDiscountModal`, `POSNoteModal`, `POSPriceOverrideModal`, `POSVariantMatrixModal`, `POSSerialEntryModal`
- Exception handling: `POSBarcodeMissModal`, `POSInsufficientStockModal`, `POSRefundThresholdModal`, `POSNoSaleReasonModal`
- Returns and exchange: [POSReturnExchangeModal.jsx](../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx)
- Holds and parked sales: `POSParkedModal`, `POSCartResumeModal`, `POSCartCollisionModal`, `POSHoldCreateModal`, `POSHoldPickupModal`
- Shift/session control: `POSOpeningGateModal`, `POSCloseShiftModal`, `POSShiftRecoveryModal`, `POSLockScreen`, `POSSessionExpiredModal`, `POSStuckQueueModal`, `POSApprovalModal`
- Adjacent retail flows: `EndlessAisleModal`, customer display hook, loyalty/wallet hook, folio charging hook

Evidence snapshot:
- UI/tests: [frontend/tests/pos-core.spec.js](../frontend/tests/pos-core.spec.js), [frontend/tests/pos-advanced.spec.js](../frontend/tests/pos-advanced.spec.js), [frontend/tests/unit/cartMath.test.jsx](../frontend/tests/unit/cartMath.test.jsx), [frontend/tests/unit/omniInputRouter.test.js](../frontend/tests/unit/omniInputRouter.test.js), [frontend/tests/unit/pos-context-open-check.test.jsx](../frontend/tests/unit/pos-context-open-check.test.jsx)

**Evidence limits**
- This section inventories the retail POS shell and key hot-path files
- Restaurant-only files under `frontend/src/pages/redesign/pos/restaurant/` are intentionally not counted as retail claim surface

---

## 3. Frontend Merchant Surfaces

Source root: [frontend/src/pages/redesign/](../frontend/src/pages/redesign/)

### Daily retail operations
- `DashboardRedesign`
- `POSRedesign`
- `SalesHistoryRedesign`
- `ParkedSalesRedesign`
- `ReturnsRedesign`
- `ReturnedStockRedesign`
- `CashManagementRedesign`
- `ActionHistoryRedesign`
- `ReportsRedesign`

### Inventory and catalog
- `InventoryRedesign` for product/inventory listing
- `ProductFormPage`
- `CategoriesRedesign`
- `BrandsRedesign`
- `AttributeSetsRedesign`
- `SmartCollectionsRedesign`
- `StockCountRedesign`
- `StockAdjustmentsRedesign`
- `TransfersRedesign`
- `InventoryIntelligenceRedesign`
- `ReorderAlertsRedesign`
- `ReviewModerationRedesign`
- `ModifierGroupsRedesign` shared surface, retail-adjacent but not core retail claim material

### Purchasing and suppliers
- `PurchaseOrdersRedesign`
- `SuppliersRedesign`
- `SupplierPayablesRedesign`

### Customers, CRM, and commercial follow-through
- `CustomersRedesign`
- `CustomerGroupsRedesign`
- `CustomerGroupPriceBookRedesign`
- `LoyaltyTiersRedesign`
- `CRMRedesign`
- `QuotationsRedesign`
- `CustomerInvoicesRedesign`
- `MarketingCampaignsRedesign`
- `MessagingInboxRedesign`

### Pricing and merchandising
- `PromotionsRedesign`
- `PriceListsRedesign`
- `ScheduledChangesRedesign`

### Retail ops, compliance, and workforce
- `OutletsRedesign`
- `OutletTaxProfilesRedesign`
- `TaxesRedesign`
- `EmployeesRedesign`
- `CommissionPlansRedesign`
- `HRManagementRedesign`
- `ReturnPoliciesRedesign`
- `ApprovalsRedesign`
- `RetailRiskRedesign`
- `SchedulingRedesign`
- `ExpensesRedesign`
- `TipPoolsRedesign`

### Hardware, receipt, and device surfaces
- `POSLayoutsRedesign`
- `PrinterSettingsRedesign`
- `BarcodeTemplatesRedesign`
- `ReceiptTemplatesRedesign`
- `CustomerDisplayPage`
- `KioskRedesign`
- `KioskOrderingRedesign`

### Reports, accounting, and control surfaces
- `AccountingRedesign`
- `ChartOfAccountsRedesign`
- `JournalEntriesRedesign`
- `CreditDebitNotesRedesign`
- `PostdatedChequesRedesign`
- `ReportBuilderRedesign`
- `ReportTabStandaloneRoute` deep-links in [frontend/src/routes/appRoutes.jsx](../frontend/src/routes/appRoutes.jsx) for standalone report entry points such as sales summary, inventory dump, and menu-engineering tabs

### Integrations and fulfillment
- `IntegrationsHubRedesign`
- `ShopifyIntegrationRedesign`
- `WooCommerceIntegrationRedesign`
- `CourierSettingsRedesign`
- `FulfillmentRedesign`
- `OrdersRedesign`
- `CODSettlementsRedesign`
- `FBRSettingsRedesign`
- `FBRDashboardRedesign`
- `TaxLookupRedesign`

### Public and customer-facing web surfaces included
- `ReceiptPublicPage`
- `GiftCardBalancePage`
- Storefront pages under [frontend/src/pages/storefront/](../frontend/src/pages/storefront/)
- Portal pages under [frontend/src/pages/portal/](../frontend/src/pages/portal/) for the retail-relevant tab set: invoices, orders, loyalty, wallet, and profile

### Retail-adjacent merchant surfaces included
- `BillingRedesign`
- `NotificationsRedesign`
- `MyTicketsRedesign`
- Admin pages under [frontend/src/pages/admin/](../frontend/src/pages/admin/)

**Why these adjacent surfaces stay in**
- A retail merchant can directly rely on billing, notifications, support tickets, customer portal self-service, and super-admin support operations even though they are not POS or inventory screens

---

## 4. Backend Routes and Services

Source root: [backend/routes/](../backend/routes/)

### Transactional retail core
- [sales.js](../backend/routes/sales.js)
- [returns.js](../backend/routes/returns.js)
- [holds.js](../backend/routes/holds.js)
- [parked-sales.js](../backend/routes/parked-sales.js)
- [shifts.js](../backend/routes/shifts.js)
- [gift-cards.js](../backend/routes/gift-cards.js)
- [gift-cards-public.js](../backend/routes/gift-cards-public.js)
- [loyalty.js](../backend/routes/loyalty.js)
- [tips.js](../backend/routes/tips.js)
- [draft-orders.js](../backend/routes/draft-orders.js)

### Catalog, pricing, and merchandising
- [products.js](../backend/routes/products.js)
- [categories.js](../backend/routes/categories.js)
- [brands.js](../backend/routes/brands.js)
- [attribute-sets.js](../backend/routes/attribute-sets.js)
- [smart-collections.js](../backend/routes/smart-collections.js)
- [product-serials.js](../backend/routes/product-serials.js)
- [scheduled-changes.js](../backend/routes/scheduled-changes.js)
- [promotions.js](../backend/routes/promotions.js)
- [price-lists.js](../backend/routes/price-lists.js)
- [price-list-assignments.js](../backend/routes/price-list-assignments.js)
- [price-books.js](../backend/routes/price-books.js)

### Inventory and purchasing
- [inventory.js](../backend/routes/inventory.js)
- [purchase-orders.js](../backend/routes/purchase-orders.js)
- [grn.js](../backend/routes/grn.js)
- [supplier-returns.js](../backend/routes/supplier-returns.js)
- [inventory-intelligence.js](../backend/routes/inventory-intelligence.js)

### People, CRM, and workforce
- [customers.js](../backend/routes/customers.js)
- [suppliers.js](../backend/routes/suppliers.js)
- [employees.js](../backend/routes/employees.js)
- [attendance.js](../backend/routes/attendance.js)
- [commissions.js](../backend/routes/commissions.js)
- [tier4/crm.js](../backend/routes/tier4/crm.js)
- [customer-invoices.js](../backend/routes/customer-invoices.js)
- [marketing.js](../backend/routes/marketing.js)
- [messaging.js](../backend/routes/messaging.js)
- [schedules.js](../backend/routes/schedules.js)

### Config, audit, and hardware
- [outlets.js](../backend/routes/outlets.js)
- [outlet-tax-profiles.js](../backend/routes/outlet-tax-profiles.js)
- [outlet-visibility.js](../backend/routes/outlet-visibility.js)
- [taxes.js](../backend/routes/taxes.js)
- [tax-lookup.js](../backend/routes/tax-lookup.js)
- [return-policies.js](../backend/routes/return-policies.js)
- [approval-policies.js](../backend/routes/approval-policies.js)
- [override-reasons.js](../backend/routes/override-reasons.js)
- [risk-controls.js](../backend/routes/risk-controls.js)
- [pos-layouts.js](../backend/routes/pos-layouts.js)
- [pos-devices.js](../backend/routes/pos-devices.js)
- [barcode-expenses.js](../backend/routes/barcode-expenses.js)
- [receipt-templates.js](../backend/routes/receipt-templates.js)
- [printer.js](../backend/routes/printer.js)
- [customer-display.js](../backend/routes/customer-display.js)

### Omnichannel, storefront, and fulfillment
- [orders.js](../backend/routes/orders.js)
- [fulfillment.js](../backend/routes/fulfillment.js)
- [couriers.js](../backend/routes/couriers.js)
- [storefront.js](../backend/routes/storefront.js)
- [receipts.js](../backend/routes/receipts.js)
- [webhooks.js](../backend/routes/webhooks.js)
- [shopify/](../backend/routes/shopify/)
- [integrations/](../backend/routes/integrations/)
- [woocommerce.js](../backend/routes/woocommerce.js)

### Reporting and analytics
- [reports/](../backend/routes/reports/)
- [report-builder.js](../backend/routes/report-builder.js)
- [insights.js](../backend/routes/insights.js)
- [insights-ai.js](../backend/routes/insights-ai.js)

### Retail-adjacent merchant and ops routes included
- [billing.js](../backend/routes/billing.js)
- [support.js](../backend/routes/support.js)
- [tier4/notifications.js](../backend/routes/tier4/notifications.js)
- [customer-portal/](../backend/routes/customer-portal/)
- [admin/](../backend/routes/admin/)

### Services behind the retail stack
- [backend/services/pricing.js](../backend/services/pricing.js)
- [backend/services/printer.js](../backend/services/printer.js)
- [backend/services/payment-gateway.js](../backend/services/payment-gateway.js)
- [backend/services/fbr.js](../backend/services/fbr.js)
- [backend/services/email.js](../backend/services/email.js)
- [backend/services/approval-policy.js](../backend/services/approval-policy.js)
- [backend/services/inventory-intelligence.js](../backend/services/inventory-intelligence.js)
- [backend/services/couriers/](../backend/services/couriers/)
- [backend/services/marketplace/](../backend/services/marketplace/)

**Evidence limits**
- This section groups routes by merchant-facing capability area
- It is not a substitute for the more bounded and maturity-aware capability matrix

---

## 5. Workers, Middleware, and Background Surfaces

Workers:
- 18 `*-boss.js` worker files in [backend/workers/](../backend/workers/)
- 1 helper: [tenant-job-context.js](../backend/workers/tenant-job-context.js)

Retail-relevant workers:
- `email-worker-boss.js`
- `fbr-worker-boss.js`
- `retail-digest-worker-boss.js`
- `shift-auto-close-worker-boss.js`
- `marketplace-sync-worker-boss.js`
- `anomaly-worker-boss.js`
- `hold-expiry-worker-boss.js`
- `abc-worker-boss.js`
- `reservation-worker-boss.js` for storefront reservation expiry

Middleware touching most retail requests:
- [tenant-auth.js](../backend/middleware/tenant-auth.js)
- [permissions.js](../backend/middleware/permissions.js)
- [feature-flags.js](../backend/middleware/feature-flags.js)
- [plan-limits.js](../backend/middleware/plan-limits.js)
- [validate.js](../backend/middleware/validate.js)
- [upload-validation.js](../backend/middleware/upload-validation.js)
- [rate-limit.js](../backend/middleware/rate-limit.js)
- [request-id.js](../backend/middleware/request-id.js)

---

## 6. Data Model and Flags

Primary schema source:
- [backend/schema-pg.sql](../backend/schema-pg.sql)

Retail-core tables visible in live schema:
- Sales and returns: `sales`, `sale_items`, `returns`, `return_items`, `sale_item_adjustments`
- Holds and shifts: `holds`, `cash_shifts`, `shift_denominations`, `cash_drops`
- Catalog and pricing: `products`, `product_variants`, `price_lists`, `price_list_items`, `promotions`, `scheduled_catalog_changes`
- Inventory and purchasing: `outlet_stock`, `variant_outlet_stock`, `inventory_transfers`, `stock_counts`, `stock_count_items`, `purchase_orders`, `goods_received_notes`, `inventory_reservations`, `cycle_count_schedules`, `cycle_count_sessions`, `product_abc_class`
- Customers and value systems: `customers`, `customer_groups`, `customer_wallet_ledger`, `loyalty_tiers`, `loyalty_transactions`, `gift_cards`, `gift_card_transactions`, `customer_invoices`
- Workforce and incentives: `employees`, `employee_attendance`, `attendance_sessions`, `commission_plans`, `tip_pools`, `tip_pool_payouts`, `scheduled_shifts`
- Hardware and audit: `receipt_templates`, `printer_config`, `approval_policies`, `approval_events`, `return_policies`, `no_sale_reasons`, `no_sale_events`, `action_history`, `notifications`
- Omnichannel and compliance: `web_orders`, `web_order_fulfillments`, `storefront_carts`, `order_shipments`, `shipment_tracking_events`, `cod_settlement_batches`, `cod_settlement_lines`, `courier_integrations`, `integration_settings`, `payment_webhook_events`, `fbr_invoices`
- Risk and oversight: `retail_anomaly_flags`, `risk_controls_config`, `support_tickets`
- Customer portal auth: `customer_portal_otps`, `customer_portal_refresh_tokens`

Feature-flag and rollout surface:
- 84 default flags in [backend/middleware/feature-flags.js](../backend/middleware/feature-flags.js)
- Retail-specific flags include `phase2g_*`, `receipt_designer_v2`, `shift_auto_close`, `offline_returns`, `phase2_scheduling`, `phase2_report_builder`, `phase2_returns_policy`, and PK-focused integration flags

**Evidence limits**
- This table list highlights retail-relevant tables only
- It is not a full schema dump and does not encode maturity by itself

---

## 7. Tests and Evidence Snapshot

Live frontend test count: 68 files under [frontend/tests/](../frontend/tests/)

Representative retail evidence:
- POS: [pos-core.spec.js](../frontend/tests/pos-core.spec.js), [pos-advanced.spec.js](../frontend/tests/pos-advanced.spec.js), [unit/cartMath.test.jsx](../frontend/tests/unit/cartMath.test.jsx), [unit/omniInputRouter.test.js](../frontend/tests/unit/omniInputRouter.test.js)
- Returns and policies: [smoke/draft-orders-returns.smoke.spec.js](../frontend/tests/smoke/draft-orders-returns.smoke.spec.js)
- Pricing and promotions: [smoke/pricing-promotions.smoke.spec.js](../frontend/tests/smoke/pricing-promotions.smoke.spec.js)
- Inventory and purchasing: [inventory.spec.js](../frontend/tests/inventory.spec.js), [purchasing.spec.js](../frontend/tests/purchasing.spec.js)
- Customers and orders: [customers.spec.js](../frontend/tests/customers.spec.js), [orders.spec.js](../frontend/tests/orders.spec.js)
- Reports and dashboards: [reports.spec.js](../frontend/tests/reports.spec.js), [smoke/insights-dashboard.smoke.spec.js](../frontend/tests/smoke/insights-dashboard.smoke.spec.js), [smoke/commissions-reports.smoke.spec.js](../frontend/tests/smoke/commissions-reports.smoke.spec.js)
- Integrations and storefront: [integrations.spec.js](../frontend/tests/integrations.spec.js), [smoke/omnichannel-admin.smoke.spec.js](../frontend/tests/smoke/omnichannel-admin.smoke.spec.js), [smoke/storefront-public.smoke.spec.js](../frontend/tests/smoke/storefront-public.smoke.spec.js)
- Compliance and billing: [fbr.spec.js](../frontend/tests/fbr.spec.js), [billing.spec.js](../frontend/tests/billing.spec.js)
- Workforce/admin: [smoke/workforce.smoke.spec.js](../frontend/tests/smoke/workforce.smoke.spec.js), [admin-panel.spec.js](../frontend/tests/admin-panel.spec.js)

Important nuance:
- The existence of a test file does not automatically make the workflow merchant-ready
- Several smoke specs intentionally document known gaps or partial paths; the capability matrix handles that nuance with bounded claims and maturity labels

---

## 8. Retail-Adjacent Merchant Surfaces Included

These are intentionally included in retail truth because a retail merchant can encounter them in normal operation:

- Billing and subscription management: [frontend/src/pages/redesign/BillingRedesign.jsx](../frontend/src/pages/redesign/BillingRedesign.jsx), [backend/routes/billing.js](../backend/routes/billing.js)
- Notifications inbox: [frontend/src/pages/redesign/NotificationsRedesign.jsx](../frontend/src/pages/redesign/NotificationsRedesign.jsx), [backend/routes/tier4/notifications.js](../backend/routes/tier4/notifications.js)
- Support ticket submission and ticket history: [frontend/src/pages/redesign/MyTicketsRedesign.jsx](../frontend/src/pages/redesign/MyTicketsRedesign.jsx), [backend/routes/support.js](../backend/routes/support.js)
- Insights and dashboard intelligence: [backend/routes/insights.js](../backend/routes/insights.js), [backend/routes/insights-ai.js](../backend/routes/insights-ai.js), [frontend/src/pages/dashboard/AIChatPanel.jsx](../frontend/src/pages/dashboard/AIChatPanel.jsx)
- Portal self-service: [frontend/src/pages/portal/](../frontend/src/pages/portal/), [backend/routes/customer-portal/](../backend/routes/customer-portal/)
- Preset-aware portal config for retail tabs is driven from [backend/config/industry-config.js](../backend/config/industry-config.js) and [backend/routes/customer-portal/data.js](../backend/routes/customer-portal/data.js)
- Super-admin and support operations: [frontend/src/pages/admin/](../frontend/src/pages/admin/), [backend/routes/admin/](../backend/routes/admin/)
- Back-office operational depth: `ExpensesRedesign`, `TipPoolsRedesign`, accounting/admin workflows, action history, and scheduling

---

## 9. Out of Retail Scope

These surfaces exist in code but are not part of the retail capability claim set unless explicitly discussed as adjacent platform breadth:

- Restaurant mode and restaurant POS shell
- KDS, floor plans, checks, reservations, menu engineering, 86 list, pay-at-table
- Appointment-centric surfaces
- Preset-gated non-retail portal tabs: appointments, subscriptions, contracts, stays, treatments, and tickets
- Rooms, stays, folios, treatment plans, clinical workflows
- Rentals, contracts, projects, service tickets

Representative excluded files:
- [frontend/src/pages/redesign/POSRestaurantRedesign.jsx](../frontend/src/pages/redesign/POSRestaurantRedesign.jsx)
- [frontend/src/pages/redesign/RestaurantFloorRedesign.jsx](../frontend/src/pages/redesign/RestaurantFloorRedesign.jsx)
- [frontend/src/pages/portal/PortalAppointments.jsx](../frontend/src/pages/portal/PortalAppointments.jsx)
- [backend/routes/restaurant.js](../backend/routes/restaurant.js)
- [backend/routes/bookings.js](../backend/routes/bookings.js)
- [backend/routes/rooms.js](../backend/routes/rooms.js)
- [backend/routes/treatment-plans.js](../backend/routes/treatment-plans.js)
- [backend/routes/contracts.js](../backend/routes/contracts.js)
- [backend/routes/projects.js](../backend/routes/projects.js)

---

## 10. Maintenance Checks

Fast sanity checks for future refreshes:

1. Recount redesign pages, top-level routes, worker files, and test files from the repo before trusting any old numbers.
2. Re-open [backend/config/industry-config.js](../backend/config/industry-config.js) before making preset claims.
3. Re-open [backend/middleware/feature-flags.js](../backend/middleware/feature-flags.js) before writing any gated/rollout narrative.
4. Use [docs/sanopos-retail-capability-matrix.md](sanopos-retail-capability-matrix.md) as the claim source; only use this file as the inventory source.
5. When a new feature ships, update all four layers together: inventory, capability matrix, historical gap notes, and the completeness check if the claim surface changed.

# SanoPOS Retail Surface Map

**Date:** 2026-04-23
**Purpose:** Complete inventory of every part of the SanoPOS codebase that touches the **retail** business model, so we know exactly what to polish now that restaurant + retail are the focus.

**Scope:** The 6 retail presets in `backend/config/industry-config.js`:
- `general_retail` — buy_sell, grid layout
- `grocery` — buy_sell, grid layout
- `wholesale` — b2b_distribution, grid layout
- `butcher` — buy_sell with weight (tare), list layout, units: kg/g/lb/pcs
- `sweet_shop` — buy_sell with weight (tare), grid layout, units: kg/g/dozen/pcs/pack
- `textile` — buy_sell with length, grid layout, units: m/cm/pcs/pack

**Excluded from this document:** restaurant, appointments/salon/clinic, rentals, rooms/hotel, clinical (dental/vet/physio), subscriptions, service tickets, projects, treatment plans.

---

## Business Model Coverage

Out of 54 industries in [sanopos-54-industry-coverage-matrix.md](plans/sanopos-54-industry-coverage-matrix.md), the **retail mode** covers ~29 businesses:

**Standard retail (grid layout, barcode+SKU POS):**
1. General Retail
2. Grocery / Supermarket
3. Electronics
4. Pharmacy / Medical Store
5. Bookstore / Stationery
6. Hardware / Building Materials
7. Cosmetics / Beauty Supply
8. Pet Shop
9. Toy Store
10. Sports / Fitness Equipment
11. Furniture / Home Decor
12. Jewelry Store
13. Optical / Eyewear (retail-only)
14. Gift Shop / Souvenir
15. Auto Parts
16. Wholesale / Distribution
17. Tobacco / Vape Shop
18. Art Supply
19. Musical Instruments
20. Garden / Nursery
21. Printing / Copy Shop
22. Convenience Store / Kiryana

**Weight / meter retail (butcher, sweet_shop, textile presets):**
23. Sweet Shop / Mithai
24. Butcher / Meat Shop
25. Dry Fruits / Spice Shop
26. Textile / Fabric Shop
27. Florist (product side)
28. Fertilizer / Agri Supply
29. Atta Chakki (flour mill)

Combined with **restaurant mode** (5 more industries), this focus covers **~34 of 54 industries (~63%)**.

---

## 1. POS Screen — the #1 Retail Surface

Location: [frontend/src/pages/redesign/pos/](frontend/src/pages/redesign/pos/) — **~50 files, ~8,400 lines**. Entry: [POSRedesign.jsx](frontend/src/pages/redesign/POSRedesign.jsx).

### Core state + routing
- [POSContext.jsx](frontend/src/pages/redesign/pos/POSContext.jsx) — global POS state machine (cart, sales, UI, modals), 130+ exports
- `cartMath.js` — discount, tax, total calculation (**heart of pricing correctness**)
- `omniInputRouter.js` — routes a single input between barcode / SKU / customer search
- `hooks/useOfflineQueue.js` — offline sale persistence
- `hooks/useCustomerDisplay.js` — second-screen driver
- `hooks/useFolioCharging.js` — charge-to-folio

### Layout
- [POSHeader.jsx](frontend/src/pages/redesign/pos/POSHeader.jsx) — outlet/shift/user bar
- [POSSubHeader.jsx](frontend/src/pages/redesign/pos/POSSubHeader.jsx) — normal vs return mode
- [POSSearchArea.jsx](frontend/src/pages/redesign/pos/POSSearchArea.jsx) — barcode/SKU/name search
- [POSOmniInput.jsx](frontend/src/pages/redesign/pos/POSOmniInput.jsx) — unified search (phase2g_omni_input)
- [POSSidebar.jsx](frontend/src/pages/redesign/pos/POSSidebar.jsx) — quick actions
- [POSCartTable.jsx](frontend/src/pages/redesign/pos/POSCartTable.jsx) — cart rows, qty, price
- [POSRecentSalesPanel.jsx](frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx) — today's sales

### Checkout + receipt
- [POSCheckoutModal.jsx](frontend/src/pages/redesign/pos/POSCheckoutModal.jsx)
- [POSReceiptModal.jsx](frontend/src/pages/redesign/pos/POSReceiptModal.jsx)
- [POSEmailReceiptModal.jsx](frontend/src/pages/redesign/pos/POSEmailReceiptModal.jsx)
- [POSReceiptRetryModal.jsx](frontend/src/pages/redesign/pos/POSReceiptRetryModal.jsx)

### Cart operations
- [POSDiscountModal.jsx](frontend/src/pages/redesign/pos/POSDiscountModal.jsx)
- [POSNoteModal.jsx](frontend/src/pages/redesign/pos/POSNoteModal.jsx)
- [POSPriceOverrideModal.jsx](frontend/src/pages/redesign/pos/POSPriceOverrideModal.jsx)
- [POSVariantMatrixModal.jsx](frontend/src/pages/redesign/pos/POSVariantMatrixModal.jsx)
- [POSSerialEntryModal.jsx](frontend/src/pages/redesign/pos/POSSerialEntryModal.jsx)
- [POSBarcodeMissModal.jsx](frontend/src/pages/redesign/pos/POSBarcodeMissModal.jsx)
- [POSInsufficientStockModal.jsx](frontend/src/pages/redesign/pos/POSInsufficientStockModal.jsx)
- [POSReturnExchangeModal.jsx](frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx)
- [POSRefundThresholdModal.jsx](frontend/src/pages/redesign/pos/POSRefundThresholdModal.jsx)
- [EndlessAisleModal.jsx](frontend/src/pages/redesign/pos/EndlessAisleModal.jsx)
- [POSNoSaleReasonModal.jsx](frontend/src/pages/redesign/pos/POSNoSaleReasonModal.jsx)

### Parked + holds
- [POSParkedModal.jsx](frontend/src/pages/redesign/pos/POSParkedModal.jsx)
- [POSCartResumeModal.jsx](frontend/src/pages/redesign/pos/POSCartResumeModal.jsx)
- [POSCartCollisionModal.jsx](frontend/src/pages/redesign/pos/POSCartCollisionModal.jsx)
- [POSHoldCreateModal.jsx](frontend/src/pages/redesign/pos/POSHoldCreateModal.jsx)
- [POSHoldPickupModal.jsx](frontend/src/pages/redesign/pos/POSHoldPickupModal.jsx)

### Shift + session
- [POSOpeningGateModal.jsx](frontend/src/pages/redesign/pos/POSOpeningGateModal.jsx)
- [POSCloseShiftModal.jsx](frontend/src/pages/redesign/pos/POSCloseShiftModal.jsx)
- [POSShiftRecoveryModal.jsx](frontend/src/pages/redesign/pos/POSShiftRecoveryModal.jsx)
- [POSLockScreen.jsx](frontend/src/pages/redesign/pos/POSLockScreen.jsx)
- [POSSessionExpiredModal.jsx](frontend/src/pages/redesign/pos/POSSessionExpiredModal.jsx)
- [POSStuckQueueModal.jsx](frontend/src/pages/redesign/pos/POSStuckQueueModal.jsx)

### Approval + help
- [POSApprovalModal.jsx](frontend/src/pages/redesign/pos/POSApprovalModal.jsx)
- [POSShortcutsOverlay.jsx](frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx)

### Keyboard shortcuts (work even when input focused)
F1=help, F2=discount, F3=park, F4=customer search, F5=parked sales, F8=remove last, F9=checkout, F10=clear cart, Esc=close modal.

### Skip for retail (restaurant-only)
- [POSRestaurantRedesign.jsx](frontend/src/pages/redesign/POSRestaurantRedesign.jsx)
- [POSModifierModal.jsx](frontend/src/pages/redesign/pos/POSModifierModal.jsx)

---

## 2. Backend Routes Retail Depends On

### Transactions
- [sales.js](backend/routes/sales.js) — sale create/void/query
- [returns.js](backend/routes/returns.js) — refunds, exchanges
- [parked-sales.js](backend/routes/parked-sales.js)
- [holds.js](backend/routes/holds.js)
- [shifts.js](backend/routes/shifts.js) — cash shifts, opening/closing
- [gift-cards.js](backend/routes/gift-cards.js)
- [loyalty.js](backend/routes/loyalty.js)
- [tips.js](backend/routes/tips.js) — tip pools
- [draft-orders.js](backend/routes/draft-orders.js) — quotations / pay-later

### Catalog
- [products.js](backend/routes/products.js) — **1,579 lines, heaviest route**
- [categories.js](backend/routes/categories.js) — hierarchical tree
- [brands.js](backend/routes/brands.js)
- [attribute-sets.js](backend/routes/attribute-sets.js)
- [smart-collections.js](backend/routes/smart-collections.js)
- [product-serials.js](backend/routes/product-serials.js)
- [modifiers.js](backend/routes/modifiers.js)
- [item-suggestions.js](backend/routes/item-suggestions.js) — POS "buy-with" affinity
- [scheduled-changes.js](backend/routes/scheduled-changes.js) — future price/promo

### Inventory
- [inventory.js](backend/routes/inventory.js) — transfers + adjustments
- [purchase-orders.js](backend/routes/purchase-orders.js)
- [grn.js](backend/routes/grn.js) — goods received + supplier payables
- [supplier-returns.js](backend/routes/supplier-returns.js)
- [inventory-intelligence.js](backend/routes/inventory-intelligence.js) — reorder forecasting

### People
- [customers.js](backend/routes/customers.js)
- [suppliers.js](backend/routes/suppliers.js)
- [employees.js](backend/routes/employees.js)
- [roles.js](backend/routes/roles.js)
- [attendance.js](backend/routes/attendance.js) — clock in/out + PIN kiosk
- [commissions.js](backend/routes/commissions.js)

### Config
- [outlets.js](backend/routes/outlets.js)
- [outlet-tax-profiles.js](backend/routes/outlet-tax-profiles.js)
- [outlet-visibility.js](backend/routes/outlet-visibility.js)
- [taxes.js](backend/routes/taxes.js)
- [tax-lookup.js](backend/routes/tax-lookup.js) — HS code search
- [promotions.js](backend/routes/promotions.js)
- [price-list-assignments.js](backend/routes/price-list-assignments.js)
- [return-policies.js](backend/routes/return-policies.js)
- [approval-policies.js](backend/routes/approval-policies.js)
- [override-reasons.js](backend/routes/override-reasons.js)
- [risk-controls.js](backend/routes/risk-controls.js)
- [pos-layouts.js](backend/routes/pos-layouts.js)
- [pos-devices.js](backend/routes/pos-devices.js) — paired device registration
- [barcode-expenses.js](backend/routes/barcode-expenses.js) — label print jobs
- [receipt-templates.js](backend/routes/receipt-templates.js)
- [printer.js](backend/routes/printer.js)
- [customer-display.js](backend/routes/customer-display.js) — second screen
- [setup.js](backend/routes/setup.js) — first-run wizard

### Omnichannel + fulfillment
- [orders.js](backend/routes/orders.js) — unified order management
- [fulfillment.js](backend/routes/fulfillment.js) — picklists, loadsheets, dispatch
- [couriers.js](backend/routes/couriers.js) — courier CRUD + shipping
- [storefront.js](backend/routes/storefront.js) — public B2C cart
- [receipts.js](backend/routes/receipts.js) — public shareable receipt URL
- [webhooks.js](backend/routes/webhooks.js) — payment gateway inbound (no auth)

### Import + setup
- [import.js](backend/routes/import.js) — bulk CSV/XLSX
- [sandbox.js](backend/routes/sandbox.js) — test payments

### Tier 4 (all retail-adjacent)
- [tier4/company-profile.js](backend/routes/tier4/company-profile.js)
- [tier4/accounting.js](backend/routes/tier4/accounting.js) — GL, P&L, COGS
- [tier4/crm.js](backend/routes/tier4/crm.js) — quotations, customer notes
- [tier4/approvals.js](backend/routes/tier4/approvals.js) — override workflow
- [tier4/hr.js](backend/routes/tier4/hr.js) — advanced HR
- [tier4/notifications.js](backend/routes/tier4/notifications.js)

### Customer-facing + marketing
- [customer-invoices.js](backend/routes/customer-invoices.js)
- [messaging.js](backend/routes/messaging.js)
- [marketing.js](backend/routes/marketing.js)
- [subscriptions.js](backend/routes/subscriptions.js) — optional for retail
- [report-builder.js](backend/routes/report-builder.js)

---

## 3. Frontend Admin Pages Retail Merchants Use

Location: [frontend/src/pages/redesign/](frontend/src/pages/redesign/)

### Daily operations
- [DashboardRedesign.jsx](frontend/src/pages/redesign/DashboardRedesign.jsx) + 17 widgets in [pages/dashboard/](frontend/src/pages/dashboard/)
- [POSRedesign.jsx](frontend/src/pages/redesign/POSRedesign.jsx)
- [SalesHistoryRedesign.jsx](frontend/src/pages/redesign/SalesHistoryRedesign.jsx)
- [ParkedSalesRedesign.jsx](frontend/src/pages/redesign/ParkedSalesRedesign.jsx)
- [ReturnsRedesign.jsx](frontend/src/pages/redesign/ReturnsRedesign.jsx)
- [ReturnedStockRedesign.jsx](frontend/src/pages/redesign/ReturnedStockRedesign.jsx)
- [CashManagementRedesign.jsx](frontend/src/pages/redesign/CashManagementRedesign.jsx)
- [ActionHistoryRedesign.jsx](frontend/src/pages/redesign/ActionHistoryRedesign.jsx) — audit log

### Inventory + catalog
- [ProductsRedesign.jsx](frontend/src/pages/redesign/ProductsRedesign.jsx)
- [CategoriesRedesign.jsx](frontend/src/pages/redesign/CategoriesRedesign.jsx)
- [BrandsRedesign.jsx](frontend/src/pages/redesign/BrandsRedesign.jsx)
- [AttributeSetsRedesign.jsx](frontend/src/pages/redesign/AttributeSetsRedesign.jsx)
- [SmartCollectionsRedesign.jsx](frontend/src/pages/redesign/SmartCollectionsRedesign.jsx)
- [InventoryRedesign.jsx](frontend/src/pages/redesign/InventoryRedesign.jsx)
- [StockCountRedesign.jsx](frontend/src/pages/redesign/StockCountRedesign.jsx)
- [StockAdjustmentsRedesign.jsx](frontend/src/pages/redesign/StockAdjustmentsRedesign.jsx)
- [TransfersRedesign.jsx](frontend/src/pages/redesign/TransfersRedesign.jsx)
- [ReorderAlertsRedesign.jsx](frontend/src/pages/redesign/ReorderAlertsRedesign.jsx)
- [InventoryIntelligenceRedesign.jsx](frontend/src/pages/redesign/InventoryIntelligenceRedesign.jsx)

### Purchasing
- [PurchaseOrdersRedesign.jsx](frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx)
- [SuppliersRedesign.jsx](frontend/src/pages/redesign/SuppliersRedesign.jsx)
- [SupplierPayablesRedesign.jsx](frontend/src/pages/redesign/SupplierPayablesRedesign.jsx)

### Customers + marketing
- [CustomersRedesign.jsx](frontend/src/pages/redesign/CustomersRedesign.jsx)
- [CustomerGroupsRedesign.jsx](frontend/src/pages/redesign/CustomerGroupsRedesign.jsx)
- [CustomerGroupPriceBookRedesign.jsx](frontend/src/pages/redesign/CustomerGroupPriceBookRedesign.jsx)
- [LoyaltyTiersRedesign.jsx](frontend/src/pages/redesign/LoyaltyTiersRedesign.jsx)
- [CRMRedesign.jsx](frontend/src/pages/redesign/CRMRedesign.jsx)
- [QuotationsRedesign.jsx](frontend/src/pages/redesign/QuotationsRedesign.jsx)
- [CustomerInvoicesRedesign.jsx](frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx)
- [MarketingCampaignsRedesign.jsx](frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx)
- [MessagingInboxRedesign.jsx](frontend/src/pages/redesign/MessagingInboxRedesign.jsx)

### Pricing + promotions
- [PromotionsRedesign.jsx](frontend/src/pages/redesign/PromotionsRedesign.jsx)
- [PriceListsRedesign.jsx](frontend/src/pages/redesign/PriceListsRedesign.jsx)
- [ScheduledChangesRedesign.jsx](frontend/src/pages/redesign/ScheduledChangesRedesign.jsx)

### Operations + compliance
- [OutletsRedesign.jsx](frontend/src/pages/redesign/OutletsRedesign.jsx)
- [OutletTaxProfilesRedesign.jsx](frontend/src/pages/redesign/OutletTaxProfilesRedesign.jsx)
- [TaxesRedesign.jsx](frontend/src/pages/redesign/TaxesRedesign.jsx)
- [EmployeesRedesign.jsx](frontend/src/pages/redesign/EmployeesRedesign.jsx)
- [CommissionPlansRedesign.jsx](frontend/src/pages/redesign/CommissionPlansRedesign.jsx)
- [HRManagementRedesign.jsx](frontend/src/pages/redesign/HRManagementRedesign.jsx)
- [ReturnPoliciesRedesign.jsx](frontend/src/pages/redesign/ReturnPoliciesRedesign.jsx)
- [ApprovalsRedesign.jsx](frontend/src/pages/redesign/ApprovalsRedesign.jsx)
- [RetailRiskRedesign.jsx](frontend/src/pages/redesign/RetailRiskRedesign.jsx)

### Hardware + config
- [POSLayoutsRedesign.jsx](frontend/src/pages/redesign/POSLayoutsRedesign.jsx)
- [PrinterSettingsRedesign.jsx](frontend/src/pages/redesign/PrinterSettingsRedesign.jsx)
- [BarcodeTemplatesRedesign.jsx](frontend/src/pages/redesign/BarcodeTemplatesRedesign.jsx)
- [KioskRedesign.jsx](frontend/src/pages/redesign/KioskRedesign.jsx)
- [KioskOrderingRedesign.jsx](frontend/src/pages/redesign/KioskOrderingRedesign.jsx)
- [CustomerDisplayRedesign.jsx](frontend/src/pages/redesign/CustomerDisplayRedesign.jsx)

### Special features
- [GiftCardsAdminRedesign.jsx](frontend/src/pages/redesign/GiftCardsAdminRedesign.jsx)
- [HoldsRedesign.jsx](frontend/src/pages/redesign/HoldsRedesign.jsx)
- [ImportRedesign.jsx](frontend/src/pages/redesign/ImportRedesign.jsx)
- [AccountingRedesign.jsx](frontend/src/pages/redesign/AccountingRedesign.jsx)
- [BackupRestoreRedesign.jsx](frontend/src/pages/redesign/BackupRestoreRedesign.jsx)
- [CompanySettingsRedesign.jsx](frontend/src/pages/redesign/CompanySettingsRedesign.jsx)
- [ProfileRedesign.jsx](frontend/src/pages/redesign/ProfileRedesign.jsx)

### Integrations
- [IntegrationsHubRedesign.jsx](frontend/src/pages/redesign/IntegrationsHubRedesign.jsx)
- [ShopifyIntegrationRedesign.jsx](frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx)
- [WooCommerceIntegrationRedesign.jsx](frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx)
- [CourierSettingsRedesign.jsx](frontend/src/pages/redesign/CourierSettingsRedesign.jsx)
- [FulfillmentRedesign.jsx](frontend/src/pages/redesign/FulfillmentRedesign.jsx)
- [OrdersRedesign.jsx](frontend/src/pages/redesign/OrdersRedesign.jsx)
- [CODSettlementsRedesign.jsx](frontend/src/pages/redesign/CODSettlementsRedesign.jsx)
- [FBRSettingsRedesign.jsx](frontend/src/pages/redesign/FBRSettingsRedesign.jsx)
- [FBRDashboardRedesign.jsx](frontend/src/pages/redesign/FBRDashboardRedesign.jsx)
- [TaxLookupRedesign.jsx](frontend/src/pages/redesign/TaxLookupRedesign.jsx)

---

## 4. Reports Relevant to Retail

### Backend report modules ([backend/routes/reports/](backend/routes/reports/))
- [sales.js](backend/routes/reports/sales.js) — transaction summaries, trends, item-wise
- [inventory.js](backend/routes/reports/inventory.js) — movement, turnover, aging, reorder
- [purchasing.js](backend/routes/reports/purchasing.js) — PO, GRN, supplier analysis
- [finance.js](backend/routes/reports/finance.js) — P&L, revenue, cash flow, profit
- [shifts.js](backend/routes/reports/shifts.js) — shift summary, cash reconciliation
- [stock-aging.js](backend/routes/reports/stock-aging.js) — slow-moving inventory
- [analytics.js](backend/routes/reports/analytics.js) — drill-down queries
- [dashboard.js](backend/routes/reports/dashboard.js) — KPI snapshots
- [multichannel.js](backend/routes/reports/multichannel.js) — channel-wise sales
- [fbr-export.js](backend/routes/reports/fbr-export.js)
- [governance.js](backend/routes/reports/governance.js) — scheduled exports
- [helpers.js](backend/routes/reports/helpers.js)

### Frontend report pages ([frontend/src/pages/reports/](frontend/src/pages/reports/))
- ReportsSalesOverview / ReportsSalesCore / ReportsSalesDetail / ReportsSalesOperations
- ReportsInventoryCore / ReportsInventoryReplenishment / ReportsInventoryHealth
- ReportsPurchasing / ReportsFinance / ReportsShifts
- ReportsMultichannel / ReportsCatalog / ReportsAnalytics
- ReportsPowerUpPanel
- FBRExportTab

### Skip (non-retail)
ClinicalTab, KdsAnalyticsTab, MenuEngineeringTab.

---

## 5. Industry Preset Config

Location: [backend/config/industry-config.js](backend/config/industry-config.js)

| Preset | business_model | POS layout | Tare | Unit vocab | Portal tabs |
|---|---|---|---|---|---|
| general_retail | buy_sell | grid | no | pcs | invoices, orders, loyalty, profile |
| grocery | buy_sell | grid | no | pcs | invoices, orders, loyalty, profile |
| wholesale | b2b_distribution | grid | no | pcs | invoices, orders, profile |
| butcher | buy_sell | list | **yes** | kg, g, lb, pcs | invoices, orders, profile |
| sweet_shop | buy_sell | grid | **yes** | kg, g, dozen, pcs, pack | invoices, orders, loyalty, profile |
| textile | buy_sell | grid | no | m, cm, pcs, pack | invoices, orders, profile |

All retail presets enable barcode + SKU in POS search and show `inventory_alerts`, `top_products`, `trends`, `attendance` dashboard widgets.

---

## 6. Database Tables (Retail Hot Path)

### Core transactions
`sales`, `sale_items`, `sale_payments`, `sale_item_discounts`, `sale_discounts`, `sale_item_serials`
`returns`, `return_items`, `return_policies`, `return_reasons`
`parked_sales`, `holds`, `hold_items`, `hold_payments`
`gift_cards`, `gift_card_ranges`
`loyalty_tiers`, `loyalty_transactions`
`tip_pools`, `tip_pool_distribution_rules`, `tip_pool_payouts`

### Catalog
`products`, `product_variants`, `variant_option_values`, `product_serials`
`product_images`, `product_media`, `product_bundles`
`categories`, `brands`, `attribute_sets`
`smart_collections`, `smart_collection_rules`
`item_affinities`, `product_abc_class`
`scheduled_catalog_changes`

### Inventory
`outlet_stock`, `variant_outlet_stock`
`inventory_transfers`, `stock_adjustments`
`stock_counts`, `stock_count_items`
`cycle_count_schedules`, `cycle_count_sessions`
`inventory_reservations`

### Purchasing
`suppliers`, `supplier_invoices`, `supplier_payments`, `supplier_returns`
`purchase_orders`, `purchase_order_items`
`goods_received_notes`, `grn_items`

### People + roles
`customers`, `customer_groups`, `customer_group_members`
`customer_wallet_ledger`
`employees`, `roles`, `role_permissions`
`employee_attendance`, `attendance_sessions`, `scheduled_shifts`
`commission_plans`, `commission_plan_rules`, `commission_earnings`

### Config
`outlets`, `taxes`, `tax_rate_reference`
`promotions`, `price_lists`, `price_list_items`
`approval_policies`, `approval_events`, `override_reasons`
`pos_devices`, `pos_layouts`
`receipt_templates`, `barcode_templates`, `barcode_labels`
`cash_shifts`, `shift_denominations`, `cash_drops`
`expenses`, `expense_categories`
`feature_flags`, `company_profile`
`email_config`, `printer_config`

### Omnichannel
`web_orders`, `web_order_items`, `web_order_fulfillments`
`storefront_carts`, `storefront_cart_reservations`, `storefront_payment_sessions`
`courier_integrations`, `shipment_tracking_events`
`cod_settlement_batches`, `cod_settlement_lines`
`integration_settings`, `external_sync_events`
`fbr_invoices`

### Accounting + audit
`journal_entries`, `accounts`, `backup_log`
`action_history`, `retailer_anomaly_flags`

---

## 7. Feature Flags Gating Retail

### Phase 2 (core retail platform)
`phase2_draft_orders`, `phase2_pos_approvals`, `phase2_smart_collections`, `phase2_commissions`, `phase2_item_suggestions`, `phase2_outlet_pricing`, `phase2_outlet_tax`, `phase2_outlet_visibility`, `phase2_pos_layouts`, `phase2_report_builder`, `phase2_returns_policy`, `phase2_scheduled_changes`, `phase2_scheduling`

### Phase 2G (retail Tier-1 polish)
`phase2g_omni_input`, `phase2g_variant_picker`, `phase2g_gift_cards`, `phase2g_loyalty`, `phase2g_price_books`, `phase2g_price_override`, `phase2g_serialized_inventory`, `phase2g_per_line_restock`, `phase2g_inventory_intelligence`, `phase2g_receipt_barcode_lookup`, `phase2g_label_designer`, `phase2g_holds`, `phase2g_risk_controls`

### Phase 5 (Pakistan integrations)
`phase5_shipping_automation`, `phase5_cod_reconciliation`, `phase5_payment_gateways`, `phase5_sms_providers`

### Reports + marketplace
`reports_enhanced_filters`, `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions`, `reports_scheduled_exports`
`marketplace_integrations`, `fbr_integration`, `e_invoicing_export`

### Tier 4
`accounting_core`, `supplier_payables`, `approvals`, `notifications`, `crm_quotations`, `advanced_hr`, `backup_restore`, `multi_company`, `customer_invoicing`, `customer_messaging`, `marketing_campaigns`, `payment_links`, `subscription_billing`

### Context + kiosk
`context_selection_required`, `context_header_enforced`, `kiosk_context_locked`

### Skip (mode-gated, non-retail)
`phase4_restaurant*`, `phase4_appointments*`, `phase4_treatment_plans`, `phase4_rentals`, `phase4_room_management`, `phase4_workflow_tickets`, `phase4_service_projects`, `phase4_service_contracts`

---

## 8. Backend Services + Workers

### Services ([backend/services/](backend/services/))
- [printer.js](backend/services/printer.js) — ESC/POS + network printer
- [payment-gateway.js](backend/services/payment-gateway.js) — xPay adapter, extensible
- [pricing.js](backend/services/pricing.js) — discount/tax/total calc
- [approval-policy.js](backend/services/approval-policy.js) — override enforcement
- [catalog-scheduler.js](backend/services/catalog-scheduler.js) — scheduled price/promo
- [marketing.js](backend/services/marketing.js) — campaigns, coupons
- [customer-invoicing.js](backend/services/customer-invoicing.js)
- [inventory-intelligence.js](backend/services/inventory-intelligence.js) — reorder forecast
- [fbr.js](backend/services/fbr.js) — FBR API + payload
- [email.js](backend/services/email.js), [email-templates.js](backend/services/email-templates.js)
- [crypto.js](backend/services/crypto.js) — AES-256-GCM for integration secrets
- [logger.js](backend/services/logger.js) — Pino
- [alerting.js](backend/services/alerting.js)
- [boss.js](backend/services/boss.js) — pg-boss factory
- [couriers/](backend/services/couriers/) — 13 adapters
- [marketplace/](backend/services/marketplace/) — base, daraz, meta-commerce, whatsapp, google-merchant

### Workers ([backend/workers/](backend/workers/))
- `email-worker-boss.js` — receipt + transactional
- `fbr-worker-boss.js` — FBR invoice sync
- `retail-digest-worker-boss.js` — weekly metrics email
- `hold-expiry-worker-boss.js` — auto-expire holds
- `anomaly-worker-boss.js` — fraud/anomaly flags
- `scheduled-catalog-worker-boss.js` — applies future catalog changes
- `marketplace-sync-worker-boss.js` — Shopify/Woo/marketplace order poll
- `reservation-worker` — inventory reservation expiry
- `cleanup-worker-boss.js` — dead tenants

---

## 9. Middleware — All 9 Touch Retail

Location: [backend/middleware/](backend/middleware/)
- [tenant-auth.js](backend/middleware/tenant-auth.js) — JWT + tenant resolution + company profile cache
- [permissions.js](backend/middleware/permissions.js) — `requirePerm`, `requireAnyPerm`, role rules
- [feature-flags.js](backend/middleware/feature-flags.js) — flag cache, `requireFeature`
- [plan-limits.js](backend/middleware/plan-limits.js) — plan caps + subscription enforcement
- [validate.js](backend/middleware/validate.js) — Zod body validation
- [upload-validation.js](backend/middleware/upload-validation.js) — MIME + extension whitelist
- [rate-limit.js](backend/middleware/rate-limit.js) — global + auth + webhook limits
- [request-id.js](backend/middleware/request-id.js) — UUID per request
- `customer-auth.js` — B2B customer portal login

---

## 10. Offline / PWA / Kiosk / Customer Display

- [frontend/src/utils/offlineQueue.js](frontend/src/utils/offlineQueue.js) — offline sale queue
- [frontend/public/manifest.webmanifest](frontend/public/manifest.webmanifest) — installable PWA
- Service worker (frontend) — offline-capable POS
- [KioskRedesign.jsx](frontend/src/pages/redesign/KioskRedesign.jsx) — retail self-service kiosk
- [KioskOrderingRedesign.jsx](frontend/src/pages/redesign/KioskOrderingRedesign.jsx) — kiosk checkout
- [CustomerDisplayRedesign.jsx](frontend/src/pages/redesign/CustomerDisplayRedesign.jsx)
- [customer-display.js](backend/routes/customer-display.js) — backend API + WebSocket
- `hooks/useCustomerDisplay.js` — second-screen driver in POS
- `hooks/useOfflineQueue.js` — offline queue in POS

---

## 11. Zod Schemas ([backend/schemas/](backend/schemas/))

Retail-core: `sales.js`, `returns.js`, `purchase-orders.js`, `products.js`, `inventory.js`, `shifts.js`, `holds.js`, `smart-collections.js`, `gift-cards.js`, `customers.js`, `employees.js`, `modifiers.js`, `commissions.js`, `risk-controls.js`, `attendance.js`, `orders.js`, `pos-devices.js`, `scheduled-changes.js`, `marketing.js`, `customer-invoices.js`, `customer-portal.js`, `admin.js`, `auth.js`, `billing.js`, `integrations.js`, `messaging.js`.

---

## 12. Utility Files

### Frontend ([frontend/src/utils/](frontend/src/utils/))
- [receipt.js](frontend/src/utils/receipt.js) — receipt rendering (**hot path**)
- [offlineQueue.js](frontend/src/utils/offlineQueue.js) — offline sale queue
- [categoryTree.js](frontend/src/utils/categoryTree.js)
- [csvExport.js](frontend/src/utils/csvExport.js) — shared CSV download
- [dates.js](frontend/src/utils/dates.js) — UTC + local time formatters
- [theme.js](frontend/src/utils/theme.js) — dark mode

### Backend ([backend/utils/](backend/utils/))
- [receiptEmail.js](backend/utils/receiptEmail.js) — receipt HTML builder
- [digestEmail.js](backend/utils/digestEmail.js) — weekly digest
- [tz.js](backend/utils/tz.js) — timezone conversion (`toUtcStart`, `toUtcEnd`)
- [backup-pg.js](backend/utils/backup-pg.js) — DB backup/restore
- [r2.js](backend/utils/r2.js) — Cloudflare R2 uploads
- [alertEmail.js](backend/utils/alertEmail.js)
- [resendEmail.js](backend/utils/resendEmail.js)

---

## 13. Integrations Retail Uses

- **Ecommerce** — Shopify ([routes/shopify/](backend/routes/shopify/), 9 files), WooCommerce ([woocommerce.js](backend/routes/woocommerce.js))
- **Marketplaces** — Daraz, Facebook Shop, Google Merchant, WhatsApp Commerce ([routes/integrations/](backend/routes/integrations/))
- **Compliance** — FBR Digital Invoicing ([fbr.js](backend/routes/fbr.js), [tax-lookup.js](backend/routes/tax-lookup.js))
- **Logistics** — 13 courier adapters in [services/couriers/](backend/services/couriers/): leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex
- **Payments** — xPay adapter, sandbox, manual ([services/payment-gateway.js](backend/services/payment-gateway.js))
- **Email** — Resend (system) + SMTP (tenant receipts) via [services/email.js](backend/services/email.js)

---

## 14. Admin Surface That Affects Retail Merchants

Even though super-admin routes mount before tenant middleware, these affect the retail merchant experience:
- [admin/tenants.js](backend/routes/admin/tenants.js) — plan, preset, limits
- [admin/billing.js](backend/routes/admin/billing.js) — plan tier = feature access
- [admin/compliance.js](backend/routes/admin/compliance.js) — tax rate CRUD, FBR health
- [admin/messaging.js](backend/routes/admin/messaging.js) — announcements, broadcast
- [admin/system.js](backend/routes/admin/system.js) — worker status, orphaned schemas
- Impersonation banner ([ImpersonationBanner.jsx](frontend/src/ui/ImpersonationBanner.jsx)) and announcements banner ([AnnouncementBanner.jsx](frontend/src/ui/AnnouncementBanner.jsx)) show on retail merchant pages.

---

## Where to Focus Improvements

### Priority order (highest leverage first)

1. **POS screen** — [pos/](frontend/src/pages/redesign/pos/) (50+ files). This is where 90% of merchant time is spent. Polish `cartMath.js`, `omniInputRouter.js`, offline queue, customer display, kiosk.

2. **[products.js](backend/routes/products.js) (1,579 lines) and the catalog stack** — products, variants, categories, brands, attribute-sets, smart-collections, price-lists, serials, bundles, images, scheduled changes. Drives POS search, variants, pricing, stock.

3. **Inventory loop** — PO → GRN → outlet_stock → transfers → stock counts → cycle counts → reorder alerts → inventory-intelligence worker. Grocery and wholesale merchants live here.

4. **Reports merchants actually open daily** — sales overview, item-wise, shift summary, inventory health, profit, multichannel. The rest are edge-case.

5. **Receipt + printing + customer display + kiosk + offline/PWA** — retail's "proof of trust" surface. Hardware edge cases.

6. **Commissions + attendance + cash management + expenses** — back-office every retail owner checks weekly.

7. **Integrations hardening** — Shopify, WooCommerce, 6 marketplace clients, 13 courier adapters, FBR, payment gateway. Mostly built; needs bug-fix passes, not more surface area.

### What to freeze / hide / remove

- Freeze deeper vertical work on salon/clinic/repair/rental/hotel/clinical presets — they work, don't extend.
- Hide non-retail nav entries behind `enabled_modes` so retail merchants don't see restaurant / appointment / rental / room / ticket features.
- Consider whether `subscription_billing`, `service_projects`, `service_contracts`, `treatment_plans` need to exist at all in the retail+restaurant focus.

---

## Summary

The retail surface covers:
- **~45 backend routes** + 6 tier4 + 10 admin + 12 report modules
- **~60+ frontend pages** + 50 POS files + 17 dashboard widgets
- **~80+ database tables**
- **~45 feature flags**
- **9 workers**, **20+ services**, **9 middleware**
- **~25 Zod schemas**
- **8 integration surfaces**

Focus the next phase of work on the 7 priorities above. Everything else is already built and mostly needs polish, not new code.

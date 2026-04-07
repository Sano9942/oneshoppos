# Domain Map — End-to-End Feature Index

> When working on a feature, find the domain below to see every file involved — backend route, schema, permissions, feature flags, frontend page, DB tables, workers, and related files.

---

## Sales / POS

- **Backend route**: `routes/sales.js`
- **Schema**: `schemas/sales.js` (CreateSaleSchema, VoidSaleSchema)
- **Permissions**: `manage_inventory`, `void_sales`
- **Feature flags**: none
- **Frontend page**: `pages/redesign/POSRedesign.jsx`
- **Frontend state**: `pages/redesign/pos/POSContext.jsx` (130+ exports)
- **Frontend subcomponents**: `pos/POSCheckoutModal`, `pos/POSReceiptModal`, `pos/POSDiscountModal`, `pos/POSReturnExchangeModal`, `pos/POSSessionExpiredModal`, `pos/POSEmailReceiptModal`, `pos/POSRecentSalesPanel`, `pos/POSShortcutsOverlay`, `pos/POSParkedModal`, `pos/POSLockScreen`, `pos/cartMath.js`
- **Route path**: `/pos` (public route, ErrorBoundary wrapped)
- **Nav entry**: "POS" (opens in new tab)
- **DB tables**: `sales`, `sale_items`, `sale_payments`, `cash_shifts`, `invoice_sequences`, `parked_sales`, `parked_sale_items`
- **Workers**: `workers/fbr-worker-boss.js` (async FBR invoice posting, if enabled)
- **Related**: `routes/receipts.js`, `services/printer.js`, `services/fbr.js`, `utils/receipt.js` (frontend)

---

## Sales History

- **Backend route**: `routes/sales.js` (GET endpoints)
- **Permissions**: `view_reports`
- **Frontend page**: `pages/redesign/SalesHistoryRedesign.jsx`
- **Route path**: `/sales-history`
- **Nav entry**: "Sales History"
- **DB tables**: `sales`, `sale_items`, `customers`, `employees`

---

## Returns

- **Backend route**: `routes/returns.js`
- **Schema**: `schemas/returns.js` (CreateReturnSchema)
- **Permissions**: `manage_orders`
- **Feature flags**: none
- **Frontend page**: `pages/redesign/ReturnsRedesign.jsx`
- **Route path**: `/returns`
- **Nav entry**: "Returns"
- **DB tables**: `returns`, `return_items`, `sales` (original_sale_id FK)
- **Related**: POS return/exchange via `pos/POSReturnExchangeModal.jsx`

---

## Products

- **Backend route**: `routes/products.js` (~912 lines)
- **Schema**: `schemas/products.js` (CreateProductSchema, BulkDeleteSchema, BulkStatusSchema)
- **Permissions**: `manage_inventory` (write), `view_reports` + `manage_inventory` (read)
- **Feature flags**: none
- **Frontend page**: `pages/redesign/InventoryRedesign.jsx` (product list), `pages/redesign/ProductFormPage.jsx` (create/edit)
- **Route path**: `/inventory`, `/products/new`, `/products/:id`
- **Nav entry**: "Products"
- **DB tables**: `products`, `product_variants`, `variant_option_values`, `product_media`, `product_bundles`, `product_serial_numbers`, `outlet_stock`
- **Related**: `routes/import.js` (bulk CSV/XLSX import)

---

## Categories

- **Backend route**: `routes/categories.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/CategoriesRedesign.jsx`
- **Route path**: `/categories`
- **Nav entry**: "Categories"
- **DB tables**: `categories` (self-referencing parent_id for tree)
- **Related**: `category-tree.js` (tree enrichment + `resolveInheritedField` for FBR tax/HS inheritance)

---

## Brands

- **Backend route**: `routes/brands.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/BrandsRedesign.jsx`
- **Route path**: `/brands`
- **Nav entry**: "Brands"
- **DB tables**: `brands`

---

## Taxes

- **Backend route**: `routes/taxes.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/TaxesRedesign.jsx`
- **Route path**: `/taxes`
- **Nav entry**: "Taxes"
- **DB tables**: `taxes`

---

## Attribute Sets

- **Backend route**: `routes/attribute-sets.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/AttributeSetsRedesign.jsx`
- **Route path**: `/attribute-sets`
- **Nav entry**: "Attribute Sets"
- **DB tables**: `attribute_sets`, `attributes`, `attribute_options`

---

## Inventory — Transfers

- **Backend route**: `routes/inventory.js` (transfer endpoints)
- **Permissions**: `manage_inventory`
- **Feature flags**: `approvals` (if approval workflow enabled)
- **Frontend page**: `pages/redesign/TransfersRedesign.jsx`
- **Route path**: `/transfers`
- **Nav entry**: "Transfers"
- **DB tables**: `inventory_transfers`, `outlet_stock`

---

## Inventory — Stock Adjustments

- **Backend route**: `routes/inventory.js` (adjustment endpoints)
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/StockAdjustmentsRedesign.jsx`
- **Route path**: `/adjustments`
- **Nav entry**: "Stock Adjustments"
- **DB tables**: `stock_adjustments`, `outlet_stock`

---

## Inventory — Stock Counts (Audit)

- **Backend route**: `routes/inventory.js` (stock count endpoints)
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/StockCountRedesign.jsx`
- **Route path**: `/stock-counts`
- **Nav entry**: "Inventory Audit"
- **DB tables**: `stock_counts`, `stock_count_items`, `outlet_stock`

---

## Inventory — Reorder Alerts

- **Frontend page**: `pages/redesign/ReorderAlertsRedesign.jsx`
- **Route path**: `/reorder-alerts`
- **Nav entry**: "Reorder Alerts"
- **Backend**: Uses `GET /api/reports/replenishment-smart`

---

## Customers

- **Backend route**: `routes/customers.js`
- **Schema**: `schemas/customers.js` (CreateCustomerSchema, UpdateCustomerSchema)
- **Permissions**: `manage_customers`
- **Frontend page**: `pages/redesign/CustomersRedesign.jsx`
- **Route path**: `/customers`
- **Nav entry**: "Customers"
- **DB tables**: `customers`, `customer_wallet_ledger`

---

## Customer Groups

- **Backend route**: `routes/customers.js` (group endpoints)
- **Frontend page**: `pages/redesign/CustomerGroupsRedesign.jsx`
- **Route path**: `/customer-groups`
- **Nav entry**: "Customer Groups"
- **DB tables**: `customer_groups`

---

## Loyalty Tiers

- **Backend route**: `routes/customers.js` (loyalty endpoints)
- **Frontend page**: `pages/redesign/LoyaltyTiersRedesign.jsx`
- **Route path**: `/loyalty-tiers`
- **Nav entry**: "Loyalty Tiers"
- **DB tables**: `loyalty_tiers`

---

## CRM / Leads

- **Backend route**: `routes/tier4/crm.js`
- **Permissions**: `manage_orders`
- **Feature flags**: `crm_quotations`
- **Frontend page**: `pages/redesign/CRMRedesign.jsx`
- **Route path**: `/crm`
- **Nav entry**: "CRM"
- **DB tables**: `crm_leads`, `crm_activities`

---

## Quotations

- **Backend route**: `routes/tier4/crm.js` (quotation endpoints)
- **Feature flags**: `crm_quotations`
- **Frontend page**: `pages/redesign/QuotationsRedesign.jsx`
- **Route path**: `/quotations`
- **Nav entry**: "Quotations"
- **DB tables**: `quotations`, `quotation_items`
- **Note**: Must PUT status to `accepted` before `convert` works

---

## Suppliers

- **Backend route**: `routes/suppliers.js`
- **Permissions**: `manage_orders`
- **Frontend page**: `pages/redesign/SuppliersRedesign.jsx`
- **Route path**: `/suppliers`
- **Nav entry**: "Suppliers"
- **DB tables**: `suppliers`

---

## Purchase Orders

- **Backend route**: `routes/purchase-orders.js`
- **Schema**: `schemas/purchase-orders.js` (CreatePOSchema)
- **Permissions**: `manage_orders`
- **Feature flags**: `approvals` (if approval workflow enabled)
- **Frontend page**: `pages/redesign/PurchaseOrdersRedesign.jsx`
- **Route path**: `/purchase-orders`
- **Nav entry**: "Purchase Orders"
- **DB tables**: `purchase_orders`, `purchase_order_items`, `po_templates`, `po_template_items`

---

## GRN / Supplier Payables

- **Backend route**: `routes/grn.js`
- **Permissions**: `manage_orders`
- **Feature flags**: `supplier_payables`
- **Frontend page**: `pages/redesign/SupplierPayablesRedesign.jsx`
- **Route path**: `/supplier-payables`
- **Nav entry**: "Supplier Payables"
- **DB tables**: `goods_received_notes`, `grn_items`, `supplier_invoices`, `supplier_payments`

---

## Supplier Returns

- **Backend route**: `routes/grn.js` (supplier return endpoints)
- **Permissions**: `manage_orders`
- **Frontend page**: `pages/redesign/ReturnedStockRedesign.jsx`
- **Route path**: `/returned-stock`
- **Nav entry**: "Returned Stock"
- **DB tables**: `supplier_returns`, `supplier_return_items`

---

## Cash Shifts

- **Backend route**: `routes/shifts.js`
- **Permissions**: `view_reports`
- **Frontend page**: `pages/redesign/CashManagementRedesign.jsx`
- **Route path**: `/cash-management`
- **Nav entry**: "Cash Management"
- **DB tables**: `cash_shifts`, `shift_denominations`

---

## Promotions

- **Backend route**: `routes/promotions.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/PromotionsRedesign.jsx`
- **Route path**: `/promotions`
- **Nav entry**: "Promotions"
- **DB tables**: `promotions`

---

## Price Lists

- **Backend route**: `routes/products.js` (price list endpoints)
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/PriceListsRedesign.jsx`
- **Route path**: `/price-lists`
- **Nav entry**: "Price Lists"
- **DB tables**: `price_lists`, `price_list_items`

---

## Expenses

- **Backend route**: `routes/barcode-expenses.js` (expense endpoints)
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/ExpensesRedesign.jsx`
- **Route path**: `/expenses`
- **Nav entry**: "Expenses"
- **DB tables**: `expenses`, `expense_categories`

---

## Web Orders

- **Backend route**: `routes/orders.js`
- **Schema**: `schemas/orders.js` (BulkUpdateOrdersSchema, MarkCompleteSchema)
- **Permissions**: `manage_orders`
- **Frontend page**: `pages/redesign/OrdersRedesign.jsx`
- **Route path**: `/orders`
- **Nav entry**: "Orders"
- **DB tables**: `web_orders`, `web_order_items`, `web_order_transactions`, `web_order_fulfillments`

---

## Fulfillment (Pick/Pack/Dispatch)

- **Backend route**: `routes/fulfillment.js`
- **Permissions**: `manage_orders`
- **Frontend page**: `pages/redesign/FulfillmentRedesign.jsx`
- **Route path**: `/fulfillment`
- **Nav entry**: "Fulfillment"
- **DB tables**: `picklists`, `picklist_items`, `loadsheets`, `loadsheet_orders`

---

## Employees

- **Backend route**: `routes/employees.js`
- **Schema**: `schemas/employees.js` (CreateEmployeeSchema, SetPasswordSchema, ChangePasswordSchema, ChangePinSchema, ValidatePinSchema)
- **Permissions**: `all_access` (CRUD), self-service for profile/PIN/password
- **Frontend page**: `pages/redesign/EmployeesRedesign.jsx`
- **Route path**: `/employees`
- **Nav entry**: "Employees"
- **DB tables**: `employees`, `employee_outlets`, `roles`, `role_permissions`
- **Related**: `pages/redesign/ProfileRedesign.jsx` (self-service profile at `/profile`)

---

## Roles / Administrator

- **Backend route**: `routes/roles.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/AdministratorRedesign.jsx`
- **Route path**: `/administrator`
- **Nav entry**: "Administrator"
- **DB tables**: `roles`, `role_permissions`

---

## Outlets

- **Backend route**: `routes/outlets.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/OutletsRedesign.jsx`
- **Route path**: `/outlets`
- **Nav entry**: "Outlets"
- **DB tables**: `outlets`

---

## Attendance / Kiosk

- **Backend route**: `routes/attendance.js`
- **Permissions**: public (PIN-based for kiosk), `manage_employees` (admin views)
- **Frontend page**: `pages/redesign/AttendanceRedesign.jsx` (admin), `pages/redesign/KioskRedesign.jsx` (kiosk)
- **Route path**: `/attendance`, `/kiosk`
- **Nav entry**: "Attendance", "Kiosk" (new tab)
- **DB tables**: `employee_attendance`, `attendance_sessions`

---

## HR (Leave / Payroll)

- **Backend route**: `routes/tier4/hr.js`
- **Feature flags**: `advanced_hr`
- **Frontend page**: `pages/redesign/HRManagementRedesign.jsx`
- **Route path**: `/hr`
- **Nav entry**: "HR"
- **DB tables**: `leave_requests`, `payroll_periods`, `payroll_lines`, `hr_payroll_lines`

---

## Accounting — Chart of Accounts

- **Backend route**: `routes/tier4/accounting.js`
- **Feature flags**: `accounting_core`
- **Frontend page**: `pages/redesign/ChartOfAccountsRedesign.jsx`
- **Route path**: `/chart-of-accounts`
- **Nav entry**: "Chart of Accounts"
- **DB tables**: `chart_of_accounts`, `accounting_periods`

---

## Accounting — Journal Entries

- **Backend route**: `routes/tier4/accounting.js`
- **Feature flags**: `accounting_core`
- **Frontend page**: `pages/redesign/JournalEntriesRedesign.jsx`
- **Route path**: `/journal-entries`
- **Nav entry**: "Journal Entries"
- **DB tables**: `journal_entries`, `journal_entry_lines`

---

## Accounting — Credit/Debit Notes

- **Backend route**: `routes/tier4/accounting.js`
- **Feature flags**: `accounting_core`
- **Frontend page**: `pages/redesign/CreditDebitNotesRedesign.jsx`
- **Route path**: `/credit-debit-notes`
- **Nav entry**: "Credit/Debit Notes"
- **DB tables**: `credit_notes`, `debit_notes`

---

## Accounting — Post-Dated Cheques

- **Backend route**: `routes/tier4/accounting.js`
- **Feature flags**: `accounting_core`
- **Frontend page**: `pages/redesign/PostdatedChequesRedesign.jsx`
- **Route path**: `/postdated-cheques`
- **Nav entry**: "Post-Dated Cheques"
- **DB tables**: `postdated_cheques`

---

## Approvals

- **Backend route**: `routes/tier4/approvals.js`
- **Feature flags**: `approvals`
- **Permissions**: `manage_orders`, `manage_employees`
- **Frontend page**: `pages/redesign/ApprovalsRedesign.jsx` (wraps legacy `Approvals.jsx`)
- **Route path**: `/approvals`
- **DB tables**: `approval_requests`, `approval_actions`

---

## Notifications

- **Backend route**: `routes/tier4/notifications.js`
- **Feature flags**: `notifications`
- **Frontend page**: `pages/redesign/NotificationsRedesign.jsx`
- **Route path**: `/notifications`
- **Nav entry**: "Notifications"
- **DB tables**: `notifications`
- **Note**: Mark-read is `PUT /api/notifications/read-all` (not POST)

---

## Parked Sales

- **Backend route**: `routes/parked-sales.js`
- **Permissions**: `pos_park`
- **Frontend page**: `pages/redesign/ParkedSalesRedesign.jsx`
- **Route path**: `/parked-sales`
- **Nav entry**: "Parked Sales"
- **DB tables**: `parked_sales`, `parked_sale_items`

---

## Reports

- **Backend routes**: `routes/reports/` (12 files: dashboard, sales, inventory, analytics, purchasing, finance, staff, shifts, governance, fbr-export, stock-aging, multichannel)
- **Permissions**: `view_reports` (all), some feature-gated (see below)
- **Feature flags**: `reports_profit_layer` (sales profit), `reports_inventory_health_plus` (inventory advanced), `reports_exceptions` (analytics exceptions), `reports_scheduled_exports` (governance schedules), `e_invoicing_export` (FBR export)
- **Frontend orchestrator**: `pages/Reports.jsx` (delegates to `pages/reports/*.jsx` — 23 module files)
- **Route path**: `/reports`, `/reports/:tabId`
- **Nav entry**: "Reports"
- **DB tables**: (reads from most tables — sales, products, customers, inventory, shifts, etc.)
- **Governance tables**: `report_schedules`, `report_schedule_runs`, `report_delivery_log`, `saved_report_views`, `report_definition_versions`

---

## Dashboard

- **Backend route**: `routes/reports/dashboard.js`, `routes/insights.js`, `routes/insights-ai.js`
- **Feature flags**: `ai_insights` (AI chat panel)
- **Frontend page**: `pages/redesign/DashboardRedesign.jsx`
- **Frontend modules**: `pages/dashboard/` (17 files — KPI cards, trends, top products, attendance, onboarding, InsightCards, AIChatPanel, BackupStatusCard, etc.)
- **Route path**: `/dashboard`
- **Nav entry**: "Dashboard"
- **Env vars**: `ANTHROPIC_API_KEY` (for AI insights)

---

## Shopify Integration

- **Backend routes**: `routes/shopify/` (8 files: config, health, sync, orders, import, mappings, webhooks, reconciliation)
- **Permissions**: `manage_orders`
- **Feature flags**: `shopify_integration` (implicitly, via connection check)
- **Frontend page**: `pages/redesign/ShopifyIntegrationRedesign.jsx`
- **Frontend modules**: `pages/shopify/` (7 files — Overview, Settings, Import, Reconciliation, Mappings, Events, ShopifyContext)
- **Route path**: `/integrations/shopify`
- **Nav entry**: "Shopify Integration"
- **DB tables**: `shopify_connections`, `shopify_product_map`, `shopify_product_metadata`, `shopify_location_map`, `shopify_order_map`, `shopify_customer_map`, `shopify_sync_runs`, `external_sync_events`
- **Related**: `shopify/crypto.js` (secret encrypt/decrypt), `inventory_reconciliation` table
- **Env vars**: `SHOPIFY_SECRET_KEY`

---

## WooCommerce Integration

- **Backend route**: `routes/woocommerce.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/WooCommerceIntegrationRedesign.jsx`
- **Route path**: `/integrations/woocommerce`
- **Nav entry**: "WooCommerce"
- **DB tables**: `integration_settings`

---

## FBR Digital Invoicing

- **Backend routes**: `routes/fbr.js` (config, dashboard, retry), `routes/tax-lookup.js` (HS code search, suggest)
- **Feature flags**: `fbr_integration`
- **Frontend pages**: `pages/redesign/FBRSettingsRedesign.jsx` (`/settings/fbr`), `pages/redesign/FBRDashboardRedesign.jsx` (`/fbr`), `pages/redesign/TaxLookupRedesign.jsx` (`/tax-lookup`)
- **Nav entries**: "FBR Settings", "FBR Invoices", "Tax Lookup"
- **DB tables**: `fbr_invoices`, `tax_rate_reference`, `tax_rate_suggestions`
- **Workers**: `workers/fbr-worker.js` (legacy inline), `workers/fbr-worker-boss.js` (pg-boss)
- **Services**: `services/fbr.js` (API client + payload builders)
- **Related**: `category-tree.js:resolveInheritedField()` (HS code/tax inheritance), `company_profile.fbr_*` columns

---

## Courier / Delivery Dispatch

- **Backend route**: `routes/couriers.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/CourierSettingsRedesign.jsx`
- **Route path**: `/courier-settings`
- **Nav entry**: "Delivery Couriers"
- **DB tables**: `courier_integrations` (10 pre-seeded Pakistan couriers)
- **Services**: `services/couriers/` (base-adapter, generic-adapter, leopards-adapter, index)

---

## Bulk Import

- **Backend route**: `routes/import.js`
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/ImportRedesign.jsx`
- **Route path**: `/import`
- **Nav entry**: "Import Data"
- **Endpoints**: `POST /api/import/{products,customers,suppliers}` with `?preview=1`, `GET /api/import/template/:entity`

---

## Billing / Subscription

- **Backend route**: `routes/billing.js`
- **Schema**: `schemas/billing.js`
- **Frontend page**: `pages/redesign/BillingRedesign.jsx`
- **Route path**: `/billing`
- **Nav entry**: "Billing"
- **DB tables**: `plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`
- **Middleware**: `requireActiveSubscription` (gates all writes), `requirePlanLimit` (caps resources)
- **Services**: `services/payment-gateway.js` (xPay adapter)
- **Webhooks**: `routes/webhooks.js` (`POST /api/webhooks/xpay`, HMAC-verified)
- **Env vars**: `PAYMENT_GATEWAY`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`

---

## Support Tickets

- **Backend route**: `routes/support.js`
- **Permissions**: `all_access` (create), super-admin (manage)
- **Frontend**: `ui/SupportWidget.jsx` (floating form), `pages/redesign/MyTicketsRedesign.jsx` (tenant viewer)
- **Route path**: `/my-tickets`
- **Nav entry**: "My Tickets"
- **DB tables**: `support_tickets`
- **Admin**: `pages/admin/AdminSupportTickets.jsx`

---

## Email

- **Backend route**: `routes/email.js` (send receipt, config)
- **Services**: `services/email.js` (unified sendEmail + enqueueEmail), `services/email-templates.js` (14 email types)
- **Workers**: `workers/email-worker.js` (legacy), `workers/email-worker-boss.js` (pg-boss)
- **DB tables**: `email_queue`, `email_config`
- **Env vars**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_WORKER_ENABLED`

---

## Receipts (Public)

- **Backend route**: `routes/receipts.js` (`GET /api/receipts/:invoiceNumber/public?tenant=slug`)
- **Frontend page**: `pages/ReceiptPublicPage.jsx`
- **Route path**: `/receipt/:invoiceNumber` (public, no auth)
- **Related**: `utils/receipt.js` (buildReceiptSections, buildReceiptHtml)

---

## Barcode Templates

- **Backend route**: `routes/barcode-expenses.js` (barcode endpoints)
- **Permissions**: `manage_inventory`
- **Frontend page**: `pages/redesign/BarcodeTemplatesRedesign.jsx`
- **Route path**: `/barcode-templates`
- **Nav entry**: "Barcode Templates"
- **DB tables**: `barcode_templates`, `barcode_print_jobs`

---

## Receipt Templates

- **Backend route**: `routes/receipt-templates.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/ReceiptTemplatesRedesign.jsx`
- **Route path**: `/receipt-templates`
- **Nav entry**: "Receipt Templates"
- **DB tables**: `receipt_templates`

---

## Printer / Email Config

- **Backend route**: `routes/printer.js` (printer), `routes/email.js` (email config)
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/PrinterSettingsRedesign.jsx`
- **Route path**: `/printer-settings`
- **Nav entry**: "Printer Settings"
- **DB tables**: `printer_config`, `email_config`
- **Services**: `services/printer.js` (ESC/POS + TCP network printing)

---

## Company Settings

- **Backend route**: `routes/tier4/company-profile.js`
- **Permissions**: `all_access`
- **Frontend page**: `pages/redesign/CompanySettingsRedesign.jsx`
- **Route path**: `/company-settings`
- **Nav entry**: "Company Profile"
- **DB tables**: `company_profile`

---

## Backup / Restore

- **Backend route**: `utils/backup-pg.js`
- **Feature flags**: `backup_restore`
- **Frontend page**: `pages/redesign/BackupRestoreRedesign.jsx`
- **Route path**: `/backup-restore`
- **Nav entry**: "Backup"
- **DB tables**: `backup_log`

---

## Action History

- **Frontend page**: `pages/redesign/ActionHistoryRedesign.jsx`
- **Route path**: `/action-history`
- **Nav entry**: "Action History"
- **DB tables**: `action_history`
- **API params**: `date_from`/`date_to` (not `start`/`end`)

---

## Product Reviews

- **Backend route**: `routes/products.js` (review endpoints)
- **Frontend page**: `pages/redesign/ReviewModerationRedesign.jsx`
- **Route path**: `/review-moderation`
- **Nav entry**: "Review Moderation"
- **DB tables**: `product_reviews`

---

## Gift Cards

- **Backend route**: `routes/products.js` (gift card endpoints)
- **DB tables**: `gift_cards`
- **Note**: Managed via InventoryRedesign.jsx

---

## Authentication

- **Backend route**: `routes/auth.js`
- **Schema**: `schemas/auth.js` (LoginSchema, MtLoginSchema, KioskLoginSchema, ForgotPasswordSchema, ResetPasswordSchema, SignupSchema)
- **Frontend**: `auth/AuthProvider.jsx` (interceptor), `auth/authStore.js` (token storage)
- **Public pages**: `pages/LandingPage.jsx` (login), `pages/SignupPage.jsx`, `pages/ResetPassword.jsx`
- **DB tables**: `employees`, `password_reset_tokens`, `revoked_tokens`
- **Env vars**: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SELF_SERVICE_SIGNUP`

---

## Setup Wizard

- **Backend route**: `routes/setup.js`
- **Frontend page**: loaded via public routes
- **Route path**: `/setup`
- **DB tables**: `company_profile`, `employees`, `roles`, `outlets`

---

## Super-Admin Panel

- **Backend routes**: `routes/admin/` (8 modules: auth, tenants, monitoring, billing, operations, compliance, messaging, system)
- **Auth**: `requireSuperAdmin` (separate JWT), `requireAllowedIp`
- **Frontend pages**: `pages/admin/` (10 files)
  - `AdminLogin.jsx` → `/admin/login`
  - `AdminDashboard.jsx` → `/admin` (revenue stats, worker status, orphaned schemas, announcements)
  - `AdminTenantList.jsx` → `/admin/tenants`
  - `AdminTenantDetail.jsx` → `/admin/tenants/:id` (impersonation, billing, flags, notes)
  - `AdminSupportTickets.jsx` → `/admin/support`
  - `AdminEmails.jsx` → `/admin/emails` (queue, broadcast)
  - `AdminDeadLetters.jsx` → `/admin/dead-letters`
  - `AdminTaxRates.jsx` → `/admin/tax-rates`
  - `AdminActivity.jsx` → `/admin/activity` (3 tabs: admin, tenant, security)
- **DB tables (public schema)**: `tenants`, `admin_activity_log`, `admin_security_log`, `tenant_notes`, `announcements`, `broadcast_log`, `impersonation_sessions`
- **Related**: `ui/ImpersonationBanner.jsx`, `auth/adminAuthStore.js`

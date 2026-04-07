# DB Relationships — Quick FK Reference

> Condensed foreign key graph grouped by domain. For full column definitions, see `backend/schema-pg.sql`.

---

## Auth & Organization

```
employees → roles (role_id)
employee_outlets → employees (employee_id), outlets (outlet_id)
role_permissions → roles (role_id)
password_reset_tokens → employees (employee_id)
revoked_tokens — standalone (employee_id is informational)
```

## Products & Catalog

```
products → categories (category_id), taxes (tax_id), brands (brand_id), suppliers (supplier_id), attribute_sets (attribute_set_id)
product_variants → products (product_id)
variant_option_values → product_variants (variant_id), attributes (attribute_id), attribute_options (attribute_option_id)
product_media → products (product_id), product_variants (variant_id)
product_bundles → products (product_id, component_product_id), product_variants (component_variant_id)
product_serial_numbers → products (product_id)
product_reviews → products (product_id), customers (customer_id), employees (moderated_by), sales (sale_id)
categories → categories (parent_id — self-referencing tree)
attributes → attribute_sets (attribute_set_id)
attribute_options → attributes (attribute_id)
```

## Inventory

```
outlet_stock → products (product_id), outlets (outlet_id)
stock_adjustments → products (product_id), outlets (outlet_id), employees (employee_id)
inventory_transfers → products (product_id), outlets (from_outlet_id, to_outlet_id), employees (employee_id)
inventory_reconciliation → products (product_id), product_variants (variant_id), outlets (outlet_id)
stock_counts → outlets (outlet_id), employees (started_by, completed_by)
stock_count_items → stock_counts (stock_count_id), products (product_id), product_variants (variant_id)
```

## Pricing & Promotions

```
price_list_items → price_lists (price_list_id), products (product_id), product_variants (variant_id)
promotions → products (product_id), categories (category_id)
```

## Customers & CRM

```
customers → customer_groups (customer_group_id), loyalty_tiers (loyalty_tier_id), price_lists (price_list_id)
customer_wallet_ledger → customers (customer_id)
crm_leads → employees (assigned_to), customers (customer_id)
crm_activities → crm_leads (lead_id), employees (employee_id)
quotations → crm_leads (lead_id), customers (customer_id), outlets (outlet_id), employees (employee_id), sales (converted_sale_id)
quotation_items → quotations (quotation_id), products (product_id), product_variants (variant_id)
```

## Sales & POS

```
sales → outlets (outlet_id), employees (employee_id), customers (customer_id), cash_shifts (shift_id)
sale_items → sales (sale_id), products (product_id), product_variants (variant_id)
sale_payments → sales (sale_id)
cash_shifts → outlets (outlet_id), employees (employee_id)
shift_denominations → cash_shifts (shift_id)
parked_sales → employees (employee_id), outlets (outlet_id), customers (customer_id)
parked_sale_items → parked_sales (parked_sale_id), products (product_id), product_variants (variant_id)
invoice_sequences — standalone (year PK, last_seq)
```

## Returns

```
returns → outlets (outlet_id), employees (employee_id), customers (customer_id), cash_shifts (shift_id)
return_items → returns (return_id), products (product_id), product_variants (variant_id)
```

## Procurement & Suppliers

```
purchase_orders → suppliers (supplier_id)
purchase_order_items → purchase_orders (po_id), products (product_id)
po_templates → suppliers (supplier_id)
po_template_items → po_templates (template_id), products (product_id)
goods_received_notes → purchase_orders (po_id), outlets (outlet_id), employees (received_by)
grn_items → goods_received_notes (grn_id), products (product_id)
supplier_invoices → suppliers (supplier_id), purchase_orders (po_id), goods_received_notes (grn_id)
supplier_payments → supplier_invoices (supplier_invoice_id), suppliers (supplier_id)
supplier_returns → suppliers (supplier_id), employees (employee_id), outlets (outlet_id)
supplier_return_items → supplier_returns (supplier_return_id), products (product_id), product_variants (variant_id)
```

## HR & Attendance

```
employee_attendance → employees (employee_id), outlets (outlet_id)
attendance_sessions → employee_attendance (attendance_id), employees (employee_id), outlets (outlet_id)
leave_requests → employees (employee_id, approved_by)
payroll_periods → employees (created_by)
payroll_lines → payroll_periods (period_id), employees (employee_id)
hr_payroll_lines → payroll_periods (period_id), employees (employee_id)
```

## Accounting

```
chart_of_accounts → chart_of_accounts (parent_id — self-referencing tree)
journal_entries → employees (posted_by, voided_by, created_by)
journal_entry_lines → journal_entries (journal_entry_id), chart_of_accounts (account_id)
credit_notes → customers (customer_id), suppliers (supplier_id), employees (approved_by, created_by)
debit_notes → customers (customer_id), suppliers (supplier_id), employees (approved_by, created_by)
postdated_cheques → employees (created_by)
accounting_periods → employees (closed_by)
```

## Expenses

```
expenses → expense_categories (category_id), outlets (outlet_id), cash_shifts (shift_id), employees (employee_id)
```

## Web Orders & Fulfillment

```
web_orders → customers (customer_id), outlets (outlet_id), courier_integrations (courier_id)
web_order_items → web_orders (web_order_id), products (product_id), product_variants (variant_id)
web_order_transactions → web_orders (web_order_id)
web_order_fulfillments → web_orders (web_order_id)
picklists → outlets (outlet_id), employees (assigned_to, created_by)
picklist_items → picklists (picklist_id), web_orders (web_order_id), products (product_id), product_variants (variant_id)
loadsheets → courier_integrations (courier_id), outlets (outlet_id), employees (created_by)
loadsheet_orders → loadsheets (loadsheet_id), web_orders (web_order_id)
```

## Marketplace Integrations

```
daraz_product_map → products (product_id), product_variants (variant_id)
daraz_order_map → web_orders (web_order_id)
facebook_product_map → products (product_id), product_variants (variant_id)
facebook_order_map → web_orders (web_order_id)
whatsapp_conversations → customers (customer_id), web_orders (web_order_id)
whatsapp_messages → whatsapp_conversations (conversation_id)
google_merchant_feed_log → products (product_id)
```

## Shopify

```
shopify_product_map → products (product_id), product_variants (variant_id)
shopify_product_metadata → products (product_id)
shopify_location_map → outlets (outlet_id)
shopify_order_map → web_orders (web_order_id), sales (sale_id)
shopify_customer_map → customers (customer_id)
shopify_sync_runs — standalone
external_sync_events — standalone (idempotency_key unique)
shopify_connections — standalone (shop_domain unique)
```

## FBR

```
fbr_invoices → sales (sale_id), returns (return_id)
tax_rate_reference — standalone (public schema, seeded)
tax_rate_suggestions — standalone (reference_id informational)
```

## Reporting

```
report_schedule_runs → report_schedules (schedule_id)
report_delivery_log → report_schedule_runs (schedule_run_id), report_schedules (schedule_id)
saved_report_views — standalone (employee_id/role_id informational)
report_definition_versions — standalone
```

## Support & Admin (public schema)

```
support_tickets → employees (employee_id)
admin_activity_log — standalone
admin_security_log — standalone
tenant_notes — standalone (tenant_id informational)
announcements — standalone
broadcast_log — standalone
email_queue — standalone (tenant_id informational)
```

## Config (standalone tables)

```
company_profile, feature_flags, schema_version
printer_config, email_config, integration_settings
barcode_templates, receipt_templates
courier_integrations
daraz_product_map, daraz_order_map
facebook_product_map, facebook_order_map
whatsapp_conversations, whatsapp_messages
google_merchant_feed_log
gift_cards
notifications, action_history, backup_log
approval_requests, approval_actions
```

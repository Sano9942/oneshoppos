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
integration_settings — standalone (no FKs, keyed by provider name)
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

## Restaurant / KDS (Phase 4)

```
restaurant_floor_plans → outlets (outlet_id)
restaurant_floor_sections → restaurant_floor_plans (floor_plan_id)
restaurant_tables → restaurant_floor_sections (section_id), restaurant_floor_plans (floor_plan_id)
restaurant_table_sessions → restaurant_tables (table_id), employees (opened_by, closed_by), draft_orders (check_id)
restaurant_check_seats → draft_orders (check_id)
restaurant_check_adjustments → draft_orders (check_id), employees (applied_by)
restaurant_course_fires → draft_orders (check_id)
restaurant_tabs → draft_orders (check_id), customers (customer_id)
restaurant_preauth_holds → draft_orders (check_id), sales (sale_id)
kds_stations → outlets (outlet_id)
kds_station_routes → kds_stations (station_id), categories (category_id)
kds_tickets → kds_stations (station_id), draft_orders (check_id)
kds_ticket_items → kds_tickets (ticket_id), sale_items (sale_item_id)
kds_ticket_events → kds_tickets (ticket_id), employees (employee_id)
```

## Bookings / Appointments (Phase 4)

```
booking_services → categories (category_id), taxes (tax_id)
booking_service_variants → booking_services (service_id)
booking_staff_assignments → booking_services (service_id), employees (employee_id)
booking_resources → outlets (outlet_id)
booking_resource_assignments → booking_services (service_id), booking_resources (resource_id)
booking_availability_rules → booking_services (service_id), employees (employee_id)
appointments → booking_services (service_id), customers (customer_id), employees (staff_id), outlets (outlet_id)
appointment_segments → appointments (appointment_id)
appointment_reminders → appointments (appointment_id)
appointment_waitlist_entries → booking_services (service_id), customers (customer_id), outlets (outlet_id)
appointment_blocks → employees (employee_id), outlets (outlet_id)
class_sessions → booking_services (service_id), employees (staff_id), outlets (outlet_id)
class_session_bookings → class_sessions (session_id), customers (customer_id)
calendar_sync_accounts → employees (employee_id)
```

## Service Projects & Contracts (Phase 4)

```
service_projects → customers (customer_id), employees (assigned_to, created_by), outlets (outlet_id)
project_contacts → service_projects (project_id), customers (customer_id)
project_milestones → service_projects (project_id)
project_activities → service_projects (project_id), employees (employee_id)
project_files → service_projects (project_id), employees (uploaded_by)
contract_templates → employees (created_by)
contracts → contract_templates (template_id), customers (customer_id), service_projects (project_id), employees (created_by, signed_by)
contract_signers → contracts (contract_id), customers (customer_id), employees (employee_id)
contract_events → contracts (contract_id), employees (actor_employee_id)
```

## Customer Invoicing & Subscriptions

```
customer_invoices → customers (customer_id), outlets (outlet_id), service_projects (project_id), employees (created_by)
customer_invoice_items → customer_invoices (invoice_id), products (product_id), product_variants (variant_id)
customer_invoice_payments → customer_invoices (invoice_id)
customer_invoice_payment_links → customer_invoices (invoice_id)
customer_invoice_reminders → customer_invoices (invoice_id)
subscription_plans → products (product_id), taxes (tax_id)
customer_subscriptions → subscription_plans (plan_id), customers (customer_id), outlets (outlet_id)
subscription_runs → customer_subscriptions (subscription_id), customer_invoices (invoice_id)
```

## Marketing / CRM / Messaging

```
marketing_campaigns → employees (created_by)
marketing_campaign_audiences → marketing_campaigns (campaign_id), customer_groups (customer_group_id)
marketing_campaign_deliveries → marketing_campaigns (campaign_id), customers (customer_id)
marketing_templates → employees (created_by)
message_threads → customers (customer_id)
message_entries → message_threads (thread_id), employees (employee_id)
sms_provider_messages → employees (sent_by)
```

## Commissions

```
commission_plans → employees (created_by)
commission_plan_rules → commission_plans (plan_id), products (product_id), categories (category_id)
commission_earnings → commission_plans (plan_id), employees (employee_id), sales (sale_id)
```

## Shipping & COD (Phase 5)

```
order_shipments → web_orders (web_order_id), courier_integrations (courier_id), outlets (outlet_id)
shipment_tracking_events → order_shipments (shipment_id)
cod_settlement_batches → courier_integrations (courier_id), employees (created_by)
cod_settlement_lines → cod_settlement_batches (batch_id), web_orders (web_order_id)
```

## Storefront / Public Orders

```
storefront_carts → customers (customer_id)
storefront_cart_items → storefront_carts (cart_id), products (product_id), product_variants (variant_id)
storefront_payment_sessions → storefront_carts (cart_id), web_orders (web_order_id)
payment_webhook_events — standalone (public schema, idempotency key)
draft_orders → customers (customer_id), outlets (outlet_id), employees (created_by)
draft_order_items → draft_orders (draft_id), products (product_id), product_variants (variant_id)
web_order_allocations → web_orders (web_order_id), outlets (outlet_id), product_variants (variant_id)
inventory_reservations → outlets (outlet_id), products (product_id), product_variants (variant_id), web_orders (web_order_id)
```

## Phase 2 Competitive Features

```
smart_collections → employees (created_by)
smart_collection_rules → smart_collections (collection_id)
return_policies → employees (created_by)
return_reasons → return_policies (policy_id)
pos_layouts → outlets (outlet_id), employees (created_by)
price_list_assignments → price_lists (price_list_id), outlets (outlet_id), customer_groups (customer_group_id)
outlet_product_visibility → outlets (outlet_id), products (product_id)
outlet_tax_profiles → outlets (outlet_id)
outlet_tax_profile_lines → outlet_tax_profiles (profile_id), taxes (tax_id), categories (category_id)
scheduled_catalog_changes → employees (created_by)
scheduled_shifts → employees (employee_id), outlets (outlet_id)
product_affinities → products (product_a, product_b)
approval_events → approval_requests (request_id), employees (employee_id)
approval_policies → employees (created_by)
custom_report_definitions → employees (created_by)
custom_report_widgets → custom_report_definitions (report_id)
```

## Config (standalone tables)

```
company_profile, companies, feature_flags, schema_version
printer_config, email_config
barcode_templates, receipt_templates
barcode_print_jobs → barcode_templates (template_id), products (product_id)
courier_integrations
gift_cards
notifications, action_history, backup_log
approval_requests, approval_actions
customer_addresses → customers (customer_id)
customer_groups — standalone
loyalty_tiers — standalone
channel_publications → products (product_id), sales_channels (channel_id)
sales_channels — standalone
```

> **Coverage note**: This file documents the most-used domain clusters. The full schema (`backend/schema-pg.sql`) has ~214 tables total — for any FK not listed here, grep `schema-pg.sql` for `CREATE TABLE <name>` and check the inline `REFERENCES` clauses.

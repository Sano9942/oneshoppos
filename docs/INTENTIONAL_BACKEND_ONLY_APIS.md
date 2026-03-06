# Intentional Backend-Only APIs

Generated from `docs/api-parity/parity-registry.json`.

## Legend

- `internal_system_only`: health checks, webhooks, background-job triggers, maintenance.
- `backend_only_by_design`: used by scripts/integrations/admin tooling, not app UI.
- `deprecated_pending_removal`: legacy path, kept temporarily.

## Entries

| Endpoint | Classification | Owner | Review Date | Reason |
|---|---|---|---|---|
| `DELETE /api/barcode-templates/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/categories/:param` | `backend_only_by_design` | categories_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/crm/leads/:param` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/customers/:param` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/employees/:param` | `backend_only_by_design` | employees_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/expense-categories/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/expenses/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/integrations/shopify/import/products` | `backend_only_by_design` | shopify_import_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/outlets/:param` | `backend_only_by_design` | outlets_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/products/:param` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/products/:param/media/:param` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/promotions/:param` | `backend_only_by_design` | promotions_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/purchase-orders/:param` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/quotations/:param` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/reports/saved-views/:param` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/reports/schedules/:param` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `DELETE /api/roles/:param` | `backend_only_by_design` | roles_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/accounting/periods` | `backend_only_by_design` | tier4_accounting_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/approvals` | `backend_only_by_design` | tier4_approvals_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/auth/me` | `backend_only_by_design` | auth_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/backup/download` | `internal_system_only` | barcode-expenses_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `GET /api/barcode-templates` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/company-profile` | `backend_only_by_design` | tier4_company-profile_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/crm/leads` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/crm/leads/:param/activities` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/customers/:param/sales` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/customers/:param/wallet` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/employees/:param/attendance-config` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/employees/:param/outlets` | `backend_only_by_design` | employees_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/expense-categories` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/expenses` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/expenses/summary` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/grn` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/grn/:param` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/health` | `internal_system_only` | registerAllRoutes_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `GET /api/hr/payroll/periods/:param/lines` | `backend_only_by_design` | tier4_hr_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/mappings/customers` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/mappings/locations` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/mappings/products` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/config` | `backend_only_by_design` | shopify_config_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/events` | `backend_only_by_design` | shopify_sync_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/locations/live` | `backend_only_by_design` | shopify_health_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/reconciliation` | `backend_only_by_design` | shopify_reconciliation_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/status` | `backend_only_by_design` | shopify_health_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/uat-checklist` | `backend_only_by_design` | shopify_health_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/integrations/shopify/webhooks/setup` | `internal_system_only` | shopify_health_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `GET /api/notifications` | `backend_only_by_design` | tier4_notifications_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/notifications/count` | `backend_only_by_design` | tier4_notifications_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/orders` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/orders/:param` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/parked-sales` | `backend_only_by_design` | parked-sales_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/parked-sales/:param` | `backend_only_by_design` | parked-sales_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/products/:param/media` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/products/:param/stock` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/products/:param/variants` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/products/scan/:param` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/promotions` | `backend_only_by_design` | promotions_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/quotations` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/receipt-templates/active` | `backend_only_by_design` | receipt-templates_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/delivery-log` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/governance/definitions` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/saved-views` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/schedules` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/schedules/:param/runs` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/reports/top-salespeople` | `backend_only_by_design` | reports_sales_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/roles/:param/permissions` | `backend_only_by_design` | roles_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/sales/:param/invoice` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/sales/:param/invoice/export` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/shifts` | `backend_only_by_design` | shifts_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/shifts/:param/denominations` | `backend_only_by_design` | shifts_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/supplier-invoices/:param` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `GET /api/supplier-ledger/:param` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/action-history` | `backend_only_by_design` | receipt-templates_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attendance/:param/checkout` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attendance/checkin` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attendance/pin-checkin` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attendance/pin-checkout` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attendance/pin-status` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/attribute-sets` | `backend_only_by_design` | attribute-sets_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/backup/restore` | `internal_system_only` | barcode-expenses_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `POST /api/barcode-print-jobs` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/barcode-templates` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/brands` | `backend_only_by_design` | brands_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/categories` | `backend_only_by_design` | categories_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/categories/:param/move-products` | `backend_only_by_design` | categories_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/company-profile/logo` | `backend_only_by_design` | tier4_company-profile_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/crm/leads/:param/activities` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/crm/leads/:param/convert` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/customers/:param/wallet/topup` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/employees` | `backend_only_by_design` | employees_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/expense-categories` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/expenses` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/hr/payroll/periods/:param/generate` | `backend_only_by_design` | tier4_hr_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/mappings/products/apply-suggestions` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/mappings/products/auto` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/mappings/products/auto-live` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/disconnect` | `backend_only_by_design` | shopify_config_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/import/inventory` | `backend_only_by_design` | shopify_import_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/import/products` | `backend_only_by_design` | shopify_import_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/live-validation` | `backend_only_by_design` | shopify_health_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/reconciliation` | `backend_only_by_design` | shopify_reconciliation_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/reconciliation/:param/fix` | `backend_only_by_design` | shopify_reconciliation_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/reconciliation/bulk` | `backend_only_by_design` | shopify_reconciliation_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/sync/process-pending` | `internal_system_only` | shopify_sync_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `POST /api/integrations/shopify/sync/pull-orders` | `backend_only_by_design` | shopify_orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/sync/push-inventory` | `backend_only_by_design` | shopify_sync_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/sync/retry-event/:param` | `internal_system_only` | shopify_sync_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `POST /api/integrations/shopify/sync/retry-failed` | `internal_system_only` | shopify_sync_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `POST /api/integrations/shopify/verify` | `backend_only_by_design` | shopify_health_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/integrations/shopify/webhooks/orders-create` | `internal_system_only` | shopify_webhooks_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `POST /api/orders` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/orders/:param/fulfillments` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/orders/:param/transactions` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/orders/bulk-update` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/orders/mark-complete` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/outlets` | `backend_only_by_design` | outlets_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products/:param/media` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products/bulk-category` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products/bulk-delete` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products/bulk-import` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/products/bulk-status` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/promotions` | `backend_only_by_design` | promotions_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/promotions/quote` | `backend_only_by_design` | promotions_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/purchase-orders/:param/approve` | `backend_only_by_design` | tier4_approvals_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/purchase-orders/:param/receive` | `backend_only_by_design` | purchase-orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/purchase-orders/:param/submit` | `backend_only_by_design` | tier4_approvals_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/quotations` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/quotations/:param/convert` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/receipt-templates` | `backend_only_by_design` | receipt-templates_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/reports/schedules/:param/run-now` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/roles` | `backend_only_by_design` | roles_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/shifts/:param/close` | `backend_only_by_design` | shifts_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/supplier-invoices/:param/pay` | `backend_only_by_design` | grn_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/suppliers` | `backend_only_by_design` | suppliers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/taxes` | `backend_only_by_design` | taxes_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/transfers/:param/approve` | `backend_only_by_design` | tier4_approvals_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/transfers/:param/submit` | `backend_only_by_design` | tier4_approvals_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `POST /api/uploads/product-image` | `internal_system_only` | orders_maintainer | 2026-03-06 | Operational endpoint for system health, automation, or background processing. |
| `PUT /api/accounting/periods/:param` | `backend_only_by_design` | tier4_accounting_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/attribute-sets/:param` | `backend_only_by_design` | attribute-sets_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/barcode-templates/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/brands/:param` | `backend_only_by_design` | brands_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/categories/:param` | `backend_only_by_design` | categories_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/crm/leads/:param` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/customers/:param` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/customers/:param/points` | `backend_only_by_design` | customers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/employees/:param` | `backend_only_by_design` | employees_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/employees/:param/attendance-config` | `backend_only_by_design` | attendance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/employees/:param/outlets` | `backend_only_by_design` | employees_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/expense-categories/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/expenses/:param` | `backend_only_by_design` | barcode-expenses_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/feature-flags/:param` | `backend_only_by_design` | registerAllRoutes_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/hr/leave/:param/status` | `backend_only_by_design` | tier4_hr_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/integrations/mappings/customers/:param` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/integrations/mappings/locations/:param` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/integrations/mappings/products/:param` | `backend_only_by_design` | shopify_mappings_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/integrations/shopify/config` | `backend_only_by_design` | shopify_config_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/integrations/shopify/reconciliation/:param` | `backend_only_by_design` | shopify_reconciliation_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/notifications/:param/read` | `backend_only_by_design` | tier4_notifications_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/orders/:param/status` | `backend_only_by_design` | orders_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/outlets/:param` | `backend_only_by_design` | outlets_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/products/:param` | `backend_only_by_design` | products_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/promotions/:param` | `backend_only_by_design` | promotions_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/quotations/:param` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/quotations/:param/status` | `backend_only_by_design` | tier4_crm_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/receipt-templates/:param` | `backend_only_by_design` | receipt-templates_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/reports/saved-views/:param` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/reports/schedules/:param` | `backend_only_by_design` | reports_governance_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/roles/:param` | `backend_only_by_design` | roles_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/roles/:param/permissions` | `backend_only_by_design` | roles_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/sales/:param/void` | `backend_only_by_design` | sales_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/suppliers/:param` | `backend_only_by_design` | suppliers_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |
| `PUT /api/taxes/:param` | `backend_only_by_design` | taxes_maintainer | 2026-03-06 | No direct frontend usage detected; reviewed as backend capability or non-UI operation. |


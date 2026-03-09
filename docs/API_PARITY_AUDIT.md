# API Parity Audit

Generated: 2026-03-09T16:02:08.307Z

## Summary

- Backend endpoints (method+path): 367
- Frontend API usages (method+path): 251
- Backend-only endpoints: 127
- Frontend-only usages: 0
- Unclassified backend-only endpoints: 6
- Method mismatch paths: 11

## Backend Only

- `DELETE /api/admin/tenants/:param` (backend/routes/admin.js)
- `DELETE /api/barcode-templates/:param` (backend/routes/barcode-expenses.js)
- `DELETE /api/crm/leads/:param` (backend/routes/tier4/crm.js)
- `DELETE /api/customers/:param` (backend/routes/customers.js)
- `DELETE /api/expense-categories/:param` (backend/routes/barcode-expenses.js)
- `DELETE /api/expenses/:param` (backend/routes/barcode-expenses.js)
- `DELETE /api/integrations/shopify/import/products` (backend/routes/shopify/import.js)
- `DELETE /api/products/:param` (backend/routes/products.js)
- `DELETE /api/products/:param/media/:param` (backend/routes/orders.js)
- `DELETE /api/promotions/:param` (backend/routes/promotions.js)
- `DELETE /api/reports/saved-views/:param` (backend/routes/reports/governance.js)
- `DELETE /api/reports/schedules/:param` (backend/routes/reports/governance.js)
- `DELETE /api/roles/:param` (backend/routes/roles.js)
- `GET /api/approvals` (backend/routes/tier4/approvals.js)
- `GET /api/auth/me` (backend/routes/auth.js)
- `GET /api/barcode-templates` (backend/routes/barcode-expenses.js)
- `GET /api/customers/:param/sales` (backend/routes/customers.js)
- `GET /api/expense-categories` (backend/routes/barcode-expenses.js)
- `GET /api/expenses` (backend/routes/barcode-expenses.js)
- `GET /api/expenses/summary` (backend/routes/barcode-expenses.js)
- `GET /api/grn` (backend/routes/grn.js)
- `GET /api/grn/:param` (backend/routes/grn.js)
- `GET /api/health` (backend/routes/registerAllRoutes.js)
- `GET /api/integrations/mappings/customers` (backend/routes/shopify/mappings.js)
- `GET /api/integrations/mappings/locations` (backend/routes/shopify/mappings.js)
- `GET /api/integrations/mappings/products` (backend/routes/shopify/mappings.js)
- `GET /api/integrations/shopify/config` (backend/routes/shopify/config.js)
- `GET /api/integrations/shopify/events` (backend/routes/shopify/sync.js)
- `GET /api/integrations/shopify/locations/live` (backend/routes/shopify/health.js)
- `GET /api/integrations/shopify/reconciliation` (backend/routes/shopify/reconciliation.js)
- `GET /api/integrations/shopify/status` (backend/routes/shopify/health.js)
- `GET /api/integrations/shopify/uat-checklist` (backend/routes/shopify/health.js)
- `GET /api/integrations/shopify/webhooks/setup` (backend/routes/shopify/health.js)
- `GET /api/orders` (backend/routes/orders.js)
- `GET /api/orders/:param` (backend/routes/orders.js)
- `GET /api/products/:param/media` (backend/routes/orders.js)
- `GET /api/promotions` (backend/routes/promotions.js)
- `GET /api/reports/pricing-margin` (backend/routes/reports/inventory.js)
- `GET /api/reports/purchase-orders-report` (backend/routes/reports/purchasing.js)
- `GET /api/reports/schedules/:param/runs` (backend/routes/reports/governance.js)
- `GET /api/reports/top-salespeople` (backend/routes/reports/sales.js)
- `POST /api/action-history` (backend/routes/receipt-templates.js)
- `POST /api/action-history/log` (backend/routes/receipt-templates.js)
- `POST /api/admin/migrate-all` (backend/routes/admin.js)
- `POST /api/admin/tenants/:param/activate` (backend/routes/admin.js)
- `POST /api/admin/tenants/:param/migrate` (backend/routes/admin.js)
- `POST /api/admin/tenants/:param/reset-pin` (backend/routes/admin.js)
- `POST /api/admin/tenants/:param/suspend` (backend/routes/admin.js)
- `POST /api/attendance/:param/checkout` (backend/routes/attendance.js)
- `POST /api/attendance/checkin` (backend/routes/attendance.js)
- `POST /api/attendance/pin-checkin` (backend/routes/attendance.js)
- `POST /api/attendance/pin-checkout` (backend/routes/attendance.js)
- `POST /api/attendance/pin-status` (backend/routes/attendance.js)
- `POST /api/attribute-sets` (backend/routes/attribute-sets.js)
- `POST /api/auth/kiosk-login` (backend/routes/auth.js)
- `POST /api/barcode-print-jobs` (backend/routes/barcode-expenses.js)
- `POST /api/barcode-templates` (backend/routes/barcode-expenses.js)
- `POST /api/brands` (backend/routes/brands.js)
- `POST /api/customers/:param/wallet/topup` (backend/routes/customers.js)
- `POST /api/employees` (backend/routes/employees.js)
- `POST /api/expense-categories` (backend/routes/barcode-expenses.js)
- `POST /api/expenses` (backend/routes/barcode-expenses.js)
- `POST /api/gift-cards/:param/redeem` (backend/routes/barcode-expenses.js)
- `POST /api/integrations/mappings/products/apply-suggestions` (backend/routes/shopify/mappings.js)
- `POST /api/integrations/mappings/products/auto` (backend/routes/shopify/mappings.js)
- `POST /api/integrations/mappings/products/auto-live` (backend/routes/shopify/mappings.js)
- `POST /api/integrations/shopify/disconnect` (backend/routes/shopify/config.js)
- `POST /api/integrations/shopify/import/inventory` (backend/routes/shopify/import.js)
- `POST /api/integrations/shopify/import/products` (backend/routes/shopify/import.js)
- `POST /api/integrations/shopify/live-validation` (backend/routes/shopify/health.js)
- `POST /api/integrations/shopify/reconciliation` (backend/routes/shopify/reconciliation.js)
- `POST /api/integrations/shopify/reconciliation/:param/fix` (backend/routes/shopify/reconciliation.js)
- `POST /api/integrations/shopify/reconciliation/bulk` (backend/routes/shopify/reconciliation.js)
- `POST /api/integrations/shopify/sync/process-pending` (backend/routes/shopify/sync.js)
- `POST /api/integrations/shopify/sync/pull-orders` (backend/routes/shopify/orders.js)
- `POST /api/integrations/shopify/sync/push-inventory` (backend/routes/shopify/sync.js)
- `POST /api/integrations/shopify/sync/retry-event/:param` (backend/routes/shopify/sync.js)
- `POST /api/integrations/shopify/sync/retry-failed` (backend/routes/shopify/sync.js)
- `POST /api/integrations/shopify/verify` (backend/routes/shopify/health.js)
- `POST /api/integrations/shopify/webhooks/orders-create` (backend/routes/shopify/webhooks.js)
- `POST /api/orders` (backend/routes/orders.js)
- `POST /api/orders/:param/fulfillments` (backend/routes/orders.js)
- `POST /api/orders/:param/transactions` (backend/routes/orders.js)
- `POST /api/orders/bulk-update` (backend/routes/orders.js)
- `POST /api/orders/mark-complete` (backend/routes/orders.js)
- `POST /api/outlets` (backend/routes/outlets.js)
- `POST /api/products` (backend/routes/products.js)
- `POST /api/products/:param/media` (backend/routes/orders.js)
- `POST /api/products/bulk-category` (backend/routes/products.js)
- `POST /api/products/bulk-delete` (backend/routes/products.js)
- `POST /api/products/bulk-status` (backend/routes/products.js)
- `POST /api/promotions` (backend/routes/promotions.js)
- `POST /api/promotions/quote` (backend/routes/promotions.js)
- `POST /api/quotations` (backend/routes/tier4/crm.js)
- `POST /api/receipt-templates` (backend/routes/receipt-templates.js)
- `POST /api/roles` (backend/routes/roles.js)
- `POST /api/serials/:param/assign` (backend/routes/barcode-expenses.js)
- `POST /api/taxes` (backend/routes/taxes.js)
- `POST /api/transfers/:param/approve` (backend/routes/tier4/approvals.js)
- `POST /api/transfers/:param/submit` (backend/routes/tier4/approvals.js)
- `PUT /api/adjustments/:param` (backend/routes/inventory.js)
- `PUT /api/attribute-sets/:param` (backend/routes/attribute-sets.js)
- `PUT /api/barcode-templates/:param` (backend/routes/barcode-expenses.js)
- `PUT /api/brands/:param` (backend/routes/brands.js)
- `PUT /api/categories/:param` (backend/routes/categories.js)
- `PUT /api/customers/:param` (backend/routes/customers.js)
- `PUT /api/customers/:param/points` (backend/routes/customers.js)
- `PUT /api/employees/:param` (backend/routes/employees.js)
- `PUT /api/expense-categories/:param` (backend/routes/barcode-expenses.js)
- `PUT /api/expenses/:param` (backend/routes/barcode-expenses.js)
- `PUT /api/feature-flags/:param` (backend/routes/registerAllRoutes.js)
- `PUT /api/integrations/mappings/customers/:param` (backend/routes/shopify/mappings.js)
- `PUT /api/integrations/mappings/locations/:param` (backend/routes/shopify/mappings.js)
- `PUT /api/integrations/mappings/products/:param` (backend/routes/shopify/mappings.js)
- `PUT /api/integrations/shopify/config` (backend/routes/shopify/config.js)
- `PUT /api/integrations/shopify/reconciliation/:param` (backend/routes/shopify/reconciliation.js)
- `PUT /api/orders/:param/status` (backend/routes/orders.js)
- `PUT /api/outlets/:param` (backend/routes/outlets.js)
- `PUT /api/products/:param` (backend/routes/products.js)
- `PUT /api/promotions/:param` (backend/routes/promotions.js)
- `PUT /api/quotations/:param` (backend/routes/tier4/crm.js)
- `PUT /api/reports/saved-views/:param` (backend/routes/reports/governance.js)
- `PUT /api/reports/schedules/:param` (backend/routes/reports/governance.js)
- `PUT /api/roles/:param` (backend/routes/roles.js)
- `PUT /api/roles/:param/permissions` (backend/routes/roles.js)
- `PUT /api/suppliers/:param` (backend/routes/suppliers.js)
- `PUT /api/taxes/:param` (backend/routes/taxes.js)

## Frontend Only

- None

## Method Mismatches

- `/api/accounting/periods` backend=GET,POST frontend=GET,POST,PUT unmatched_frontend=PUT
- `/api/attribute-sets/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/brands/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/categories/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/employees/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/outlets/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/po-templates/:param` backend=DELETE frontend=DELETE,GET unmatched_frontend=GET
- `/api/products/:param` backend=DELETE,GET,PUT frontend=GET,POST unmatched_frontend=POST
- `/api/receipt-templates/:param` backend=DELETE,PUT frontend=DELETE,GET,PUT unmatched_frontend=GET
- `/api/suppliers/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET
- `/api/taxes/:param` backend=DELETE,PUT frontend=DELETE,GET unmatched_frontend=GET

## Confidence Warnings

- `frontend_non_api_path` /products (frontend/src/pages/BarcodeTemplates.jsx)
- `frontend_non_api_path` /roles (frontend/src/pages/redesign/AdministratorRedesign.jsx)
- `frontend_non_api_path` /roles/:param/permissions (frontend/src/pages/redesign/AdministratorRedesign.jsx)
- `frontend_non_api_path` /roles/:param (frontend/src/pages/redesign/AdministratorRedesign.jsx)
- `frontend_non_api_path` /customers (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /customers/:param/sales (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /customers/:param/wallet (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /customers/:param (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /customers/:param/points (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /customers/:param/wallet/topup (frontend/src/pages/redesign/CustomersRedesign.jsx)
- `frontend_non_api_path` /outlets (frontend/src/pages/redesign/ExpensesRedesign.jsx)
- `frontend_non_api_path` /employees (frontend/src/pages/redesign/ExpensesRedesign.jsx)
- `frontend_non_api_path` /outlets (frontend/src/pages/redesign/KioskRedesign.jsx)
- `frontend_non_api_path` /attendance/pin-status (frontend/src/pages/redesign/KioskRedesign.jsx)
- `frontend_non_api_path` /attendance/pin-checkin (frontend/src/pages/redesign/KioskRedesign.jsx)
- `frontend_non_api_path` /attendance/pin-checkout (frontend/src/pages/redesign/KioskRedesign.jsx)
- `frontend_non_api_path` /outlets (frontend/src/pages/redesign/ParkedSalesRedesign.jsx)
- `frontend_non_api_path` /products (frontend/src/pages/redesign/PromotionsRedesign.jsx)
- `frontend_dynamic_path_ambiguous` GET /api/employees/:param -> GET /api/employees/:param/attendance-config, GET /api/employees/:param/outlets (frontend/src/pages/redesign/EmployeesRedesign.jsx)
- `frontend_dynamic_path_ambiguous` GET /api/receipt-templates/:param -> GET /api/receipt-templates/active (frontend/src/pages/ReceiptTemplates.jsx)
- `frontend_dynamic_path_ambiguous` POST /api/products/:param -> POST /api/products/:param/serials, POST /api/products/:param/media, POST /api/products/bulk-import, POST /api/products/bulk-delete, POST /api/products/bulk-status, POST /api/products/bulk-category (frontend/src/pages/redesign/InventoryRedesign.jsx)
- `frontend_method_ambiguous` GET /api/attribute-sets/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/AttributeSetsRedesign.jsx)
- `frontend_method_ambiguous` GET /api/brands/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/BrandsRedesign.jsx)
- `frontend_method_ambiguous` GET /api/categories/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/CategoriesRedesign.jsx)
- `frontend_method_ambiguous` GET /api/outlets/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/OutletsRedesign.jsx)
- `frontend_method_ambiguous` GET /api/po-templates/:param -> backend methods on same path: DELETE (frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx)
- `frontend_method_ambiguous` GET /api/suppliers/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/SuppliersRedesign.jsx)
- `frontend_method_ambiguous` GET /api/taxes/:param -> backend methods on same path: PUT, DELETE (frontend/src/pages/redesign/TaxesRedesign.jsx)
- `frontend_method_ambiguous` PUT /api/accounting/periods -> backend methods on same path: GET, POST (frontend/src/pages/Accounting.jsx)

## Notes

- This scan is static analysis; dynamic URL construction may still require manual review.
- Registry source: `docs/api-parity/parity-registry.json`.


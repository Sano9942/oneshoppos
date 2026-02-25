# OneShopPOS API and Route Reference

Last audited: 2026-02-25

Source of truth:
- Backend APIs: `backend/index.js`
- Frontend routes: `frontend/src/App.jsx`

## Backend API Summary

- Total registered endpoints: 193
- Group counts by first path segment under `/api/*`:
  - integrations: 25
  - reports: 18
  - products: 12
  - customers: 8
  - orders: 8
  - purchase-orders: 7
  - roles: 6
  - sales: 6
  - reconciliation: 6
  - employees: 5
  - promotions: 5
  - shifts: 5
  - receipt-templates: 5
  - expenses: 5
  - taxes: 4
  - categories: 4
  - outlets: 4
  - brands: 4
  - suppliers: 4
  - transfers: 4
  - attribute-sets: 4
  - parked-sales: 4
  - barcode-templates: 4
  - expense-categories: 4
  - auth: 3
  - supplier-invoices: 3
  - attendance: 3
  - returns: 3
  - supplier-returns: 3
  - backup: 3
  - feature-flags: 2
  - grn: 2
  - adjustments: 2
  - action-history: 2
  - health: 1
  - supplier-aging: 1
  - variance-reasons: 1
  - uploads: 1
  - approvals: 1
  - barcode-print-jobs: 1

## Backend Endpoints (Complete)

```text
GET /api/feature-flags
PUT /api/feature-flags/:key
GET /api/health
GET /api/taxes
POST /api/taxes
PUT /api/taxes/:id
DELETE /api/taxes/:id
GET /api/categories
POST /api/categories
PUT /api/categories/:id
DELETE /api/categories/:id
GET /api/outlets
POST /api/outlets
PUT /api/outlets/:id
DELETE /api/outlets/:id
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
GET /api/employees
POST /api/employees/validate-pin
POST /api/employees
PUT /api/employees/:id
DELETE /api/employees/:id
GET /api/roles
POST /api/roles
PUT /api/roles/:id
DELETE /api/roles/:id
GET /api/roles/:id/permissions
PUT /api/roles/:id/permissions
GET /api/brands
POST /api/brands
PUT /api/brands/:id
DELETE /api/brands/:id
GET /api/products
GET /api/products/:id/variants
GET /api/products/:id/stock
GET /api/products/search
GET /api/products/scan/:barcode
POST /api/products
POST /api/products/bulk-import
PUT /api/products/:id
DELETE /api/products/:id
GET /api/suppliers
POST /api/suppliers
PUT /api/suppliers/:id
DELETE /api/suppliers/:id
GET /api/purchase-orders
GET /api/purchase-orders/:id
POST /api/purchase-orders
POST /api/purchase-orders/:id/receive
GET /api/grn
GET /api/grn/:id
DELETE /api/purchase-orders/:id
GET /api/supplier-invoices
GET /api/supplier-invoices/:id
POST /api/supplier-invoices/:id/pay
GET /api/supplier-aging
GET /api/promotions
POST /api/promotions
PUT /api/promotions/:id
DELETE /api/promotions/:id
POST /api/promotions/quote
GET /api/customers
GET /api/customers/:id/sales
POST /api/customers
PUT /api/customers/:id
PUT /api/customers/:id/points
GET /api/customers/:id/wallet
POST /api/customers/:id/wallet/topup
DELETE /api/customers/:id
GET /api/reports/customer-details
GET /api/reports/customer-wise
GET /api/reports/order-wise
GET /api/sales
GET /api/sales/:id
PUT /api/sales/:id/void
POST /api/sales
GET /api/transfers
POST /api/transfers
GET /api/adjustments
POST /api/adjustments
GET /api/reports/dashboard
GET /api/reports/top-salespeople
GET /api/shifts
GET /api/shifts/active
POST /api/shifts/open
POST /api/shifts/:id/close
GET /api/shifts/:id/denominations
GET /api/variance-reasons
GET /api/attendance
POST /api/attendance/checkin
POST /api/attendance/:id/checkout
GET /api/reports/sales-summary
GET /api/reports/sales-detail
GET /api/reports/sales-stock
GET /api/reports/inventory-dump
GET /api/reports/category-wise
GET /api/reports/product-spec
GET /api/reports/on-hand
GET /api/reports/item-wise
GET /api/reports/product-performance
GET /api/reports/inventory-loss
GET /api/reports/wastage
GET /api/reports/replenishment
GET /api/reports/supplier-wise
POST /api/returns
GET /api/returns
GET /api/returns/:id
GET /api/attribute-sets
POST /api/attribute-sets
PUT /api/attribute-sets/:id
DELETE /api/attribute-sets/:id
GET /api/receipt-templates
GET /api/receipt-templates/active
POST /api/receipt-templates
PUT /api/receipt-templates/:id
DELETE /api/receipt-templates/:id
POST /api/action-history
GET /api/action-history
GET /api/supplier-returns
GET /api/supplier-returns/:id
POST /api/supplier-returns
GET /api/parked-sales
GET /api/parked-sales/:id
POST /api/parked-sales
DELETE /api/parked-sales/:id
GET /api/orders
GET /api/products/:id/media
POST /api/products/:id/media
DELETE /api/products/:id/media/:mediaId
POST /api/uploads/product-image
GET /api/orders/:id
POST /api/orders
PUT /api/orders/:id/status
POST /api/orders/mark-complete
POST /api/orders/bulk-update
POST /api/orders/:id/transactions
POST /api/orders/:id/fulfillments
GET /api/integrations/shopify/config
PUT /api/integrations/shopify/config
POST /api/integrations/shopify/disconnect
GET /api/integrations/shopify/status
POST /api/integrations/shopify/verify
POST /api/integrations/shopify/live-validation
GET /api/integrations/shopify/webhooks/setup
GET /api/integrations/shopify/uat-checklist
GET /api/integrations/shopify/locations/live
GET /api/integrations/shopify/events
POST /api/integrations/shopify/sync/retry-event/:id
POST /api/integrations/shopify/sync/process-pending
POST /api/integrations/shopify/sync/retry-failed
POST /api/integrations/shopify/sync/push-inventory
POST /api/integrations/shopify/sync/pull-orders
POST /api/integrations/shopify/webhooks/orders-create
GET /api/integrations/mappings/products
PUT /api/integrations/mappings/products/:id
POST /api/integrations/mappings/products/auto
POST /api/integrations/mappings/products/auto-live
POST /api/integrations/mappings/products/apply-suggestions
GET /api/integrations/mappings/locations
PUT /api/integrations/mappings/locations/:outletId
GET /api/integrations/mappings/customers
PUT /api/integrations/mappings/customers/:customerId
GET /api/reconciliation/inventory
POST /api/reconciliation/inventory/run
POST /api/reconciliation/inventory/:id/resolve
POST /api/reconciliation/inventory/:id/request-fix
POST /api/reconciliation/inventory/:id/approve-fix
GET /api/reconciliation/inventory/:id/audit
GET /api/approvals
POST /api/purchase-orders/:id/submit
POST /api/purchase-orders/:id/approve
POST /api/transfers/:id/submit
POST /api/transfers/:id/approve
GET /api/barcode-templates
POST /api/barcode-templates
PUT /api/barcode-templates/:id
DELETE /api/barcode-templates/:id
POST /api/barcode-print-jobs
GET /api/expense-categories
POST /api/expense-categories
PUT /api/expense-categories/:id
DELETE /api/expense-categories/:id
GET /api/expenses
POST /api/expenses
PUT /api/expenses/:id
DELETE /api/expenses/:id
GET /api/expenses/summary
GET /api/backup/download
POST /api/backup/restore
GET /api/backup/log
GET /api/sales/:id/invoice
GET /api/sales/:id/invoice/export
```

## Frontend Routes (Complete)

- Total declared routes: 57

```text
/
/login
/access-denied
/pos
/dashboard
/sales-history
/cash-management
/customers
/attribute-sets
/orders
/lookup
/custom-fields
/partners
/shopcast
/reports
/returns
/inventory
/adjustments
/transfers
/promotions
/expenses
/categories
/taxes
/brands
/barcode-templates
/suppliers
/purchase-orders
/supplier-payables
/approvals
/returned-stock
/employees
/outlets
/administrator
/action-history
/backup-restore
/integrations/shopify
/attendance
/reports/sales-summary
/reports/sales-detail
/reports/sales-and-stock
/reports/inventory-dump
/reports/category-wise
/reports/product-specification
/reports/order-wise
/reports/replenishment
/reports/on-hand-inventory
/reports/customer-details
/reports/customer-wise
/reports/supplier-wise
/reports/inventory-loss
/reports/item-wise
/reports/wastage
/reports/product-movement
/reports/parent-report
/reports/product-performance
/receipt-templates
*
```

# Xstak Comprehensive Architecture Expansion

## Phase 1: Core Infrastructure (Setup)

We must build foundational relationships before we can execute advanced features like transferring inventory between stores or tracking which cashier managed the cash drawer.

### 1. Outlets Management (Locations)

- [x] Create `migrate6.js` to build an `outlets` table (`id`, `name`, `address`, `phone`).
- [x] Build Backend CRUD API `/api/outlets`.
- [x] Build Frontend UI Interface `Outlets.jsx`.
- [x] Add `Outlets` link to the Sidebar under `Setup`.

### 2. Employee Management (Cashiers)

- [x] Update `migrate6.js` to build an `employees` table (`id`, `name`, `role`, `pin_code`).
- [x] Build Backend CRUD API `/api/employees`.
- [x] Build Frontend UI Interface `Employees.jsx`.
- [x] Add `Employees` link to the Sidebar under `Setup`.
- [x] Implement a basic PIN login screen overlay on the POS terminal.

### 3. Brands Management

- [x] Update `migrate6.js` to build a `brands` table (`id`, `name`).
- [x] Modify the `products` table schema to include `brand_id`.
- [x] Build Backend CRUD API `/api/brands`.
- [x] Build Frontend UI Interface `Brands.jsx`.
- [x] Modify `Inventory.jsx` to select a Brand during product creation.

## Phase 2: Advanced Products & Stock Control

### 4. Multi-Outlet Inventory Architecture

- [ ] Create `migrate10.js` for `outlet_stock` table.
- [ ] Migrate existing `products.stock` into `outlet_stock`.
- [ ] Update POS Backend (`/api/sales`) to deduct stock from a specific outlet.
- [ ] Update Inventory UI to display stock per outlet.

### 5. Stock Adjustments

- [ ] Create `stock_adjustments` table (tracking loss/damage).
- [ ] Build Backend API `/api/adjustments`.
- [ ] Build Frontend UI `StockAdjustments.jsx`.

### 6. Inventory Transfers

- [ ] Create `inventory_transfers` table.
- [ ] Build Backend API `/api/transfers`.
- [ ] Build Frontend UI `Transfers.jsx`.

## Next Phases (Pending Phase 2 Completion)

- **Phase 3:** Advanced Register Operations (Cash Management, Sales History)
- **Phase 4:** The Complete Reporting Engine (14+ specialized reports)

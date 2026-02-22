# Xstak Comprehensive Architecture Expansion

## Phase 1: Core Infrastructure (Setup)

We must build foundational relationships before we can execute advanced features like transferring inventory between stores or tracking which cashier managed the cash drawer.

### 1. Outlets Management (Locations)

- [ ] Create `migrate6.js` to build an `outlets` table (`id`, `name`, `address`, `phone`).
- [ ] Build Backend CRUD API `/api/outlets`.
- [ ] Build Frontend UI Interface `Outlets.jsx`.
- [ ] Add `Outlets` link to the Sidebar under `Setup`.

### 2. Employee Management (Cashiers)

- [ ] Update `migrate6.js` to build an `employees` table (`id`, `name`, `role`, `pin_code`).
- [ ] Build Backend CRUD API `/api/employees`.
- [ ] Build Frontend UI Interface `Employees.jsx`.
- [ ] Add `Employees` link to the Sidebar under `Setup`.
- [ ] Implement a basic PIN login screen overlay on the POS terminal.

### 3. Brands Management

- [ ] Update `migrate6.js` to build a `brands` table (`id`, `name`).
- [ ] Modify the `products` table schema to include `brand_id`.
- [ ] Build Backend CRUD API `/api/brands`.
- [ ] Build Frontend UI Interface `Brands.jsx`.
- [ ] Modify `Inventory.jsx` to select a Brand during product creation.

## Next Phases (Pending Phase 1 Completion)

- **Phase 2:** Advanced Products & Stock Control (Adjustments, Transfers, Custom Attributes)
- **Phase 3:** Advanced Register Operations (Cash Management, Sales History)
- **Phase 4:** The Complete Reporting Engine (14+ specialized reports)

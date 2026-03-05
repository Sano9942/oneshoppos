/**
 * seedData.js — Inserts standard test fixtures into an in-memory SQLite DB.
 *
 * After calling seedData(db), the DB will contain:
 *   - 2 outlets (id 1 "Main Store", id 2 "Branch Store")
 *   - 3 roles (id 1 Administrator, id 2 Manager, id 3 Cashier) with permissions
 *   - 3 employees (admin id=1, manager id=2, cashier id=3)
 *   - 1 category, 1 tax, 1 brand
 *   - 2 suppliers
 *   - 5 products with outlet_stock at outlet 1
 *   - 1 customer with wallet balance
 *   - Default feature flags seeded
 */

const DEFAULT_FEATURE_FLAGS = {
  backup_restore: true,
  e_invoicing_export: true,
  supplier_payables: true,
  approvals: true,
  notifications: true,
  accounting_core: true,
  crm_quotations: true,
  advanced_hr: true,
  multi_company: true,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  // Context Unification flags — disabled by default so existing tests are unaffected
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
};

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function seedData(db) {
  // Company (required by context bootstrap endpoint)
  await runSql(db, `INSERT INTO companies (id, name, code, is_active) VALUES (1, 'Test Company', 'TEST', 1)`);

  // Outlets
  await runSql(
    db,
    `INSERT INTO outlets (id, name, address, phone) VALUES (1, 'Main Store', '123 Main St', '111-1111')`,
  );
  await runSql(
    db,
    `INSERT INTO outlets (id, name, address, phone) VALUES (2, 'Branch Store', '456 Branch Ave', '222-2222')`,
  );

  // Roles
  await runSql(
    db,
    `INSERT INTO roles (id, name, description) VALUES (1, 'Administrator', 'Full access')`,
  );
  await runSql(
    db,
    `INSERT INTO roles (id, name, description) VALUES (2, 'Manager', 'Store manager')`,
  );
  await runSql(
    db,
    `INSERT INTO roles (id, name, description) VALUES (3, 'Cashier', 'POS operator')`,
  );

  // Role permissions
  await runSql(
    db,
    `INSERT INTO role_permissions (role_id, permission) VALUES (1, 'all_access')`,
  );
  for (const perm of [
    "manage_inventory",
    "manage_orders",
    "view_reports",
    "manage_employees",
    "pos_discount",
    "void_sales",
    "pos_park",
    "pos_void",
  ]) {
    await runSql(
      db,
      `INSERT INTO role_permissions (role_id, permission) VALUES (2, ?)`,
      [perm],
    );
  }
  for (const perm of ["view_reports", "pos_discount", "pos_park"]) {
    await runSql(
      db,
      `INSERT INTO role_permissions (role_id, permission) VALUES (3, ?)`,
      [perm],
    );
  }

  // Employees
  await runSql(
    db,
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary) VALUES (1, 'Hassan', 'Administrator', '2580', 1, 50000)`,
  );
  await runSql(
    db,
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary) VALUES (2, 'Manager User', 'Manager', '2222', 2, 40000)`,
  );
  await runSql(
    db,
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary) VALUES (3, 'Cashier User', 'Cashier', '3333', 3, 25000)`,
  );

  // Employee outlet assignments (required by outlet-assignment enforcement middleware)
  // All 3 employees are assigned to outlet 1; admin is also assigned to outlet 2
  for (const empId of [1, 2, 3]) {
    await runSql(db, `INSERT INTO employee_outlets (employee_id, outlet_id) VALUES (?, 1)`, [empId]);
  }
  await runSql(db, `INSERT INTO employee_outlets (employee_id, outlet_id) VALUES (1, 2)`);

  // Category, Tax, Brand
  await runSql(
    db,
    `INSERT INTO categories (id, name, description) VALUES (1, 'Electronics', 'Electronic items')`,
  );
  await runSql(
    db,
    `INSERT INTO categories (id, name, description) VALUES (2, 'Groceries', 'Food and grocery items')`,
  );
  await runSql(
    db,
    `INSERT INTO taxes (id, name, rate, is_default) VALUES (1, 'GST 17%', 17, 1)`,
  );
  await runSql(
    db,
    `INSERT INTO brands (id, name, description) VALUES (1, 'TestBrand', 'Test brand')`,
  );

  // Suppliers
  await runSql(
    db,
    `INSERT INTO suppliers (id, name, contact_person, phone) VALUES (1, 'Supplier A', 'John', '333-3333')`,
  );
  await runSql(
    db,
    `INSERT INTO suppliers (id, name, contact_person, phone) VALUES (2, 'Supplier B', 'Jane', '444-4444')`,
  );

  // Products
  const products = [
    [1, "PROD-001", "Widget A", 100, 50, 60, 17, 1, 1, 1, 1],
    [2, "PROD-002", "Widget B", 200, 30, 120, 17, 1, 1, 1, 1],
    [3, "PROD-003", "Gadget C", 500, 20, 300, 17, 1, 1, 1, 2],
    [4, "PROD-004", "Snack D", 50, 100, 30, 0, 2, null, null, null],
    [5, "PROD-005", "Drink E", 75, 80, 45, 0, 2, null, null, null],
  ];
  for (const [
    id,
    barcode,
    name,
    price,
    stock,
    cost_price,
    gst,
    cat_id,
    tax_id,
    brand_id,
    supplier_id,
  ] of products) {
    await runSql(
      db,
      `INSERT INTO products (id, barcode, name, price, stock, cost_price, gst, category_id, tax_id, brand_id, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        barcode,
        name,
        price,
        stock,
        cost_price,
        gst,
        cat_id,
        tax_id,
        brand_id,
        supplier_id,
      ],
    );
  }

  // Outlet stock (all products at outlet 1)
  for (const [prodId, qty] of [
    [1, 50],
    [2, 30],
    [3, 20],
    [4, 100],
    [5, 80],
  ]) {
    await runSql(
      db,
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, 1, ?)`,
      [prodId, qty],
    );
  }
  // Some stock at outlet 2
  await runSql(
    db,
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 2, 10)`,
  );
  await runSql(
    db,
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (2, 2, 5)`,
  );

  // Customer with wallet
  await runSql(
    db,
    `INSERT INTO customers (id, name, mobile, email, loyalty_points, balance) VALUES (1, 'Test Customer', '555-5555', 'test@example.com', 100, 500.00)`,
  );

  // Feature flags
  for (const [key, enabled] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
    await runSql(db, `INSERT INTO feature_flags (key, enabled) VALUES (?, ?)`, [
      key,
      enabled ? 1 : 0,
    ]);
  }

  // Company profile
  await runSql(
    db,
    `INSERT INTO company_profile (id, company_name) VALUES (1, 'Test Store')`,
  );
}

module.exports = { seedData };

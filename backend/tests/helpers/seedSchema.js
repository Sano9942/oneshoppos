/**
 * seedSchema.js — Replays the full OneShopPOS schema into an in-memory SQLite DB.
 * Extracted from the live database's sqlite_master dump (all 56 migrations applied).
 *
 * Usage:  await seedSchema(db);
 *
 * NOTE: We skip shopify_* tables, external_sync_events, and shopify_sync_runs
 * since Shopify integration is tested separately.
 */

const TABLES = [
  // ── Foundation tables (no FKs or only self-referencing) ──────────────
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    rate REAL NOT NULL,
    is_default BOOLEAN DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    permission TEXT NOT NULL,
    UNIQUE(role_id, permission)
  )`,
  `CREATE TABLE IF NOT EXISTS outlets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    address TEXT,
    phone TEXT,
    branch_code TEXT,
    company_id INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Cashier',
    pin_code TEXT UNIQUE NOT NULL,
    role_id INTEGER REFERENCES roles(id) DEFAULT 3,
    salary_type TEXT DEFAULT 'monthly',
    hourly_rate REAL DEFAULT 0,
    monthly_salary REAL DEFAULT 0,
    daily_rate REAL DEFAULT 0,
    joining_date TEXT,
    department TEXT,
    work_hours_per_day REAL DEFAULT 8,
    monthly_leave_allowance INTEGER DEFAULT 2
  )`,
  `CREATE TABLE IF NOT EXISTS attribute_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    attribute_set_id INTEGER NOT NULL REFERENCES attribute_sets(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS attribute_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    value TEXT NOT NULL
  )`,

  // ── Products (depends on categories, taxes, brands, suppliers, attribute_sets) ─
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    cost_price REAL DEFAULT 0.0,
    gst REAL,
    category_id INTEGER REFERENCES categories(id),
    tax_id INTEGER REFERENCES taxes(id),
    brand_id INTEGER REFERENCES brands(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    has_variants BOOLEAN DEFAULT 0,
    attribute_set_id INTEGER REFERENCES attribute_sets(id),
    min_qty INTEGER DEFAULT 0,
    max_qty INTEGER DEFAULT 0,
    unit TEXT DEFAULT 'pcs',
    description_html TEXT,
    compare_at_price REAL DEFAULT 0,
    product_type TEXT,
    vendor TEXT,
    tags TEXT,
    status TEXT DEFAULT 'active',
    sku TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku TEXT UNIQUE NOT NULL,
    price REAL,
    cost_price REAL,
    stock INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    weight REAL DEFAULT 0,
    weight_unit TEXT DEFAULT 'kg',
    compare_at_price REAL DEFAULT 0,
    barcode TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS variant_option_values (
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    attribute_option_id INTEGER NOT NULL REFERENCES attribute_options(id) ON DELETE CASCADE,
    PRIMARY KEY (variant_id, attribute_id)
  )`,
  `CREATE TABLE IF NOT EXISTS product_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    url TEXT NOT NULL,
    alt_text TEXT,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS outlet_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    quantity INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, outlet_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    employee_id INTEGER REFERENCES employees(id),
    quantity_change INTEGER NOT NULL,
    reason TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    from_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    to_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    quantity INTEGER NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    note TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed'
  )`,

  // ── Customers ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT,
    email TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    loyalty_points INTEGER DEFAULT 0,
    cnic TEXT,
    occupation TEXT,
    balance REAL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS customer_wallet_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    type TEXT NOT NULL CHECK(type IN ('credit','debit')),
    amount REAL NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Sales ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    outlet_id INTEGER REFERENCES outlets(id),
    employee_id INTEGER REFERENCES employees(id),
    voided INTEGER DEFAULT 0,
    void_reason TEXT,
    customer_id INTEGER REFERENCES customers(id),
    discount_amount REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'fixed',
    points_earned INTEGER DEFAULT 0,
    points_redeemed INTEGER DEFAULT 0,
    notes TEXT,
    invoice_number TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    product_id INTEGER,
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    cost_price_at_sale REAL DEFAULT 0.0,
    variant_id INTEGER REFERENCES product_variants(id),
    FOREIGN KEY(sale_id) REFERENCES sales(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS sale_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL,
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_sequences (
    year INTEGER PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
  )`,

  // ── Returns ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_sale_id INTEGER,
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    employee_id INTEGER REFERENCES employees(id),
    customer_id INTEGER REFERENCES customers(id),
    total_refund REAL NOT NULL,
    refund_method TEXT NOT NULL,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES returns(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    refund_price REAL NOT NULL
  )`,

  // ── Purchase Orders & GRN ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    status TEXT DEFAULT 'Draft',
    total_cost REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date TEXT,
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    cost_price REAL NOT NULL,
    FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS goods_received_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_number TEXT UNIQUE NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id),
    outlet_id INTEGER REFERENCES outlets(id),
    received_by INTEGER REFERENCES employees(id),
    received_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS grn_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_id INTEGER NOT NULL REFERENCES goods_received_notes(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_ordered INTEGER NOT NULL DEFAULT 0,
    qty_received INTEGER NOT NULL DEFAULT 0,
    cost_price REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    po_id INTEGER REFERENCES purchase_orders(id),
    grn_id INTEGER REFERENCES goods_received_notes(id),
    invoice_number TEXT,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
    due_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'Cash',
    reference TEXT,
    paid_by TEXT,
    paid_at TEXT DEFAULT (datetime('now','localtime')),
    notes TEXT
  )`,

  // ── Supplier Returns ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS supplier_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id),
    employee_id INTEGER REFERENCES employees(id),
    outlet_id INTEGER REFERENCES outlets(id),
    return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'Pending',
    reason TEXT,
    total_value REAL DEFAULT 0,
    reference_number TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_return_id INTEGER REFERENCES supplier_returns(id),
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    quantity INTEGER NOT NULL,
    unit_price REAL,
    reason TEXT
  )`,

  // ── Promotions ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('percent','fixed','threshold_percent','threshold_fixed','bxgy')),
    value REAL NOT NULL DEFAULT 0,
    min_order_amount REAL DEFAULT 0,
    buy_qty INTEGER DEFAULT 0,
    get_qty INTEGER DEFAULT 0,
    applies_to TEXT DEFAULT 'all',
    product_id INTEGER REFERENCES products(id),
    category_id INTEGER REFERENCES categories(id),
    active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Cash Shifts ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS cash_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    employee_id INTEGER REFERENCES employees(id),
    opening_float REAL NOT NULL DEFAULT 0,
    closing_cash REAL,
    expected_cash REAL,
    variance REAL,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    notes TEXT,
    variance_reason TEXT,
    variance_approved_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS shift_denominations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'closing',
    denomination REAL NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    subtotal REAL GENERATED ALWAYS AS (denomination * count) STORED
  )`,

  // ── Attendance ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS employee_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    check_in DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    check_out DATETIME,
    hours REAL,
    status TEXT NOT NULL DEFAULT 'present',
    comment TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER REFERENCES employee_attendance(id) ON DELETE SET NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    session_type TEXT NOT NULL DEFAULT 'work',
    break_reason TEXT,
    session_start DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    session_end DATETIME,
    duration_hours REAL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Parked Sales ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS parked_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id),
    outlet_id INTEGER REFERENCES outlets(id),
    customer_id INTEGER REFERENCES customers(id),
    label TEXT,
    notes TEXT,
    parked_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS parked_sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parked_sale_id INTEGER NOT NULL REFERENCES parked_sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    product_name TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    effective_tax_rate REAL DEFAULT 0
  )`,

  // ── Expenses ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES expense_categories(id),
    outlet_id INTEGER REFERENCES outlets(id),
    shift_id INTEGER REFERENCES cash_shifts(id),
    employee_id INTEGER REFERENCES employees(id),
    amount REAL NOT NULL,
    description TEXT,
    reference TEXT,
    expense_date TEXT NOT NULL DEFAULT (date('now','localtime')),
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Barcodes ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS barcode_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    width_mm REAL NOT NULL DEFAULT 50,
    height_mm REAL NOT NULL DEFAULT 30,
    show_name INTEGER NOT NULL DEFAULT 1,
    show_price INTEGER NOT NULL DEFAULT 1,
    show_barcode INTEGER NOT NULL DEFAULT 1,
    show_sku INTEGER NOT NULL DEFAULT 0,
    show_brand INTEGER NOT NULL DEFAULT 0,
    font_size INTEGER NOT NULL DEFAULT 10,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS barcode_print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER REFERENCES barcode_templates(id),
    product_id INTEGER REFERENCES products(id),
    product_name TEXT,
    barcode TEXT,
    price REAL,
    copies INTEGER NOT NULL DEFAULT 1,
    printed_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Receipt Templates & Action History ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS receipt_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    header_text TEXT DEFAULT '',
    footer_text TEXT DEFAULT '',
    show_barcode INTEGER DEFAULT 0,
    show_logo INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS action_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // ── Notifications ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Feature Flags ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Backup Log ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS backup_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    filename TEXT,
    size_bytes INTEGER,
    performed_by TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Company Profile ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS company_profile (
    id INTEGER PRIMARY KEY DEFAULT 1,
    company_name TEXT NOT NULL DEFAULT 'My Store',
    trading_name TEXT,
    ntn TEXT,
    strn TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'Pakistan',
    phone TEXT,
    email TEXT,
    website TEXT,
    currency_symbol TEXT DEFAULT 'PKRs',
    currency_code TEXT DEFAULT 'PKR',
    logo_url TEXT,
    fiscal_year_start TEXT DEFAULT '01-01',
    timezone TEXT DEFAULT 'Asia/Karachi',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Companies (Context Unification — migrate61) ───────────────────────
  `CREATE TABLE IF NOT EXISTS companies (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    code      TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Employee-Outlet Junction (Context Unification — migrate61) ───────
  `CREATE TABLE IF NOT EXISTS employee_outlets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    outlet_id   INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    is_primary  INTEGER NOT NULL DEFAULT 0,
    assigned_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(employee_id, outlet_id)
  )`,

  // ── CRM / Quotations ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS crm_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    source TEXT,
    stage TEXT NOT NULL DEFAULT 'new',
    priority TEXT NOT NULL DEFAULT 'medium',
    expected_value REAL DEFAULT 0,
    assigned_to INTEGER REFERENCES employees(id),
    customer_id INTEGER REFERENCES customers(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS crm_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id),
    type TEXT DEFAULT 'note',
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT UNIQUE,
    lead_id INTEGER REFERENCES crm_leads(id),
    customer_id INTEGER REFERENCES customers(id),
    outlet_id INTEGER REFERENCES outlets(id),
    employee_id INTEGER REFERENCES employees(id),
    status TEXT NOT NULL DEFAULT 'draft',
    discount_type TEXT DEFAULT 'fixed',
    discount_amount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    valid_until TEXT,
    notes TEXT,
    converted_sale_id INTEGER REFERENCES sales(id),
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS quotation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    line_total REAL DEFAULT 0
  )`,

  // ── HR: Leave & Payroll ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    type TEXT NOT NULL DEFAULT 'annual',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL DEFAULT 1,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by INTEGER REFERENCES employees(id),
    approved_at TEXT,
    rejection_note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS payroll_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    created_by INTEGER REFERENCES employees(id),
    finalized_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS payroll_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    salary_type TEXT,
    base_rate REAL DEFAULT 0,
    total_hours REAL DEFAULT 0,
    total_days REAL DEFAULT 0,
    leave_days REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    net_pay REAL DEFAULT 0,
    notes TEXT,
    UNIQUE(period_id, employee_id)
  )`,

  // ── Accounting ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS accounting_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    closed_by INTEGER REFERENCES employees(id),
    closed_at TEXT,
    notes TEXT
  )`,

  // ── Approvals ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    requested_by TEXT,
    status TEXT DEFAULT 'pending_approval',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_request_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    action_by TEXT,
    reason TEXT,
    actioned_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Inventory Reconciliation ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS inventory_reconciliation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    outlet_id INTEGER REFERENCES outlets(id),
    external_location_id TEXT,
    local_qty REAL DEFAULT 0,
    external_qty REAL DEFAULT 0,
    diff REAL DEFAULT 0,
    status TEXT DEFAULT 'mismatch',
    checked_at TEXT DEFAULT (datetime('now','localtime')),
    resolution_status TEXT DEFAULT 'open',
    resolution_note TEXT,
    resolved_by INTEGER,
    resolved_at TEXT
  )`,

  // ── Web Orders (for orders.js — non-Shopify functionality) ───────────
  `CREATE TABLE IF NOT EXISTS web_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'shopify',
    external_order_id TEXT NOT NULL,
    external_order_number TEXT,
    customer_id INTEGER REFERENCES customers(id),
    outlet_id INTEGER REFERENCES outlets(id),
    currency TEXT DEFAULT 'PKR',
    subtotal REAL DEFAULT 0,
    discount_total REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    shipping_total REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    fulfillment_status TEXT DEFAULT 'unfulfilled',
    order_status TEXT DEFAULT 'open',
    ordered_at TEXT,
    raw_payload TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    stock_applied INTEGER DEFAULT 0,
    stock_applied_at TEXT,
    stock_policy_note TEXT,
    UNIQUE(source, external_order_id)
  )`,
  `CREATE TABLE IF NOT EXISTS web_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    sku TEXT,
    barcode TEXT,
    title TEXT,
    qty INTEGER NOT NULL,
    unit_price REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    line_total REAL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS web_order_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
    external_txn_id TEXT,
    gateway TEXT,
    kind TEXT,
    status TEXT,
    amount REAL DEFAULT 0,
    processed_at TEXT,
    raw_payload TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS web_order_fulfillments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
    external_fulfillment_id TEXT,
    status TEXT,
    carrier TEXT,
    tracking_number TEXT,
    tracking_url TEXT,
    fulfilled_at TEXT,
    raw_payload TEXT
  )`,

  // ── Shopify tables (minimal stubs — needed for route registration) ───
  `CREATE TABLE IF NOT EXISTS shopify_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    api_version TEXT DEFAULT '2025-10',
    webhook_secret TEXT,
    default_location_id TEXT,
    is_active INTEGER DEFAULT 1,
    last_sync_at TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS shopify_product_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    shopify_product_id TEXT,
    shopify_variant_id TEXT,
    shopify_inventory_item_id TEXT,
    is_active INTEGER DEFAULT 1,
    last_verified_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(product_id, variant_id),
    UNIQUE(shopify_product_id, shopify_variant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS shopify_location_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    shopify_location_id TEXT NOT NULL,
    shopify_location_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(outlet_id, shopify_location_id)
  )`,
  `CREATE TABLE IF NOT EXISTS external_sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    processed_at TEXT,
    attempt_count INTEGER DEFAULT 0,
    next_retry_at TEXT,
    last_attempt_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS shopify_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    run_type TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now','localtime')),
    finished_at TEXT,
    status TEXT DEFAULT 'running',
    processed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS shopify_order_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    web_order_id INTEGER REFERENCES web_orders(id),
    sale_id INTEGER REFERENCES sales(id),
    shopify_order_id TEXT NOT NULL UNIQUE,
    shopify_order_number TEXT,
    last_synced_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS shopify_customer_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    shopify_customer_id TEXT NOT NULL UNIQUE,
    last_synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,

  // ── Report Schedules ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS report_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    report_key TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'daily',
    run_hour INTEGER NOT NULL DEFAULT 6,
    run_minute INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'local',
    recipient TEXT,
    export_format TEXT NOT NULL DEFAULT 'csv',
    filters_json TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_schedule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
    run_started_at TEXT DEFAULT (datetime('now','localtime')),
    run_finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    file_path TEXT,
    row_count INTEGER DEFAULT 0,
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_run_id INTEGER REFERENCES report_schedule_runs(id) ON DELETE SET NULL,
    schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
    channel TEXT NOT NULL DEFAULT 'file',
    recipient TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    message TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS saved_report_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_key TEXT NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'personal',
    employee_id INTEGER,
    role_id INTEGER,
    filters_json TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_definition_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_key TEXT NOT NULL,
    version TEXT NOT NULL,
    query_signature TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(report_key, version)
  )`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_att_sessions_emp_date ON attendance_sessions(employee_id, session_start)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_parent_name_unique ON categories(COALESCE(parent_id, -1), lower(name))`,
  `CREATE INDEX IF NOT EXISTS idx_eo_employee ON employee_outlets(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_eo_outlet ON employee_outlets(outlet_id)`,
];

function seedSchema(db) {
  return new Promise((resolve, reject) => {
    db.run("PRAGMA foreign_keys = ON", (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        for (const sql of TABLES) {
          db.run(sql);
        }
        for (const sql of INDEXES) {
          db.run(sql);
        }
        db.run("SELECT 1", (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });
}

module.exports = { seedSchema };

-- schema-pg.sql — Complete SanoPOS PostgreSQL DDL
-- Run with: SET search_path = 'tenant_slug'; \i schema-pg.sql
-- All timestamps stored as TIMESTAMPTZ (UTC). No more dual UTC/LOCAL system.

-- ── Foundation tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS taxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate NUMERIC(8,4) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'cash',
  credit_days INTEGER NOT NULL DEFAULT 0,
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  permission TEXT NOT NULL,
  UNIQUE(role_id, permission)
);

CREATE TABLE IF NOT EXISTS outlets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  phone TEXT,
  branch_code TEXT,
  company_id INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  monthly_sales_target NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Cashier',
  pin_code TEXT UNIQUE NOT NULL,
  pin_hash TEXT,
  role_id INTEGER REFERENCES roles(id) DEFAULT 3,
  salary_type TEXT DEFAULT 'monthly',
  hourly_rate NUMERIC(12,2) DEFAULT 0,
  monthly_salary NUMERIC(12,2) DEFAULT 0,
  daily_rate NUMERIC(12,2) DEFAULT 0,
  joining_date TEXT,
  department TEXT,
  work_hours_per_day NUMERIC(4,1) DEFAULT 8,
  monthly_leave_allowance INTEGER DEFAULT 2,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  tokens_revoked_before TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS attribute_sets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS attributes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  attribute_set_id INTEGER NOT NULL REFERENCES attribute_sets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attribute_options (
  id SERIAL PRIMARY KEY,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);

-- ── Products ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  barcode TEXT,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  cost_price NUMERIC(12,2) DEFAULT 0.0,
  gst NUMERIC(8,4),
  category_id INTEGER REFERENCES categories(id),
  tax_id INTEGER REFERENCES taxes(id),
  brand_id INTEGER REFERENCES brands(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  has_variants BOOLEAN DEFAULT FALSE,
  attribute_set_id INTEGER REFERENCES attribute_sets(id),
  min_qty INTEGER DEFAULT 0,
  max_qty INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'pcs',
  description_html TEXT,
  compare_at_price NUMERIC(12,2) DEFAULT 0,
  product_type TEXT,
  vendor TEXT,
  tags TEXT,
  status TEXT DEFAULT 'active',
  sku TEXT,
  image_url TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE NOT NULL,
  price NUMERIC(12,2),
  cost_price NUMERIC(12,2),
  stock INTEGER DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(10,3) DEFAULT 0,
  weight_unit TEXT DEFAULT 'kg',
  compare_at_price NUMERIC(12,2) DEFAULT 0,
  barcode TEXT
);

CREATE TABLE IF NOT EXISTS variant_option_values (
  variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  attribute_option_id INTEGER NOT NULL REFERENCES attribute_options(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS product_media (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  url TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outlet_stock (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, outlet_id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  quantity_change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  from_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  to_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  quantity INTEGER NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  note TEXT,
  reversed BOOLEAN DEFAULT false,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'completed'
);

-- ── Customers ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  loyalty_points INTEGER DEFAULT 0,
  cnic TEXT,
  occupation TEXT,
  balance NUMERIC(12,2) DEFAULT 0,
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS customer_wallet_ledger (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL CHECK(type IN ('credit','debit')),
  amount NUMERIC(12,2) NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cash Shifts (must come before sales — FK dependency) ──────────────

CREATE TABLE IF NOT EXISTS cash_shifts (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  opening_float NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(12,2),
  expected_cash NUMERIC(12,2),
  variance NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  notes TEXT,
  variance_reason TEXT,
  variance_approved_by TEXT
);

CREATE TABLE IF NOT EXISTS shift_denominations (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'closing',
  denomination NUMERIC(12,2) NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) GENERATED ALWAYS AS (denomination * count) STORED
);

-- ── Sales ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  total_amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  outlet_id INTEGER REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  voided BOOLEAN DEFAULT FALSE,
  void_reason TEXT,
  customer_id INTEGER REFERENCES customers(id),
  discount_amount NUMERIC(12,2) DEFAULT 0,
  discount_type TEXT DEFAULT 'fixed',
  points_earned INTEGER DEFAULT 0,
  points_redeemed INTEGER DEFAULT 0,
  notes TEXT,
  invoice_number TEXT,
  shift_id INTEGER REFERENCES cash_shifts(id),
  idempotency_key TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price_at_sale NUMERIC(12,2) NOT NULL,
  cost_price_at_sale NUMERIC(12,2) DEFAULT 0.0,
  variant_id INTEGER REFERENCES product_variants(id)
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  payment_method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  year INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- ── Returns ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  original_sale_id INTEGER,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  customer_id INTEGER REFERENCES customers(id),
  total_refund NUMERIC(12,2) NOT NULL,
  refund_method TEXT NOT NULL,
  reason TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  shift_id INTEGER REFERENCES cash_shifts(id)
);

CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  refund_price NUMERIC(12,2) NOT NULL
);

-- ── Purchase Orders & GRN ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT DEFAULT 'Draft',
  total_cost NUMERIC(12,2) DEFAULT 0.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS po_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS po_template_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES po_templates(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id SERIAL PRIMARY KEY,
  grn_number TEXT UNIQUE NOT NULL,
  po_id INTEGER REFERENCES purchase_orders(id),
  outlet_id INTEGER REFERENCES outlets(id),
  received_by INTEGER REFERENCES employees(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS grn_items (
  id SERIAL PRIMARY KEY,
  grn_id INTEGER NOT NULL REFERENCES goods_received_notes(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_ordered INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  grn_id INTEGER REFERENCES goods_received_notes(id),
  invoice_number TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
  due_date TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  supplier_invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  reference TEXT,
  paid_by TEXT,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- ── Supplier Returns ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_returns (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id),
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  return_date TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'Pending',
  reason TEXT,
  total_value NUMERIC(12,2) DEFAULT 0,
  reference_number TEXT
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id SERIAL PRIMARY KEY,
  supplier_return_id INTEGER REFERENCES supplier_returns(id),
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2),
  reason TEXT
);

-- ── Promotions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('percent','fixed','threshold_percent','threshold_fixed','bxgy')),
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_order_amount NUMERIC(12,2) DEFAULT 0,
  buy_qty INTEGER DEFAULT 0,
  get_qty INTEGER DEFAULT 0,
  applies_to TEXT DEFAULT 'all',
  product_id INTEGER REFERENCES products(id),
  category_id INTEGER REFERENCES categories(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TEXT,
  ends_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Attendance ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  check_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out TIMESTAMPTZ,
  hours NUMERIC(6,2),
  status TEXT NOT NULL DEFAULT 'present',
  comment TEXT
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id SERIAL PRIMARY KEY,
  attendance_id INTEGER REFERENCES employee_attendance(id) ON DELETE SET NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  session_type TEXT NOT NULL DEFAULT 'work',
  break_reason TEXT,
  session_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_end TIMESTAMPTZ,
  duration_hours NUMERIC(6,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Parked Sales ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parked_sales (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  customer_id INTEGER REFERENCES customers(id),
  label TEXT,
  notes TEXT,
  parked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parked_sale_items (
  id SERIAL PRIMARY KEY,
  parked_sale_id INTEGER NOT NULL REFERENCES parked_sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  effective_tax_rate NUMERIC(8,4) DEFAULT 0
);

-- ── Expenses ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES expense_categories(id),
  outlet_id INTEGER REFERENCES outlets(id),
  shift_id INTEGER REFERENCES cash_shifts(id),
  employee_id INTEGER REFERENCES employees(id),
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Barcodes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS barcode_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  width_mm NUMERIC(6,1) NOT NULL DEFAULT 50,
  height_mm NUMERIC(6,1) NOT NULL DEFAULT 30,
  show_name BOOLEAN NOT NULL DEFAULT TRUE,
  show_price BOOLEAN NOT NULL DEFAULT TRUE,
  show_barcode BOOLEAN NOT NULL DEFAULT TRUE,
  show_sku BOOLEAN NOT NULL DEFAULT FALSE,
  show_brand BOOLEAN NOT NULL DEFAULT FALSE,
  font_size INTEGER NOT NULL DEFAULT 10,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barcode_print_jobs (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES barcode_templates(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT,
  barcode TEXT,
  price NUMERIC(12,2),
  copies INTEGER NOT NULL DEFAULT 1,
  printed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Receipt Templates & Action History ────────────────────────────────

CREATE TABLE IF NOT EXISTS receipt_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  header_text TEXT DEFAULT '',
  footer_text TEXT DEFAULT '',
  show_barcode BOOLEAN DEFAULT FALSE,
  show_logo BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_history (
  id SERIAL PRIMARY KEY,
  user_name TEXT,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Serial Numbers ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_serial_numbers (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  sale_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, serial_number)
);

-- ── Gift Cards ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gift_cards (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_value NUMERIC(12,2) NOT NULL,
  remaining_value NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Feature Flags ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Backup Log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS backup_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  filename TEXT,
  size_bytes BIGINT,
  performed_by TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Company Profile ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_profile (
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  setup_complete BOOLEAN DEFAULT TRUE,
  setup_token TEXT,
  monthly_sales_target NUMERIC(12,2) DEFAULT 0,
  margin_threshold_pct NUMERIC(6,2) DEFAULT 20,
  refund_threshold_pct NUMERIC(6,2) DEFAULT 5,
  void_threshold_pct NUMERIC(6,2) DEFAULT 3
);

-- ── Companies (Context Unification) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Employee-Outlet Junction ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_outlets (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, outlet_id)
);

-- ── CRM / Quotations ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'medium',
  expected_value NUMERIC(12,2) DEFAULT 0,
  assigned_to INTEGER REFERENCES employees(id),
  customer_id INTEGER REFERENCES customers(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id),
  type TEXT DEFAULT 'note',
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  quote_number TEXT UNIQUE,
  lead_id INTEGER REFERENCES crm_leads(id),
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'draft',
  discount_type TEXT DEFAULT 'fixed',
  discount_amount NUMERIC(12,2) DEFAULT 0,
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax_total NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  valid_until TEXT,
  notes TEXT,
  converted_sale_id INTEGER REFERENCES sales(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8,4) DEFAULT 0,
  line_total NUMERIC(12,2) DEFAULT 0
);

-- ── HR: Leave & Payroll ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL DEFAULT 'annual',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days NUMERIC(4,1) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by INTEGER REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  rejection_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id SERIAL PRIMARY KEY,
  period_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_by INTEGER REFERENCES employees(id),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  salary_type TEXT,
  base_rate NUMERIC(12,2) DEFAULT 0,
  total_hours NUMERIC(8,2) DEFAULT 0,
  total_days NUMERIC(6,1) DEFAULT 0,
  leave_days NUMERIC(6,1) DEFAULT 0,
  gross_pay NUMERIC(12,2) DEFAULT 0,
  deductions NUMERIC(12,2) DEFAULT 0,
  net_pay NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  UNIQUE(period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS hr_payroll_lines (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  base_salary NUMERIC(12,2) DEFAULT 0,
  deductions NUMERIC(12,2) DEFAULT 0,
  net_pay NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_id, employee_id)
);

-- ── Accounting ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounting_periods (
  id SERIAL PRIMARY KEY,
  period_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  closed_by INTEGER REFERENCES employees(id),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

-- ── Approvals ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  request_type TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  reference_type TEXT NOT NULL,
  requested_by TEXT,
  status TEXT DEFAULT 'pending_approval',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_actions (
  id SERIAL PRIMARY KEY,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  action_by TEXT,
  reason TEXT,
  actioned_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Inventory Reconciliation ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_reconciliation (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  outlet_id INTEGER REFERENCES outlets(id),
  external_location_id TEXT,
  local_qty NUMERIC(12,2) DEFAULT 0,
  external_qty NUMERIC(12,2) DEFAULT 0,
  diff NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'mismatch',
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  resolution_status TEXT DEFAULT 'open',
  resolution_note TEXT,
  resolved_by INTEGER,
  resolved_at TIMESTAMPTZ
);

-- ── Web Orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_orders (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'shopify',
  external_order_id TEXT NOT NULL,
  external_order_number TEXT,
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  currency TEXT DEFAULT 'PKR',
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount_total NUMERIC(12,2) DEFAULT 0,
  tax_total NUMERIC(12,2) DEFAULT 0,
  shipping_total NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) DEFAULT 0,
  payment_status TEXT DEFAULT 'pending',
  fulfillment_status TEXT DEFAULT 'unfulfilled',
  order_status TEXT DEFAULT 'open',
  ordered_at TIMESTAMPTZ,
  raw_payload TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  stock_applied BOOLEAN DEFAULT FALSE,
  stock_applied_at TIMESTAMPTZ,
  stock_policy_note TEXT,
  UNIQUE(source, external_order_id)
);

CREATE TABLE IF NOT EXISTS web_order_items (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  sku TEXT,
  barcode TEXT,
  title TEXT,
  qty INTEGER NOT NULL,
  unit_price NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  line_total NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS web_order_transactions (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
  external_txn_id TEXT,
  gateway TEXT,
  kind TEXT,
  status TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  processed_at TIMESTAMPTZ,
  raw_payload TEXT
);

CREATE TABLE IF NOT EXISTS web_order_fulfillments (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
  external_fulfillment_id TEXT,
  status TEXT,
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  fulfilled_at TIMESTAMPTZ,
  raw_payload TEXT
);

-- ── Shopify tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shopify_connections (
  id SERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  api_version TEXT DEFAULT '2025-10',
  webhook_secret TEXT,
  default_location_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopify_product_map (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  shopify_inventory_item_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, variant_id),
  UNIQUE(shopify_product_id, shopify_variant_id)
);

CREATE TABLE IF NOT EXISTS shopify_product_metadata (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  shopify_handle TEXT,
  shopify_status TEXT,
  shopify_product_type TEXT,
  shopify_vendor TEXT,
  shopify_tags TEXT,
  shopify_published_at TIMESTAMPTZ,
  shopify_updated_at TIMESTAMPTZ,
  last_imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id)
);

CREATE TABLE IF NOT EXISTS shopify_location_map (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  shopify_location_id TEXT NOT NULL,
  shopify_location_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(outlet_id, shopify_location_id)
);

CREATE TABLE IF NOT EXISTS external_sync_events (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  payload TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempt_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shopify_sync_runs (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL,
  run_type TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  processed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS shopify_order_map (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id),
  sale_id INTEGER REFERENCES sales(id),
  shopify_order_id TEXT NOT NULL UNIQUE,
  shopify_order_number TEXT,
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shopify_customer_map (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  shopify_customer_id TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Report Schedules ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_schedules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  report_key TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily',
  run_hour INTEGER NOT NULL DEFAULT 6,
  run_minute INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recipient TEXT,
  export_format TEXT NOT NULL DEFAULT 'csv',
  filters_json TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_schedule_runs (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  run_started_at TIMESTAMPTZ DEFAULT NOW(),
  run_finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  file_path TEXT,
  row_count INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS report_delivery_log (
  id SERIAL PRIMARY KEY,
  schedule_run_id INTEGER REFERENCES report_schedule_runs(id) ON DELETE SET NULL,
  schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'file',
  recipient TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_report_views (
  id SERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'personal',
  employee_id INTEGER,
  role_id INTEGER,
  filters_json TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_definition_versions (
  id SERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  version TEXT NOT NULL,
  query_signature TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_key, version)
);

-- ── Printer & Email Config ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS printer_config (
  id SERIAL PRIMARY KEY,
  connection_type TEXT DEFAULT 'network',
  host TEXT DEFAULT '192.168.1.100',
  port INTEGER DEFAULT 9100,
  usb_vendor_id TEXT,
  usb_product_id TEXT,
  paper_width INTEGER DEFAULT 48,
  cash_drawer BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS email_config (
  id SERIAL PRIMARY KEY,
  smtp_host TEXT DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_pass TEXT,
  from_name TEXT DEFAULT 'OneShopPOS',
  enabled BOOLEAN DEFAULT FALSE
);

-- ── Token Revocation ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id SERIAL PRIMARY KEY,
  token_jti TEXT UNIQUE NOT NULL,
  employee_id INTEGER,
  revoked_by INTEGER,
  reason TEXT,
  revoked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_att_sessions_emp_date ON attendance_sessions(employee_id, session_start);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_parent_name_unique ON categories(COALESCE(parent_id, -1), lower(name));
CREATE INDEX IF NOT EXISTS idx_eo_employee ON employee_outlets(employee_id);
CREATE INDEX IF NOT EXISTS idx_eo_outlet ON employee_outlets(outlet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products(deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees(deleted_at);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti);

-- ── Seed data ─────────────────────────────────────────────────────
INSERT INTO company_profile (id, company_name, setup_complete)
VALUES (1, 'My Store', false)
ON CONFLICT (id) DO NOTHING;

-- ── Schema versioning ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

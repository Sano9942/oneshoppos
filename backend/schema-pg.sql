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
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  tax_id INTEGER,
  hs_code TEXT
);

CREATE TABLE IF NOT EXISTS taxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate NUMERIC(8,4) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  fbr_further_tax NUMERIC(8,4) DEFAULT 0,
  fbr_extra_tax NUMERIC(8,4) DEFAULT 0,
  fbr_fed_rate NUMERIC(8,4) DEFAULT 0
);

-- FK for categories.tax_id (categories created before taxes)
DO $$ BEGIN
  ALTER TABLE categories ADD CONSTRAINT fk_categories_tax_id FOREIGN KEY (tax_id) REFERENCES taxes(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
  pin_code TEXT,
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
  tokens_revoked_before TIMESTAMPTZ DEFAULT NULL,
  email TEXT,
  password_hash TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique ON employees (email) WHERE email IS NOT NULL;

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
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  is_bundle BOOLEAN DEFAULT false,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0
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

-- ── Price Lists ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'customer_group' CHECK(type IN ('customer_group','volume','promotional')),
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id SERIAL PRIMARY KEY,
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  price NUMERIC(12,2) NOT NULL,
  min_qty INTEGER DEFAULT 1,
  UNIQUE(price_list_id, product_id, variant_id, min_qty)
);

-- ── Product Bundles ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_bundles (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES products(id),
  component_variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, component_product_id, component_variant_id)
);

-- ── Customer Groups ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  discount_percent NUMERIC(4,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Loyalty Tiers ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  min_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  points_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  discount_percent NUMERIC(4,2) DEFAULT 0,
  benefits TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  ntn_cnic TEXT,
  is_blacklisted BOOLEAN DEFAULT false,
  blacklist_reason TEXT,
  blacklisted_at TIMESTAMPTZ,
  date_of_birth DATE,
  gender TEXT,
  city TEXT,
  customer_group_id INTEGER REFERENCES customer_groups(id),
  notes TEXT,
  tags TEXT[],
  preferred_payment_method TEXT,
  preferred_contact TEXT,
  loyalty_tier_id INTEGER REFERENCES loyalty_tiers(id),
  total_spend NUMERIC(12,2) DEFAULT 0,
  price_list_id INTEGER
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
  idempotency_key TEXT,
  fbr_status TEXT DEFAULT 'not_applicable',
  fbr_irn TEXT,
  fbr_qr_code TEXT
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

-- ── Product Reviews ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_reviews (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  title TEXT,
  body TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  moderated_by INTEGER REFERENCES employees(id),
  moderated_at TIMESTAMPTZ,
  sale_id INTEGER REFERENCES sales(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  shift_id INTEGER REFERENCES cash_shifts(id),
  fbr_status TEXT DEFAULT 'not_applicable',
  fbr_irn TEXT
);

CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
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
  schema_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  size_bytes BIGINT DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
  setup_token_expires_at TIMESTAMPTZ,
  monthly_sales_target NUMERIC(12,2) DEFAULT 0,
  margin_threshold_pct NUMERIC(6,2) DEFAULT 20,
  refund_threshold_pct NUMERIC(6,2) DEFAULT 5,
  void_threshold_pct NUMERIC(6,2) DEFAULT 3,
  cash_denominations TEXT DEFAULT '[5000,1000,500,100,50,20,10]',
  onboarding_dismissed BOOLEAN DEFAULT false,
  fbr_api_token TEXT,
  fbr_environment TEXT DEFAULT 'sandbox',
  fbr_default_hs_code TEXT,
  fbr_province TEXT
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

-- ── Credit & Debit Notes ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_notes (
  id SERIAL PRIMARY KEY,
  note_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('sales','purchase')),
  customer_id INTEGER REFERENCES customers(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','applied','cancelled')),
  approved_by INTEGER REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id SERIAL PRIMARY KEY,
  note_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('sales','purchase')),
  customer_id INTEGER REFERENCES customers(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','applied','cancelled')),
  approved_by INTEGER REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Post-Dated Cheques ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS postdated_cheques (
  id SERIAL PRIMARY KEY,
  cheque_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('receivable','payable')),
  party_type TEXT NOT NULL CHECK(party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL,
  bank_name TEXT,
  amount NUMERIC(12,2) NOT NULL,
  issue_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','deposited','cleared','bounced','cancelled')),
  deposited_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Chart of Accounts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),
  sub_type TEXT,
  parent_id INTEGER REFERENCES chart_of_accounts(id),
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  normal_balance TEXT CHECK(normal_balance IN ('debit','credit')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Journal Entries ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','posted','voided')),
  reference_type TEXT,
  reference_id INTEGER,
  posted_by INTEGER REFERENCES employees(id),
  posted_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES employees(id),
  voided_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id SERIAL PRIMARY KEY,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
  description TEXT,
  debit NUMERIC(12,2) DEFAULT 0,
  credit NUMERIC(12,2) DEFAULT 0,
  CHECK(debit >= 0 AND credit >= 0)
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

-- ── Courier Integrations ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courier_integrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_key TEXT NOT NULL DEFAULT 'generic',
  api_base_url TEXT,
  api_key TEXT,
  api_secret TEXT,
  tracking_url_template TEXT,
  enabled BOOLEAN DEFAULT false,
  config_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
  ('Leopards Courier', 'leopards', 'https://leopardscourier.com/tracking/track-your-order?id={tracking}'),
  ('TCS', 'tcs', 'https://www.tcsexpress.com/tracking?code={tracking}'),
  ('BlueEx', 'blueex', 'https://blue-ex.com/tracking/{tracking}'),
  ('Trax', 'trax', 'https://trax.pk/tracking/{tracking}'),
  ('PostEx', 'postex', 'https://postex.pk/tracking/{tracking}'),
  ('Rider', 'rider', 'https://rider.pk/tracking/{tracking}'),
  ('Call Courier', 'callcourier', 'https://callcourier.com.pk/tracking/{tracking}'),
  ('M&P', 'mnp', 'https://www.mulphico.com/tracking/{tracking}'),
  ('Bykea', 'bykea', ''),
  ('Swyft', 'swyft', 'https://swyft.pk/tracking/{tracking}'),
  ('Pakistan Post', 'pakpost', 'https://ep.gov.pk/track/{tracking}'),
  ('DHL Express', 'dhl', 'https://www.dhl.com/pk-en/home/tracking.html?tracking-id={tracking}'),
  ('FedEx', 'fedex', 'https://www.fedex.com/fedextrack/?trknbr={tracking}')
ON CONFLICT DO NOTHING;

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
  tracking_number TEXT,
  courier_id INTEGER REFERENCES courier_integrations(id),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
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

-- ── Courier Integrations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courier_integrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_key TEXT NOT NULL DEFAULT 'generic',
  api_base_url TEXT,
  api_key TEXT,
  api_secret TEXT,
  tracking_url_template TEXT,
  enabled BOOLEAN DEFAULT false,
  config_json TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
  ('Leopards Courier', 'leopards', 'https://leopardscourier.com/tracking/track-your-order?id={tracking}'),
  ('TCS', 'tcs', 'https://www.tcsexpress.com/tracking?code={tracking}'),
  ('BlueEx', 'blueex', 'https://blue-ex.com/tracking/{tracking}'),
  ('Trax', 'trax', 'https://trax.pk/tracking/{tracking}'),
  ('PostEx', 'postex', 'https://postex.pk/tracking/{tracking}'),
  ('Rider', 'rider', 'https://rider.pk/tracking/{tracking}'),
  ('Call Courier', 'callcourier', 'https://callcourier.com.pk/tracking/{tracking}'),
  ('M&P', 'mnp', 'https://www.mulphico.com/tracking/{tracking}'),
  ('Bykea', 'bykea', ''),
  ('Swyft', 'swyft', 'https://swyft.pk/tracking/{tracking}'),
  ('Pakistan Post', 'pakpost', 'https://ep.gov.pk/track/{tracking}'),
  ('DHL Express', 'dhl', 'https://www.dhl.com/pk-en/home/tracking.html?tracking-id={tracking}'),
  ('FedEx', 'fedex', 'https://www.fedex.com/fedextrack/?trknbr={tracking}')
ON CONFLICT DO NOTHING;

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

-- ── Integration Settings (WooCommerce, etc.) ────────────────────────

CREATE TABLE IF NOT EXISTS integration_settings (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  store_url TEXT,
  api_key TEXT,
  api_secret TEXT,
  display_name TEXT,
  category TEXT DEFAULT 'marketplace',
  is_active BOOLEAN DEFAULT false,
  oauth_token TEXT,
  oauth_refresh_token TEXT,
  oauth_expires_at TIMESTAMPTZ,
  webhook_secret TEXT,
  config_json TEXT DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  sync_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Marketplace Mapping Tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS daraz_product_map (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  daraz_item_id TEXT NOT NULL,
  daraz_sku TEXT,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(daraz_item_id)
);

CREATE TABLE IF NOT EXISTS daraz_order_map (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE CASCADE,
  daraz_order_id TEXT NOT NULL UNIQUE,
  daraz_order_number TEXT,
  daraz_status TEXT,
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS facebook_product_map (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  fb_product_id TEXT NOT NULL,
  fb_catalog_id TEXT,
  ig_product_id TEXT,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(fb_product_id)
);

CREATE TABLE IF NOT EXISTS facebook_order_map (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE CASCADE,
  fb_order_id TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'facebook',
  fb_status TEXT,
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  wa_conversation_id TEXT,
  phone_number TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  content TEXT,
  wa_message_id TEXT UNIQUE,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_merchant_feed_log (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  gmc_offer_id TEXT,
  feed_status TEXT DEFAULT 'pending',
  disapproval_reason TEXT,
  last_pushed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ
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
CREATE INDEX IF NOT EXISTS idx_daraz_product_map_product ON daraz_product_map(product_id);
CREATE INDEX IF NOT EXISTS idx_daraz_order_map_web_order ON daraz_order_map(web_order_id);
CREATE INDEX IF NOT EXISTS idx_facebook_product_map_product ON facebook_product_map(product_id);
CREATE INDEX IF NOT EXISTS idx_facebook_order_map_web_order ON facebook_order_map(web_order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_customer ON whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone ON whatsapp_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_google_merchant_feed_product ON google_merchant_feed_log(product_id);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees(deleted_at);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti);

-- Performance indexes (migration v13)
CREATE INDEX IF NOT EXISTS idx_sales_outlet_id ON sales (outlet_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales (employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales (invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales (voided) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_deleted_at_active ON products (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile) WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_shifts_outlet_status ON cash_shifts (outlet_id, status);
CREATE INDEX IF NOT EXISTS idx_returns_original_sale_id ON returns (original_sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_timestamp ON returns (timestamp DESC);

-- ── Password Reset Tokens ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- ── Support Tickets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id              SERIAL PRIMARY KEY,
  type            VARCHAR(20) NOT NULL DEFAULT 'bug',
  message         TEXT NOT NULL,
  page_url        TEXT,
  browser         TEXT,
  employee_id     INTEGER REFERENCES employees(id),
  screenshots     JSONB DEFAULT '[]',
  last_req_id     VARCHAR(64),
  status          VARCHAR(20) DEFAULT 'open',
  admin_reply     TEXT,
  replied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMPTZ
);

-- ── FBR Digital Invoicing ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fbr_invoices (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  return_id INTEGER REFERENCES returns(id),
  invoice_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fbr_irn TEXT,
  fbr_response JSONB,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fbr_invoices_status ON fbr_invoices(status, next_retry_at);

-- reference_id points to tax_rate_reference.id in the PUBLIC schema.
-- No FK constraint because cross-schema FKs break tenant isolation.
CREATE TABLE IF NOT EXISTS tax_rate_suggestions (
  id SERIAL PRIMARY KEY,
  reference_id INTEGER NOT NULL,
  suggested_by_tenant TEXT,
  suggested_by_employee INTEGER,
  field_name TEXT NOT NULL,
  current_value NUMERIC(8,4),
  suggested_value NUMERIC(8,4) NOT NULL,
  source_reference TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_rate_reference (
  id SERIAL PRIMARY KEY,
  hs_code TEXT NOT NULL,
  description_en TEXT NOT NULL,
  description_ur TEXT,
  federal_gst NUMERIC(8,4) DEFAULT 0,
  punjab_pra NUMERIC(8,4) DEFAULT 0,
  sindh_srb NUMERIC(8,4) DEFAULT 0,
  kpk_kpra NUMERIC(8,4) DEFAULT 0,
  balochistan_bra NUMERIC(8,4) DEFAULT 0,
  exemption_notes TEXT,
  last_updated DATE DEFAULT CURRENT_DATE
);

-- Email queue (public schema — cross-tenant deferred emails)
CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  email_type TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  from_address TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_queue_pending
  ON email_queue(send_at) WHERE sent_at IS NULL AND attempts < max_attempts;

-- ── Super Admin Enhancements ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id              SERIAL PRIMARY KEY,
  admin_email     TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  details         JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created ON admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action);

CREATE TABLE IF NOT EXISTS admin_security_log (
  id              SERIAL PRIMARY KEY,
  event_type      TEXT NOT NULL,
  email           TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  details         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_security_log_created ON admin_security_log(created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_notes (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL,
  admin_email     TEXT NOT NULL,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_notes_tenant ON tenant_notes(tenant_id);

CREATE TABLE IF NOT EXISTS announcements (
  id              SERIAL PRIMARY KEY,
  message         TEXT NOT NULL,
  type            TEXT DEFAULT 'info',
  active          BOOLEAN DEFAULT true,
  starts_at       TIMESTAMPTZ DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_log (
  id              SERIAL PRIMARY KEY,
  admin_email     TEXT NOT NULL,
  broadcast_type  TEXT NOT NULL,
  subject         TEXT NOT NULL,
  message         TEXT NOT NULL,
  recipient_count INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Stock Counts (Inventory Audit) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_counts (
  id SERIAL PRIMARY KEY,
  count_number TEXT NOT NULL,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','cancelled')),
  started_by INTEGER REFERENCES employees(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_by INTEGER REFERENCES employees(id),
  completed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id SERIAL PRIMARY KEY,
  stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  system_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER DEFAULT 0,
  last_scanned_at TIMESTAMPTZ,
  UNIQUE(stock_count_id, product_id, variant_id)
);

-- ── Fulfillment (Pick/Pack/Dispatch) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS picklists (
  id SERIAL PRIMARY KEY,
  picklist_number TEXT NOT NULL,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','picking','picked','packing','packed','dispatched','cancelled')),
  assigned_to INTEGER REFERENCES employees(id),
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  picked_at TIMESTAMPTZ,
  packed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS picklist_items (
  id SERIAL PRIMARY KEY,
  picklist_id INTEGER NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  web_order_id INTEGER NOT NULL REFERENCES web_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  qty_to_pick INTEGER NOT NULL,
  qty_picked INTEGER DEFAULT 0,
  qty_packed INTEGER DEFAULT 0,
  barcode TEXT,
  picked_at TIMESTAMPTZ,
  packed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS loadsheets (
  id SERIAL PRIMARY KEY,
  loadsheet_number TEXT NOT NULL,
  courier_id INTEGER REFERENCES courier_integrations(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','finalized','handed_over')),
  total_orders INTEGER DEFAULT 0,
  total_cod NUMERIC(12,2) DEFAULT 0,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  handed_over_at TIMESTAMPTZ,
  handed_over_to TEXT
);

CREATE TABLE IF NOT EXISTS loadsheet_orders (
  id SERIAL PRIMARY KEY,
  loadsheet_id INTEGER NOT NULL REFERENCES loadsheets(id) ON DELETE CASCADE,
  web_order_id INTEGER NOT NULL REFERENCES web_orders(id),
  tracking_number TEXT,
  is_cod BOOLEAN DEFAULT false,
  cod_amount NUMERIC(12,2) DEFAULT 0,
  UNIQUE(loadsheet_id, web_order_id)
);

-- ── Sales Channels ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_channels (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO sales_channels (code, name, type) VALUES
  ('pos',         'Point of Sale',  'pos'),
  ('storefront',  'Online Store',   'online_store'),
  ('shopify',     'Shopify',        'online_store'),
  ('woocommerce', 'WooCommerce',    'online_store'),
  ('daraz',       'Daraz',          'marketplace'),
  ('facebook',    'Facebook',       'social'),
  ('instagram',   'Instagram',      'social'),
  ('whatsapp',    'WhatsApp',       'messaging')
ON CONFLICT (code) DO NOTHING;

-- ── Channel Publications ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_publications (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL REFERENCES sales_channels(id),
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INT REFERENCES product_variants(id) ON DELETE CASCADE,
  is_published BOOLEAN DEFAULT TRUE,
  published_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_publications_unique
  ON channel_publications (channel_id, product_id, COALESCE(variant_id, 0));
CREATE INDEX IF NOT EXISTS idx_channel_publications_product ON channel_publications(product_id);
CREATE INDEX IF NOT EXISTS idx_channel_publications_channel ON channel_publications(channel_id);

-- ── Inventory Reservations ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id SERIAL PRIMARY KEY,
  reservation_key TEXT NOT NULL,
  channel_id INT REFERENCES sales_channels(id),
  web_order_id INT REFERENCES web_orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  variant_id INT REFERENCES product_variants(id),
  outlet_id INT NOT NULL REFERENCES outlets(id),
  quantity INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_key ON inventory_reservations(reservation_key);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_outlet_product ON inventory_reservations(outlet_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_status ON inventory_reservations(status) WHERE status = 'active';

-- ── Web Order Allocations ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_order_allocations (
  id SERIAL PRIMARY KEY,
  web_order_id INT NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
  web_order_item_id INT REFERENCES web_order_items(id) ON DELETE CASCADE,
  fulfillment_outlet_id INT NOT NULL REFERENCES outlets(id),
  fulfillment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  allocated_qty INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_order_allocations_order ON web_order_allocations(web_order_id);
CREATE INDEX IF NOT EXISTS idx_web_order_allocations_outlet ON web_order_allocations(fulfillment_outlet_id);

-- ── Customer Addresses ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_addresses (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  recipient_name TEXT,
  phone TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country_code TEXT DEFAULT 'PK',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- ── Storefront Carts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS storefront_carts (
  id SERIAL PRIMARY KEY,
  cart_token TEXT NOT NULL UNIQUE,
  customer_id INT REFERENCES customers(id),
  channel_id INT REFERENCES sales_channels(id),
  pickup_outlet_id INT REFERENCES outlets(id),
  delivery_method TEXT,
  currency TEXT DEFAULT 'PKR',
  quote_payload JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storefront_carts_token ON storefront_carts(cart_token);
CREATE INDEX IF NOT EXISTS idx_storefront_carts_customer ON storefront_carts(customer_id);

-- ── Storefront Cart Items ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS storefront_cart_items (
  id SERIAL PRIMARY KEY,
  cart_id INT NOT NULL REFERENCES storefront_carts(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  variant_id INT REFERENCES product_variants(id),
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storefront_cart_items_cart ON storefront_cart_items(cart_id);

-- ── Omnichannel column extensions ───────────────────────────────────

ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS channel_id INT REFERENCES sales_channels(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS delivery_method TEXT;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS pickup_outlet_id INT REFERENCES outlets(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS fulfillment_outlet_id INT REFERENCES outlets(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_phone_snapshot TEXT;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_email_snapshot TEXT;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS shipping_address_json JSONB;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS pickup_ready_at TIMESTAMPTZ;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS curbside_arrived_at TIMESTAMPTZ;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS public_order_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_web_orders_channel ON web_orders(channel_id);
CREATE INDEX IF NOT EXISTS idx_web_orders_public_token ON web_orders(public_order_token);
CREATE INDEX IF NOT EXISTS idx_web_orders_delivery_method ON web_orders(delivery_method);

ALTER TABLE returns ADD COLUMN IF NOT EXISTS web_order_id INT REFERENCES web_orders(id);
CREATE INDEX IF NOT EXISTS idx_returns_web_order ON returns(web_order_id) WHERE web_order_id IS NOT NULL;

-- ── FK for customers.price_list_id (price_lists created after customers) ─
DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES price_lists(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Seed data ─────────────────────────────────────────────────────
INSERT INTO company_profile (id, company_name, setup_complete)
VALUES (1, 'My Store', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled, description)
VALUES ('fbr_integration', false, 'FBR Digital Invoicing - real-time invoice posting to FBR API')
ON CONFLICT (key) DO NOTHING;

-- Seed default loyalty tiers
INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, color, sort_order)
VALUES
  ('Bronze', 0, 1.0, 0, '#CD7F32', 1),
  ('Silver', 25000, 1.5, 2, '#C0C0C0', 2),
  ('Gold', 75000, 2.0, 5, '#FFD700', 3),
  ('Platinum', 200000, 3.0, 8, '#E5E4E2', 4)
ON CONFLICT DO NOTHING;

-- Seed default Pakistan-standard chart of accounts
INSERT INTO chart_of_accounts (code, name, type, sub_type, is_system, normal_balance) VALUES
  ('1000', 'Cash on Hand', 'asset', 'current_asset', true, 'debit'),
  ('1010', 'Bank Account', 'asset', 'current_asset', true, 'debit'),
  ('1100', 'Accounts Receivable', 'asset', 'current_asset', true, 'debit'),
  ('1200', 'Inventory', 'asset', 'current_asset', true, 'debit'),
  ('1300', 'Fixed Assets', 'asset', 'fixed_asset', true, 'debit'),
  ('2000', 'Accounts Payable', 'liability', 'current_liability', true, 'credit'),
  ('2100', 'Sales Tax Payable', 'liability', 'current_liability', true, 'credit'),
  ('2200', 'Other Payables', 'liability', 'current_liability', true, 'credit'),
  ('3000', 'Owner''s Equity', 'equity', 'equity', true, 'credit'),
  ('3100', 'Retained Earnings', 'equity', 'equity', true, 'credit'),
  ('4000', 'Sales Revenue', 'revenue', 'operating_revenue', true, 'credit'),
  ('4100', 'Service Revenue', 'revenue', 'operating_revenue', true, 'credit'),
  ('4200', 'Other Revenue', 'revenue', 'other_revenue', true, 'credit'),
  ('5000', 'Cost of Goods Sold', 'expense', 'cost_of_sales', true, 'debit'),
  ('5100', 'Salaries & Wages', 'expense', 'operating_expense', true, 'debit'),
  ('5200', 'Rent', 'expense', 'operating_expense', true, 'debit'),
  ('5300', 'Utilities', 'expense', 'operating_expense', true, 'debit'),
  ('5400', 'Marketing', 'expense', 'operating_expense', true, 'debit'),
  ('5500', 'Office Supplies', 'expense', 'operating_expense', true, 'debit'),
  ('5600', 'Depreciation', 'expense', 'operating_expense', true, 'debit'),
  ('5900', 'Other Expenses', 'expense', 'operating_expense', true, 'debit')
ON CONFLICT DO NOTHING;

-- ── Schema versioning ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

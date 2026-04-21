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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_bundle BOOLEAN DEFAULT false,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  -- 2-R.1: 86'd items (sold-out) tracking for restaurant mode
  is_sold_out BOOLEAN NOT NULL DEFAULT false,
  sold_out_since TIMESTAMPTZ,
  sold_out_until TIMESTAMPTZ,
  sold_out_reason TEXT,
  -- 2-G.2 Wave 2: mark this SKU as a gift card. On sale completion a
  -- gift_cards row is generated (digital code or physical range serial).
  is_gift_card_sku BOOLEAN NOT NULL DEFAULT false,
  -- 2-G.6 (migration v67): serialized-inventory opt-in. When true, GRN
  -- receive requires serial_numbers[] and POS requires the cashier to scan
  -- one serial per unit sold. default_warranty_months pre-fills the warranty
  -- length on newly received serials.
  serial_required BOOLEAN NOT NULL DEFAULT false,
  default_warranty_months INTEGER
);

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE NOT NULL,
  price NUMERIC(12,2),
  cost_price NUMERIC(12,2),
  stock NUMERIC(10,3) DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(10,3) DEFAULT 0,
  weight_unit TEXT DEFAULT 'kg',
  compare_at_price NUMERIC(12,2) DEFAULT 0,
  barcode TEXT,
  -- 2-R.1: 86'd items (sold-out) tracking for restaurant mode
  is_sold_out BOOLEAN NOT NULL DEFAULT false,
  sold_out_since TIMESTAMPTZ,
  sold_out_until TIMESTAMPTZ,
  sold_out_reason TEXT
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
  quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
  UNIQUE(product_id, outlet_id)
);

-- 2-G.1 (migration v65): per-variant per-outlet stock. product_variants.stock
-- stays as a cross-outlet rollup (kept in sync by sales/returns) for backwards
-- compat; new code prefers variant_outlet_stock for per-outlet reads + deducts.
CREATE TABLE IF NOT EXISTS variant_outlet_stock (
  id SERIAL PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
  UNIQUE(variant_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS idx_variant_outlet_stock_variant ON variant_outlet_stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_outlet_stock_outlet ON variant_outlet_stock(outlet_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  quantity_change NUMERIC(10,3) NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  -- 2-G.1 follow-up (migration v66): nullable variant_id lets admins correct
  -- variant-level stock. When set, the route also updates variant_outlet_stock.
  variant_id INTEGER REFERENCES product_variants(id)
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant
  ON stock_adjustments(variant_id) WHERE variant_id IS NOT NULL;

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
  status TEXT DEFAULT 'completed',
  -- 2-G.1 follow-up (migration v66): nullable variant_id lets admins move
  -- variant stock between outlets. When set, the route also updates
  -- variant_outlet_stock at both source + destination.
  variant_id INTEGER REFERENCES product_variants(id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_variant
  ON inventory_transfers(variant_id) WHERE variant_id IS NOT NULL;

-- ── Price Lists ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'customer_group' CHECK(type IN ('customer_group','volume','promotional')),
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  customer_group_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_lists_customer_group
  ON price_lists(customer_group_id)
  WHERE customer_group_id IS NOT NULL;

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

-- Phase 2-G Wave 2 (2-G.4): attach the FK after both tables exist so
-- schema apply works in a single pass (price_lists is defined earlier).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
      AND table_name = 'price_lists'
      AND constraint_name = 'price_lists_customer_group_id_fkey'
  ) THEN
    ALTER TABLE price_lists
      ADD CONSTRAINT price_lists_customer_group_id_fkey
      FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id);
  END IF;
END $$;

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
  price_list_id INTEGER,
  email_consent BOOLEAN DEFAULT false,
  sms_consent BOOLEAN DEFAULT false,
  whatsapp_consent BOOLEAN DEFAULT false,
  blood_group VARCHAR(5),
  allergies TEXT,
  medical_notes TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  insurance_id TEXT
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

-- Phase 2-G Wave 1: loyalty ledger (mirrors customer_wallet_ledger shape,
-- widened enum for loyalty lifecycle — earn/redeem/adjust/expire).
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust','expire')),
  points INTEGER NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer
  ON loyalty_transactions(customer_id, created_at DESC);

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
  quantity NUMERIC(10,3) NOT NULL,
  price_at_sale NUMERIC(12,2) NOT NULL,
  cost_price_at_sale NUMERIC(12,2) DEFAULT 0.0,
  variant_id INTEGER REFERENCES product_variants(id),
  gross_weight NUMERIC(10,3),
  tare_weight NUMERIC(10,3) DEFAULT 0,
  staff_id INTEGER REFERENCES employees(id),
  -- 2-R.8: seat_number carried from draft_order_items for dine-in checks.
  -- Retail sales leave this null. Indexed by (sale_id, seat_number) for
  -- per-seat aggregation in reports and receipts.
  seat_number INTEGER
  -- 2-G.5 (migration v64): price_override_* columns added via ALTER TABLE
  -- at the end of this file (after override_reasons + approval_events are
  -- defined, since they're forward-referenced FKs).
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_seat ON sale_items(sale_id, seat_number);

CREATE TABLE IF NOT EXISTS sale_payments (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  payment_method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  gateway_ref TEXT
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
  fbr_irn TEXT,
  gateway_refund_ref TEXT
);

-- return_reasons must precede return_items because return_items.reason_code_id
-- FKs to it. The richer lookup table is re-defined further down (Phase 2A
-- block) — this early CREATE IF NOT EXISTS is a forward-declaration sized to
-- satisfy the FK. The later definition is a no-op via IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS return_reasons (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  requires_note BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity NUMERIC(10,3) NOT NULL,
  refund_price NUMERIC(12,2) NOT NULL,
  restock_flag BOOLEAN NOT NULL DEFAULT true,
  reason_code_id INTEGER REFERENCES return_reasons(id)
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
  notes TEXT,
  voided BOOLEAN DEFAULT false,
  void_reason TEXT
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
  -- 2-G.6 (migration v67): variant + warranty + origin-GRN audit columns.
  -- variant_id is nullable because product-level serialization (no variants)
  -- stays valid. warranty_start_date is NULL until the serial is sold.
  variant_id INTEGER REFERENCES product_variants(id),
  warranty_months INTEGER,
  warranty_start_date DATE,
  warranty_end_date DATE,
  grn_id INTEGER REFERENCES goods_received_notes(id),
  UNIQUE(product_id, serial_number)
);
CREATE INDEX IF NOT EXISTS idx_product_serial_numbers_status_product
  ON product_serial_numbers(status, product_id);
CREATE INDEX IF NOT EXISTS idx_product_serial_numbers_variant
  ON product_serial_numbers(variant_id) WHERE variant_id IS NOT NULL;

-- 2-G.6 (migration v67): bridge between sale_items and product_serial_numbers
-- so a single line of quantity=N can carry N distinct serial numbers. The
-- legacy sale_id column on product_serial_numbers is kept populated in
-- parallel as a deprecation cushion.
CREATE TABLE IF NOT EXISTS sale_item_serials (
  id SERIAL PRIMARY KEY,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  serial_id INTEGER NOT NULL REFERENCES product_serial_numbers(id),
  UNIQUE(sale_item_id, serial_id)
);
CREATE INDEX IF NOT EXISTS idx_sale_item_serials_sale_item ON sale_item_serials(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_serials_serial ON sale_item_serials(serial_id);

-- ── Gift Cards ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gift_cards (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_value NUMERIC(12,2) NOT NULL,
  remaining_value NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  redeemed_at TIMESTAMPTZ,
  card_type TEXT NOT NULL DEFAULT 'digital'
    CHECK (card_type IN ('digital','physical')),
  activation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (activation_status IN ('pre_printed','issued','active','depleted')),
  issued_to_customer_id INTEGER REFERENCES customers(id),
  issued_to_email TEXT,
  issued_from_sale_id INTEGER REFERENCES sales(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 2-G Wave 2 (2-G.2): pre-printed physical card ranges.
CREATE TABLE IF NOT EXISTS gift_card_ranges (
  id SERIAL PRIMARY KEY,
  prefix TEXT NOT NULL,
  range_start BIGINT NOT NULL,
  range_end BIGINT NOT NULL,
  face_value NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (range_end >= range_start)
);

-- Phase 2-G Wave 1: gift card ledger (mirrors customer_wallet_ledger shape).
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id SERIAL PRIMARY KEY,
  gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit','debit')),
  amount NUMERIC(12,2) NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_gift_card
  ON gift_card_transactions(gift_card_id, created_at DESC);

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
  -- 2-G.3 Wave 2: tenant-wide loyalty conversion rates.
  --   earn_rate = points per PKR 100 of spend (default 1 = 1pt/100 PKR).
  --   redeem_rate = PKR off per 100 points redeemed (default 10 = PKR 10/100pts).
  loyalty_earn_rate NUMERIC(8,4) NOT NULL DEFAULT 1,
  loyalty_redeem_rate NUMERIC(8,4) NOT NULL DEFAULT 10,
  fbr_api_token TEXT,
  fbr_environment TEXT DEFAULT 'sandbox',
  fbr_default_hs_code TEXT,
  fbr_province TEXT,
  industry_type TEXT DEFAULT 'general_retail',
  business_model TEXT DEFAULT 'buy_sell',
  country_code TEXT DEFAULT 'PK',
  industry_preset_version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tenant_modes (
  mode TEXT NOT NULL PRIMARY KEY,
  enabled BOOLEAN DEFAULT true,
  enabled_at TIMESTAMPTZ DEFAULT NOW()
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
  converted_invoice_id INTEGER,
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

-- ── Web Order Allocations ───────────────────────────────────────────
-- Defined here (not later in the file) because picklist_items.allocation_id
-- references it. schema-pg.sql is executed top-to-bottom as one batch by
-- tenant-provisioner-pg.js, so forward-reference FKs fail fresh installs.

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
  allocation_id INTEGER REFERENCES web_order_allocations(id),
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

-- Phase 2-G Wave 1: seed all phase2g_* flags (default off; each wave flips
-- one on — no new migrations needed for flag registration).
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('phase2g_omni_input', false, '2-G.0 scan-first omni-input on /pos'),
  ('phase2g_variant_picker', false, '2-G.1 matrix variant grid modal'),
  ('phase2g_gift_cards', false, '2-G.2 gift cards as first-class tender'),
  ('phase2g_loyalty', false, '2-G.3 loyalty earn/redeem + tier auto-apply'),
  ('phase2g_price_books', false, '2-G.4 customer-group price books'),
  ('phase2g_price_override', false, '2-G.5 manager price override with PIN'),
  ('phase2g_serialized_inventory', false, '2-G.6 serialized inventory end-to-end'),
  ('phase2g_per_line_restock', false, '2-G.7 per-line restock toggle + reasons'),
  ('phase2g_inventory_intelligence', false, '2-G.8 inventory-intelligence hub'),
  ('phase2g_receipt_barcode_lookup', false, '2-G.11 receipt barcode + return lookup'),
  ('phase2g_label_designer', false, 'Parallel track — ZPL/TSPL/EPL label designer')
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

-- ── Phase 2A: Workforce Scheduling ──────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_shifts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  published_at TIMESTAMPTZ,
  publish_notification TEXT DEFAULT 'affected' CHECK (publish_notification IN ('affected','all','none')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_outlet_date ON scheduled_shifts(outlet_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_employee ON scheduled_shifts(employee_id, shift_date);

-- ── Phase 2A: Price List Assignments ────────────────────────────────
CREATE TABLE IF NOT EXISTS price_list_assignments (
  id SERIAL PRIMARY KEY,
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('outlet','channel','customer','customer_group')),
  scope_id INTEGER NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(price_list_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_price_list_assignments_scope ON price_list_assignments(scope_type, scope_id);

-- ── Phase 2A: Draft Orders ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS draft_orders (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  customer_id INTEGER REFERENCES customers(id),
  created_by INTEGER NOT NULL REFERENCES employees(id),
  claimed_by INTEGER REFERENCES employees(id),
  claimed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','completed','cancelled','merged')),
  notes TEXT,
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax_total NUMERIC(12,2) DEFAULT 0,
  discount_total NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  split_parent_id INTEGER REFERENCES draft_orders(id),
  split_strategy TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_draft_orders_outlet_status ON draft_orders(outlet_id, status);
CREATE INDEX IF NOT EXISTS idx_draft_orders_claimed ON draft_orders(claimed_by) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS idx_draft_orders_split_parent ON draft_orders(split_parent_id) WHERE split_parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS draft_order_items (
  id SERIAL PRIMARY KEY,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) DEFAULT 0,
  effective_tax_rate NUMERIC(6,4) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 2.1 A2: First-class modifiers. Relational so reports can aggregate
-- "extra cheese sold". Snapshots (option_name_snapshot, price_delta_snapshot)
-- survive rename/reprice of the parent modifier_options row without rewriting
-- history. When attaching modifiers to a draft_order_item, the summed price
-- delta is baked into draft_order_items.price so recalcCheckTotals needs no
-- change.
CREATE TABLE IF NOT EXISTS modifier_groups (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER REFERENCES outlets(id),
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL CHECK (selection_type IN ('single','multi')),
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifier_options (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_modifier_options_group ON modifier_options(group_id);

CREATE TABLE IF NOT EXISTS product_modifier_group_links (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS draft_order_item_modifiers (
  id SERIAL PRIMARY KEY,
  draft_order_item_id INTEGER NOT NULL REFERENCES draft_order_items(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES modifier_options(id),
  option_name_snapshot TEXT NOT NULL,
  price_delta_snapshot NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doim_item ON draft_order_item_modifiers(draft_order_item_id);

CREATE TABLE IF NOT EXISTS sale_item_modifiers (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL,
  option_id INTEGER REFERENCES modifier_options(id),
  option_name_snapshot TEXT NOT NULL,
  price_delta_snapshot NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sim_sale ON sale_item_modifiers(sale_id);

-- ── Phase 2A: Approval Policies (generic) ───────────────────────────
CREATE TABLE IF NOT EXISTS approval_policies (
  id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  outlet_id INTEGER REFERENCES outlets(id),
  role_id INTEGER REFERENCES roles(id),
  policy TEXT NOT NULL DEFAULT 'allowed' CHECK (policy IN ('allowed','denied','approval_required')),
  threshold_value NUMERIC(12,2),
  threshold_type TEXT CHECK (threshold_type IN ('amount','percent')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(action_type, outlet_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_approval_policies_action ON approval_policies(action_type, outlet_id);

CREATE TABLE IF NOT EXISTS approval_events (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER REFERENCES approval_policies(id),
  action_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id INTEGER,
  requested_by INTEGER NOT NULL REFERENCES employees(id),
  approved_by INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reason TEXT,
  metadata JSONB,
  outlet_id INTEGER REFERENCES outlets(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_events_ref ON approval_events(reference_type, reference_id);

-- ── Phase 2A: Return Policies ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_policies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  return_window_days INTEGER,
  receipt_required BOOLEAN DEFAULT TRUE,
  restocking_fee_percent NUMERIC(5,2) DEFAULT 0,
  allowed_refund_methods TEXT[] DEFAULT '{cash,card,store_credit}',
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_reasons (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  requires_note BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Phase 2B: Smart Collections ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS smart_collections (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  disjunctive BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smart_collection_rules (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES smart_collections(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_smart_collection_rules_collection ON smart_collection_rules(collection_id);

-- ── Phase 2B: Outlet Product Visibility ─────────────────────────────
CREATE TABLE IF NOT EXISTS outlet_product_visibility (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(outlet_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_opv_outlet ON outlet_product_visibility(outlet_id);
CREATE INDEX IF NOT EXISTS idx_opv_product ON outlet_product_visibility(product_id);

-- ── Phase 2B: Outlet Tax Profiles ───────────────────────────────────
CREATE TABLE IF NOT EXISTS outlet_tax_profiles (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(outlet_id)
);

CREATE TABLE IF NOT EXISTS outlet_tax_profile_lines (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES outlet_tax_profiles(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  product_id INTEGER REFERENCES products(id),
  tax_id INTEGER NOT NULL REFERENCES taxes(id),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otpl_profile ON outlet_tax_profile_lines(profile_id);

-- ── Phase 2B: Scheduled Catalog Changes ─────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_catalog_changes (
  id SERIAL PRIMARY KEY,
  change_type TEXT NOT NULL CHECK (change_type IN ('price','visibility','status','tax')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product','variant','collection','price_list')),
  entity_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','failed')),
  created_by INTEGER REFERENCES employees(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scc_status_scheduled ON scheduled_catalog_changes(status, scheduled_at) WHERE status = 'pending';

-- ── Phase 2B: Commission Plans ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage','fixed_per_sale','fixed_per_item','tiered')),
  is_active BOOLEAN DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commission_plan_rules (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','category','product','brand')),
  scope_id INTEGER,
  rate NUMERIC(8,4) NOT NULL,
  min_threshold NUMERIC(12,2) DEFAULT 0,
  max_cap NUMERIC(12,2),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cpr_plan ON commission_plan_rules(plan_id);

CREATE TABLE IF NOT EXISTS commission_earnings (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  plan_id INTEGER NOT NULL REFERENCES commission_plans(id),
  rule_id INTEGER REFERENCES commission_plan_rules(id),
  sale_amount NUMERIC(12,2) NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','reversed')),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ce_employee ON commission_earnings(employee_id);
CREATE INDEX IF NOT EXISTS idx_ce_sale ON commission_earnings(sale_id);
CREATE INDEX IF NOT EXISTS idx_ce_status ON commission_earnings(status);

-- Phase 2.1 C2 — earning_type bridges tips into the commission table so
-- payroll has one source of truth. Tip rows have sale_id NULL, plan_id NULL,
-- earning_type='tip'; legacy commission rows keep the default 'commission'.
ALTER TABLE commission_earnings
  ADD COLUMN IF NOT EXISTS earning_type TEXT NOT NULL DEFAULT 'commission';
ALTER TABLE commission_earnings DROP CONSTRAINT IF EXISTS commission_earnings_earning_type_check;
ALTER TABLE commission_earnings
  ADD CONSTRAINT commission_earnings_earning_type_check
  CHECK (earning_type IN ('commission','tip'));
ALTER TABLE commission_earnings ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE commission_earnings ALTER COLUMN plan_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_type_status ON commission_earnings(earning_type, status);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_plan_id INTEGER REFERENCES commission_plans(id);

-- ── Phase 2B: Custom Report Definitions ─────────────────────────────
CREATE TABLE IF NOT EXISTS custom_report_definitions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  dataset TEXT NOT NULL,
  dimensions TEXT[] NOT NULL DEFAULT '{}',
  measures TEXT[] NOT NULL DEFAULT '{}',
  filters_json TEXT DEFAULT '{}',
  sort_by TEXT,
  sort_order TEXT DEFAULT 'desc',
  created_by INTEGER REFERENCES employees(id),
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_report_widgets (
  id SERIAL PRIMARY KEY,
  definition_id INTEGER NOT NULL REFERENCES custom_report_definitions(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL DEFAULT 'table' CHECK (widget_type IN ('table','bar_chart','line_chart','pie_chart','metric_card')),
  title TEXT,
  config_json TEXT DEFAULT '{}',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crw_definition ON custom_report_widgets(definition_id);

-- ── Phase 2B: POS Layouts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_layouts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','outlet','role','employee')),
  scope_id INTEGER,
  layout_json TEXT NOT NULL DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_type, scope_id)
);

-- ── Phase 2B: Product Affinities ────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_affinities (
  id SERIAL PRIMARY KEY,
  source_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  affinity_type TEXT NOT NULL DEFAULT 'frequently_bought_together' CHECK (affinity_type IN ('frequently_bought_together','complementary','upsell','cross_sell')),
  score NUMERIC(5,2) DEFAULT 1.0,
  is_manual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_product_id, target_product_id, affinity_type)
);
CREATE INDEX IF NOT EXISTS idx_pa_source ON product_affinities(source_product_id);

-- ── Phase 3: Marketing Campaigns ───────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  template_id INTEGER REFERENCES marketing_templates(id),
  status TEXT NOT NULL DEFAULT 'draft',
  subject TEXT,
  body_html TEXT,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaign_audiences (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  filter_type TEXT NOT NULL,
  filter_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_campaign_deliveries (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_campaign ON marketing_campaign_deliveries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_customer ON marketing_campaign_deliveries(customer_id);

-- ── Phase 3: Messaging Inbox ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_threads (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  channel_identifier TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER REFERENCES employees(id),
  unread_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_entries (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  content TEXT,
  message_type TEXT DEFAULT 'text',
  external_id TEXT,
  sender_type TEXT DEFAULT 'customer',
  sender_id INTEGER,
  status TEXT DEFAULT 'delivered',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_threads_customer ON message_threads(customer_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_channel ON message_threads(channel, channel_identifier);
CREATE INDEX IF NOT EXISTS idx_message_entries_thread ON message_entries(thread_id);

-- ── Phase 3: Customer Invoicing ────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quotation_id INTEGER REFERENCES quotations(id),
  outlet_id INTEGER REFERENCES outlets(id),
  employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax_total NUMERIC(12,2) DEFAULT 0,
  discount_amount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  balance_due NUMERIC(12,2) DEFAULT 0,
  due_date DATE,
  notes TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8,4) DEFAULT 0,
  line_total NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_type TEXT NOT NULL DEFAULT 'payment',
  reference TEXT,
  notes TEXT,
  recorded_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_invoice_payment_links (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  link_token TEXT NOT NULL UNIQUE,
  gateway_ref TEXT,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_invoice_reminders (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL DEFAULT 'before_due',
  days_offset INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer ON customer_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_status ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_invoice ON customer_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoice_payments_invoice ON customer_invoice_payments(invoice_id);

-- ── Phase 3: Subscriptions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'PKR',
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  billing_interval_count INTEGER DEFAULT 1,
  trial_days INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  auto_charge BOOLEAN DEFAULT false,
  gateway_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_runs (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_id INTEGER REFERENCES customer_invoices(id),
  charge_amount NUMERIC(12,2),
  charge_status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_customer ON customer_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_plan ON customer_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscription_runs_sub ON subscription_runs(subscription_id);

-- ═══════════════════════════════════════════════════════════════
-- Phase 4A — Restaurant Mode
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_floor_plans (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  layout_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_floor_sections (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES restaurant_floor_sections(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  shape TEXT DEFAULT 'square' CHECK (shape IN ('square','round','rectangle')),
  pos_x INTEGER DEFAULT 0,
  pos_y INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_floor ON restaurant_tables(floor_plan_id);

CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
  id SERIAL PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  server_id INTEGER REFERENCES employees(id),
  guest_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'seated' CHECK (status IN ('seated','ordering','served','check_requested','closed')),
  seated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_table ON restaurant_table_sessions(table_id) WHERE status != 'closed';
CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_outlet ON restaurant_table_sessions(outlet_id, status);

CREATE TABLE IF NOT EXISTS restaurant_check_seats (
  id SERIAL PRIMARY KEY,
  table_session_id INTEGER NOT NULL REFERENCES restaurant_table_sessions(id) ON DELETE CASCADE,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_seats_unique ON restaurant_check_seats(table_session_id, seat_number);

CREATE TABLE IF NOT EXISTS restaurant_check_adjustments (
  id SERIAL PRIMARY KEY,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('service_charge','gratuity','rounding','discount')),
  label TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN DEFAULT FALSE,
  percentage_value NUMERIC(6,4),
  -- Phase 2.1 C1 — tip classification + direct-server attribution.
  -- tip_category: cash (handed to server), card (settled on the bill),
  -- pooled (going to the shift pool), direct (server-attributed). See
  -- migrate-pg.js v56.
  tip_category TEXT,
  recipient_employee_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_adjustments_order ON restaurant_check_adjustments(draft_order_id);
ALTER TABLE restaurant_check_adjustments
  ADD COLUMN IF NOT EXISTS tip_category TEXT,
  ADD COLUMN IF NOT EXISTS recipient_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE restaurant_check_adjustments DROP CONSTRAINT IF EXISTS restaurant_check_adjustments_tip_category_check;
ALTER TABLE restaurant_check_adjustments
  ADD CONSTRAINT restaurant_check_adjustments_tip_category_check
  CHECK (tip_category IS NULL OR tip_category IN ('cash','card','pooled','direct'));

-- Phase 2.1 C1 — tip_captures: per-sale tip ledger with server attribution.
-- pool_id is stamped when the shift's tip pool closes (see tip_pools v57).
CREATE TABLE IF NOT EXISTS tip_captures (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  draft_order_id INTEGER,
  outlet_id INTEGER REFERENCES outlets(id),
  server_id INTEGER REFERENCES employees(id),
  tip_amount NUMERIC(12,2) NOT NULL,
  tip_method TEXT NOT NULL CHECK (tip_method IN ('cash','card','split')),
  pool_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tip_captures_pool ON tip_captures(pool_id);
CREATE INDEX IF NOT EXISTS idx_tip_captures_server ON tip_captures(server_id);

-- Phase 2.1 C2 — tip pooling. Distribution rules are per-outlet; one
-- is_default per outlet (partial unique index). Pools open per business_date,
-- close (sums + stamps captures), then distribute (creates payouts +
-- commission_earnings rows with earning_type='tip').
CREATE TABLE IF NOT EXISTS tip_pool_distribution_rules (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER REFERENCES outlets(id),
  name TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('equal_share','hours_weighted','role_weighted','points')),
  config_jsonb JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tpdr_default_per_outlet
  ON tip_pool_distribution_rules(outlet_id)
  WHERE is_default = TRUE AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS tip_pools (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  business_date DATE NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  total_tips NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','distributed','voided')),
  closed_by INTEGER REFERENCES employees(id),
  distribution_rule_id INTEGER REFERENCES tip_pool_distribution_rules(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tip_pools_outlet_date ON tip_pools(outlet_id, business_date);
CREATE INDEX IF NOT EXISTS idx_tip_pools_open ON tip_pools(outlet_id) WHERE status = 'open';

-- Now that tip_pools exists, harden the FK from tip_captures.
ALTER TABLE tip_captures DROP CONSTRAINT IF EXISTS tip_captures_pool_id_fkey;
ALTER TABLE tip_captures
  ADD CONSTRAINT tip_captures_pool_id_fkey
  FOREIGN KEY (pool_id) REFERENCES tip_pools(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tip_pool_payouts (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  hours_worked NUMERIC(8,2) NOT NULL DEFAULT 0,
  weight NUMERIC(12,4) NOT NULL DEFAULT 0,
  payout_amount NUMERIC(12,2) NOT NULL,
  paid_at TIMESTAMPTZ,
  commission_earning_id INTEGER REFERENCES commission_earnings(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_pool ON tip_pool_payouts(pool_id);
CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_employee ON tip_pool_payouts(employee_id);
CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_unpaid ON tip_pool_payouts(employee_id) WHERE paid_at IS NULL;

CREATE TABLE IF NOT EXISTS restaurant_course_fires (
  id SERIAL PRIMARY KEY,
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','fired','completed')),
  fired_at TIMESTAMPTZ,
  fired_by INTEGER REFERENCES employees(id),
  hold_until TIMESTAMPTZ,
  expedite BOOLEAN NOT NULL DEFAULT FALSE,
  sequence INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_course_fires_order ON restaurant_course_fires(draft_order_id);
CREATE INDEX IF NOT EXISTS idx_course_fires_held_until ON restaurant_course_fires(hold_until) WHERE status = 'held' AND hold_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_tabs (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by INTEGER REFERENCES employees(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_tabs_outlet ON restaurant_tabs(outlet_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS restaurant_preauth_holds (
  id SERIAL PRIMARY KEY,
  tab_id INTEGER NOT NULL REFERENCES restaurant_tabs(id) ON DELETE CASCADE,
  gateway_ref TEXT,
  amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','voided','expired')),
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kds_stations (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  station_role TEXT NOT NULL DEFAULT 'prep' CHECK (station_role IN ('prep','expo')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_stations_outlet ON kds_stations(outlet_id);

CREATE TABLE IF NOT EXISTS kds_station_routes (
  id SERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  match_all BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 2.1 B1 — routing precedence columns.
-- Precedence (enforced by resolveStationForItem): product_id > modifier_group_id
-- > category_id > match_all. Exactly one must be set per row (CHECK below).
-- station_role_filter ('prep' | 'expo' | NULL) is orthogonal — it narrows which
-- stations a rule fires against.
ALTER TABLE kds_station_routes
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS modifier_group_id INTEGER REFERENCES modifier_groups(id),
  ADD COLUMN IF NOT EXISTS station_role_filter TEXT,
  ADD COLUMN IF NOT EXISTS outlet_id INTEGER REFERENCES outlets(id);

-- Exactly-one match type. See migrate-pg.js v54.
ALTER TABLE kds_station_routes DROP CONSTRAINT IF EXISTS kds_station_routes_exactly_one_match;
ALTER TABLE kds_station_routes
  ADD CONSTRAINT kds_station_routes_exactly_one_match CHECK (
    (CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN modifier_group_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN category_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN match_all = true THEN 1 ELSE 0 END) = 1
  );

CREATE INDEX IF NOT EXISTS idx_ksr_lookup ON kds_station_routes(outlet_id, priority DESC);

CREATE TABLE IF NOT EXISTS kds_tickets (
  id SERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES kds_stations(id),
  draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id),
  table_label TEXT,
  seat_label TEXT,
  course_name TEXT DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','ready','bumped')),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_status ON kds_tickets(station_id, status);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_order ON kds_tickets(draft_order_id);

CREATE TABLE IF NOT EXISTS kds_ticket_events (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','started','ready','bumped','recalled')),
  actor_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kds_ticket_events_ticket ON kds_ticket_events(ticket_id);

-- Junction: links each ticket to the specific draft_order_items that routed
-- to its station. Phase 4 C3 revised fix — the pre-v29 getTickets JOIN on
-- (draft_order_id, course_name) with no station filter pulled every item in
-- that course onto every station's ticket. Joining through this junction
-- restores one-ticket = one-station's-portion semantics.
CREATE TABLE IF NOT EXISTS kds_ticket_items (
  ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
  draft_order_item_id INTEGER NOT NULL REFERENCES draft_order_items(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, draft_order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_kds_ticket_items_item ON kds_ticket_items(draft_order_item_id);

-- Extend draft_orders for restaurant context
-- Phase 2.1 B2 widens order_context to include 'online' for externally-
-- sourced checks converted from web_orders. The first-pass constraint is
-- kept inline below; migrate-pg.js v55 drops + recreates it to add 'online'.
ALTER TABLE draft_orders
  ADD COLUMN IF NOT EXISTS order_context TEXT DEFAULT 'retail' CHECK (order_context IN ('retail','dine_in','takeout','delivery','bar','online','drive_thru')),
  ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES restaurant_tables(id),
  ADD COLUMN IF NOT EXISTS table_session_id INTEGER REFERENCES restaurant_table_sessions(id),
  ADD COLUMN IF NOT EXISTS tab_id INTEGER REFERENCES restaurant_tabs(id),
  ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dining_option TEXT CHECK (dining_option IN ('dine_in','takeout','delivery')),
  ADD COLUMN IF NOT EXISTS source_token_id TEXT,
  -- Phase 2.1 B2 — channel stamp for online inbox conversions.
  ADD COLUMN IF NOT EXISTS source_channel TEXT DEFAULT 'pos';

-- Partial UNIQUE index for QR public menu lookup (routes/public-restaurant.js).
-- Enforces one-token-to-one-check and speeds up the WHERE source_token_id = $1 query.
-- Partial (WHERE source_token_id IS NOT NULL) so non-restaurant draft orders don't trip it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_orders_source_token
  ON draft_orders(source_token_id)
  WHERE source_token_id IS NOT NULL;

-- Phase 2.1 B2 — online inbox acceptance fields on web_orders (declared here
-- because the FK targets draft_orders, which is created above). A WhatsApp /
-- Daraz / Shopify web_order gets accepted by a staff member, converted into
-- a restaurant draft_order, and forever linked via converted_draft_order_id.
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS converted_draft_order_id INTEGER REFERENCES draft_orders(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS accepted_by INTEGER REFERENCES employees(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS reject_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_web_orders_unconverted
  ON web_orders(source, order_status)
  WHERE converted_draft_order_id IS NULL;

-- Extend draft_order_items for seat/course tracking
ALTER TABLE draft_order_items
  ADD COLUMN IF NOT EXISTS seat_number INTEGER,
  ADD COLUMN IF NOT EXISTS course_name TEXT DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS kitchen_status TEXT DEFAULT 'pending';

-- ═══════════════════════════════════════════════════════════════
-- Phase 4B — Appointment Booking
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  padding_minutes INTEGER DEFAULT 0,
  price NUMERIC(12,2) DEFAULT 0,
  outlet_id INTEGER REFERENCES outlets(id),
  is_active BOOLEAN DEFAULT TRUE,
  requires_confirmation BOOLEAN DEFAULT FALSE,
  max_advance_days INTEGER DEFAULT 90,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_service_variants (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_staff_assignments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service_id, employee_id)
);

CREATE TABLE IF NOT EXISTS booking_resources (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  resource_type TEXT DEFAULT 'room',
  capacity INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_resource_assignments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
  UNIQUE(service_id, resource_id)
);

CREATE TABLE IF NOT EXISTS booking_availability_rules (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  service_id INTEGER REFERENCES booking_services(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_availability_rules_employee ON booking_availability_rules(employee_id, day_of_week);

CREATE TABLE IF NOT EXISTS appointment_blocks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  block_type TEXT NOT NULL DEFAULT 'unavailable' CHECK (block_type IN ('unavailable','break','closure')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_employee ON appointment_blocks(employee_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  variant_id INTEGER REFERENCES booking_service_variants(id),
  customer_id INTEGER REFERENCES customers(id),
  employee_id INTEGER REFERENCES employees(id),
  resource_id INTEGER REFERENCES booking_resources(id),
  outlet_id INTEGER REFERENCES outlets(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  notes TEXT,
  source TEXT DEFAULT 'admin' CHECK (source IN ('admin','public','import','portal')),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointments_employee_time ON appointments(employee_id, start_at, end_at) WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

CREATE TABLE IF NOT EXISTS appointment_segments (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  employee_id INTEGER REFERENCES employees(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL DEFAULT 'before' CHECK (reminder_type IN ('before','followup')),
  minutes_before INTEGER NOT NULL DEFAULT 60,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_reminders_scheduled ON appointment_reminders(scheduled_for) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS appointment_waitlist_entries (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  customer_id INTEGER REFERENCES customers(id),
  employee_id INTEGER REFERENCES employees(id),
  preferred_date DATE,
  preferred_time_start TIME,
  preferred_time_end TIME,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','expired')),
  customer_name TEXT,
  customer_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  employee_id INTEGER REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_session_bookings (
  id SERIAL PRIMARY KEY,
  class_session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  appointment_id INTEGER REFERENCES appointments(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','no_show')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_sync_accounts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  provider TEXT NOT NULL DEFAULT 'google',
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  calendar_id TEXT,
  sync_enabled BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- Phase 4C — Service Workspace
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS service_projects (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','on_hold','completed','cancelled')),
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  budget NUMERIC(12,2),
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_projects_customer ON service_projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_projects_status ON service_projects(status);

CREATE TABLE IF NOT EXISTS project_contacts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'client',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  sort_order INTEGER DEFAULT 0,
  amount NUMERIC(12,2),
  invoice_on_completion BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id);

CREATE TABLE IF NOT EXISTS project_activities (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('note','status_change','milestone_update','file_upload','invoice_created','payment_received')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_activities_project ON project_activities(project_id);

CREATE TABLE IF NOT EXISTS contract_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES service_projects(id),
  customer_id INTEGER REFERENCES customers(id),
  template_id INTEGER REFERENCES contract_templates(id),
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','signed','countersigned','expired','cancelled')),
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);

CREATE TABLE IF NOT EXISTS contract_signers (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'signer',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','declined')),
  signed_at TIMESTAMPTZ,
  signature_data TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_events (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','sent','viewed','signed','countersigned','expired','cancelled')),
  actor TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id);

CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

-- Extend quotations for project billing
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id),
  ADD COLUMN IF NOT EXISTS estimate_status TEXT DEFAULT 'draft' CHECK (estimate_status IN ('draft','sent','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id);

-- Extend customer_invoices for project billing
ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id),
  ADD COLUMN IF NOT EXISTS milestone_id INTEGER REFERENCES project_milestones(id),
  ADD COLUMN IF NOT EXISTS invoice_kind TEXT DEFAULT 'standard' CHECK (invoice_kind IN ('standard','milestone','retainer','final'));

-- Extend customer_subscriptions for project billing
ALTER TABLE customer_subscriptions
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id),
  ADD COLUMN IF NOT EXISTS billing_template_id INTEGER;

-- ══════════════════════════════════════════════════════════════════════
-- Phase 5 — Pakistan Integration Depth (v25)
-- ══════════════════════════════════════════════════════════════════════

-- ── Shipping Automation ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_shipments (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id),
  courier_id INTEGER REFERENCES courier_integrations(id),
  tracking_number TEXT,
  label_url TEXT,
  booking_ref TEXT,
  booking_payload JSONB,
  booking_response JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','booked','in_transit','delivered','cancelled','failed')),
  shipping_cost NUMERIC(12,2),
  booked_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_tracking_refresh_at TIMESTAMPTZ,
  last_tracking_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_shipments_order ON order_shipments(web_order_id);
CREATE INDEX IF NOT EXISTS idx_order_shipments_tracking ON order_shipments(tracking_number);

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
  event_status TEXT,
  event_description TEXT,
  event_location TEXT,
  event_timestamp TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_tracking_events(shipment_id);

-- Extend courier_integrations with capability flags
ALTER TABLE courier_integrations
  ADD COLUMN IF NOT EXISTS supports_booking BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_tracking BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_cancellation BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_labels BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_category TEXT DEFAULT 'domestic',
  ADD COLUMN IF NOT EXISTS flat_shipping_rate NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS encrypted_config_json TEXT,
  ADD COLUMN IF NOT EXISTS last_healthcheck_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_healthcheck_status TEXT;

-- Extend web_orders with shipment reference
ALTER TABLE web_orders
  ADD COLUMN IF NOT EXISTS active_shipment_id INTEGER REFERENCES order_shipments(id),
  ADD COLUMN IF NOT EXISTS shipping_provider_status TEXT;

-- ── COD Reconciliation ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cod_settlement_batches (
  id SERIAL PRIMARY KEY,
  courier_id INTEGER REFERENCES courier_integrations(id),
  batch_ref TEXT,
  import_source TEXT DEFAULT 'csv' CHECK (import_source IN ('csv','manual','api')),
  total_lines INTEGER DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  matched_amount NUMERIC(12,2) DEFAULT 0,
  unmatched_count INTEGER DEFAULT 0,
  short_amount NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','matching','review','approved','rejected')),
  imported_by INTEGER REFERENCES employees(id),
  approved_by INTEGER REFERENCES employees(id),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cod_settlement_lines (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES cod_settlement_batches(id) ON DELETE CASCADE,
  courier_tracking_number TEXT,
  courier_order_ref TEXT,
  remitted_amount NUMERIC(12,2),
  courier_fee NUMERIC(12,2),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','short','over','duplicate')),
  matched_order_id INTEGER REFERENCES web_orders(id),
  matched_loadsheet_order_id INTEGER,
  expected_amount NUMERIC(12,2),
  difference NUMERIC(12,2),
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES employees(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cod_lines_batch ON cod_settlement_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_cod_lines_tracking ON cod_settlement_lines(courier_tracking_number);

-- Extend loadsheets with reconciliation state
ALTER TABLE loadsheets
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by INTEGER REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS expected_cod NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS received_cod NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cod_difference NUMERIC(12,2);

-- ── Payment Expansion ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payment_context TEXT CHECK (payment_context IN ('billing','invoice','storefront')),
  context_ref TEXT,
  raw_payload JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_unique ON payment_webhook_events(provider, event_id);

CREATE TABLE IF NOT EXISTS storefront_payment_sessions (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  amount NUMERIC(12,2),
  currency_code TEXT DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','expired')),
  return_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Extend customer_invoice_payment_links
ALTER TABLE customer_invoice_payment_links
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_completion_payload JSONB;

-- Extend web_order_transactions
ALTER TABLE web_order_transactions
  ADD COLUMN IF NOT EXISTS provider_ref TEXT,
  ADD COLUMN IF NOT EXISTS payment_context TEXT,
  ADD COLUMN IF NOT EXISTS webhook_event_id INTEGER;

-- ── SMS Provider ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sms_provider_messages (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  message_type TEXT DEFAULT 'transactional' CHECK (message_type IN ('transactional','marketing')),
  message_body TEXT,
  provider_ref TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued','sent','delivered','failed')),
  failure_reason TEXT,
  cost NUMERIC(8,4),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_ref ON sms_provider_messages(provider_ref);

-- ── Service Tickets (M2 Workflow Engine) ────────────────────────────

CREATE TABLE IF NOT EXISTS service_tickets (
  id SERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  created_by INTEGER NOT NULL REFERENCES employees(id),
  assigned_to INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'intake'
    CHECK (status IN ('intake','approved','in_progress','on_hold','completed','invoiced','cancelled')),
  title TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  deposit_amount NUMERIC(12,2) DEFAULT 0,
  deposit_paid_at TIMESTAMPTZ,
  deposit_method TEXT,
  final_invoice_id INTEGER REFERENCES customer_invoices(id),
  expected_completion DATE,
  actual_completion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_tickets_customer ON service_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets(status);
CREATE INDEX IF NOT EXISTS idx_service_tickets_assigned ON service_tickets(assigned_to);

CREATE TABLE IF NOT EXISTS service_ticket_activities (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id),
  activity_type TEXT NOT NULL
    CHECK (activity_type IN ('note','status_change','assignment','deposit_recorded','invoice_generated')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket ON service_ticket_activities(ticket_id);

-- ── M7 Rentals (migration v36) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rental_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  outlet_id INTEGER REFERENCES outlets(id),
  total_quantity INTEGER NOT NULL DEFAULT 1,
  daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  hourly_rate NUMERIC(12,2),
  weekly_rate NUMERIC(12,2),
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_policy TEXT NOT NULL DEFAULT 'upfront'
    CHECK (payment_policy IN ('upfront','on_return')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_items_outlet ON rental_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_rental_items_active ON rental_items(is_active);

CREATE TABLE IF NOT EXISTS rental_assets (
  id SERIAL PRIMARY KEY,
  rental_item_id INTEGER NOT NULL REFERENCES rental_items(id) ON DELETE CASCADE,
  serial_number TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','rented','maintenance','retired')),
  condition_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_assets_item ON rental_assets(rental_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_assets_serial
  ON rental_assets(rental_item_id, serial_number)
  WHERE serial_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS rental_contracts (
  id SERIAL PRIMARY KEY,
  contract_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  created_by INTEGER NOT NULL REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','confirmed','checked_out','returned','completed','invoiced','cancelled')),
  rental_start TIMESTAMPTZ NOT NULL,
  rental_end TIMESTAMPTZ,
  expected_return TIMESTAMPTZ NOT NULL,
  actual_checkin TIMESTAMPTZ,
  actual_return TIMESTAMPTZ,
  deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_method TEXT,
  deposit_paid_at TIMESTAMPTZ,
  payment_policy TEXT NOT NULL DEFAULT 'upfront'
    CHECK (payment_policy IN ('upfront','on_return')),
  rental_fee_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_fee_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_id INTEGER REFERENCES customer_invoices(id),
  overdue_email_sent_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_status ON rental_contracts(status);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_customer ON rental_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_outlet ON rental_contracts(outlet_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_overdue
  ON rental_contracts(expected_return)
  WHERE status = 'checked_out';

CREATE TABLE IF NOT EXISTS rental_contract_lines (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  rental_item_id INTEGER NOT NULL REFERENCES rental_items(id),
  rental_asset_id INTEGER REFERENCES rental_assets(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  rate_type TEXT NOT NULL DEFAULT 'daily'
    CHECK (rate_type IN ('hourly','daily','weekly')),
  rate_snapshot NUMERIC(12,2) NOT NULL,
  duration_value NUMERIC(10,2) NOT NULL DEFAULT 1,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_contract_lines_contract ON rental_contract_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_contract_lines_asset
  ON rental_contract_lines(rental_asset_id)
  WHERE rental_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rental_contract_activities (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id),
  activity_type TEXT NOT NULL
    CHECK (activity_type IN ('status_change','note','deposit_recorded','late_fee_applied','invoice_generated','overdue_alert_sent','checkin','return')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_contract_activities_contract ON rental_contract_activities(contract_id);

-- ── M8 Customer Portal (migration v37) ─────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS portal_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_tokens_revoked_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_email_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS customers_portal_email_unique
  ON customers (LOWER(email))
  WHERE portal_enabled_at IS NOT NULL AND email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_portal_otps (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','password_reset','email_verify')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_portal_otps_lookup
  ON customer_portal_otps (LOWER(email), purpose, expires_at);

CREATE TABLE IF NOT EXISTS customer_portal_reset_tokens (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_portal_refresh_tokens (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS customer_portal_refresh_tokens_customer
  ON customer_portal_refresh_tokens (customer_id) WHERE revoked_at IS NULL;

-- ── M9 Room Management (migration v38) ─────────────────────────────

CREATE TABLE IF NOT EXISTS room_types (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER REFERENCES outlets(id),
  name TEXT NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_required NUMERIC(12,2) NOT NULL DEFAULT 0,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_types_outlet ON room_types(outlet_id);
CREATE INDEX IF NOT EXISTS idx_room_types_active ON room_types(is_active);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  room_type_id INTEGER REFERENCES room_types(id),
  outlet_id INTEGER REFERENCES outlets(id),
  room_number TEXT NOT NULL,
  floor TEXT,
  occupancy_status TEXT NOT NULL DEFAULT 'vacant'
    CHECK (occupancy_status IN ('vacant','occupied','reserved')),
  housekeeping_status TEXT NOT NULL DEFAULT 'clean'
    CHECK (housekeeping_status IN ('clean','dirty','inspected','out_of_order')),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (outlet_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_outlet ON rooms(outlet_id);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active);

CREATE TABLE IF NOT EXISTS room_rate_overrides (
  id SERIAL PRIMARY KEY,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_date <= to_date)
);
CREATE INDEX IF NOT EXISTS idx_room_rate_overrides_range
  ON room_rate_overrides(room_type_id, from_date, to_date);

CREATE TABLE IF NOT EXISTS room_bookings (
  id SERIAL PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  created_by INTEGER REFERENCES employees(id),
  room_id INTEGER REFERENCES rooms(id),
  room_type_id INTEGER REFERENCES room_types(id),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','confirmed','checked_in','checked_out','completed','invoiced','cancelled','no_show')),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  actual_checkin TIMESTAMPTZ,
  actual_checkout TIMESTAMPTZ,
  nights INTEGER NOT NULL,
  rate_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_method TEXT,
  deposit_payment_intent_id TEXT,
  deposit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (deposit_status IN ('pending','authorized','captured','released','failed')),
  notes TEXT,
  cancellation_reason TEXT,
  overdue_email_sent_at TIMESTAMPTZ,
  invoice_id INTEGER REFERENCES customer_invoices(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (check_out_date > check_in_date)
);
CREATE INDEX IF NOT EXISTS idx_room_bookings_dates ON room_bookings(room_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_room_bookings_status ON room_bookings(status);
CREATE INDEX IF NOT EXISTS idx_room_bookings_customer ON room_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_room_bookings_outlet ON room_bookings(outlet_id);
CREATE INDEX IF NOT EXISTS idx_room_bookings_overdue
  ON room_bookings(check_out_date)
  WHERE status = 'checked_in';

CREATE TABLE IF NOT EXISTS guest_folios (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES room_bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','settled','voided')),
  room_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  pos_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ,
  invoice_id INTEGER REFERENCES customer_invoices(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guest_folios_booking ON guest_folios(booking_id);
CREATE INDEX IF NOT EXISTS idx_guest_folios_status ON guest_folios(status);

CREATE TABLE IF NOT EXISTS folio_lines (
  id SERIAL PRIMARY KEY,
  folio_id INTEGER NOT NULL REFERENCES guest_folios(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL
    CHECK (line_type IN ('room_night','pos_sale','manual_charge','discount','tax')),
  description TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_id INTEGER REFERENCES sales(id),
  added_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_folio_lines_folio ON folio_lines(folio_id);
CREATE INDEX IF NOT EXISTS idx_folio_lines_sale
  ON folio_lines(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS folio_id INTEGER REFERENCES guest_folios(id);
CREATE INDEX IF NOT EXISTS idx_sales_folio_id
  ON sales(folio_id) WHERE folio_id IS NOT NULL;

-- ── M10 Treatment plans (dental / vet / physio) ─────────────────────
CREATE TABLE IF NOT EXISTS patient_subjects (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL DEFAULT 'self'
    CHECK (subject_type IN ('self','dependent','pet')),
  name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  dob DATE,
  sex TEXT,
  weight_kg NUMERIC(10,2),
  identifier TEXT,
  photo_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patient_subjects_customer
  ON patient_subjects(customer_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS treatment_plans (
  id SERIAL PRIMARY KEY,
  plan_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  subject_id INTEGER REFERENCES patient_subjects(id),
  outlet_id INTEGER REFERENCES outlets(id),
  created_by INTEGER NOT NULL REFERENCES employees(id),
  provider_id INTEGER REFERENCES employees(id),
  title TEXT NOT NULL,
  diagnosis_code TEXT,
  diagnosis_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','on_hold','completed','discontinued','invoiced')),
  start_date DATE,
  expected_end_date DATE,
  actual_end_date DATE,
  total_sessions_planned INTEGER NOT NULL DEFAULT 1,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  estimated_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_method TEXT,
  deposit_paid_at TIMESTAMPTZ,
  deposit_payment_intent_id TEXT,
  deposit_status TEXT
    CHECK (deposit_status IS NULL OR deposit_status IN ('pending','authorized','captured','released','failed')),
  final_invoice_id INTEGER REFERENCES customer_invoices(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_status ON treatment_plans(status);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_customer ON treatment_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_subject ON treatment_plans(subject_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_provider ON treatment_plans(provider_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_overdue
  ON treatment_plans(expected_end_date) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS treatment_sessions (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL,
  appointment_id INTEGER REFERENCES appointments(id),
  provider_id INTEGER REFERENCES employees(id),
  scheduled_at TIMESTAMPTZ,
  actual_start_at TIMESTAMPTZ,
  actual_end_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','completed','no_show','cancelled')),
  chief_complaint TEXT,
  soap_subjective TEXT,
  soap_objective TEXT,
  soap_assessment TEXT,
  soap_plan TEXT,
  next_session_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plan_id, session_number)
);
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_plan ON treatment_sessions(plan_id);
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_appointment
  ON treatment_sessions(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_status_scheduled ON treatment_sessions(status, scheduled_at);

CREATE TABLE IF NOT EXISTS vital_signs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  blood_pressure_sys INTEGER,
  blood_pressure_dia INTEGER,
  heart_rate INTEGER,
  respiratory_rate INTEGER,
  temperature_c NUMERIC(5,2),
  oxygen_saturation NUMERIC(5,2),
  weight_kg NUMERIC(6,2),
  height_cm NUMERIC(6,2),
  pain_score INTEGER CHECK (pain_score IS NULL OR (pain_score >= 0 AND pain_score <= 10)),
  custom_vitals JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vital_signs_session ON vital_signs(session_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES treatment_plans(id),
  medication_name TEXT NOT NULL,
  strength TEXT,
  dosage TEXT,
  frequency TEXT,
  duration TEXT,
  instructions TEXT,
  refills_remaining INTEGER NOT NULL DEFAULT 0,
  prescribed_at TIMESTAMPTZ DEFAULT NOW(),
  prescriber_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_session ON prescriptions(session_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_plan ON prescriptions(plan_id);

CREATE TABLE IF NOT EXISTS chart_areas (
  id SERIAL PRIMARY KEY,
  preset_key TEXT NOT NULL,
  area_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  parent_area_code TEXT,
  svg_path TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (preset_key, area_code)
);
CREATE INDEX IF NOT EXISTS idx_chart_areas_preset ON chart_areas(preset_key);

-- Seed chart_areas: dental_adult (32), dental_primary (20), body (15), vet_body_canine/feline (15 each)
INSERT INTO chart_areas (preset_key, area_code, display_name, parent_area_code, display_order)
SELECT 'dental_adult', n::text, 'Tooth ' || n,
  CASE WHEN n BETWEEN 1 AND 8 THEN 'upper_right'
       WHEN n BETWEEN 9 AND 16 THEN 'upper_left'
       WHEN n BETWEEN 17 AND 24 THEN 'lower_left'
       ELSE 'lower_right' END,
  n
FROM generate_series(1, 32) n
ON CONFLICT (preset_key, area_code) DO NOTHING;

INSERT INTO chart_areas (preset_key, area_code, display_name, parent_area_code, display_order) VALUES
  ('dental_primary','A','Tooth A','upper_right_primary',100),('dental_primary','B','Tooth B','upper_right_primary',101),
  ('dental_primary','C','Tooth C','upper_right_primary',102),('dental_primary','D','Tooth D','upper_right_primary',103),
  ('dental_primary','E','Tooth E','upper_right_primary',104),('dental_primary','F','Tooth F','upper_left_primary',105),
  ('dental_primary','G','Tooth G','upper_left_primary',106),('dental_primary','H','Tooth H','upper_left_primary',107),
  ('dental_primary','I','Tooth I','upper_left_primary',108),('dental_primary','J','Tooth J','upper_left_primary',109),
  ('dental_primary','K','Tooth K','lower_left_primary',110),('dental_primary','L','Tooth L','lower_left_primary',111),
  ('dental_primary','M','Tooth M','lower_left_primary',112),('dental_primary','N','Tooth N','lower_left_primary',113),
  ('dental_primary','O','Tooth O','lower_left_primary',114),('dental_primary','P','Tooth P','lower_right_primary',115),
  ('dental_primary','Q','Tooth Q','lower_right_primary',116),('dental_primary','R','Tooth R','lower_right_primary',117),
  ('dental_primary','S','Tooth S','lower_right_primary',118),('dental_primary','T','Tooth T','lower_right_primary',119)
ON CONFLICT (preset_key, area_code) DO NOTHING;

INSERT INTO chart_areas (preset_key, area_code, display_name, parent_area_code, display_order) VALUES
  ('body','head','Head',NULL,0),('body','neck','Neck',NULL,1),
  ('body','shoulder_left','Left Shoulder',NULL,2),('body','shoulder_right','Right Shoulder',NULL,3),
  ('body','arm_left','Left Arm',NULL,4),('body','arm_right','Right Arm',NULL,5),
  ('body','torso_anterior','Torso (Anterior)',NULL,6),('body','torso_posterior','Torso (Posterior)',NULL,7),
  ('body','hip_left','Left Hip',NULL,8),('body','hip_right','Right Hip',NULL,9),
  ('body','leg_left','Left Leg',NULL,10),('body','leg_right','Right Leg',NULL,11),
  ('body','foot_left','Left Foot',NULL,12),('body','foot_right','Right Foot',NULL,13),
  ('body','spine','Spine',NULL,14)
ON CONFLICT (preset_key, area_code) DO NOTHING;

INSERT INTO chart_areas (preset_key, area_code, display_name, parent_area_code, display_order)
SELECT preset_key, area_code, display_name, NULL, display_order FROM (VALUES
  ('head','Head',0),('ears','Ears',1),('neck','Neck',2),('thorax','Thorax',3),('abdomen','Abdomen',4),
  ('back','Back',5),('tail','Tail',6),('forelimb_left','Left Forelimb',7),('forelimb_right','Right Forelimb',8),
  ('hindlimb_left','Left Hindlimb',9),('hindlimb_right','Right Hindlimb',10),
  ('paw_front_left','Front Left Paw',11),('paw_front_right','Front Right Paw',12),
  ('paw_rear_left','Rear Left Paw',13),('paw_rear_right','Rear Right Paw',14)
) AS regions(area_code, display_name, display_order)
CROSS JOIN (VALUES ('vet_body_canine'),('vet_body_feline')) AS presets(preset_key)
ON CONFLICT (preset_key, area_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS session_chart_entries (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL,
  condition_code TEXT NOT NULL
    CHECK (condition_code IN ('healthy','caries','restoration','extraction','crown','root_canal','missing','implant','mobility','plaque','gingivitis','custom')),
  severity TEXT CHECK (severity IS NULL OR severity IN ('mild','moderate','severe')),
  notes TEXT,
  color_marker TEXT,
  treated_in_session_id INTEGER REFERENCES treatment_sessions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_chart_entries_session ON session_chart_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_session_chart_entries_treated
  ON session_chart_entries(treated_in_session_id) WHERE treated_in_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS clinical_documents (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES treatment_sessions(id),
  document_type TEXT NOT NULL
    CHECK (document_type IN ('lab_report','imaging_xray','imaging_ct','imaging_mri','photo','referral_letter','discharge_summary','other')),
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_mime TEXT,
  file_size_bytes BIGINT,
  uploaded_by INTEGER REFERENCES employees(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_plan ON clinical_documents(plan_id);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_session
  ON clinical_documents(session_id) WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lab_orders (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES treatment_sessions(id),
  order_number TEXT NOT NULL UNIQUE,
  lab_vendor TEXT,
  test_name TEXT NOT NULL,
  test_code TEXT,
  status TEXT NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered','in_transit','received','completed','cancelled')),
  ordered_at TIMESTAMPTZ DEFAULT NOW(),
  result_received_at TIMESTAMPTZ,
  result_summary TEXT,
  result_document_id INTEGER REFERENCES clinical_documents(id),
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordered_by INTEGER REFERENCES employees(id),
  notes TEXT,
  shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_plan ON lab_orders(plan_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status);

CREATE TABLE IF NOT EXISTS consent_forms (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES treatment_sessions(id),
  form_template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  signed_by_name TEXT NOT NULL,
  signed_by_relation TEXT NOT NULL DEFAULT 'self'
    CHECK (signed_by_relation IN ('self','parent','guardian','owner','next_of_kin')),
  signature_image_url TEXT,
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  witnessed_by_id INTEGER REFERENCES employees(id),
  document_pdf_url TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_forms_plan ON consent_forms(plan_id);

CREATE TABLE IF NOT EXISTS treatment_folios (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','settled','voided')),
  session_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  pos_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ,
  invoice_id INTEGER REFERENCES customer_invoices(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treatment_folios_plan ON treatment_folios(plan_id);
CREATE INDEX IF NOT EXISTS idx_treatment_folios_status ON treatment_folios(status);

CREATE TABLE IF NOT EXISTS treatment_folio_lines (
  id SERIAL PRIMARY KEY,
  folio_id INTEGER NOT NULL REFERENCES treatment_folios(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL
    CHECK (line_type IN ('session_fee','pos_sale','lab_cost','manual_charge','discount','tax')),
  description TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  session_id INTEGER REFERENCES treatment_sessions(id),
  sale_id INTEGER REFERENCES sales(id),
  added_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treatment_folio_lines_folio ON treatment_folio_lines(folio_id);
CREATE INDEX IF NOT EXISTS idx_treatment_folio_lines_sale
  ON treatment_folio_lines(sale_id) WHERE sale_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS treatment_plan_activities (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES employees(id),
  activity_type TEXT NOT NULL
    CHECK (activity_type IN ('status_change','note','deposit_recorded','session_completed','consent_signed','lab_ordered','document_uploaded','invoice_generated')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treatment_plan_activities_plan ON treatment_plan_activities(plan_id);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS diagnosis_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_medications JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS primary_provider_id INTEGER REFERENCES employees(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS treatment_plan_id INTEGER REFERENCES treatment_plans(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS treatment_session_id INTEGER REFERENCES treatment_sessions(id);
CREATE INDEX IF NOT EXISTS idx_appointments_treatment_plan
  ON appointments(treatment_plan_id) WHERE treatment_plan_id IS NOT NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS treatment_folio_id INTEGER REFERENCES treatment_folios(id);
CREATE INDEX IF NOT EXISTS idx_sales_treatment_folio_id
  ON sales(treatment_folio_id) WHERE treatment_folio_id IS NOT NULL;

-- ── Phase 2-G Wave 3 — 2-G.5 manager price override (migration v64) ──
-- Lookup table for cashier-facing override reasons. Editable per tenant so
-- reason labels stay out of the enum.
CREATE TABLE IF NOT EXISTS override_reasons (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- sale_items override audit columns — added here (not inline) because
-- override_reasons + approval_events are defined later in the file and the
-- FK references can't be forward-declared in a single-pass schema load.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_override_amount NUMERIC(12,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_override_reason_id INTEGER REFERENCES override_reasons(id);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_override_approved_by INTEGER REFERENCES employees(id);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_override_approved_at TIMESTAMPTZ;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_override_approval_event_id INTEGER REFERENCES approval_events(id);
CREATE INDEX IF NOT EXISTS idx_sale_items_price_override
  ON sale_items(price_override_approved_by, price_override_approved_at)
  WHERE price_override_amount IS NOT NULL;

-- ── Schema versioning ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

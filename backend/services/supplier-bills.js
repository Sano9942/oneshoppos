/**
 * One Toy Store pilot F9: receive a supplier bill without a purchase order
 * (docs/onetoystore-pilot/PHASE-F-PLAN.md F9; every ✅ line there is an owner
 * decision). Step (a) = the data.
 *
 *   product_barcodes        extra barcodes per toy: ONE toy, one stock, any of
 *                           its barcodes scans it (till scan, search, offline
 *                           copy, stock count, bill matching). The toy's own
 *                           products.barcode stays its main one.
 *   supplier_item_codes     the supplier's own code for a toy, per supplier;
 *                           looked up only within the bill's supplier (their
 *                           1083 is not our SKU 1083). One code may point to
 *                           SEVERAL toys (an assorted line; owner 2026-10-02).
 *                           Remembers "split into N" (a pack of 6 sold by the
 *                           piece). Text match, so 07556 and 7556 differ.
 *   supplier_bills          the bill: draft → saved (stock + money) → undone.
 *                           A draft changes nothing; draft_state keeps the
 *                           check screen as it was (step f), cleared on save.
 *   supplier_bill_line_toys which toy(s) a line's pieces went to (assorted)
 *   supplier_bill_lines     the bill's own S.No, page / file, billed vs received
 *                           qty, line discount, split, cost after discounts,
 *                           sale price. A minus quantity = goods sent back.
 *   supplier_bill_files     PDFs / photos kept on the bill; the very same file
 *                           (fingerprint) is refused while its bill is live.
 *   supplier_account_entries "Not received" (−), supplier "Discount" (−) and
 *                           "Correction" (±), amount = the change in what we owe.
 *   supplier_waiting_items  extra pieces kept: received now, billed later.
 *   goods_received_notes    gains its own supplier + bill (no PO needed).
 */

const SUPPLIER_BILLS_DDL = `
CREATE TABLE IF NOT EXISTS product_barcodes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL CHECK (btrim(barcode) <> ''),
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_barcodes_barcode ON product_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);

CREATE TABLE IF NOT EXISTS supplier_item_codes (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (btrim(code) <> ''),
  split_into INTEGER NOT NULL DEFAULT 1 CHECK (split_into >= 1),
  last_cost NUMERIC(12,4),
  confirmed BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_item_codes
  ON supplier_item_codes(supplier_id, LOWER(code), product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_item_codes_product ON supplier_item_codes(product_id);

CREATE TABLE IF NOT EXISTS supplier_bills (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  bill_number TEXT,
  bill_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','saved','undone')),
  layout TEXT,
  lines_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier_total NUMERIC(12,2),
  total_differs BOOLEAN NOT NULL DEFAULT false,
  total_note TEXT,
  account_amount NUMERIC(12,2),
  printed_prev_balance NUMERIC(12,2),
  paid_now_method TEXT CHECK (paid_now_method IN ('till_cash','cheque','bank_transfer')),
  paid_now_amount NUMERIC(12,2) CHECK (paid_now_amount IS NULL OR paid_now_amount > 0),
  paid_now_reference TEXT,
  grn_id INTEGER REFERENCES goods_received_notes(id),
  supplier_invoice_id INTEGER REFERENCES supplier_invoices(id),
  supplier_return_id INTEGER REFERENCES supplier_returns(id),
  supplier_payment_id INTEGER REFERENCES supplier_payments(id),
  till_payout_id INTEGER REFERENCES till_payouts(id),
  note TEXT,
  draft_state JSONB,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_by INTEGER REFERENCES employees(id),
  saved_at TIMESTAMPTZ,
  undone_by INTEGER REFERENCES employees(id),
  undone_at TIMESTAMPTZ,
  undo_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills(supplier_id, bill_number);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_status ON supplier_bills(status);

CREATE TABLE IF NOT EXISTS supplier_bill_files (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  file_name TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key TEXT,
  page_count INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  uploaded_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_bill_files_live_sha
  ON supplier_bill_files(sha256) WHERE active;
CREATE INDEX IF NOT EXISTS idx_supplier_bill_files_bill ON supplier_bill_files(bill_id);

CREATE TABLE IF NOT EXISTS supplier_bill_lines (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  line_no TEXT,
  page INTEGER,
  file_id INTEGER REFERENCES supplier_bill_files(id) ON DELETE SET NULL,
  supplier_code TEXT,
  description TEXT,
  product_id INTEGER REFERENCES products(id),
  billed_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  received_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  split_into INTEGER NOT NULL DEFAULT 1 CHECK (split_into >= 1),
  unit_cost NUMERIC(12,4),
  sale_price NUMERIC(12,2),
  is_new_product BOOLEAN NOT NULL DEFAULT false,
  crossed_out BOOLEAN NOT NULL DEFAULT false,
  waiting_item_id INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_bill ON supplier_bill_lines(bill_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_product ON supplier_bill_lines(product_id);

-- Which toy(s) a line's pieces went to: several for an assorted line.
-- qty in pieces (minus = sent back); extra_qty = pieces kept beyond the bill.
CREATE TABLE IF NOT EXISTS supplier_bill_line_toys (
  id SERIAL PRIMARY KEY,
  line_id INTEGER NOT NULL REFERENCES supplier_bill_lines(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty NUMERIC(12,3) NOT NULL,
  extra_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  previous_cost NUMERIC(12,4)
);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_toys_line ON supplier_bill_line_toys(line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_toys_product ON supplier_bill_line_toys(product_id);

CREATE TABLE IF NOT EXISTS supplier_account_entries (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  kind TEXT NOT NULL CHECK (kind IN ('not_received','discount','correction')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0 AND (kind = 'correction' OR amount < 0)),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_bill_id INTEGER REFERENCES supplier_bills(id),
  note TEXT,
  employee_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided BOOLEAN NOT NULL DEFAULT false,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_account_entries_supplier ON supplier_account_entries(supplier_id);

ALTER TABLE goods_received_notes
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_bill_id INTEGER REFERENCES supplier_bills(id);

CREATE TABLE IF NOT EXISTS supplier_waiting_items (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  received_bill_id INTEGER REFERENCES supplier_bills(id),
  grn_id INTEGER REFERENCES goods_received_notes(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','billed','free')),
  matched_bill_id INTEGER REFERENCES supplier_bills(id),
  matched_line_id INTEGER REFERENCES supplier_bill_lines(id) ON DELETE SET NULL,
  matched_by INTEGER REFERENCES employees(id),
  matched_at TIMESTAMPTZ,
  note TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_waiting_items_open ON supplier_waiting_items(supplier_id) WHERE status = 'waiting';
`;

// Headings the ledger and the payables report show for each entry kind.
const ACCOUNT_ENTRY_LABELS = {
  not_received: "Not received",
  discount: "Discount",
  correction: "Correction",
};

module.exports = { SUPPLIER_BILLS_DDL, ACCOUNT_ENTRY_LABELS };

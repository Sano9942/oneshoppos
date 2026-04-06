# Phase 0 — Foundation Prompt (copy-paste this entire file into a new Claude Code session)

---

## CONTEXT — READ THIS FIRST

You are working on the SanoPOS project. We are building 25 competitive features across 6 waves. This is **Phase 0 — the foundation commit** that creates all database schema, empty route skeletons, and frontend route stubs so that future feature sessions never touch shared infrastructure files.

**Branch**: `competitive-waves` (already created, already checked out)
**Current migration version**: 15 (pg-boss worker migration)
**New migration**: v16 — all 25 features' tables + column additions
**You are NOT building any feature logic** — just the infrastructure skeleton.

Read the full execution plan at `docs/plans/2026-04-06-competitive-waves-execution-plan.md` for context on what we're building, but DO NOT execute any feature prompts from that file. Only do Phase 0.

---

## YOUR TASK — Phase 0 Foundation

Complete these 5 tasks in order. Commit at the end.

### Task 1: Migration v16 in migrate-pg.js

Read `backend/migrate-pg.js` to understand the migration pattern (specifically look at how existing migrations v12-v15 are structured — they use `{ version, description, up: async (client) => { ... } }`).

Add migration v16 with description: `"competitive features — 13 new tables, customer/product column additions, seed data"`.

The `up` function should run ALL of the following DDL:

```sql
-- ── Customer Enhancements ────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group_id INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier_id INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spend NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list_id INTEGER;

-- ── Product Enhancements ─────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

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

-- Seed default loyalty tiers
INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, color, sort_order)
VALUES
  ('Bronze', 0, 1.0, 0, '#CD7F32', 1),
  ('Silver', 25000, 1.5, 2, '#C0C0C0', 2),
  ('Gold', 75000, 2.0, 5, '#FFD700', 3),
  ('Platinum', 200000, 3.0, 8, '#E5E4E2', 4)
ON CONFLICT DO NOTHING;

-- ── Product Bundles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_bundles (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES products(id),
  component_variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, component_product_id, component_variant_id)
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

-- ── Billing cycle additions (public schema — run via db.pool) ────────
-- NOTE: This INSERT must run against the PUBLIC schema, not tenant schemas.
-- The migration runner runs against tenant schemas. So this INSERT should be
-- wrapped in a try/catch or run separately. Add it but if it fails on tenant
-- schemas (because plan_pricing doesn't exist there), that's expected.
INSERT INTO plan_pricing (plan, cycle, price, currency_code, is_active)
VALUES
  ('pro', 'quarterly', 21600, 'PKR', true),
  ('pro', 'semi_annual', 40800, 'PKR', true)
ON CONFLICT DO NOTHING;
```

**IMPORTANT migration notes**:
- The `stock_count_items` table does NOT use `GENERATED ALWAYS AS ... STORED` for variance — Postgres requires the expression to reference only the same row's columns and some tenant schema setups can be finicky with generated columns. Instead, compute variance in queries: `(counted_qty - system_qty) AS variance`.
- The `plan_pricing` INSERT is for the public schema only. Wrap it in a try/catch — it will fail harmlessly on tenant schemas where that table doesn't exist.
- The `loyalty_tiers` and `chart_of_accounts` seed data uses `ON CONFLICT DO NOTHING` — safe to re-run.
- Foreign key for `customers.customer_group_id` → `customer_groups(id)`: add the FK only AFTER creating the `customer_groups` table. Same for `customers.loyalty_tier_id` → `loyalty_tiers(id)` and `customers.price_list_id` → `price_lists(id)`. Use separate ALTER TABLE statements after the CREATE TABLE statements.

After creating all tables and adding all columns, add the foreign keys:
```sql
-- Add FKs that reference newly created tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_group_id_fkey') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_customer_group_id_fkey FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_loyalty_tier_id_fkey') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_loyalty_tier_id_fkey FOREIGN KEY (loyalty_tier_id) REFERENCES loyalty_tiers(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_price_list_id_fkey') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES price_lists(id);
  END IF;
END $$;
```

### Task 2: Update schema-pg.sql

Add ALL the new tables and column additions to `backend/schema-pg.sql` (the DDL source of truth). Place them in logical sections:

- Customer columns → under the existing `customers` CREATE TABLE (add ALTER TABLE statements after it, or add the columns directly to the CREATE TABLE)
- Product columns → under the existing `products` CREATE TABLE
- New tables → add new sections in this order:
  1. `customer_groups` (before customers, since customers references it)
  2. `loyalty_tiers` (before customers)
  3. `price_lists` + `price_list_items` (after products section)
  4. `product_bundles` (after products section)
  5. `product_reviews` (after products section)
  6. `credit_notes` + `debit_notes` (in Accounting section)
  7. `postdated_cheques` (in Accounting section)
  8. `chart_of_accounts` + seed data (in Accounting section)
  9. `journal_entries` + `journal_entry_lines` (in Accounting section)
  10. `stock_counts` + `stock_count_items` (new Inventory Audit section)
  11. `picklists` + `picklist_items` (new Fulfillment section)
  12. `loadsheets` + `loadsheet_orders` (new Fulfillment section)

**IMPORTANT**: For `schema-pg.sql`, add the new columns directly inside the existing CREATE TABLE statements (not as ALTER TABLE), since this file represents the ideal schema from scratch. Only `migrate-pg.js` uses ALTER TABLE (for existing databases).

### Task 3: Create backend route skeleton files

Create these NEW files with minimal skeleton code (no actual route logic — just the module export pattern):

**File 1: `backend/routes/fulfillment.js`**
```js
/**
 * backend/routes/fulfillment.js — Fulfillment operations (pick/pack/dispatch, loadsheets, scan-dispatch).
 * 
 * Routes will be added by Wave 5 feature sessions.
 */
module.exports = function registerFulfillmentRoutes(app, deps) {
  // Wave 5 features will add routes here:
  // - POST /api/fulfillment/picklists (Feature #21)
  // - GET /api/fulfillment/picklists (Feature #21)
  // - POST /api/fulfillment/picklists/:id/pick-scan (Feature #21)
  // - POST /api/fulfillment/loadsheets (Feature #22)
  // - POST /api/fulfillment/scan-dispatch (Feature #23)
};
```

**File 2: `backend/routes/reports/stock-aging.js`**
```js
/**
 * Stock aging report — shows how long inventory has been sitting.
 * Feature #14, Wave 3.
 */
module.exports = function registerStockAgingReport(app, deps, helpers) {
  // Wave 3 feature session will add GET /api/reports/stock-aging here
};
```

**File 3: `backend/routes/reports/multichannel.js`**
```js
/**
 * Multi-channel aggregated reports — combined POS + Shopify + WooCommerce.
 * Feature #24, Wave 6.
 */
module.exports = function registerMultichannelReports(app, deps, helpers) {
  // Wave 6 feature session will add routes here:
  // - GET /api/reports/multichannel-summary
  // - GET /api/reports/multichannel-daily
  // - GET /api/reports/multichannel-products
};
```

### Task 4: Mount new routes in registerAllRoutes.js and reports/index.js

**In `backend/routes/registerAllRoutes.js`**, add this line AFTER the couriers line (around line 504) and BEFORE the import line:

```js
  // --- FULFILLMENT (PICK/PACK/DISPATCH) ---
  require("./fulfillment")(app, deps);
```

**In `backend/routes/reports/index.js`**, add these two lines AFTER the existing report module registrations (after the `governance` line, before any return statement):

```js
  // Stock aging report (Wave 3)
  require("./stock-aging")(app, deps, helpers);

  // Multi-channel reports (Wave 6)
  require("./multichannel")(app, deps, helpers);
```

### Task 5: Pre-register all frontend routes

**In `frontend/src/routes/appRoutes.jsx`**:

1. Add these lazy imports at the top (after the existing imports, before the `wrap` function):

```jsx
const ChartOfAccountsRedesign = lazy(() => import("../pages/redesign/ChartOfAccountsRedesign"));
const JournalEntriesRedesign = lazy(() => import("../pages/redesign/JournalEntriesRedesign"));
const CreditDebitNotesRedesign = lazy(() => import("../pages/redesign/CreditDebitNotesRedesign"));
const PostdatedChequesRedesign = lazy(() => import("../pages/redesign/PostdatedChequesRedesign"));
const StockCountRedesign = lazy(() => import("../pages/redesign/StockCountRedesign"));
const PriceListsRedesign = lazy(() => import("../pages/redesign/PriceListsRedesign"));
const CustomerGroupsRedesign = lazy(() => import("../pages/redesign/CustomerGroupsRedesign"));
const ReviewModerationRedesign = lazy(() => import("../pages/redesign/ReviewModerationRedesign"));
const FulfillmentRedesign = lazy(() => import("../pages/redesign/FulfillmentRedesign"));
```

2. Add these routes inside the `<Route element={<RequireAuth><RequireContext><AppLayoutRedesign /></RequireContext></RequireAuth>}>` block (BEFORE the closing `</Route>,` on the last line):

```jsx
    {/* Wave 2 — Accounting */}
    <Route path="/chart-of-accounts" element={perm("all_access", <ChartOfAccountsRedesign />)} />
    <Route path="/journal-entries" element={perm("all_access", <JournalEntriesRedesign />)} />
    <Route path="/credit-debit-notes" element={perm("view_reports", <CreditDebitNotesRedesign />)} />
    <Route path="/postdated-cheques" element={perm("view_reports", <PostdatedChequesRedesign />)} />
    {/* Wave 3 — Inventory & Commerce */}
    <Route path="/stock-counts" element={perm("manage_inventory", <StockCountRedesign />)} />
    <Route path="/price-lists" element={perm("manage_inventory", <PriceListsRedesign />)} />
    {/* Wave 4 — Customer & Loyalty */}
    <Route path="/customer-groups" element={perm("manage_customers", <CustomerGroupsRedesign />)} />
    <Route path="/review-moderation" element={perm("manage_inventory", <ReviewModerationRedesign />)} />
    {/* Wave 5 — Fulfillment */}
    <Route path="/fulfillment" element={perm("manage_orders", <FulfillmentRedesign />)} />
```

3. Create placeholder page files for ALL new pages. For each one, create a file in `frontend/src/pages/redesign/` with this pattern:

```jsx
export default function XxxRedesign() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Feature Name</h1>
      <p className="text-gray-500">Coming soon — this page will be built in Wave N.</p>
    </div>
  );
}
```

Create these files:
- `ChartOfAccountsRedesign.jsx` — "Chart of Accounts" / Wave 2
- `JournalEntriesRedesign.jsx` — "Journal Entries" / Wave 2
- `CreditDebitNotesRedesign.jsx` — "Credit & Debit Notes" / Wave 2
- `PostdatedChequesRedesign.jsx` — "Post-Dated Cheques" / Wave 2
- `StockCountRedesign.jsx` — "Inventory Audit" / Wave 3
- `PriceListsRedesign.jsx` — "Price Lists" / Wave 3
- `CustomerGroupsRedesign.jsx` — "Customer Groups" / Wave 4
- `ReviewModerationRedesign.jsx` — "Review Moderation" / Wave 4
- `FulfillmentRedesign.jsx` — "Fulfillment Operations" / Wave 5

**NOTE**: Some features (#1 Blacklisting, #2 Order Aging, #3 Bulk Status, #5 Customer Ledger, #6 Supplier Ledger, #7 Points Transfer, #13 Bundling, #14 Stock Aging report tab, #16 Scan Receive, #17 Price Lists, #18 Tiered Loyalty, #19 Customer Profiling, #20 Reviews, #24 Multichannel Reports) add to EXISTING pages — they don't need new route stubs.

Feature #25 (Swagger/API Docs) is mounted in index.js and accessed at /api-docs — no frontend route needed.

---

## COMMIT

After completing all 5 tasks, make a single commit:

```
git add backend/migrate-pg.js backend/schema-pg.sql backend/routes/fulfillment.js backend/routes/reports/stock-aging.js backend/routes/reports/multichannel.js backend/routes/registerAllRoutes.js backend/routes/reports/index.js frontend/src/routes/appRoutes.jsx frontend/src/pages/redesign/ChartOfAccountsRedesign.jsx frontend/src/pages/redesign/JournalEntriesRedesign.jsx frontend/src/pages/redesign/CreditDebitNotesRedesign.jsx frontend/src/pages/redesign/PostdatedChequesRedesign.jsx frontend/src/pages/redesign/StockCountRedesign.jsx frontend/src/pages/redesign/PriceListsRedesign.jsx frontend/src/pages/redesign/CustomerGroupsRedesign.jsx frontend/src/pages/redesign/ReviewModerationRedesign.jsx frontend/src/pages/redesign/FulfillmentRedesign.jsx
```

Commit message:
```
feat: Phase 0 foundation — migration v16, route skeletons, frontend stubs

All 25 competitive features' database schema in one migration (v16):
- 13 new tables + customer/product column additions + seed data
- Empty route skeletons for fulfillment, stock-aging, multichannel reports
- Frontend route stubs for 9 new pages (placeholder components)
- Route mounts in registerAllRoutes.js and reports/index.js

This commit creates the infrastructure so feature sessions only write
route logic and frontend components — no shared file conflicts.
```

---

## VERIFICATION

After committing, verify:
1. `node -e "require('./backend/migrate-pg.js')"` — should not throw (syntax check)
2. `cd frontend && npx vite build 2>&1 | head -20` — should not fail on import resolution (new placeholder pages exist)
3. `git diff --stat HEAD~1` — should show the files listed above, nothing else

---

## DO NOT

- Do NOT build any feature logic — this is ONLY infrastructure
- Do NOT read the feature prompts in the execution plan and implement them
- Do NOT modify any existing route files EXCEPT registerAllRoutes.js (one new require line) and reports/index.js (two new require lines)
- Do NOT touch index.js
- Do NOT add tests
- Do NOT push to remote — just commit locally

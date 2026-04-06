# Competitive Gap Closure — 6-Wave Execution Plan

**Date**: 2026-04-06
**Approach**: Option C (Hybrid) — pre-written prompts, 2-3 parallel sessions per round
**Branch**: `competitive-waves` (all work here, main is the safe checkpoint)
**Total**: 25 features across 6 waves, ~12 execution rounds
**Migration**: All new tables in migration v15 (written in Phase 0 before any features)

---

## Strategy: Single Branch + Phase 0 Foundation

### Safety Model
```
main (SAFE CHECKPOINT — never touch until final merge)
└── competitive-waves (ALL work happens here)
    ├── Phase 0: migration v15 + schema + route skeletons + frontend route stubs
    ├── Wave 1: features #1-#7 (sequential rounds, no parallel file conflicts)
    ├── Wave 2: features #8-#12
    ├── Wave 3: features #13-#17
    ├── Wave 4: features #18-#20
    ├── Wave 5: features #21-#23
    └── Wave 6: features #24-#25
```

If anything goes catastrophically wrong: `git checkout main` — you're back to a working app.

### Phase 0 — Foundation (eliminates merge conflicts)
Before any feature work, we commit:
1. **Migration v15** — all 13 new tables + all column additions for all 25 features
2. **schema-pg.sql** — updated DDL source of truth
3. **Empty route skeletons** — `routes/fulfillment.js`, new report files, mounted in registerAllRoutes.js
4. **Frontend route stubs** — all new pages registered in appRoutes.jsx as lazy placeholders

This means feature sessions ONLY write:
- Backend route logic (inside pre-created or existing files)
- Frontend page components (replacing placeholders)
- Nobody touches migration, schema, or routing infrastructure again

### Session Setup (for each round)
1. Open 2-3 Claude Code sessions on the `competitive-waves` branch
2. Copy-paste the prompt for each feature into its session
3. Each session commits directly to `competitive-waves`
4. Sessions in the same round touch DIFFERENT files (zero conflicts guaranteed)
5. When a round completes, pull latest, move to next round

### Revised Round Sequencing (zero shared-file overlap)
Features that touch the same backend file NEVER run in the same round:

| Shared File | Features That Touch It | Sequencing |
|---|---|---|
| `routes/customers.js` | #1, #5, #7, #18, #19 | Split across rounds 1A, 1C, 1D, 4A, 4B |
| `routes/orders.js` | #2, #3 | Split across rounds 1A, 1B |
| `routes/products.js` | #13, #17, #20 | Split across rounds 3A, 3B, 4C |
| `routes/sales.js` | #13, #17, #18 | #13 first, then #17, then #18 |
| `routes/tier4/accounting.js` | #8, #9, #10, #11 | #8+#9 parallel, #10 parallel, #11 after #10 |
| `routes/fulfillment.js` | #21, #22, #23 | #21 first, then #22+#23 parallel |

---

## Wave 1 — Quick Wins (7 features, 2 rounds)

### Round 1A — 3 parallel sessions

---

#### Feature 1: Customer Blacklisting
**Branch**: `wave1/customer-blacklisting`
**Files touched**: `schema-pg.sql`, `migrate-pg.js` (v15), `routes/customers.js`, `frontend/src/pages/redesign/CustomersRedesign.jsx`, POS checkout validation
**Estimated time**: ~45 min

**Prompt** (copy-paste into a Claude session):
```
I need you to add customer blacklisting to our POS system. This is a competitive gap — Assaan Retail has it and we don't.

## What to build

1. **Schema** (migration v15 in migrate-pg.js):
   - Add columns to `customers` table: `is_blacklisted BOOLEAN DEFAULT false`, `blacklist_reason TEXT`, `blacklisted_at TIMESTAMPTZ`
   - Also add these to `schema-pg.sql` for the DDL source of truth

2. **Backend** (in routes/customers.js):
   - `PUT /api/customers/:id/blacklist` — sets is_blacklisted=true, blacklist_reason, blacklisted_at=NOW(). Requires `manage_customers` permission.
   - `PUT /api/customers/:id/unblacklist` — sets is_blacklisted=false, clears reason/date. Same permission.
   - Modify the GET /api/customers list to include the blacklist columns
   - Add a blacklist check in the sales flow: read `routes/sales.js` and find where customer_id is validated on POST /api/sales. If customer is blacklisted, return 400 with error "Customer is blacklisted: {reason}"

3. **Frontend** (in CustomersRedesign.jsx):
   - Read the file first to understand the pattern
   - Add a "Blacklist" / "Unblacklist" toggle button in the customer detail/edit area
   - Show a red badge or indicator on blacklisted customers in the list
   - Show blacklist reason when hovering or in detail view

## Patterns to follow
- Read ONE existing PUT endpoint in customers.js as reference for the route pattern
- Use `requireAnyPerm(["manage_customers", "all_access"])` for auth
- Use Tailwind CSS classes for the frontend (red-500 for blacklist indicators)
- The project uses `db.query(sql, [params])` with $1,$2 placeholders (Postgres)

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add any new route files — extend existing customers.js
- Add tests (we'll batch test writing later)
```

---

#### Feature 2: Order Aging Summary
**Branch**: `wave1/order-aging`
**Files touched**: `routes/orders.js`, `frontend/src/pages/redesign/OrdersRedesign.jsx` (or wherever orders list lives)
**Estimated time**: ~45 min

**Prompt**:
```
I need you to add an order aging summary to our order management. Assaan Retail has this and we don't — it flags stale orders.

## What to build

1. **Backend** (in routes/orders.js):
   - `GET /api/orders/aging-summary` — returns order counts grouped by age buckets:
     - 0-2 days (fresh)
     - 3-5 days (aging)
     - 6-10 days (stale)
     - 10+ days (critical)
   - Only count orders where `order_status != 'closed'` and `order_status != 'cancelled'`
   - Use `EXTRACT(DAY FROM NOW() - ordered_at)` for age calculation
   - Also return the list of critical (10+ day) orders with id, external_order_number, customer name, ordered_at, age_days
   - Requires `manage_orders` or `view_reports` permission

2. **Add an `aging_days` computed field** to the existing GET /api/orders endpoint:
   - Add `EXTRACT(DAY FROM NOW() - ordered_at)::integer AS aging_days` to the SELECT
   - Add optional query param `?aging=stale` to filter orders older than 3 days
   - Add optional query param `?aging=critical` to filter orders older than 10 days

3. **Frontend**:
   - Find the orders list page (grep for "OrdersRedesign" or "web_orders" in frontend/src/)
   - Add aging badge next to each order: green (<3 days), yellow (3-5), orange (6-10), red (10+)
   - Add a summary bar at the top showing the 4 bucket counts from the aging-summary endpoint
   - Make the bucket counts clickable to filter the list

## Patterns
- Read routes/orders.js first to understand existing query patterns
- Use `requireAnyPerm(["manage_orders", "view_reports"])` for auth
- The web_orders table has `ordered_at TIMESTAMPTZ` column
- Tailwind colors: green-500, yellow-500, orange-500, red-500

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files
- Add tests
```

---

#### Feature 3: Bulk Order Status Updates
**Branch**: `wave1/bulk-order-status`
**Files touched**: `routes/orders.js`, frontend orders page
**Estimated time**: ~45 min

**Prompt**:
```
I need you to add bulk order status updates. Assaan Retail has this — it lets you update multiple orders at once.

## What to build

1. **Backend** (in routes/orders.js):
   - `PATCH /api/orders/bulk-status` — body: `{ order_ids: [1,2,3], order_status: "processing" }` or `{ order_ids: [1,2,3], fulfillment_status: "fulfilled" }`
   - Validate: order_ids must be non-empty array of integers, max 100 items
   - Validate: status must be one of the allowed values (check existing order status values in the code)
   - Use a single UPDATE query: `UPDATE web_orders SET order_status = $1, updated_at = NOW() WHERE id = ANY($2::int[])`
   - Return `{ updated: rowCount }`
   - Requires `manage_orders` permission
   - Add Zod validation schema for the request body

2. **Frontend** (on the orders list page):
   - Add checkboxes on each order row
   - Add a "Select All" checkbox in the header
   - When orders are selected, show a floating action bar at the bottom with:
     - "X orders selected"
     - Status dropdown (Open, Processing, Closed, Cancelled)
     - "Update Status" button
   - After successful update, refresh the order list and clear selection
   - Show toast notification with count updated

## Patterns
- Read routes/orders.js first for existing patterns
- Use `requirePerm("manage_orders")` for auth
- For Zod schema, create it inline or add to an existing schema file in backend/schemas/
- For frontend, use the existing toast system: `useToast()` from `contexts/ToastContext.jsx`
- Use Tailwind for the floating action bar (fixed bottom, bg-white shadow-lg, px-6 py-3)

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files
- Add tests
```

---

### Round 1B — 4 parallel sessions (after Round 1A merged)

---

#### Feature 4: Quarterly/Yearly Billing Discounts
**Branch**: `wave1/billing-discounts`
**Files touched**: `routes/billing.js`, `master-db-pg.js` or master schema, `frontend/src/pages/redesign/` (billing/pricing UI)
**Estimated time**: ~1 hour

**Prompt**:
```
I need to add quarterly and yearly billing discounts. Assaan Retail offers 10/15/20% off for quarterly/semi-annual/yearly billing cycles.

## Context
- Current billing: routes/billing.js (~193 lines)
- Pricing stored in master DB `plan_pricing` table: (plan, cycle, price, currency_code, is_active)
- Currently only "monthly" and "annual" cycles exist for Pro plan
- The billing status endpoint is GET /api/billing/status
- The pricing endpoint is GET /api/billing/pricing
- The checkout endpoint is POST /api/billing/create-checkout

## What to build

1. **Add new billing cycles to plan_pricing** (in migration v15, run against master/public schema):
   - Insert rows for Pro plan: quarterly (PKR 21,600 = 8000*3*0.9), semi_annual (PKR 40,800 = 8000*6*0.85), annual is already 80,000 (keep as is, it's already ~17% off)
   - So the discount tiers are: monthly=0%, quarterly=10%, semi_annual=15%, annual=17%

2. **Backend** (in routes/billing.js):
   - Modify GET /api/billing/pricing to include a `discount_percent` and `savings` computed field:
     - monthly_equivalent = price / months_in_cycle
     - discount_percent = ROUND((1 - monthly_equivalent / monthly_price) * 100)
     - savings = (monthly_price * months_in_cycle) - price
   - Modify POST /api/billing/create-checkout to accept the new cycles ("quarterly", "semi_annual")

3. **Frontend**:
   - Find the pricing/billing UI (grep for "billing" or "pricing" or "upgrade" in frontend/src/pages/)
   - Show cycle options as tabs or radio buttons: Monthly | Quarterly (10% off) | Semi-Annual (15% off) | Annual (17% off)
   - Show the savings amount: "Save PKR X,XXX"
   - Highlight the recommended cycle (quarterly or annual)

## Patterns
- Billing routes use `masterDb` for tenant/pricing queries and `db` for tenant-scoped data
- plan_pricing is in the PUBLIC schema (not tenant schemas)
- Use `db.pool.query()` for public schema queries in billing.js

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files
- Add tests
```

---

#### Feature 5: Full Customer Ledger
**Branch**: `wave1/customer-ledger`
**Files touched**: `routes/customers.js`, frontend customers page
**Estimated time**: ~1 hour

**Prompt**:
```
I need to add a full customer transaction ledger. Currently we only show balance — both competitors show transaction-level history.

## What to build

1. **Backend** (in routes/customers.js):
   - `GET /api/customers/:id/ledger` — returns ALL financial transactions for a customer in chronological order:
     - Sales (from `sales` table where customer_id matches) — type: "sale", amount: total_amount, ref: invoice_number
     - Returns (from `returns` table where customer_id matches) — type: "return", amount: -total_refund
     - Wallet credits/debits (from `customer_wallet_ledger`) — type: "wallet_credit"/"wallet_debit"
     - Loyalty points earned/redeemed (from `sales` where points_earned > 0 or points_redeemed > 0) — type: "points_earned"/"points_redeemed"
   - Use UNION ALL to combine all sources, ORDER BY date DESC
   - Include running_balance computed via window function: `SUM(amount) OVER (ORDER BY date ASC) AS running_balance`
   - Support date filters: `?from=YYYY-MM-DD&to=YYYY-MM-DD`
   - Paginate: `?page=1&per_page=50`
   - Requires `view_reports` or `manage_customers` permission

2. **Frontend** (on customer detail page):
   - Add a "Ledger" tab alongside existing customer info
   - Show a table: Date | Type | Reference | Debit | Credit | Balance
   - Color-code: sales = green (credit to business), returns = red, wallet = blue
   - Add date range filter at the top
   - Show running balance in the rightmost column

## Patterns
- Read routes/customers.js first
- Sales table timestamp column is named `timestamp` (NOT created_at)
- Returns table has `created_at`
- customer_wallet_ledger has `created_at`
- Use `toUtcStart`/`toUtcEnd` from utils/tz.js for date filtering with `req.company?.timezone`
- Use `requireAnyPerm(["view_reports", "manage_customers"])` for auth

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files
- Add tests
```

---

#### Feature 6: Full Supplier Ledger
**Branch**: `wave1/supplier-ledger`
**Files touched**: `routes/grn.js` or `routes/purchase-orders.js`, frontend supplier page
**Estimated time**: ~1 hour

**Prompt**:
```
I need to add a full supplier transaction ledger. Currently we show payments only — competitors show the full transaction-level history.

## What to build

1. **Backend** — add to an appropriate existing route file (check routes/purchase-orders.js or routes/grn.js for where supplier endpoints live):
   - `GET /api/suppliers/:id/ledger` — returns ALL financial transactions for a supplier:
     - Purchase orders received/invoiced (from `purchase_orders` where supplier_id matches, status in ['approved','received']) — type: "purchase", amount: total_cost (debit — we owe them)
     - GRN receipts (from `goods_received_notes` joined to POs) — type: "grn_receipt"
     - Supplier payments (from `supplier_payments` if it exists, or from `supplier_invoices`/`supplier_payables` — grep for these tables first) — type: "payment" (credit — we paid them)
   - UNION ALL, ORDER BY date DESC
   - Running balance via window function
   - Support date filters and pagination same as customer ledger
   - Requires `manage_orders` or `view_reports` permission

2. **Frontend**:
   - Find the supplier detail page (grep for "SupplierDetail" or "supplier" in frontend/src/pages/)
   - Add a "Ledger" tab
   - Table: Date | Type | Reference (PO#/GRN#/Payment#) | Debit | Credit | Balance
   - Date range filter

## Important — discover the data model first
- Before writing code, grep for `supplier_payment`, `supplier_invoice`, `supplier_payable` in schema-pg.sql to find what tables exist
- Also grep for these in the routes/ directory to find existing payment endpoints
- The supplier table might be called `suppliers` — verify in schema-pg.sql

## Patterns
- Same as customer ledger: UNION ALL, window function for running balance
- Use toUtcStart/toUtcEnd for date filtering
- Postgres: use $1,$2 params, NUMERIC returns strings (wrap with Number())

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 7: Loyalty Points Transfer
**Branch**: `wave1/points-transfer`
**Files touched**: `routes/customers.js` (or wherever loyalty logic lives), frontend
**Estimated time**: ~30 min

**Prompt**:
```
I need to add loyalty points transfer between customers. XStak has this and we don't.

## Context
- Customers table has `loyalty_points INTEGER DEFAULT 0`
- Sales table has `points_earned` and `points_redeemed` columns
- Points are currently earned/redeemed during sales only

## What to build

1. **Backend** (in routes/customers.js):
   - `POST /api/customers/transfer-points` — body: `{ from_customer_id, to_customer_id, points, reason }`
   - Validate: both customers exist, from_customer has enough points, points > 0
   - In a transaction:
     - Deduct from sender: `UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id = $2 AND loyalty_points >= $1` (check rowCount === 1)
     - Add to receiver: `UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2`
     - Log in customer_wallet_ledger (or a new loyalty_transfers log if you prefer — but wallet_ledger already has the pattern): two entries, one debit for sender, one credit for receiver, reference_type = 'points_transfer'
   - Return `{ success: true, from_balance: X, to_balance: Y }`
   - Requires `manage_customers` permission

2. **Frontend** (on customer detail page):
   - Add a "Transfer Points" button (only visible if customer has points > 0)
   - Modal: select target customer (searchable dropdown), enter points amount, optional reason
   - Show current balance and remaining balance preview
   - After success, refresh both customer records and show toast

## Patterns
- Use `db.transaction(async (client) => { ... })` for atomicity
- For customer search dropdown, there's likely already a customer search/autocomplete pattern — grep for it in frontend
- Use `requirePerm("manage_customers")` for auth

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files
- Add tests
```

---

## Wave 2 — Accounting Completeness (5 features, 3 rounds)

**Dependency chain**: Chart of Accounts (#10) must be built first — Journal Entries (#11) depends on it. The other 3 features are independent.

### Round 2A — 3 parallel sessions

---

#### Feature 8: Credit & Debit Notes
**Branch**: `wave2/credit-debit-notes`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, new section in `routes/tier4/accounting.js`, frontend
**Estimated time**: ~2 hours

**Prompt**:
```
I need to add credit and debit notes to our accounting module. These are standard Pakistan accounting documents for purchase/sales adjustments. Assaan Retail has them.

## Context
- Accounting routes are in `routes/tier4/accounting.js`
- Read that file first to understand the pattern (it has P&L, balance sheet, cash flow, etc.)
- Feature-gated by `requireFeature("accounting_core")`
- Uses `requireAnyPerm(["view_reports", "manage_employees"])` for auth

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS credit_notes (
     id SERIAL PRIMARY KEY,
     note_number TEXT NOT NULL,
     type TEXT NOT NULL CHECK(type IN ('sales','purchase')),
     customer_id INTEGER REFERENCES customers(id),
     supplier_id INTEGER REFERENCES suppliers(id),
     amount NUMERIC(12,2) NOT NULL,
     reason TEXT NOT NULL,
     reference_type TEXT, -- 'return', 'adjustment', 'overcharge'
     reference_id INTEGER, -- links to return_id or PO id
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
   ```

2. **Backend** (add to routes/tier4/accounting.js):
   - CRUD for credit_notes: GET list (with filters), GET :id, POST create, PUT :id update, PUT :id/approve, PUT :id/cancel
   - CRUD for debit_notes: same pattern
   - Auto-generate note_number: `CN-YYYYMMDD-NNN` / `DN-YYYYMMDD-NNN`
   - On approve: if type='sales' and has customer_id, adjust customer balance. If type='purchase' and has supplier_id, adjust supplier running_balance.
   - All endpoints gated by `requireFeature("accounting_core")` and `requireAnyPerm(["manage_employees", "all_access"])`

3. **Frontend**:
   - Create CreditDebitNotesRedesign.jsx in pages/redesign/
   - Tabbed view: Credit Notes | Debit Notes
   - Each tab: list with status badges (draft=gray, approved=green, applied=blue, cancelled=red)
   - Create/edit modal with: type (sales/purchase), customer or supplier picker, amount, reason, reference
   - Approve button (changes status, shows confirmation)

## Patterns
- Follow the pattern in tier4/accounting.js for route structure
- Use `db.transaction()` for approve actions that modify balances
- Auto-number pattern: `SELECT COUNT(*) + 1 FROM credit_notes WHERE note_number LIKE 'CN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%'`

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 9: Post-Dated Cheque Tracking
**Branch**: `wave2/postdated-cheques`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/tier4/accounting.js`, frontend
**Estimated time**: ~1.5 hours

**Prompt**:
```
I need to add post-dated cheque tracking. This is very common in Pakistan retail — suppliers and customers both use post-dated cheques. Assaan Retail has it.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
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
   ```

2. **Backend** (add to routes/tier4/accounting.js):
   - CRUD: GET /api/accounting/cheques (with status filter, type filter, maturity date range), GET :id, POST create, PUT :id, DELETE :id
   - Status transitions: PUT /api/accounting/cheques/:id/deposit, /clear, /bounce, /cancel
   - `GET /api/accounting/cheques/upcoming` — cheques maturing in next 7 days (for dashboard alert)
   - On clear: if receivable+customer, add to customer balance. If payable+supplier, record payment.
   - All gated by `requireFeature("accounting_core")`

3. **Frontend**:
   - Create PostdatedChequesRedesign.jsx in pages/redesign/
   - List view with status color coding: pending=yellow, deposited=blue, cleared=green, bounced=red, cancelled=gray
   - Maturity date column with "due in X days" indicator for pending cheques
   - "Upcoming" section at top showing cheques maturing within 7 days
   - Create modal: cheque number, type, party picker, bank, amount, dates
   - Action buttons per row based on current status (Deposit → Clear/Bounce)

## Patterns
- Follow existing accounting route patterns in tier4/accounting.js
- Use `requireAnyPerm(["manage_employees", "all_access"])`
- party_id references either customers(id) or suppliers(id) based on party_type — resolve with conditional JOIN

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 10: Chart of Accounts
**Branch**: `wave2/chart-of-accounts`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/tier4/accounting.js`, frontend
**Estimated time**: ~2 hours
**BLOCKER FOR**: Feature 11 (Journal Entries)

**Prompt**:
```
I need to add a Chart of Accounts to our accounting module. This is the foundation for proper double-entry bookkeeping. Assaan Retail has it built-in, XStak relies on integrations.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS chart_of_accounts (
     id SERIAL PRIMARY KEY,
     code TEXT NOT NULL,
     name TEXT NOT NULL,
     type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),
     sub_type TEXT, -- e.g., 'current_asset', 'fixed_asset', 'accounts_receivable', etc.
     parent_id INTEGER REFERENCES chart_of_accounts(id),
     is_system BOOLEAN DEFAULT false, -- system accounts cannot be deleted
     is_active BOOLEAN DEFAULT true,
     description TEXT,
     normal_balance TEXT CHECK(normal_balance IN ('debit','credit')),
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

2. **Seed default Pakistan-standard accounts** (in migration v15):
   - Assets (1xxx): 1000 Cash on Hand, 1010 Bank Account, 1100 Accounts Receivable, 1200 Inventory, 1300 Fixed Assets
   - Liabilities (2xxx): 2000 Accounts Payable, 2100 Sales Tax Payable, 2200 Other Payables
   - Equity (3xxx): 3000 Owner's Equity, 3100 Retained Earnings
   - Revenue (4xxx): 4000 Sales Revenue, 4100 Service Revenue, 4200 Other Revenue
   - Expenses (5xxx): 5000 Cost of Goods Sold, 5100 Salaries & Wages, 5200 Rent, 5300 Utilities, 5400 Marketing, 5500 Office Supplies, 5600 Depreciation, 5900 Other Expenses
   - Mark all seeded accounts as is_system=true
   - Set normal_balance: assets+expenses = 'debit', liabilities+equity+revenue = 'credit'

3. **Backend** (add to routes/tier4/accounting.js):
   - `GET /api/accounting/coa` — returns tree structure (accounts with children nested). Use recursive CTE or build tree in JS.
   - `GET /api/accounting/coa/:id` — single account with balance (computed from journal entries if they exist, otherwise 0)
   - `POST /api/accounting/coa` — create custom account (validate code uniqueness, parent exists if provided)
   - `PUT /api/accounting/coa/:id` — update (cannot change type/code of system accounts)
   - `DELETE /api/accounting/coa/:id` — soft delete (set is_active=false). Block if is_system=true. Block if has journal entries.
   - All gated by `requireFeature("accounting_core")` + `requirePerm("all_access")`

4. **Frontend**:
   - Create ChartOfAccountsRedesign.jsx in pages/redesign/
   - Tree view showing account hierarchy with expand/collapse
   - Group by type: Assets | Liabilities | Equity | Revenue | Expenses
   - Each row: code, name, type badge, system badge (lock icon), balance
   - Add/edit account modal: code (auto-suggest next in sequence), name, type, parent (dropdown), description
   - Cannot edit/delete system accounts (disable buttons, show lock icon)

## Patterns
- Hierarchical data: similar to category tree in category-tree.js (read it for reference on tree building)
- Code auto-suggest: `SELECT MAX(code::int) + 1 FROM chart_of_accounts WHERE type = $1` or similar
- All accounting routes require `requireFeature("accounting_core")`

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 12: Bulk Payment & Expense Importing
**Branch**: `wave2/bulk-import-payments`
**Files touched**: `routes/import.js`, frontend import page
**Estimated time**: ~1 hour

**Prompt**:
```
I need to add bulk CSV/XLSX importing for payments and expenses. Assaan Retail has this. We already have the import pattern for products/customers/suppliers — this extends it.

## Context
- Read routes/import.js first — it already handles products, customers, suppliers import
- It uses multer for file upload, XLSX library for parsing, preview mode support
- The pattern: upload → parse → validate rows → preview OR insert

## What to build

1. **Backend** (extend routes/import.js):
   - `POST /api/import/expenses` — import expenses from CSV/XLSX
     - Required columns: date, category, amount, description
     - Optional: outlet_id, payment_method, reference
     - Validate: category exists (lookup from expense_categories), amount > 0, date is valid
     - Preview mode with `?preview=1`
   - `POST /api/import/payments` — import supplier payments from CSV/XLSX
     - Required columns: supplier (name or id), amount, date, payment_method
     - Optional: reference, notes
     - Validate: supplier exists (lookup by name or id), amount > 0
     - On import: create supplier_payable records or use whatever payment recording pattern exists
   - `GET /api/import/template/expenses` — downloadable XLSX template
   - `GET /api/import/template/payments` — downloadable XLSX template

2. **Frontend** (extend the import page):
   - Find ImportRedesign.jsx and read it
   - Add "Expenses" and "Payments" tabs alongside existing Products/Customers/Suppliers
   - Same upload flow: select file → preview → confirm import
   - Show validation errors per row (same pattern as existing)

## Important — discover data model first
- Grep for `expense` in schema-pg.sql to find the expenses table structure
- Grep for `supplier_payable` or `supplier_payment` to find payment tables
- Use the exact column names from the schema

## Patterns
- Follow the EXACT same pattern as the existing product/customer import in routes/import.js
- Same multer config, same XLSX parsing, same preview mode, same error format
- Requires `all_access` permission (admin only, same as existing imports)

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files — extend import.js
- Add tests
```

---

### Round 2B — 1 session (after Chart of Accounts merged)

---

#### Feature 11: General Journal Entries
**Branch**: `wave2/journal-entries`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/tier4/accounting.js`, frontend
**Estimated time**: ~2 hours
**REQUIRES**: Feature 10 (Chart of Accounts) merged first

**Prompt**:
```
I need to add general journal entries to our accounting module. This requires the Chart of Accounts (chart_of_accounts table) which should already be in the codebase.

## Verify first
- Confirm chart_of_accounts table exists in schema-pg.sql
- Confirm GET /api/accounting/coa endpoint exists in routes/tier4/accounting.js
- If either is missing, STOP and tell me

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS journal_entries (
     id SERIAL PRIMARY KEY,
     entry_number TEXT NOT NULL,
     entry_date DATE NOT NULL,
     description TEXT NOT NULL,
     status TEXT DEFAULT 'draft' CHECK(status IN ('draft','posted','voided')),
     reference_type TEXT, -- 'manual', 'sale', 'return', 'expense', etc.
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
     CHECK(debit >= 0 AND credit >= 0),
     CHECK(debit > 0 OR credit > 0)
   );
   ```

2. **Backend** (add to routes/tier4/accounting.js):
   - `GET /api/accounting/journal-entries` — list with date range, status filter, pagination
   - `GET /api/accounting/journal-entries/:id` — entry with lines (joined to account names)
   - `POST /api/accounting/journal-entries` — create entry with lines array
     - Validate: total debits == total credits (balanced entry). If not, return 400.
     - Validate: all account_ids exist in chart_of_accounts and are active
     - Auto-generate entry_number: `JE-YYYYMMDD-NNN`
     - Use `db.transaction()`: insert entry, then insert all lines
   - `PUT /api/accounting/journal-entries/:id` — update draft entries only
   - `PUT /api/accounting/journal-entries/:id/post` — change status to 'posted', set posted_by/posted_at. Block if already posted.
   - `PUT /api/accounting/journal-entries/:id/void` — void a posted entry (status='voided'). Block if already voided.
   - `GET /api/accounting/trial-balance` — for each account in CoA, sum all posted journal entry debits and credits. Return: account_code, account_name, type, total_debit, total_credit, balance. Support date range filter.
   - All gated by `requireFeature("accounting_core")` + `requirePerm("all_access")`

3. **Frontend**:
   - Create JournalEntriesRedesign.jsx in pages/redesign/
   - List view: entry_number, date, description, status badge, total amount
   - Create/edit form:
     - Header: date, description
     - Lines table: add rows with account (searchable dropdown from CoA), description, debit, credit
     - Running totals at bottom: Total Debits | Total Credits | Difference
     - Difference must be 0 to save (highlight red if unbalanced)
     - "Add Line" button
   - Post/Void action buttons based on status
   - Trial Balance as a separate tab: table of accounts with debit/credit/balance columns

## Key accounting rule
- Every journal entry MUST balance: sum(debits) == sum(credits). This is a hard constraint.
- Frontend should show real-time balance check as user enters lines.

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

## Wave 3 — Inventory & Commerce (5 features, 2 rounds)

### Round 3A — 3 parallel sessions

---

#### Feature 13: Product Bundling / Kits
**Branch**: `wave3/product-bundling`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/products.js`, `routes/sales.js`, POS frontend
**Estimated time**: ~2.5 hours

**Prompt**:
```
I need to add product bundling/kits. Both competitors have this — it lets retailers sell combo products (e.g., "Shampoo + Conditioner Set").

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS product_bundles (
     id SERIAL PRIMARY KEY,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     component_product_id INTEGER NOT NULL REFERENCES products(id),
     component_variant_id INTEGER REFERENCES product_variants(id),
     quantity INTEGER NOT NULL DEFAULT 1,
     UNIQUE(product_id, component_product_id, component_variant_id)
   );
   ```
   Also add to products table: `is_bundle BOOLEAN DEFAULT false`

2. **Backend — Products** (in routes/products.js):
   - Read products.js first to understand the existing CRUD pattern
   - Modify POST /api/products to accept `is_bundle` flag and `bundle_components` array: `[{ product_id, variant_id?, quantity }]`
   - When creating a bundle: set is_bundle=true, insert rows into product_bundles
   - Modify PUT to allow editing bundle components
   - Modify GET /api/products/:id to include bundle_components if is_bundle=true
   - Add `GET /api/products/:id/bundle-components` endpoint
   - Bundle price is set on the parent product (not summed from components)

3. **Backend — Sales** (in routes/sales.js):
   - Read sales.js to find the stock deduction logic in POST /api/sales
   - When a bundle is sold, deduct stock from each COMPONENT product (not the bundle itself)
   - In the transaction: for each sale item where product is_bundle=true, look up bundle_components and deduct component stock
   - The sale_items row still references the bundle product_id (for receipt/reporting)
   - Same for void: restore component stock, not bundle stock

4. **Frontend — Product Form**:
   - Find the product create/edit form (grep for "ProductForm" or "CreateProduct" in frontend/src/)
   - Add "Bundle" checkbox toggle
   - When bundle is checked, show component picker: searchable product dropdown + quantity for each component
   - Add/remove component rows
   - Show "Bundle Contents" section on product detail view

5. **Frontend — POS**:
   - In the POS cart, show a small "Bundle" badge on bundle items
   - Optionally show component breakdown in a tooltip/expandable row

## Important constraint
- Bundle STOCK is not tracked separately — stock is tracked at the component level only
- The bundle product should have stock=NULL or stock=0 and a flag to skip stock validation
- Only component stock matters for availability

## Patterns
- Use db.transaction() for creating bundles (insert product + insert bundle rows)
- Use db.transaction() for sales with bundles (deduct all component stock atomically)
- The existing sales POST uses FOR UPDATE row locks on stock — extend this to lock component products too

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 14: Stock Aging Analysis
**Branch**: `wave3/stock-aging`
**Files touched**: `routes/reports/` (new report file), frontend reports
**Estimated time**: ~1.5 hours

**Prompt**:
```
I need to add stock aging analysis. XStak has this — it shows how long inventory has been sitting, helping avoid clearance losses.

## What to build

1. **Backend** — create `routes/reports/stock-aging.js`:
   - Read ONE existing report file in routes/reports/ first to understand the pattern (e.g., routes/reports/inventory-dump.js or similar)
   - `GET /api/reports/stock-aging` — for each product with stock > 0:
     - Calculate age from the most recent GRN received date (goods_received_notes.received_at)
     - If no GRN exists, use product.created_at as fallback
     - Group into aging buckets: 0-30 days (fresh), 31-60 (aging), 61-90 (old), 90+ (critical)
     - Return per product: product_id, name, sku, current_stock, cost_price, stock_value (stock * cost_price), age_days, age_bucket
     - Summary totals per bucket: count of products, total stock value
   - Support outlet_id filter
   - Support `?bucket=critical` to filter only 90+ day items
   - Requires `view_reports` permission

2. **Register the route** — find where other report routes are registered (check routes/reports/ for an index.js or check registerAllRoutes.js pattern — but DO NOT modify registerAllRoutes.js for domain logic, just see how report routes get mounted)

3. **Frontend**:
   - Add "Stock Aging" tab/card in the Reports page
   - Find the reports page: grep for "Reports" or "ReportsRedesign" in frontend/src/pages/
   - Summary bar: 4 colored cards showing bucket totals (Fresh=green, Aging=yellow, Old=orange, Critical=red) with product count and total value
   - Below: sortable table of all products with aging info
   - Click a bucket card to filter the table
   - Highlight critical items (red background row)

## Patterns
- Follow existing report route pattern (module.exports = function, express.Router, etc.)
- Use GRN join: `LEFT JOIN goods_received_notes grn ON grn.po_id IN (SELECT id FROM purchase_orders WHERE ...) AND grn.outlet_id = ...`
- Actually, first discover how GRN links to products: grep for grn_items in schema-pg.sql. You may need: `SELECT MAX(grn.received_at) FROM goods_received_notes grn JOIN grn_items gi ON gi.grn_id = grn.id WHERE gi.product_id = p.id`
- Use requireAnyPerm(["view_reports", "manage_inventory"])

## Do NOT
- Add tests
```

---

#### Feature 15: Inventory Audit via Barcode Scan
**Branch**: `wave3/inventory-audit`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, new route file or extend inventory.js, frontend
**Estimated time**: ~2.5 hours

**Prompt**:
```
I need to add inventory audit (physical stock count) via barcode scanning. Both competitors have this. We already have barcode scanner support in POS (50ms keystroke detection) — reuse that pattern.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
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
     system_qty INTEGER NOT NULL, -- snapshot of system stock at count start
     counted_qty INTEGER DEFAULT 0,
     variance INTEGER GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
     last_scanned_at TIMESTAMPTZ,
     UNIQUE(stock_count_id, product_id, variant_id)
   );
   ```

2. **Backend** (add to routes/inventory.js — read it first):
   - `POST /api/stock-counts` — create new count session for an outlet. Snapshot current stock into stock_count_items for ALL products at that outlet. Auto-generate count_number: `SC-YYYYMMDD-NNN`.
   - `GET /api/stock-counts` — list count sessions (with status filter)
   - `GET /api/stock-counts/:id` — count with all items, variances, product names
   - `POST /api/stock-counts/:id/scan` — body: `{ barcode }`. Find product by barcode, increment counted_qty. If product not in count_items yet (shouldn't happen if we snapshotted all), add it. Return the updated item.
   - `PUT /api/stock-counts/:id/items/:itemId` — manually set counted_qty (for manual entry alongside scanning)
   - `POST /api/stock-counts/:id/complete` — finalize the count:
     - Set status='completed'
     - Calculate all variances
     - Optionally auto-create stock adjustments for discrepancies (ask user via `?auto_adjust=true`)
     - Return variance summary
   - `GET /api/stock-counts/:id/variance-report` — export-ready variance data
   - Requires `manage_inventory` permission

3. **Frontend**:
   - Create StockCountRedesign.jsx in pages/redesign/
   - "Start Count" button → select outlet → creates count session
   - Main counting screen:
     - Barcode input field at top (auto-focused, same pattern as POS scanner)
     - Product list showing: name, SKU, system qty, counted qty, variance (red if negative, green if positive)
     - Each scan adds 1 to counted_qty (with audio beep or visual flash feedback)
     - Manual qty override input per row
     - Running progress: "X of Y products counted"
   - "Complete Count" button → shows variance summary → confirm to finalize
   - History list of past counts with status badges

## Barcode scanner pattern
- The POS uses keystroke detection (characters accumulate, Enter key triggers lookup)
- Reuse the same input handling: onKeyDown on a hidden/visible input, accumulate characters, on Enter → call scan endpoint
- Grep for "barcode" or "scanner" in frontend/src/pages/redesign/POSRedesign.jsx or pos/ directory to find the exact pattern

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

### Round 3B — 2 parallel sessions

---

#### Feature 16: Scan & Receive (Barcode GRN)
**Branch**: `wave3/scan-receive-grn`
**Files touched**: `routes/grn.js`, frontend GRN page
**Estimated time**: ~1 hour

**Prompt**:
```
I need to add barcode scanning to the GRN (Goods Received Notes) receiving process. Assaan Retail has this. We already have barcode scanner support — just need to wire it into the GRN page.

## What to build

1. **Backend** (in routes/grn.js — read it first):
   - `POST /api/grn/:id/scan-receive` — body: `{ barcode, quantity? }`
     - Find product by barcode (from products table or product_variants table)
     - Find the matching grn_item for this GRN + product
     - Increment qty_received by quantity (default 1)
     - If qty_received > qty_ordered, still allow but flag as "over-received"
     - Return the updated grn_item with product name and over-received flag
   - Requires `manage_orders` permission

2. **Frontend** (on the GRN detail/receiving page):
   - Find the GRN page: grep for "GRN" or "GoodsReceived" in frontend/src/pages/
   - Add a "Scan to Receive" mode toggle button
   - When in scan mode: show barcode input field (auto-focused)
   - Each scan: call scan-receive endpoint, update the item row, flash green
   - Show received vs ordered count per item: "5 / 10 received"
   - Progress bar showing total items received vs total ordered
   - Audio/visual feedback on successful scan

## Barcode scanner pattern
- Same as POS: input field captures keystrokes, Enter triggers lookup
- Grep for "barcode" in frontend POS files to find the exact pattern to reuse

## Do NOT
- Touch registerAllRoutes.js or index.js
- Create new route files — extend grn.js
- Add tests
```

---

#### Feature 17: Price Lists / Multi-Price per Product
**Branch**: `wave3/price-lists`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/products.js`, `routes/sales.js`, POS frontend
**Estimated time**: ~2 hours

**Prompt**:
```
I need to add price lists (multi-price per product). Assaan Retail has this — it lets you set customer-specific or volume-based pricing.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
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
     min_qty INTEGER DEFAULT 1, -- for volume pricing
     UNIQUE(price_list_id, product_id, variant_id, min_qty)
   );
   ```
   Also add to customers table: `price_list_id INTEGER REFERENCES price_lists(id)`

2. **Backend — Price Lists** (add to routes/products.js or create a small section):
   - CRUD for price_lists: GET /api/price-lists (list), POST (create), PUT :id (update), DELETE :id
   - CRUD for price_list_items: GET /api/price-lists/:id/items, POST (add items), PUT (update price), DELETE (remove item)
   - Bulk set: POST /api/price-lists/:id/bulk-items — body: array of {product_id, variant_id, price, min_qty}
   - Requires `manage_products` permission

3. **Backend — Price Resolution** (in routes/sales.js):
   - When creating a sale with a customer_id, check if customer has a price_list_id
   - If yes, look up price_list_items for each cart item
   - For volume pricing: find the best matching min_qty tier (highest min_qty <= cart item quantity)
   - Use price list price if found, otherwise fall back to product.price
   - Return the resolved price in the sale receipt

4. **Frontend — Price List Management**:
   - Create PriceListsRedesign.jsx in pages/redesign/
   - List of price lists with name, type, item count, status
   - Detail view: table of products in this list with their special prices vs default price (show savings)
   - Add products to list: product picker + custom price input
   - Bulk import option (or manual entry)

5. **Frontend — POS**:
   - When a customer is selected in POS, if they have a price_list_id, resolve prices from that list
   - Show original price struck through with special price below (if different)
   - Show "Special Price" badge

## Patterns
- Price resolution: query once when customer is selected, cache in POS context
- Volume pricing: ORDER BY min_qty DESC, LIMIT 1 WHERE min_qty <= item_qty
- Use requireAnyPerm(["manage_products", "all_access"]) for CRUD

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

## Wave 4 — Customer & Loyalty Depth (3 features, 1 round)

### Round 4A — 3 parallel sessions (all independent)

---

#### Feature 18: Tiered Loyalty Programs
**Branch**: `wave4/tiered-loyalty`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/customers.js`, `routes/sales.js`, frontend
**Estimated time**: ~2.5 hours

**Prompt**:
```
I need to add tiered loyalty programs (Bronze/Silver/Gold). XStak has this. Currently we have flat loyalty points only.

## Current state
- customers table has `loyalty_points INTEGER DEFAULT 0`
- sales table has `points_earned` and `points_redeemed`
- Points are earned/redeemed during sale creation

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS loyalty_tiers (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL, -- e.g., 'Bronze', 'Silver', 'Gold', 'Platinum'
     min_spend NUMERIC(12,2) NOT NULL DEFAULT 0, -- cumulative spend threshold
     points_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0, -- 1.0x, 1.5x, 2.0x
     discount_percent NUMERIC(4,2) DEFAULT 0, -- automatic discount for tier members
     benefits TEXT, -- JSON or text description of tier benefits
     color TEXT, -- hex color for badges (#CD7F32 bronze, #C0C0C0 silver, #FFD700 gold)
     sort_order INTEGER DEFAULT 0,
     is_active BOOLEAN DEFAULT true,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
   Also add to customers table: `loyalty_tier_id INTEGER REFERENCES loyalty_tiers(id)`, `total_spend NUMERIC(12,2) DEFAULT 0`

2. **Seed default tiers** (migration v15):
   - Bronze: min_spend=0, multiplier=1.0, discount=0%, color=#CD7F32
   - Silver: min_spend=25000, multiplier=1.5, discount=2%, color=#C0C0C0
   - Gold: min_spend=75000, multiplier=2.0, discount=5%, color=#FFD700
   - Platinum: min_spend=200000, multiplier=3.0, discount=8%, color=#E5E4E2

3. **Backend — Tier Management** (in routes/customers.js):
   - `GET /api/loyalty/tiers` — list all tiers
   - `POST /api/loyalty/tiers` — create tier (admin only)
   - `PUT /api/loyalty/tiers/:id` — update tier
   - `DELETE /api/loyalty/tiers/:id` — delete (block if customers are in this tier)

4. **Backend — Tier Assignment** (in routes/sales.js):
   - After each sale, update customer's total_spend: `UPDATE customers SET total_spend = total_spend + $1 WHERE id = $2`
   - Check if customer qualifies for a higher tier: `SELECT id FROM loyalty_tiers WHERE min_spend <= $1 ORDER BY min_spend DESC LIMIT 1`
   - If tier changed, update customer's loyalty_tier_id
   - Apply points_multiplier when calculating points_earned: `floor(sale_amount * points_per_rupee * tier.points_multiplier)`
   - Apply tier discount automatically (add as a line item or reduce total)

5. **Frontend**:
   - On customer detail: show tier badge (colored circle with tier name)
   - Show progress to next tier: "PKR X,XXX more to reach Gold"
   - Tier management page (admin): list/edit tiers, preview tier distribution
   - POS: show customer's tier badge when customer is selected, show multiplier info

## Patterns
- Use db.transaction() for sale + tier upgrade (atomic)
- Keep backward compatibility: if no tiers exist, system works like flat points (multiplier=1)

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 19: Rich Customer Profiling
**Branch**: `wave4/customer-profiling`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, `routes/customers.js`, frontend
**Estimated time**: ~1.5 hours

**Prompt**:
```
I need to add rich customer profiling with extended profile fields. Assaan Retail has this — demographics, preferences, purchase behavior tags, notes, customer groups.

## Current state
- customers table: id, name, mobile, email, address, cnic, occupation, balance, loyalty_points, ntn_cnic

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   -- Add columns to customers table:
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT CHECK(gender IN ('male','female','other'));
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group_id INTEGER;
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[]; -- PostgreSQL array of tags
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;
   ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact TEXT CHECK(preferred_contact IN ('sms','whatsapp','email','call'));

   CREATE TABLE IF NOT EXISTS customer_groups (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT,
     discount_percent NUMERIC(4,2) DEFAULT 0,
     is_active BOOLEAN DEFAULT true,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE customers ADD CONSTRAINT fk_customer_group
     FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id);
   ```

2. **Backend** (in routes/customers.js):
   - CRUD for customer_groups: GET /api/customer-groups, POST, PUT :id, DELETE :id
   - Modify POST/PUT /api/customers to accept the new fields
   - Modify GET /api/customers to include new fields + group name (LEFT JOIN)
   - `GET /api/customers/:id/profile` — enriched profile with:
     - Basic info (all columns)
     - Purchase summary: total orders, total spend, average order value, last purchase date
     - Top 5 purchased products (from sale_items)
     - Group info
     - Tags
   - `PUT /api/customers/:id/tags` — add/remove tags (body: `{ tags: ["vip", "wholesale"] }`)

3. **Frontend** (on customer detail page):
   - Extended profile form with sections: Basic Info | Demographics | Preferences | Notes & Tags
   - Tags: chip-style display, add with autocomplete (suggest from existing tags across customers), remove with X
   - Customer group: dropdown selector
   - Purchase summary cards (total orders, spend, avg order, last purchase)
   - Top products list

4. **Customer Groups page**:
   - Create CustomerGroupsRedesign.jsx in pages/redesign/
   - Simple CRUD list: name, description, member count, discount %
   - Assign customers to groups from either the group page or the customer profile

## Patterns
- PostgreSQL arrays: `tags TEXT[]`, insert with `ARRAY[$1, $2]`, query with `$1 = ANY(tags)`, append with `array_append(tags, $1)`
- Use requireAnyPerm(["manage_customers", "all_access"]) for group management
- For purchase summary, use existing queries from customer sales history endpoint as reference

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

#### Feature 20: Feedback / Reviews Management
**Branch**: `wave4/feedback-reviews`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, new route or extend products.js, frontend
**Estimated time**: ~2 hours

**Prompt**:
```
I need to add product feedback/reviews management. Assaan Retail has this — customers can rate products and leave reviews.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
   CREATE TABLE IF NOT EXISTS product_reviews (
     id SERIAL PRIMARY KEY,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     customer_id INTEGER REFERENCES customers(id),
     customer_name TEXT, -- for anonymous reviews
     rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
     title TEXT,
     body TEXT,
     status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
     moderated_by INTEGER REFERENCES employees(id),
     moderated_at TIMESTAMPTZ,
     sale_id INTEGER REFERENCES sales(id), -- link to purchase for verified reviews
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
   Also add to products table: `avg_rating NUMERIC(3,2) DEFAULT 0`, `review_count INTEGER DEFAULT 0`

2. **Backend** (extend routes/products.js or create a thin reviews section):
   - `GET /api/products/:id/reviews` — list reviews for a product (approved only for non-admin, all for admin)
   - `POST /api/products/:id/reviews` — create review (body: rating, title, body, customer_id?). Check if customer has purchased this product (from sale_items) for "verified purchase" badge.
   - `PUT /api/reviews/:id/moderate` — approve or reject (body: `{ status: "approved" }`)
   - `GET /api/reviews/pending` — all pending reviews (admin moderation queue)
   - On approve/reject: recalculate product avg_rating and review_count: `UPDATE products SET avg_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM product_reviews WHERE product_id = $1 AND status = 'approved'), review_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = $1 AND status = 'approved') WHERE id = $1`
   - Requires `manage_products` permission for moderation, no auth for public review submission (but rate-limit it)

3. **Frontend — Product Detail**:
   - Add "Reviews" tab on product detail page
   - Star rating display (1-5 stars filled/empty)
   - Average rating + count: "4.2/5 (23 reviews)"
   - List of reviews: stars, title, body, customer name, "Verified Purchase" badge, date
   - "Write a Review" form: star picker, title, body

4. **Frontend — Admin Review Moderation**:
   - Create ReviewModerationRedesign.jsx in pages/redesign/ (or add as tab in existing admin page)
   - Queue of pending reviews: product name, customer, rating, preview of body
   - Approve / Reject buttons per review
   - Filter by: pending, approved, rejected

## Patterns
- Star rating component: 5 clickable star icons (filled = active, outline = inactive)
- Use Tailwind: text-yellow-400 for filled stars, text-gray-300 for empty
- Rate limiting on public review endpoint: add to middleware/rate-limit.js or use inline express-rate-limit

## Do NOT
- Touch registerAllRoutes.js or index.js
- Add tests
```

---

## Wave 5 — Fulfillment Operations (3 features, 2 rounds)

### Round 5A — 1 session (Pick/Pack/Dispatch is the largest single feature)

---

#### Feature 21: Pick / Pack / Dispatch Workflow
**Branch**: `wave5/pick-pack-dispatch`
**Files touched**: `schema-pg.sql`, `migrate-pg.js`, new `routes/fulfillment.js`, frontend
**Estimated time**: ~3 hours

**Prompt**:
```
I need to add a Pick / Pack / Dispatch fulfillment workflow. Both competitors have this — it's the scan-driven process for fulfilling e-commerce orders.

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
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
   ```

2. **Backend** — create `routes/fulfillment.js`:
   - Register it in registerAllRoutes.js (add one line to mount it — this is the ONE exception where you touch that file)
   - `POST /api/fulfillment/picklists` — body: `{ order_ids: [1,2,3], outlet_id }`. Creates picklist from selected orders. Populates picklist_items from web_order_items.
   - `GET /api/fulfillment/picklists` — list with status filter, date range, outlet filter
   - `GET /api/fulfillment/picklists/:id` — detail with items + order info
   - `POST /api/fulfillment/picklists/:id/pick-scan` — body: `{ barcode }`. Find matching item, increment qty_picked. Return updated item.
   - `POST /api/fulfillment/picklists/:id/complete-picking` — validate all items picked, advance status to 'picked'
   - `POST /api/fulfillment/picklists/:id/pack-scan` — body: `{ barcode }`. Increment qty_packed.
   - `POST /api/fulfillment/picklists/:id/complete-packing` — advance to 'packed'
   - `POST /api/fulfillment/picklists/:id/dispatch` — advance to 'dispatched', update web_orders fulfillment_status='fulfilled', shipped_at=NOW()
   - `DELETE /api/fulfillment/picklists/:id` — cancel (only if pending)
   - All require `manage_orders` permission

3. **Frontend** — create FulfillmentRedesign.jsx in pages/redesign/:
   - **Orders Queue** tab: unfulfilled orders ready for picking. Multi-select + "Create Picklist" button
   - **Picklists** tab: list of picklists with status pipeline badges (Pending → Picking → Picked → Packing → Packed → Dispatched)
   - **Pick Screen**: barcode input field (auto-focus), list of items to pick with progress (picked/total). Green flash on successful scan. Progress bar.
   - **Pack Screen**: same barcode scanning pattern for packing verification
   - **Dispatch**: confirm button to mark as dispatched
   - Status badges: pending=gray, picking=blue, picked=cyan, packing=orange, packed=green, dispatched=purple

## Patterns
- Barcode scanning: same pattern as POS and inventory audit
- Status pipeline: linear flow, each step validates the previous is complete
- Use db.transaction() for dispatch (update picklist + all web_orders atomically)
- Auto-generate picklist_number: `PL-YYYYMMDD-NNN`

## Do NOT
- Add tests
```

---

### Round 5B — 2 parallel sessions

---

#### Feature 22: Loadsheet Generation
**Branch**: `wave5/loadsheets`
**Files touched**: `routes/fulfillment.js` (extend), frontend
**Estimated time**: ~1.5 hours
**REQUIRES**: Feature 21 merged (uses picklists table)

**Prompt**:
```
I need to add loadsheet generation. Both competitors have this — it's a grouped shipment document for courier handover.

## Context
- The fulfillment module should already exist (routes/fulfillment.js) with picklists
- Read that file first to understand the existing pattern

## What to build

1. **Schema** (migration v15 + schema-pg.sql):
   ```sql
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
     handed_over_to TEXT -- driver name
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
   ```

2. **Backend** (extend routes/fulfillment.js):
   - `POST /api/fulfillment/loadsheets` — body: `{ order_ids, courier_id, outlet_id }`. Group dispatched orders into a loadsheet.
   - `GET /api/fulfillment/loadsheets` — list with status filter
   - `GET /api/fulfillment/loadsheets/:id` — detail with orders
   - `PUT /api/fulfillment/loadsheets/:id/finalize` — lock the loadsheet, calculate totals
   - `PUT /api/fulfillment/loadsheets/:id/handover` — mark as handed over (body: `{ handed_over_to }`)
   - `GET /api/fulfillment/loadsheets/:id/export` — generate CSV export with columns: Order#, Customer, Address, Phone, Items, COD Amount, Tracking#, Courier
   - Requires `manage_orders` permission

3. **Frontend** (add to FulfillmentRedesign.jsx):
   - "Loadsheets" tab
   - Create loadsheet: select dispatched orders → group by courier → generate
   - Loadsheet detail: table of orders with tracking, COD info
   - "Export CSV" button
   - "Mark Handed Over" button with driver name input
   - Status badges: draft=gray, finalized=blue, handed_over=green
   - Print-friendly view for the loadsheet (simple table layout)

## Do NOT
- Touch registerAllRoutes.js (fulfillment routes should already be mounted)
- Add tests
```

---

#### Feature 23: Scan & Dispatch
**Branch**: `wave5/scan-dispatch`
**Files touched**: `routes/fulfillment.js` (extend), frontend
**Estimated time**: ~45 min
**REQUIRES**: Feature 21 merged

**Prompt**:
```
I need to add scan-to-dispatch functionality. Assaan Retail has this — quickly mark individual orders as dispatched by scanning their barcode/tracking number.

## Context
- Fulfillment routes should already exist in routes/fulfillment.js
- Read it first to understand existing patterns

## What to build

1. **Backend** (extend routes/fulfillment.js):
   - `POST /api/fulfillment/scan-dispatch` — body: `{ scan_value }` where scan_value could be:
     - A tracking_number → find web_order by tracking_number
     - An external_order_number → find web_order by external_order_number
     - An order barcode (if we generate them) → find by id
   - Update the matched order: fulfillment_status='fulfilled', shipped_at=NOW()
   - Return the updated order info: { order_id, order_number, customer_name, status }
   - If already dispatched, return a warning: "Order already dispatched"
   - If not found, return 404
   - Requires `manage_orders` permission

2. **Frontend** (add to FulfillmentRedesign.jsx):
   - "Quick Dispatch" section/tab
   - Large barcode input field (auto-focused)
   - Scan → shows result card: order number, customer, status change
   - Running list of recently scanned/dispatched orders (last 20)
   - Count: "X orders dispatched this session"
   - Error handling: red flash + sound for "not found" or "already dispatched"
   - Green flash + sound for successful dispatch

## Patterns
- Same barcode scanning pattern as POS/inventory audit
- Try multiple lookups: first by tracking_number, then by external_order_number, then by id
- Simple and fast — this is a speed-focused workflow

## Do NOT
- Touch registerAllRoutes.js
- Add tests
```

---

## Wave 6 — Platform Polish (2 features, 1 round)

### Round 6A — 2 parallel sessions

---

#### Feature 24: Multi-Channel Aggregated Reports
**Branch**: `wave6/multichannel-reports`
**Files touched**: `routes/reports/` (new report file), frontend reports page
**Estimated time**: ~1.5 hours

**Prompt**:
```
I need to add multi-channel aggregated reports. Both competitors have this — combined view of POS + Shopify + WooCommerce sales.

## What to build

1. **Backend** — create `routes/reports/multichannel.js`:
   - Read ONE existing report file in routes/reports/ first for the pattern
   - `GET /api/reports/multichannel-summary` — combines:
     - POS sales (from `sales` table where voided=false) — channel: 'POS'
     - Shopify orders (from `web_orders` where source='shopify') — channel: 'Shopify'
     - WooCommerce orders (from `web_orders` where source='woocommerce') — channel: 'WooCommerce'
   - Return per channel: order_count, gross_revenue, discount_total, tax_total, net_revenue, average_order_value
   - Grand totals across all channels
   - Support date range filter: `?from=YYYY-MM-DD&to=YYYY-MM-DD`
   - Support outlet_id filter (for POS)

   - `GET /api/reports/multichannel-daily` — daily breakdown per channel:
     - Date | POS Revenue | Shopify Revenue | WooCommerce Revenue | Total
     - Useful for trend comparison charts

   - `GET /api/reports/multichannel-products` — top products across all channels:
     - Product | POS Qty | Shopify Qty | WooCommerce Qty | Total Qty | Total Revenue
   
   - Requires `view_reports` permission

2. **Register the route** — add to registerAllRoutes.js (one line mount)

3. **Frontend** (add to Reports page):
   - "Multi-Channel" tab in Reports
   - Summary cards per channel: colored card (POS=blue, Shopify=green, WooCommerce=purple) with revenue + order count
   - Pie chart: revenue share by channel
   - Daily trend chart: line chart with one line per channel
   - Top products table: cross-channel product performance

## Patterns
- POS revenue: `SELECT SUM(total_amount) FROM sales WHERE voided=false AND timestamp >= $1 AND timestamp < $2`
- Web revenue: `SELECT SUM(grand_total) FROM web_orders WHERE source=$1 AND ordered_at >= $2 AND ordered_at < $3`
- Use toUtcStart/toUtcEnd for date filtering
- For charts: return data in a format the frontend chart library can consume (check if any chart library is already installed — grep for "chart" or "recharts" in frontend/package.json)

## Do NOT
- Add tests
```

---

#### Feature 25: Public API Documentation (Swagger/OpenAPI)
**Branch**: `wave6/api-docs`
**Files touched**: `backend/package.json` (new deps), new `backend/swagger.js`, `backend/index.js` (mount swagger UI)
**Estimated time**: ~2.5 hours

**Prompt**:
```
I need to add public API documentation using Swagger/OpenAPI. XStak has this — it opens the door for third-party integrations.

## What to build

1. **Install dependencies**:
   - `cd backend && npm install swagger-ui-express swagger-jsdoc`

2. **Create backend/swagger.js**:
   - OpenAPI 3.0 spec with:
     - Info: title "SanoPOS API", version "1.0.0", description
     - Server: `{url}/api`
     - Security: Bearer JWT token
     - Tags grouped by domain: Auth, Products, Sales, Returns, Customers, Orders, Inventory, Reports, Accounting, Billing
   - Use swagger-jsdoc to scan route files for JSDoc annotations
   - Configure: `apis: ['./routes/*.js', './routes/**/*.js']`

3. **Add JSDoc annotations to key routes** — add `@swagger` comments to these HIGH-PRIORITY endpoints (don't annotate every route, focus on the public-facing ones):
   - Auth: POST /api/auth/login, POST /api/auth/mt-login
   - Products: GET /api/products, GET /api/products/:id, POST /api/products
   - Sales: POST /api/sales, GET /api/sales
   - Returns: POST /api/returns
   - Customers: GET /api/customers, POST /api/customers
   - Orders: GET /api/orders
   - Reports: GET /api/reports/item-wise, GET /api/reports/inventory-dump
   - Billing: GET /api/billing/pricing, GET /api/billing/status

4. **Mount Swagger UI** (in index.js — yes, this is the one case where you modify index.js):
   - Add AFTER all route registration:
     ```js
     const swaggerUi = require('swagger-ui-express');
     const swaggerSpec = require('./swagger');
     app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
     ```

5. **Add a link in the frontend** (optional):
   - In the admin or settings page, add a link to `/api-docs` labeled "API Documentation"

## Swagger annotation format (for reference):
```js
/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: List all products
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name/SKU/barcode
 *     responses:
 *       200:
 *         description: Array of products
 */
```

## Patterns
- Don't over-annotate: focus on the ~15-20 most important endpoints listed above
- Each annotation: summary, tags, parameters, request body (if POST/PUT), response codes
- Include schema definitions for key models: Product, Sale, Customer, Order

## Do NOT
- Add tests
```

---

## Migration v15 — Consolidated DDL

All waves share one migration. Each feature prompt includes its DDL. When merging, collect all `ALTER TABLE` and `CREATE TABLE` statements into a single migration v15 block in `migrate-pg.js`.

### Tables created in v15:
1. credit_notes
2. debit_notes
3. postdated_cheques
4. chart_of_accounts (with seed data)
5. journal_entries + journal_entry_lines
6. product_bundles
7. stock_counts + stock_count_items
8. price_lists + price_list_items
9. loyalty_tiers (with seed data)
10. customer_groups
11. product_reviews
12. picklists + picklist_items
13. loadsheets + loadsheet_orders

### Columns added in v15:
1. customers: is_blacklisted, blacklist_reason, blacklisted_at
2. customers: date_of_birth, gender, city, customer_group_id, notes, tags, preferred_payment_method, preferred_contact
3. customers: loyalty_tier_id, total_spend, price_list_id
4. products: is_bundle, avg_rating, review_count

---

## Execution Summary (Revised — Zero-Conflict Sequencing)

All work on single branch `competitive-waves`. Main is untouched safety checkpoint.

### Phase 0 — Foundation (1 session, ~1-2 hours)
| Task | What |
|------|------|
| Migration v15 | All 13 new tables + all column additions for all 25 features |
| schema-pg.sql | Updated DDL source of truth |
| Route skeletons | Empty `routes/fulfillment.js`, new report files, mounted in registerAllRoutes.js |
| Frontend stubs | All new pages registered in appRoutes.jsx as lazy placeholders |

### Revised Rounds (no two features in the same round touch the same file)

| Round | Features | Parallel Sessions | Shared File Check |
|-------|----------|-------------------|-------------------|
| **0** | Phase 0 Foundation | 1 | Migration, schema, route mounts, frontend routes — DONE ONCE |
| **1A** | #1 Blacklisting (customers.js), #2 Order Aging (orders.js), #4 Billing Discounts (billing.js) | 3 | No overlap |
| **1B** | #3 Bulk Status (orders.js), #5 Customer Ledger (customers.js), #6 Supplier Ledger (grn.js/PO.js) | 3 | No overlap |
| **1C** | #7 Points Transfer (customers.js) | 1 | customers.js free now |
| **2A** | #8 Credit/Debit Notes (accounting.js), #9 Cheques (accounting.js — NEW section), #12 Bulk Import (import.js) | 2 | #8 and #9 both touch accounting.js — run #8+#12 parallel, #9 after |
| **2A revised** | #8 Credit/Debit Notes (accounting.js), #12 Bulk Import (import.js), #10 Chart of Accounts (NEW coa section in accounting.js or separate) | 2 | #8 and #10 may clash — safer: #8+#12 parallel, then #9+#10 |
| **2B** | #9 Cheques, #10 Chart of Accounts | 2 | #9 adds to accounting.js (different section), #10 adds CoA (can be separate file or bottom of accounting.js) |
| **2C** | #11 Journal Entries | 1 | Depends on #10 (Chart of Accounts) |
| **3A** | #14 Stock Aging (new report file), #15 Inventory Audit (inventory.js) | 2 | No overlap |
| **3B** | #13 Bundling (products.js + sales.js), #16 Scan Receive (grn.js) | 2 | No overlap |
| **3C** | #17 Price Lists (products.js + sales.js) | 1 | products.js + sales.js free now |
| **4A** | #18 Tiered Loyalty (customers.js + sales.js), #20 Reviews (new section/file) | 2 | No overlap |
| **4B** | #19 Customer Profiling (customers.js) | 1 | customers.js free now |
| **5A** | #21 Pick/Pack/Dispatch (fulfillment.js) | 1 | Largest feature, solo |
| **5B** | #22 Loadsheets (fulfillment.js), #23 Scan Dispatch (fulfillment.js) | 1 sequential | Both touch fulfillment.js — run back to back |
| **6A** | #24 Multichannel Reports (new report file), #25 API Docs (swagger.js + index.js) | 2 | No overlap |
| **Total** | **25 features** | **~15 rounds** | **Zero file conflicts** |

### Realistic Time Estimates (revised)

| Phase/Wave | Time (with parallelism) | Notes |
|---|---|---|
| Phase 0 — Foundation | ~1.5 hours | One session, all infrastructure |
| Wave 1 — Quick Wins (3 rounds) | ~4 hours | 1A parallel, 1B parallel, 1C solo |
| Wave 2 — Accounting (3 rounds) | ~6 hours | 2A parallel, 2B parallel, 2C solo (blocked by CoA) |
| Wave 3 — Inventory (3 rounds) | ~6 hours | 3A parallel, 3B parallel, 3C solo |
| Wave 4 — Customer (2 rounds) | ~4 hours | 4A parallel, 4B solo |
| Wave 5 — Fulfillment (2 rounds) | ~5 hours | 5A solo (big), 5B sequential |
| Wave 6 — Polish (1 round) | ~3 hours | 6A parallel |
| **Total** | **~29.5 hours** | **~4-5 working days of active sessions** |

Realistically with review, smoke testing, and breaks: **8-12 calendar days**.

### Risk Status After Revisions

| Original Risk | Status | How |
|---|---|---|
| Migration v15 conflicts | **ELIMINATED** | Written once in Phase 0, never touched again |
| Frontend route collisions | **ELIMINATED** | All routes pre-registered in Phase 0 |
| Shared file conflicts | **ELIMINATED** | Revised sequencing — no two features in same round touch same file |
| Feature harder than estimated | **REDUCED** | Exact schema known upfront from Phase 0 |
| No tests during waves | **ACCEPTED** | Existing 449 integration tests run after each wave as regression check |
| Feature flags | **DECIDED** | Waves 1-3: no flags (core business features). Waves 4-5: new flags for premium features (fulfillment, tiered loyalty, reviews) |

### Smoke Test Checkpoints
After each wave merge, run:
```bash
cd backend && npx jest tests/integration/pg-batch1-crud.test.js  # core CRUD
cd backend && npx jest tests/unit/                                # unit tests
```
If tests pass, continue. If tests fail, fix before next wave.

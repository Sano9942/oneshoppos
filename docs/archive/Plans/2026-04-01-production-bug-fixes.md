# Production Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 12 production bugs found in the Mar 31 2026 audit — 5 must-fix, 3 should-fix, 4 low-priority.

**Architecture:** Fixes span backend auth middleware, DB transaction safety, Postgres index migration, frontend ErrorBoundary wrapping, form field naming, variant stock consistency, and Shopify field alignment. Each fix is independent — they can be done in any order but grouped by theme for efficiency.

**Tech Stack:** Node.js + Express (backend), React 19 + Tailwind v4 (frontend), PostgreSQL via `db-pg.js` (`db.query`, `db.transaction`, `client.query`), `migrate-pg.js` for new migration version.

---

## Task 1: Auth on GET routes (#1)

**Files:**
- Modify: `backend/routes/sales.js` ~line 91, ~line 173
- Modify: `backend/routes/returns.js` ~line 164, ~207
- Modify: `backend/routes/customers.js` (all unprotected GETs)
- Modify: `backend/routes/products.js` (audit all GETs)
- Modify: `backend/routes/purchase-orders.js` (audit all GETs)
- Modify: `backend/routes/grn.js` (audit all GETs)
- Modify: `backend/routes/inventory.js` (audit all GETs)
- Modify: `backend/routes/employees.js` (audit all GETs)

**Step 1: Identify every unprotected GET**

Run these greps to get a full list before touching anything:

```bash
grep -n "app\.get\|router\.get" backend/routes/sales.js | head -40
grep -n "app\.get\|router\.get" backend/routes/returns.js | head -40
grep -n "app\.get\|router\.get" backend/routes/customers.js | head -40
grep -n "app\.get\|router\.get" backend/routes/products.js | head -40
grep -n "app\.get\|router\.get" backend/routes/purchase-orders.js | head -40
grep -n "app\.get\|router\.get" backend/routes/grn.js | head -40
grep -n "app\.get\|router\.get" backend/routes/inventory.js | head -40
grep -n "app\.get\|router\.get" backend/routes/employees.js | head -40
```

For each line that does NOT have `requirePerm` or `requireAnyPerm` as the second argument, it needs fixing.

**Step 2: Add auth middleware to each unprotected GET**

The pattern is:

```javascript
// BEFORE (unprotected):
app.get("/api/sales", async (req, res) => { ... });

// AFTER:
app.get("/api/sales", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => { ... });
```

Permission mapping by route:

| Route | Permission |
|-------|-----------|
| `GET /api/sales` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/sales/:id` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/returns` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/returns/:id` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/customers` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/customers/:id` | `requireAnyPerm(["view_reports", "all_access"])` |
| `GET /api/products` | `requireAnyPerm(["view_reports", "manage_inventory", "all_access"])` |
| `GET /api/products/:id` | `requireAnyPerm(["view_reports", "manage_inventory", "all_access"])` |
| `GET /api/purchase-orders` | `requireAnyPerm(["manage_orders", "view_reports", "all_access"])` |
| `GET /api/purchase-orders/:id` | `requireAnyPerm(["manage_orders", "view_reports", "all_access"])` |
| `GET /api/grn*` | `requireAnyPerm(["manage_orders", "view_reports", "all_access"])` |
| `GET /api/transfers` | `requireAnyPerm(["manage_inventory", "view_reports", "all_access"])` |
| `GET /api/adjustments` | `requireAnyPerm(["manage_inventory", "view_reports", "all_access"])` |
| `GET /api/employees` | `requirePerm("all_access")` (already protected — verify) |

**Step 3: Verify the middleware is injected via deps**

Each route file gets its deps like:
```javascript
module.exports = function(app, deps) {
  const { db, requirePerm, requireAnyPerm, ... } = deps;
  // ...
}
```
`requirePerm` and `requireAnyPerm` are already available in every route file — no imports needed.

**Step 4: Test manually**

Start backend (`cd backend && npm start`), then in another terminal:
```bash
# Without auth header — should get 401:
curl http://localhost:5000/api/sales
# Expected: {"error":"Unauthorized"} or similar

# With auth header — should get data:
curl -H "Authorization: Bearer <token>" -H "x-employee-id: 1" http://localhost:5000/api/sales
# Expected: {"sales": [...]}
```

**Step 5: Commit**
```bash
git add backend/routes/sales.js backend/routes/returns.js backend/routes/customers.js \
        backend/routes/products.js backend/routes/purchase-orders.js \
        backend/routes/grn.js backend/routes/inventory.js backend/routes/employees.js
git commit -m "fix: add auth middleware to all unprotected GET routes (#1)"
```

---

## Task 2: Stock check race condition — TOCTOU (#2)

**Files:**
- Modify: `backend/routes/sales.js` lines ~364-411 (pre-check) and ~478-566 (transaction)

**Step 1: Understand current structure**

Read `backend/routes/sales.js` lines 340-580 carefully. The structure is:
```
lines ~364-411: Pre-transaction stock check (OUTSIDE transaction)
lines ~415-477: Idempotency check
lines ~478-566: db.transaction(...) — INSERT sale + deduct stock
```

**Step 2: Move stock check inside the transaction with FOR UPDATE**

The fix: remove the pre-transaction stock check block entirely and add it inside the `db.transaction()` call, using `SELECT ... FOR UPDATE` to lock rows before checking.

```javascript
// INSIDE db.transaction(async (client) => { ... }), BEFORE the INSERT:

// Lock and check stock for each item
for (const item of cartItems) {
  const variantId = item.variant_id || null;
  if (variantId) {
    const { rows: [row] } = await client.query(
      `SELECT COALESCE(stock, 0) AS available 
       FROM product_variants WHERE id = $1 FOR UPDATE`,
      [variantId]
    );
    if (!row || row.available < item.quantity) {
      throw Object.assign(
        new Error(`Insufficient stock for variant ${variantId}`),
        { statusCode: 400 }
      );
    }
  } else {
    const productId = item.original_product_id || item.id;
    const { rows: [row] } = await client.query(
      `SELECT COALESCE(quantity, 0) AS available 
       FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
      [productId, outlet_id]
    );
    if (!row || row.available < item.quantity) {
      throw Object.assign(
        new Error(`Insufficient stock for product ${productId}`),
        { statusCode: 400 }
      );
    }
  }
}
// ... then proceed with INSERT sale + UPDATE stock as before
```

**Step 3: Handle the thrown error in the transaction wrapper**

The `db.transaction()` call is already wrapped in try/catch. Add handling for the statusCode property:

```javascript
try {
  const saleId = await db.transaction(async (client) => {
    // ... (stock check + insert + deduct now all inside)
  });
  // ... success path
} catch (err) {
  if (err.statusCode === 400) {
    return res.status(400).json({ error: err.message });
  }
  console.error("Sale error:", err);
  return res.status(500).json({ error: "Failed to process sale" });
}
```

**Step 4: Delete the old pre-transaction stock check block**

Remove the original lines ~364-411 entirely — they're now superseded by the in-transaction check.

**Step 5: Test**

Start backend and make a test sale via Postman/curl:
```bash
# Happy path — valid sale with enough stock:
curl -X POST http://localhost:5000/api/sales \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "x-employee-id: 1" \
  -d '{"cartItems": [...], "outlet_id": 1, ...}'
# Expected: 200 with sale data

# Sad path — quantity exceeds stock:
# Send quantity > available
# Expected: 400 {"error": "Insufficient stock for product X"}
```

**Step 6: Commit**
```bash
git add backend/routes/sales.js
git commit -m "fix: move stock availability check inside transaction with FOR UPDATE (#2)"
```

---

## Task 3: POS ErrorBoundary (#3)

**Files:**
- Modify: `frontend/src/pages/redesign/POSRedesign.jsx`
- Reference (read only): `frontend/src/ui/ErrorBoundary.jsx`

**Step 1: Read ErrorBoundary.jsx**

Read `frontend/src/ui/ErrorBoundary.jsx` to understand the API. It likely exports a default class component with `fallback` or `fallbackRender` prop.

**Step 2: Read POSRedesign.jsx top section**

Read lines 1-40 to see existing imports and the component entry point.

**Step 3: Add import and wrap POSContent**

Add the import at the top of `POSRedesign.jsx`:
```javascript
import ErrorBoundary from "../../ui/ErrorBoundary";
```

Find where `POSContent` renders its main layout (the outermost JSX element it returns) and wrap it:

```jsx
// Find the return statement inside POSContent (or the default export)
// and wrap the outermost element:

return (
  <ErrorBoundary
    fallback={
      <div className="flex h-screen items-center justify-center bg-(--color-bg)">
        <div className="text-center p-8">
          <h2 className="text-xl font-semibold text-(--color-text) mb-2">POS encountered an error</h2>
          <p className="text-(--color-text-muted) mb-4">Please refresh the page to continue</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-(--color-primary) text-white rounded-lg"
          >
            Reload POS
          </button>
        </div>
      </div>
    }
  >
    {/* existing POS JSX */}
  </ErrorBoundary>
);
```

> **Note:** Check `ErrorBoundary.jsx` for the exact prop name — it may be `fallback`, `fallbackRender`, or `renderFallback`. Use whatever the component expects.

**Step 4: Verify no context issues**

The `POSProvider` wraps `POSContent` (or vice versa). Ensure:
- `ErrorBoundary` is INSIDE `POSProvider` so the fallback can still access context if needed
- OR the fallback UI is simple enough to not need context (the reload button above doesn't need it)

**Step 5: Test**

In browser dev tools, temporarily throw inside a POS child component:
```javascript
throw new Error("test crash");
```
Verify the fallback UI appears instead of a white screen.

**Step 6: Commit**
```bash
git add frontend/src/pages/redesign/POSRedesign.jsx
git commit -m "fix: wrap POS in ErrorBoundary to prevent full-screen crash (#3)"
```

---

## Task 4: Missing database indexes (#4)

**Files:**
- Modify: `backend/schema-pg.sql` (add CREATE INDEX statements)
- Modify: `backend/migrate-pg.js` (add migration v13 block)

**Step 1: Read the current index section in schema-pg.sql**

Grep for all existing indexes:
```bash
grep -n "CREATE.*INDEX" backend/schema-pg.sql
```

Note the pattern used (e.g., `CREATE INDEX IF NOT EXISTS idx_name ON table (col);`).

**Step 2: Read migrate-pg.js to understand migration version structure**

Grep for the latest version block:
```bash
grep -n "version.*12\|v12\|case 12" backend/migrate-pg.js | head -10
```

Read the surrounding block to understand the pattern — likely `if (currentVersion < 13) { ... }` or a switch/case.

**Step 3: Add indexes to schema-pg.sql**

Add these after the existing indexes section:

```sql
-- Performance indexes (migration v13)
-- sales table
CREATE INDEX IF NOT EXISTS idx_sales_outlet_id ON sales (outlet_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales (employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales (invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales (voided) WHERE voided = false;

-- sale_items table
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);

-- products table
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products (deleted_at) WHERE deleted_at IS NULL;

-- customers table
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile) WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email) WHERE email IS NOT NULL;

-- cash_shifts table
CREATE INDEX IF NOT EXISTS idx_cash_shifts_outlet_status ON cash_shifts (outlet_id, status);

-- returns table
CREATE INDEX IF NOT EXISTS idx_returns_original_sale_id ON returns (original_sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns (created_at DESC);
```

**Step 4: Add migration v13 block in migrate-pg.js**

Find the v12 migration block and add v13 after it, following the exact same pattern.

> **Note:** This v13 migration is shared with Task 7 (#13 return variant validation) — it also adds `variant_id` to `return_items`. Implement both in the same migration block.

```javascript
// After the v12 block:
if (currentVersion < 13) {
  console.log("Applying migration v13: performance indexes + return_items variant_id...");
  await client.query(`
    -- Performance indexes (Task 4, bug #4)
    CREATE INDEX IF NOT EXISTS idx_sales_outlet_id ON sales (outlet_id);
    CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales (employee_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales (invoice_number);
    CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales (voided) WHERE voided = false;
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku) WHERE sku IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products (deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile) WHERE mobile IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email) WHERE email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cash_shifts_outlet_status ON cash_shifts (outlet_id, status);
    CREATE INDEX IF NOT EXISTS idx_returns_original_sale_id ON returns (original_sale_id);
    CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns (created_at DESC);

    -- Return variant tracking (Task 7, bug #13)
    ALTER TABLE return_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id);
  `);
  await client.query(
    "UPDATE schema_version SET version = 13, updated_at = NOW()"
  );
  currentVersion = 13;
  console.log("Migration v13 complete.");
}
```

> **Gotcha:** Read the migrate-pg.js version update pattern carefully — some use `INSERT ... ON CONFLICT`, others use `UPDATE`. Copy the exact pattern from v12.

**Step 5: Run migration locally**

```bash
cd backend
node migrate-pg.js
# Expected output: "Applying migration v13: performance indexes..."
#                  "Migration v13 complete."
```

**Step 6: Verify indexes created**

```bash
# Connect to local Postgres and check:
psql $DATABASE_URL -c "\di idx_sales*"
# Expected: list of new sales indexes
```

**Step 7: Update CLAUDE.md migration version**

In `CLAUDE.md`, find the line:
```
- **Current version**: 12
```
Change to:
```
- **Current version**: 13 (v13: performance indexes — sales, sale_items, products, customers, cash_shifts, returns; return_items variant_id column)
```

**Step 8: Commit**
```bash
git add backend/schema-pg.sql backend/migrate-pg.js CLAUDE.md
git commit -m "fix: add missing performance indexes via migration v13 (#4)"
```

---

## Task 5: Variant stock drift on void (#12)

**Files:**
- Modify: `backend/routes/sales.js` ~line 220-260 (void handler)
- Modify: `backend/routes/inventory.js` ~line 49 (transfers) and ~line 207 (adjustments)

**Step 1: Read void logic in sales.js**

Read `backend/routes/sales.js` lines 200-280. Find the void transaction block that restores `outlet_stock` but skips `product_variants`.

**Step 2: Fix void to restore variant stock**

Inside the void transaction, after restoring `outlet_stock`, add variant stock restore:

```javascript
// Existing (inside transaction):
for (const item of items) {
  await client.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
    [item.product_id, sale.outlet_id, item.quantity, item.quantity]
  );
  
  // ADD THIS: restore variant stock if item has a variant
  if (item.variant_id) {
    await client.query(
      `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
      [item.quantity, item.variant_id]
    );
  }
}
```

> **Gotcha:** The `sale_items` query that fetches `items` must include `variant_id`. Check the SELECT query above the loop — if it doesn't include `variant_id`, add it: `SELECT product_id, quantity, variant_id FROM sale_items WHERE sale_id = $1`.

**Step 3: Read transfers logic in inventory.js**

Read `backend/routes/inventory.js` lines 30-100. Find the transfer POST handler. Check if it touches `product_variants.stock` — if not, add it.

Transfers move stock between outlets. If a variant product is transferred:
```javascript
// After updating outlet_stock for both from/to outlets,
// product_variants.stock should NOT change (it represents total pool, not per-outlet)
// → Transfers are actually CORRECT — variant.stock is a global pool, outlet_stock is per-outlet
// → Only need to verify this assumption by reading the code
```

> **Insight:** If `product_variants.stock` is a global pool (not per-outlet), then transfers (which move between outlets) don't need to touch it. Only sales/voids/returns do. Read the code to confirm before making changes.

**Step 4: Read adjustments logic in inventory.js**

Read `backend/routes/inventory.js` lines 195-260. Find the adjustment POST handler.

Stock adjustments change quantity by a delta (positive = add, negative = remove). If adjusting a variant product:

```javascript
// Check if adjustment handler updates product_variants.stock
// If it only updates outlet_stock and the product has a variant_id, add:
if (adjustment.variant_id) {
  await client.query(
    `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
    [delta, adjustment.variant_id]
  );
}
```

> **Only add this if the adjustment form accepts `variant_id` and the intent is to adjust a specific variant's global pool.** Read the frontend adjustment form to understand what data is submitted.

**Step 5: Test void of variant sale**

1. Create a product with 2 variants (e.g., Red/Blue), stock = 5 each
2. Make a sale of 2x Red variant
3. Check: `product_variants.stock` for Red = 3, `outlet_stock` = 3
4. Void the sale
5. Check: `product_variants.stock` for Red should = 5, `outlet_stock` should = 5

**Step 6: Commit**
```bash
git add backend/routes/sales.js backend/routes/inventory.js
git commit -m "fix: restore product_variants.stock on void and adjustments (#12)"
```

---

## Task 6: Backup/restore broken (#11)

**Files:**
- Modify: `frontend/src/pages/redesign/BackupRestoreRedesign.jsx` lines ~67, ~90, ~150
- Modify: `backend/routes/barcode-expenses.js` line ~441 (multer field name — verify it really is here and not in a dedicated backup route file)

**Step 1: Verify the backup route file**

The ROADMAP points to `barcode-expenses.js` line 441 but this seems odd. First verify:
```bash
grep -rn "backup_file\|multer.*backup\|single.*backup" backend/routes/
```
Find exactly which file handles `/api/backup/restore` and what multer field name it uses.

**Step 2: Fix frontend form field name**

Read `BackupRestoreRedesign.jsx` lines 55-110. Find:
```javascript
formData.append("backup", file);
```
Change to:
```javascript
formData.append("backup_file", file);
```

**Step 3: Fix frontend download label/extension**

Read lines 55-80. Find where the filename is set for the download:
```javascript
// Current (wrong):
a.download = `sanopos-backup-${date}.sqlite`;
// or text: "SQLite file"

// Fix to:
a.download = `sanopos-backup-${date}.pgdump`;
// Update any UI text from "SQLite" to "Postgres backup"
```

Also find and fix any UI label that says "SQLite" — change to "Postgres backup" or just "backup file".

**Step 4: Verify backend multer config**

Read the backend restore route. If the multer config says `.single("backup_file")` it's correct — the frontend was the problem. If it says `.single("backup")` then fix the backend instead.

The rule: **make frontend and backend agree on `"backup_file"`** (matches the Postgres `pg_restore` naming convention).

**Step 5: Test**

1. Go to Backup & Restore page
2. Click Download Backup — verify file downloads with `.pgdump` extension
3. Upload the downloaded file
4. Verify no "backup_file is required" error

**Step 6: Commit**
```bash
git add frontend/src/pages/redesign/BackupRestoreRedesign.jsx
git commit -m "fix: backup field name mismatch and sqlite label for postgres (#11)"
```

---

## Task 7: Return variant validation weak (#13)

**Files:**
- Modify: `backend/routes/returns.js` lines ~42-66 (validation query and check loop), line ~94 (return_items INSERT)
- Modify: `backend/schema-pg.sql` — add `variant_id` column to `return_items`
- Modify: `backend/migrate-pg.js` — add column in migration v13 (same migration as indexes in Task 4)

**IMPORTANT:** `return_items` table currently has NO `variant_id` column (schema-pg.sql line 330-336). The INSERT at line 94 writes without `variant_id`, so even when the client sends a `variant_id`, it's not persisted — making variant-level return reporting impossible and allowing wrong-variant restocking.

**Step 0: Add `variant_id` column to return_items**

In `backend/schema-pg.sql`, add the column to the `return_items` CREATE TABLE:
```sql
CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL,
  refund_price NUMERIC(12,2) NOT NULL
);
```

In `backend/migrate-pg.js` (the same v13 block from Task 4), add:
```sql
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id);
```

**Step 0b: Fix the INSERT to include variant_id**

In `backend/routes/returns.js` line ~94, change:
```javascript
// BEFORE:
"INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES ($1, $2, $3, $4)",
[retId, item.product_id, item.quantity, item.refund_price],

// AFTER:
"INSERT INTO return_items (return_id, product_id, variant_id, quantity, refund_price) VALUES ($1, $2, $3, $4, $5)",
[retId, item.product_id, item.variant_id || null, item.quantity, item.refund_price],
```

**Step 1: Read the current validation query**

Read `backend/routes/returns.js` lines 35-115. The current query is:
```sql
SELECT product_id, SUM(quantity) as sold_qty 
FROM sale_items WHERE sale_id = $1 
GROUP BY product_id
```

**Step 2: Change query to group by variant_id too**

```javascript
const { rows: saleItems } = await db.query(
  `SELECT product_id, variant_id, SUM(quantity) AS sold_qty 
   FROM sale_items WHERE sale_id = $1 
   GROUP BY product_id, variant_id`,
  [original_sale_id],
);
```

**Step 3: Update the sold map key**

The map key needs to include variant_id:
```javascript
// BEFORE:
const soldMap = {};
saleItems.forEach((r) => { soldMap[r.product_id] = Number(r.sold_qty); });

// AFTER:
const soldMap = {};
saleItems.forEach((r) => {
  // Key: "productId_variantId" or "productId_null" for non-variant
  const key = `${r.product_id}_${r.variant_id ?? "null"}`;
  soldMap[key] = Number(r.sold_qty);
});
```

**Step 4: Update the validation check loop**

```javascript
// BEFORE:
for (const item of items) {
  if (!(item.product_id in soldMap)) {
    return res.status(400).json({ error: `Product ${item.product_id} was not part of the original sale` });
  }
  if (item.quantity > soldMap[item.product_id]) {
    return res.status(400).json({ error: `Return quantity ${item.quantity} for product ${item.product_id} exceeds sold quantity ...` });
  }
}

// AFTER:
for (const item of items) {
  const key = `${item.product_id}_${item.variant_id ?? "null"}`;
  if (!(key in soldMap)) {
    return res.status(400).json({
      error: item.variant_id
        ? `Variant ${item.variant_id} of product ${item.product_id} was not part of the original sale`
        : `Product ${item.product_id} was not part of the original sale`,
    });
  }
  if (item.quantity > soldMap[key]) {
    return res.status(400).json({
      error: `Return quantity ${item.quantity} exceeds sold quantity for this variant`,
    });
  }
}
```

**Step 5: Test**

1. Make a sale: 5x Red variant + 5x Blue variant of same product
2. Try returning 6x Red — should get 400 "exceeds sold quantity"
3. Try returning 5x Red — should succeed
4. Try returning product with wrong variant_id — should get 400 "was not part of the original sale"

**Step 6: Commit**
```bash
git add backend/routes/returns.js
git commit -m "fix: validate return qty per variant_id not just product_id (#13)"
```

---

## Task 8: Shopify reconciliation field mismatch (#6)

**Files:**
- Modify: `backend/routes/shopify/reconciliation.js` line ~141
- Modify: `frontend/src/pages/shopify/ShopifyReconciliation.jsx` lines ~183, ~308

**Step 1: Read backend reconciliation.js lines 120-160**

Find the query/object that builds rows. It uses `local_qty` and `external_qty`.

**Step 2: Choose a direction — align backend to frontend or vice versa**

Frontend uses `pos_qty` / `shopify_qty` which is more descriptive. Fix the backend to alias the columns:

```javascript
// In the SELECT query or row building, alias the fields:
// Option A: SQL alias in query:
`SELECT ..., local_qty AS pos_qty, external_qty AS shopify_qty, ...`

// Option B: In the JS object building:
rowsToInsert.push({
  ...
  pos_qty: localQty,       // was: local_qty
  shopify_qty: externalQty, // was: external_qty
  diff,
  status,
});
```

**Step 3: Also fix the DB column names if they're stored with old names**

Read the `inventory_reconciliation` table DDL:
```bash
grep -A 20 "CREATE TABLE.*inventory_reconciliation" backend/schema-pg.sql
```

If DB columns are `local_qty`/`external_qty`, then alias them in the SELECT response — don't rename the columns (that needs a migration). Just alias in the API response:

```javascript
// In the GET /reconciliation endpoint that returns rows:
const rows = result.rows.map(r => ({
  ...r,
  pos_qty: r.local_qty,
  shopify_qty: r.external_qty,
}));
res.json({ rows });
```

**Step 4: Check ShopifyReconciliation.jsx lines 175-320**

Verify it reads `r.pos_qty` and `r.shopify_qty`. If it does, only the backend fix is needed. If it also references `local_qty`/`external_qty` anywhere, fix those too.

**Step 5: Test**

Feature is behind `shopify` feature flag. To test:
1. Enable shopify feature flag for a tenant via admin or DB
2. Go to Shopify integration page → Reconciliation tab
3. Verify qty columns show numbers instead of `undefined`/`NaN`

**Step 6: Commit**
```bash
git add backend/routes/shopify/reconciliation.js frontend/src/pages/shopify/ShopifyReconciliation.jsx
git commit -m "fix: align reconciliation field names local_qty→pos_qty, external_qty→shopify_qty (#6)"
```

---

## Task 9: Kiosk feature flags 401 (#8)

**Files:**
- Modify: `frontend/src/pages/redesign/KioskRedesign.jsx` lines ~64-76
- Modify: `backend/routes/registerAllRoutes.js` lines ~295-310 (OR just fix frontend)

**Step 1: Read the kiosk fetch code**

Read `KioskRedesign.jsx` lines 60-85. The current code:
```javascript
fetch(`${API}/feature-flags?tenant=${tenantSlug}`)
  .then((r) => r.json())
  .catch(() => ({ flags: [] }))
```

**Step 2: Understand why it gets 401**

The `/api/feature-flags` endpoint requires `x-employee-id` header. Kiosk is unauthenticated — no employee JWT exists, so the header is missing → 401.

**Step 3: Option A — create a public kiosk-specific endpoint**

Add to `registerAllRoutes.js` (before auth middleware, alongside other pre-auth routes):

```javascript
// Public endpoint: kiosk feature flags (only returns kiosk-relevant flags)
app.get("/api/kiosk/feature-flags", async (req, res) => {
  try {
    const db = await getKioskDb(req); // resolve tenant DB same as other kiosk endpoints
    const { rows } = await db.query(
      `SELECT key, enabled FROM feature_flags WHERE key = 'kiosk_context_locked'`
    );
    res.json({ flags: rows });
  } catch (err) {
    res.json({ flags: [] }); // safe fallback
  }
});
```

**Step 3 alternative — Option B (simpler): handle 401 gracefully in frontend**

The `.catch(() => ({ flags: [] }))` already catches network errors but NOT 401 (which is a successful HTTP response with error body). Fix the catch to handle this:

```javascript
fetch(tenantSlug ? `${API}/feature-flags?tenant=${tenantSlug}` : `${API}/feature-flags`)
  .then((r) => {
    if (!r.ok) return { flags: [] }; // handle 401 gracefully
    return r.json();
  })
  .catch(() => ({ flags: [] }))
```

> **Recommendation:** Option B is 2 lines and zero risk. Option A adds a new endpoint. Use Option B unless `kiosk_context_locked` actually needs to work (currently it silently falls back to `false` meaning the lock never activates — functionally same as Option B).

**Step 4: Commit**
```bash
git add frontend/src/pages/redesign/KioskRedesign.jsx
git commit -m "fix: kiosk feature flags handle 401 gracefully instead of silent fail (#8)"
```

---

## Task 10: Approvals page not feature-flag gated in frontend (#9)

**Files:**
- Modify: `frontend/src/App.jsx` lines ~387-394

**Step 1: Read the approvals route**

Read `App.jsx` lines 380-400. The route is:
```jsx
<Route
  path="/approvals"
  element={
    <RequirePerm perm="manage_orders">
      <ApprovalsRedesign />
    </RequirePerm>
  }
/>
```

**Step 2: Add feature flag gate**

The `approvals` feature flag gates the backend. Add a frontend gate too. Read how other feature-flagged routes are gated in App.jsx:
```bash
grep -n "RequireFeature\|requireFeature\|feature.*flag" frontend/src/App.jsx | head -20
```

Apply the same pattern:
```jsx
<Route
  path="/approvals"
  element={
    <RequireFeature flag="approvals">
      <RequirePerm perm="manage_orders">
        <ApprovalsRedesign />
      </RequirePerm>
    </RequireFeature>
  }
/>
```

> If `RequireFeature` doesn't exist as a component, check `frontend/src/auth/` or `frontend/src/ui/` for how feature flags are consumed in JSX. It may be `useFeatureFlag("approvals")` in a wrapper, or the component may check it internally. If no gate component exists, a simple inline check is fine:

```jsx
element={
  <RequirePerm perm="manage_orders">
    <FeatureGatedPage flag="approvals">
      <ApprovalsRedesign />
    </FeatureGatedPage>
  </RequirePerm>
}
```

**Step 3: Commit**
```bash
git add frontend/src/App.jsx
git commit -m "fix: gate approvals route on approvals feature flag in frontend (#9)"
```

---

## Task 11: Reconciliation approval endpoint missing (#7/#15)

**Files:**
- Modify: `backend/routes/tier4/approvals.js`

**Step 1: Read approvals.js fully**

Read `backend/routes/tier4/approvals.js` to understand existing patterns. The file handles `purchase_order` and `transfer` approvals. Add `reconciliation` approval.

**Step 2: Add the reconciliation approve-fix endpoint**

Following the existing pattern for other approval types:

```javascript
// POST /api/reconciliation/inventory/:id/approve-fix
router.post(
  "/api/reconciliation/inventory/:id/approve-fix",
  requireFeature("approvals"),
  requireAnyPerm(["manage_inventory", "all_access"]),
  async (req, res) => {
    const { id } = req.params;
    const { mode } = req.body; // "push_to_shopify" or "pull_from_shopify"
    const employeeId = req.employee?.id;

    try {
      // 1. Get the reconciliation row
      const { rows: [row] } = await db.query(
        `SELECT * FROM inventory_reconciliation WHERE id = $1`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Reconciliation row not found" });

      // 2. Apply the fix based on mode
      await db.transaction(async (client) => {
        if (mode === "push_to_shopify") {
          // Local wins — mark as resolved, Shopify sync handled separately
          await client.query(
            `UPDATE inventory_reconciliation 
             SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
             WHERE id = $2`,
            [employeeId, id]
          );
        } else if (mode === "pull_from_shopify") {
          // Shopify wins — update outlet_stock to match external_qty
          await client.query(
            `UPDATE outlet_stock SET quantity = $1 
             WHERE product_id = $2 AND outlet_id = $3`,
            [row.external_qty, row.product_id, row.outlet_id]
          );
          await client.query(
            `UPDATE inventory_reconciliation 
             SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
             WHERE id = $2`,
            [employeeId, id]
          );
        } else {
          throw new Error("Invalid mode");
        }
      });

      res.json({ message: "Reconciliation fix applied" });
    } catch (err) {
      console.error("Reconciliation approve-fix error:", err);
      res.status(500).json({ error: "Failed to apply fix" });
    }
  }
);
```

**Step 3: Verify it's registered**

Check `registerAllRoutes.js` to see how `tier4/approvals.js` is mounted. It should already be registered — the endpoint just needs to exist in the file.

**Step 4: Commit**
```bash
git add backend/routes/tier4/approvals.js
git commit -m "fix: add missing reconciliation approve-fix endpoint (#7/#15)"
```

---

## Task 12: Shopify bulk fix returns 501 (#14)

**Files:**
- Modify: `backend/routes/shopify/reconciliation.js` lines ~290-310

**Step 1: Read bulk action handler**

Read `backend/routes/shopify/reconciliation.js` lines 270-320. Find the bulk action handler that switches on `action`. The `ignore` action works — `fix` returns 501.

**Step 2: Implement bulk fix**

Replace the 501 stub with a real implementation. Bulk fix needs a `mode` parameter (`pos_wins` or `shopify_wins`):

```javascript
else if (action === "fix") {
  const { mode } = req.body; // "pos_wins" or "shopify_wins"
  if (!mode || !["pos_wins", "shopify_wins"].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'pos_wins' or 'shopify_wins'" });
  }

  let fixedCount = 0;
  await db.transaction(async (client) => {
    if (mode === "shopify_wins") {
      // For each row, update outlet_stock to match external_qty
      const { rows } = await client.query(
        `SELECT product_id, outlet_id, external_qty 
         FROM inventory_reconciliation WHERE id = ANY($1::int[])`,
        [ids]
      );
      for (const row of rows) {
        await client.query(
          `UPDATE outlet_stock SET quantity = $1 
           WHERE product_id = $2 AND outlet_id = $3`,
          [row.external_qty, row.product_id, row.outlet_id]
        );
      }
    }
    // pos_wins: no stock changes needed — Shopify sync will push our values

    // Mark all as resolved
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
    const result = await client.query(
      `UPDATE inventory_reconciliation 
       SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
       WHERE id IN (${placeholders})`,
      [employeeId, ...ids]
    );
    fixedCount = result.rowCount;
  });

  logActionHistory(req, "reconciliation_bulk_fix", `Fixed ${fixedCount} rows (mode: ${mode})`);
  res.json({ message: `Fixed ${fixedCount} items` });
}
```

**Step 3: Verify frontend sends `mode`**

Read `ShopifyReconciliation.jsx` around the bulk action buttons. Check what the "POS Wins" / "Shopify Wins" buttons send in the request body. If they don't send `mode`, add it:
```javascript
// In the bulk action handler:
body: JSON.stringify({ ids: selectedIds, action: "fix", mode: "pos_wins" })
// or "shopify_wins"
```

**Step 4: Commit**
```bash
git add backend/routes/shopify/reconciliation.js
git commit -m "fix: implement Shopify bulk fix endpoint, replace 501 stub (#14)"
```

---

## Final: Push branch

After all 12 tasks are committed:

```bash
git checkout -b fix/production-readiness-audit
git push -u origin fix/production-readiness-audit
```

> Per project git workflow: **do NOT open a PR** — user merges manually.

---

## Execution Order Recommendation

Group by risk/dependency:

**Group A — Quick wins, zero risk (do first):**
- Task 3: POS ErrorBoundary (frontend only, 5 min)
- Task 6: Backup field name (2-line fix, 5 min)
- Task 9: Kiosk 401 graceful handle (2-line fix, 5 min)
- Task 10: Approvals feature gate (5-line fix, 5 min)
- Task 8: Shopify field mismatch (alias rename, 10 min)

**Group B — Backend logic, moderate complexity:**
- Task 1: Auth on GET routes (repetitive but safe, 20 min)
- Task 7: Return variant validation (query + map key change, 15 min)
- Task 11: Reconciliation endpoint (new endpoint, 20 min)
- Task 12: Shopify bulk fix (replace stub, 15 min)

**Group C — High impact, needs care:**
- Task 4: DB indexes + migration (schema change, run migrate-pg.js, 20 min)
- Task 5: Variant stock drift (transaction logic, 20 min)
- Task 2: Stock race condition (transaction restructure, 30 min)

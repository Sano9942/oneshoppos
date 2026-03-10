# Phase 3 Remaining Items — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 5 remaining Phase 3 items: Mobile POS layout, IP allowlisting, shrinkage report, customer-facing display, API key revocation.

**Architecture:** 4 parallel agents on a single feature branch `feature/phase3-remaining`. Each agent owns non-overlapping files. One migration file (migrate74.js) for token revocation.

**Tech Stack:** React + Tailwind CSS v4 (frontend responsive), Express middleware (backend security), SQLite (shrinkage SQL + migration), in-memory Map (customer display state).

**Branch:** `feature/phase3-remaining` (created from `main`)

**Tailwind v4 rules:** `shrink-0` not `flex-shrink-0`, `grow` not `flex-grow`, `(--css-var)` not `[var(--css-var)]`, `bg-linear-to-br` not `bg-gradient-to-br`, `z-200` not `z-[200]`.

**Timestamp rules:** UTC columns use `fmtUtcDateTime`/`toUtcStart`/`toUtcEnd`. LOCAL columns use `fmtLocalDateTime`/`parseLocalDate`. Never raw `new Date(dt)` on DB values.

---

## Pre-flight

### Step 0: Create feature branch

```bash
cd d:/newprojects/oneshoppos
git checkout main && git pull origin main
git checkout -b feature/phase3-remaining
```

---

## Agent A: Mobile/Tablet POS Layout

**Files to modify (all in `frontend/src/pages/redesign/pos/`):**
- `POSRedesign.jsx` — add mobile tab state + responsive wrapper
- `POSHeader.jsx` — compact mobile header
- `POSSidebar.jsx` — hide on mobile, show as tab content
- `POSCartTable.jsx` — 3-col mobile table
- `POSSearchArea.jsx` — stack on mobile
- `POSSubHeader.jsx` — compact mobile layout

**No backend changes. No migration.**

### Task A1: POSRedesign.jsx — Mobile tab wrapper

**File:** `frontend/src/pages/redesign/pos/POSRedesign.jsx` (currently ~line 28-50)

Add `activeTab` state and a mobile tab bar. Desktop layout unchanged.

**Changes:**
1. Add `import { useState } from "react"` (if not already)
2. Add `const [mobileTab, setMobileTab] = useState("cart")` inside component
3. Add a mobile-only tab bar below header: `<div className="flex md:hidden ...">`
4. Wrap main area + sidebar in responsive container:
   - Desktop: `<div className="hidden md:flex flex-1 overflow-hidden">` (existing layout)
   - Mobile: `<div className="flex md:hidden flex-1 flex-col overflow-hidden">` renders active tab content
5. Add sticky bottom pay button on mobile (always visible)

**Tab bar design:**
```jsx
{/* Mobile tab bar */}
<div className="flex md:hidden border-b border-slate-200 bg-white">
  {[
    { id: "cart", label: "Cart", icon: ShoppingCart },
    { id: "search", label: "Search", icon: Search },
    { id: "pay", label: "Pay", icon: CreditCard },
  ].map((tab) => (
    <button
      key={tab.id}
      onClick={() => setMobileTab(tab.id)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
        mobileTab === tab.id
          ? "text-indigo-600 border-b-2 border-indigo-600"
          : "text-slate-500"
      }`}
    >
      <tab.icon size={16} />
      {tab.label}
    </button>
  ))}
</div>
```

**Mobile content switcher:**
```jsx
{/* Mobile content */}
<div className="flex md:hidden flex-1 flex-col overflow-hidden">
  {mobileTab === "cart" && (
    <div className="flex-1 flex flex-col p-3 overflow-hidden">
      <POSSubHeader />
      <POSCartTable />
    </div>
  )}
  {mobileTab === "search" && (
    <div className="flex-1 flex flex-col p-3 overflow-hidden">
      <POSSearchArea />
    </div>
  )}
  {mobileTab === "pay" && (
    <div className="flex-1 overflow-hidden">
      <POSSidebar />
    </div>
  )}
</div>
```

**Sticky mobile pay button (visible on cart + search tabs):**
```jsx
{mobileTab !== "pay" && (
  <div className="md:hidden p-3 border-t border-slate-200 bg-white">
    <button
      onClick={() => setMobileTab("pay")}
      className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-base"
    >
      Pay {currency} {cartTotal}
    </button>
  </div>
)}
```

### Task A2: POSHeader.jsx — Mobile compact

**File:** `frontend/src/pages/redesign/pos/POSHeader.jsx`

**Changes:**
- Reduce padding on mobile: `px-5 py-2.5` → `px-3 py-2 md:px-5 md:py-2.5`
- Hide store name text on mobile, show icon only: `<span className="hidden md:inline">{storeName}</span>`
- Hide Dashboard/Logout text labels: `<span className="hidden md:inline">Dashboard</span>`
- Keep icons always visible

### Task A3: POSCartTable.jsx — Responsive columns

**File:** `frontend/src/pages/redesign/pos/POSCartTable.jsx`

**Changes:**
- Hide "Unit Price" and "Action" column headers on mobile: `<th className="hidden md:table-cell">Unit Price</th>`
- Hide corresponding `<td>` cells: `<td className="hidden md:table-cell">...</td>`
- Product column on mobile shows name + price below it (stacked)
- Qty column stays (with +/- buttons)
- Total column stays
- Delete action moves into a swipe-left or long-press (or just show a small × icon inline on mobile)

### Task A4: POSSearchArea.jsx — Stack on mobile

**File:** `frontend/src/pages/redesign/pos/POSSearchArea.jsx`

**Changes:**
- Change `grid grid-cols-3 gap-2` → `grid grid-cols-1 md:grid-cols-3 gap-2`
- That's it — single CSS class change

### Task A5: POSSubHeader.jsx — Mobile compact

**File:** `frontend/src/pages/redesign/pos/POSSubHeader.jsx`

**Changes:**
- Hide date display on mobile: `<span className="hidden md:inline">{dateStr}</span>`
- Reduce heading size: `text-2xl` → `text-lg md:text-2xl`
- Stack Park/Parked buttons below heading on mobile: `flex-wrap`

### Task A6: POSSidebar.jsx — Mobile full-width

**File:** `frontend/src/pages/redesign/pos/POSSidebar.jsx`

**Changes:**
- Root div: change `w-80 shrink-0` → `w-full md:w-80 md:shrink-0`
- On mobile (when rendered as tab content), it fills full width
- No other changes needed — internal layout already uses `w-full`

### Task A7: Commit

```bash
git add frontend/src/pages/redesign/pos/
git commit -m "feat: responsive mobile/tablet POS layout with tab navigation"
```

---

## Agent B: IP Allowlisting + API Key Revocation

**Files:**
- `backend/index.js` — trust proxy + revocation middleware
- `backend/routes/admin.js` — IP allowlist middleware
- `backend/jwt-auth.js` — add jti to access tokens
- `backend/routes/employees.js` — revoke endpoints
- `backend/migrate74.js` — new table + column
- `backend/run_migrations.js` — register migrate74
- `backend/tests/helpers/seedSchema.js` — add new table/column
- `frontend/src/pages/redesign/EmployeesRedesign.jsx` — revoke button

### Task B1: IP allowlist middleware in admin.js

**File:** `backend/routes/admin.js`

Add CIDR matching function and middleware BEFORE `requireSuperAdmin` (after line 90).

```javascript
// ── IP allowlist ──────────────────────────────────────────────────────────
const net = require("net");

function ipInCidr(ip, cidr) {
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bits] = cidr.split("/");
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1) >>> 0;
  const ipNum = ip.split(".").reduce((s, o) => (s << 8) + parseInt(o, 10), 0) >>> 0;
  const rangeNum = range.split(".").reduce((s, o) => (s << 8) + parseInt(o, 10), 0) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function requireAllowedIp(req, res, next) {
  const raw = process.env.ADMIN_ALLOWED_IPS;
  if (!raw || !raw.trim()) return next(); // no restriction
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const clientIp = req.ip.replace(/^::ffff:/, ""); // strip IPv6-mapped prefix
  if (allowed.some((cidr) => ipInCidr(clientIp, cidr))) return next();
  return res.status(403).json({ error: "IP not allowed" });
}
```

Apply `requireAllowedIp` to ALL admin routes. Change every route from:
```javascript
app.post("/api/admin/...", requireSuperAdmin, async (req, res) => {
```
to:
```javascript
app.post("/api/admin/...", requireAllowedIp, requireSuperAdmin, async (req, res) => {
```

Exception: `POST /api/admin/auth/login` gets `requireAllowedIp` BEFORE `authLimiter`:
```javascript
app.post("/api/admin/auth/login", requireAllowedIp, authLimiter, async (req, res) => {
```

### Task B2: Trust proxy in index.js

**File:** `backend/index.js` — add after `app.use(cors(...))` (around line 190):

```javascript
app.set("trust proxy", 1);
```

This is needed for `req.ip` to return the real client IP behind Railway's reverse proxy.

### Task B3: migrate74.js — revoked_tokens table + employees column

**File:** `backend/migrate74.js` (new)

```javascript
// migrate74.js — Token revocation table + bulk revoke column on employees
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_jti TEXT UNIQUE NOT NULL,
      employee_id INTEGER,
      revoked_by INTEGER,
      reason TEXT,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function (err) {
    if (err) console.error("[migrate74] Error creating revoked_tokens:", err.message);
    else console.log("[migrate74] revoked_tokens table ready.");
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti)`, function (err) {
    if (err) console.error("[migrate74] Error creating index:", err.message);
  });

  db.run(`ALTER TABLE employees ADD COLUMN tokens_revoked_before DATETIME`, function (err) {
    if (err && !err.message.includes("duplicate column")) {
      console.error("[migrate74] Error adding column:", err.message);
    } else if (!err) {
      console.log("[migrate74] Added tokens_revoked_before to employees.");
    }
    db.close((closeErr) => {
      if (closeErr) console.error("[migrate74] Close error:", closeErr.message);
      else console.log("[migrate74] Done.");
    });
  });
});
```

### Task B4: Register migrate74 in run_migrations.js

**File:** `backend/run_migrations.js` — add `"migrate74.js"` after `"migrate73.js"` in the array.

### Task B5: Update seedSchema.js

**File:** `backend/tests/helpers/seedSchema.js`

Add to the schema creation:
1. `revoked_tokens` table (same CREATE TABLE as migrate74)
2. `tokens_revoked_before DATETIME` column in `employees` CREATE TABLE
3. Index on `token_jti`

### Task B6: Add jti to signAccessToken

**File:** `backend/jwt-auth.js` — modify `signAccessToken` (line 21-27):

```javascript
function signAccessToken(payload, secret) {
  return jwt.sign(
    {
      tid: payload.tid, eid: payload.eid, rid: payload.rid,
      oid: payload.oid || null, scope: payload.scope || "full",
      jti: crypto.randomUUID(),
    },
    secret,
    { expiresIn: defaults.accessExpiresIn }
  );
}
```

This adds a unique ID to every access token. Existing tokens without `jti` still work (backward compatible — middleware skips check when no jti).

### Task B7: Revocation check middleware in index.js

**File:** `backend/index.js` — inside `loadTenantAndPerms` (the MT middleware), AFTER JWT decode succeeds, add:

```javascript
// Token revocation check
if (decoded.jti) {
  const revoked = await new Promise((resolve, reject) => {
    (IS_MULTI_TENANT ? dbProxy : db).get(
      "SELECT 1 FROM revoked_tokens WHERE token_jti = ?",
      [decoded.jti],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (revoked) {
    return res.status(401).json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
  }
}

// Bulk revocation check
if (decoded.eid && decoded.iat) {
  const emp = await new Promise((resolve, reject) => {
    (IS_MULTI_TENANT ? dbProxy : db).get(
      "SELECT tokens_revoked_before FROM employees WHERE id = ?",
      [decoded.eid],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
  if (emp && emp.tokens_revoked_before) {
    const revokedBefore = new Date(emp.tokens_revoked_before + "Z").getTime() / 1000;
    if (decoded.iat < revokedBefore) {
      return res.status(401).json({ error: "All sessions revoked", code: "TOKEN_REVOKED" });
    }
  }
}
```

**Important:** This only runs in `loadTenantAndPerms` (which only activates when `MULTI_TENANT=1`). In single-tenant mode, there's no JWT to decode so no revocation check. This is correct — single-tenant uses header-based auth.

### Task B8: Revoke endpoints in employees.js

**File:** `backend/routes/employees.js` — add two new endpoints after existing DELETE route:

```javascript
// POST /api/employees/:id/revoke-all-tokens — bulk revoke all sessions
app.post("/api/employees/:id/revoke-all-tokens", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  db.run(
    "UPDATE employees SET tokens_revoked_before = datetime('now') WHERE id = ?",
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Employee not found" });

      // Log to action_history
      db.run(
        `INSERT INTO action_history (employee_id, action_type, target_type, target_id, details)
         VALUES (?, 'revoke_tokens', 'employee', ?, ?)`,
        [req.headers["x-employee-id"], id, reason || "All sessions revoked"]
      );

      // Cleanup old revoked_tokens entries
      db.run("DELETE FROM revoked_tokens WHERE revoked_at < datetime('now', '-2 days')");

      res.json({ success: true, message: "All sessions revoked" });
    }
  );
});
```

### Task B9: Frontend — Revoke button in EmployeesRedesign.jsx

**File:** `frontend/src/pages/redesign/EmployeesRedesign.jsx`

Add a "Revoke All Sessions" button in the employee detail/action area. When clicked:
1. Show confirmation modal: "This will log out [name] from all devices. Continue?"
2. Optional reason text field
3. On confirm: `POST /api/employees/${id}/revoke-all-tokens` with `{ reason }`
4. Show success toast

### Task B10: Commit

```bash
git add backend/routes/admin.js backend/index.js backend/jwt-auth.js \
  backend/routes/employees.js backend/migrate74.js backend/run_migrations.js \
  backend/tests/helpers/seedSchema.js frontend/src/pages/redesign/EmployeesRedesign.jsx
git commit -m "feat: IP allowlisting for admin + API key revocation (migrate74)"
```

---

## Agent C: Stock Discrepancy / Shrinkage Report

**Files:**
- `backend/routes/reports/inventory.js` — new endpoint
- `frontend/src/pages/reports/ReportsInventory.jsx` — new tab
- `frontend/src/pages/Reports.jsx` — register tab

### Task C1: Backend shrinkage endpoint

**File:** `backend/routes/reports/inventory.js` — add BEFORE the final `return { buildForecastRows };` (line 1348):

```javascript
// Shrinkage / Stock Discrepancy Report
app.get("/api/reports/shrinkage", async (req, res) => {
  const tz = (req.company && req.company.timezone) || "Asia/Karachi";
  const { date_from, date_to, outlet_id, category_id, search } = req.query;

  if (!date_from || !date_to) {
    return res.status(400).json({ error: "date_from and date_to are required" });
  }

  const utcStart = toUtcStart(date_from, tz);
  const utcEnd = toUtcEnd(date_to, tz);

  // Build product/outlet filters
  const where = ["p.deleted_at IS NULL"];
  const params = [];
  applyOutletFilter(where, params, outlet_id);
  await applyInventoryProductFilters(where, params, { category_id, search });

  const sql = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.barcode, '') AS barcode,
      COALESCE(p.sku, '') AS sku,
      p.cost_price,
      o.id AS outlet_id,
      o.name AS outlet_name,
      os.quantity AS actual_qty,

      -- Sales in period
      COALESCE(sale_agg.total_sold, 0) AS sales_qty,
      -- Returns in period
      COALESCE(ret_agg.total_returned, 0) AS returns_qty,
      -- GRN purchases in period
      COALESCE(grn_agg.total_received, 0) AS purchases_qty,
      -- Stock adjustments in period
      COALESCE(adj_agg.total_adj, 0) AS adjustments_qty,
      -- Transfers in
      COALESCE(tin_agg.total_in, 0) AS transfers_in,
      -- Transfers out
      COALESCE(tout_agg.total_out, 0) AS transfers_out

    FROM outlet_stock os
    JOIN products p ON p.id = os.product_id
    JOIN outlets o ON o.id = os.outlet_id

    -- Sales
    LEFT JOIN (
      SELECT si.product_id, s.outlet_id, SUM(si.quantity) AS total_sold
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE s.timestamp >= ? AND s.timestamp < ?
      GROUP BY si.product_id, s.outlet_id
    ) sale_agg ON sale_agg.product_id = p.id AND sale_agg.outlet_id = o.id

    -- Returns
    LEFT JOIN (
      SELECT ri.product_id, r.outlet_id, SUM(ri.quantity) AS total_returned
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE r.timestamp >= ? AND r.timestamp < ?
      GROUP BY ri.product_id, r.outlet_id
    ) ret_agg ON ret_agg.product_id = p.id AND ret_agg.outlet_id = o.id

    -- GRN purchases
    LEFT JOIN (
      SELECT gi.product_id, g.outlet_id, SUM(gi.qty_received) AS total_received
      FROM grn_items gi
      JOIN goods_received_notes g ON g.id = gi.grn_id
      WHERE g.received_date >= ? AND g.received_date <= ?
      GROUP BY gi.product_id, g.outlet_id
    ) grn_agg ON grn_agg.product_id = p.id AND grn_agg.outlet_id = o.id

    -- Stock adjustments
    LEFT JOIN (
      SELECT sa.product_id, sa.outlet_id, SUM(sa.quantity_change) AS total_adj
      FROM stock_adjustments sa
      WHERE sa.timestamp >= ? AND sa.timestamp < ?
      GROUP BY sa.product_id, sa.outlet_id
    ) adj_agg ON adj_agg.product_id = p.id AND adj_agg.outlet_id = o.id

    -- Transfers in
    LEFT JOIN (
      SELECT it.product_id, it.to_outlet_id AS outlet_id, SUM(it.quantity) AS total_in
      FROM inventory_transfers it
      WHERE it.timestamp >= ? AND it.timestamp < ?
        AND COALESCE(it.reversed, 0) = 0
      GROUP BY it.product_id, it.to_outlet_id
    ) tin_agg ON tin_agg.product_id = p.id AND tin_agg.outlet_id = o.id

    -- Transfers out
    LEFT JOIN (
      SELECT it.product_id, it.from_outlet_id AS outlet_id, SUM(it.quantity) AS total_out
      FROM inventory_transfers it
      WHERE it.timestamp >= ? AND it.timestamp < ?
        AND COALESCE(it.reversed, 0) = 0
      GROUP BY it.product_id, it.from_outlet_id
    ) tout_agg ON tout_agg.product_id = p.id AND tout_agg.outlet_id = o.id

    WHERE ${where.join(" AND ")}
    ORDER BY p.name, o.name
    LIMIT 2000
  `;

  // Parameters: utcStart/utcEnd for sales, returns, adjustments, transfers (×2 for in/out)
  // GRN uses date strings (local-time column)
  const allParams = [
    utcStart, utcEnd,           // sales
    utcStart, utcEnd,           // returns
    date_from, date_to,         // GRN (local date column)
    utcStart, utcEnd,           // adjustments
    utcStart, utcEnd,           // transfers in
    utcStart, utcEnd,           // transfers out
    ...params,                  // product/outlet filters
  ];

  db.all(sql, allParams, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const items = rows.map((r) => {
      // Opening = actual - purchases - returns - transfers_in + sales + transfers_out - adjustments
      const opening = r.actual_qty - r.purchases_qty - r.returns_qty - r.transfers_in
        + r.sales_qty + r.transfers_out - r.adjustments_qty;
      // Expected = opening + purchases + returns + transfers_in - sales - transfers_out + adjustments
      const expected = opening + r.purchases_qty + r.returns_qty + r.transfers_in
        - r.sales_qty - r.transfers_out + r.adjustments_qty;
      const variance = r.actual_qty - expected;
      const varianceValue = variance * (r.cost_price || 0);

      return {
        product_id: r.product_id,
        product_name: r.product_name,
        barcode: r.barcode,
        sku: r.sku,
        outlet_id: r.outlet_id,
        outlet_name: r.outlet_name,
        opening_qty: opening,
        purchases_qty: r.purchases_qty,
        sales_qty: r.sales_qty,
        returns_qty: r.returns_qty,
        transfers_in: r.transfers_in,
        transfers_out: r.transfers_out,
        adjustments_qty: r.adjustments_qty,
        expected_qty: expected,
        actual_qty: r.actual_qty,
        variance,
        variance_value: Math.round(varianceValue * 100) / 100,
        cost_price: r.cost_price || 0,
      };
    });

    // Filter to only rows with non-zero variance (optional: include all)
    const totalShrinkageValue = items
      .filter((i) => i.variance < 0)
      .reduce((sum, i) => sum + i.variance_value, 0);

    res.json({
      items,
      rows: items,
      summary: {
        total_products: items.length,
        products_with_variance: items.filter((i) => i.variance !== 0).length,
        total_shrinkage_value: Math.round(totalShrinkageValue * 100) / 100,
      },
    });
  });
});
```

**Note on GRN date filter:** `goods_received_notes.received_date` is a local-time DATE column — use plain `date_from`/`date_to` strings, NOT `toUtcStart/toUtcEnd`.

### Task C2: Frontend ShrinkageTab

**File:** `frontend/src/pages/reports/ReportsInventory.jsx` — add after the last export (`ReplenishmentSmartTab`):

```jsx
// --- Tab: Shrinkage / Stock Discrepancy ----------------------------------------
export function ShrinkageTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds?.length) p.set("outlet_id", filters.outletIds.join(","));
      if (filters.categoryId) p.set("category_id", filters.categoryId);
      if (filters.search) p.set("search", filters.search);
      const res = await fetch(`${API}/api/reports/shrinkage?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds, filters.categoryId, filters.search]);

  useEffect(() => { load(); }, [load]);

  const cols = [
    { key: "product_name", label: "Product" },
    { key: "barcode", label: "Barcode" },
    { key: "outlet_name", label: "Outlet" },
    { key: "opening_qty", label: "Opening", align: "right" },
    { key: "purchases_qty", label: "Purchases", align: "right" },
    { key: "sales_qty", label: "Sales", align: "right" },
    { key: "returns_qty", label: "Returns", align: "right" },
    { key: "adjustments_qty", label: "Adjustments", align: "right" },
    { key: "expected_qty", label: "Expected", align: "right" },
    { key: "actual_qty", label: "Actual", align: "right" },
    { key: "variance", label: "Variance", align: "right" },
    { key: "variance_value", label: "Variance Value", align: "right" },
  ];

  return (
    <div>
      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <CardShell>
            <p className="text-xs text-slate-500">Products Checked</p>
            <p className="text-lg font-bold">{fmt(summary.total_products)}</p>
          </CardShell>
          <CardShell>
            <p className="text-xs text-slate-500">With Variance</p>
            <p className="text-lg font-bold text-amber-600">{fmt(summary.products_with_variance)}</p>
          </CardShell>
          <CardShell>
            <p className="text-xs text-slate-500">Total Shrinkage Value</p>
            <p className="text-lg font-bold text-red-600">{fmt(summary.total_shrinkage_value)}</p>
          </CardShell>
        </div>
      )}
      <ExportButton
        onClick={() => exportCSV(rows, cols, "shrinkage-report")}
        disabled={!rows.length}
      />
      <TableShell cols={cols} rows={rows} loading={loading}
        cellRender={(row, col) => {
          if (col.key === "variance" || col.key === "variance_value") {
            const val = row[col.key];
            const color = val < 0 ? "text-red-600 font-semibold" : val > 0 ? "text-emerald-600" : "";
            return <span className={color}>{fmt(val)}</span>;
          }
          return fmt(row[col.key]);
        }}
      />
    </div>
  );
}
```

### Task C3: Register tab in Reports.jsx

**File:** `frontend/src/pages/Reports.jsx`

1. Add import: `import { ShrinkageTab } from "./reports/ReportsInventory";` (add to existing import block)
2. Add tab entry in the `operations` section tabs array (after `wastage`):
   ```javascript
   { id: "shrinkage", label: "Shrinkage", icon: AlertTriangle },
   ```
3. Add case in the tab content switch:
   ```javascript
   case "shrinkage":
     return <ShrinkageTab filters={filters} />;
   ```

### Task C4: Commit

```bash
git add backend/routes/reports/inventory.js \
  frontend/src/pages/reports/ReportsInventory.jsx \
  frontend/src/pages/Reports.jsx
git commit -m "feat: stock discrepancy/shrinkage report (expected vs actual reconciliation)"
```

---

## Agent D: Customer-Facing Display

**Files:**
- `backend/routes/customer-display.js` (new)
- `backend/routes/registerAllRoutes.js` (mount route)
- `frontend/src/pages/CustomerDisplayPage.jsx` (new)
- `frontend/src/App.jsx` (add route)
- `frontend/src/pages/redesign/pos/POSContext.jsx` (push cart state)

### Task D1: Backend customer-display routes

**File:** `backend/routes/customer-display.js` (new)

```javascript
/**
 * Customer-facing display routes.
 * In-memory cart state — no DB table needed.
 */
const displayState = new Map(); // shift_id → { items, subtotal, tax, total, status, updatedAt }

// Auto-cleanup entries older than 8 hours
setInterval(() => {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  for (const [key, val] of displayState) {
    if (val.updatedAt < cutoff) displayState.delete(key);
  }
}, 60 * 60 * 1000); // run every hour

module.exports = function (app, deps) {
  const { requirePerm } = deps;

  // POST — POS pushes cart state (requires auth)
  app.post("/api/pos/customer-display", (req, res) => {
    const { shift_id, items, subtotal, tax, total, status, store_name, currency } = req.body || {};
    if (!shift_id) return res.status(400).json({ error: "shift_id required" });

    displayState.set(String(shift_id), {
      items: items || [],
      subtotal: subtotal || 0,
      tax: tax || 0,
      total: total || 0,
      status: status || "idle",
      store_name: store_name || "",
      currency: currency || "",
      updatedAt: Date.now(),
    });

    res.json({ success: true });
  });

  // GET — display page polls (no auth — read-only, non-sensitive data)
  app.get("/api/pos/customer-display", (req, res) => {
    const { shift_id } = req.query;
    if (!shift_id) return res.status(400).json({ error: "shift_id required" });

    const state = displayState.get(String(shift_id));
    if (!state) {
      return res.json({
        items: [], subtotal: 0, tax: 0, total: 0,
        status: "idle", store_name: "", currency: "",
      });
    }
    res.json(state);
  });
};
```

### Task D2: Mount route in registerAllRoutes.js

**File:** `backend/routes/registerAllRoutes.js` — add near other route registrations:

```javascript
require("./customer-display")(app, deps);
```

### Task D3: Frontend CustomerDisplayPage.jsx

**File:** `frontend/src/pages/CustomerDisplayPage.jsx` (new)

```jsx
import { useState, useEffect } from "react";
import { API_BASE as API } from "../config";

export default function CustomerDisplayPage() {
  const [data, setData] = useState({ items: [], subtotal: 0, tax: 0, total: 0, status: "idle", store_name: "", currency: "" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shiftId = params.get("shift_id");
    if (!shiftId) return;

    const poll = async () => {
      try {
        const res = await window._nativeFetch
          ? window._nativeFetch(`${API}/api/pos/customer-display?shift_id=${shiftId}`)
          : fetch(`${API}/api/pos/customer-display?shift_id=${shiftId}`);
        const d = await res.json();
        setData(d);
      } catch { /* silent */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  const { items, subtotal, tax, total, status, store_name, currency } = data;
  const sym = currency || "Rs";

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-8 py-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">{store_name || "Store"}</h1>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-2xl text-slate-500">Ready for next customer</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex-1">
                  <p className="text-xl font-medium">{item.name}</p>
                  <p className="text-sm text-slate-400">× {item.qty}</p>
                </div>
                <p className="text-xl font-semibold tabular-nums">
                  {sym} {(item.price * item.qty).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals */}
      {items.length > 0 && (
        <div className="border-t border-slate-800 px-8 py-6">
          <div className="flex justify-between text-lg text-slate-400">
            <span>Subtotal</span>
            <span className="tabular-nums">{sym} {subtotal.toLocaleString()}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-lg text-slate-400">
              <span>Tax</span>
              <span className="tabular-nums">{sym} {tax.toLocaleString()}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between text-3xl font-bold">
            <span>Total</span>
            <span className="tabular-nums">{sym} {total.toLocaleString()}</span>
          </div>
          {status === "paid" && (
            <div className="mt-4 rounded-xl bg-emerald-600 py-3 text-center text-2xl font-bold">
              Payment Complete ✓
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Task D4: Add route in App.jsx

**File:** `frontend/src/App.jsx` — add BEFORE the `RequireAuth` wrapper (alongside `/setup`, `/login`, `/kiosk`):

```jsx
<Route path="/customer-display" element={<CustomerDisplayPage />} />
```

And add import at top:
```jsx
import CustomerDisplayPage from "./pages/CustomerDisplayPage";
```

### Task D5: POS pushes cart state to display

**File:** `frontend/src/pages/redesign/pos/POSContext.jsx`

Add a `useEffect` that debounces cart state pushes. Add near other useEffects:

```jsx
// Push cart state to customer-facing display
useEffect(() => {
  if (!activeShift?.id) return;
  const timer = setTimeout(() => {
    const displayItems = cart.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
    }));
    fetch(`${API}/api/pos/customer-display`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shift_id: activeShift.id,
        items: displayItems,
        subtotal: cartSubtotal,
        tax: cartTax,
        total: cartTotal,
        status: "active",
        store_name: company?.company_name || "",
        currency: company?.currency_symbol || "Rs",
      }),
    }).catch(() => {}); // silent — display is optional
  }, 500);
  return () => clearTimeout(timer);
}, [cart, cartSubtotal, cartTax, cartTotal, activeShift?.id]);
```

Also push `{ status: "paid" }` after successful sale in `completeSale`:
```javascript
// Inside completeSale, after successful POST /api/sales response:
fetch(`${API}/api/pos/customer-display`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    shift_id: activeShift.id,
    items: [],
    subtotal: 0, tax: 0, total: 0,
    status: "paid",
    store_name: company?.company_name || "",
    currency: company?.currency_symbol || "Rs",
  }),
}).catch(() => {});
```

### Task D6: Commit

```bash
git add backend/routes/customer-display.js backend/routes/registerAllRoutes.js \
  frontend/src/pages/CustomerDisplayPage.jsx frontend/src/App.jsx \
  frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: customer-facing display with live cart polling"
```

---

## Post-build

### Task E1: Run tests

```bash
cd d:/newprojects/oneshoppos/backend && npx jest --forceExit 2>&1 | tail -20
```

Expected: 395+ tests passing (new migrate74 + seedSchema changes may affect count).

### Task E2: Run frontend build

```bash
cd d:/newprojects/oneshoppos/frontend && npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

### Task E3: Push branch

```bash
cd d:/newprojects/oneshoppos
git push -u origin feature/phase3-remaining
```

### Task E4: Update ROADMAP.md

Mark all 5 items as built in the Phase 3 section.

### Task E5: Update CLAUDE.md

Add new files to project structure, document new endpoints.

### Task E6: Update MEMORY.md

Add Phase 3 remaining items completion status.

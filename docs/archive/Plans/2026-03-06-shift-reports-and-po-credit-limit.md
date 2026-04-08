# Shift Report Attribution + PO Credit Limit Warning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Replace fragile time-window shift report queries with direct `shift_id` lookups; (2) Return a warning when a new PO would push a credit supplier over their credit limit.

**Architecture:** Task 1 edits one backend file (`routes/reports/shifts.js`) — remove `shiftTimeWhere()`, rewrite 5 queries to `WHERE s.shift_id = ?` / `WHERE r.shift_id = ?`. Task 2 adds a credit-check subquery inside `POST /api/purchase-orders` before the COMMIT, returning `{ id, warning }` when exceeded, and handles the warning in the frontend PO page.

**Tech Stack:** Node.js/Express, SQLite3 (callback API), Jest + supertest (backend tests), React 19 + Tailwind v4 (frontend)

---

## Prerequisite Knowledge

### Test helpers
- `createTestApp` / `closeDb` / `dbGet` / `dbRun` — from `backend/tests/helpers/createTestApp.js`
- `makeRequest(app, employeeId)` — from `backend/tests/helpers/request.js` — returns a supertest agent with `x-employee-id` header
- `ADMIN_ID` — exported from `backend/tests/helpers/request.js` (value: 1)
- Tests run with: `npx jest <test-file-path> --forceExit` from `backend/`

### Schema notes
- `seedSchema.js` `suppliers` table is missing the migrate62 columns (`payment_terms`, `credit_days`, `credit_limit`). Both task 2 tests must add these via `ALTER TABLE` in `beforeAll` after `createTestApp()`.
- `sales.shift_id` and `returns.shift_id` are present in `seedSchema.js` (added in previous session).
- `cash_shifts` table exists in seedSchema; seeded with no rows by default.
- Seed data has: outlet_id=1, product id=1 (price 50, cost 30), ADMIN employee id=1 with `all_access`.

### Shift report endpoints (all in `routes/reports/shifts.js`)
All 5 endpoints accept `?session_id=<shift_id>`, call `loadShift(session_id, cb)` which returns the `cash_shifts` row, then query sales/returns.

### Frontend PO create flow
`createPO()` in `PurchaseOrdersRedesign.jsx` (line ~212): POSTs payload, reads `data.id`, sets `notice` string, sets `view = "list"`. `notice` state is displayed as a green banner. A `warning` from the API should instead show as an amber/yellow banner.

---

## Task 1 — Rewrite shift report queries to use `shift_id`

**Files:**
- Modify: `backend/routes/reports/shifts.js`
- Create: `backend/tests/integration/shift-report-attribution.test.js`

---

### Step 1: Write the failing tests

Create `backend/tests/integration/shift-report-attribution.test.js`:

```js
/**
 * shift-report-attribution.test.js
 * Verifies shift reports use shift_id (not time-window) to scope sales/returns.
 */
const { createTestApp, closeDb, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;
const ADMIN_PIN = "2580";

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => { await closeDb(db); });

async function openFreshShift(outletId = 1) {
  await dbRun(db,
    "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE outlet_id = ? AND status = 'open'",
    [outletId]);
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/shifts/open")
    .send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 100 });
  expect(res.status).toBe(200);
  return res.body.shift_id;
}

async function ensureClockedIn(outletId = 1) {
  await dbRun(db,
    `UPDATE attendance_sessions SET session_end = datetime('now','localtime'), duration_hours = 0
     WHERE employee_id = ? AND session_end IS NULL`,
    [ADMIN_ID]);
  const res = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (![200, 400].includes(res.status)) throw new Error(`Clock-in failed: ${res.status}`);
}

async function makeSale(outletId = 1) {
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/sales")
    .send({
      cartItems: [{ id: 1, quantity: 1, price: 50, cost_price: 30 }],
      paymentMethod: "Cash",
      outlet_id: outletId,
      employee_id: ADMIN_ID,
    });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

async function makeReturn(saleId, outletId = 1) {
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/returns")
    .send({
      original_sale_id: saleId,
      outlet_id: outletId,
      employee_id: ADMIN_ID,
      total_refund: 50,
      refund_method: "Cash",
      reason: "test",
      items: [{ product_id: 1, quantity: 1, refund_price: 50 }],
    });
  expect(res.status).toBe(200);
  return res.body.id;
}

describe("shift-sales report uses shift_id", () => {
  it("returns sale for correct shift, not for a different shift", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    const saleId = await makeSale(1);

    // close shift1, open shift2
    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);

    const resShift1 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-sales?session_id=${shift1}`);
    expect(resShift1.status).toBe(200);
    expect(resShift1.body.sales.map((s) => s.id)).toContain(saleId);

    const resShift2 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-sales?session_id=${shift2}`);
    expect(resShift2.status).toBe(200);
    expect(resShift2.body.sales.map((s) => s.id)).not.toContain(saleId);
  });
});

describe("shift-summary report uses shift_id", () => {
  it("total_sales reflects only the sales in the queried shift", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    await makeSale(1);

    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);
    await ensureClockedIn(1);

    const res1 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-summary?session_id=${shift1}`);
    expect(res1.status).toBe(200);
    expect(Number(res1.body.summary.total_sales)).toBeGreaterThan(0);

    const res2 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-summary?session_id=${shift2}`);
    expect(res2.status).toBe(200);
    expect(Number(res2.body.summary.total_sales)).toBe(0);
  });
});

describe("cash-audit report uses shift_id", () => {
  it("return in shift1 does not appear in shift2 cash audit", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    const saleId = await makeSale(1);
    const returnId = await makeReturn(saleId, 1);

    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);

    const res = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/cash-audit?session_id=${shift2}`);
    expect(res.status).toBe(200);
    const refIds = res.body.audit.map((a) => a.ref_id);
    expect(refIds).not.toContain(returnId);
  });
});
```

### Step 2: Run tests to confirm RED

```bash
cd backend
npx jest tests/integration/shift-report-attribution.test.js --forceExit
```

Expected: All 3 tests FAIL. The `shift-sales` and `shift-summary` tests fail because `shift2` picks up sales from `shift1` (time-window includes now). The `cash-audit` test fails similarly.

### Step 3: Rewrite `routes/reports/shifts.js`

Replace the entire file content with the version below. Key changes:
- Remove `shiftTimeWhere()` helper entirely
- Replace all 5 endpoint queries to use `shift_id = ?` directly
- `loadShift()` is unchanged

```js
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps) {
  const { db } = deps;

  function loadShift(shiftId, cb) {
    db.get(
      `SELECT cs.*, e.name AS employee_name, o.name AS outlet_name
       FROM cash_shifts cs
       LEFT JOIN employees e ON e.id = cs.employee_id
       LEFT JOIN outlets o ON o.id = cs.outlet_id
       WHERE cs.id = ?`,
      [shiftId],
      cb,
    );
  }

  // Cash Flow: shift records with start/end cash (no sales/returns — unchanged)
  app.get("/api/reports/cash-flow", (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];
    if (date_from) {
      where.push("cs.opened_at >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("cs.opened_at < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    const sql = `
      SELECT
        cs.id,
        cs.outlet_id,
        cs.employee_id,
        cs.status,
        cs.opened_at AS start_time,
        cs.closed_at AS end_time,
        cs.opening_float AS start_cash,
        cs.closing_cash AS end_cash,
        cs.expected_cash,
        cs.variance,
        cs.notes,
        cs.variance_reason,
        cs.variance_approved_by,
        e.name AS employee_name,
        o.name AS outlet_name
      FROM cash_shifts cs
      LEFT JOIN employees e ON e.id = cs.employee_id
      LEFT JOIN outlets o ON o.id = cs.outlet_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY cs.opened_at DESC
    `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sessions: rows });
    });
  });

  // Cash Audit: cash sales and cash returns linked to this shift
  app.get("/api/reports/cash-audit", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT 'Sale' AS type, s.timestamp, s.total_amount AS amount, s.id AS ref_id
        FROM sales s
        WHERE s.shift_id = ? AND s.voided = 0 AND s.payment_method = 'Cash'
        UNION ALL
        SELECT 'Return' AS type, r.timestamp, -r.total_refund AS amount, r.id AS ref_id
        FROM returns r
        WHERE r.shift_id = ? AND r.refund_method = 'Cash'
        ORDER BY timestamp ASC
      `;
      db.all(sql, [session_id, session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ audit: rows, shift });
      });
    });
  });

  // Shift Summary
  app.get("/api/reports/shift-summary", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          (SELECT ROUND(COALESCE(SUM(total_amount), 0), 2) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 0) AS total_sales,
          (SELECT ROUND(COALESCE(SUM(total_refund), 0), 2) FROM returns r
           WHERE r.shift_id = ?) AS total_returns,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 0) AS order_count,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 1) AS void_count
      `;
      db.get(sql, [session_id, session_id, session_id, session_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ summary: row, shift });
      });
    });
  });

  // Shift Sales: list of sales linked to this shift
  app.get("/api/reports/shift-sales", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          s.*,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          COALESCE(e.name, '-') AS employee_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE s.shift_id = ?
        ORDER BY s.timestamp DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sales: rows, shift });
      });
    });
  });

  // Payment Summary: breakdown of payments by method for this shift
  app.get("/api/reports/payment-summary", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS payment_method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total,
          COUNT(DISTINCT s.id) AS count
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = ? AND s.voided = 0
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ payments: rows, shift });
      });
    });
  });

  // All Denominations (unchanged — already uses shift_id via shift_denominations table)
  app.get("/api/reports/all-denominations", (req, res) => {
    const { session_id } = req.query;
    const params = [];
    const where = [];
    if (session_id) {
      where.push("sd.shift_id = ?");
      params.push(session_id);
    }
    const sql = `
      SELECT
        sd.id,
        sd.shift_id AS session_id,
        sd.stage,
        sd.denomination,
        sd.count,
        ROUND(sd.denomination * sd.count, 2) AS subtotal,
        cs.opened_at AS start_time,
        cs.closed_at AS end_time,
        COALESCE(e.name, '-') AS employee_name,
        COALESCE(o.name, '-') AS outlet_name
      FROM shift_denominations sd
      JOIN cash_shifts cs ON cs.id = sd.shift_id
      LEFT JOIN employees e ON e.id = cs.employee_id
      LEFT JOIN outlets o ON o.id = cs.outlet_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY cs.opened_at DESC, sd.stage ASC, sd.denomination DESC
      LIMIT 500
    `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ denominations: rows });
    });
  });

  // Current Session Z-Report
  app.get("/api/reports/current-session-zreport", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = ? AND s.voided = 0
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ zReport: rows, shift });
      });
    });
  });
};
```

### Step 4: Run tests to confirm GREEN

```bash
cd backend
npx jest tests/integration/shift-report-attribution.test.js --forceExit
```

Expected: All 3 tests PASS.

### Step 5: Run full suite to confirm no regressions

```bash
cd backend
npx jest --forceExit
```

Expected: 339 passing (336 previous + 3 new), 0 failing.

### Step 6: Commit

```bash
cd backend
git add routes/reports/shifts.js tests/integration/shift-report-attribution.test.js
git commit -m "feat: shift reports use shift_id directly, remove time-window matching"
```

---

## Task 2 — PO Credit Limit Warning

**Files:**
- Modify: `backend/routes/purchase-orders.js`
- Modify: `backend/tests/helpers/seedSchema.js` (add credit term columns to suppliers)
- Create: `backend/tests/integration/po-credit-limit.test.js`
- Modify: `frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx`

---

### Step 1: Update seedSchema.js — add credit term columns to suppliers

In `seedSchema.js`, find the suppliers table definition (line ~32) and add the three migrate62 columns:

Current:
```js
`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT
  )`,
```

Replace with:
```js
`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    payment_terms TEXT NOT NULL DEFAULT 'cash',
    credit_days INTEGER NOT NULL DEFAULT 0,
    credit_limit REAL NOT NULL DEFAULT 0
  )`,
```

### Step 2: Write the failing tests

Create `backend/tests/integration/po-credit-limit.test.js`:

```js
/**
 * po-credit-limit.test.js
 * Verifies that POST /api/purchase-orders returns a warning when
 * a credit supplier would exceed their credit limit.
 */
const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  // Supplier 1 → cash supplier (default, no changes needed)
  // Supplier 2 → credit supplier with limit 500, currently no outstanding balance
  await dbRun(db,
    "UPDATE suppliers SET payment_terms = 'credit', credit_days = 30, credit_limit = 500 WHERE id = 2");
});

afterAll(async () => { await closeDb(db); });

const PO_ITEMS = [{ product_id: 1, quantity: 2, cost_price: 100 }]; // total = 200

async function createPO(supplierId, totalCost = 200) {
  return makeRequest(app, ADMIN_ID)
    .post("/api/purchase-orders")
    .send({
      supplier_id: supplierId,
      total_cost: totalCost,
      items: PO_ITEMS,
    });
}

describe("POST /api/purchase-orders — credit limit warning", () => {
  it("cash supplier: no warning field in response", async () => {
    const res = await createPO(1, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toBeUndefined();
  });

  it("credit supplier under limit: no warning field in response", async () => {
    // limit=500, no outstanding, PO total=200 → 0+200=200 < 500
    const res = await createPO(2, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toBeUndefined();
  });

  it("credit supplier over limit: 200 response with warning field", async () => {
    // limit=500, after two POs outstanding ~200, PO total=400 → 200+400=600 > 500
    // First create an invoice to build up outstanding balance
    await dbRun(db,
      "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, status) VALUES (2, 'INV-TEST', 350, 'unpaid')");
    // Now PO total=200 → outstanding(350)+200=550 > limit(500)
    const res = await createPO(2, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toMatch(/credit limit/i);
  });

  it("credit supplier with credit_limit=0 (unlimited): no warning", async () => {
    await dbRun(db,
      "UPDATE suppliers SET credit_limit = 0 WHERE id = 2");
    await dbRun(db,
      "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, status) VALUES (2, 'INV-TEST2', 9999, 'unpaid')");
    const res = await createPO(2, 999);
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
  });
});
```

### Step 3: Run tests to confirm RED

```bash
cd backend
npx jest tests/integration/po-credit-limit.test.js --forceExit
```

Expected: Test 3 ("over limit: warning field") FAILS — response has no `warning` field. Tests 1, 2, 4 may pass already (no warning when not expected). If `seedSchema.js` change from Step 1 wasn't done first, all tests will error with column errors.

### Step 4: Add credit check to `routes/purchase-orders.js`

In `POST /api/purchase-orders`, after the items validation check and before `db.serialize()`, add a credit check. The new flow:

1. Look up supplier's `payment_terms`, `credit_limit`, and current `running_balance`
2. If `payment_terms = 'credit'` AND `credit_limit > 0` AND `running_balance + total_cost > credit_limit` → set a `warningMsg`
3. Create the PO as normal
4. In the COMMIT callback, return `{ message, id, ...(warningMsg && { warning: warningMsg }) }`

Find the `POST /api/purchase-orders` handler. After the items check (line ~73) and before `db.serialize()`, insert this credit check that wraps the existing serialize block:

Replace:
```js
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Purchase order must have items" });
    }

    db.serialize(() => {
```

With:
```js
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Purchase order must have items" });
    }

    // Check credit limit for credit suppliers
    db.get(
      `SELECT s.payment_terms, s.credit_limit,
              COALESCE(outstanding.balance, 0) AS running_balance
       FROM suppliers s
       LEFT JOIN (
         SELECT si.supplier_id,
                SUM(si.amount - COALESCE(sp.paid_amount, 0)) AS balance
         FROM supplier_invoices si
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'
         GROUP BY si.supplier_id
       ) outstanding ON outstanding.supplier_id = s.id
       WHERE s.id = ?`,
      [supplier_id],
      (sErr, supplier) => {
        if (sErr) return res.status(500).json({ error: sErr.message });
        let warningMsg = null;
        if (
          supplier &&
          supplier.payment_terms === "credit" &&
          Number(supplier.credit_limit) > 0 &&
          Number(supplier.running_balance) + Number(total_cost) > Number(supplier.credit_limit)
        ) {
          warningMsg = `Credit limit exceeded. Outstanding: ${Number(supplier.running_balance).toFixed(2)}, Limit: ${Number(supplier.credit_limit).toFixed(2)}`;
        }
        proceedWithCreate(warningMsg);
      },
    );

    function proceedWithCreate(warningMsg) {
    db.serialize(() => {
```

And at the end of the function, close the `proceedWithCreate` function by finding the final `});` that closes `db.serialize(() => {` and adding `}` after it:

The `COMMIT` callback's `res.json` line changes from:
```js
            res.json({ message: "Purchase order created", id: poId });
```
To:
```js
            res.json({ message: "Purchase order created", id: poId, ...(warningMsg && { warning: warningMsg }) });
```

And add the closing brace for `proceedWithCreate`:
```js
    }); // end db.serialize
    } // end proceedWithCreate
```

The complete modified `POST /api/purchase-orders` handler after these changes:

```js
  app.post("/api/purchase-orders", requirePerm("manage_orders"), (req, res) => {
    const { supplier_id, total_cost, items, due_date } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Purchase order must have items" });
    }

    db.get(
      `SELECT s.payment_terms, s.credit_limit,
              COALESCE(outstanding.balance, 0) AS running_balance
       FROM suppliers s
       LEFT JOIN (
         SELECT si.supplier_id,
                SUM(si.amount - COALESCE(sp.paid_amount, 0)) AS balance
         FROM supplier_invoices si
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'
         GROUP BY si.supplier_id
       ) outstanding ON outstanding.supplier_id = s.id
       WHERE s.id = ?`,
      [supplier_id],
      (sErr, supplier) => {
        if (sErr) return res.status(500).json({ error: sErr.message });
        let warningMsg = null;
        if (
          supplier &&
          supplier.payment_terms === "credit" &&
          Number(supplier.credit_limit) > 0 &&
          Number(supplier.running_balance) + Number(total_cost) > Number(supplier.credit_limit)
        ) {
          warningMsg = `Credit limit exceeded. Outstanding: ${Number(supplier.running_balance).toFixed(2)}, Limit: ${Number(supplier.credit_limit).toFixed(2)}`;
        }

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          db.run(
            "INSERT INTO purchase_orders (supplier_id, total_cost, status, due_date) VALUES (?, ?, 'Draft', ?)",
            [supplier_id, total_cost, due_date || null],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Failed to create PO" });
              }

              const poId = this.lastID;
              const stmt = db.prepare(
                "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
              );
              let hasError = false;

              items.forEach((item) => {
                stmt.run(
                  poId,
                  item.product_id,
                  item.quantity,
                  item.cost_price,
                  (err) => {
                    if (err) hasError = true;
                  },
                );
              });

              stmt.finalize();

              if (hasError) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Transaction failed while adding items" });
              }

              db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: "Failed to commit PO" });
                res.json({ message: "Purchase order created", id: poId, ...(warningMsg && { warning: warningMsg }) });
              });
            },
          );
        });
      },
    );
  });
```

### Step 5: Run tests to confirm GREEN

```bash
cd backend
npx jest tests/integration/po-credit-limit.test.js --forceExit
```

Expected: All 4 tests PASS.

### Step 6: Run full suite to confirm no regressions

```bash
cd backend
npx jest --forceExit
```

Expected: 343 passing (339 from Task 1 + 4 new), 0 failing.

### Step 7: Update frontend — handle `warning` in `createPO()`

In `frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx`, find `createPO()` (line ~212).

The state currently uses `notice` (green) for success messages. We need to differentiate a warning (amber). Check if there's a separate `warning` state or if we reuse `notice`. Looking at the component, `notice` is displayed as a green-toned banner. We'll add a separate `warn` state for the amber case.

Find the state declarations near the top of the component and add:
```js
const [warn, setWarn] = useState("");
```

Find where `notice` is cleared at the start of `createPO()`:
```js
    setError("");
    setNotice("");
```
Add:
```js
    setWarn("");
```

After the successful POST, replace:
```js
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create purchase order");
      await loadRows();
      setNotice(`Purchase order ${poNumber(data.id)} created.`);
      setView("list");
```
With:
```js
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create purchase order");
      await loadRows();
      if (data.warning) {
        setWarn(`PO ${poNumber(data.id)} created. Warning: ${data.warning}`);
      } else {
        setNotice(`Purchase order ${poNumber(data.id)} created.`);
      }
      setView("list");
```

Find where `notice` is rendered (search for `notice &&` or similar) and add the `warn` banner alongside it. The notice banner pattern looks like:
```jsx
{notice && <SectionCard className="mb-3 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</SectionCard>}
```

Add immediately after it:
```jsx
{warn && <SectionCard className="mb-3 border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{warn}</SectionCard>}
```

### Step 8: Commit Task 2

```bash
git add backend/routes/purchase-orders.js \
        backend/tests/helpers/seedSchema.js \
        backend/tests/integration/po-credit-limit.test.js \
        frontend/src/pages/redesign/PurchaseOrdersRedesign.jsx
git commit -m "feat: PO creation warns when credit supplier exceeds credit limit"
```

---

## Final Verification

```bash
cd backend && npx jest --forceExit
```

Expected: **343 tests passing**, 0 failing.

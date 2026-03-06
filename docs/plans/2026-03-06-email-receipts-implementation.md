# Email Receipts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send HTML email receipts on-demand via SMTP (nodemailer), triggered from the POS Recent Sales panel or Receipt Modal.

**Architecture:** New `backend/routes/email.js` (4 endpoints) + `backend/migrate65.js` (email_config table) + `backend/utils/receiptEmail.js` (server-side HTML builder) + `POSEmailReceiptModal.jsx` + email button in `POSRecentSalesPanel` + Email tab in Printer Settings.

**Tech Stack:** nodemailer (SMTP), SQLite single-row config, React modal, Lucide icons

---

## Task 1: Install nodemailer + write migrate65

**Files:**
- Create: `backend/migrate65.js`

**Step 1: Install nodemailer**

```bash
cd backend && npm install nodemailer
```

Expected: `nodemailer` appears in `backend/package.json` dependencies.

**Step 2: Create `backend/migrate65.js`**

```js
/**
 * migrate65.js — Add email_config table
 *
 * Stores SMTP credentials for sending email receipts.
 * Single row (id=1) seeded so Settings UI always has a row to read/update.
 */
const path = require("path");
const Database = require("sqlite3").Database;

const DB_PATH = path.join(__dirname, "oneshop.db");
const db = new Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS email_config (
      id          INTEGER PRIMARY KEY,
      smtp_host   TEXT    DEFAULT 'smtp.gmail.com',
      smtp_port   INTEGER DEFAULT 587,
      smtp_user   TEXT,
      smtp_pass   TEXT,
      from_name   TEXT    DEFAULT 'OneShopPOS',
      enabled     INTEGER DEFAULT 0
    )
  `, (err) => {
    if (err) console.error("migrate65: create email_config:", err.message);
    else console.log("migrate65: email_config table ready.");
  });

  db.run(
    "INSERT OR IGNORE INTO email_config (id) VALUES (1)",
    (err) => {
      if (err) console.error("migrate65: seed row:", err.message);
      else console.log("migrate65: default email_config row seeded.");
    }
  );
});

db.close((err) => {
  if (err) console.error("migrate65: close:", err.message);
  else console.log("migrate65: done.");
});
```

**Step 3: Run migration**

```bash
cd backend && node migrate65.js
```

Expected output:
```
migrate65: email_config table ready.
migrate65: default email_config row seeded.
migrate65: done.
```

**Step 4: Commit**

```bash
git add backend/migrate65.js backend/package.json backend/package-lock.json
git commit -m "feat: migrate65 — email_config table + install nodemailer"
```

---

## Task 2: Backend utility — server-side receipt HTML builder

**Files:**
- Create: `backend/utils/receiptEmail.js`

This file lives server-side (no frontend imports). It receives a sale record + items + payments and builds email-safe HTML with inline styles.

**Step 1: Create `backend/utils/receiptEmail.js`**

```js
/**
 * receiptEmail.js — Server-side HTML receipt builder for email delivery.
 *
 * Produces a self-contained HTML string (inline styles, no scripts, no external assets).
 * Mirrors the sections from frontend/src/utils/receipt.js buildReceiptSections().
 *
 * @param {object} sale     - Row from sales table (includes outlet_name, employee_name)
 * @param {Array}  items    - Rows from sale_items (with product_name)
 * @param {Array}  payments - Rows from sale_payments
 * @param {object|null} template - Row from receipt_templates (header_text, footer_text, show_barcode)
 * @returns {string} Complete HTML document string
 */
function buildReceiptEmailHtml(sale, items, payments, template) {
  const storeName = template?.header_text || sale.outlet_name || "OneShopPOS";
  const footerText = template?.footer_text || "Thank you for your purchase!";

  const subtotal = items.reduce(
    (s, i) => s + Number(i.price_at_sale || 0) * Number(i.quantity || 0),
    0
  );
  const total = Number(sale.total_amount || 0);
  const discount = Number(sale.discount_amount || 0);
  const tax = total - subtotal + discount; // derived

  function fmt(n) {
    return `PKRs ${Number(n || 0).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  const itemRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:4px 0;border-bottom:1px solid #eee;">${i.product_name || "Item"}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(i.price_at_sale)}</td>
        <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(Number(i.price_at_sale) * Number(i.quantity))}</td>
      </tr>`
    )
    .join("");

  const paymentRows = payments
    .map(
      (p) => `
      <tr>
        <td style="padding:2px 0;color:#555;">${p.payment_method}</td>
        <td style="padding:2px 0;text-align:right;">${fmt(p.amount)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Receipt</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:24px 0;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e0e0e0;">

        <!-- Header -->
        <tr><td style="text-align:center;padding-bottom:16px;border-bottom:2px solid #222;">
          <div style="font-size:20px;font-weight:bold;">${storeName}</div>
          ${sale.outlet_name ? `<div style="font-size:12px;color:#666;margin-top:4px;">${sale.outlet_name}</div>` : ""}
        </td></tr>

        <!-- Meta -->
        <tr><td style="padding:12px 0;border-bottom:1px solid #eee;font-size:13px;">
          <table width="100%">
            <tr>
              <td style="color:#555;">Invoice #</td>
              <td style="text-align:right;font-weight:bold;">${sale.invoice_number || sale.id}</td>
            </tr>
            <tr>
              <td style="color:#555;">Date</td>
              <td style="text-align:right;">${sale.timestamp || ""}</td>
            </tr>
            ${sale.employee_name ? `<tr><td style="color:#555;">Served by</td><td style="text-align:right;">${sale.employee_name}</td></tr>` : ""}
            ${sale.customer_name ? `<tr><td style="color:#555;">Customer</td><td style="text-align:right;">${sale.customer_name}</td></tr>` : ""}
          </table>
        </td></tr>

        <!-- Items -->
        <tr><td style="padding:12px 0;font-size:13px;">
          <table width="100%">
            <tr style="font-weight:bold;border-bottom:1px solid #222;">
              <td style="padding:4px 0;">Item</td>
              <td style="padding:4px 0;text-align:center;">Qty</td>
              <td style="padding:4px 0;text-align:right;">Price</td>
              <td style="padding:4px 0;text-align:right;">Total</td>
            </tr>
            ${itemRows}
          </table>
        </td></tr>

        <!-- Totals -->
        <tr><td style="padding:12px 0;border-top:1px solid #eee;font-size:13px;">
          <table width="100%">
            <tr><td style="color:#555;">Subtotal</td><td style="text-align:right;">${fmt(subtotal)}</td></tr>
            ${discount > 0 ? `<tr><td style="color:#e53e3e;">Discount</td><td style="text-align:right;color:#e53e3e;">-${fmt(discount)}</td></tr>` : ""}
            ${tax > 0 ? `<tr><td style="color:#555;">Tax</td><td style="text-align:right;">${fmt(tax)}</td></tr>` : ""}
            <tr><td style="font-weight:bold;font-size:15px;padding-top:6px;">Total</td><td style="text-align:right;font-weight:bold;font-size:15px;padding-top:6px;">${fmt(total)}</td></tr>
          </table>
        </td></tr>

        <!-- Payments -->
        ${paymentRows ? `
        <tr><td style="padding:12px 0;border-top:1px solid #eee;font-size:13px;">
          <div style="font-weight:bold;margin-bottom:6px;">Payment</div>
          <table width="100%">${paymentRows}</table>
        </td></tr>` : ""}

        <!-- Footer -->
        <tr><td style="padding-top:16px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#888;">
          ${footerText}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildReceiptEmailHtml };
```

**Step 2: Commit**

```bash
git add backend/utils/receiptEmail.js
git commit -m "feat: receiptEmail.js — server-side HTML receipt builder for email"
```

---

## Task 3: Backend email routes

**Files:**
- Create: `backend/routes/email.js`
- Modify: `backend/routes/registerAllRoutes.js` (add one `require` line)

**Step 1: Write failing test first** — see Task 4 (tests are written before routes work fully, but write routes first since tests need the route to exist)

**Step 1: Create `backend/routes/email.js`**

```js
/**
 * Email routes — SMTP receipt delivery
 *
 * GET  /api/email/config        — load email_config (password masked)
 * PUT  /api/email/config        — save email_config
 * POST /api/email/test          — send test email to smtp_user
 * POST /api/email/send-receipt  — send HTML receipt to toEmail for a given saleId
 *
 * All endpoints require x-employee-id header (authenticated employee).
 */

module.exports = function emailRoutes(app, deps) {
  const { db } = deps;
  const nodemailer = require("nodemailer");
  const { buildReceiptEmailHtml } = require("../utils/receiptEmail");

  function authGuard(req, res) {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  function getConfig(cb) {
    db.get("SELECT * FROM email_config WHERE id = 1", cb);
  }

  function makeTransport(cfg) {
    return nodemailer.createTransport({
      host: cfg.smtp_host,
      port: Number(cfg.smtp_port || 587),
      secure: Number(cfg.smtp_port) === 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    });
  }

  // GET /api/email/config
  app.get("/api/email/config", (req, res) => {
    if (!authGuard(req, res)) return;
    getConfig((err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const cfg = row || {};
      // Never expose raw password
      if (cfg.smtp_pass) cfg.smtp_pass = "*****";
      res.json(cfg);
    });
  });

  // PUT /api/email/config
  app.put("/api/email/config", (req, res) => {
    if (!authGuard(req, res)) return;
    const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name, enabled } =
      req.body || {};

    // Only update smtp_pass if a real value is provided (not masked placeholder)
    const passClause = smtp_pass && smtp_pass !== "*****"
      ? ", smtp_pass = ?"
      : "";
    const params = [
      smtp_host || "smtp.gmail.com",
      Number(smtp_port || 587),
      smtp_user || null,
      from_name || "OneShopPOS",
      enabled ? 1 : 0,
    ];
    if (passClause) params.splice(3, 0, smtp_pass); // insert before from_name

    db.run(
      `UPDATE email_config SET
         smtp_host = ?, smtp_port = ?, smtp_user = ?${passClause},
         from_name = ?, enabled = ?
       WHERE id = 1`,
      params,
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      }
    );
  });

  // POST /api/email/test
  app.post("/api/email/test", async (req, res) => {
    if (!authGuard(req, res)) return;
    getConfig(async (err, cfg) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }
      try {
        const transport = makeTransport(cfg);
        await transport.sendMail({
          from: `"${cfg.from_name || "OneShopPOS"}" <${cfg.smtp_user}>`,
          to: cfg.smtp_user,
          subject: "OneShopPOS — Email Test",
          html: "<p>Email is configured correctly!</p>",
        });
        res.json({ ok: true, message: "Test email sent to " + cfg.smtp_user });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });

  // POST /api/email/send-receipt
  app.post("/api/email/send-receipt", async (req, res) => {
    if (!authGuard(req, res)) return;
    const { saleId, toEmail } = req.body || {};

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: "Valid email address is required." });
    }
    if (!saleId) return res.status(400).json({ error: "saleId is required." });

    getConfig(async (err, cfg) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }

      // Fetch sale + items + payments
      db.get(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name,
                c.name as customer_name
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = ?`,
        [saleId],
        (err, sale) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!sale) return res.status(404).json({ error: "Sale not found." });

          db.all(
            `SELECT si.*, p.name as product_name FROM sale_items si
             JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?`,
            [saleId],
            (err, items) => {
              if (err) return res.status(500).json({ error: err.message });

              db.all(
                "SELECT * FROM sale_payments WHERE sale_id = ?",
                [saleId],
                async (err, payments) => {
                  if (err) return res.status(500).json({ error: err.message });

                  // Fetch active receipt template (optional)
                  db.get(
                    "SELECT * FROM receipt_templates WHERE is_active = 1 LIMIT 1",
                    async (err, template) => {
                      // template errors are non-fatal — proceed without it
                      const html = buildReceiptEmailHtml(
                        sale,
                        items || [],
                        payments || [],
                        template || null
                      );

                      try {
                        const transport = makeTransport(cfg);
                        await transport.sendMail({
                          from: `"${cfg.from_name || "OneShopPOS"}" <${cfg.smtp_user}>`,
                          to: toEmail,
                          subject: `Receipt #${sale.invoice_number || sale.id} from ${cfg.from_name || "OneShopPOS"}`,
                          html,
                        });
                        res.json({ ok: true });
                      } catch (e) {
                        res.status(500).json({ error: e.message });
                      }
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
};
```

**Step 2: Register route in `registerAllRoutes.js`**

After the `require("./printer")(app, deps);` line (around line 342), add:

```js
  require("./email")(app, deps);
```

**Step 3: Commit**

```bash
git add backend/routes/email.js backend/routes/registerAllRoutes.js
git commit -m "feat: email routes — config CRUD, test send, send-receipt"
```

---

## Task 4: Backend integration tests

**Files:**
- Create: `backend/tests/integration/email.test.js`

**Step 1: Create `backend/tests/integration/email.test.js`**

```js
/**
 * email.test.js — Integration tests for email routes
 *
 * GET  /api/email/config       — auth guard, returns row with masked password
 * PUT  /api/email/config       — saves config
 * POST /api/email/test         — 503 when not configured
 * POST /api/email/send-receipt — auth, validation, 503 when not configured, 404 on bad saleId
 */

const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // email_config table is added in migrate65 — not in seedSchema, create it here
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS email_config (
      id          INTEGER PRIMARY KEY,
      smtp_host   TEXT    DEFAULT 'smtp.gmail.com',
      smtp_port   INTEGER DEFAULT 587,
      smtp_user   TEXT,
      smtp_pass   TEXT,
      from_name   TEXT    DEFAULT 'OneShopPOS',
      enabled     INTEGER DEFAULT 0
    )
  `);
  await dbRun(db, "INSERT OR IGNORE INTO email_config (id) VALUES (1)");
});

afterAll(async () => {
  await closeDb(db);
});

// ---------------------------------------------------------------------------
// GET /api/email/config
// ---------------------------------------------------------------------------
describe("GET /api/email/config", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).get("/api/email/config");
    expect(res.status).toBe(401);
  });

  it("returns config row with masked password", async () => {
    await dbRun(db, "UPDATE email_config SET smtp_pass = 'secret123' WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID).get("/api/email/config");
    expect(res.status).toBe(200);
    expect(res.body.smtp_host).toBe("smtp.gmail.com");
    expect(res.body.smtp_pass).toBe("*****");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/email/config
// ---------------------------------------------------------------------------
describe("PUT /api/email/config", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).put("/api/email/config").send({});
    expect(res.status).toBe(401);
  });

  it("saves config and returns { ok: true }", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put("/api/email/config")
      .send({ smtp_host: "smtp.outlook.com", smtp_port: 587, smtp_user: "test@outlook.com", enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const check = await makeRequest(app, ADMIN_ID).get("/api/email/config");
    expect(check.body.smtp_host).toBe("smtp.outlook.com");
    expect(check.body.smtp_user).toBe("test@outlook.com");
    expect(check.body.enabled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/email/test
// ---------------------------------------------------------------------------
describe("POST /api/email/test", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).post("/api/email/test");
    expect(res.status).toBe(401);
  });

  it("returns 503 when email not configured (enabled=0)", async () => {
    await dbRun(db, "UPDATE email_config SET enabled = 0, smtp_pass = NULL WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID).post("/api/email/test");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/email/send-receipt
// ---------------------------------------------------------------------------
describe("POST /api/email/send-receipt", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "test@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when toEmail is missing", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 400 when toEmail is invalid format", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when saleId is missing", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ toEmail: "test@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/saleId/i);
  });

  it("returns 503 when email not configured", async () => {
    await dbRun(db, "UPDATE email_config SET enabled = 0 WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "test@example.com" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("returns 404 when saleId does not exist (email configured)", async () => {
    // Enable email with a fake password so it passes config check
    await dbRun(db, "UPDATE email_config SET enabled = 1, smtp_user = 'x@x.com', smtp_pass = 'fake' WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 999999, toEmail: "customer@example.com" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
```

**Step 2: Run tests**

```bash
cd backend && npx jest tests/integration/email.test.js --no-coverage
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add backend/tests/integration/email.test.js
git commit -m "test: email routes — auth, validation, 503 config guard, 404 sale"
```

---

## Task 5: Frontend — POSEmailReceiptModal

**Files:**
- Create: `frontend/src/pages/redesign/pos/POSEmailReceiptModal.jsx`

**Step 1: Create the modal**

```jsx
import React, { useState } from "react";
import { Mail, X, Loader2 } from "lucide-react";
import { API_BASE as API } from "../../../config";
import { usePOS } from "./POSContext";

/**
 * POSEmailReceiptModal — sends an HTML receipt to a customer email.
 *
 * Props:
 *   saleId        {number}  — ID of the sale to email
 *   customerEmail {string}  — Pre-filled email (editable)
 *   onClose       {fn}      — Called on dismiss or after success
 */
export default function POSEmailReceiptModal({ saleId, customerEmail, onClose }) {
  const { authHeaders } = usePOS();
  const [email, setEmail] = useState(customerEmail || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/email/send-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ saleId, toEmail: email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email.");
      setSent(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Mail size={20} className="text-blue-600" />
          <h3 className="font-semibold text-slate-800">Email Receipt</h3>
        </div>

        {sent ? (
          <p className="text-green-600 font-medium text-sm text-center py-4">
            Receipt sent successfully!
          </p>
        ) : (
          <>
            <label className="block text-sm text-slate-600 mb-1">
              Send to
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              disabled={loading}
              autoFocus
            />
            {error && (
              <p className="text-red-500 text-xs mb-3">{error}</p>
            )}
            <button
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              {loading ? "Sending…" : "Send Receipt"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSEmailReceiptModal.jsx
git commit -m "feat: POSEmailReceiptModal — email input, send, loading/error states"
```

---

## Task 6: Wire email button into POSRecentSalesPanel

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx`

**Step 1: Read the current file**

Open [frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx](frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx).

**Step 2: Add import at top**

After the existing imports, add:

```js
import { Mail } from "lucide-react";
import POSEmailReceiptModal from "./POSEmailReceiptModal";
```

**Step 3: Add state for email modal**

Inside the component, after the `filtered` useMemo, add:

```js
const [emailTarget, setEmailTarget] = useState(null);
// emailTarget = { saleId, customerEmail } | null
```

Add `useState` to the React import if not already there.

**Step 4: Add modal at end of JSX**

Just before the closing `</div>` of the outer wrapper, add:

```jsx
{emailTarget && (
  <POSEmailReceiptModal
    saleId={emailTarget.saleId}
    customerEmail={emailTarget.customerEmail}
    onClose={() => setEmailTarget(null)}
  />
)}
```

**Step 5: Add Email button next to Reprint button**

Find the existing Reprint button (around line 121). After it, add:

```jsx
<button
  onClick={() =>
    setEmailTarget({ saleId: sale.id, customerEmail: sale.customer_email || "" })
  }
  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium"
>
  <Mail size={12} /> Email
</button>
```

Note: `sale.customer_email` — need to verify the field name. If the recent sales query doesn't include customer email, check Step 6 below.

**Step 6: Verify customer_email is in recent sales query**

Check the backend query that populates `recentSales`. Find it in `backend/routes/sales.js` (search for the query that returns today's sales list). If `customers.email` is not JOINed, add it:

```sql
LEFT JOIN customers c ON s.customer_id = c.id
```

And select `c.email as customer_email`. Update the query if needed.

**Step 7: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx
git commit -m "feat: POSRecentSalesPanel — Email button opens POSEmailReceiptModal"
```

---

## Task 7: Wire email button into POSReceiptModal

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSReceiptModal.jsx`

**Step 1: Read the current file**

Open [frontend/src/pages/redesign/pos/POSReceiptModal.jsx](frontend/src/pages/redesign/pos/POSReceiptModal.jsx).

**Step 2: Add import**

```js
import { Mail } from "lucide-react";
import POSEmailReceiptModal from "./POSEmailReceiptModal";
```

**Step 3: Add state**

```js
const [showEmailModal, setShowEmailModal] = useState(false);
```

**Step 4: Add Email Receipt button**

Find the Print/Close button area. Add alongside the existing print button:

```jsx
<button
  onClick={() => setShowEmailModal(true)}
  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-medium"
>
  <Mail size={14} /> Email Receipt
</button>
```

**Step 5: Add modal**

```jsx
{showEmailModal && slip?.saleId && (
  <POSEmailReceiptModal
    saleId={slip.saleId}
    customerEmail={slip.customer?.email || ""}
    onClose={() => setShowEmailModal(false)}
  />
)}
```

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSReceiptModal.jsx
git commit -m "feat: POSReceiptModal — Email Receipt secondary action"
```

---

## Task 8: Email Settings UI (Printer Settings page — Email tab)

**Files:**
- Modify: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx` (or whatever the Printer Settings page is)

> **Note:** First check what the Printer Settings page is called:
> ```bash
> find frontend/src -name "*Printer*" -o -name "*printer*" | grep -v node_modules
> ```
> Read the file before modifying.

**Step 1: Find the Printer Settings file**

```bash
ls frontend/src/pages/redesign/ | grep -i printer
```

**Step 2: Add Email Settings tab**

The Printer Settings page likely has tabs. Add an "Email" tab with these fields:

- SMTP Host (text input, default `smtp.gmail.com`)
- SMTP Port (number input, default `587`)
- SMTP User / Gmail address (text input)
- Password / App Password (password input — shows `*****` if already set, clears to edit)
- From Name (text input, default `OneShopPOS`)
- Enabled toggle
- "Save" button → `PUT /api/email/config`
- "Send Test Email" button → `POST /api/email/test`

**Implementation pattern:** Follow exactly the same fetch/save pattern already used in the printer settings tab. Load on mount with `GET /api/email/config`, save with `PUT /api/email/config`.

**Step 3: Commit**

```bash
git add frontend/src/pages/redesign/<PrinterSettingsFile>.jsx
git commit -m "feat: Printer Settings — Email tab with SMTP config and test send"
```

---

## Task 9: Smoke test end-to-end

**Step 1: Run backend tests**

```bash
cd backend && npx jest tests/integration/email.test.js --no-coverage
```

Expected: All 8 tests pass.

**Step 2: Run full test suite to check for regressions**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -5
```

Expected: 248+ passing, 2 pre-existing failures in `concurrency.test.js`.

**Step 3: Manual smoke test**

1. Start backend + frontend (`start-pos.bat`)
2. Go to Settings → Printer → Email tab
3. Enter Gmail SMTP credentials (use a Gmail App Password, not your account password)
4. Toggle Enabled → Save
5. Click "Send Test Email" — verify email arrives in inbox
6. Go to POS → open Recent Sales → click "Email" on a sale
7. Edit the email address → click Send Receipt
8. Verify the HTML receipt email arrives

**Step 4: Final commit if any fixups**

```bash
git add -A
git commit -m "fix: email receipts — post-smoke fixups"
```

---

## Gmail App Password Note

The Settings UI should include a help text: _"For Gmail, use an App Password (not your account password). Enable 2-Step Verification first, then generate one at myaccount.google.com/apppasswords."_

# Roadmap Waves 1-3 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 15 features across 3 waves — customer communication, operational tools, integrations, AI insights, multi-channel, and PWA.

**Architecture:** Leverages existing infrastructure (Resend, nodemailer, ESC/POS, feature flags, receipt system) with new modules for import, courier dispatch, AI insights, and PWA.

**Tech Stack:** React 19, Tailwind CSS v4, Node.js + Express, PostgreSQL. New dependency: `@anthropic-ai/sdk` (Wave 2 only).

---

## WAVE 1: Customer Communication + Operational Foundation (Tasks 1-16)

---

### Task 1: Receipt Email — Backend Endpoint

**Files:**
- Modify: `backend/routes/email.js`

**Step 1: Add Resend fallback to existing email send endpoint**

The existing `POST /api/email/send-receipt` in `backend/routes/email.js` already sends receipt emails via nodemailer/SMTP. Add a Resend fallback when no `email_config` exists for the tenant.

In `backend/routes/email.js`, find the `POST /api/email/send-receipt` handler. After the `email_config` fetch (around line 132), add fallback logic:

```js
    // After: const { rows: [cfg] } = await db.query("SELECT * FROM email_config WHERE id = 1");

    // If no SMTP config, try Resend fallback
    if (!cfg || !cfg.smtp_host) {
      if (!process.env.RESEND_API_KEY) {
        return res.status(400).json({ error: "Email not configured. Ask your administrator to set up SMTP in Settings." });
      }
      // Use Resend fallback
      const { sendReceiptEmail } = require("../utils/resendEmail");
      // ... fetch sale, items, payments, template (same queries as below)
      // ... build HTML, send via Resend
    }
```

Actually, to keep this clean, extract the sale/items/payments/template fetch into a helper, then branch on transport. Here's the full approach:

After the existing `send-receipt` endpoint, add a new endpoint that handles both transports:

```js
  // POST /api/email/send-receipt-v2 — sends receipt email via SMTP or Resend fallback
  app.post("/api/email/send-receipt-v2", async (req, res) => {
    const { saleId, toEmail } = req.body || {};
    if (!toEmail || !saleId) return res.status(400).json({ error: "saleId and toEmail required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return res.status(400).json({ error: "Invalid email" });

    try {
      // Fetch sale with joins
      const { rows: [sale] } = await db.query(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = $1`, [saleId]
      );
      if (!sale) return res.status(404).json({ error: "Sale not found" });

      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name FROM sale_items si
         LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = $1`, [saleId]
      );
      const { rows: payments } = await db.query("SELECT * FROM sale_payments WHERE sale_id = $1", [saleId]);

      let template = null;
      try {
        const { rows: [t] } = await db.query("SELECT * FROM receipt_templates WHERE is_active = true LIMIT 1");
        template = t || null;
      } catch { /* no template table or no active template */ }

      const currencySymbol = req.company?.currency_symbol || "PKRs";
      const storeName = req.company?.company_name || "Store";
      const { buildReceiptEmailHtml } = require("../utils/receiptEmail");
      const html = buildReceiptEmailHtml(sale, items, payments, template, currencySymbol);
      const subject = `Receipt from ${storeName} — ${sale.invoice_number || `#${sale.id}`}`;

      // Try SMTP first
      const { rows: [cfg] } = await db.query("SELECT * FROM email_config WHERE id = 1").catch(() => ({ rows: [] }));
      if (cfg && cfg.smtp_host) {
        const nodemailer = require("nodemailer");
        const transport = nodemailer.createTransport({
          host: cfg.smtp_host,
          port: Number(cfg.smtp_port || 587),
          secure: Number(cfg.smtp_port) === 465,
          auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
        });
        await transport.sendMail({ from: cfg.from_email || cfg.smtp_user, to: toEmail, subject, html });
        return res.json({ ok: true, via: "smtp" });
      }

      // Resend fallback
      if (process.env.RESEND_API_KEY) {
        const { Resend } = require("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || "SanoPOS <onboarding@resend.dev>",
          to: toEmail,
          subject,
          html,
        });
        return res.json({ ok: true, via: "resend" });
      }

      return res.status(400).json({ error: "No email service configured" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/routes/email.js
git commit -m "feat: receipt email endpoint with SMTP + Resend fallback"
```

---

### Task 2: Receipt Email — Frontend Button

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSReceiptModal.jsx`

**Step 1: Enhance the existing email receipt flow**

The modal already has an email button and `POSEmailReceiptModal` child. Check if the existing email modal uses the old `send-receipt` endpoint and update it to use `send-receipt-v2`. Read `POSEmailReceiptModal` to see its current implementation. If it already calls `/api/email/send-receipt`, update the URL to `/api/email/send-receipt-v2`.

Also add a WhatsApp share button (Task 3 will create the utility, but add the button now):

After the Email Receipt button in the footer (around line 183), add:

```jsx
<button
  onClick={() => {
    const receiptUrl = `${window.location.origin}/receipt/${sections.invoiceNumber}`;
    const text = `Receipt from ${sections.storeName}\nInvoice: ${sections.invoiceNumber}\nTotal: ${money(slip.total)}\nView: ${receiptUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }}
  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold bg-green-500 hover:bg-green-600 text-white transition"
>
  <MessageCircle size={16} /> WhatsApp
</button>
```

Import `MessageCircle` from `lucide-react` at the top.

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSReceiptModal.jsx
git commit -m "feat: receipt email + WhatsApp share buttons in POS receipt modal"
```

---

### Task 3: Shareable Receipt URL — Backend

**Files:**
- Create: `backend/routes/receipts.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Step 1: Create public receipt endpoint**

Create `backend/routes/receipts.js`:

```js
module.exports = function mountReceiptRoutes(app, deps) {
  const db = deps.db;

  // GET /api/receipts/:invoiceNumber/public — no auth, public receipt view
  app.get("/api/receipts/:invoiceNumber/public", async (req, res) => {
    const { invoiceNumber } = req.params;
    try {
      const { rows: [sale] } = await db.query(
        `SELECT s.*, o.name as outlet_name, o.address as outlet_address, o.phone as outlet_phone,
                e.name as employee_name, c.name as customer_name,
                cp.company_name, cp.logo_url, cp.currency_symbol, cp.address as company_address,
                cp.phone as company_phone
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         CROSS JOIN company_profile cp
         WHERE s.invoice_number = $1 AND s.voided = false`,
        [invoiceNumber]
      );
      if (!sale) return res.status(404).json({ error: "Receipt not found" });

      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name, p.sku
         FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = $1`, [sale.id]
      );
      const { rows: payments } = await db.query(
        "SELECT * FROM sale_payments WHERE sale_id = $1", [sale.id]
      );

      res.json({
        store: {
          name: sale.company_name,
          logo: sale.logo_url,
          address: sale.outlet_address || sale.company_address,
          phone: sale.outlet_phone || sale.company_phone,
        },
        sale: {
          invoice_number: sale.invoice_number,
          timestamp: sale.timestamp,
          total_amount: sale.total_amount,
          discount_amount: sale.discount_amount,
          discount_type: sale.discount_type,
          employee_name: sale.employee_name,
          customer_name: sale.customer_name,
          notes: sale.notes,
          currency_symbol: sale.currency_symbol || "PKRs",
        },
        items: items.map((i) => ({
          name: i.product_name,
          sku: i.sku,
          quantity: i.quantity,
          price: i.price_at_sale,
          total: (i.quantity * i.price_at_sale).toFixed(2),
        })),
        payments: payments.map((p) => ({
          method: p.payment_method,
          amount: p.amount,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load receipt" });
    }
  });
};
```

**Step 2: Mount before auth middleware**

In `backend/routes/registerAllRoutes.js`, find where public routes are mounted (before `loadTenantAndPerms`). Add:

```js
const mountReceiptRoutes = require("./receipts");
// Mount after health check, before tenant middleware
mountReceiptRoutes(app, deps);
```

For multi-tenant, this endpoint needs to resolve the tenant from the sale. Since we're querying by `invoice_number`, we need to search across tenant schemas. Two options:
- Option A: Add `?tenant=slug` query param (like kiosk)
- Option B: Store tenant slug in invoice_number prefix

Use Option A — add `?tenant=slug` to the URL. The frontend receipt page will include it.

Update the route to resolve tenant DB:

```js
app.get("/api/receipts/:invoiceNumber/public", async (req, res) => {
  const { invoiceNumber } = req.params;
  const tenantSlug = req.query.tenant;

  let queryDb = db;
  if (process.env.MULTI_TENANT === "1") {
    if (!tenantSlug) return res.status(400).json({ error: "tenant parameter required" });
    const tenantDbManager = deps.tenantDbManager;
    try {
      queryDb = await tenantDbManager.getDb(tenantSlug);
    } catch {
      return res.status(404).json({ error: "Store not found" });
    }
  }
  // ... rest of query using queryDb instead of db
});
```

**Step 3: Commit**

```bash
git add backend/routes/receipts.js backend/routes/registerAllRoutes.js
git commit -m "feat: public receipt API endpoint for shareable receipt URLs"
```

---

### Task 4: Shareable Receipt URL — Frontend Page

**Files:**
- Create: `frontend/src/pages/ReceiptPublicPage.jsx`
- Modify: `frontend/src/App.jsx`

**Step 1: Create ReceiptPublicPage.jsx**

```jsx
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export default function ReceiptPublicPage() {
  const { invoiceNumber } = useParams();
  const [searchParams] = useSearchParams();
  const tenant = searchParams.get("tenant") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const qs = tenant ? `?tenant=${tenant}` : "";
    fetch(`${API}/api/receipts/${encodeURIComponent(invoiceNumber)}/public${qs}`)
      .then((r) => { if (!r.ok) throw new Error("Receipt not found"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [invoiceNumber, tenant]);

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Receipt Not Found</h1>
        <p className="text-gray-500">This receipt may have been voided or does not exist.</p>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Loading receipt...</p>
    </div>
  );

  const { store, sale, items, payments } = data;
  const sym = sale.currency_symbol;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600 text-white px-6 py-5 text-center">
          {store.logo && <img src={store.logo} alt="" className="h-10 mx-auto mb-2" />}
          <h1 className="text-xl font-bold">{store.name}</h1>
          {store.address && <p className="text-emerald-100 text-sm mt-1">{store.address}</p>}
          {store.phone && <p className="text-emerald-100 text-sm">{store.phone}</p>}
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Meta */}
          <div className="flex justify-between text-sm text-gray-500">
            <span>Invoice: <strong className="text-gray-800">{sale.invoice_number}</strong></span>
            <span>{new Date(sale.timestamp).toLocaleDateString()}</span>
          </div>
          {sale.customer_name && <p className="text-sm text-gray-500">Customer: {sale.customer_name}</p>}
          {sale.employee_name && <p className="text-sm text-gray-500">Served by: {sale.employee_name}</p>}

          {/* Items */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-2">Item</th>
                <th className="text-center py-2">Qty</th>
                <th className="text-right py-2">Price</th>
                <th className="text-right py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2 text-gray-800">{item.name}</td>
                  <td className="py-2 text-center text-gray-600">{item.quantity}</td>
                  <td className="py-2 text-right text-gray-600">{sym} {Number(item.price).toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-800 font-medium">{sym} {Number(item.total).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-3 space-y-1">
            {sale.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Discount</span>
                <span>-{sym} {Number(sale.discount_amount).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-gray-800">
              <span>Total</span>
              <span>{sym} {Number(sale.total_amount).toLocaleString()}</span>
            </div>
          </div>

          {/* Payments */}
          <div className="border-t border-gray-200 pt-3">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Payment</p>
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-600">{p.method}</span>
                <span className="text-gray-800">{sym} {Number(p.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>

          {sale.notes && (
            <div className="border-t border-gray-200 pt-3">
              <p className="text-xs text-gray-400">Note: {sale.notes}</p>
            </div>
          )}
        </div>

        {/* Print button */}
        <div className="px-6 pb-5">
          <button
            onClick={() => window.print()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition"
          >
            <Printer size={16} /> Print Receipt
          </button>
        </div>

        <div className="bg-gray-50 px-6 py-3 text-center">
          <p className="text-xs text-gray-400">Powered by SanoPOS</p>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add public route in App.jsx**

Add lazy import:
```js
const ReceiptPublicPage = lazy(() => import("./pages/ReceiptPublicPage"));
```

Add route after `/reset-password` (public, no auth):
```jsx
<Route path="/receipt/:invoiceNumber" element={<Suspense fallback={<RouteLoading />}><ReceiptPublicPage /></Suspense>} />
```

**Step 3: Commit**

```bash
git add frontend/src/pages/ReceiptPublicPage.jsx frontend/src/App.jsx
git commit -m "feat: public shareable receipt page"
```

---

### Task 5: WhatsApp Share — already done in Task 2

The WhatsApp button was added in Task 2's POSReceiptModal changes. No separate task needed.

---

### Task 6: Bulk Import — Database Migration

**Files:**
- Modify: `backend/migrate-pg.js`

**Step 1: Add migration v4 — onboarding_dismissed + backup_log**

In `backend/migrate-pg.js`, add migration version 4:

```js
async function migrate_v4(client) {
  // Onboarding dismissed flag
  await client.query(`
    ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS onboarding_dismissed BOOLEAN DEFAULT false
  `);

  // Backup log table
  await client.query(`
    CREATE TABLE IF NOT EXISTS backup_log (
      id SERIAL PRIMARY KEY,
      schema_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      size_bytes BIGINT DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
```

**Step 2: Register migration in the version map**

Add `4: migrate_v4` to the migrations object.

**Step 3: Also update `schema-pg.sql`** to include these for new tenants:

Add `onboarding_dismissed BOOLEAN DEFAULT false` to `company_profile` table definition.

Add the `backup_log` table definition after existing tables.

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat: migration v4 — onboarding_dismissed + backup_log table"
```

---

### Task 7: Bulk Import — Backend Endpoints

**Files:**
- Create: `backend/routes/import.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Step 1: Create import routes**

Create `backend/routes/import.js`:

```js
const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = function mountImportRoutes(app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  function parseFile(buffer, originalname) {
    const ext = originalname.toLowerCase().split(".").pop();
    if (ext === "csv") {
      const wb = XLSX.read(buffer, { type: "buffer" });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else if (ext === "xlsx" || ext === "xls") {
      const wb = XLSX.read(buffer, { type: "buffer" });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    }
    throw new Error("Unsupported file format. Use .csv or .xlsx");
  }

  // POST /api/import/products — bulk import products
  app.post("/api/import/products", requirePerm("all_access"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const rows = parseFile(req.file.buffer, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: "File is empty" });

      const errors = [];
      const valid = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.name) { errors.push({ row: i + 2, error: "name is required" }); continue; }
        if (!r.selling_price && r.selling_price !== 0) { errors.push({ row: i + 2, error: "selling_price is required" }); continue; }

        // Lookup category by name
        let category_id = null;
        if (r.category_name) {
          const { rows: cats } = await db.query("SELECT id FROM categories WHERE name ILIKE $1 LIMIT 1", [r.category_name.trim()]);
          if (cats.length) category_id = cats[0].id;
        }

        // Lookup brand by name
        let brand_id = null;
        if (r.brand_name) {
          const { rows: brands } = await db.query("SELECT id FROM brands WHERE name ILIKE $1 LIMIT 1", [r.brand_name.trim()]);
          if (brands.length) brand_id = brands[0].id;
        }

        // Lookup tax group by name
        let tax_group_id = null;
        if (r.tax_group_name) {
          const { rows: taxes } = await db.query("SELECT id FROM tax_groups WHERE name ILIKE $1 LIMIT 1", [r.tax_group_name.trim()]);
          if (taxes.length) tax_group_id = taxes[0].id;
        }

        valid.push({
          name: r.name.trim(),
          sku: r.sku?.trim() || null,
          barcode: r.barcode?.trim() || null,
          selling_price: Number(r.selling_price),
          cost_price: Number(r.cost_price || 0),
          category_id,
          brand_id,
          tax_group_id,
          reorder_level: Number(r.reorder_level || 0),
          unit: r.unit?.trim() || "pcs",
          stock_quantity: Number(r.stock_quantity || 0),
        });
      }

      if (req.query.preview === "1") {
        return res.json({ valid: valid.length, errors, preview: valid.slice(0, 10) });
      }

      // Bulk insert in transaction
      let imported = 0;
      await db.transaction(async (client) => {
        for (const p of valid) {
          const { rows: [product] } = await client.query(
            `INSERT INTO products (name, sku, barcode, selling_price, cost_price, category_id, brand_id, tax_group_id, reorder_level, unit)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [p.name, p.sku, p.barcode, p.selling_price, p.cost_price, p.category_id, p.brand_id, p.tax_group_id, p.reorder_level, p.unit]
          );
          // Set initial stock if provided
          if (p.stock_quantity > 0 && req.headers["x-outlet-id"]) {
            await client.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
               ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
              [product.id, Number(req.headers["x-outlet-id"]), p.stock_quantity]
            );
          }
          imported++;
        }
      });

      res.json({ imported, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/import/customers — bulk import customers
  app.post("/api/import/customers", requirePerm("all_access"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const rows = parseFile(req.file.buffer, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: "File is empty" });

      const errors = [];
      const valid = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.name) { errors.push({ row: i + 2, error: "name is required" }); continue; }
        valid.push({
          name: r.name.trim(),
          phone: r.phone?.trim() || null,
          email: r.email?.trim() || null,
          address: r.address?.trim() || null,
        });
      }

      if (req.query.preview === "1") {
        return res.json({ valid: valid.length, errors, preview: valid.slice(0, 10) });
      }

      let imported = 0;
      await db.transaction(async (client) => {
        for (const c of valid) {
          await client.query(
            "INSERT INTO customers (name, phone, email, address) VALUES ($1,$2,$3,$4)",
            [c.name, c.phone, c.email, c.address]
          );
          imported++;
        }
      });

      res.json({ imported, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/import/suppliers — bulk import suppliers
  app.post("/api/import/suppliers", requirePerm("all_access"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const rows = parseFile(req.file.buffer, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: "File is empty" });

      const errors = [];
      const valid = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.name) { errors.push({ row: i + 2, error: "name is required" }); continue; }
        valid.push({
          name: r.name.trim(),
          contact_person: r.contact_person?.trim() || null,
          phone: r.phone?.trim() || null,
          email: r.email?.trim() || null,
          address: r.address?.trim() || null,
          credit_limit: Number(r.credit_limit || 0),
        });
      }

      if (req.query.preview === "1") {
        return res.json({ valid: valid.length, errors, preview: valid.slice(0, 10) });
      }

      let imported = 0;
      await db.transaction(async (client) => {
        for (const s of valid) {
          await client.query(
            "INSERT INTO suppliers (name, contact_person, phone, email, address, credit_limit) VALUES ($1,$2,$3,$4,$5,$6)",
            [s.name, s.contact_person, s.phone, s.email, s.address, s.credit_limit]
          );
          imported++;
        }
      });

      res.json({ imported, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/import/template/:entity — download xlsx template
  app.get("/api/import/template/:entity", requirePerm("all_access"), (req, res) => {
    const { entity } = req.params;
    const templates = {
      products: {
        headers: ["name", "sku", "barcode", "category_name", "brand_name", "tax_group_name", "selling_price", "cost_price", "stock_quantity", "reorder_level", "unit"],
        example: [
          { name: "Widget A", sku: "WDG-001", barcode: "1234567890", category_name: "Electronics", brand_name: "Acme", tax_group_name: "Standard Tax", selling_price: 1500, cost_price: 1000, stock_quantity: 50, reorder_level: 10, unit: "pcs" },
          { name: "Widget B", sku: "WDG-002", barcode: "1234567891", category_name: "Electronics", brand_name: "Acme", tax_group_name: "", selling_price: 2500, cost_price: 1800, stock_quantity: 30, reorder_level: 5, unit: "pcs" },
        ],
      },
      customers: {
        headers: ["name", "phone", "email", "address"],
        example: [
          { name: "Ali Khan", phone: "03001234567", email: "ali@example.com", address: "Lahore, Pakistan" },
          { name: "Sara Ahmed", phone: "03219876543", email: "", address: "Karachi, Pakistan" },
        ],
      },
      suppliers: {
        headers: ["name", "contact_person", "phone", "email", "address", "credit_limit"],
        example: [
          { name: "Pak Wholesale", contact_person: "Usman", phone: "04235551234", email: "usman@pakwholesale.com", address: "Lahore", credit_limit: 500000 },
          { name: "Metro Supply", contact_person: "Hassan", phone: "02135559876", email: "", address: "Karachi", credit_limit: 0 },
        ],
      },
    };

    const tmpl = templates[entity];
    if (!tmpl) return res.status(400).json({ error: "Invalid entity. Use: products, customers, suppliers" });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(tmpl.example, { header: tmpl.headers });
    XLSX.utils.book_append_sheet(wb, ws, entity);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=sanopos_${entity}_template.xlsx`);
    res.send(buf);
  });
};
```

**Step 2: Install xlsx on backend** (check if already available)

```bash
cd backend && npm list xlsx 2>/dev/null || npm install xlsx
```

**Step 3: Mount in registerAllRoutes.js**

Add after other route mounts:
```js
const mountImportRoutes = require("./import");
mountImportRoutes(app, deps);
```

**Step 4: Commit**

```bash
git add backend/routes/import.js backend/routes/registerAllRoutes.js backend/package.json backend/package-lock.json
git commit -m "feat: bulk import endpoints for products, customers, suppliers with xlsx templates"
```

---

### Task 8: Bulk Import — Frontend Page

**Files:**
- Create: `frontend/src/pages/redesign/ImportRedesign.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/ui/nav-config.js`

**Step 1: Create ImportRedesign.jsx**

Create `frontend/src/pages/redesign/ImportRedesign.jsx` — a page with 3 tabs (Products, Customers, Suppliers), each with:
- Download template button
- File upload area (drag & drop or click)
- Preview table showing parsed rows + errors
- Import button

The component should:
- Use `PageShell` with title "Bulk Import"
- Use tabs (simple button group, not a library)
- Upload via `FormData` to `POST /api/import/{entity}?preview=1` first
- Show preview with error rows highlighted in red
- On confirm, `POST /api/import/{entity}` without `?preview=1`
- Use `useToast()` for success/error feedback
- Template download: `GET /api/import/template/{entity}` via anchor tag

**Step 2: Add route in App.jsx**

Add lazy import:
```js
const ImportRedesign = lazy(() => import("./pages/redesign/ImportRedesign"));
```

Add route (admin-only):
```jsx
<Route path="/import" element={<RequirePerm perm="all_access"><ImportRedesign /></RequirePerm>} />
```

**Step 3: Add nav item in nav-config.js**

In the "Setup" group, add:
```js
{ name: "Import Data", path: "/import", icon: Upload, requiredPerm: "all_access" },
```

Import `Upload` from `lucide-react` at the top.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/ImportRedesign.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat: bulk import page with preview, templates, and error highlighting"
```

---

### Task 9: Backup Status Notifications

**Files:**
- Modify: `backend/utils/backup-pg.js`
- Modify: `backend/routes/admin.js`
- Modify: `frontend/src/pages/dashboard/` (add backup card)

**Step 1: Log backups to backup_log table**

In `backend/utils/backup-pg.js`, after a successful backup, insert into `backup_log`:

```js
// After backup stream completes
const masterDb = require("../master-db-pg");
await masterDb.query(
  "INSERT INTO backup_log (schema_name, status, size_bytes, duration_ms) VALUES ($1, $2, $3, $4)",
  [schemaName, "success", sizeBytes, durationMs]
);
```

And on failure:
```js
await masterDb.query(
  "INSERT INTO backup_log (schema_name, status, error_message, duration_ms) VALUES ($1, $2, $3, $4)",
  [schemaName, "failed", errorMessage, durationMs]
);
```

**Step 2: Add backup status endpoint**

In `backend/routes/admin.js`, add:

```js
// GET /api/admin/backup-status — latest backup per tenant
app.get("/api/admin/backup-status", requireSuperAdmin, async (req, res) => {
  const { rows } = await masterDb.query(
    `SELECT DISTINCT ON (schema_name) schema_name, status, size_bytes, duration_ms, error_message, created_at
     FROM backup_log ORDER BY schema_name, created_at DESC`
  );
  res.json({ backups: rows });
});
```

**Step 3: Dashboard backup card**

Create a small `BackupStatusCard.jsx` in `frontend/src/pages/dashboard/` that shows the last backup time and status. Only visible to admins. Amber if >24h, red if >72h.

**Step 4: Commit**

```bash
git add backend/utils/backup-pg.js backend/routes/admin.js frontend/src/pages/dashboard/BackupStatusCard.jsx
git commit -m "feat: backup status logging and dashboard notifications"
```

---

### Task 10: FBR E-Invoicing Export

**Files:**
- Create: `backend/routes/reports/fbr-export.js`
- Modify: `backend/routes/reports/` (register route)
- Modify: `frontend/src/pages/reports/` (add FBR tab or page)

**Step 1: Create FBR export endpoint**

Create `backend/routes/reports/fbr-export.js`:

```js
module.exports = function (app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  // GET /api/reports/fbr-export?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get("/api/reports/fbr-export", requirePerm("all_access"), async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to dates required" });

    const { rows: company } = await db.query("SELECT ntn, strn, company_name FROM company_profile WHERE id = 1");
    const cp = company[0] || {};

    const { rows } = await db.query(
      `SELECT s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
              c.name as buyer_name, c.phone as buyer_phone,
              si.quantity, si.price_at_sale, p.name as item_description,
              tg.name as tax_group_name, tg.rate as tax_rate
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON si.product_id = p.id
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN tax_groups tg ON p.tax_group_id = tg.id
       WHERE s.timestamp >= $1 AND s.timestamp < ($2::date + 1)
       AND s.voided = false
       ORDER BY s.timestamp`,
      [from, to]
    );

    const fbrRows = rows.map((r) => ({
      ntn: cp.ntn || "",
      strn: cp.strn || "",
      invoice_number: r.invoice_number,
      invoice_date: new Date(r.timestamp).toISOString().split("T")[0],
      buyer_name: r.buyer_name || "Walk-in",
      buyer_ntn: "",
      item_description: r.item_description,
      quantity: r.quantity,
      unit_price: r.price_at_sale,
      tax_rate: r.tax_rate || 0,
      tax_amount: ((r.price_at_sale * r.quantity * (r.tax_rate || 0)) / 100).toFixed(2),
      total_amount: (r.price_at_sale * r.quantity).toFixed(2),
    }));

    res.json({ rows: fbrRows, company: cp });
  });
};
```

**Step 2: Register in reports routes and add frontend tab**

Mount in `registerAllRoutes.js` or within the reports directory. Add a frontend component with date range picker + download CSV button.

**Step 3: Commit**

```bash
git add backend/routes/reports/fbr-export.js frontend/src/pages/reports/FBRExportTab.jsx
git commit -m "feat: FBR e-invoicing export with date range"
```

---

### Task 11: Onboarding Walkthrough

**Files:**
- Create: `frontend/src/pages/dashboard/OnboardingChecklist.jsx`
- Modify: `frontend/src/pages/redesign/DashboardRedesign.jsx`

**Step 1: Create OnboardingChecklist.jsx**

A card component that:
- Fetches counts from existing endpoints: products count, outlets count, shifts count, sales count
- Shows 4 checklist items with green checkmarks when complete
- Progress bar at top
- "Dismiss" button that calls `PUT /api/company-profile/onboarding-dismiss`

**Step 2: Add dismiss endpoint**

In backend, add to the company profile routes:
```js
app.put("/api/company-profile/onboarding-dismiss", async (req, res) => {
  await db.query("UPDATE company_profile SET onboarding_dismissed = true WHERE id = 1");
  res.json({ ok: true });
});
```

**Step 3: Mount in DashboardRedesign.jsx**

Show `<OnboardingChecklist />` at the top of dashboard when `!onboarding_dismissed`.

**Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/OnboardingChecklist.jsx frontend/src/pages/redesign/DashboardRedesign.jsx backend/routes/company-profile.js
git commit -m "feat: onboarding walkthrough checklist on dashboard"
```

---

### Task 12: Self-Service Signup

**Files:**
- Create: `frontend/src/pages/SignupPage.jsx`
- Modify: `backend/routes/auth.js`
- Modify: `frontend/src/App.jsx`

**Step 1: Add signup endpoint in auth.js**

```js
// POST /api/auth/signup — public self-service tenant registration
app.post("/api/auth/signup", async (req, res) => {
  if (!process.env.MULTI_TENANT || process.env.MULTI_TENANT !== "1") {
    return res.status(400).json({ error: "Signup is only available in multi-tenant mode" });
  }

  // Check feature flag (query master DB for global flag)
  // For now, check env var
  if (process.env.SELF_SERVICE_SIGNUP !== "1") {
    return res.status(400).json({ error: "Self-service signup is not enabled" });
  }

  const { store_name, owner_name, email, password, plan } = req.body || {};
  if (!store_name || !owner_name || !email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  // Generate slug from store name
  const slug = store_name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").substring(0, 30);

  try {
    // Check if slug exists
    const { rows: existing } = await masterDb.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (existing.length) return res.status(409).json({ error: "A store with this name already exists" });

    // Provision tenant
    const provisioner = require("../tenant-provisioner-pg");
    const result = await provisioner.provision({ slug, name: store_name, plan: plan || "free" });

    // Create admin employee with password
    const bcrypt = require("bcrypt");
    const password_hash = await bcrypt.hash(password, 10);
    const tenantDb = await deps.tenantDbManager.getDb(slug);
    await tenantDb.query(
      `INSERT INTO employees (name, username, pin_code, pin_hash, role_id, email, password_hash)
       VALUES ($1, $2, '0000', $3, 1, $4, $5)`,
      [owner_name, email, await bcrypt.hash("0000", 10), email, password_hash]
    );

    // Send welcome email via Resend
    if (process.env.RESEND_API_KEY) {
      const { Resend } = require("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const setupUrl = `${process.env.CORS_ORIGIN || "https://sanopos.vercel.app"}/setup?token=${result.setup_token}&tenant=${slug}`;
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "SanoPOS <onboarding@resend.dev>",
        to: email,
        subject: "Welcome to SanoPOS — Set up your store",
        html: `<h2>Welcome to SanoPOS, ${owner_name}!</h2>
               <p>Your store <strong>${store_name}</strong> has been created.</p>
               <p><a href="${setupUrl}" style="background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Complete Setup</a></p>
               <p>Or copy this link: ${setupUrl}</p>`,
      });
    }

    res.json({ ok: true, slug, message: "Store created! Check your email for setup instructions." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Create SignupPage.jsx**

Form with: store name, your name, email, password, plan selector (Free/Starter/Pro). Submit to `POST /api/auth/signup`. Success state shows "Check your email" message.

**Step 3: Add route in App.jsx**

```jsx
<Route path="/signup" element={<Suspense fallback={<RouteLoading />}><SignupPage /></Suspense>} />
```

**Step 4: Commit**

```bash
git add backend/routes/auth.js frontend/src/pages/SignupPage.jsx frontend/src/App.jsx
git commit -m "feat: self-service signup with tenant provisioning and welcome email"
```

---

### Task 13: Wave 1 Build Verification

**Step 1: Build frontend**
```bash
cd frontend && npm run build
```

**Step 2: Verify all commits**
```bash
git log --oneline -15
```

**Step 3: Commit any remaining fixes**

---

## WAVE 2: Integrations (Tasks 14-17)

---

### Task 14: Cloud Printing — Network TCP/IP

**Files:**
- Modify: `backend/services/printer.js`
- Modify: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx`

**Step 1:** Add `printToNetwork(host, port, escPosBuffer)` function to `printer.js` using Node `net.createConnection()`. Send raw ESC/POS bytes over TCP socket with 5s timeout.

**Step 2:** Update printer settings page — add "Network" radio option, IP/port fields, test print button.

**Step 3:** The `printer_config` table already has `connection_type`, `host`, `port` columns. No migration needed.

**Step 4: Commit**

```bash
git commit -m "feat: network TCP/IP cloud printing for ESC/POS printers"
```

---

### Task 15: Payroll Export

**Files:**
- Modify: `backend/routes/tier4/hr.js`
- Modify: `frontend/src/pages/redesign/HRManagementRedesign.jsx`

**Step 1:** Add `GET /api/hr/payroll-export?period_id=X` endpoint that joins `payroll_periods`, `payroll_line_items`, `employees`, `attendance_sessions` to generate CSV data.

**Step 2:** Add "Export Payroll" button on HR payroll tab using `downloadCsv()` utility.

**Step 3: Commit**

```bash
git commit -m "feat: payroll CSV export from HR management"
```

---

### Task 16: AI Insights — Pre-built Cards

**Files:**
- Create: `backend/routes/insights.js`
- Create: `frontend/src/pages/dashboard/InsightCards.jsx`
- Modify: `frontend/src/pages/redesign/DashboardRedesign.jsx`

**Step 1:** Create `GET /api/insights/auto` — runs 5 analytical queries:
1. Revenue % change vs last week
2. Top 5 products shift (compare this week vs last week)
3. Low stock count (below reorder level)
4. Busiest hour (group sales by hour)
5. Avg transaction value trend (this week vs last)

Returns `{ cards: [{ type, title, value, trend, detail }] }`.

**Step 2:** Create `InsightCards.jsx` — renders cards in a grid on dashboard. Color-coded: green for positive trends, red for negative, blue for info.

**Step 3:** Mount in dashboard.

**Step 4: Commit**

```bash
git commit -m "feat: pre-built AI insight cards on dashboard"
```

---

### Task 17: AI Insights — Claude Chat Panel

**Files:**
- Create: `backend/routes/insights-ai.js`
- Create: `frontend/src/pages/dashboard/AIChatPanel.jsx`
- Modify: `frontend/src/pages/redesign/DashboardRedesign.jsx`

**Step 1:** Install `@anthropic-ai/sdk`:
```bash
cd backend && npm install @anthropic-ai/sdk
```

**Step 2:** Create `POST /api/insights/ask` endpoint:
- Feature-flagged `ai_insights`
- Requires `ANTHROPIC_API_KEY` env var
- Gathers context: last 30 days sales summary, current inventory snapshot, top products
- Sends to Claude with system prompt: "You are a retail analytics assistant for {storeName}. Answer questions about sales, inventory, and business performance based on this data: {context}"
- Rate limit: 20 queries/day per tenant (counter in memory or Redis)

**Step 3:** Create `AIChatPanel.jsx` — floating button → expandable chat panel. Text input, message list, loading indicator. Session-only history (not persisted).

**Step 4:** Feature-flag the chat button — only visible when `ai_insights` flag is enabled.

**Step 5: Commit**

```bash
git commit -m "feat: AI-powered insights chat panel with Claude API"
```

---

## WAVE 3: Multi-Channel & Advanced (Tasks 18-22)

---

### Task 18: PWA Shell

**Files:**
- Create: `frontend/public/manifest.json`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.jsx` (service worker already registered)

**Step 1:** Create `manifest.json`:
```json
{
  "name": "SanoPOS",
  "short_name": "SanoPOS",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#10b981",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Step 2:** Add `<link rel="manifest" href="/manifest.json">` to `index.html`.

**Step 3:** Service worker is already registered in `main.jsx`. Ensure `public/sw.js` caches static assets.

**Step 4: Commit**

```bash
git commit -m "feat: PWA manifest for installable app"
```

---

### Task 19: WooCommerce Sync

**Files:**
- Create: `backend/routes/woocommerce/auth.js`
- Create: `backend/routes/woocommerce/import.js`
- Create: `backend/routes/woocommerce/sync.js`
- Create: `backend/routes/woocommerce/orders.js`
- Create: `frontend/src/pages/redesign/WooCommerceIntegrationRedesign.jsx`

Mirror the Shopify integration pattern. WooCommerce REST API v3 uses consumer key/secret authentication. Feature-flagged `woocommerce_integration`.

**Step 1:** Create auth endpoint — store WooCommerce URL + consumer key/secret in `integration_settings` table.

**Step 2:** Create product import — fetch products from WooCommerce API, map to SanoPOS schema, upsert.

**Step 3:** Create stock sync — push SanoPOS stock levels to WooCommerce.

**Step 4:** Create order import — fetch WooCommerce orders, create in SanoPOS.

**Step 5:** Create frontend page with tabs: Connection, Products, Orders, Sync Log.

**Step 6: Commit**

```bash
git commit -m "feat: WooCommerce integration (products, orders, stock sync)"
```

---

### Task 20: Delivery Dispatch — Database + Generic UI

**Files:**
- Modify: `backend/migrate-pg.js` (migration v5)
- Modify: `backend/schema-pg.sql`
- Create: `backend/routes/couriers.js`
- Create: `frontend/src/pages/redesign/CourierSettingsRedesign.jsx`

**Step 1:** Migration v5 — create `courier_integrations` table + pre-seed rows:

```sql
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

-- Pre-seed Pakistan couriers
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
  ('Swyft', 'swyft', 'https://swyft.pk/tracking/{tracking}')
ON CONFLICT DO NOTHING;
```

Also add `tracking_number`, `courier_id`, `shipped_at`, `delivered_at` columns to `orders` table.

**Step 2:** Create courier CRUD endpoints + ship order endpoint.

**Step 3:** Create courier settings page (enable/disable, API key entry, add custom courier).

**Step 4:** Add "Ship" button to order detail with courier selection.

**Step 5: Commit**

```bash
git commit -m "feat: courier dispatch system with tenant-configurable couriers"
```

---

### Task 21: Courier Adapters — Leopards

**Files:**
- Create: `backend/services/couriers/base-adapter.js`
- Create: `backend/services/couriers/generic-adapter.js`
- Create: `backend/services/couriers/leopards-adapter.js`

**Step 1:** Create base adapter interface:
```js
class BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options) { throw new Error("Not implemented"); }
  async getTracking(trackingNumber) { throw new Error("Not implemented"); }
  async cancelShipment(trackingNumber) { throw new Error("Not implemented"); }
}
```

**Step 2:** Create generic adapter (manual tracking, no API).

**Step 3:** Create Leopards adapter using their API. Read their API docs for booking/tracking endpoints.

**Step 4: Commit**

```bash
git commit -m "feat: courier adapter pattern with Leopards integration"
```

---

### Task 22: Final Build Verification + Push

**Step 1:** Build frontend: `cd frontend && npm run build`

**Step 2:** Run pg integration tests if available: `npx jest backend/tests/integration/pg-batch1-crud.test.js`

**Step 3:** Verify all commits: `git log --oneline -25`

**Step 4:** Push branch: `git push -u origin feature/roadmap-waves`

# ESC/POS Thermal Printer Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add silent hardware receipt printing via `POST /api/print/receipt` (USB + TCP/WiFi) with cash drawer kick, paper-width-aware formatting, and graceful fallback to browser popup when printer is offline.

**Architecture:** Backend `PrinterService` (`backend/services/printer.js`) loads `printer_config` from DB and sends ESC/POS commands via `node-thermal-printer`. A new route `backend/routes/printer.js` exposes `POST /api/print/receipt` and `GET /api/print/status`. Frontend `printToHardware()` in `receipt.js` calls the API first; only falls back to `buildReceiptHtml()` if `fallback: true` is returned. Barcode scanner is pure frontend — rapid keystroke detection on a hidden input in POS.

**Tech Stack:** `node-thermal-printer` (npm), Node.js `net` module (TCP), SQLite3 (printer_config), React + existing POSContext/receipt.js

---

## Task 1: Install npm package & create migration

**Files:**
- Modify: `backend/package.json`
- Create: `backend/migrate64.js`

**Step 1: Install node-thermal-printer**

```bash
cd backend
npm install node-thermal-printer
```

Expected output: `added 1 package` (or similar), no errors.

**Step 2: Create `backend/migrate64.js`**

```js
/**
 * migrate64.js — Add printer_config table
 *
 * Stores thermal printer connection settings (USB or TCP/WiFi),
 * paper width (chars per line), and cash drawer preference.
 * A single row (id=1) is seeded so the Settings UI always has
 * something to display even before the admin configures it.
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = path.join(__dirname, "oneshop.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS printer_config (
      id               INTEGER PRIMARY KEY,
      connection_type  TEXT    DEFAULT 'network',
      host             TEXT    DEFAULT '192.168.1.100',
      port             INTEGER DEFAULT 9100,
      usb_vendor_id    TEXT,
      usb_product_id   TEXT,
      paper_width      INTEGER DEFAULT 48,
      cash_drawer      INTEGER DEFAULT 1,
      is_active        INTEGER DEFAULT 1
    )
  `, (err) => {
    if (err) console.error("migrate64: create printer_config:", err.message);
    else console.log("migrate64: printer_config table ready.");
  });

  db.run(
    "INSERT OR IGNORE INTO printer_config (id) VALUES (1)",
    (err) => {
      if (err) console.error("migrate64: seed row:", err.message);
      else console.log("migrate64: default printer_config row seeded.");
    }
  );
});

db.close();
```

**Step 3: Run migration**

```bash
cd backend
node migrate64.js
```

Expected output:
```
migrate64: printer_config table ready.
migrate64: default printer_config row seeded.
```

**Step 4: Commit**

```bash
git add backend/migrate64.js backend/package.json backend/package-lock.json
git commit -m "feat: migrate64 — printer_config table + install node-thermal-printer"
```

---

## Task 2: Create PrinterService

**Files:**
- Create: `backend/services/printer.js`

**Step 1: Create `backend/services/` directory** (if it doesn't exist)

```bash
mkdir -p backend/services
```

**Step 2: Create `backend/services/printer.js`**

```js
/**
 * PrinterService — ESC/POS thermal printer integration.
 *
 * Supports USB and TCP/WiFi connections via node-thermal-printer.
 * All receipt layout is driven by paper_width (chars per line) from printer_config.
 * Cash drawer is kicked after every successful print if cash_drawer = 1.
 *
 * Usage:
 *   const { printReceipt, printerStatus } = require('./services/printer')(db);
 */

const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } =
  require("node-thermal-printer");

module.exports = function makePrinterService(db) {

  /** Load printer_config row id=1 from DB */
  function loadConfig() {
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM printer_config WHERE id = 1", (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  /** Build a ThermalPrinter instance from config */
  function buildPrinter(cfg) {
    const interfaceStr =
      cfg.connection_type === "usb"
        ? `usb://${cfg.usb_vendor_id}/${cfg.usb_product_id}`
        : `tcp://${cfg.host}:${cfg.port}`;

    return new ThermalPrinter({
      type: PrinterTypes.EPSON,          // ESC/POS compatible with most brands
      interface: interfaceStr,
      characterSet: CharacterSet.PC437_USA,
      removeSpecialCharacters: false,
      lineCharacter: "-",
      breakLine: BreakLine.WORD,
      options: { timeout: 3000 },        // 3s timeout — don't hang the cashier
    });
  }

  /**
   * Format a number as currency (PKR, no decimals).
   * Mirrors the fmt() helper in frontend/src/utils/receipt.js.
   */
  function fmtCurrency(n) {
    return `Rs ${Math.round(Number(n) || 0).toLocaleString("en-PK")}`;
  }

  /**
   * Left-pad a right-aligned value so the full string is exactly `width` chars.
   * e.g. padRow("Subtotal:", "Rs 500", 48) => "Subtotal:                        Rs 500"
   */
  function padRow(left, right, width) {
    const gap = width - left.length - right.length;
    if (gap <= 0) return `${left} ${right}`;
    return `${left}${" ".repeat(gap)}${right}`;
  }

  /** Center a string within `width` chars */
  function center(str, width) {
    if (str.length >= width) return str;
    const pad = Math.floor((width - str.length) / 2);
    return " ".repeat(pad) + str;
  }

  /** Divider line scaled to paper width */
  function divider(width, char = "-") {
    return char.repeat(width);
  }

  /**
   * Build the full receipt as ESC/POS printer commands.
   * All widths are derived from cfg.paper_width.
   */
  async function formatReceipt(printer, slip, template, cfg) {
    const W = cfg.paper_width || 48;

    const storeName  = template?.header_text || slip.outlet?.name || "OneShopPOS";
    const footerText = template?.footer_text  || "Thank you for your purchase!";
    const showBarcode = Boolean(template?.show_barcode);

    // --- HEADER ---
    printer.alignCenter();
    printer.bold(true);
    printer.println(storeName.slice(0, W));
    printer.bold(false);
    printer.println(divider(W, "="));

    printer.alignLeft();
    printer.println(`Date: ${slip.timestamp || new Date().toLocaleString()}`);
    printer.println(`Invoice: ${slip.invoiceNumber || "-"}`);
    if (slip.employee?.name)  printer.println(`Cashier: ${slip.employee.name}`);
    if (slip.customer?.name)  printer.println(`Customer: ${slip.customer.name}`);
    if (slip.returnedFrom)    printer.println(`Exchange for: ${slip.returnedFrom}`);
    printer.println(divider(W));

    // --- RETURNED ITEMS (exchange receipts) ---
    const returnedItems = slip.returnedItems || [];
    if (returnedItems.length > 0) {
      printer.println("RETURNED:");
      returnedItems.forEach((item) => {
        const qty   = `${item.quantity}x  ${item.name}`.slice(0, W - 10);
        const price = `- ${fmtCurrency(item.price * item.quantity)}`;
        printer.println(padRow(qty, price, W));
      });
      printer.println(divider(W));
      printer.println("NEW ITEMS:");
    }

    // --- CART ITEMS ---
    const cart = slip.cart || [];
    cart.forEach((item) => {
      const qty   = `${item.quantity}x  ${item.name}`.slice(0, W - 12);
      const price = fmtCurrency(item.price * item.quantity);
      printer.println(padRow(qty, price, W));
    });
    printer.println(divider(W));

    // --- TOTALS ---
    const subtotal = cart.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0
    );
    printer.println(padRow("Subtotal:", fmtCurrency(subtotal), W));

    const taxAmount = Number(slip.taxAmount || 0);
    if (taxAmount > 0)
      printer.println(padRow("GST (incl.):", fmtCurrency(taxAmount), W));

    const exchangeCredit = Number(slip.exchangeCredit || 0);
    const discountAmount = Number(slip.discountAmount || 0);
    if (exchangeCredit > 0) {
      printer.println(padRow("Return Credit:", `- ${fmtCurrency(exchangeCredit)}`, W));
    } else if (discountAmount > 0) {
      const label = slip.discountType === "percentage" ? "Discount (%):" : "Discount:";
      printer.println(padRow(label, `- ${fmtCurrency(discountAmount)}`, W));
    }

    printer.println(divider(W, "="));
    const isExchange  = returnedItems.length > 0;
    const totalLabel  = isExchange ? "BALANCE DUE:" : "TOTAL:";
    const totalValue  = slip.balanceDue != null
      ? Math.max(0, slip.balanceDue)
      : (slip.total || 0);
    printer.bold(true);
    printer.println(padRow(totalLabel, fmtCurrency(totalValue), W));
    printer.bold(false);
    printer.println(divider(W, "="));

    // --- PAYMENTS ---
    const payments = (slip.payments || []).filter(p => p.method !== "Return Credit");
    payments.forEach((p) => {
      printer.println(padRow(`${p.method}:`, fmtCurrency(p.amount), W));
    });
    if ((slip.change || 0) > 0)
      printer.println(padRow("Change:", fmtCurrency(slip.change), W));

    if (slip.refundNote) {
      const refundAmt = Math.abs(slip.balanceDue || 0);
      printer.println(padRow("Refund to Customer:", fmtCurrency(refundAmt), W));
    }

    // --- ORDER NOTE ---
    if (slip.orderNote) {
      printer.println(divider(W));
      printer.println(`Note: ${slip.orderNote}`);
    }

    // --- BARCODE (invoice number as text) ---
    if (showBarcode && slip.invoiceNumber) {
      printer.println(divider(W));
      printer.alignCenter();
      printer.println(slip.invoiceNumber);
      printer.alignLeft();
    }

    // --- FOOTER ---
    printer.println(divider(W));
    printer.alignCenter();
    printer.println(footerText.slice(0, W));
    printer.println(divider(W, "="));

    printer.cut();
  }

  /**
   * Print a receipt slip to the configured thermal printer.
   * Returns { ok: true } on success, { error: string, fallback: true } on failure.
   */
  async function printReceipt(slip, template) {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (err) {
      return { error: `DB error: ${err.message}`, fallback: true };
    }

    if (!cfg || !cfg.is_active) {
      return { error: "Printer not configured or inactive.", fallback: true };
    }

    let printer;
    try {
      printer = buildPrinter(cfg);
    } catch (err) {
      return { error: `Printer init error: ${err.message}`, fallback: true };
    }

    try {
      await formatReceipt(printer, slip, template, cfg);

      // Kick cash drawer (ESC/POS pulse on pin 2)
      if (cfg.cash_drawer) {
        printer.openCashDrawer();
      }

      await printer.execute();
      return { ok: true };
    } catch (err) {
      return { error: `Print failed: ${err.message}`, fallback: true };
    }
  }

  /**
   * Check if the configured printer is reachable (TCP only; USB always returns unknown).
   * Returns { reachable: true/false, connectionType, host?, port?, error? }
   */
  async function printerStatus() {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (err) {
      return { reachable: false, error: err.message };
    }

    if (!cfg || !cfg.is_active) {
      return { reachable: false, error: "Printer not configured or inactive." };
    }

    if (cfg.connection_type === "usb") {
      // USB reachability can't be checked without attempting a print
      return { reachable: null, connectionType: "usb", note: "USB status unknown until print attempt." };
    }

    // TCP ping
    const net = require("net");
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: cfg.host, port: cfg.port, timeout: 2000 });
      socket.once("connect", () => {
        socket.destroy();
        resolve({ reachable: true, connectionType: "network", host: cfg.host, port: cfg.port });
      });
      socket.once("error", (err) => {
        resolve({ reachable: false, connectionType: "network", host: cfg.host, port: cfg.port, error: err.message });
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve({ reachable: false, connectionType: "network", host: cfg.host, port: cfg.port, error: "Connection timed out." });
      });
    });
  }

  return { printReceipt, printerStatus };
};
```

**Step 3: Commit**

```bash
git add backend/services/printer.js
git commit -m "feat: add PrinterService — ESC/POS USB+TCP, paper-width-aware, cash drawer"
```

---

## Task 3: Create printer route

**Files:**
- Create: `backend/routes/printer.js`

**Step 1: Create `backend/routes/printer.js`**

```js
/**
 * Printer routes — hardware receipt printing via ESC/POS
 *
 * POST /api/print/receipt  — print a sale slip to thermal printer
 * GET  /api/print/status   — check if configured printer is reachable
 *
 * Both endpoints require an authenticated employee (x-employee-id header).
 * If printer is offline or not configured, returns { error, fallback: true }
 * so the frontend can silently fall back to the browser popup.
 */

module.exports = function printerRoutes(app, deps) {
  const { db } = deps;
  const { printReceipt, printerStatus } = require("../services/printer")(db);

  // POST /api/print/receipt
  // Body: { slip: object, template: object|null }
  app.post("/api/print/receipt", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const { slip, template } = req.body || {};
    if (!slip) return res.status(400).json({ error: "slip is required" });

    const result = await printReceipt(slip, template || null);
    // Always return 200 — frontend checks result.fallback, not HTTP status
    return res.json(result);
  });

  // GET /api/print/status
  // Used by the Test Print button in Printer Settings
  app.get("/api/print/status", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const result = await printerStatus();
    return res.json(result);
  });
};
```

**Step 2: Register the route in `backend/routes/registerAllRoutes.js`**

Find the last `require()` route registration line (around line 323: `require("./sales")(app, deps)`). Add the printer route directly after the receipt-templates route. Search for `receipt-templates` in the file:

```js
  // --- ROUTES: RECEIPT TEMPLATES ---
  require("./receipt-templates")(app, deps);

  // --- ROUTES: PRINTER (ESC/POS hardware) ---
  require("./printer")(app, deps);
```

**Step 3: Test the route responds (without printer hardware)**

Start the backend: `cd backend && npm start`

```bash
curl -X GET http://localhost:5000/api/print/status \
  -H "x-employee-id: 1"
```

Expected response:
```json
{ "reachable": false, "connectionType": "network", "host": "192.168.1.100", "port": 9100, "error": "Connection refused" }
```
(Or similar — printer is not connected, but the route works.)

**Step 4: Commit**

```bash
git add backend/routes/printer.js backend/routes/registerAllRoutes.js
git commit -m "feat: add /api/print/receipt and /api/print/status routes"
```

---

## Task 4: Add `printToHardware` to frontend receipt.js

**Files:**
- Modify: `frontend/src/utils/receipt.js`

**Step 1: Add `printToHardware` export at the bottom of `frontend/src/utils/receipt.js`**

Append after line 191 (after the closing `}` of `buildReceiptHtml`):

```js
/**
 * Send a slip to the backend hardware printer.
 * Returns { ok: true } on success, { error, fallback: true } if printer
 * is offline or not configured — caller should then fire buildReceiptHtml().
 *
 * @param {object} slip      - The sale slip object
 * @param {object|null} template - Active receipt template
 * @returns {Promise<{ok?: boolean, error?: string, fallback?: boolean}>}
 */
export async function printToHardware(slip, template) {
  try {
    const res = await fetch("/api/print/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slip, template: template || null }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, fallback: true };
    return await res.json();
  } catch (err) {
    return { error: err.message, fallback: true };
  }
}
```

**Important:** The URL is `/api/print/receipt` (no `${API}` prefix) because `AuthProvider.jsx` patches `window.fetch` to inject `x-outlet-id` and `x-company-id` headers when the URL contains `/api/` — this is correct behaviour.

**Step 2: Commit**

```bash
git add frontend/src/utils/receipt.js
git commit -m "feat: add printToHardware() to receipt.js — calls /api/print/receipt with fallback"
```

---

## Task 5: Wire printToHardware into POSContext

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Step 1: Find the current `printSlip` function in `POSContext.jsx`**

Search for `printSlip` — it looks like this (around line 606):

```js
const printSlip = (s) => {
  buildReceiptHtml(s, receiptTemplate);
};
```

**Step 2: Replace `printSlip` with the hardware-first version**

```js
const printSlip = async (s) => {
  const result = await printToHardware(s, receiptTemplate);
  if (result.fallback) {
    // Printer offline or not configured — fall back to browser popup
    buildReceiptHtml(s, receiptTemplate);
  }
  // If result.ok: silent hardware print succeeded, no browser popup needed
};
```

**Step 3: Add `printToHardware` to the import at the top of POSContext.jsx**

Find the existing import line for `receipt.js`:
```js
import { buildReceiptHtml, buildReceiptSections } from "../../../utils/receipt";
```
Change it to:
```js
import { buildReceiptHtml, buildReceiptSections, printToHardware } from "../../../utils/receipt";
```

**Step 4: Verify the change compiles**

```bash
cd frontend
npm run build
```

Expected: build succeeds with no errors. (No new warnings expected from this change.)

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat: POSContext printSlip tries hardware print first, falls back to browser popup"
```

---

## Task 6: Printer Settings UI

**Files:**
- Create: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx`
- Modify: `frontend/src/ui/nav-config.js` (add nav entry)

**Step 1: Create `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx`**

```jsx
import { useState, useEffect } from "react";
import { PageShell } from "../../ui/primitives";

const API = "http://localhost:5000";

const PAPER_SIZES = [
  { label: "80mm — 48 chars (standard)", value: 48 },
  { label: "76mm — 42 chars", value: 42 },
  { label: "58mm — 32 chars (mini)", value: 32 },
  { label: "57mm — 30 chars (narrow)", value: 30 },
  { label: "Custom", value: "custom" },
];

export default function PrinterSettingsRedesign() {
  const [cfg, setCfg] = useState({
    connection_type: "network",
    host: "192.168.1.100",
    port: 9100,
    usb_vendor_id: "",
    usb_product_id: "",
    paper_width: 48,
    cash_drawer: 1,
    is_active: 1,
  });
  const [customWidth, setCustomWidth] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/print/config`, {
      headers: { "x-employee-id": localStorage.getItem("employeeId") || "1" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          setCfg(data);
          const predefined = PAPER_SIZES.find((s) => s.value === data.paper_width);
          if (!predefined || predefined.value === "custom") {
            setIsCustom(true);
            setCustomWidth(String(data.paper_width));
          }
        }
      })
      .catch(() => {});
  }, []);

  function handleChange(field, value) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  function handlePaperSize(val) {
    if (val === "custom") {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      handleChange("paper_width", Number(val));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const body = { ...cfg };
    if (isCustom) body.paper_width = Number(customWidth) || 48;
    try {
      const res = await fetch(`${API}/api/print/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-employee-id": localStorage.getItem("employeeId") || "1",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const statusRes = await fetch(`${API}/api/print/status`, {
        headers: { "x-employee-id": localStorage.getItem("employeeId") || "1" },
      });
      const status = await statusRes.json();
      if (!status.reachable && status.reachable !== null) {
        setTestResult({ ok: false, message: status.error || "Printer unreachable" });
        return;
      }
      // Send a test print
      const printRes = await fetch(`${API}/api/print/receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-employee-id": localStorage.getItem("employeeId") || "1",
        },
        body: JSON.stringify({
          slip: {
            invoiceNumber: "TEST-001",
            timestamp: new Date().toLocaleString(),
            cart: [{ name: "Test Item", quantity: 1, price: 100 }],
            payments: [{ method: "Cash", amount: 100 }],
            total: 100,
            change: 0,
            outlet: { name: "Test Store" },
            employee: { name: "Test Cashier" },
            taxAmount: 0,
            discountAmount: 0,
          },
          template: null,
        }),
      });
      const printData = await printRes.json();
      if (printData.ok) {
        setTestResult({ ok: true, message: "Printer OK — test receipt printed!" });
      } else {
        setTestResult({ ok: false, message: printData.error || "Print failed" });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageShell title="Printer Settings">
      <div className="max-w-lg space-y-6">

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <label className="font-medium">Enable Hardware Printing</label>
          <input
            type="checkbox"
            checked={Boolean(cfg.is_active)}
            onChange={(e) => handleChange("is_active", e.target.checked ? 1 : 0)}
          />
        </div>

        {/* Connection type */}
        <div>
          <label className="block font-medium mb-1">Connection Type</label>
          <div className="flex gap-4">
            {["network", "usb"].map((t) => (
              <label key={t} className="flex items-center gap-2 capitalize cursor-pointer">
                <input
                  type="radio"
                  name="connection_type"
                  value={t}
                  checked={cfg.connection_type === t}
                  onChange={() => handleChange("connection_type", t)}
                />
                {t === "network" ? "Network / WiFi (TCP)" : "USB"}
              </label>
            ))}
          </div>
        </div>

        {/* Network fields */}
        {cfg.connection_type === "network" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">IP Address</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.host}
                onChange={(e) => handleChange("host", e.target.value)}
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Port</label>
              <input
                type="number"
                className="border rounded px-3 py-2 w-full"
                value={cfg.port}
                onChange={(e) => handleChange("port", Number(e.target.value))}
                placeholder="9100"
              />
            </div>
          </div>
        )}

        {/* USB fields */}
        {cfg.connection_type === "usb" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">USB Vendor ID</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.usb_vendor_id || ""}
                onChange={(e) => handleChange("usb_vendor_id", e.target.value)}
                placeholder="0x04b8 (Epson)"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">USB Product ID</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.usb_product_id || ""}
                onChange={(e) => handleChange("usb_product_id", e.target.value)}
                placeholder="0x0202"
              />
            </div>
          </div>
        )}

        {/* Paper size */}
        <div>
          <label className="block font-medium mb-1">Paper Size</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={isCustom ? "custom" : cfg.paper_width}
            onChange={(e) => handlePaperSize(e.target.value)}
          >
            {PAPER_SIZES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {isCustom && (
            <input
              type="number"
              className="border rounded px-3 py-2 w-full mt-2"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder="Enter chars per line (e.g. 40)"
            />
          )}
        </div>

        {/* Cash drawer */}
        <div className="flex items-center gap-3">
          <label className="font-medium">Kick Cash Drawer on Sale</label>
          <input
            type="checkbox"
            checked={Boolean(cfg.cash_drawer)}
            onChange={(e) => handleChange("cash_drawer", e.target.checked ? 1 : 0)}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 items-center">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="border px-5 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test Print"}
          </button>
          {saved && <span className="text-green-600 text-sm">Settings saved.</span>}
        </div>

        {testResult && (
          <div className={`rounded px-4 py-3 text-sm ${testResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {testResult.message}
          </div>
        )}
      </div>
    </PageShell>
  );
}
```

**Step 2: Add `GET /api/print/config` and `PUT /api/print/config` to `backend/routes/printer.js`**

Add these two endpoints to the existing printer.js route file (before the closing `};`):

```js
  // GET /api/print/config — load current printer_config row
  app.get("/api/print/config", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    db.get("SELECT * FROM printer_config WHERE id = 1", (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || {});
    });
  });

  // PUT /api/print/config — save printer_config row
  app.put("/api/print/config", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    const {
      connection_type, host, port, usb_vendor_id, usb_product_id,
      paper_width, cash_drawer, is_active,
    } = req.body || {};
    db.run(
      `UPDATE printer_config SET
        connection_type = ?, host = ?, port = ?,
        usb_vendor_id = ?, usb_product_id = ?,
        paper_width = ?, cash_drawer = ?, is_active = ?
       WHERE id = 1`,
      [
        connection_type || "network",
        host || "192.168.1.100",
        Number(port) || 9100,
        usb_vendor_id || null,
        usb_product_id || null,
        Number(paper_width) || 48,
        cash_drawer ? 1 : 0,
        is_active ? 1 : 0,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      }
    );
  });
```

**Step 3: Add nav entry in `frontend/src/ui/nav-config.js`**

Find the Settings section in nav-config.js and add:
```js
{ label: "Printer Settings", path: "/printer-settings", icon: "Printer", perm: "all_access" }
```

**Step 4: Add route in `frontend/src/App.jsx` (or wherever routes are defined)**

Find where other `*Route` components are imported and add:
```jsx
<Route path="/printer-settings" element={<RequireAuth><RequirePerm perm="all_access"><PrinterSettingsRedesign /></RequirePerm></RequireAuth>} />
```
And import: `import PrinterSettingsRedesign from "./pages/redesign/PrinterSettingsRedesign";`

**Step 5: Build and verify**

```bash
cd frontend && npm run build
```

Expected: build succeeds, no errors.

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/PrinterSettingsRedesign.jsx \
        frontend/src/ui/nav-config.js \
        frontend/src/App.jsx \
        backend/routes/printer.js
git commit -m "feat: Printer Settings UI — connection type, paper size, cash drawer, test print"
```

---

## Task 7: Barcode Scanner Input in POS

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSRedesign.jsx` (or the product search area in POSContext)

**Step 1: Find where the product search input lives**

In `POSRedesign.jsx` or the relevant POS component, find the product search input. The barcode listener is a separate hidden input that auto-focuses.

**Step 2: Add barcode scanner hook**

Add this hook near the top of the POS component (after existing hooks, before any conditional returns):

```jsx
// Barcode scanner — detects rapid keystrokes (scanner types < 50ms between chars)
const barcodeBuffer = useRef("");
const barcodeTimer = useRef(null);

useEffect(() => {
  function handleKeyDown(e) {
    // Ignore if a modal is open or user is typing in an input/textarea
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (e.key === "Enter") {
      const code = barcodeBuffer.current.trim();
      barcodeBuffer.current = "";
      clearTimeout(barcodeTimer.current);
      if (code.length >= 3) {
        handleBarcodeScanned(code);
      }
      return;
    }

    if (e.key.length === 1) {
      barcodeBuffer.current += e.key;
      clearTimeout(barcodeTimer.current);
      // Clear buffer if no new char arrives within 100ms (not a scanner)
      barcodeTimer.current = setTimeout(() => {
        barcodeBuffer.current = "";
      }, 100);
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);  // handleBarcodeScanned must be stable (useCallback)
```

**Step 3: Add `handleBarcodeScanned` function**

Add this function (wrapped in `useCallback`) alongside other POS handlers:

```jsx
const handleBarcodeScanned = useCallback(async (barcode) => {
  try {
    const res = await fetch(`${API}/api/products?barcode=${encodeURIComponent(barcode)}`, {
      headers: { "x-employee-id": employeeId },
    });
    const data = await res.json();
    const product = Array.isArray(data) ? data[0] : data?.products?.[0];
    if (product) {
      addToCart(product);  // use existing addToCart from POSContext
    } else {
      // Show brief toast — reuse existing toast/notification pattern in POS
      setToast?.(`Barcode not found: ${barcode}`);
    }
  } catch (err) {
    console.error("Barcode lookup failed:", err);
  }
}, [employeeId, addToCart]);
```

**Step 4: Verify scanner works manually**

Open POS page in browser. Open browser console. Type quickly (simulate scanner): type `TEST123` and press Enter. Should see a network request to `/api/products?barcode=TEST123` in the Network tab.

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSRedesign.jsx
git commit -m "feat: barcode scanner input in POS — rapid keystroke detection, auto add to cart"
```

---

## Task 8: Integration test — fallback behaviour

**Files:**
- Create: `backend/tests/integration/printer.test.js`

**Step 1: Create `backend/tests/integration/printer.test.js`**

```js
const request = require("supertest");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const app = require("../../index");  // adjust if app export differs

describe("POST /api/print/receipt", () => {
  test("returns fallback:true when printer is inactive", async () => {
    // Set printer to inactive in test DB
    // (assumes test DB has printer_config seeded by migrate64)
    const res = await request(app)
      .post("/api/print/receipt")
      .set("x-employee-id", "1")
      .send({ slip: { invoiceNumber: "TEST-001", cart: [], payments: [], total: 0 }, template: null });

    expect(res.status).toBe(200);
    // Either ok:true (printer happened to connect) or fallback:true
    expect(res.body).toHaveProperty("fallback", true);
  });

  test("returns 401 without employee header", async () => {
    const res = await request(app)
      .post("/api/print/receipt")
      .send({ slip: {}, template: null });
    expect(res.status).toBe(401);
  });

  test("returns 400 without slip body", async () => {
    const res = await request(app)
      .post("/api/print/receipt")
      .set("x-employee-id", "1")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/print/status", () => {
  test("returns reachable field", async () => {
    const res = await request(app)
      .get("/api/print/status")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("reachable");
  });
});
```

**Step 2: Run tests**

```bash
cd backend
npx jest tests/integration/printer.test.js --verbose
```

Expected: all tests pass. The `fallback:true` test will pass because default printer config points to `192.168.1.100` which is not reachable in dev.

**Step 3: Commit**

```bash
git add backend/tests/integration/printer.test.js
git commit -m "test: printer route — fallback, auth, and status tests"
```

---

## Verification Checklist

- [ ] `node migrate64.js` creates `printer_config` table without error
- [ ] `GET /api/print/status` returns `{ reachable: false, ... }` (no printer connected yet)
- [ ] `POST /api/print/receipt` returns `{ fallback: true }` when printer inactive/unreachable
- [ ] Browser popup still fires after POS sale (fallback working end-to-end)
- [ ] Printer Settings page loads at `/printer-settings`
- [ ] Saving settings updates `printer_config` row (verify via SQLite browser or `sqlite3 oneshop.db "SELECT * FROM printer_config"`)
- [ ] Barcode scanner: type quickly in POS, press Enter → network request fires to `/api/products?barcode=...`
- [ ] All 3 Jest integration tests pass
- [ ] `npm run build` succeeds in frontend
- [ ] When hardware arrives: connect printer, set IP/port in Settings, click Test Print → receipt prints silently, cash drawer kicks

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
const net = require("net");

/**
 * Retry a printer.execute() call with exponential backoff.
 * Network printers on WiFi can drop briefly — one retry buys us resilience
 * without masking genuine connectivity outages. Total window at defaults:
 * attempt 0 (immediate) → 500ms wait → attempt 1 → 1000ms wait → attempt 2.
 *
 * Exported for unit testing (pure function — no DB/hardware dependencies).
 */
async function withRetry(fn, retries = 2, baseDelayMs = 500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
  }
}

module.exports = function makePrinterService(db) {

  /** Load printer_config row id=1 from DB (default/legacy) */
  async function loadConfig() {
    const { rows } = await db.query("SELECT * FROM printer_config WHERE id = 1");
    return rows[0] || null;
  }

  /**
   * 2-R.7 — Resolve which printer_config row to use given a purpose.
   * `purpose='receipt'` → default (legacy `id=1` or `is_default=true`).
   * `purpose='guest_bill'` → row matching purpose, else fallback to default.
   * `purpose='fire_chit'` + `station_id` → station's `printer_id`, else fallback.
   * Returns the full printer_config row or null.
   */
  async function resolvePrinterConfig({ purpose = "receipt", station_id = null, outlet_id = null } = {}) {
    if (purpose === "fire_chit" && station_id) {
      const { rows } = await db.query(
        `SELECT pc.* FROM printer_config pc
         JOIN kds_stations ks ON ks.printer_id = pc.id
         WHERE ks.id = $1 AND pc.is_active = true
         LIMIT 1`,
        [station_id]
      );
      if (rows[0]) return rows[0];
    }
    if (purpose === "guest_bill") {
      const { rows } = await db.query(
        `SELECT pc.* FROM printer_config pc
         WHERE pc.purpose = 'guest_bill' AND pc.is_active = true
         ORDER BY pc.id LIMIT 1`
      );
      if (rows[0]) return rows[0];
    }
    // Default: legacy behavior — id=1 if set, otherwise any receipt printer.
    const { rows } = await db.query(
      `SELECT * FROM printer_config
       WHERE is_active = true
         AND (id = 1 OR purpose = 'receipt')
       ORDER BY (id = 1) DESC, id ASC
       LIMIT 1`
    );
    return rows[0] || null;
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
   * Format a number as currency (no decimals).
   * Mirrors the fmt() helper in frontend/src/utils/receipt.js.
   */
  function fmtCurrency(n, symbol = "$") {
    return `${symbol} ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
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

  /** Divider line scaled to paper width */
  function divider(width, char = "-") {
    return char.repeat(width);
  }

  /**
   * Build the full receipt as ESC/POS printer commands.
   * All widths are derived from cfg.paper_width.
   */
  async function formatReceipt(printer, slip, template, cfg, currencySymbol = "$", labels = {}) {
    const W = cfg.paper_width || 48;
    const fmt = (n) => fmtCurrency(n, currencySymbol);

    const storeName  = template?.header_text || slip.outlet?.name || "SanoPOS";
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
    if (slip.customer?.name)  printer.println(`${labels.customer || "Customer"}: ${slip.customer.name}`);
    if (slip.returnedFrom)    printer.println(`Exchange for: ${slip.returnedFrom}`);
    printer.println(divider(W));

    // --- RETURNED ITEMS (exchange receipts) ---
    const returnedItems = slip.returnedItems || [];
    if (returnedItems.length > 0) {
      printer.println("RETURNED:");
      returnedItems.forEach((item) => {
        const qty   = `${item.quantity}x  ${item.name}`.slice(0, W - 10);
        const price = `- ${fmt(item.price * item.quantity)}`;
        printer.println(padRow(qty, price, W));
      });
      printer.println(divider(W));
      printer.println("NEW ITEMS:");
    }

    // --- CART ITEMS ---
    const cart = slip.cart || [];
    cart.forEach((item) => {
      const qty   = `${item.quantity}x  ${item.name}`.slice(0, W - 12);
      const price = fmt(item.price * item.quantity);
      printer.println(padRow(qty, price, W));
    });
    printer.println(divider(W));

    // --- TOTALS ---
    const subtotal = cart.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0
    );
    printer.println(padRow("Subtotal:", fmt(subtotal), W));

    const taxAmount = Number(slip.taxAmount || 0);
    if (taxAmount > 0)
      printer.println(padRow("GST (incl.):", fmt(taxAmount), W));

    const exchangeCredit = Number(slip.exchangeCredit || 0);
    const discountAmount = Number(slip.discountAmount || 0);
    if (exchangeCredit > 0) {
      printer.println(padRow("Return Credit:", `- ${fmt(exchangeCredit)}`, W));
    } else if (discountAmount > 0) {
      const label = slip.discountType === "percentage" ? "Discount (%):" : "Discount:";
      printer.println(padRow(label, `- ${fmt(discountAmount)}`, W));
    }

    printer.println(divider(W, "="));
    const isExchange  = returnedItems.length > 0;
    const totalLabel  = isExchange ? "BALANCE DUE:" : "TOTAL:";
    const totalValue  = slip.balanceDue != null
      ? Math.max(0, slip.balanceDue)
      : (slip.total || 0);
    printer.bold(true);
    printer.println(padRow(totalLabel, fmt(totalValue), W));
    printer.bold(false);
    printer.println(divider(W, "="));

    // --- PAYMENTS ---
    const payments = (slip.payments || []).filter(p => p.method !== "Return Credit");
    payments.forEach((p) => {
      printer.println(padRow(`${p.method}:`, fmt(p.amount), W));
    });
    if ((slip.change || 0) > 0)
      printer.println(padRow("Change:", fmt(slip.change), W));

    if (slip.refundNote) {
      const refundAmt = Math.abs(slip.balanceDue || 0);
      printer.println(padRow("Refund to Customer:", fmt(refundAmt), W));
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
   *
   * 2-R.7 optional params:
   *   opts.purpose ∈ {'receipt','fire_chit','guest_bill'}
   *   opts.station_id — when purpose='fire_chit', routes to station's printer
   *   opts.outlet_id — when purpose='guest_bill', narrows printer by outlet
   * When omitted, defaults to legacy behavior (receipt printer id=1).
   */
  async function printReceipt(slip, template, currencySymbol = "$", labels = {}, opts = {}) {
    const { purpose = "receipt", station_id = null, outlet_id = null } = opts;
    let cfg;
    try {
      // When a non-default purpose is requested, use the routing resolver
      // and fall back to the default receipt printer if none is wired up.
      cfg = purpose === "receipt"
        ? await loadConfig()
        : (await resolvePrinterConfig({ purpose, station_id, outlet_id })
            || await loadConfig());
      if (purpose !== "receipt" && cfg && cfg.purpose === "receipt") {
        // Purpose-specific printer not found — fall back with a warning.
        // Never silently drop a chit.
        try {
          const alerting = require("./alerting");
          if (alerting && typeof alerting.recordError === "function") {
            alerting.recordError(`printer_fallback_${purpose}`, `No printer configured for purpose=${purpose}; fell back to default receipt printer`);
          }
        } catch { /* alerting best-effort */ }
      }
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
      await formatReceipt(printer, slip, template, cfg, currencySymbol, labels);

      // Kick cash drawer (ESC/POS pulse on pin 2)
      if (cfg.cash_drawer) {
        printer.openCashDrawer();
      }

      if (cfg.connection_type === "network") {
        await withRetry(() => printer.execute());
      } else {
        await printer.execute();
      }
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
      return { reachable: null, connectionType: "usb", note: "USB status unknown until print attempt." };
    }

    // TCP ping
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

  /**
   * Send raw ESC/POS buffer to a network printer via TCP.
   * Resolves { ok: true } on success, rejects on error/timeout.
   */
  function printToNetwork(host, port, buffer) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ host, port }, () => {
        client.write(buffer, () => {
          client.end();
          resolve({ ok: true });
        });
      });
      client.setTimeout(5000);
      client.on("timeout", () => { client.destroy(); reject(new Error("Connection timeout")); });
      client.on("error", (err) => reject(err));
    });
  }

  /**
   * Print a test receipt to the configured printer.
   * Uses the same formatReceipt pipeline with sample data.
   */
  async function printTest() {
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
      const testSlip = {
        invoiceNumber: "TEST-001",
        timestamp: new Date().toLocaleString(),
        cart: [
          { name: "Test Item A", quantity: 2, price: 250 },
          { name: "Test Item B", quantity: 1, price: 500 },
        ],
        payments: [{ method: "Cash", amount: 1000 }],
        total: 1000,
        change: 0,
        outlet: { name: "Test Store" },
        employee: { name: "Test Cashier" },
        taxAmount: 0,
        discountAmount: 0,
      };
      const testTemplate = { header_text: "SanoPOS Test Print", footer_text: "Printer is working correctly!", show_barcode: false };

      await formatReceipt(printer, testSlip, testTemplate, cfg, "$");

      if (cfg.cash_drawer) {
        printer.openCashDrawer();
      }

      if (cfg.connection_type === "network") {
        await withRetry(() => printer.execute());
      } else {
        await printer.execute();
      }
      return { ok: true, message: "Test receipt printed successfully!" };
    } catch (err) {
      return { error: `Print failed: ${err.message}`, fallback: true };
    }
  }

  /**
   * Open the cash drawer without printing a receipt (no-sale / drop / safe-drop).
   * Returns { ok: true } or { ok: false, error: string }.
   * Callers should check result.ok — always returns 200 from the HTTP layer.
   */
  async function openDrawer() {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (err) {
      return { ok: false, error: `DB error: ${err.message}` };
    }

    if (!cfg || !cfg.is_active) {
      return { ok: false, error: "Printer not configured or inactive" };
    }
    if (!cfg.cash_drawer) {
      return { ok: false, error: "Cash drawer not enabled in printer config" };
    }

    try {
      const printer = buildPrinter(cfg);
      printer.openCashDrawer();
      if (cfg.connection_type === "network") {
        await withRetry(() => printer.execute());
      } else {
        await printer.execute();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Drawer open failed: ${err.message}` };
    }
  }

  return { printReceipt, printerStatus, printTest, printToNetwork, openDrawer, resolvePrinterConfig };
};

// Export withRetry for unit testing (pure function, no side effects).
module.exports.withRetry = withRetry;

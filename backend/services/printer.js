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

  return { printReceipt, printerStatus };
};

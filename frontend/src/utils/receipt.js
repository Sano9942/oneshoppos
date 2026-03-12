/**
 * Single source of truth for receipt data.
 * Both printSlip (popup) and POSReceiptModal (screen) consume this.
 *
 * @param {object} slip   - The sale slip object built at checkout/reprint/exchange
 * @param {object|null} template - Active receipt template from /api/receipt-templates/active
 * @returns {object} All receipt sections as plain values
 */
export function buildReceiptSections(slip, template, currencySymbol = "$") {
  const subtotal = (slip.cart || []).reduce(
    (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0),
    0,
  );

  const isExchange = (slip.returnedItems?.length || 0) > 0;
  const totalLabel = isExchange ? "Balance Due" : "Total";
  const totalValue = slip.balanceDue != null
    ? Math.max(0, slip.balanceDue)
    : (slip.total || 0);

  const payments = (slip.payments || []).filter(
    (p) => p.method !== "Return Credit",
  );

  return {
    // Branding — from template with fallbacks
    storeName: template?.header_text || slip.outlet?.name || "SanoPOS",
    footerText: template?.footer_text || "Thank you for your purchase!",
    showBarcode: Boolean(template?.show_barcode),

    // Header info
    // slip.timestamp must already be a display string (e.g. new Date().toLocaleString())
    // Do NOT pass a raw SQLite UTC string — use fmtDateTime() from utils/dates.js first
    timestamp: slip.timestamp || "",
    invoiceNumber: slip.offline ? "PENDING (offline)" : (slip.invoiceNumber || "-"),
    returnedFrom: slip.returnedFrom || null,
    employee: slip.employee || null,
    customer: slip.customer || null,

    // Items
    isExchange,
    returnedItems: slip.returnedItems || [],
    cartItems: slip.cart || [],
    subtotal,

    // Adjustments
    taxAmount: Number(slip.taxAmount || 0),
    exchangeCredit: Number(slip.exchangeCredit || 0),
    discountAmount: Number(slip.discountAmount || 0),
    discountType: slip.discountType || "fixed",

    // Totals
    totalLabel,
    totalValue,
    payments,
    refundToCustomer: slip.refundNote ? Math.abs(slip.balanceDue || 0) : null,
    change: Number(slip.change || 0),

    // Footer
    orderNote: slip.orderNote || null,
    offlineNote: slip.offline ? "Sale queued offline — final receipt available after sync" : null,
  };
}

function makeFmt(symbol = "$") {
  return (n) => `${symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Opens a browser print popup with the receipt rendered as HTML.
 * Uses buildReceiptSections internally — no logic duplication.
 *
 * @param {object} slip     - The sale slip object
 * @param {object|null} template - Active receipt template (null = use defaults)
 */
export function buildReceiptHtml(slip, template, currencySymbol = "$") {
  const fmt = makeFmt(currencySymbol);
  const s = buildReceiptSections(slip, template, currencySymbol);

  const w = window.open("", "_blank", "width=360,height=620");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print receipts.");
    return;
  }
  const d = w.document;

  const style = d.createElement("style");
  style.textContent = [
    "body{font-family:monospace;font-size:13px;width:300px;margin:0 auto;padding:12px}",
    ".row{display:flex;justify-content:space-between}",
    ".c{text-align:center}",
    "hr{border:none;border-top:1px dashed #999;margin:6px 0}",
    ".label{font-size:11px;font-weight:bold;text-transform:uppercase;color:#666;margin:4px 0 2px}",
    ".ret{color:#c0392b}",
  ].join(" ");
  d.head.appendChild(style);
  d.title = `Receipt ${s.invoiceNumber}`;

  const b = d.body;

  const txt = (tag, text, cls = "") => {
    const e = d.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const row = (l, r, cls = "") => {
    const e = d.createElement("div");
    e.className = cls ? `row ${cls}` : "row";
    e.appendChild(txt("span", l));
    e.appendChild(txt("span", r));
    return e;
  };
  const hr = () => d.createElement("hr");

  // Header
  b.appendChild(txt("div", s.storeName, "c"));
  b.appendChild(txt("div", s.timestamp, "c"));
  b.appendChild(txt("div", `Invoice: ${s.invoiceNumber}`, "c"));
  if (s.returnedFrom)
    b.appendChild(txt("div", `Exchange for: ${s.returnedFrom}`, "c"));
  if (s.employee)
    b.appendChild(txt("div", `Staff: ${s.employee.name}`, "c"));
  if (s.customer)
    b.appendChild(txt("div", `Customer: ${s.customer.name}${s.customer.mobile ? " · " + s.customer.mobile : ""}`, "c"));
  b.appendChild(hr());

  // Returned items (exchange receipts only)
  if (s.returnedItems.length > 0) {
    b.appendChild(txt("div", "Returned", "label"));
    s.returnedItems.forEach((item) =>
      b.appendChild(row(`${item.name} x${item.quantity}`, `- ${fmt(item.price * item.quantity)}`, "ret")),
    );
    b.appendChild(hr());
    b.appendChild(txt("div", "New Items", "label"));
  }

  // Cart items
  s.cartItems.forEach((item) =>
    b.appendChild(row(`${item.name} x${item.quantity}`, fmt(item.price * item.quantity))),
  );
  b.appendChild(hr());

  // Totals block
  b.appendChild(row("Subtotal", fmt(s.subtotal)));

  if (s.taxAmount > 0)
    b.appendChild(row("GST (incl.)", fmt(s.taxAmount)));

  if (s.exchangeCredit > 0) {
    b.appendChild(row("Return Credit", `- ${fmt(s.exchangeCredit)}`, "ret"));
  } else if (s.discountAmount > 0) {
    const label = s.discountType === "percent" ? "Discount (%)" : "Discount";
    b.appendChild(row(label, `- ${fmt(s.discountAmount)}`));
  }

  const totalEl = row(s.totalLabel, fmt(s.totalValue));
  totalEl.style.fontWeight = "bold";
  b.appendChild(totalEl);

  s.payments.forEach((p) => b.appendChild(row(p.method, fmt(p.amount))));

  if (s.refundToCustomer != null)
    b.appendChild(row("Refund to Customer", fmt(s.refundToCustomer), "ret"));

  if (s.change > 0)
    b.appendChild(row("Change", fmt(s.change)));

  // Order note
  if (s.orderNote) {
    b.appendChild(hr());
    b.appendChild(txt("div", `Note: ${s.orderNote}`, "c"));
  }

  // Barcode (invoice number as text if template has show_barcode)
  if (s.showBarcode) {
    b.appendChild(hr());
    const bc = d.createElement("div");
    bc.style.cssText = "text-align:center;font-size:10px;letter-spacing:3px;color:#555";
    bc.textContent = s.invoiceNumber;
    b.appendChild(bc);
  }

  // Offline notice
  if (s.offlineNote) {
    b.appendChild(hr());
    const note = txt("div", s.offlineNote, "c");
    note.style.cssText = "font-style:italic;color:#c0392b;font-size:11px";
    b.appendChild(note);
  }

  // Footer
  b.appendChild(hr());
  b.appendChild(txt("div", s.footerText, "c"));

  w.print();
}

/**
 * Send a slip to the backend hardware printer.
 * Returns { ok: true } on success, { error, fallback: true } if printer
 * is offline or not configured — caller should then fire buildReceiptHtml().
 *
 * Uses relative URL /api/print/receipt so AuthProvider injects auth headers.
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

import { PAPER_SIZES as _PAPER_SIZES, pxForChars as _pxForChars } from "./paperSizes";

// Re-export so existing callers that already import from utils/receipt.js
// can access the paper-width helper without an extra import.
export const PAPER_SIZES = _PAPER_SIZES;
export const pxForChars = _pxForChars;

/**
 * Format an internal payment-method id into a human-readable label.
 * Tender ids in `slip.payments[].method` mostly use display casing
 * already ("Cash", "Card", "Wallet"), but a few use machine ids
 * ("gift_card" — kept distinct so UI code can branch on it). This
 * normalizer makes receipts read naturally regardless of source.
 */
export function formatPaymentMethodLabel(method) {
  if (!method) return "";
  const raw = String(method);
  const knownAliases = {
    gift_card: "Gift Card",
    return_credit: "Return Credit",
    store_credit: "Store Credit",
  };
  const lower = raw.toLowerCase();
  if (knownAliases[lower]) return knownAliases[lower];
  // Generic fallback: split on _ and Title-Case each word. Already-pretty
  // strings ("Cash", "Card") pass through unchanged.
  return raw
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

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

    // Bucket F designer v2. Undefined/null defaults to TRUE/sensible defaults
    // so tenants without v76 migration applied still render legacy layout.
    logoUrl: template?.logo_url || null,
    paperWidth: Number(template?.paper_width) || 48,
    showTaxBreakdown: template?.show_tax_breakdown !== false,
    showFbr: template?.show_fbr !== false,
    showQr: template?.show_qr !== false,

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
    // P8 (3.14): per-rate tax breakdown — each entry { rate, amount }, sorted
    // descending. Empty when no line carries a positive rate. Falls back to
    // the legacy single-line `taxAmount` when this is empty.
    taxBreakdown: Array.isArray(slip.tax_breakdown) ? slip.tax_breakdown : [],
    taxInclusive: !!slip.taxInclusive,
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
export function buildReceiptHtml(slip, template, currencySymbol = "$", labels = {}) {
  const fmt = makeFmt(currencySymbol);
  const s = buildReceiptSections(slip, template, currencySymbol);

  // Bucket F: paper-width-aware popup. Width tracks the active template's
  // paper_width so 58mm rolls render at ~227px and 80mm rolls at ~341px.
  const popupPx = pxForChars(s.paperWidth);
  const winW = Math.max(popupPx + 60, 320);
  const w = window.open("", "_blank", `width=${winW},height=620`);
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print receipts.");
    return;
  }
  const d = w.document;

  const style = d.createElement("style");
  style.textContent = [
    `body{font-family:monospace;font-size:13px;width:${popupPx}px;margin:0 auto;padding:12px}`,
    ".row{display:flex;justify-content:space-between}",
    ".c{text-align:center}",
    "hr{border:none;border-top:1px dashed #999;margin:6px 0}",
    ".label{font-size:11px;font-weight:bold;text-transform:uppercase;color:#666;margin:4px 0 2px}",
    ".ret{color:#c0392b}",
    ".logo{max-width:100%;max-height:60px;display:block;margin:0 auto 6px}",
    ".qr{display:block;margin:6px auto;max-width:80%;height:auto}",
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

  // Header — logo first when template has one (Bucket F)
  if (s.logoUrl) {
    const img = d.createElement("img");
    img.src = s.logoUrl;
    img.className = "logo";
    img.alt = "";
    b.appendChild(img);
  }
  b.appendChild(txt("div", s.storeName, "c"));
  b.appendChild(txt("div", s.timestamp, "c"));
  // 2-G.9: hold slip gets a prominent "HOLD SLIP" header and renames the
  // invoice line to a hold number. The rest of the layout is reused verbatim
  // so scanner barcode, item list, and deposit/balance lines all come through.
  if (slip.isHoldSlip) {
    const h = txt("div", "*** HOLD SLIP ***", "c");
    h.style.cssText = "font-size:14px;font-weight:bold;margin:2px 0";
    b.appendChild(h);
    b.appendChild(txt("div", `Hold #: ${s.invoiceNumber}`, "c"));
  } else {
    b.appendChild(txt("div", `Invoice: ${s.invoiceNumber}`, "c"));
  }
  if (s.returnedFrom)
    b.appendChild(txt("div", `Exchange for: ${s.returnedFrom}`, "c"));
  if (s.employee)
    b.appendChild(txt("div", `Staff: ${s.employee.name}`, "c"));
  if (s.customer)
    b.appendChild(txt("div", `${labels.customer || "Customer"}: ${s.customer.name}${s.customer.mobile ? " · " + s.customer.mobile : ""}`, "c"));
  b.appendChild(hr());

  // M5: format weighted item rows with decimal qty + unit; add gross/tare breakdown when tare > 0
  const WEIGHT_UNITS = ["kg", "g", "lb", "oz", "m", "cm"];
  const isWeighted = (item) => item.unit && WEIGHT_UNITS.includes(String(item.unit).toLowerCase());
  const qtyLabel = (item) => isWeighted(item)
    ? `${Number(item.quantity).toFixed(3)} ${item.unit}`
    : `x${item.quantity}`;
  const appendItemRow = (item, prefix = "") => {
    // 2-R.8: prefix seat chip "[S#]" when line belongs to a dine-in seat.
    // Retail items pass seat_number=null and render as before.
    const seatChip = item.seat_number != null ? `[S${item.seat_number}] ` : "";
    const label = `${seatChip}${item.name} ${qtyLabel(item)}`;
    b.appendChild(row(label, `${prefix}${fmt(item.price * item.quantity)}`, prefix ? "ret" : ""));
    // Breakdown line for weighted items with tare
    if (isWeighted(item) && Number(item.tare_weight || 0) > 0) {
      const g = Number(item.gross_weight || item.quantity).toFixed(3);
      const t = Number(item.tare_weight).toFixed(3);
      const n = Number(item.quantity).toFixed(3);
      const note = d.createElement("div");
      note.className = "small";
      note.textContent = `  gross ${g} − tare ${t} = net ${n} ${item.unit}`;
      b.appendChild(note);
    }
    // 2-G.6: print one sub-line per serial stamped on this cart line, with
    // the warranty end date when available. Graceful when `serials` is
    // absent (non-serialized sales) or is a raw id array (no warranty info).
    const serials = Array.isArray(item.serials) ? item.serials : null;
    const serialDetails = Array.isArray(item.serialDetails) ? item.serialDetails : null;
    if (serialDetails && serialDetails.length) {
      for (const s of serialDetails) {
        const wty = s.warranty_end_date ? ` wty: ${s.warranty_end_date}` : "";
        const ln = d.createElement("div");
        ln.className = "small";
        ln.textContent = `  SN: ${s.serial_number}${wty}`;
        b.appendChild(ln);
      }
    } else if (serials && serials.length) {
      for (const id of serials) {
        const ln = d.createElement("div");
        ln.className = "small";
        ln.textContent = `  SN: #${id}`;
        b.appendChild(ln);
      }
    }
  };

  // Returned items (exchange receipts only)
  if (s.returnedItems.length > 0) {
    b.appendChild(txt("div", "Returned", "label"));
    s.returnedItems.forEach((item) => appendItemRow(item, "- "));
    b.appendChild(hr());
    b.appendChild(txt("div", "New Items", "label"));
  }

  // Cart items
  s.cartItems.forEach((item) => appendItemRow(item));
  b.appendChild(hr());

  // Totals block
  b.appendChild(row("Subtotal", fmt(s.subtotal)));

  // P8 (3.14): per-rate tax breakdown when available; legacy single line
  // otherwise. Inclusive shows "GST 17% Rs 14.53"; exclusive shows
  // "GST 17% +Rs 17.00" so the cashier can tell the tax sits on top.
  if (s.showTaxBreakdown && s.taxBreakdown && s.taxBreakdown.length > 0) {
    const prefix = s.taxInclusive ? "" : "+";
    for (const b1 of s.taxBreakdown) {
      const rateLabel = `GST ${Number(b1.rate).toFixed(0)}%`;
      b.appendChild(row(rateLabel, `${prefix}${fmt(b1.amount)}`));
    }
  } else if (s.showTaxBreakdown && s.taxAmount > 0) {
    const prefix = s.taxInclusive ? "" : "+";
    const label = s.taxInclusive ? "GST (incl.)" : "GST";
    b.appendChild(row(label, `${prefix}${fmt(s.taxAmount)}`));
  }

  if (s.exchangeCredit > 0) {
    b.appendChild(row("Return Credit", `- ${fmt(s.exchangeCredit)}`, "ret"));
  } else if (s.discountAmount > 0) {
    const label = s.discountType === "percent" ? "Discount (%)" : "Discount";
    b.appendChild(row(label, `- ${fmt(s.discountAmount)}`));
  }

  const totalEl = row(s.totalLabel, fmt(s.totalValue));
  totalEl.style.fontWeight = "bold";
  b.appendChild(totalEl);

  // 2-G.9 hold slip: show deposit + remaining balance instead of payments.
  if (slip.isHoldSlip) {
    b.appendChild(row("Deposit Paid", fmt(Number(slip.depositPaid || 0))));
    const bal = row("Balance Due", fmt(Number(slip.balanceDue || 0)));
    bal.style.fontWeight = "bold";
    b.appendChild(bal);
  } else {
    s.payments.forEach((p) => b.appendChild(row(formatPaymentMethodLabel(p.method), fmt(p.amount))));
  }

  if (s.refundToCustomer != null)
    b.appendChild(row("Refund to Customer", fmt(s.refundToCustomer), "ret"));

  if (s.change > 0)
    b.appendChild(row("Change", fmt(s.change)));

  // Phase 2-G Wave 2 (2-G.2) — gift-card codes issued on this sale.
  if (Array.isArray(slip.issuedGiftCards) && slip.issuedGiftCards.length > 0) {
    b.appendChild(hr());
    b.appendChild(txt("div", "Gift Cards Issued", "label"));
    slip.issuedGiftCards.forEach((gc) => {
      const line = d.createElement("div");
      line.className = "row";
      line.appendChild(txt("span", gc.code));
      line.appendChild(txt("span", fmt(gc.initial_value)));
      b.appendChild(line);
    });
    const note = txt(
      "div",
      "Keep the code safe — required at checkout.",
      "c",
    );
    note.style.cssText = "font-size:10px;color:#666;margin-top:2px";
    b.appendChild(note);
  }

  // Order note
  if (s.orderNote) {
    b.appendChild(hr());
    b.appendChild(txt("div", `Note: ${s.orderNote}`, "c"));
  }

  // Barcode — 2-G.11 renders a CODE128 SVG so scanning the printed receipt
  // looks up the sale. jsbarcode is loaded lazily so its ~50KB is only paid
  // by tenants who actually print from the browser.
  if (s.showBarcode) {
    b.appendChild(hr());
    const wrap = d.createElement("div");
    wrap.style.cssText = "text-align:center;margin:4px 0";
    const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
    wrap.appendChild(svg);
    b.appendChild(wrap);
    // Render after appending so layout is correct.
    import("jsbarcode")
      .then(({ default: JsBarcode }) => {
        try {
          JsBarcode(svg, String(s.invoiceNumber || ""), {
            format: "CODE128",
            height: 40,
            width: 1.6,
            displayValue: true,
            fontSize: 11,
            margin: 0,
          });
        } catch {
          wrap.textContent = s.invoiceNumber;
          wrap.style.cssText = "text-align:center;font-size:10px;letter-spacing:3px;color:#555";
        }
      })
      .catch(() => {
        wrap.textContent = s.invoiceNumber;
        wrap.style.cssText = "text-align:center;font-size:10px;letter-spacing:3px;color:#555";
      });
  }

  // FBR Digital Invoice reference — toggles respected (Bucket F).
  // Dynamic qrcode import keeps the ~40KB library out of initial bundle;
  // only fetched when a template actually renders the QR.
  if (s.showFbr && slip.fbr_irn) {
    b.appendChild(hr());
    b.appendChild(txt("div", `FBR Ref: ${slip.fbr_irn}`, "c"));
    if (s.showQr && slip.fbr_qr_code) {
      const qrImg = d.createElement("img");
      qrImg.className = "qr";
      qrImg.alt = "FBR QR";
      b.appendChild(qrImg);
      const raw = String(slip.fbr_qr_code);
      if (raw.startsWith("data:") || raw.startsWith("http")) {
        // Already an image — use directly.
        qrImg.src = raw;
      } else {
        // Raw payload string — encode client-side. Lazy-loaded.
        import("qrcode")
          .then((mod) => (mod.default || mod).toDataURL(raw, { margin: 1, width: 140 }))
          .then((url) => { qrImg.src = url; })
          .catch(() => { qrImg.remove(); });
      }
    }
  } else if (slip.fbr_status === "pending") {
    b.appendChild(hr());
    const fbrNote = txt("div", "FBR: Processing...", "c");
    fbrNote.style.cssText = "font-size:11px;color:#888";
    b.appendChild(fbrNote);
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
export async function printToHardware(slip, template, labels = {}) {
  try {
    const res = await fetch("/api/print/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slip, template: template || null, labels }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, fallback: true };
    return await res.json();
  } catch (err) {
    return { error: err.message, fallback: true };
  }
}

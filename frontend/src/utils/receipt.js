import { API_BASE } from "../config";
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
  // Already-pretty names pass through as typed: lower-casing the rest of
  // the word printed "Online - JazzCash" as "Online - jazzcash" and
  // "Return Credit" as "Return credit" (F2).
  if (!raw.includes("_")) return raw;
  // Machine ids: split on _ and Title-Case each word.
  return raw
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const lineTotal = (list) => round2((list || []).reduce(
  (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0,
));

/**
 * D56: an exchange slip reads Returned / New items / (Discount) / Difference,
 * then "Paid back to customer: <method>" or "Customer pays: <method>".
 * Null for a slip with nothing returned. Shared by the printed slip and the
 * on-screen receipt.
 */
export function exchangeSummary(slip) {
  if (!slip?.returnedItems?.length) return null;
  const returned = lineTotal(slip.returnedItems);
  const newItems = lineTotal(slip.cart);
  const discount = round2(slip.exchangeDiscount);
  const difference = round2(newItems - discount - returned);
  // Older slips (before exchangeSettle) fall back to the refund note or the
  // money tender.
  const viaNote = String(slip.refundNote || "").match(/ via (.+)$/);
  const tender = (slip.payments || []).find((p) => p.method !== "Return Credit");
  let settle = null;
  if (difference < 0) {
    settle = {
      label: "Paid back to customer",
      method: slip.exchangeSettle?.method || (viaNote ? viaNote[1] : "") || "Cash",
      amount: round2(-difference),
    };
  } else if (difference > 0) {
    settle = {
      label: "Customer pays",
      method: slip.exchangeSettle?.method || tender?.method || "",
      amount: difference,
    };
  }
  return { returned, newItems, discount, difference, settle };
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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

  // D59: a saved Cash minus line is change handed out of the drawer (a
  // transfer overpaid); a reprint shows it as Change, like the till receipt.
  const isCashBack = (p) => p.method === "Cash" && Number(p.amount) < 0;
  const cashBack = (slip.payments || []).filter(isCashBack)
    .reduce((s, p) => s - Number(p.amount), 0);
  const payments = (slip.payments || []).filter(
    (p) => p.method !== "Return Credit" && !isCashBack(p),
  );

  // Header: first line is the shop name (printed big), the rest are address /
  // phone lines. Footer: one printed line per line typed in the template.
  const headerAll = splitLines(template?.header_text);
  const shopName = headerAll[0] || slip.outlet?.name || "SanoPOS";
  const footerLines = splitLines(template?.footer_text);
  if (footerLines.length === 0) footerLines.push("Thank you for your purchase!");
  const discountAmount = Number(slip.discountAmount || 0);

  return {
    // Branding — from template with fallbacks
    shopName,
    headerLines: headerAll.slice(1),
    footerLines,
    storeName: shopName,
    footerText: footerLines.join(" "),
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
    // One Toy Store F3b part 2: a staff toy at cost.
    staffName: slip.staffName || null,

    // Items
    isExchange,
    // D56: Returned / New items / Difference / Paid back (exchange only).
    exchange: exchangeSummary(slip),
    returnedItems: slip.returnedItems || [],
    cartItems: slip.cart || [],
    itemCount: (slip.cart || []).reduce((n, i) => n + Number(i.quantity || 0), 0),
    subtotal,

    // Adjustments
    taxAmount: Number(slip.taxAmount || 0),
    // P8 (3.14): per-rate tax breakdown — each entry { rate, amount }, sorted
    // descending. Empty when no line carries a positive rate. Falls back to
    // the legacy single-line `taxAmount` when this is empty.
    taxBreakdown: Array.isArray(slip.tax_breakdown) ? slip.tax_breakdown : [],
    taxInclusive: !!slip.taxInclusive,
    exchangeCredit: Number(slip.exchangeCredit || 0),
    // F1 / D48: discount given on an exchange's balance.
    exchangeDiscount: Number(slip.exchangeDiscount || 0),
    discountAmount,
    discountType: slip.discountType || "fixed",
    savings: slip.exchangeCredit > 0 ? 0 : discountAmount,

    // Totals
    totalLabel,
    totalValue,
    payments,
    refundToCustomer: slip.refundNote ? Math.abs(slip.balanceDue || 0) : null,
    change: round2(Number(slip.change || 0) + cashBack),

    // Footer
    orderNote: slip.orderNote || null,
    offlineNote: slip.offline ? "Sale queued offline — final receipt available after sync" : null,
  };
}

function makeFmt(symbol = "$") {
  return (n) => `${symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Printable width per roll (paper width minus the printer's unprintable edges),
// keyed by the template's character width. Sizing the slip in mm stops Chrome
// shrinking it to fit, which made the old 341px slip print small and faint.
export const PRINT_MM = { 48: 72, 42: 64, 32: 48, 30: 46 };
const FRAME_ID = "sanopos-receipt-frame";

export const RECEIPT_CSS = (printMm) => [
  "@page{margin:0}",
  "*{box-sizing:border-box}",
  "html,body{margin:0;padding:0;background:#fff}",
  `body{width:${printMm}mm;margin:0 auto;padding:2mm 1mm 5mm;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.3;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
  ".c{text-align:center}",
  ".shop{font-size:22px;font-weight:bold;letter-spacing:1px;text-align:center;margin:1mm 0 1mm}",
  ".addr{font-size:11px;text-align:center}",
  ".row{display:flex;justify-content:space-between;gap:6px}",
  "hr{border:none;border-top:1px dashed #000;margin:4px 0}",
  ".label{font-size:11px;font-weight:bold;text-transform:uppercase;padding-top:3px}",
  "table.items{width:100%;border-collapse:collapse;font-size:11px;margin:2px 0}",
  "table.items th{font-weight:bold;border-top:1px solid #000;border-bottom:1px solid #000;padding:2px 0}",
  "table.items td{padding:2px 0;vertical-align:top}",
  "th.d,td.d{text-align:left}",
  "table.items .n{text-align:right;white-space:nowrap;padding:2px 0 2px 8px}",
  // Qty sits between two money columns; centred with room either side so
  // "1" and "8,950.00" can never read as "18,950.00".
  "table.items .q{text-align:center;white-space:nowrap;padding:2px 6px 2px 10px}",
  ".barcode{text-align:center;margin:6px 0 2px}",
  ".barcode svg{display:block;margin:0 auto;shape-rendering:crispEdges}",
  ".code,.small{font-size:10px}",
  ".ret{font-style:italic}",
  ".grand{font-size:15px;font-weight:bold;border-top:1px solid #000;border-bottom:1px solid #000;padding:2px 0;margin:3px 0}",
  ".bold{font-weight:bold}",
  ".saved{text-align:center;font-weight:bold;margin-top:4px}",
  ".foot{text-align:center;font-weight:bold;margin-top:2px}",
  ".logo{max-width:100%;max-height:60px;display:block;margin:0 auto 4px}",
  ".qr{display:block;margin:6px auto;max-width:60%;height:auto}",
].join("\n");

/**
 * Prints the receipt: iPOS-style layout (big shop name, address/phone lines,
 * Description / Price / Qty / Amount table with item codes, bold grand total,
 * payments + change, footer lines, optional invoice barcode).
 *
 * Renders into a hidden iframe and prints that, so Chrome's pop-up blocker
 * can't stop it even when printing follows an await (return, hold).
 * Waits (briefly) for the logo, barcode and QR before opening the print box.
 *
 * @param {object} slip     - The sale slip object
 * @param {object|null} template - Active receipt template (null = use defaults)
 * @param {object} [opts]   - { onPrint } replaces the print call (tests)
 * @returns {Promise<void>}
 */
export async function buildReceiptHtml(slip, template, currencySymbol = "$", labels = {}, opts = {}) {
  const fmt = makeFmt(currencySymbol);
  const num = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = buildReceiptSections(slip, template, currencySymbol);
  const printMm = PRINT_MM[s.paperWidth] || Math.round(s.paperWidth * 1.5);

  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "Receipt";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.round(printMm * 3.78)}px;height:800px;border:0`;
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  const pending = [];

  const style = d.createElement("style");
  style.textContent = RECEIPT_CSS(printMm);
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
  const waitForImg = (img) => {
    pending.push(new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    }));
  };

  // ── Header: logo, shop name, address / phone lines ──
  if (s.logoUrl) {
    const img = d.createElement("img");
    img.className = "logo";
    img.alt = "";
    waitForImg(img);
    img.src = s.logoUrl;
    b.appendChild(img);
  }
  b.appendChild(txt("div", s.shopName, "shop"));
  s.headerLines.forEach((line) => b.appendChild(txt("div", line, "addr")));
  b.appendChild(hr());

  // ── Bill details ──
  b.appendChild(row(s.timestamp, s.employee ? `Cashier: ${s.employee.name}` : ""));
  // 2-G.9: hold slip gets a prominent "HOLD SLIP" header and renames the
  // invoice line to a hold number. The rest of the layout is reused verbatim
  // so scanner barcode, item list, and deposit/balance lines all come through.
  if (slip.isHoldSlip) {
    b.appendChild(txt("div", "*** HOLD SLIP ***", "c bold"));
    b.appendChild(txt("div", `Hold #: ${s.invoiceNumber}`));
  } else {
    b.appendChild(txt("div", `Invoice: ${s.invoiceNumber}`));
  }
  if (s.returnedFrom) b.appendChild(txt("div", `Exchange for: ${s.returnedFrom}`));
  if (s.staffName) b.appendChild(txt("div", `Staff purchase: ${s.staffName}`));
  if (s.customer)
    b.appendChild(txt("div", `${labels.customer || "Customer"}: ${s.customer.name}${s.customer.mobile ? " · " + s.customer.mobile : ""}`));

  // ── Items table ──
  // M5: weighted items show decimal qty + unit, with a gross/tare line when tare > 0
  const WEIGHT_UNITS = ["kg", "g", "lb", "oz", "m", "cm"];
  const isWeighted = (item) => item.unit && WEIGHT_UNITS.includes(String(item.unit).toLowerCase());
  const qtyText = (item) => isWeighted(item)
    ? `${Number(item.quantity).toFixed(3)} ${item.unit}`
    : String(Number(item.quantity));

  const table = d.createElement("table");
  table.className = "items";
  const thead = d.createElement("thead");
  const headRow = d.createElement("tr");
  [["Description", "d"], ["Price", "n"], ["Qty", "q"], ["Amount", "n"]].forEach(([h, cls]) => headRow.appendChild(txt("th", h, cls)));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = d.createElement("tbody");
  table.appendChild(tbody);

  const labelRow = (text) => {
    const tr = d.createElement("tr");
    const td = txt("td", text, "label");
    td.colSpan = 4;
    tr.appendChild(td);
    tbody.appendChild(tr);
  };
  const itemRow = (item, returned = false) => {
    const tr = d.createElement("tr");
    if (returned) tr.className = "ret";
    const desc = d.createElement("td");
    desc.className = "d";
    // 2-R.8: prefix seat chip "[S#]" when line belongs to a dine-in seat.
    const seatChip = item.seat_number != null ? `[S${item.seat_number}] ` : "";
    desc.appendChild(txt("div", `${seatChip}${item.name}`));
    const code = item.sku || item.barcode;
    if (code) desc.appendChild(txt("div", String(code), "code"));
    if (isWeighted(item) && Number(item.tare_weight || 0) > 0) {
      const g = Number(item.gross_weight || item.quantity).toFixed(3);
      const t = Number(item.tare_weight).toFixed(3);
      const n = Number(item.quantity).toFixed(3);
      desc.appendChild(txt("div", `gross ${g} − tare ${t} = net ${n} ${item.unit}`, "small"));
    }
    // 2-G.6: one sub-line per serial on this cart line, with warranty end date
    // when known. Graceful when `serials` is absent or a raw id array.
    const serials = Array.isArray(item.serials) ? item.serials : null;
    const serialDetails = Array.isArray(item.serialDetails) ? item.serialDetails : null;
    if (serialDetails && serialDetails.length) {
      for (const sd of serialDetails) {
        const wty = sd.warranty_end_date ? ` wty: ${sd.warranty_end_date}` : "";
        desc.appendChild(txt("div", `SN: ${sd.serial_number}${wty}`, "small"));
      }
    } else if (serials && serials.length) {
      for (const id of serials) desc.appendChild(txt("div", `SN: #${id}`, "small"));
    }
    tr.appendChild(desc);
    tr.appendChild(txt("td", num(item.price), "n"));
    tr.appendChild(txt("td", qtyText(item), "q"));
    tr.appendChild(txt("td", `${returned ? "-" : ""}${num(item.price * item.quantity)}`, "n"));
    tbody.appendChild(tr);
  };

  if (s.returnedItems.length > 0) {
    labelRow("Returned");
    s.returnedItems.forEach((item) => itemRow(item, true));
    labelRow("New Items");
  }
  s.cartItems.forEach((item) => itemRow(item));
  b.appendChild(table);

  // ── Totals ──
  b.appendChild(txt("div", `Items: ${s.itemCount}`));
  if (s.exchange) {
    b.appendChild(row("Returned", num(-s.exchange.returned)));
    b.appendChild(row("New items", num(s.exchange.newItems)));
  } else {
    b.appendChild(row("Sub Total", num(s.subtotal)));
  }

  // P8 (3.14): per-rate tax breakdown when available; legacy single line
  // otherwise. Inclusive shows "GST 17% 14.53"; exclusive shows "+17.00".
  if (s.showTaxBreakdown && s.taxBreakdown && s.taxBreakdown.length > 0) {
    const prefix = s.taxInclusive ? "" : "+";
    for (const b1 of s.taxBreakdown) {
      b.appendChild(row(`GST ${Number(b1.rate).toFixed(0)}%`, `${prefix}${num(b1.amount)}`));
    }
  } else if (s.showTaxBreakdown && s.taxAmount > 0) {
    const prefix = s.taxInclusive ? "" : "+";
    b.appendChild(row(s.taxInclusive ? "GST (incl.)" : "GST", `${prefix}${num(s.taxAmount)}`));
  }

  if (s.exchange) {
    // D56: no "Return Credit" / "Balance due" / "Refund to Customer" lines.
    if (s.exchange.discount > 0) b.appendChild(row("Discount", `-${num(s.exchange.discount)}`));
    b.appendChild(row("Difference", num(s.exchange.difference), "bold"));
    if (s.exchange.settle) {
      b.appendChild(row(
        `${s.exchange.settle.label}: ${formatPaymentMethodLabel(s.exchange.settle.method)}`,
        num(s.exchange.settle.amount),
        "bold",
      ));
    }
  } else if (s.exchangeCredit > 0) {
    b.appendChild(row("Return Credit", `-${num(s.exchangeCredit)}`));
    if (s.exchangeDiscount > 0) b.appendChild(row("Discount", `-${num(s.exchangeDiscount)}`));
  } else if (s.discountAmount > 0) {
    b.appendChild(row(s.discountType === "staff" ? "Staff discount" : s.discountType === "percent" ? "Discount (%)" : "Discount", `-${num(s.discountAmount)}`));
  }

  if (!s.exchange) {
    const grand = row("GRAND TOTAL", fmt(s.totalValue));
    grand.classList.add("grand");
    b.appendChild(grand);

    // 2-G.9 hold slip: show deposit + remaining balance instead of payments.
    if (slip.isHoldSlip) {
      b.appendChild(row("Deposit Paid", num(slip.depositPaid)));
      b.appendChild(row("Balance Due", num(slip.balanceDue), "bold"));
    } else {
      s.payments.forEach((p) => b.appendChild(row(formatPaymentMethodLabel(p.method), num(p.amount))));
    }

    if (s.refundToCustomer != null)
      b.appendChild(row("Refund to Customer", num(s.refundToCustomer), "bold"));
  }

  if (s.change > 0) b.appendChild(row("Change", num(s.change), "bold"));

  if (s.savings > 0) b.appendChild(txt("div", `You saved ${fmt(s.savings)}`, "saved"));

  // Phase 2-G Wave 2 (2-G.2) — gift-card codes issued on this sale.
  if (Array.isArray(slip.issuedGiftCards) && slip.issuedGiftCards.length > 0) {
    b.appendChild(hr());
    b.appendChild(txt("div", "Gift Cards Issued", "label"));
    slip.issuedGiftCards.forEach((gc) => b.appendChild(row(gc.code, num(gc.initial_value))));
    b.appendChild(txt("div", "Keep the code safe — required at checkout.", "c small"));
  }

  if (s.orderNote) {
    b.appendChild(hr());
    b.appendChild(txt("div", `Note: ${s.orderNote}`, "c"));
  }

  // ── Footer lines (return policy, thanks) ──
  b.appendChild(hr());
  const foot = d.createElement("div");
  foot.className = "foot";
  s.footerLines.forEach((line) => foot.appendChild(txt("div", line)));
  b.appendChild(foot);

  // Barcode — 2-G.11 renders a CODE128 SVG so scanning the printed receipt
  // (Return / Exchange box) looks up the sale. jsbarcode is loaded lazily.
  // Thermal heads print whole dots (203 dpi = 8 dots/mm), so each bar is sized
  // in mm to a whole number of dots (0.25 mm = 2 dots, wider if it fits) with
  // a 10-bar blank quiet zone each side; anything else prints uneven bars that
  // scanners reject.
  if (s.showBarcode) {
    const wrap = d.createElement("div");
    wrap.className = "barcode";
    const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
    wrap.appendChild(svg);
    wrap.appendChild(txt("div", s.invoiceNumber, "c small"));
    b.appendChild(wrap);
    pending.push(
      import("jsbarcode")
        .then(({ default: JsBarcode }) => {
          const QUIET = 10;
          JsBarcode(svg, String(s.invoiceNumber || ""), {
            format: "CODE128", width: 1, height: 48, displayValue: false,
            marginTop: 0, marginBottom: 0, marginLeft: QUIET, marginRight: QUIET,
            background: "#ffffff", lineColor: "#000000",
          });
          const units = parseFloat(svg.getAttribute("width")) || 0; // "198px"
          const moduleMm = [0.5, 0.375, 0.25].find((m) => units * m <= printMm) || 0.25;
          svg.setAttribute("viewBox", `0 0 ${units} 48`);
          svg.setAttribute("preserveAspectRatio", "none");
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.style.width = `${units * moduleMm}mm`;
          svg.style.height = "12mm";
        })
        .catch(() => {
          svg.remove();
        }),
    );
  }

  // FBR Digital Invoice reference — toggles respected (Bucket F).
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
        waitForImg(qrImg);
        qrImg.src = raw;
      } else {
        // Raw payload string — encode client-side. Lazy-loaded.
        pending.push(
          import("qrcode")
            .then((mod) => (mod.default || mod).toDataURL(raw, { margin: 1, width: 140 }))
            .then((url) => { qrImg.src = url; })
            .catch(() => { qrImg.remove(); }),
        );
      }
    }
  } else if (slip.fbr_status === "pending") {
    b.appendChild(hr());
    b.appendChild(txt("div", "FBR: Processing...", "c small"));
  }

  if (s.offlineNote) {
    b.appendChild(hr());
    b.appendChild(txt("div", s.offlineNote, "c small"));
  }

  if (pending.length) {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  if (opts.onPrint) {
    opts.onPrint(frame);
  } else {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

/**
 * Send a slip to the backend hardware printer.
 * Returns { ok: true } on success, { error, fallback: true } if printer
 * is offline or not configured — caller should then fire buildReceiptHtml().
 *
 * Uses absolute URL via API_BASE so the request reaches the backend in
 * production (where the frontend at sanopos.com is on a different origin
 * from the API at api.sanopos.com). AuthProvider's fetch interceptor
 * injects auth headers for both relative and absolute /api/ URLs.
 *
 * @param {object} slip      - The sale slip object
 * @param {object|null} template - Active receipt template
 * @returns {Promise<{ok?: boolean, error?: string, fallback?: boolean}>}
 */
export async function printToHardware(slip, template, labels = {}) {
  try {
    const res = await fetch(`${API_BASE}/api/print/receipt`, {
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

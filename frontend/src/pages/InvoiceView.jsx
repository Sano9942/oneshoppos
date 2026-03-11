import { useState, useEffect } from "react";
import { Printer, ArrowLeft, RefreshCw, FileText, Download } from "lucide-react";

import { API_BASE as API } from '../config';
import { fmtUtcDateTime } from '../utils/dates';
import { useCurrency } from '../contexts/CurrencyContext';

const fmtDate = fmtUtcDateTime;

// Build a DOM element with optional attrs/text
function el(doc, tag, opts = {}) {
  const e = doc.createElement(tag);
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.cls) e.className = opts.cls;
  if (opts.style) e.style.cssText = opts.style;
  return e;
}

function buildPrintDocument(doc, { sale, items, payments }, fmt) {
  const subtotal = items.reduce((s, i) => s + i.price_at_sale * i.quantity, 0);
  const taxTotal = items.reduce((s, i) => {
    return s + (i.price_at_sale * i.quantity * (i.tax_rate || 0)) / 100;
  }, 0);

  // Style tag
  const style = doc.createElement("style");
  style.textContent = `
    *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
    body{padding:32px;color:#1e293b;font-size:13px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #7B61FF;padding-bottom:16px}
    .hdr-title{font-size:28px;font-weight:900;color:#7B61FF;letter-spacing:-1px}
    .hdr-sub{color:#64748b;font-size:11px;margin-top:2px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
    .meta-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px}
    .meta-label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
    .meta-row{display:flex;justify-content:space-between;font-size:12px;color:#334155;margin-top:4px}
    .meta-key{color:#64748b}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    thead th{background:#0B1120;color:#fff;font-size:11px;font-weight:600;padding:10px 12px;text-align:left}
    thead th.r{text-align:right}
    tbody td{padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#334155}
    tbody td.r{text-align:right}
    tbody tr:nth-child(even) td{background:#f8fafc}
    .totals{display:flex;justify-content:flex-end;margin-bottom:24px}
    .totals-inner{width:280px}
    .totals-row{display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px}
    .totals-grand{display:flex;justify-content:space-between;font-size:16px;font-weight:900;color:#7B61FF;border-top:2px solid #7B61FF;padding-top:10px;margin-top:8px}
    .pay-chip{display:inline-block;background:#ede9fe;color:#5b21b6;border-radius:99px;padding:4px 12px;font-size:12px;font-weight:600;margin-right:6px;margin-bottom:4px}
    .sec-label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
    .payments{margin-bottom:24px}
    .notes{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;font-size:13px;color:#475569;margin-bottom:24px}
    .footer{text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px}
    @media print{body{padding:16px}}
  `;
  doc.head.appendChild(style);

  const body = doc.body;

  // Header
  const hdr = el(doc, "div", { cls: "hdr" });
  const hdrLeft = el(doc, "div");
  const invTitle = el(doc, "div", { cls: "hdr-title", text: "INVOICE" });
  const invSub = el(doc, "div", { cls: "hdr-sub", text: "One Shop — Point of Sale" });
  hdrLeft.appendChild(invTitle);
  hdrLeft.appendChild(invSub);
  if (sale.outlet_name) {
    const outletEl = el(doc, "div", { cls: "hdr-sub", text: sale.outlet_name });
    hdrLeft.appendChild(outletEl);
  }
  const hdrRight = el(doc, "div", { style: "text-align:right" });
  const invNo = el(doc, "div", { style: "font-size:18px;font-weight:700;color:#1e293b", text: sale.invoice_number || `SALE-${sale.id}` });
  const invDate = el(doc, "div", { style: "font-size:11px;color:#64748b;margin-top:2px", text: fmtDate(sale.timestamp) });
  hdrRight.appendChild(invNo);
  hdrRight.appendChild(invDate);
  if (sale.employee_name) {
    hdrRight.appendChild(el(doc, "div", { style: "font-size:11px;color:#94a3b8", text: `Served by: ${sale.employee_name}` }));
  }
  hdr.appendChild(hdrLeft);
  hdr.appendChild(hdrRight);
  body.appendChild(hdr);

  // Meta grid
  const meta = el(doc, "div", { cls: "meta" });
  // Bill To box
  const billBox = el(doc, "div", { cls: "meta-box" });
  billBox.appendChild(el(doc, "div", { cls: "meta-label", text: "Bill To" }));
  if (sale.customer_name) {
    billBox.appendChild(el(doc, "p", { style: "font-weight:600;color:#1e293b;font-size:13px", text: sale.customer_name }));
    if (sale.customer_phone) billBox.appendChild(el(doc, "p", { style: "font-size:11px;color:#64748b", text: sale.customer_phone }));
    if (sale.customer_email) billBox.appendChild(el(doc, "p", { style: "font-size:11px;color:#64748b", text: sale.customer_email }));
  } else {
    billBox.appendChild(el(doc, "p", { style: "color:#94a3b8;font-size:13px", text: "Walk-in Customer" }));
  }
  // Details box
  const detBox = el(doc, "div", { cls: "meta-box" });
  detBox.appendChild(el(doc, "div", { cls: "meta-label", text: "Invoice Details" }));
  [
    ["Invoice No.", sale.invoice_number || `SALE-${sale.id}`],
    ["Payment", sale.payment_method],
    ["Status", sale.status === "voided" ? "Voided" : "Paid"],
  ].forEach(([k, v]) => {
    const row = el(doc, "div", { cls: "meta-row" });
    row.appendChild(el(doc, "span", { cls: "meta-key", text: k }));
    const vEl = el(doc, "span", { style: "font-weight:600", text: v });
    if (k === "Status") vEl.style.color = sale.status === "voided" ? "#dc2626" : "#16a34a";
    row.appendChild(vEl);
    detBox.appendChild(row);
  });
  meta.appendChild(billBox);
  meta.appendChild(detBox);
  body.appendChild(meta);

  // Line items table
  const table = doc.createElement("table");
  const thead = doc.createElement("thead");
  const headerRow = doc.createElement("tr");
  [["#", ""], ["Product", ""], ["Tax", "r"], ["Unit Price", "r"], ["Qty", "r"], ["Total", "r"]].forEach(([h, cls]) => {
    const th = doc.createElement("th");
    th.textContent = h;
    if (cls) th.className = cls;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = doc.createElement("tbody");
  items.forEach((item, idx) => {
    const lineTotal = item.price_at_sale * item.quantity;
    const tr = doc.createElement("tr");
    const cells = [
      [String(idx + 1), ""],
      [item.product_name, ""],
      [item.tax_name ? `${item.tax_name} (${item.tax_rate}%)` : "—", "r"],
      [fmt(item.price_at_sale), "r"],
      [String(item.quantity), "r"],
      [fmt(lineTotal), "r"],
    ];
    cells.forEach(([text, cls]) => {
      const td = doc.createElement("td");
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  // Totals
  const totalsDiv = el(doc, "div", { cls: "totals" });
  const totalsInner = el(doc, "div", { cls: "totals-inner" });
  const addRow = (label, value, cls = "totals-row") => {
    const row = el(doc, "div", { cls });
    row.appendChild(el(doc, "span", { text: label }));
    row.appendChild(el(doc, "span", { style: "font-weight:600", text: value }));
    totalsInner.appendChild(row);
  };
  addRow("Subtotal", fmt(subtotal));
  if (sale.discount_amount > 0) addRow("Discount", `- ${fmt(sale.discount_amount)}`);
  if (taxTotal > 0) addRow("Tax", fmt(taxTotal));
  if (sale.points_redeemed > 0) addRow("Points Redeemed", `- ${fmt(sale.points_redeemed)}`);
  addRow("Total", fmt(sale.total_amount), "totals-grand");
  totalsDiv.appendChild(totalsInner);
  body.appendChild(totalsDiv);

  // Payments
  if (payments?.length > 0) {
    const payDiv = el(doc, "div", { cls: "payments" });
    payDiv.appendChild(el(doc, "div", { cls: "sec-label", text: "Payments Received" }));
    payments.forEach((p) => {
      payDiv.appendChild(el(doc, "span", { cls: "pay-chip", text: `${p.payment_method}: ${fmt(p.amount)}` }));
    });
    body.appendChild(payDiv);
  }

  // Notes
  if (sale.notes) {
    const notesDiv = el(doc, "div", { cls: "notes" });
    const notesLabel = el(doc, "strong", { text: "Notes: " });
    const notesText = doc.createTextNode(sale.notes);
    notesDiv.appendChild(notesLabel);
    notesDiv.appendChild(notesText);
    body.appendChild(notesDiv);
  }

  // Footer
  body.appendChild(el(doc, "div", { cls: "footer", text: "Thank you for your purchase · One Shop POS" }));
}

export default function InvoiceView({ saleId, onBack }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!saleId) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
    });
    fetch(`${API}/api/sales/${saleId}/invoice`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [saleId]);

  const handlePrint = () => {
    if (!data) return;
    const win = window.open("", "_blank", "width=900,height=700");
    const doc = win.document;
    doc.title = `Invoice ${data.sale.invoice_number || data.sale.id}`;
    buildPrintDocument(doc, data, fmt);
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const handleExportJson = async () => {
    if (!saleId) return;
    const res = await fetch(`${API}/api/sales/${saleId}/invoice/export`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to export invoice");
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.invoice?.invoice_number || `SALE-${saleId}`}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={20} className="animate-spin text-slate-400" />
    </div>
  );
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl">{error}</div>
  );
  if (!data) return null;

  const { sale, items, payments } = data;
  const subtotal = items.reduce((s, i) => s + i.price_at_sale * i.quantity, 0);
  const taxTotal = items.reduce((s, i) => {
    return s + (i.price_at_sale * i.quantity * (i.tax_rate || 0)) / 100;
  }, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft size={15} /> Back to Sales
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <FileText size={12} /> {sale.invoice_number || `SALE-${sale.id}`}
          </span>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6A50E5] text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm shadow-[#7B61FF]/20"
          >
            <Printer size={15} /> Print Invoice
          </button>
          <button
            onClick={() => handleExportJson().catch((e) => setError(e.message))}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-medium"
          >
            <Download size={15} /> Export JSON
          </button>
        </div>
      </div>

      {/* Invoice preview */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-[#7B61FF] pb-5">
          <div>
            <div className="text-3xl font-black text-[#7B61FF] tracking-tight">INVOICE</div>
            <div className="text-slate-500 text-xs mt-1">One Shop — Point of Sale</div>
            {sale.outlet_name && <div className="text-slate-400 text-xs">{sale.outlet_name}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-slate-800">{sale.invoice_number || `SALE-${sale.id}`}</div>
            <div className="text-xs text-slate-500 mt-1">{fmtDate(sale.timestamp)}</div>
            {sale.employee_name && <div className="text-xs text-slate-400">Served by: {sale.employee_name}</div>}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Bill To</div>
            {sale.customer_name ? (
              <div>
                <p className="font-semibold text-slate-800">{sale.customer_name}</p>
                {sale.customer_phone && <p className="text-xs text-slate-500 mt-0.5">{sale.customer_phone}</p>}
                {sale.customer_email && <p className="text-xs text-slate-500">{sale.customer_email}</p>}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Walk-in Customer</p>
            )}
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Invoice Details</div>
            <div className="space-y-1.5 text-sm">
              {[
                ["Invoice No.", sale.invoice_number || `SALE-${sale.id}`, "font-semibold text-slate-800"],
                ["Payment", sale.payment_method, "text-slate-700"],
                ["Status", sale.status === "voided" ? "Voided" : "Paid", sale.status === "voided" ? "text-red-600 font-semibold" : "text-green-600 font-semibold"],
              ].map(([k, v, vc]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-slate-500">{k}</span>
                  <span className={vc}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full text-sm">
          <thead className="bg-[#0B1120] text-white text-xs">
            <tr>
              <th className="px-4 py-3 text-left rounded-tl-lg">#</th>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-right">Tax</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right rounded-tr-lg">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                <td className="px-4 py-3 text-slate-800 font-medium">{item.product_name}</td>
                <td className="px-4 py-3 text-right text-slate-500 text-xs">
                  {item.tax_name ? `${item.tax_name} (${item.tax_rate}%)` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{fmt(item.price_at_sale)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{item.quantity}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(item.price_at_sale * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm text-slate-600"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            {sale.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-red-600"><span>Discount</span><span>- {fmt(sale.discount_amount)}</span></div>
            )}
            {taxTotal > 0 && (
              <div className="flex justify-between text-sm text-slate-600"><span>Tax</span><span>{fmt(taxTotal)}</span></div>
            )}
            {sale.points_redeemed > 0 && (
              <div className="flex justify-between text-sm text-slate-600"><span>Points Redeemed</span><span>- {fmt(sale.points_redeemed)}</span></div>
            )}
            <div className="flex justify-between pt-3 border-t-2 border-[#7B61FF] font-black text-[#7B61FF] text-lg">
              <span>Total</span><span>{fmt(sale.total_amount)}</span>
            </div>
          </div>
        </div>

        {/* Payments */}
        {payments?.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Payments Received</div>
            <div className="flex flex-wrap gap-2">
              {payments.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  {p.payment_method}: {fmt(p.amount)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {sale.notes && (
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">Notes: </span>{sale.notes}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 border-t border-slate-200 pt-4">
          Thank you for your purchase · One Shop POS
        </div>
      </div>
    </div>
  );
}

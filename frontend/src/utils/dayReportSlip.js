// One Toy Store pilot F4 (D51): the day report slip, in the layout of the
// iPOS "Daily Sale Report" the shop prints at night (per mode Sub Total /
// Dis Rs / Bill Total, St Net Total, Sub Total, Discount Rs, Total), plus
// what iPOS leaves to the register: returns, every Paid out / Paid in, and
// the cash that should be in the till. Printed like the receipt: a hidden
// iframe sized in mm for the roll (D45). Data: GET /api/shifts/:id/day-report.
import { api } from "../api";
import { PRINT_MM, RECEIPT_CSS } from "./receipt";

const FRAME_ID = "sanopos-day-report-frame";

const amt = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad = (n) => String(n).padStart(2, "0");
function dateStr(v) {
  const d = new Date(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function timeStr(v) {
  return new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
const dayName = (v) => new Date(v).toLocaleDateString("en-US", { weekday: "long" });

const SLIP_CSS = [
  ".title{font-size:15px;font-weight:bold;text-align:center;margin:1mm 0}",
  ".check{font-size:13px;font-weight:bold;text-align:center;border:1px solid #000;padding:2px;margin:2px 0}",
  ".mode{font-weight:bold;margin-top:3px}",
  ".nums{display:grid;grid-template-columns:1fr 0.8fr 1fr;gap:4px;text-align:right}",
  ".nums.h{font-size:10px;font-weight:bold;border-bottom:1px solid #000}",
  ".big{font-size:14px;font-weight:bold}",
  ".item{font-size:11px}",
  ".item .row span:first-child{flex:1}",
  ".note{font-size:10px;padding-left:6px}",
].join("\n");

/**
 * Build the slip into a hidden iframe and print it.
 * @param {object} r     - the day report (GET /api/shifts/:id/day-report)
 * @param {object} opts  - { paperWidth (template chars, default 48), onPrint (tests) }
 */
export function buildDayReportHtml(r, opts = {}) {
  const paperWidth = Number(opts.paperWidth) || 48;
  const printMm = PRINT_MM[paperWidth] || Math.round(paperWidth * 1.5);

  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "Day report";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.round(printMm * 3.78)}px;height:800px;border:0`;
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  const style = d.createElement("style");
  style.textContent = `${RECEIPT_CSS(printMm)}\n${SLIP_CSS}`;
  d.head.appendChild(style);
  d.title = `Day report shift ${r.shift.id}`;
  const b = d.body;

  const el = (tag, text, cls = "") => {
    const e = d.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const add = (node) => { b.appendChild(node); return node; };
  const hr = () => add(el("hr"));
  const row = (left, right, cls = "") => {
    const e = el("div", null, `row ${cls}`.trim());
    e.appendChild(el("span", left));
    e.appendChild(el("span", right));
    return add(e);
  };
  const nums = (a, c, e2, cls = "") => {
    const e = el("div", null, `nums ${cls}`.trim());
    [a, c, e2].forEach((v) => e.appendChild(el("span", v)));
    return add(e);
  };

  const at = r.shift.closed_at || r.printed_until || r.shift.opened_at;
  if (r.shop_name) add(el("div", String(r.shop_name).toUpperCase(), "shop"));
  add(el("div", "DAILY SALE REPORT", "title"));
  if (r.is_check_copy) add(el("div", "CHECK COPY - shift not closed", "check"));
  row(`Shift #${r.shift.id}`, r.shift.outlet_name || "");
  row(dayName(r.shift.opened_at), dateStr(r.shift.opened_at), "bold");
  row("Opened", timeStr(r.shift.opened_at));
  row(r.is_check_copy ? "Printed" : "Closed", `${dateStr(at)} ${timeStr(at)}`);
  if (r.shift.employee_name) row("By", r.shift.employee_name);

  hr();
  nums("Sub Total", "Dis Rs", "Bill Total", "h");
  for (const m of r.modes) {
    add(el("div", `${m.label}  (${m.bills} ${m.bills === 1 ? "bill" : "bills"})`, "mode"));
    nums(amt(m.sub_total), amt(m.discount), amt(m.bill_total));
  }
  if (!r.modes.length) add(el("div", "No sales", "c"));
  hr();
  row("St Net Total:", amt(r.sub_total), "big");
  hr();
  row("Sub Total:", amt(r.sub_total));
  row("Discount Rs.:", amt(r.discount));
  row("Total:", amt(r.total), "grand");
  row("Bills", String(r.bill_count));
  if (r.voids?.count) row(`Voided bills (${r.voids.count})`, amt(r.voids.value));
  if (r.staff?.bills) row(`Staff purchases (${r.staff.bills}), staff discount`, amt(r.staff.discount));

  if (r.returns?.length) {
    hr();
    add(el("div", "Returns / exchanges", "label"));
    for (const x of r.returns) {
      const what = x.method === "Return Credit" ? "Exchange" : x.method;
      row(`${what} (${x.count})`, x.paid_back ? `paid back ${amt(x.paid_back)}` : "no money back", "item");
    }
  }

  const listMoney = (title, items, total) => {
    hr();
    add(el("div", title, "label"));
    if (!items.length) add(el("div", "None", "item"));
    for (const p of items) {
      const what = [p.label, p.detail].filter(Boolean).join(" - ");
      row(`${timeStr(p.at)} ${what}${p.voided ? " (VOIDED)" : ""}`, amt(p.amount), "item");
      if (p.note) add(el("div", p.note, "note"));
    }
    row("Total", amt(total), "bold");
  };
  listMoney("Paid out", r.paid_outs || [], r.drawer.paid_out);
  if (r.paid_ins?.length) listMoney("Paid in", r.paid_ins, r.drawer.paid_in);

  const dr = r.drawer;
  hr();
  add(el("div", "Cash in till", "label"));
  row("Opening float", amt(dr.opening_float));
  row("+ Cash sales", amt(dr.cash_sales));
  if (dr.cash_refunds) row("- Cash given back", amt(dr.cash_refunds));
  row("- Paid out", amt(dr.paid_out));
  if (dr.paid_in) row("+ Paid in", amt(dr.paid_in));
  row("Should be in till", amt(dr.expected_cash), "grand");
  if (!r.is_check_copy) {
    row("Counted", amt(dr.counted_cash), "bold");
    row("Difference", `${Number(dr.difference) > 0 ? "+" : ""}${amt(dr.difference)}`, "big");
    if (dr.variance_reason) add(el("div", `Reason: ${dr.variance_reason}`, "note"));
    if (dr.notes?.length) {
      add(el("div", "Notes counted", "label"));
      for (const n of dr.notes) {
        row(`${amt(n.denomination).replace(/\.00$/, "")} x ${n.count}`, amt(n.denomination * n.count), "item");
      }
    }
  } else {
    add(el("div", "Count the drawer and compare.", "c small"));
  }

  if (opts.onPrint) {
    opts.onPrint(frame);
  } else {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
  return frame;
}

/** Load a shift's day report + the receipt paper width, then print. */
export async function printDayReport(shiftId, opts = {}) {
  const [report, tpl] = await Promise.all([
    api.get(`/api/shifts/${shiftId}/day-report`),
    api.get("/api/receipt-templates/active").catch(() => null),
  ]);
  buildDayReportHtml(report, { paperWidth: tpl?.template?.paper_width, ...opts });
  return report;
}

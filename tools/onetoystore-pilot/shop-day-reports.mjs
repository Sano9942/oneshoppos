// Report cross-checks for shop-day.mjs.
//
// Each check compares a report against the script's independent shadow ledger
// (what the shop actually did), or two reports against each other. Report
// field names below are taken from the real responses (see a --dump file).

const num = (v) => (v == null || v === "" ? null : Number(v));
const sum = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0);

export async function assertReports(ctx) {
  const { R, shadow, L, P, V, IDS, SUPS, check, note, area, near, r2 } = ctx;
  const body = (k) => (R[k]?.status === 200 ? R[k].body : null);

  // ── shadow aggregates ──────────────────────────────────────────────────────
  const meta = {}; // pid → {name, cat, brand, sup}
  for (const k of Object.keys(P)) meta[P[k].id] = P[k];
  for (const k of Object.keys(V)) meta[V[k].pid] = { ...V[k], name: V[k].name.replace(/ [A-Z-]+$/, "") };
  const lines = L.sales.flatMap((s) => s.lines);
  const by = (keyFn) => {
    const m = {};
    for (const l of lines) {
      const k = keyFn(l);
      m[k] = m[k] || { units: 0, revenue: 0, cost: 0 };
      m[k].units += l.qty; m[k].revenue += l.qty * l.price; m[k].cost += l.qty * l.cost;
    }
    return m;
  };
  const byProduct = by((l) => l.pid);
  const byCat = by((l) => l.cat);
  const byBrand = by((l) => l.brand);
  const payTotals = (m) => L.sales.reduce((a, s) => a + (s.payments[m] || 0), 0);
  const refundsBy = (m) => L.refunds.filter((r) => r.method === m).reduce((a, r) => a + r.amount, 0);

  // ── A. Sales totals ────────────────────────────────────────────────────────
  area("8a. Sales summary = the bills");
  const ss = body("sales-summary");
  if (ss) {
    check("sales summary total = Σ bill totals (after discounts, excl. voided)", num(ss.total_revenue), shadow.net);
    check("sales summary bill count = number of bills", sum(ss.daily_sales || [], (d) => d.orders), shadow.bills);
    for (const m of ["Cash", "Card"]) {
      const row = (ss.payment_methods || []).find((x) => x.method === m);
      check(`sales summary ${m} = Σ ${m} actually taken`, num(row?.total), payTotals(m));
    }
  }
  const ow = body("order-wise");
  if (ow) {
    check("order-wise: Σ bill totals = sales summary", r2(sum(ow.orders, (o) => o.total_amount)), shadow.net);
    check("order-wise: Σ bill discounts = discounts given", r2(sum(ow.orders, (o) => o.discount_amount)), shadow.disc);
    check("order-wise: bill count", ow.orders.length, shadow.bills);
  }
  const sd = body("sales-detail");
  if (sd) {
    check("sales detail: Σ line gross = gross sales before bill discounts", r2(sum(sd.sales, (x) => x.line_gross)), shadow.gross);
    check("sales detail: Σ line totals (bill discount spread over lines) = sales summary", r2(sum(sd.sales, (x) => x.line_total)), shadow.net);
    const zeroCost = sd.sales.filter((x) => Number(x.cost_price_at_sale) === 0);
    check("every sold line carries its real cost (none booked at Rs 0 cost)",
      zeroCost.map((x) => `bill ${x.sale_id}: ${x.product_name}`), []);
  }

  // ── B. Item / category / brand / supplier ─────────────────────────────────
  area("8b. Item-, category-, brand-wise reports");
  const iw = body("item-wise");
  if (iw) {
    const bad = [];
    for (const [pid, exp] of Object.entries(byProduct)) {
      const row = iw.items.find((x) => Number(x.id) === Number(pid));
      if (!row || !near(row.units_sold, exp.units) || !near(row.revenue, exp.revenue)) {
        bad.push(`${meta[pid]?.name}: report ${row ? `${Number(row.units_sold)} u / ${Number(row.revenue)}` : "missing"}, expected ${exp.units} u / ${exp.revenue}`);
      }
    }
    check("item-wise: units and value per item match the bills", bad, []);
    const iwRev = r2(sum(iw.items, (x) => x.revenue));
    check("item-wise Σ value = gross sales (before bill discounts)", iwRev, shadow.gross);
    note("item-wise vs sales summary", `item-wise totals ${iwRev}, sales summary ${shadow.net}; ` +
      `difference ${r2(iwRev - shadow.net)} = bill-level discounts (${shadow.disc}), which are not spread across items`);
    check("item-wise cost of goods = Σ(qty × cost at time of sale)", r2(sum(iw.items, (x) => x.total_cost)), shadow.cogs);
  }
  const cw = body("category-wise");
  if (cw) {
    const bad = [];
    for (const [cat, exp] of Object.entries(byCat)) {
      const row = cw.items.find((x) => x.category === cat);
      if (!row || !near(row.revenue, exp.revenue) || !near(row.units_sold, exp.units)) bad.push(`${cat}: report ${row ? `${Number(row.units_sold)} u / ${Number(row.revenue)}` : "missing"}, expected ${exp.units} u / ${exp.revenue}`);
    }
    check("category-wise: per category matches the bills", bad, []);
    check("category-wise Σ = item-wise Σ", r2(sum(cw.items, (x) => x.revenue)), iw ? r2(sum(iw.items, (x) => x.revenue)) : null);
  }
  const bw = body("brand-wise");
  if (bw) {
    const bad = [];
    for (const [brand, exp] of Object.entries(byBrand)) {
      const row = bw.items.find((x) => x.brand === brand);
      if (!row || !near(row.revenue, exp.revenue) || !near(row.units_sold, exp.units)) bad.push(`${brand}: report ${row ? `${Number(row.units_sold)} u / ${Number(row.revenue)}` : "missing"}, expected ${exp.units} u / ${exp.revenue}`);
    }
    check("brand-wise: per brand matches the bills", bad, []);
    check("brand-wise Σ = item-wise Σ", r2(sum(bw.items, (x) => x.revenue)), iw ? r2(sum(iw.items, (x) => x.revenue)) : null);
  }
  const sw = body("supplier-wise");
  if (sw) {
    const cols = Object.keys(sw.items[0] || {});
    note("supplier-wise report", `columns: ${cols.join(", ")}. This is a PURCHASES-by-supplier report, not sales-by-supplier. ` +
      `Sales by supplier can only be read off the item-wise report's supplier column.`);
    const bad = [];
    for (const s of SUPS) {
      const row = sw.items.find((x) => x.supplier_name === s.name);
      if (!row || !near(row.total_cost, L.ordered.bySup[s.key])) bad.push(`${s.name}: report ${row?.total_cost}, ordered ${L.ordered.bySup[s.key]}`);
    }
    check("supplier-wise purchases = value ordered per supplier", bad, []);
  }

  // ── C. Payments, dashboard, cashier ───────────────────────────────────────
  area("8c. Payment split, dashboard, cashier report");
  const fm = body("finance-payment-mix");
  if (fm) {
    for (const m of ["Cash", "Card"]) {
      const row = fm.sale_mix.find((x) => x.payment_method === m);
      check(`payment mix ${m} = Σ ${m} taken`, num(row?.total), payTotals(m));
    }
    check("payment mix total inflows = sales total", num(fm.summary?.total_inflows), shadow.net);
  }
  const db = body("dashboard");
  if (db) {
    check("dashboard today's sales = sales summary", num(db.totalRevenueToday), shadow.net);
    check("dashboard bill count", num(db.saleCount), shadow.bills);
    check("dashboard average bill = sales ÷ bills", num(db.averageBill), r2(shadow.net / shadow.bills), 1);
    check("dashboard month sales = today's sales (first day)", num(db.monthSales), shadow.net);
    check("dashboard refunds today", num(db.refundsToday?.value), shadow.refunds);
    check("dashboard discounts today", num(db.discountsToday?.value), shadow.disc);
    for (const m of ["Cash", "Card"]) {
      const row = (db.zReport || []).find((x) => x.payment_method === m);
      check(`dashboard Z-report ${m} = Σ ${m} taken`, num(row?.total), payTotals(m));
    }
    check("dashboard today's gross profit = sales (after discounts) − cost of goods", num(db.todayGrossProfit), r2(shadow.net - shadow.cogs));
    note("dashboard gross profit and returns", `todayGrossProfit ${db.todayGrossProfit}; after returns it would be ${r2(shadow.netAfterReturns - (shadow.cogs - shadow.returnedCost))}`);
    const extra = Object.keys(db).filter((k) => /stock|margin|payable|receivable|purchase|expense|profit/i.test(k));
    note("dashboard stock/margin/payables fields", extra.length ? extra.map((k) => `${k}=${JSON.stringify(db[k]).slice(0, 80)}`).join("; ") : "none on /api/reports/dashboard");
  }
  const cash = body("cashier-wise");
  if (cash) {
    const c = cash.items[0] || {};
    check("cashier-wise: sales / discounts / refunds / net",
      [num(c.sales_value), num(c.discount_value), num(c.refund_value), num(c.net_sales)],
      [shadow.net, shadow.disc, shadow.refunds, shadow.netAfterReturns]);
  }
  const rv = body("refunds-voids");
  if (rv) {
    check("refunds & voids: refund total", num(rv.summary.refund_value), shadow.refunds);
    check("refunds & voids: 1 voided bill of Rs 600", [num(rv.summary.void_count), num(rv.summary.void_value)], [1, 600]);
  }

  // ── D. Margin ─────────────────────────────────────────────────────────────
  area("8d. Gross margin");
  for (const k of ["profit-summary", "profit-by-product"]) {
    if (R[k]?.status !== 200) { note(k, `HTTP ${R[k]?.status}: ${JSON.stringify(R[k]?.body).slice(0, 150)}`); continue; }
    const b = R[k].body;
    const flat = JSON.stringify(b).slice(0, 400);
    note(`${k} raw`, flat);
  }
  const ps = body("profit-summary");
  if (ps) {
    const s = ps.summary || ps.totals || ps;
    const cogs = num(s.cogs ?? s.total_cost ?? s.cost_of_goods ?? s.cost);
    const rev = num(s.revenue ?? s.net_sales ?? s.total_revenue ?? s.sales);
    check("profit summary cost of goods = Σ(qty × cost at sale)", cogs, shadow.cogs);
    check("profit summary gross profit = sales − cost", num(s.gross_profit ?? s.profit), r2((rev ?? 0) - (cogs ?? 0)));
  }

  // ── E. Stock value, purchases, suppliers ──────────────────────────────────
  area("8e. Stock, purchases, supplier balances");
  const oh = body("on-hand");
  if (oh) {
    const sample = oh.items.filter((x) => /\(Sample\)/.test(x.product_name));
    note("sample products", `${sample.length} "(Sample)" products were seeded by the retail setup wizard (${sample.map((x) => x.product_name).join(", ")})`);
    const bad = [];
    for (const r of oh.items) {
      const m = meta[r.product_id];
      if (!m) continue;
      const want = r2(Number(r.quantity) * L.cost[r.product_id]);
      if (!near(r.cost_value, want, 1)) bad.push(`${r.product_name}: cost value ${Number(r.cost_value)}, expected ${Number(r.quantity)} × ${L.cost[r.product_id]} = ${want}`);
    }
    check("stock value at cost = on-hand × current cost, per item", bad, []);
    const idump = body("inventory-dump");
    if (idump) check("inventory dump Σ quantity = on-hand Σ quantity", r2(sum(idump.items, (x) => x.quantity)), r2(sum(oh.items, (x) => x.quantity)));
  }
  const sh = body("shrinkage");
  if (sh) {
    const bad = sh.rows.filter((r) => meta[r.product_id] && !near(r.expected, r.actual))
      .map((r) => `${r.product_name}: opening ${r.opening} + purch ${r.purchases} − sold ${r.sales} + ret ${r.returns} ± adj ${r.adjustments} ± xfer ${r.transfers_in}/${r.transfers_out} = ${r.expected}, actual ${r.actual}`);
    check("shrinkage report: opening + movements = actual, for every item", bad, []);
    const soldBad = [];
    for (const [pid, exp] of Object.entries(byProduct)) {
      const row = sh.rows.find((r) => Number(r.product_id) === Number(pid));
      if (row && !near(row.sales, exp.units)) soldBad.push(`${meta[pid]?.name}: shrinkage 'sales' ${row.sales}, bills ${exp.units}`);
    }
    check("shrinkage report 'sales' column = units on the bills", soldBad, []);
  }
  const tp = body("total-purchases");
  if (tp) {
    check("total purchases: value ordered", num(tp.summary.ordered_cost), L.ordered.value);
    check("total purchases: value received", num(tp.summary.received_cost), r2(Object.values(L.received).length ? sumReceivedValue(L) : 0));
  }
  const ip = body("itemwise-purchases");
  if (ip) {
    check("item-wise purchases: units ordered / received",
      [num(ip.summary.qty_ordered), num(ip.summary.qty_received)], [L.ordered.units, sumObj(L.received)]);
    check("item-wise purchases: value ordered / received",
      [num(ip.summary.ordered_cost), num(ip.summary.received_cost)], [L.ordered.value, sumReceivedValue(L)]);
  }
  const pr = body("payables-receivables");
  if (pr) {
    check("payables report: total owed to suppliers = received − paid − returned",
      num(pr.summary.supplier_outstanding), r2(Object.values(L.payable).reduce((a, b) => a + b, 0)));
  }

  // ── F. Till ───────────────────────────────────────────────────────────────
  area("8f. Z-report / shift");
  const cf = body("cash-flow");
  if (cf) {
    const s = cf.sessions[0] || {};
    const exp = r2(5000 + payTotals("Cash") - refundsBy("Cash"));
    check("shift report expected cash = float + cash sales − cash refunds", num(s.expected_cash), exp);
  }
  for (const k of ["payment-summary", "shift-summary", "zreport"]) {
    note(`${k} raw`, `HTTP ${R[k]?.status}: ${JSON.stringify(R[k]?.body).slice(0, 400)}`);
  }
}

function sumObj(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
function sumReceivedValue(L) {
  // Σ payable before payments/returns = value received. Recompute from payable history is lossy,
  // so shop-day.mjs records received value per product into L.receivedValue.
  return Math.round(Object.values(L.receivedValue || {}).reduce((a, b) => a + b, 0) * 100) / 100;
}

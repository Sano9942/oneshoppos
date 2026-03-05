/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

function fmt(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

const TABS = [
  { id: "pnl", label: "P&L" },
  { id: "cashflow", label: "Cash Flow" },
  { id: "ap", label: "AP & AR" },
  { id: "bs", label: "Balance Sheet" },
  { id: "expenses", label: "Expense Ledger" },
  { id: "aging", label: "AP Aging" },
  { id: "tax", label: "Tax Ledger" },
  { id: "suppay", label: "Supplier Payments" },
  { id: "periods", label: "Accounting Periods" },
];

export default function Accounting() {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState("pnl");
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [outletId, setOutletId] = useState("");
  const [outlets, setOutlets] = useState([]);

  // core data
  const [pnl, setPnl] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const [ap, setAp] = useState({ supplier_ap: [], customer_ar: [] });
  const [bs, setBs] = useState(null);

  // new tabs data
  const [expenseData, setExpenseData] = useState({ expenses: [], categories: [] });
  const [expCatFilter, setExpCatFilter] = useState("");
  const [aging, setAging] = useState(null);
  const [taxLedger, setTaxLedger] = useState(null);
  const [supPay, setSupPay] = useState({ payments: [], total: 0 });
  const [periods, setPeriods] = useState([]);
  const [periodForm, setPeriodForm] = useState({ period_name: "", start_date: "", end_date: "" });
  const [savingPeriod, setSavingPeriod] = useState(false);

  const loadOutlets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/outlets`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setOutlets(data.outlets || []);
    } catch { /* ignore */ }
  }, [authHeaders]);

  const loadAll = useCallback(async () => {
    const q = new URLSearchParams({ from, to });
    if (outletId) q.set("outlet_id", outletId);
    try {
      const [a, b, c, d, e, f, g, h, i] = await Promise.all([
        fetch(`${API}/api/accounting/pnl?${q}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/cashflow?from=${from}&to=${to}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/ap`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/balance-sheet`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/expenses?from=${from}&to=${to}${outletId ? `&outlet_id=${outletId}` : ""}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/ap-aging`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/tax-ledger?from=${from}&to=${to}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/supplier-payments?from=${from}&to=${to}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/periods`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setPnl(a);
      setCashflow(b);
      setAp(c || { supplier_ap: [], customer_ar: [] });
      setBs(d || null);
      setExpenseData(e || { expenses: [], categories: [] });
      setAging(f || null);
      setTaxLedger(g || null);
      setSupPay(h || { payments: [], total: 0 });
      setPeriods(i?.periods || []);
    } catch { /* ignore */ }
  }, [authHeaders, from, to, outletId]);

  useEffect(() => { loadOutlets(); }, [loadOutlets]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const kpis = useMemo(() => {
    if (!pnl) return null;
    return [
      { label: "Net Revenue", value: fmt(pnl?.revenue?.net_revenue) },
      { label: "Gross Profit", value: fmt(pnl?.gross_profit) },
      { label: "Total Opex", value: fmt(pnl?.total_opex) },
      { label: "Net Profit", value: fmt(pnl?.net_profit) },
    ];
  }, [pnl]);

  const filteredExpenses = useMemo(() => {
    if (!expCatFilter) return expenseData.expenses || [];
    return (expenseData.expenses || []).filter((e) => String(e.category_id) === expCatFilter);
  }, [expenseData, expCatFilter]);

  const savePeriod = async (e) => {
    e.preventDefault();
    setSavingPeriod(true);
    try {
      const res = await fetch(`${API}/api/accounting/periods`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(periodForm),
      });
      if (res.ok) {
        setPeriodForm({ period_name: "", start_date: "", end_date: "" });
        const data = await fetch(`${API}/api/accounting/periods`, { headers: authHeaders() }).then((r) => r.json());
        setPeriods(data?.periods || []);
      }
    } finally { setSavingPeriod(false); }
  };

  const closePeriod = async (id) => {
    await fetch(`${API}/api/accounting/periods/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const data = await fetch(`${API}/api/accounting/periods`, { headers: authHeaders() }).then((r) => r.json());
    setPeriods(data?.periods || []);
  };

  const tabCls = (id) =>
    `px-4 py-2 text-sm border-b-2 whitespace-nowrap ${tab === id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`;

  const agingBuckets = [
    { key: "current", label: "Current" },
    { key: "d30", label: "1–30 days" },
    { key: "d60", label: "31–60 days" },
    { key: "d90", label: "61–90 days" },
    { key: "over90", label: "90+ days" },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-white border rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Outlet</label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm">
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-0 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tabCls(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── P&L ── */}
      {tab === "pnl" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {(kpis || []).map((k) => (
              <div key={k.label} className="bg-white border rounded-xl p-4">
                <p className="text-xs text-slate-500">{k.label}</p>
                <p className="text-lg font-bold text-slate-800 mt-1">{k.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border rounded-xl p-4">
              <p className="font-semibold text-slate-700 mb-2">Revenue Breakdown</p>
              <table className="w-full text-sm">
                <tbody>
                  <tr><td>Gross Sales</td><td className="text-right">{fmt(pnl?.revenue?.gross_sales)}</td></tr>
                  <tr><td>Discounts</td><td className="text-right">{fmt(pnl?.revenue?.discounts)}</td></tr>
                  <tr><td>Returns</td><td className="text-right">{fmt(pnl?.revenue?.returns)}</td></tr>
                  <tr className="font-semibold"><td>Net Revenue</td><td className="text-right">{fmt(pnl?.revenue?.net_revenue)}</td></tr>
                  <tr><td>COGS</td><td className="text-right">{fmt(pnl?.cogs)}</td></tr>
                  <tr className="font-semibold"><td>Gross Profit</td><td className="text-right">{fmt(pnl?.gross_profit)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="bg-white border rounded-xl p-4">
              <p className="font-semibold text-slate-700 mb-2">Operating Expenses</p>
              <table className="w-full text-sm">
                <tbody>
                  {(pnl?.operating_expenses || []).map((r) => (
                    <tr key={r.name}><td>{r.name}</td><td className="text-right">{fmt(r.total)}</td></tr>
                  ))}
                  <tr className="font-semibold border-t"><td>Total Opex</td><td className="text-right">{fmt(pnl?.total_opex)}</td></tr>
                  <tr className="font-semibold"><td>Net Profit</td><td className="text-right">{fmt(pnl?.net_profit)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash Flow ── */}
      {tab === "cashflow" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-2">Inflows</p>
            <table className="w-full text-sm">
              <tbody>
                {(cashflow?.inflows || []).map((r) => (
                  <tr key={r.payment_method}><td>{r.payment_method}</td><td className="text-right">{fmt(r.total)}</td></tr>
                ))}
                <tr className="font-semibold border-t"><td>Total Inflows</td><td className="text-right">{fmt(cashflow?.total_inflows)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-2">Outflows</p>
            <table className="w-full text-sm">
              <tbody>
                <tr><td>Expenses</td><td className="text-right">{fmt(cashflow?.outflows?.expenses)}</td></tr>
                <tr><td>Supplier Payments</td><td className="text-right">{fmt(cashflow?.outflows?.supplier_payments)}</td></tr>
                <tr className="font-semibold border-t"><td>Total Outflows</td><td className="text-right">{fmt(cashflow?.outflows?.total)}</td></tr>
              </tbody>
            </table>
            <p className="text-xl font-bold mt-4">Net Cash Flow: {fmt(cashflow?.net_cashflow)}</p>
          </div>
        </div>
      )}

      {/* ── AP & AR ── */}
      {tab === "ap" && (
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-white border rounded-xl p-4 overflow-auto">
            <p className="font-semibold text-slate-700 mb-2">Supplier AP</p>
            <table className="w-full text-sm min-w-175">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-2">Supplier</th><th>Invoice #</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(ap?.supplier_ap || []).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.supplier_name || "-"}</td>
                    <td>{r.invoice_number || "-"}</td>
                    <td>{fmt(r.amount)}</td>
                    <td>{fmt(r.paid_amount)}</td>
                    <td>{fmt(r.outstanding)}</td>
                    <td>{r.due_date || "-"}</td>
                    <td>{r.status || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-4 overflow-auto">
            <p className="font-semibold text-slate-700 mb-2">Customer AR</p>
            <table className="w-full text-sm min-w-175">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-2">Customer</th><th>Phone</th><th>Credit Balance</th><th>Total Purchases</th><th>Last Purchase</th>
                </tr>
              </thead>
              <tbody>
                {(ap?.customer_ar || []).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.name}</td>
                    <td>{r.mobile || "-"}</td>
                    <td>{fmt(r.credit_balance)}</td>
                    <td>{fmt(r.total_purchases)}</td>
                    <td>{r.last_purchase || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Balance Sheet ── */}
      {tab === "bs" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-3">Assets</p>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-slate-600">Inventory (at cost)</td><td className="text-right">{fmt(bs?.assets?.inventory_value)}</td></tr>
                <tr><td className="py-1 text-slate-600">Cash on Hand (open shifts)</td><td className="text-right">{fmt(bs?.assets?.cash_on_hand)}</td></tr>
                <tr className="font-semibold border-t"><td className="py-2">Total Assets</td><td className="text-right">{fmt(bs?.assets?.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-3">Liabilities</p>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-slate-600">Supplier AP (unpaid invoices)</td><td className="text-right">{fmt(bs?.liabilities?.supplier_ap)}</td></tr>
                <tr><td className="py-1 text-slate-600">Customer Credit Owed</td><td className="text-right">{fmt(bs?.liabilities?.customer_credit)}</td></tr>
                <tr className="font-semibold border-t"><td className="py-2">Total Liabilities</td><td className="text-right">{fmt(bs?.liabilities?.total)}</td></tr>
              </tbody>
            </table>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Equity (Assets − Liabilities)</span>
              <span className={`text-lg font-bold ${Number(bs?.equity || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {fmt(bs?.equity)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Expense Ledger ── */}
      {tab === "expenses" && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex flex-wrap gap-3 items-center justify-between mb-3">
            <p className="font-semibold text-slate-700">Expense Ledger ({filteredExpenses.length} entries)</p>
            <div className="flex gap-2">
              <select value={expCatFilter} onChange={(e) => setExpCatFilter(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm">
                <option value="">All categories</option>
                {(expenseData.categories || []).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
              <button onClick={() => exportCSV(filteredExpenses, "expense-ledger.csv")} className="border rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Export CSV
              </button>
            </div>
          </div>
          <div className="overflow-auto max-h-125">
            <table className="w-full text-sm min-w-175">
              <thead className="bg-slate-50 text-slate-500 text-left sticky top-0">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Outlet</th>
                  <th className="px-2 py-2">Employee</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2">{r.expense_date || "-"}</td>
                    <td className="px-2 py-2">{r.category_name || "Uncategorized"}</td>
                    <td className="px-2 py-2">{r.description || "-"}</td>
                    <td className="px-2 py-2">{r.outlet_name || "-"}</td>
                    <td className="px-2 py-2">{r.employee_name || "-"}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmt(r.amount)}</td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-8 text-center text-slate-400">No expenses found</td></tr>
                )}
              </tbody>
              {filteredExpenses.length > 0 && (
                <tfoot>
                  <tr className="border-t font-semibold bg-slate-50">
                    <td colSpan={5} className="px-2 py-2">Total</td>
                    <td className="px-2 py-2 text-right">{fmt(filteredExpenses.reduce((s, r) => s + Number(r.amount || 0), 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── AP Aging ── */}
      {tab === "aging" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {agingBuckets.map((b) => (
              <div key={b.key} className="bg-white border rounded-xl p-4">
                <p className="text-xs text-slate-500">{b.label}</p>
                <p className={`text-base font-bold mt-1 ${b.key === "over90" ? "text-rose-600" : b.key === "d90" ? "text-orange-500" : "text-slate-800"}`}>
                  {fmt(aging?.totals?.[b.key] || 0)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{(aging?.buckets?.[b.key] || []).length} invoices</p>
              </div>
            ))}
          </div>
          {agingBuckets.map((b) => {
            const rows = aging?.buckets?.[b.key] || [];
            if (!rows.length) return null;
            return (
              <div key={b.key} className="bg-white border rounded-xl p-4 overflow-auto">
                <p className="font-semibold text-slate-700 mb-2">{b.label}</p>
                <table className="w-full text-sm min-w-175">
                  <thead className="text-slate-500 text-left">
                    <tr>
                      <th className="py-2">Supplier</th><th>Invoice #</th><th>Invoice Date</th><th>Due Date</th><th>Days Overdue</th><th className="text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2">{r.supplier_name || "-"}</td>
                        <td>{r.invoice_number || "-"}</td>
                        <td>{r.invoice_date?.slice(0, 10) || "-"}</td>
                        <td>{r.due_date || "-"}</td>
                        <td>{r.days_overdue > 0 ? `${r.days_overdue}d` : "—"}</td>
                        <td className="text-right font-medium">{fmt(r.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {!aging?.buckets || Object.values(aging.buckets).every((b) => !b.length) && (
            <div className="bg-white border rounded-xl p-8 text-center text-slate-400">No outstanding invoices</div>
          )}
        </div>
      )}

      {/* ── Tax Ledger ── */}
      {tab === "tax" && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-slate-700">Tax Ledger</p>
            <button onClick={() => exportCSV(taxLedger?.rows || [], "tax-ledger.csv")} className="border rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Export CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-2 py-2">Tax Name</th>
                <th className="px-2 py-2">Rate</th>
                <th className="px-2 py-2 text-right">Transactions</th>
                <th className="px-2 py-2 text-right">Taxable Amount</th>
                <th className="px-2 py-2 text-right">Tax Collected</th>
              </tr>
            </thead>
            <tbody>
              {(taxLedger?.rows || []).map((r) => (
                <tr key={r.tax_name} className="border-t">
                  <td className="px-2 py-2">{r.tax_name}</td>
                  <td className="px-2 py-2">{r.rate}%</td>
                  <td className="px-2 py-2 text-right">{r.transaction_count}</td>
                  <td className="px-2 py-2 text-right">{fmt(r.taxable_amount)}</td>
                  <td className="px-2 py-2 text-right font-medium">{fmt(r.tax_collected)}</td>
                </tr>
              ))}
              {(taxLedger?.rows || []).length === 0 && (
                <tr><td colSpan={5} className="px-2 py-8 text-center text-slate-400">No tax data for this period</td></tr>
              )}
            </tbody>
            {(taxLedger?.rows || []).length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold bg-slate-50">
                  <td colSpan={4} className="px-2 py-2">Total Tax Collected</td>
                  <td className="px-2 py-2 text-right">{fmt(taxLedger?.total_tax)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── Supplier Payments ── */}
      {tab === "suppay" && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-slate-700">Supplier Payment History</p>
            <button onClick={() => exportCSV(supPay.payments || [], "supplier-payments.csv")} className="border rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Export CSV
            </button>
          </div>
          <div className="overflow-auto max-h-125">
            <table className="w-full text-sm min-w-175">
              <thead className="bg-slate-50 text-slate-500 text-left sticky top-0">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Invoice #</th>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2">Notes</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(supPay.payments || []).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2">{r.paid_at?.slice(0, 10) || "-"}</td>
                    <td className="px-2 py-2">{r.supplier_name || "-"}</td>
                    <td className="px-2 py-2">{r.invoice_number || "-"}</td>
                    <td className="px-2 py-2">{r.payment_method || "-"}</td>
                    <td className="px-2 py-2">{r.notes || "-"}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmt(r.amount)}</td>
                  </tr>
                ))}
                {(supPay.payments || []).length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-8 text-center text-slate-400">No payments found</td></tr>
                )}
              </tbody>
              {(supPay.payments || []).length > 0 && (
                <tfoot>
                  <tr className="border-t font-semibold bg-slate-50">
                    <td colSpan={5} className="px-2 py-2">Total Paid</td>
                    <td className="px-2 py-2 text-right">{fmt(supPay.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── Accounting Periods ── */}
      {tab === "periods" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-3">Create Period</p>
            <form className="space-y-3" onSubmit={savePeriod}>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Period Name</label>
                <input required value={periodForm.period_name} onChange={(e) => setPeriodForm((p) => ({ ...p, period_name: e.target.value }))}
                  placeholder="e.g. March 2026" className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Start Date</label>
                  <input required type="date" value={periodForm.start_date} onChange={(e) => setPeriodForm((p) => ({ ...p, start_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">End Date</label>
                  <input required type="date" value={periodForm.end_date} onChange={(e) => setPeriodForm((p) => ({ ...p, end_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <button type="submit" disabled={savingPeriod} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
                {savingPeriod ? "Saving..." : "Create Period"}
              </button>
            </form>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-3">Periods ({periods.length})</p>
            <div className="space-y-2 max-h-100 overflow-auto">
              {periods.map((p) => (
                <div key={p.id} className="border rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{p.period_name}</p>
                    <p className="text-xs text-slate-500">{p.start_date} → {p.end_date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {p.status}
                    </span>
                    {p.status === "open" && (
                      <button onClick={() => closePeriod(p.id)} className="text-xs border rounded px-2 py-0.5 text-slate-600 hover:bg-slate-50">
                        Close
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {periods.length === 0 && <p className="text-center text-slate-400 py-6">No periods yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

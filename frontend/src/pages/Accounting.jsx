/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

function fmt(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

export default function Accounting() {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState("pnl");
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [outletId, setOutletId] = useState("");
  const [outlets, setOutlets] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const [ap, setAp] = useState({ supplier_ap: [], customer_ar: [] });

  const loadOutlets = async () => {
    try {
      const res = await fetch(`${API}/api/outlets`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setOutlets(data.outlets || []);
    } catch {
      // ignore
    }
  };

  const loadAll = async () => {
    const q = new URLSearchParams({ from, to });
    if (outletId) q.set("outlet_id", outletId);
    try {
      const [a, b, c] = await Promise.all([
        fetch(`${API}/api/accounting/pnl?${q}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/cashflow?from=${from}&to=${to}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/accounting/ap`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setPnl(a);
      setCashflow(b);
      setAp(c || { supplier_ap: [], customer_ar: [] });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadOutlets();
  }, []);

  useEffect(() => {
    loadAll();
  }, [from, to, outletId]);

  const kpis = useMemo(() => {
    if (!pnl) return null;
    return [
      { label: "Net Revenue", value: fmt(pnl?.revenue?.net_revenue) },
      { label: "Gross Profit", value: fmt(pnl?.gross_profit) },
      { label: "Total Opex", value: fmt(pnl?.total_opex) },
      { label: "Net Profit", value: fmt(pnl?.net_profit) },
    ];
  }, [pnl]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Accounting</h1>
        <p className="text-sm text-slate-500 mt-1">P and L, cashflow and payable receivable views</p>
      </div>

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

      <div className="flex gap-2 border-b">
        <button onClick={() => setTab("pnl")} className={`px-4 py-2 text-sm border-b-2 ${tab === "pnl" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>P and L</button>
        <button onClick={() => setTab("cashflow")} className={`px-4 py-2 text-sm border-b-2 ${tab === "cashflow" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>Cash Flow</button>
        <button onClick={() => setTab("ap")} className={`px-4 py-2 text-sm border-b-2 ${tab === "ap" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>AP and AR</button>
      </div>

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

      {tab === "ap" && (
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-white border rounded-xl p-4 overflow-auto">
            <p className="font-semibold text-slate-700 mb-2">Supplier AP</p>
            <table className="w-full text-sm min-w-[700px]">
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
            <table className="w-full text-sm min-w-[700px]">
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
    </div>
  );
}

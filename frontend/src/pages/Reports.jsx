import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, TrendingUp, DollarSign, PackageX, ShoppingBag,
  AlertTriangle, TrendingDown, Users, ClipboardList, Search, X,
  Package, Truck, Archive, RotateCcw, Layers, Tag,
  ArrowLeftRight, ShoppingCart, Star, Recycle, BarChart2, FileText, Clock,
} from "lucide-react";

const API = "http://localhost:5000";
const fmt = (n) => "$" + (n || 0).toFixed(2);
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ─── Shared UI Helpers ────────────────────────────────────────────────────────

function TableShell({ cols, loading, empty, emptyIcon: Icon = ClipboardList, children }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
            {cols.map((c) => <th key={c} className="p-4 whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr><td colSpan={cols.length} className="p-8 text-center text-slate-400">Loading...</td></tr>
          ) : empty ? (
            <tr><td colSpan={cols.length} className="p-10 text-center">
              <Icon size={40} className="mx-auto text-slate-300 mb-2" />
              <p className="text-slate-500 font-medium">No data found</p>
            </td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

function DateRangeFilter({ dateFrom, setDateFrom, dateTo, setDateTo, search, setSearch, searchPlaceholder }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap gap-2 items-center">
      {setSearch && (
        <div className="relative flex-1 min-w-40">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder={searchPlaceholder || "Search..."} value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">From</label>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">To</label>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
      </div>
      {(search || dateFrom || dateTo) && (
        <button onClick={() => { setSearch?.(""); setDateFrom(""); setDateTo(""); }}
          className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

function CardShell({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="font-bold text-slate-700">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Tab: Overview Dashboard ──────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/reports/dashboard`)
      .then((r) => { if (!r.ok) throw new Error("Failed to fetch"); return r.json(); })
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center">
        <BarChart3 className="text-blue-500 w-12 h-12 mb-4 animate-bounce" />
        <p className="text-slate-500 font-medium">Crunching your numbers...</p>
      </div>
    </div>
  );
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3">
      <AlertTriangle size={20} />{error}
    </div>
  );

  const { totalRevenueToday, todayProfit, inventoryValue, topSelling, lowStock, zReport } = data;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Total Revenue Today</p>
              <h3 className="text-3xl font-bold text-slate-900">{fmt(totalRevenueToday)}</h3>
            </div>
            <div className="bg-blue-100 p-3 rounded-xl"><DollarSign className="text-blue-600 w-6 h-6" /></div>
          </div>
          <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
            {zReport.length > 0 ? zReport.map((z) => (
              <span key={z.payment_method} className="inline-block mr-3">
                {z.payment_method}: <span className="font-semibold text-slate-700">{fmt(z.total)}</span>
              </span>
            )) : "No sales yet today"}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Net Profit Today</p>
              <h3 className="text-3xl font-bold text-emerald-600">{fmt(todayProfit)}</h3>
            </div>
            <div className="bg-emerald-100 p-3 rounded-xl"><TrendingUp className="text-emerald-600 w-6 h-6" /></div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Gross Sales minus Cost of Goods Sold</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Est. Inventory Retail Value</p>
              <h3 className="text-3xl font-bold text-indigo-600">{fmt(inventoryValue.retail_value)}</h3>
            </div>
            <div className="bg-indigo-100 p-3 rounded-xl"><PackageX className="text-indigo-600 w-6 h-6" /></div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Base Cost Value: <span className="font-semibold">{fmt(inventoryValue.cost_value)}</span></p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <ShoppingBag className="text-blue-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Top Selling Products (All Time)</h3>
          </div>
          {topSelling.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {topSelling.map((item, i) => (
                <li key={i} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50">
                  <span className="font-medium text-slate-700">{i + 1}. {item.name}</span>
                  <span className="bg-blue-100 text-blue-800 py-1 px-3 rounded-full text-xs font-bold">{item.total_sold} Sold</span>
                </li>
              ))}
            </ul>
          ) : <div className="p-6 text-center text-slate-500">No sales data available yet.</div>}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <TrendingDown className="text-rose-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Low Stock Alerts (10 or fewer)</h3>
          </div>
          {lowStock.length > 0 ? (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {lowStock.map((item, i) => (
                <li key={i} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50">
                  <div>
                    <span className="block font-medium text-slate-700">{item.name}</span>
                    <span className="block text-xs text-slate-400 font-mono mt-0.5">{item.barcode}</span>
                  </div>
                  <span className={`py-1 px-3 rounded-full text-xs font-bold ${item.stock === 0 ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"}`}>
                    {item.stock} Left
                  </span>
                </li>
              ))}
            </ul>
          ) : <div className="p-6 text-center text-emerald-600 font-medium">All items are well stocked!</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Sales Summary ───────────────────────────────────────────────────────

function SalesSummaryTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/sales-summary?${p}`);
      const d = await res.json();
      setRows(d.sales || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const total = rows.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
        search={search} setSearch={setSearch} searchPlaceholder="Search order # or customer..." />
      <CardShell title="Sales Summary" subtitle={`${rows.length} sale${rows.length !== 1 ? "s" : ""} · Total: ${fmt(total)}`}>
        <TableShell cols={["Date", "Order #", "Customer", "Outlet", "Employee", "Payment", "Total"]}
          loading={loading} empty={rows.length === 0}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-mono font-bold text-slate-800">#{r.id}</td>
              <td className="p-4 text-sm font-medium text-slate-800">{r.customer_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.payment_methods}</td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.total_amount)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Sales Detail ────────────────────────────────────────────────────────

function SalesDetailTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/sales-detail?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const totalRevenue = rows.reduce((s, r) => s + r.line_total, 0);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
        search={search} setSearch={setSearch} searchPlaceholder="Search product or order #..." />
      <CardShell title="Sales Detail" subtitle={`${rows.length} line item${rows.length !== 1 ? "s" : ""} · Revenue: ${fmt(totalRevenue)}`}>
        <TableShell cols={["Order #", "Date", "Customer", "Product", "Barcode", "Qty", "Price", "Cost", "Line Total"]}
          loading={loading} empty={rows.length === 0}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-mono font-bold text-slate-800">#{r.sale_id}</td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 text-sm text-slate-700">{r.customer_name}</td>
              <td className="p-4 text-sm font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-center font-semibold text-slate-700">{r.quantity}</td>
              <td className="p-4 text-right text-sm text-slate-700">{fmt(r.price_at_sale)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.cost_price_at_sale)}</td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.line_total)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Sales & Stock ───────────────────────────────────────────────────────

function SalesStockTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/reports/sales-stock`)
      .then((r) => r.json()).then((d) => setRows(d.rows || []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  return (
    <CardShell title="Sales & Stock" subtitle="All-time sales performance vs. current stock level per product">
      <TableShell cols={["Product", "Barcode", "Category", "Units Sold", "Revenue", "Current Stock"]}
        loading={loading} empty={rows.length === 0} emptyIcon={Package}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
            <td className="p-4 text-sm text-slate-600">{r.category}</td>
            <td className="p-4 text-center">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.units_sold}</span>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(r.revenue)}</td>
            <td className="p-4 text-center">
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.total_stock === 0 ? "bg-rose-100 text-rose-700" : r.total_stock <= 10 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                {r.total_stock}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: Inventory Dump ──────────────────────────────────────────────────────

function InventoryDumpTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/outlets`).then((r) => r.json()).then((d) => setOutlets(d.outlets || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = outletId ? `?outlet_id=${outletId}` : "";
      const res = await fetch(`${API}/api/reports/inventory-dump${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [outletId]);

  useEffect(() => { load(); }, [load]);
  const totalRetail = rows.reduce((s, r) => s + r.retail_value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost_value, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Outlet</label>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
          <option value="">All Outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <CardShell title="Inventory Dump" subtitle={`${rows.length} records · Retail Value: ${fmt(totalRetail)} · Cost Value: ${fmt(totalCost)}`}>
        <TableShell cols={["Outlet", "Product", "Barcode", "Category", "Brand", "Price", "Cost", "Qty", "Retail Value", "Cost Value"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Archive}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-sm text-slate-600">{r.category}</td>
              <td className="p-4 text-sm text-slate-600">{r.brand}</td>
              <td className="p-4 text-right text-sm text-slate-700">{fmt(r.price)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.cost_price)}</td>
              <td className="p-4 text-center font-semibold text-slate-700">{r.quantity}</td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.retail_value)}</td>
              <td className="p-4 text-right text-slate-600">{fmt(r.cost_value)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Category Wise ───────────────────────────────────────────────────────

function CategoryWiseTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/category-wise?${p}`);
      const d = await res.json();
      setRows(d.data || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
        search={search} />
      <CardShell title="Category Wise Sales" subtitle="Revenue and profit breakdown by product category">
        <TableShell cols={["Category", "Units Sold", "Revenue", "COGS", "Gross Profit", "% of Revenue"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Tag}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-medium text-slate-800">{r.category}</td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.units_sold}</span>
              </td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.revenue)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.cost)}</td>
              <td className="p-4 text-right font-semibold text-emerald-700">{fmt(r.profit)}</td>
              <td className="p-4 text-center">
                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.pct}%</span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Customer Details ────────────────────────────────────────────────────

function CustomerDetailsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetch_ = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reports/customer-details?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setRows(data.customers || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useEffect(() => { const t = setTimeout(() => fetch_(search), 300); return () => clearTimeout(t); }, [search, fetch_]);

  return (
    <CardShell title="Customer Details">
      <div className="p-3 border-b border-slate-200 bg-slate-50">
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search name or mobile..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
        </div>
      </div>
      <TableShell cols={["Date Created", "Customer", "Amount Spent", "Orders", "Mobile", "Email"]}
        loading={loading} empty={rows.length === 0} emptyIcon={Users}>
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500">{fmtDate(c.created_at)}</td>
            <td className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <span className="font-semibold text-slate-800">{c.name}</span>
              </div>
            </td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(c.total_spent)}</td>
            <td className="p-4 text-center"><span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">{c.order_count}</span></td>
            <td className="p-4 text-sm text-slate-600">{c.mobile || <span className="italic text-slate-400">—</span>}</td>
            <td className="p-4 text-sm text-slate-600">{c.email || <span className="italic text-slate-400">—</span>}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: Customer Wise ───────────────────────────────────────────────────────

function CustomerWiseTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/reports/customer-wise`).then((r) => r.json())
      .then((d) => setRows(d.data || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  return (
    <CardShell title="Customer Wise Summary" subtitle="Total orders and revenue per customer, ranked by spend.">
      <TableShell cols={["#", "Customer", "Order Count", "Amount"]} loading={loading} empty={rows.length === 0} emptyIcon={Users}>
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
            <td className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-linear-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {r.customer.charAt(0).toUpperCase()}
                </div>
                <span className="font-semibold text-slate-800">{r.customer}</span>
              </div>
            </td>
            <td className="p-4 text-center"><span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">{r.order_count}</span></td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(r.total_amount)}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: Order Wise ──────────────────────────────────────────────────────────

function OrderWiseTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/order-wise?${p}`);
      const d = await res.json();
      setRows(d.orders || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const totalExcl = rows.reduce((s, r) => s + r.sale_excl_tax, 0);
  const totalIncl = rows.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
        search={search} setSearch={setSearch} searchPlaceholder="Search order # or customer..." />
      <CardShell title="Order Wise Report" subtitle={`${rows.length} order${rows.length !== 1 ? "s" : ""} — Excl. Tax ${fmt(totalExcl)} · Incl. Tax ${fmt(totalIncl)}`}>
        <TableShell cols={["Date", "Customer", "Order #", "Sale Excl. Tax", "Discount", "Sale Incl. Tax", "Payment"]}
          loading={loading} empty={rows.length === 0}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-600 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 text-sm font-medium text-slate-800">{r.customer_name}</td>
              <td className="p-4 font-mono font-bold text-slate-800">#{r.id}</td>
              <td className="p-4 text-right text-sm text-slate-700">{fmt(r.sale_excl_tax)}</td>
              <td className="p-4 text-right text-sm">
                {r.discount_amount > 0
                  ? <span className="text-rose-600 font-semibold">-{fmt(r.discount_amount)}</span>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.total_amount)}</td>
              <td className="p-4 text-sm text-slate-600">{r.payment_method}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Item Wise ───────────────────────────────────────────────────────────

function ItemWiseTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/item-wise?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.gross_profit, 0);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} search={search} />
      <CardShell title="Item Wise Report" subtitle={`${rows.length} product${rows.length !== 1 ? "s" : ""} · Revenue: ${fmt(totalRevenue)} · Profit: ${fmt(totalProfit)}`}>
        <TableShell cols={["#", "Product", "Barcode", "Units Sold", "Revenue", "COGS", "Gross Profit"]}
          loading={loading} empty={rows.length === 0} emptyIcon={ShoppingBag}>
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.units_sold}</span></td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.revenue)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.total_cost)}</td>
              <td className="p-4 text-right font-semibold text-emerald-700">{fmt(r.gross_profit)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Product Performance ─────────────────────────────────────────────────

function ProductPerformanceTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/product-performance?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} search={search} />
      <CardShell title="Product Performance" subtitle="Products ranked by gross profit margin %">
        <TableShell cols={["#", "Product", "Units Sold", "Revenue", "COGS", "Gross Profit", "Margin %"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Star}>
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-400 font-mono">{i + 1}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.units_sold}</span></td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.revenue)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.total_cost)}</td>
              <td className="p-4 text-right font-semibold text-emerald-700">{fmt(r.gross_profit)}</td>
              <td className="p-4 text-center">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${r.margin_pct >= 40 ? "bg-emerald-100 text-emerald-700" : r.margin_pct >= 20 ? "bg-yellow-100 text-yellow-700" : "bg-rose-100 text-rose-700"}`}>
                  {r.margin_pct}%
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Product Specification ───────────────────────────────────────────────

function ProductSpecTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reports/product-spec?search=${encodeURIComponent(q)}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(search), 300); return () => clearTimeout(t); }, [search, load]);

  return (
    <CardShell title="Product Specification" subtitle="Full product catalogue with all fields">
      <div className="p-3 border-b border-slate-200 bg-slate-50">
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search name or barcode..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
        </div>
      </div>
      <TableShell cols={["ID", "Barcode", "Product", "Category", "Brand", "Supplier", "Price", "Cost", "Tax", "Rate"]}
        loading={loading} empty={rows.length === 0} emptyIcon={Package}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-xs font-mono text-slate-400">{r.id}</td>
            <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 text-sm text-slate-600">{r.category}</td>
            <td className="p-4 text-sm text-slate-600">{r.brand}</td>
            <td className="p-4 text-sm text-slate-600">{r.supplier}</td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(r.price)}</td>
            <td className="p-4 text-right text-sm text-slate-500">{fmt(r.cost_price)}</td>
            <td className="p-4 text-sm text-slate-600">{r.tax_name}</td>
            <td className="p-4 text-center text-sm font-semibold text-slate-700">{r.tax_rate}%</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: On Hand Inventory ───────────────────────────────────────────────────

function OnHandTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/outlets`).then((r) => r.json()).then((d) => setOutlets(d.outlets || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = outletId ? `?outlet_id=${outletId}` : "";
      const res = await fetch(`${API}/api/reports/on-hand${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [outletId]);

  useEffect(() => { load(); }, [load]);
  const totalRetail = rows.reduce((s, r) => s + r.retail_value, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Outlet</label>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
          <option value="">All Outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <CardShell title="On Hand Inventory" subtitle={`${rows.length} records · Retail Value: ${fmt(totalRetail)}`}>
        <TableShell cols={["Product", "Barcode", "Outlet", "Qty on Hand", "Price", "Cost", "Retail Value", "Cost Value"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Layers}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-center">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.quantity === 0 ? "bg-rose-100 text-rose-700" : r.quantity <= 10 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {r.quantity}
                </span>
              </td>
              <td className="p-4 text-right text-sm text-slate-700">{fmt(r.price)}</td>
              <td className="p-4 text-right text-sm text-slate-500">{fmt(r.cost_price)}</td>
              <td className="p-4 text-right font-bold text-slate-900">{fmt(r.retail_value)}</td>
              <td className="p-4 text-right text-slate-600">{fmt(r.cost_value)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Inventory Loss ──────────────────────────────────────────────────────

function InventoryLossTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/inventory-loss?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const totalLoss = rows.reduce((s, r) => s + Math.abs(r.quantity_change), 0);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} search={search} />
      <CardShell title="Inventory Loss" subtitle={`${rows.length} adjustment${rows.length !== 1 ? "s" : ""} · Total units lost: ${totalLoss}`}>
        <TableShell cols={["Date", "Product", "Barcode", "Outlet", "Employee", "Qty Change", "Reason"]}
          loading={loading} empty={rows.length === 0} emptyIcon={TrendingDown}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-center font-bold text-rose-700">{r.quantity_change}</td>
              <td className="p-4 text-sm text-slate-600">{r.reason}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Wastage ─────────────────────────────────────────────────────────────

function WastageTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/reports/wastage?${p}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} search={search} />
      <CardShell title="Wastage Report" subtitle="Stock adjustments with Damaged or Expired reason">
        <TableShell cols={["Date", "Product", "Barcode", "Outlet", "Employee", "Qty", "Reason"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Recycle}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name}</td>
              <td className="p-4 text-center font-bold text-orange-700">{r.quantity_change}</td>
              <td className="p-4">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.reason === "Damaged" ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"}`}>
                  {r.reason}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Product Movement ────────────────────────────────────────────────────

function ProductMovementTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/transfers`).then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  return (
    <CardShell title="Product Movement" subtitle="All inter-outlet inventory transfers">
      <TableShell cols={["Date", "Product", "From Outlet", "To Outlet", "Qty", "Employee", "Note"]}
        loading={loading} empty={rows.length === 0} emptyIcon={ArrowLeftRight}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
            <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
            <td className="p-4 text-sm text-slate-600">{r.from_outlet_name}</td>
            <td className="p-4 text-sm text-slate-600">{r.to_outlet_name}</td>
            <td className="p-4 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.quantity}</span></td>
            <td className="p-4 text-sm text-slate-600">{r.employee_name || "—"}</td>
            <td className="p-4 text-sm text-slate-500 italic">{r.note || "—"}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: STR Report ──────────────────────────────────────────────────────────

function STRReportTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetch(`${API}/api/transfers`).then((r) => r.json());
      let data = Array.isArray(all) ? all : [];
      if (dateFrom) data = data.filter((r) => r.timestamp >= dateFrom);
      if (dateTo) data = data.filter((r) => r.timestamp <= dateTo + "T23:59:59");
      setRows(data);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} search={search} />
      <CardShell title="STR Report — Stock Transfer" subtitle={`${rows.length} transfer${rows.length !== 1 ? "s" : ""}`}>
        <TableShell cols={["Transfer #", "Date", "Product", "From", "To", "Qty", "Employee", "Notes"]}
          loading={loading} empty={rows.length === 0} emptyIcon={ArrowLeftRight}>
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 text-xs font-mono text-slate-400">{String(i + 1).padStart(4, "0")}</td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.from_outlet_name}</td>
              <td className="p-4 text-sm text-slate-600">{r.to_outlet_name}</td>
              <td className="p-4 text-center"><span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.quantity}</span></td>
              <td className="p-4 text-sm text-slate-600">{r.employee_name || "—"}</td>
              <td className="p-4 text-sm text-slate-500 italic">{r.note || "—"}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Replenishment ───────────────────────────────────────────────────────

function ReplenishmentTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reports/replenishment?threshold=${threshold}`);
      const d = await res.json();
      setRows(d.rows || []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [threshold]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Threshold (units)</label>
        <input type="number" min={0} max={1000} value={threshold}
          onChange={(e) => setThreshold(parseInt(e.target.value) || 0)}
          className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
        <span className="text-xs text-slate-500">Show products at or below this quantity</span>
      </div>
      <CardShell title="Replenishment Report" subtitle={`${rows.length} product${rows.length !== 1 ? "s" : ""} need restocking (≤ ${threshold} units)`}>
        <TableShell cols={["Product", "Barcode", "Outlet", "Qty on Hand", "Status"]}
          loading={loading} empty={rows.length === 0} emptyIcon={RotateCcw}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-medium text-slate-800">{r.product_name}</td>
              <td className="p-4 text-xs font-mono text-slate-500">{r.barcode}</td>
              <td className="p-4 text-sm text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-center">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.quantity === 0 ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"}`}>
                  {r.quantity}
                </span>
              </td>
              <td className="p-4">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${r.quantity === 0 ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"}`}>
                  {r.quantity === 0 ? "Out of Stock" : "Low Stock"}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Tab: Supplier Wise ───────────────────────────────────────────────────────

function SupplierWiseTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/reports/supplier-wise`).then((r) => r.json())
      .then((d) => setRows(d.rows || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  return (
    <CardShell title="Supplier Wise" subtitle="Purchase order spending aggregated per supplier">
      <TableShell cols={["Supplier", "Contact", "Phone", "Total POs", "Items Ordered", "Total Cost"]}
        loading={loading} empty={rows.length === 0} emptyIcon={Truck}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 font-medium text-slate-800">{r.supplier_name}</td>
            <td className="p-4 text-sm text-slate-600">{r.contact_person || "—"}</td>
            <td className="p-4 text-sm text-slate-600">{r.phone || "—"}</td>
            <td className="p-4 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.total_pos}</span></td>
            <td className="p-4 text-center text-sm text-slate-700">{r.total_items}</td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(r.total_cost)}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Tab: Purchase Orders Report ──────────────────────────────────────────────

function PurchaseOrdersReportTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/purchase-orders`).then((r) => r.json())
      .then((d) => setRows(d.purchase_orders || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  const statusColor = (s) =>
    s === "Received" ? "bg-emerald-100 text-emerald-700" :
    s === "Ordered" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700";

  return (
    <CardShell title="Purchase Orders" subtitle={`${rows.length} purchase order${rows.length !== 1 ? "s" : ""}`}>
      <TableShell cols={["Date", "PO #", "Supplier", "Status", "Total Cost"]}
        loading={loading} empty={rows.length === 0} emptyIcon={ShoppingCart}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
            <td className="p-4 font-mono font-bold text-slate-800">PO-{String(r.id).padStart(4, "0")}</td>
            <td className="p-4 font-medium text-slate-800">{r.supplier_name}</td>
            <td className="p-4"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor(r.status)}`}>{r.status}</span></td>
            <td className="p-4 text-right font-bold text-slate-900">{fmt(r.total_cost)}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── GRN Report Tab ───────────────────────────────────────────────────────────

function GRNReportTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    fetch(`${API}/api/grn?${p}`)
      .then((r) => r.json())
      .then((d) => setRows(d.grns || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} onApply={load} />
      <CardShell title="GRN Report" subtitle={`${rows.length} goods received note${rows.length !== 1 ? "s" : ""}`} icon={Archive}>
        <TableShell cols={["GRN #", "Date", "PO #", "Supplier", "Outlet", "Received By", "Lines"]}
          loading={loading} empty={rows.length === 0} emptyIcon={Archive}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4 font-mono font-bold text-slate-800">{r.grn_number}</td>
              <td className="p-4 text-sm text-slate-500 whitespace-nowrap">{fmtDate(r.received_at)}</td>
              <td className="p-4 font-mono text-slate-700">{r.po_number || "—"}</td>
              <td className="p-4 font-medium text-slate-800">{r.supplier_name || "—"}</td>
              <td className="p-4 text-slate-600">{r.outlet_name || "—"}</td>
              <td className="p-4 text-slate-600">{r.received_by_name || "—"}</td>
              <td className="p-4 text-center">
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{r.line_count}</span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// ─── Attendance Tab ───────────────────────────────────────────────────────────

function AttendanceTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/employees`).then((r) => r.json()).then((d) => setEmployees(d.employees || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (employeeId) p.set("employee_id", employeeId);
    fetch(`${API}/api/attendance?${p}`)
      .then((r) => r.json())
      .then((d) => setRecords(d.records || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, employeeId]);

  useEffect(() => { load(); }, [load]);

  const totalHours = records.reduce((s, r) => s + (r.hours || 0), 0);

  const fmtTime = (dt) => dt ? new Date(dt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <CardShell title="Attendance Report" icon={Clock}>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onApply={load} />
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Employees</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span className="ml-auto text-sm font-semibold text-slate-600 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
          Total: {totalHours.toFixed(2)}h
        </span>
      </div>
      <TableShell
        cols={["Date", "Employee", "Role", "Outlet", "Check In", "Check Out", "Hours", "Status"]}
        loading={loading}
        empty={records.length === 0}
      >
        {records.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.check_in)}</td>
            <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{r.employee_name}</td>
            <td className="px-4 py-3 text-slate-500 capitalize whitespace-nowrap">{r.role}</td>
            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.outlet_name}</td>
            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">{fmtTime(r.check_in)}</td>
            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">{fmtTime(r.check_out)}</td>
            <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{r.hours != null ? `${r.hours.toFixed(2)}h` : "—"}</td>
            <td className="px-4 py-3">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                r.status === "present" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}>{r.status}</span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────

const GROUPS = [
  {
    label: "Sales",
    tabs: [
      { id: "overview", label: "Overview", icon: BarChart3 },
      { id: "sales-summary", label: "Sales Summary", icon: BarChart2 },
      { id: "sales-detail", label: "Sales Detail", icon: FileText },
      { id: "order-wise", label: "Order Wise", icon: ClipboardList },
      { id: "item-wise", label: "Item Wise", icon: ShoppingBag },
      { id: "category-wise", label: "Category Wise", icon: Tag },
    ],
  },
  {
    label: "Customers",
    tabs: [
      { id: "customer-details", label: "Customer Details", icon: Users },
      { id: "customer-wise", label: "Customer Wise", icon: TrendingUp },
    ],
  },
  {
    label: "Inventory",
    tabs: [
      { id: "product-performance", label: "Product Performance", icon: Star },
      { id: "sales-stock", label: "Sales & Stock", icon: Package },
      { id: "inventory-dump", label: "Inventory Dump", icon: Archive },
      { id: "on-hand", label: "On Hand", icon: Layers },
      { id: "product-spec", label: "Product Spec", icon: Package },
      { id: "replenishment", label: "Replenishment", icon: RotateCcw },
    ],
  },
  {
    label: "Operations",
    tabs: [
      { id: "inventory-loss", label: "Inventory Loss", icon: TrendingDown },
      { id: "wastage", label: "Wastage", icon: Recycle },
      { id: "product-movement", label: "Product Movement", icon: ArrowLeftRight },
      { id: "str-report", label: "STR Report", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Procurement",
    tabs: [
      { id: "supplier-wise", label: "Supplier Wise", icon: Truck },
      { id: "purchase-orders-report", label: "Purchase Orders", icon: ShoppingCart },
      { id: "grn-report", label: "GRN Report", icon: Archive },
    ],
  },
  {
    label: "HR",
    tabs: [
      { id: "attendance", label: "Attendance", icon: Clock },
    ],
  },
];

function TabContent({ activeTab }) {
  switch (activeTab) {
    case "overview": return <OverviewTab />;
    case "sales-summary": return <SalesSummaryTab />;
    case "sales-detail": return <SalesDetailTab />;
    case "sales-stock": return <SalesStockTab />;
    case "inventory-dump": return <InventoryDumpTab />;
    case "category-wise": return <CategoryWiseTab />;
    case "customer-details": return <CustomerDetailsTab />;
    case "customer-wise": return <CustomerWiseTab />;
    case "order-wise": return <OrderWiseTab />;
    case "item-wise": return <ItemWiseTab />;
    case "product-performance": return <ProductPerformanceTab />;
    case "product-spec": return <ProductSpecTab />;
    case "on-hand": return <OnHandTab />;
    case "inventory-loss": return <InventoryLossTab />;
    case "wastage": return <WastageTab />;
    case "product-movement": return <ProductMovementTab />;
    case "str-report": return <STRReportTab />;
    case "replenishment": return <ReplenishmentTab />;
    case "supplier-wise": return <SupplierWiseTab />;
    case "purchase-orders-report": return <PurchaseOrdersReportTab />;
    case "grn-report": return <GRNReportTab />;
    case "attendance": return <AttendanceTab />;
    default: return null;
  }
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Reports</h1>
        <p className="text-slate-500">20 reports across sales, inventory, operations, and procurement.</p>
      </div>

      {/* Grouped Tab Bar — horizontally scrollable */}
      <div className="overflow-x-auto shrink-0">
        <div className="flex gap-4 min-w-max pb-1">
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">{group.label}</span>
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                {group.tabs.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      activeTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto min-h-0">
        <TabContent activeTab={activeTab} />
      </div>
    </div>
  );
}

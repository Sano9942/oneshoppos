import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  DollarSign, TrendingUp, ShoppingBag, Package,
  MonitorPlay, BarChart3, AlertTriangle, TrendingDown,
  Clock, CheckCircle, XCircle, ArrowRight, Users,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const API = "http://localhost:5000";
const fmt = (n) => "$" + (n || 0).toFixed(2);

function KPICard({ title, value, sub, icon: Icon, iconBg, iconColor, valueColor = "text-slate-900" }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
          <h3 className={`text-3xl font-bold ${valueColor}`}>{value}</h3>
        </div>
        <div className={`${iconBg} p-3 rounded-xl`}>
          <Icon className={`${iconColor} w-6 h-6`} />
        </div>
      </div>
      {sub && <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">{sub}</p>}
    </div>
  );
}

// Format day label: "2026-02-24" → "Feb 24"
function fmtDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Custom tooltip for the trend chart
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-semibold text-slate-700 mb-1">{fmtDay(label)}</p>
      <p className="text-[#8066FF] font-bold">{fmt(payload[0]?.value)}</p>
      <p className="text-slate-500 text-xs">{payload[1]?.value || 0} sales</p>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [shift, setShift] = useState(null);
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/reports/dashboard`).then((r) => r.json()),
      fetch(`${API}/api/outlets`).then((r) => r.json()).then(async (d) => {
        const outlets = d.outlets || [];
        if (outlets.length === 0) return null;
        return fetch(`${API}/api/shifts/active?outlet_id=${outlets[0].id}`)
          .then((r) => r.json()).then((s) => s.shift || null).catch(() => null);
      }),
      fetch(`${API}/api/reports/top-salespeople`).then((r) => r.json()),
    ])
      .then(([dashData, activeShift, spData]) => {
        setData(dashData);
        setShift(activeShift);
        setSalespeople(spData.salespeople || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3">
        <BarChart3 className="text-blue-500 w-12 h-12 animate-bounce" />
        <p className="text-slate-500 font-medium">Loading dashboard...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl flex items-center gap-3">
        <AlertTriangle size={20} /> {error}
      </div>
    </div>
  );

  const { totalRevenueToday, todayProfit, todayExpenses = 0, saleCount, inventoryValue, topSelling, lowStock, zReport, salesTrend = [] } = data;

  const zReportText = zReport.length > 0
    ? zReport.map((z) => `${z.payment_method}: ${fmt(z.total)}`).join(" · ")
    : "No sales recorded today";

  // Fill in missing days in the trend so the chart always shows 7 bars
  const trendMap = Object.fromEntries(salesTrend.map((r) => [r.day, r]));
  const trendData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split("T")[0];
    return { day: key, revenue: trendMap[key]?.revenue || 0, sale_count: trendMap[key]?.sale_count || 0 };
  });

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Dashboard</h1>
          <p className="text-slate-500">
            {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate("/reports")}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-xl text-sm transition-colors shadow-sm">
            <BarChart3 size={15} /> Reports <ArrowRight size={14} className="text-slate-400" />
          </button>
          <button onClick={() => navigate("/pos")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-xl text-sm transition-colors shadow-sm">
            <MonitorPlay size={15} /> Open Register
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Revenue Today"
          value={fmt(totalRevenueToday)}
          sub={zReportText}
          icon={DollarSign}
          iconBg="bg-blue-100" iconColor="text-blue-600"
        />
        <KPICard
          title="Net Profit Today"
          value={fmt(todayProfit)}
          sub={todayExpenses > 0 ? `After ${fmt(todayExpenses)} expenses` : "Gross sales minus cost of goods"}
          icon={TrendingUp}
          iconBg="bg-emerald-100" iconColor="text-emerald-600"
          valueColor="text-emerald-600"
        />
        <KPICard
          title="Sales Today"
          value={saleCount}
          sub="Total completed transactions"
          icon={ShoppingBag}
          iconBg="bg-violet-100" iconColor="text-violet-600"
          valueColor="text-violet-600"
        />
        <KPICard
          title="Inventory Value"
          value={fmt(inventoryValue?.retail_value || 0)}
          sub={`Cost value: ${fmt(inventoryValue?.cost_value || 0)}`}
          icon={Package}
          iconBg="bg-indigo-100" iconColor="text-indigo-600"
          valueColor="text-indigo-600"
        />
      </div>

      {/* Shift Status Banner */}
      <div className={`rounded-2xl border px-6 py-4 flex items-center gap-4 ${
        shift ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
      }`}>
        <div className={`p-2 rounded-xl ${shift ? "bg-emerald-100" : "bg-amber-100"}`}>
          {shift ? <CheckCircle className="text-emerald-600 w-5 h-5" /> : <XCircle className="text-amber-600 w-5 h-5" />}
        </div>
        <div className="flex-1">
          {shift ? (
            <>
              <p className="font-semibold text-emerald-800 text-sm">Cash Shift Open</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Opened by <span className="font-medium">{shift.employee_name || "Unknown"}</span> at{" "}
                {new Date(shift.opened_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·
                Opening float: <span className="font-medium">{fmt(shift.opening_float)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-amber-800 text-sm">No Active Cash Shift</p>
              <p className="text-xs text-amber-700 mt-0.5">Open a shift in Cash Management before processing sales.</p>
            </>
          )}
        </div>
        {!shift && (
          <button onClick={() => navigate("/cash-management")}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
            <Clock size={13} /> Open Shift
          </button>
        )}
      </div>

      {/* Sales Trend Chart — last 7 days */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-[#8066FF] w-4 h-4" />
            <h3 className="font-bold text-slate-800 text-sm">Sales Trend</h3>
          </div>
          <span className="text-xs text-slate-400">Last 7 days</span>
        </div>
        {trendData.every((d) => d.revenue === 0) ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <BarChart3 size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No sales in the last 7 days</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trendData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={fmtDay}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v)}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: "#f8fafc" }} />
              <Bar dataKey="revenue" fill="#8066FF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sale_count" fill="#e0d9ff" radius={[4, 4, 0, 0]} hide />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Bottom Three-Column */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">

        {/* Top Sales People */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-[#8066FF] w-4 h-4" />
              <h3 className="font-bold text-slate-800 text-sm">Top Sales People</h3>
            </div>
            <span className="text-xs text-slate-400">All time</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {salespeople.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Txns</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {salespeople.map((sp, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <span className="font-medium text-slate-700 truncate">{sp.employee_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{fmt(sp.revenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{sp.transactions}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmt(sp.avg_basket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                <Users size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No sales data yet</p>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30">
            <button onClick={() => navigate("/reports")}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View sales reports <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Top Selling Products */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="text-blue-500 w-4 h-4" />
              <h3 className="font-bold text-slate-800 text-sm">Top Selling Products</h3>
            </div>
            <span className="text-xs text-slate-400">All time</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {topSelling.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {topSelling.map((item, i) => (
                  <li key={i} className="flex justify-between items-center px-6 py-3.5 hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-medium text-slate-700 text-sm">{item.name}</span>
                    </div>
                    <span className="bg-blue-100 text-blue-800 py-0.5 px-2.5 rounded-full text-xs font-bold">
                      {item.total_sold} sold
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                <ShoppingBag size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No sales data yet</p>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30">
            <button onClick={() => navigate("/reports")}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View Item Wise report <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Low Stock */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="text-rose-500 w-4 h-4" />
              <h3 className="font-bold text-slate-800 text-sm">Low Stock Alerts</h3>
            </div>
            <span className="text-xs text-slate-400">≤ 10 units</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {lowStock.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {lowStock.map((item, i) => (
                  <li key={i} className="flex justify-between items-center px-6 py-3.5 hover:bg-slate-50">
                    <div>
                      <span className="block font-medium text-slate-700 text-sm">{item.name}</span>
                      <span className="block text-xs text-slate-400 font-mono mt-0.5">{item.barcode}</span>
                    </div>
                    <span className={`py-0.5 px-2.5 rounded-full text-xs font-bold ${
                      item.stock === 0 ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"
                    }`}>
                      {item.stock === 0 ? "Out of Stock" : `${item.stock} left`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
                <CheckCircle size={32} className="mb-2 text-emerald-400" />
                <p className="text-sm text-emerald-600 font-medium">All items well stocked!</p>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30">
            <button onClick={() => navigate("/inventory")}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Manage inventory <ArrowRight size={12} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  ShoppingBag,
  LayoutGrid,
} from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  ExportButton,
  TableShell,
  CardShell,
  MetricCard,
} from "./ReportShared";

// --- Tab: Comparative Trends --------------------------------------------------
export function ComparativeTrendsTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ outlet_id: filters.outletId });
      const res = await fetch(`${API}/api/reports/comparative-trends?${p}`);
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-slate-400 font-medium">
        Calculating comparative benchmarks...
      </div>
    );
  if (!data?.data?.today)
    return (
      <div className="p-8 text-center text-slate-400">
        No snapshot data for today
      </div>
    );

  const { today } = data.data;
  const { comparisons = {} } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-tight">
          Today's Live Pulse
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue (v Yesterday)"
          value={fmt(today.revenue)}
          compPct={comparisons.day_over_day_revenue_pct}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Orders (v Yesterday)"
          value={today.orders}
          compPct={comparisons.day_over_day_orders_pct}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Revenue (v Last Week)"
          value={fmt(today.revenue)}
          compPct={comparisons.week_over_week_revenue_pct}
          compLabel="L. Week"
        />
        <MetricCard
          title="Orders (v Last Week)"
          value={today.orders}
          compPct={comparisons.week_over_week_orders_pct}
          compLabel="L. Week"
        />
      </div>
    </div>
  );
}

// --- Tab: Heatmaps ------------------------------------------------------------
export function HeatmapsTab({ filters }) {
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/heatmaps?${p}`);
      const d = await res.json();
      setHeatmap(d.heatmap || []);
    } catch {
      setHeatmap([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-slate-400 font-medium">
        Generating sales density map...
      </div>
    );

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = Array.from({ length: 24 }).map((_, h) =>
    h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p",
  );
  const maxRev = Math.max(...heatmap.map((h) => h.revenue), 1);

  return (
    <CardShell
      title="Hourly Sales Intensity"
      subtitle="Identifying peak traffic windows for staffing optimization"
    >
      <div className="overflow-x-auto pb-4">
        <div className="min-w-200">
          <div className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 text-[10px]">
            <div />
            {hours.map((h) => (
              <div key={h} className="text-center font-bold text-slate-400">
                {h}
              </div>
            ))}

            {days.map((dayName, d) => (
              <React.Fragment key={dayName}>
                <div className="font-bold text-slate-600 flex items-center justify-end pr-2 h-8">
                  {dayName}
                </div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const cell = heatmap.find(
                    (x) => x.day_of_week === d && x.hour_of_day === h,
                  );
                  const rev = cell ? cell.revenue : 0;
                  const intensity = Math.min(
                    100,
                    Math.round((rev / maxRev) * 100),
                  );
                  return (
                    <div
                      key={h}
                      title={`${dayName} ${hours[h]}: ${fmt(rev)}`}
                      className="rounded-sm transition-all hover:ring-2 hover:ring-blue-400 cursor-help h-8"
                      style={{
                        backgroundColor:
                          rev > 0
                            ? `rgba(59, 130, 246, ${0.1 + (intensity / 100) * 0.9})`
                            : "#f8fafc",
                      }}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// --- Tab: Revenue Leaks -------------------------------------------------------
export function RevenueLeaksTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/revenue-leaks?${p}`);
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-slate-400 font-medium">
        Scanning for patterns of revenue leakage...
      </div>
    );
  if (!data)
    return (
      <div className="p-8 text-center text-slate-400">
        No anomaly data found
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">
            Potential Leakage
          </p>
          <p className="text-2xl font-black text-rose-700">
            {fmt(data.summary.leakage_total)}
          </p>
        </div>
        <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1">
            Voids Impact
          </p>
          <p className="text-2xl font-black text-orange-700">
            {fmt(data.summary.voids)}
          </p>
          <p className="text-[10px] text-orange-600 font-medium">
            Across {data.transactions.voided} bills
          </p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">
            Discounts Given
          </p>
          <p className="text-2xl font-black text-indigo-700">
            {fmt(data.summary.discounts)}
          </p>
          <p className="text-[10px] text-indigo-600 font-medium">
            On {data.transactions.discounted} sales
          </p>
        </div>
      </div>

      <CardShell title="Loss Attribution by Staff Member">
        <TableShell
          cols={["Employee", "Total Leakage", "Void Sum", "Disc Sum"]}
          empty={!data.top_leak_employees.length}
        >
          {data.top_leak_employees.map((e, i) => (
            <tr key={i} className="hover:bg-slate-50 text-sm">
              <td className="p-4 font-bold text-slate-800">
                {e.employee_name}
              </td>
              <td className="p-4 font-black text-rose-600">
                {fmt(e.total_leakage)}
              </td>
              <td className="p-4 font-medium text-slate-600">
                {fmt(e.void_value)}
              </td>
              <td className="p-4 font-medium text-slate-600">
                {fmt(e.discount_value)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Product Mix ---------------------------------------------------------
export function ProductMixTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/product-mix?${p}`);
      const d = await res.json();
      setRows(d.product_mix || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Market Basket Analysis (Product Mix)"
      subtitle="Clusters of items frequently purchased in the same ticket"
    >
      <TableShell
        cols={["Item A", "Item B", "Joint Sales"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 font-bold text-slate-800">{r.pname1}</td>
            <td className="p-4 font-bold text-slate-800">{r.pname2}</td>
            <td className="p-4">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-black">
                {r.co_occurrences} times
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Retail Matrix (Engineering) -----------------------------------------
export function RetailMatrixTab({ filters }) {
  const [matrix, setMatrix] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/reports/retail-matrix?${p}`);
      const d = await res.json();
      setMatrix(d.matrix || []);
    } catch {
      setMatrix([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const Q_COLORS = {
    Star: "bg-amber-100 text-amber-700",
    Plowhorse: "bg-emerald-100 text-emerald-700",
    Puzzle: "bg-blue-100 text-blue-700",
    Dog: "bg-rose-100 text-rose-700",
  };

  return (
    <CardShell
      title="Catalog Strategy Matrix"
      subtitle="Categorizing performance using Menu Engineering logic (Volume vs Margin)"
    >
      <TableShell
        cols={["Product", "Velocity", "Avg Margin", "Quadrant"]}
        loading={loading}
        empty={!matrix.length}
      >
        {matrix.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 font-bold text-slate-800">{r.product_name}</td>
            <td className="p-4 font-medium text-slate-600">
              {r.volume_sold} units
            </td>
            <td className="p-4 font-bold text-slate-900">
              {fmt(r.avg_margin)}
            </td>
            <td className="p-4">
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${Q_COLORS[r.quadrant] || "bg-slate-100"}`}
              >
                {r.quadrant}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

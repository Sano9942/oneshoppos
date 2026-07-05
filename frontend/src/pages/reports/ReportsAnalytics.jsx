import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  ShoppingBag,
  LayoutGrid,
} from "lucide-react";
import { api } from "../../api";
import {
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
  MetricCard,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Comparative Trends --------------------------------------------------
export function ComparativeTrendsTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/comparative-trends?${p}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-(--ui-text-muted) font-medium">
        Calculating comparative benchmarks...
      </div>
    );
  if (!data?.data?.today)
    return (
      <div className="p-8 text-center text-(--ui-text-muted)">
        No snapshot data for today
      </div>
    );

  const { today, yesterday } = data.data;
  const { comparisons = {} } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-(--ui-success-fg) animate-pulse" />
        <h2 className="text-sm font-bold text-(--ui-text) uppercase tracking-tight">
          Today's Live Pulse
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue (v Yesterday)"
          value={fmt(today.revenue)}
          compPct={comparisons.revenue_pct || 0}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Orders (v Yesterday)"
          value={today.orders}
          compPct={comparisons.orders_pct || 0}
          compLabel="Yesterday"
        />
        <MetricCard
          title="Revenue Delta"
          value={fmt(comparisons.revenue_diff || 0)}
          compPct={comparisons.revenue_pct || 0}
          compLabel="Comparison"
        />
        <MetricCard
          title="Orders Delta"
          value={comparisons.orders_diff || 0}
          compPct={comparisons.orders_pct || 0}
          compLabel="Comparison"
        />
      </div>

      <CardShell
        title="Comparison Snapshot"
        subtitle="Current period against the comparison period used by the service"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "comparative_trends.csv",
                [
                  { header: "Period", key: "period" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Orders", key: "orders" },
                ],
                [
                  { period: "Current", revenue: today.revenue, orders: today.orders },
                  {
                    period: "Comparison",
                    revenue: yesterday?.revenue || 0,
                    orders: yesterday?.orders || 0,
                  },
                ],
              )
            }
          />
        }
      >
        <TableShell cols={["Period", "Revenue", "Orders"]}>
          <tr>
            <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">Current</td>
            <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(today.revenue)}</td>
            <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{today.orders}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">Comparison</td>
            <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
              {fmt(yesterday?.revenue || 0)}
            </td>
            <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{yesterday?.orders || 0}</td>
          </tr>
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Heatmaps ------------------------------------------------------------
export function HeatmapsTab({ filters }) {
  const { fmt } = useCurrency();
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/heatmaps?${p}`);
      setHeatmap(d.heatmap || []);
    } catch {
      setHeatmap([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-(--ui-text-muted) font-medium">
        Generating sales density map...
      </div>
    );

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = Array.from({ length: 24 }).map((_, h) =>
    h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p",
  );
  const totalRevenue = heatmap.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalOrders = heatmap.reduce((sum, row) => sum + Number(row.order_count || 0), 0);
  const activeSlots = heatmap.filter((row) => Number(row.revenue || 0) > 0).length;
  const maxRev = Math.max(...heatmap.map((h) => Number(h.revenue || 0)), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Heatmap Revenue" value={fmt(totalRevenue)} compPct={0} compLabel="Range" />
        <MetricCard title="Orders Mapped" value={totalOrders} compPct={0} compLabel="Range" />
        <MetricCard title="Active Slots" value={activeSlots} compPct={0} compLabel="Day/Hour" />
      </div>

      <CardShell
        title="Hourly Sales Intensity"
        subtitle="Identifying peak traffic windows for staffing optimization"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales_heatmap.csv",
                [
                  { header: "Day", key: "day_label" },
                  { header: "Hour", key: "hour_label" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Orders", key: "order_count" },
                ],
                heatmap.map((row) => ({
                  ...row,
                  day_label: days[Number(row.day_of_week)],
                  hour_label: hours[Number(row.hour_of_day)],
                })),
              )
            }
          />
        }
      >
      <div className="overflow-x-auto pb-4">
        <div className="min-w-200">
          <div className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 text-[10px]">
            <div />
            {hours.map((h) => (
              <div key={h} className="text-center font-bold text-(--ui-text-muted)">
                {h}
              </div>
            ))}

            {days.map((dayName, d) => (
              <React.Fragment key={dayName}>
                <div className="font-bold text-(--ui-text-muted) flex items-center justify-end pr-2 h-8">
                  {dayName}
                </div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const cell = heatmap.find(
                    (x) => Number(x.day_of_week) === d && Number(x.hour_of_day) === h,
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
                      className="rounded-sm transition-all hover:ring-2 hover:ring-(--ui-focus) cursor-help h-8"
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
    </div>
  );
}

// --- Tab: Revenue Leaks -------------------------------------------------------
export function RevenueLeaksTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        employee_id: filters.employeeId,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/revenue-leaks?${p}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-(--ui-text-muted) font-medium">
        Scanning for patterns of revenue leakage...
      </div>
    );
  if (!data)
    return (
      <div className="p-8 text-center text-(--ui-text-muted)">
        No anomaly data found
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-(--ui-danger-bg) border border-(--ui-danger-bg) p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-(--ui-danger-fg) uppercase tracking-widest mb-1">
            Potential Leakage
          </p>
          <p className="text-2xl font-black text-(--ui-danger-fg)">
            {fmt(data.summary.leakage_total)}
          </p>
        </div>
        <div className="bg-(--ui-warning-bg) border border-(--ui-warning-bg) p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-(--ui-warning-fg) uppercase tracking-widest mb-1">
            Voids Impact
          </p>
          <p className="text-2xl font-black text-(--ui-warning-fg)">
            {fmt(data.summary.voids)}
          </p>
          <p className="text-[10px] text-(--ui-warning-fg) font-medium">
            Across {data.transactions.voided} bills
          </p>
        </div>
        <div className="bg-(--ui-muted-surface) border border-(--ui-focus) p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-(--ui-link) uppercase tracking-widest mb-1">
            Discounts Given
          </p>
          <p className="text-2xl font-black text-(--ui-link)">
            {fmt(data.summary.discounts)}
          </p>
          <p className="text-[10px] text-(--ui-link) font-medium">
            On {data.transactions.discounted} sales
          </p>
        </div>
      </div>

      <CardShell
        title="Loss Attribution by Staff Member"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "revenue_leaks.csv",
                [
                  { header: "Employee", key: "employee_name" },
                  { header: "Total Leakage", key: "total_leakage" },
                  { header: "Void Value", key: "void_value" },
                  { header: "Discount Value", key: "discount_value" },
                ],
                data.top_leak_employees || [],
              )
            }
          />
        }
      >
        <TableShell
          cols={["Employee", "Total Leakage", "Void Sum", "Disc Sum"]}
          empty={!data.top_leak_employees.length}
        >
          {data.top_leak_employees.map((e, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">
                {e.employee_name}
              </td>
              <td className="p-4 font-black text-(--ui-danger-fg)">
                {fmt(e.total_leakage)}
              </td>
              <td className="p-4 font-medium text-(--ui-text-muted)">
                {fmt(e.void_value)}
              </td>
              <td className="p-4 font-medium text-(--ui-text-muted)">
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
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/product-mix?${p}`);
      setRows(d.product_mix || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const pairCount = rows.length;
  const totalCoOccurrences = rows.reduce(
    (sum, row) => sum + Number(row.co_occurrences || 0),
    0,
  );
  const topPair = rows[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Pairs Found" value={pairCount} compPct={0} compLabel="Top list" />
        <MetricCard
          title="Top Pair"
          value={topPair ? `${topPair.pname1} + ${topPair.pname2}` : "None"}
          compPct={0}
          compLabel="Co-purchase"
        />
        <MetricCard
          title="Total Co-occurrences"
          value={totalCoOccurrences}
          compPct={0}
          compLabel="Observed"
        />
      </div>

      <CardShell
        title="Market Basket Analysis (Product Mix)"
        subtitle="Clusters of items frequently purchased in the same ticket"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "product_mix.csv",
                [
                  { header: "Product A", key: "pname1" },
                  { header: "Product B", key: "pname2" },
                  { header: "Co-occurrences", key: "co_occurrences" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Item A", "Item B", "Joint Sales"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.pname1}</td>
              <td className="p-4 font-bold text-(--ui-text)">{r.pname2}</td>
              <td className="p-4">
                <span className="bg-(--ui-muted-surface) text-(--ui-link) px-3 py-1 rounded-full text-xs font-black">
                  {r.co_occurrences} times
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Retail Matrix (Engineering) -----------------------------------------
export function RetailMatrixTab({ filters }) {
  const { fmt } = useCurrency();
  const [matrix, setMatrix] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/retail-matrix?${p}`);
      setMatrix(d.matrix || []);
    } catch {
      setMatrix([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const Q_COLORS = {
    Star: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    Plowhorse: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    Puzzle: "bg-(--ui-muted-surface) text-(--ui-link)",
    Dog: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
  };
  const stars = matrix.filter((row) => row.matrix_category === "Star").length;
  const plowhorses = matrix.filter((row) => row.matrix_category === "Plowhorse").length;
  const avgVolume = matrix.length
    ? (matrix.reduce((sum, row) => sum + Number(row.volume || 0), 0) / matrix.length).toFixed(2)
    : "0.00";
  const avgMargin = matrix.length
    ? matrix.reduce((sum, row) => sum + Number(row.avg_unit_margin || 0), 0) / matrix.length
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard title="Stars" value={stars} compPct={0} compLabel="Matrix" />
        <MetricCard title="Plowhorses" value={plowhorses} compPct={0} compLabel="Matrix" />
        <MetricCard title="Avg Volume" value={avgVolume} compPct={0} compLabel="Threshold" />
        <MetricCard title="Avg Unit Margin" value={fmt(avgMargin)} compPct={0} compLabel="Threshold" />
      </div>

      <CardShell
        title="Catalog Strategy Matrix"
        subtitle="Categorizing performance using menu-engineering logic"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "retail_matrix_strategy.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Volume", key: "volume" },
                  { header: "Revenue", key: "total_revenue" },
                  { header: "Avg Unit Margin", key: "avg_unit_margin" },
                  { header: "Matrix Category", key: "matrix_category" },
                ],
                matrix,
              )
            }
          />
        }
      >
      <TableShell
        cols={["Product", "Velocity", "Revenue", "Avg Margin", "Quadrant"]}
        loading={loading}
        empty={!matrix.length}
      >
        {matrix.map((r, i) => (
          <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
            <td className="p-4 font-bold text-(--ui-text)">{r.product_name}</td>
            <td className="p-4 font-medium text-(--ui-text-muted)">
              {r.volume} units
            </td>
            <td className="p-4 font-semibold text-(--ui-text)">
              {fmt(r.total_revenue)}
            </td>
            <td className="p-4 font-bold text-(--ui-text)">
              {fmt(r.avg_unit_margin)}
            </td>
            <td className="p-4">
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${Q_COLORS[r.matrix_category] || "bg-(--ui-muted-surface)"}`}
              >
                {r.matrix_category}
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
      </CardShell>
    </div>
  );
}

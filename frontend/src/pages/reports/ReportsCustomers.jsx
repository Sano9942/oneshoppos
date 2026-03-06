import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Users, TrendingUp, GitBranch, Target, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

const RFM_SEGMENTS = {
  Champions: {
    color: "bg-emerald-100 text-emerald-800",
    desc: "Buy recently, often, and spend the most",
  },
  Loyal: {
    color: "bg-blue-100 text-blue-800",
    desc: "Buy regularly, responsive to promotions",
  },
  "Potential Loyalist": {
    color: "bg-indigo-100 text-indigo-800",
    desc: "Recent customers with average frequency",
  },
  "New Customers": {
    color: "bg-emerald-50 text-emerald-700",
    desc: "Bought most recently, but not often",
  },
  Promising: {
    color: "bg-amber-50 text-amber-700",
    desc: "Recent shoppers, but haven't spent much",
  },
  "Need Attention": {
    color: "bg-yellow-50 text-yellow-700",
    desc: "Above average recency, frequency and monetary values",
  },
  "About to Sleep": {
    color: "bg-slate-100 text-slate-700",
    desc: "Below average recency, frequency and monetary values",
  },
  "At Risk": {
    color: "bg-orange-100 text-orange-800",
    desc: "Spend quite a bit and purchase often, but a long time ago",
  },
  "Can't Lose Them": {
    color: "bg-rose-100 text-rose-800",
    desc: "Made biggest purchases, and often. But haven't returned for a long time",
  },
  Hibernating: {
    color: "bg-rose-50 text-rose-700",
    desc: "Last purchase was long ago, low number of orders",
  },
  Lost: {
    color: "bg-gray-100 text-gray-600",
    desc: "Lowest recency, frequency and monetary scores",
  },
};

function getSegment(r, f) {
  if (r >= 4 && f >= 4) return "Champions";
  if (r >= 2 && f >= 3) return "Loyal";
  if (r >= 3 && f >= 1) return "Potential Loyalist";
  if (r >= 4 && f < 1) return "New Customers";
  if (r >= 3 && f < 1) return "Promising";
  if (r >= 2 && f >= 2) return "Need Attention";
  if (r < 2 && f >= 2) return "At Risk";
  if (r < 2 && f >= 4) return "Can't Lose Them";
  if (r < 2 && f < 2) return "Hibernating";
  return "Lost";
}

function scoreRFMCustomers(customers) {
  if (!customers.length) return [];
  const sortBy = (arr, key) => [...arr].sort((a, b) => a[key] - b[key]);
  const n = customers.length;
  const byRecency = sortBy(customers, "recency_days"); // lower is better
  const byFreq = sortBy(customers, "order_count"); // higher is better

  return customers.map((c) => {
    const rIdx = byRecency.findIndex((x) => x.id === c.id);
    const fIdx = byFreq.findIndex((x) => x.id === c.id);
    const rScore = 5 - Math.floor((rIdx / n) * 5); // 1 to 5
    const fScore = Math.floor((fIdx / n) * 5) + 1; // 1 to 5
    return {
      ...c,
      r_score: rScore,
      f_score: fScore,
      segment: getSegment(rScore, fScore),
    };
  });
}

// --- Tab: Customer Details ----------------------------------------------------
export function CustomerDetailsTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const res = await fetch(`${API}/api/reports/customer-details?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds, filters.search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCustomers = rows.length;
  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.total_spent || 0),
    0,
  );
  const repeatCustomers = rows.filter((row) => Number(row.order_count || 0) > 1).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Customers in View
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lifetime Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Repeat Buyers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{repeatCustomers}</p>
        </div>
      </div>

      <CardShell
        title="Customer Profile Master"
        subtitle="Detailed contact, tenure, and spend profile for registered shoppers"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "customers.csv",
                [
                  { header: "ID", key: "id" },
                  { header: "Name", key: "name" },
                  { header: "Mobile", key: "mobile" },
                  { header: "Email", key: "email" },
                  { header: "Orders", key: "order_count" },
                  { header: "Total Spent", key: "total_spent" },
                  { header: "Created At", key: "created_at" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Customer", "Contact", "Orders", "Created", "LTV (Spend)"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-slate-50 text-sm">
              <td className="px-4 py-3">
                <div className="font-bold text-slate-800">{r.name}</div>
                <div className="text-[10px] text-slate-400 font-medium">ID: {r.id}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-slate-600 font-medium">{r.mobile || "No Phone"}</div>
                <div className="text-[10px] text-slate-400">{r.email || "-"}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {r.order_count}
              </td>
              <td className="px-4 py-3 text-sm text-slate-500">
                {fmtDate(r.created_at)}
              </td>
              <td className="px-4 py-3 font-bold text-indigo-600">
                {fmt(r.total_spent)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer Wise -------------------------------------------------------
export function CustomerWiseTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/customer-wise?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCustomers = rows.length;
  const totalOrders = rows.reduce(
    (sum, row) => sum + Number(row.order_count || 0),
    0,
  );
  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0,
  );
  const repeatCustomers = rows.filter((row) => Number(row.order_count || 0) > 1).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ranked Customers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Order Count
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Repeat Buyers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{repeatCustomers}</p>
        </div>
      </div>

      <CardShell
        title="High Value Shoppers"
        subtitle="Ranking customers by purchase frequency and total contribution"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "customer_ranking.csv",
                [
                  { header: "Customer", key: "customer" },
                  { header: "Orders", key: "order_count" },
                  { header: "Revenue", key: "total_amount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Customer", "Visits", "Average Basket", "Total Revenue"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.customer}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-bold text-slate-800 text-sm">{r.customer}</td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">
                  {r.order_count} Visits
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {fmt(
                  Number(r.order_count || 0) > 0
                    ? Number(r.total_amount || 0) / Number(r.order_count || 1)
                    : 0,
                )}
              </td>
              <td className="px-4 py-3 font-bold text-slate-900">
                {fmt(r.total_amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer RFM Segmentation -------------------------------------------
export function CustomerRFMTab({ filters }) {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSeg, setFilterSeg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const res = await fetch(`${API}/api/reports/customer-rfm?${p}`);
      const d = await res.json();
      setRaw(d.items || []);
    } catch {
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const scored = useMemo(() => scoreRFMCustomers(raw), [raw]);
  const filtered = filterSeg
    ? scored.filter((c) => c.segment === filterSeg)
    : scored;

  const segmentCounts = useMemo(() => {
    const map = {};
    scored.forEach((c) => {
      map[c.segment] = (map[c.segment] || 0) + 1;
    });
    return map;
  }, [scored]);

  const totalCustomers = scored.length;
  const championCount = segmentCounts.Champions || 0;
  const atRiskCount =
    (segmentCounts["At Risk"] || 0) + (segmentCounts["Can't Lose Them"] || 0);
  const avgSpend =
    scored.length > 0
      ? scored.reduce((sum, row) => sum + Number(row.total_spent || 0), 0) /
        scored.length
      : 0;

  const ScoreBox = ({ value }) => (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${value >= 4 ? "bg-emerald-100 text-emerald-800" : value === 3 ? "bg-yellow-100 text-yellow-800" : "bg-rose-100 text-rose-800"}`}
    >
      {value}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Customers Scored
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Champions
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{championCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            At Risk
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{atRiskCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Avg Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(avgSpend)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {Object.entries(RFM_SEGMENTS).map(([seg, { color }]) => (
          <button
            key={seg}
            onClick={() => setFilterSeg(filterSeg === seg ? "" : seg)}
            className={`p-3 rounded-xl border text-left transition-all ${filterSeg === seg ? "ring-2 ring-blue-500 border-blue-500 bg-white" : "bg-slate-50 border-slate-100 hover:border-slate-200"}`}
          >
            <div className="text-xl font-bold text-slate-800">
              {segmentCounts[seg] || 0}
            </div>
            <div
              className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${color}`}
            >
              {seg}
            </div>
          </button>
        ))}
      </div>

      <CardShell
        title="RFM Analysis Dashboard"
        subtitle="Recency, Frequency, and Monetary health scores"
        action={
          <div className="flex gap-2">
            {filterSeg && (
              <button
                onClick={() => setFilterSeg("")}
                className="text-xs text-rose-600 font-bold hover:underline"
              >
                Clear Filter
              </button>
            )}
            <ExportButton
              onClick={() =>
                exportCSV(
                  "rfm_data.csv",
                  [
                    { header: "Name", key: "name" },
                    { header: "Segment", key: "segment" },
                    { header: "R Score", key: "r_score" },
                    { header: "F Score", key: "f_score" },
                    { header: "Orders", key: "order_count" },
                    { header: "Total Spent", key: "total_spent" },
                  ],
                  filtered,
                )
              }
            />
          </div>
        }
      >
        <TableShell
          cols={["Customer", "Last Visit", "Scores (R/F)", "Orders / Spend", "Segment"]}
          loading={loading}
          empty={!filtered.length}
        >
          {filtered.map((c, i) => (
            <tr key={i} className="hover:bg-slate-50 text-sm">
              <td className="p-4 font-bold text-slate-800">{c.name}</td>
              <td className="p-4 text-slate-500">
                {fmtDate(c.last_order_at)}{" "}
                <span className="text-[10px] text-slate-400 italic">
                  ({c.recency_days}d ago)
                </span>
              </td>
              <td className="p-4 space-x-1">
                <ScoreBox value={c.r_score} />
                <ScoreBox value={c.f_score} />
              </td>
              <td className="p-4">
                <div className="font-semibold text-slate-700">{c.order_count} orders</div>
                <div className="text-[11px] text-slate-400">{fmt(c.total_spent)}</div>
              </td>
              <td className="p-4">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${RFM_SEGMENTS[c.segment]?.color}`}
                >
                  {c.segment}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer Retention ----------------------------------------------------
export function CustomerRetentionTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/customer-retention?${p}`);
      const d = await res.json();
      setRows(d.timeline || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = rows.reduce(
    (acc, row) => {
      acc[row.customer_type] = {
        revenue: (acc[row.customer_type]?.revenue || 0) + Number(row.revenue || 0),
        orders: (acc[row.customer_type]?.orders || 0) + Number(row.orders || 0),
      };
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Walk-in Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.walk_in?.revenue || 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Customer Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.new_customer?.revenue || 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Returning Revenue</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.returning_customer?.revenue || 0)}</p>
        </div>
      </div>

      <CardShell
        title="Retention Waterfall"
        subtitle="Tracking shift from first-time shoppers to repeat advocates"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "retention.csv",
                [
                  { header: "Date", key: "sale_date" },
                  { header: "Customer Type", key: "customer_type" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Orders", key: "orders" },
                ],
                rows,
              )
            }
          />
        }
      >
      <TableShell
        cols={["Date", "Customer Type", "Revenue", "Orders"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm font-medium">
            <td className="p-4 text-slate-500">{fmtDate(r.sale_date)}</td>
            <td className="p-4 text-slate-700">{r.customer_type.replaceAll("_", " ")}</td>
            <td className="p-4 font-semibold text-slate-800">{fmt(r.revenue)}</td>
            <td className="p-4 text-blue-600 font-bold">{r.orders}</td>
          </tr>
        ))}
      </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer Capture Rate -------------------------------------------------
export function CustomerCaptureRateTab({ filters }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const res = await fetch(`${API}/api/reports/customer-capture-rate?${p}`);
      const d = await res.json();
      setData(d.staff_breakdown || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalProfiled = data.reduce(
    (sum, row) => sum + Number(row.profiled_transactions || 0),
    0,
  );
  const totalTransactions = data.reduce(
    (sum, row) => sum + Number(row.total_transactions || 0),
    0,
  );
  const avgCapture =
    totalTransactions > 0 ? ((totalProfiled / totalTransactions) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profiled Transactions</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalProfiled}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Transactions</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalTransactions}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Store Capture Rate</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{avgCapture}%</p>
        </div>
      </div>

      <CardShell
        title="Profile Capture Analysis"
        subtitle="Efficiency of front-line staff in registering customers"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "capture_rate.csv",
                [
                  { header: "Staff", key: "employee_name" },
                  { header: "Transactions", key: "total_transactions" },
                  { header: "Profiled", key: "profiled_transactions" },
                  { header: "Walk-in", key: "walk_in_transactions" },
                  { header: "Capture %", key: "capture_rate_pct" },
                  { header: "Profiled Revenue", key: "profiled_revenue" },
                ],
                data,
              )
            }
          />
        }
      >
      <TableShell
        cols={["Staff Member", "Transactions", "Capture %", "Revenue Profile"]}
        loading={loading}
        empty={!data.length}
      >
        {data.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 font-bold text-slate-800">{r.employee_name}</td>
            <td className="p-4 text-slate-500">
              {r.profiled_transactions} Profiled / {r.walk_in_transactions} Walk-in
            </td>
            <td className="p-4">
              <div className="font-bold text-indigo-600">
                {r.capture_rate_pct}%
              </div>
              <div className="w-16 bg-slate-100 h-1 rounded-full mt-1">
                <div
                  className="bg-indigo-500 h-full rounded-full"
                  style={{ width: `${r.capture_rate_pct}%` }}
                />
              </div>
            </td>
            <td className="p-4 font-bold text-emerald-600">
              {fmt(r.profiled_revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
      </CardShell>
    </div>
  );
}

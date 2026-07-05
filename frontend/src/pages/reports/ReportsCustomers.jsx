import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Users, TrendingUp, GitBranch, Target, X } from "lucide-react";
import { api } from "../../api";
import {
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

const RFM_SEGMENTS = {
  Champions: {
    color: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    desc: "Buy recently, often, and spend the most",
  },
  Loyal: {
    color: "bg-(--ui-muted-surface) text-(--ui-link)",
    desc: "Buy regularly, responsive to promotions",
  },
  "Potential Loyalist": {
    color: "bg-(--ui-muted-surface) text-(--ui-link)",
    desc: "Recent customers with average frequency",
  },
  "New Customers": {
    color: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    desc: "Bought most recently, but not often",
  },
  Promising: {
    color: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    desc: "Recent shoppers, but haven't spent much",
  },
  "Need Attention": {
    color: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    desc: "Above average recency, frequency and monetary values",
  },
  "About to Sleep": {
    color: "bg-(--ui-muted-surface) text-(--ui-text)",
    desc: "Below average recency, frequency and monetary values",
  },
  "At Risk": {
    color: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    desc: "Spend quite a bit and purchase often, but a long time ago",
  },
  "Can't Lose Them": {
    color: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
    desc: "Made biggest purchases, and often. But haven't returned for a long time",
  },
  Hibernating: {
    color: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
    desc: "Last purchase was long ago, low number of orders",
  },
  Lost: {
    color: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
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
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        search: filters.search,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/customer-details?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Customers in View
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Lifetime Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Repeat Buyers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{repeatCustomers}</p>
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
            <tr key={`${r.id}-${i}`} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3">
                <div className="font-bold text-(--ui-text)">{r.name}</div>
                <div className="text-[10px] text-(--ui-text-muted) font-medium">ID: {r.id}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-(--ui-text-muted) font-medium">{r.mobile || "No Phone"}</div>
                <div className="text-[10px] text-(--ui-text-muted)">{r.email || "-"}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {r.order_count}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                {fmtDate(r.created_at)}
              </td>
              <td className="px-4 py-3 font-bold text-(--ui-link)">
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
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/customer-wise?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Ranked Customers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Order Count
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Total Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Repeat Buyers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{repeatCustomers}</p>
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
            <tr key={`${r.customer}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 font-bold text-(--ui-text) text-sm">{r.customer}</td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-(--ui-muted-surface) px-2.5 py-1 text-xs font-bold text-(--ui-link)">
                  {r.order_count} Visits
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {fmt(
                  Number(r.order_count || 0) > 0
                    ? Number(r.total_amount || 0) / Number(r.order_count || 1)
                    : 0,
                )}
              </td>
              <td className="px-4 py-3 font-bold text-(--ui-text)">
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
  const { fmt } = useCurrency();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSeg, setFilterSeg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/customer-rfm?${p}`);
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
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${value >= 4 ? "bg-(--ui-success-bg) text-(--ui-success-fg)" : value === 3 ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"}`}
    >
      {value}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Customers Scored
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Champions
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{championCount}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            At Risk
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{atRiskCount}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Avg Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(avgSpend)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {Object.entries(RFM_SEGMENTS).map(([seg, { color }]) => (
          <button
            key={seg}
            onClick={() => setFilterSeg(filterSeg === seg ? "" : seg)}
            className={`p-3 rounded-xl border text-left transition-all ${filterSeg === seg ? "ring-2 ring-(--ui-focus) border-(--ui-focus) bg-(--ui-surface)" : "bg-(--ui-muted-surface) border-(--ui-border) hover:border-(--ui-border)"}`}
          >
            <div className="text-xl font-bold text-(--ui-text)">
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
                className="text-xs text-(--ui-danger-fg) font-bold hover:underline"
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
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{c.name}</td>
              <td className="p-4 text-(--ui-text-muted)">
                {fmtDate(c.last_order_at)}{" "}
                <span className="text-[10px] text-(--ui-text-muted) italic">
                  ({c.recency_days}d ago)
                </span>
              </td>
              <td className="p-4 space-x-1">
                <ScoreBox value={c.r_score} />
                <ScoreBox value={c.f_score} />
              </td>
              <td className="p-4">
                <div className="font-semibold text-(--ui-text)">{c.order_count} orders</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmt(c.total_spent)}</div>
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
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/customer-retention?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Walk-in Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary.walk_in?.revenue || 0)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">New Customer Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary.new_customer?.revenue || 0)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Returning Revenue</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary.returning_customer?.revenue || 0)}</p>
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
          <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm font-medium">
            <td className="p-4 text-(--ui-text-muted)">{fmtDate(r.sale_date)}</td>
            <td className="p-4 text-(--ui-text)">{r.customer_type.replaceAll("_", " ")}</td>
            <td className="p-4 font-semibold text-(--ui-text)">{fmt(r.revenue)}</td>
            <td className="p-4 text-(--ui-link) font-bold">{r.orders}</td>
          </tr>
        ))}
      </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Customer Capture Rate -------------------------------------------------
export function CustomerCaptureRateTab({ filters }) {
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/customer-capture-rate?${p}`);
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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Profiled Transactions</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalProfiled}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Total Transactions</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalTransactions}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Store Capture Rate</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{avgCapture}%</p>
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
          <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
            <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
            <td className="p-4 text-(--ui-text-muted)">
              {r.profiled_transactions} Profiled / {r.walk_in_transactions} Walk-in
            </td>
            <td className="p-4">
              <div className="font-bold text-(--ui-link)">
                {r.capture_rate_pct}%
              </div>
              <div className="w-16 bg-(--ui-muted-surface) h-1 rounded-full mt-1">
                <div
                  className="bg-(--ui-primary) h-full rounded-full"
                  style={{ width: `${r.capture_rate_pct}%` }}
                />
              </div>
            </td>
            <td className="p-4 font-bold text-(--ui-success-fg)">
              {fmt(r.profiled_revenue)}
            </td>
          </tr>
        ))}
      </TableShell>
      </CardShell>
    </div>
  );
}

import React, { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { api } from "../../api";
import { CardShell, TableShell, ExportButton } from "./ReportShared";
import { downloadCsv } from "../../utils/csvExport";
import { todayLocalStr, daysAgoLocalStr } from "../../utils/dates";

/**
 * KDS analytics tab (Phase 2-R Wave C / 2-R.5).
 *
 * Shows per-station prep-time percentiles (p50/p95) + rolling load snapshots
 * + by-category breakdown. Wired to GET /api/reports/kds/prep-times.
 */
export default function KdsAnalyticsTab() {
  const today = todayLocalStr();
  const monthAgo = daysAgoLocalStr(30);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [stationFilter, setStationFilter] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to });
      if (stationFilter) qs.set("station_id", stationFilter);
      const res = await api.get(`/api/reports/kds/prep-times?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load KDS analytics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, stationFilter]);

  useEffect(() => { load(); }, [load]);

  const stations = data?.stations || [];
  const byCategory = data?.by_category || [];
  const snapshots = data?.snapshots || [];

  // Pivot snapshots into { timestamp, [stationName]: avg } rows for LineChart.
  const snapshotSeries = React.useMemo(() => {
    if (!snapshots.length) return { series: [], stationKeys: [] };
    const byTime = new Map();
    const stationNames = new Set();
    for (const s of snapshots) {
      const key = new Date(s.recorded_at).toISOString();
      stationNames.add(s.station_name);
      if (!byTime.has(key)) byTime.set(key, { t: key });
      byTime.get(key)[s.station_name] = s.avg_prep_seconds;
    }
    return {
      series: Array.from(byTime.values()).sort((a, b) => a.t.localeCompare(b.t)),
      stationKeys: Array.from(stationNames),
    };
  }, [snapshots]);

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  function exportCsv() {
    const headers = ["station", "count", "p50_sec", "p95_sec", "mean_sec", "target_sec", "delta_sec"];
    const rows = stations.map((s) => {
      const delta = s.target_prep_seconds != null ? Math.round(s.mean - s.target_prep_seconds) : null;
      return {
        station: s.station_name,
        count: s.count,
        p50_sec: s.p50,
        p95_sec: s.p95,
        mean_sec: s.mean != null ? Math.round(s.mean) : null,
        target_sec: s.target_prep_seconds ?? null,
        delta_sec: delta,
      };
    });
    downloadCsv(headers, rows, `kds-prep-times-${from}-to-${to}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-(--ui-surface) border border-(--ui-border) rounded-lg p-3">
        <div>
          <label className="block text-xs text-(--ui-text-muted)">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-(--ui-border-strong) rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-(--ui-text-muted)">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-(--ui-border-strong) rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="grow">
          <label className="block text-xs text-(--ui-text-muted)">Station</label>
          <select
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            className="border border-(--ui-border-strong) rounded px-2 py-1 text-sm w-60"
          >
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
            ))}
          </select>
        </div>
        <ExportButton onClick={exportCsv} />
      </div>

      {error && <div className="p-3 bg-(--ui-danger-bg) text-(--ui-danger-fg) rounded border border-(--ui-danger-bg) text-sm">{error}</div>}
      {loading && <div className="p-3 text-(--ui-text-muted) text-sm">Loading KDS analytics…</div>}

      {!loading && !error && (
        <>
          <CardShell title="Prep Time by Station (p50 vs p95, seconds)">
            {stations.length === 0 ? (
              <div className="p-4 text-(--ui-text-muted) text-sm">No bumped tickets in this range.</div>
            ) : (
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={stations}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="station_name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="p50" fill="#3b82f6" name="p50 (sec)" />
                    <Bar dataKey="p95" fill="#ef4444" name="p95 (sec)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardShell>

          <CardShell title="Load Trend — avg prep seconds over time">
            {snapshotSeries.series.length === 0 ? (
              <div className="p-4 text-(--ui-text-muted) text-sm">No load snapshots yet — the 15-min worker populates this chart.</div>
            ) : (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={snapshotSeries.series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    />
                    <YAxis />
                    <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} />
                    <Legend />
                    {snapshotSeries.stationKeys.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardShell>

          <CardShell title="Station Performance">
            <TableShell
              cols={["Station", "Count", "p50 (s)", "p95 (s)", "Mean (s)", "Target (s)", "Delta"]}
              loading={false}
              empty={stations.length === 0}
            >
              {stations.map((s) => {
                const delta = s.target_prep_seconds != null && s.mean != null
                  ? Math.round(s.mean - s.target_prep_seconds)
                  : null;
                const deltaClass = delta == null ? "" : delta <= 0 ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg) font-semibold";
                return (
                  <tr key={s.station_id} className="border-b">
                    <td className="py-2">{s.station_name}</td>
                    <td>{s.count}</td>
                    <td>{s.p50 ?? "—"}</td>
                    <td>{s.p95 ?? "—"}</td>
                    <td>{s.mean != null ? Math.round(s.mean) : "—"}</td>
                    <td>{s.target_prep_seconds ?? "—"}</td>
                    <td className={deltaClass}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}s`}</td>
                  </tr>
                );
              })}
            </TableShell>
          </CardShell>

          <CardShell title="By Category (top 20)">
            <TableShell
              cols={["Category", "Count", "p50 (s)", "p95 (s)", "Mean (s)"]}
              loading={false}
              empty={byCategory.length === 0}
            >
              {byCategory.slice(0, 20).map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{r.category_name}</td>
                  <td>{r.count}</td>
                  <td>{r.p50 ?? "—"}</td>
                  <td>{r.p95 ?? "—"}</td>
                  <td>{r.mean != null ? Math.round(r.mean) : "—"}</td>
                </tr>
              ))}
            </TableShell>
          </CardShell>
        </>
      )}
    </div>
  );
}

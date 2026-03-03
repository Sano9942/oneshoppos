import React from "react";
import { Download, ClipboardList, Search, X } from "lucide-react";

// --- Formatters ---------------------------------------------------------------
export const fmt = (n) => "PKRs " + Number(n || 0).toFixed(2);

export const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// --- CSV Export Utilities -----------------------------------------------------
export const exportCSV = (filename, cols, rows) => {
  const headers = cols.map((c) => (typeof c === "string" ? c : c.header));
  const keys = cols.map((c) => (typeof c === "string" ? c : c.key));
  const lines = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = r[k] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors"
    >
      <Download size={12} /> Export CSV
    </button>
  );
}

// --- Shared UI Helpers --------------------------------------------------------
export function TableShell({
  cols,
  loading,
  empty,
  emptyIcon: Icon = ClipboardList,
  children,
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
            {cols.map((c) => (
              <th key={c} className="p-4 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td
                colSpan={cols.length}
                className="p-8 text-center text-slate-400"
              >
                Loading...
              </td>
            </tr>
          ) : empty ? (
            <tr>
              <td colSpan={cols.length} className="p-10 text-center">
                <Icon size={40} className="mx-auto text-slate-300 mb-2" />
                <p className="text-slate-500 font-medium">No data found</p>
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DateRangeFilter({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  search,
  setSearch,
  searchPlaceholder,
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap gap-2 items-center">
      {setSearch && (
        <div className="relative flex-1 min-w-40">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder={searchPlaceholder || "Search..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-500">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
      </div>
      {(search || dateFrom || dateTo) && (
        <button
          onClick={() => {
            setSearch?.("");
            setDateFrom("");
            setDateTo("");
          }}
          className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

export function CardShell({ title, subtitle, action, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0 flex items-start justify-between gap-2">
        <div className="flex-1">
          <h2 className="font-bold text-slate-700">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function MetricCard({ title, value, compPct, compLabel }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2">
      <h3 className="text-sm font-medium text-slate-500">{title}</h3>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div
        className={
          "text-xs font-semibold " +
          (compPct > 0
            ? "text-emerald-600"
            : compPct < 0
              ? "text-rose-600"
              : "text-slate-500")
        }
      >
        {compPct > 0 ? "↑" : compPct < 0 ? "↓" : ""} {Math.abs(compPct)}%
        <span className="font-normal text-slate-400 ml-1">vs {compLabel}</span>
      </div>
    </div>
  );
}

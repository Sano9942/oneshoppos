import React from "react";
import { Download, ClipboardList, Search, X } from "lucide-react";
import { fmtUtcDate, fmtUtcDateTime } from "../../utils/dates";

// --- Formatters ---------------------------------------------------------------
export const fmtDate = fmtUtcDate;

export const fmtDateTime = fmtUtcDateTime;

// Columns whose values must be text in Excel to preserve leading zeros (e.g. "002990")
const CSV_TEXT_KEYS = new Set(["barcode", "sku"]);

// --- CSV Export Utilities -----------------------------------------------------
export const exportCSV = (filename, cols, rows) => {
  const headers = cols.map((c) => (typeof c === "string" ? c : c.header));
  const keys = cols.map((c) => (typeof c === "string" ? c : c.key));
  const lines = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = String(r[k] ?? "").replace(/"/g, '""');
          // ="value" forces Excel to treat cell as text, preserving leading zeros
          return CSV_TEXT_KEYS.has(k) ? `="${v}"` : `"${v}"`;
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
      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
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
    <div className="overflow-hidden rounded-b-2xl">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-180 border-collapse text-left">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-slate-200 px-4 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white align-top">
          {loading ? (
            <tr>
              <td
                colSpan={cols.length}
                className="p-10 text-center text-sm text-slate-400"
              >
                Loading...
              </td>
            </tr>
          ) : empty ? (
            <tr>
              <td colSpan={cols.length} className="p-12 text-center">
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {setSearch && (
        <div className="relative min-w-40 flex-1 basis-full lg:basis-auto">
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
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
        <label className="text-xs font-medium text-slate-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
      </div>
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
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
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <h2 className="font-bold text-slate-700">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0 self-start sm:self-auto">{action}</div>}
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

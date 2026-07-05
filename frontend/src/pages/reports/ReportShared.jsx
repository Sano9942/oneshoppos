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
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-(--ui-border-strong) px-3 py-1.5 text-xs text-(--ui-text-muted) transition-colors hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
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
          <tr className="sticky top-0 z-10 border-b border-(--ui-border) bg-(--ui-muted-surface) text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted) backdrop-blur">
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-(--ui-border) px-4 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-(--ui-border) bg-(--ui-surface) align-top">
          {loading ? (
            <tr>
              <td
                colSpan={cols.length}
                className="p-10 text-center text-sm text-(--ui-text-muted)"
              >
                Loading...
              </td>
            </tr>
          ) : empty ? (
            <tr>
              <td colSpan={cols.length} className="p-12 text-center">
                <Icon size={40} className="mx-auto text-(--ui-text-muted) mb-2" />
                <p className="text-(--ui-text-muted) font-medium">No data found</p>
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--ui-border) bg-(--ui-surface) p-3">
      {setSearch && (
        <div className="relative min-w-40 flex-1 basis-full lg:basis-auto">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
          />
          <input
            type="text"
            placeholder={searchPlaceholder || "Search..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-(--ui-border-strong) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-lg bg-(--ui-muted-surface) px-2 py-1">
        <label className="text-xs font-medium text-(--ui-text-muted)">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1.5 border border-(--ui-border-strong) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
        />
      </div>
      <div className="flex items-center gap-1.5 rounded-lg bg-(--ui-muted-surface) px-2 py-1">
        <label className="text-xs font-medium text-(--ui-text-muted)">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1.5 border border-(--ui-border-strong) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
        />
      </div>
      {(search || dateFrom || dateTo) && (
        <button
          onClick={() => {
            setSearch?.("");
            setDateFrom("");
            setDateTo("");
          }}
          className="text-xs text-(--ui-text-muted) hover:text-(--ui-danger-fg) flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-(--ui-danger-bg) transition-colors"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

export function CardShell({ title, subtitle, action, children }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-surface)">
      <div className="flex shrink-0 flex-col gap-3 border-b border-(--ui-border) bg-(--ui-muted-surface) p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <h2 className="font-bold text-(--ui-text)">{title}</h2>
          {subtitle && (
            <p className="text-xs text-(--ui-text-muted) mt-0.5">{subtitle}</p>
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
    <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-4 flex flex-col gap-2">
      <h3 className="text-sm font-medium text-(--ui-text-muted)">{title}</h3>
      <div className="text-2xl font-bold text-(--ui-text)">{value}</div>
      <div
        className={
          "text-xs font-semibold " +
          (compPct > 0
            ? "text-(--ui-success-fg)"
            : compPct < 0
              ? "text-(--ui-danger-fg)"
              : "text-(--ui-text-muted)")
        }
      >
        {compPct > 0 ? "↑" : compPct < 0 ? "↓" : ""} {Math.abs(compPct)}%
        <span className="font-normal text-(--ui-text-muted) ml-1">vs {compLabel}</span>
      </div>
    </div>
  );
}

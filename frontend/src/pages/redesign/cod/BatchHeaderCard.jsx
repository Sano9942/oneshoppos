import { AlertTriangle } from "lucide-react";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { fmtLocalDateTime } from "../../../utils/dates";

const STATUS_META = {
  imported: { label: "Imported", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  matching: { label: "Matching…", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

function KpiTile({ label, value, tone }) {
  const toneClass =
    tone === "green"
      ? "text-green-600 dark:text-green-400"
      : tone === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-(--text-primary)";
  return (
    <div className="rounded-lg border border-(--border) bg-(--bg-subtle)/40 px-3 py-2">
      <div className="text-xs text-(--text-muted) uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function BatchHeaderCard({ batch, children }) {
  const { fmt } = useCurrency();
  const meta = STATUS_META[batch.status] || { label: batch.status, color: "bg-gray-100 text-gray-700" };

  const totalAmount = Number(batch.total_amount || 0);
  const matchedAmount = Number(batch.matched_amount || 0);
  const shortAmount = Number(batch.short_amount || 0);
  const variance = totalAmount - matchedAmount - shortAmount;

  return (
    <div className="p-5 border-b border-(--border)">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-(--text-primary)">
              {batch.batch_ref || `Batch #${batch.id}`}
            </h2>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
              {meta.label}
            </span>
          </div>
          <div className="text-xs text-(--text-muted) mt-0.5">
            {batch.courier_name || "—"} · imported{" "}
            {batch.imported_at ? fmtLocalDateTime(batch.imported_at) : "—"}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">{children}</div>
      </div>

      {Math.abs(variance) > 0.01 && (batch.unmatched_count || 0) === 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Variance: remitted total ({fmt(totalAmount)}) does not equal matched + short (
            {fmt(matchedAmount + shortAmount)}). Gap: {fmt(variance)}.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile label="Lines" value={batch.total_lines || 0} />
        <KpiTile label="Total Remitted" value={fmt(totalAmount)} />
        <KpiTile label="Matched Count" value={batch.matched_count || 0} tone="green" />
        <KpiTile label="Matched Amount" value={fmt(matchedAmount)} tone="green" />
        <KpiTile label="Unmatched" value={batch.unmatched_count || 0} tone="red" />
        <KpiTile label="Short Amount" value={fmt(shortAmount)} tone="red" />
      </div>
    </div>
  );
}

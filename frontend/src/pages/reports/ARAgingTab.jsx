import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { downloadCsv } from "../../utils/csvExport";

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ARAgingTab({ filters }) {
  const { fmt } = useCurrency();
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const outletParam = useMemo(() => {
    const ids = filters?.outletIds;
    return Array.isArray(ids) && ids.length ? ids.join(",") : "";
  }, [filters?.outletIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { as_of: asOf };
      if (outletParam) params.outlet_id = outletParam;
      const json = await api.get("/api/reports/ar-aging", params);
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to load A/R aging");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [asOf, outletParam]);

  useEffect(() => {
    load();
  }, [load]);

  const buckets = data?.buckets || [30, 60, 90];
  const [b1, b2, b3] = buckets;
  const bucketLabels = useMemo(
    () => [`0–${b1}`, `${b1 + 1}–${b2}`, `${b2 + 1}–${b3}`, `${b3}+`],
    [b1, b2, b3],
  );

  const rows = data?.rows || [];
  const totals = data?.totals || { b0: 0, b1: 0, b2: 0, b3_plus: 0, total: 0 };

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = [
      "Customer ID",
      "Customer",
      bucketLabels[0],
      bucketLabels[1],
      bucketLabels[2],
      bucketLabels[3],
      "Total",
    ];
    const csvRows = rows.map((r) => [
      r.customer_id,
      r.name,
      Number(r.b0 || 0).toFixed(2),
      Number(r.b1 || 0).toFixed(2),
      Number(r.b2 || 0).toFixed(2),
      Number(r.b3_plus || 0).toFixed(2),
      Number(r.total || 0).toFixed(2),
    ]);
    csvRows.push([
      "",
      "TOTAL",
      Number(totals.b0 || 0).toFixed(2),
      Number(totals.b1 || 0).toFixed(2),
      Number(totals.b2 || 0).toFixed(2),
      Number(totals.b3_plus || 0).toFixed(2),
      Number(totals.total || 0).toFixed(2),
    ]);
    downloadCsv(headers, csvRows, `ar_aging_${asOf}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">As of</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={load}
          disabled={loading || !asOf}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Search size={16} />
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          onClick={exportCsv}
          disabled={!rows.length}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download size={16} />
          Export CSV
        </button>
        <div className="ml-auto text-xs text-slate-500">
          Buckets: {bucketLabels.join(" / ")} days overdue
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">{bucketLabels[0]}</th>
                <th className="px-4 py-3 text-right">{bucketLabels[1]}</th>
                <th className="px-4 py-3 text-right">{bucketLabels[2]}</th>
                <th className="px-4 py-3 text-right">{bucketLabels[3]}</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No outstanding receivables as of {asOf}.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.customer_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(Number(r.b0 || 0))}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(Number(r.b1 || 0))}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(Number(r.b2 || 0))}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-700">
                      {fmt(Number(r.b3_plus || 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {fmt(Number(r.total || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length ? (
              <tfoot>
                <tr className="bg-slate-50 text-sm font-bold text-slate-900">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">{fmt(Number(totals.b0 || 0))}</td>
                  <td className="px-4 py-3 text-right">{fmt(Number(totals.b1 || 0))}</td>
                  <td className="px-4 py-3 text-right">{fmt(Number(totals.b2 || 0))}</td>
                  <td className="px-4 py-3 text-right text-rose-700">
                    {fmt(Number(totals.b3_plus || 0))}
                  </td>
                  <td className="px-4 py-3 text-right">{fmt(Number(totals.total || 0))}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}

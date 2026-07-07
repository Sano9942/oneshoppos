import { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";
import { INDUSTRY_LABELS, MODE_LABELS } from "./industryLabels";

// Feature-adoption matrix: which tenants use which modes/flags. Reads the
// adoption-snapshot cache (GET /api/admin/adoption); "Recompute" forces a live
// cross-tenant fanout (?force=1).
export default function AdminAdoption() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback((force) => {
    if (force) setRecomputing(true); else setLoading(true);
    adminFetch(`/api/admin/adoption${force ? "?force=1" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load adoption data"))))
      .then((res) => { setData(res); setError(""); })
      .catch((err) => setError(err.message))
      .finally(() => { setLoading(false); setRecomputing(false); });
  }, []);

  useEffect(() => { load(false); }, [load]);

  const modes = data?.modes || [];
  const tenants = data?.tenants || [];
  const total = data?.tenant_count || tenants.length;

  const flagRows = Object.entries(data?.flag_adoption || {})
    .sort((a, b) => b[1] - a[1]);

  const exportCsv = () => {
    if (!tenants.length) return;
    const headers = ["Tenant", "Slug", "Industry", "Enabled flags", ...modes.map((m) => MODE_LABELS[m] || m)];
    const rows = tenants.map((t) => [
      t.name || "",
      t.slug || "",
      INDUSTRY_LABELS[t.industry_type] || t.industry_type || "",
      t.enabled_flag_count ?? (t.enabled_flags?.length || 0),
      ...modes.map((m) => {
        const on = (t.enabled_modes || []).includes(m);
        const count = (t.mode_usage || {})[m] || 0;
        return `${on ? "on" : "off"}${count ? ` (${count})` : ""}`;
      }),
    ]);
    downloadCsv(headers, rows, "feature_adoption");
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--ui-text)">Feature Adoption</h1>
          {data?.computed_at && (
            <p className="text-xs text-(--ui-text-muted)">
              Snapshot {new Date(data.computed_at).toLocaleString()} · {total} active tenants
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={recomputing}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
          >
            <RefreshCw size={14} className={recomputing ? "animate-spin" : ""} />
            {recomputing ? "Recomputing..." : "Recompute"}
          </button>
          <button
            onClick={exportCsv}
            disabled={!tenants.length}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-50"
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3">
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      ) : (
        <>
          {/* Mode matrix */}
          <div className="mb-6 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left text-xs text-(--ui-text-muted)">
                    <th className="sticky left-0 bg-(--ui-muted-surface) px-4 py-3 font-medium">Tenant</th>
                    {modes.map((m) => (
                      <th key={m} className="px-3 py-3 text-center font-medium whitespace-nowrap">{MODE_LABELS[m] || m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-b border-(--ui-border) last:border-0">
                      <td className="sticky left-0 bg-(--ui-surface) px-4 py-2.5">
                        <span className="font-medium text-(--ui-text)">{t.name}</span>
                        <span className="ml-1 block text-[11px] text-(--ui-text-muted)">
                          {INDUSTRY_LABELS[t.industry_type] || t.industry_type || "—"}
                        </span>
                      </td>
                      {modes.map((m) => {
                        const on = (t.enabled_modes || []).includes(m);
                        const count = (t.mode_usage || {})[m] || 0;
                        return (
                          <td key={m} className="px-3 py-2.5 text-center">
                            {on ? (
                              <span className="inline-flex flex-col items-center">
                                <span className="text-(--ui-success-fg)">✓</span>
                                {count > 0 && <span className="text-[11px] text-(--ui-text-muted)">{count}</span>}
                              </span>
                            ) : count > 0 ? (
                              <span className="text-[11px] font-medium text-(--ui-warning-fg)" title="Data present but mode disabled">{count}</span>
                            ) : (
                              <span className="text-(--ui-text-muted)">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-flag adoption summary */}
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <h2 className="mb-3 text-sm font-semibold text-(--ui-text)">Flag adoption ({flagRows.length} flags on ≥1 tenant)</h2>
            {flagRows.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No enabled flags recorded.</p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {flagRows.map(([flag, count]) => {
                  const pct = total ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={flag} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-1.5">
                      <span className="truncate text-xs text-(--ui-text)" title={flag}>{flag}</span>
                      <span className="ml-2 shrink-0 text-xs font-medium text-(--ui-text-muted)">{count}/{total} · {pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

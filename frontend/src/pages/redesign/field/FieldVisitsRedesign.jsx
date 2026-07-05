import { useState, useEffect, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { AlertCircle, MapPin, Download } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Input, Select } from "../../../ui/primitives";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { fmtUtcDateTime, todayLocalStr, daysAgoLocalStr } from "../../../utils/dates";
import { downloadCsv } from "../../../utils/csvExport";

const OUTCOME_LABELS = {
  ordered: "Took Order",
  no_stock_needed: "No Stock Needed",
  shop_closed: "Shop Closed",
  owner_away: "Owner Away",
  checked_in: "Checked in",
  planned: "Planned",
};

/**
 * Tier 1.1 wholesale: owner-facing visit report. Drill-down from the dashboard
 * field-summary cards. Filters by date range / rep / flagged-only, exports CSV.
 */
export default function FieldVisitsRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { fmt } = useCurrency();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);

  const today = todayLocalStr();
  const sevenDaysAgo = daysAgoLocalStr(7);

  const [from, setFrom] = useState(sevenDaysAgo);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [reps, setReps] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load field reps for the filter dropdown (employee_type=field_rep)
  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    api
      .get("/api/employees", { include_deleted: 0 })
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.employees || data?.rows || [];
        setReps(list.filter((e) => e.employee_type === "field_rep"));
      })
      .catch(() => setReps([]));
  }, [flagsLoading, flags.wholesale_field_sales]);

  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const query = { from, to };
        if (employeeId) query.employee_id = employeeId;
        if (flaggedOnly) query.flagged_only = 1;
        const data = await api.get("/api/field/visits", query);
        if (!cancelled) {
          setVisits(data.visits || []);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load visits");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to, employeeId, flaggedOnly, flagsLoading, flags.wholesale_field_sales]);

  if (flagsLoading) return null;
  if (!flags.wholesale_field_sales) return <Navigate to="/" replace />;
  if (!hasPerm("manage_field_sales")) return <Navigate to="/" replace />;

  const exportCsv = () => {
    downloadCsv(
      [
        "Date",
        "Rep",
        "Customer",
        "Outcome",
        "Invoice",
        "Order Total",
        "GPS Distance (m)",
        "Flagged",
        "Accuracy (m)",
      ],
      visits.map((v) => [
        fmtUtcDateTime(v.checked_in_at),
        v.employee_name,
        v.customer_name,
        OUTCOME_LABELS[v.status] || v.status,
        v.sale_invoice_number || "",
        v.sale_total == null ? "" : Number(v.sale_total).toFixed(2),
        v.gps_distance_m == null ? "—" : v.gps_distance_m,
        v.gps_flagged ? "YES" : "no",
        v.gps_accuracy_m == null ? "—" : v.gps_accuracy_m,
      ]),
      "field_visits"
    );
  };

  return (
    <PageShell
      title="Field Visits"
      subtitle="GPS-verified rep check-ins with selfie evidence"
      right={
        <Button onClick={exportCsv} disabled={!visits.length}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      }
    >
      <SectionCard>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-(--ui-text-muted) block mb-1">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-(--ui-text-muted) block mb-1">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-(--ui-text-muted) block mb-1">Rep</label>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-(--ui-text)">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
              />
              <AlertCircle className="h-4 w-4 text-(--ui-warning-fg)" /> Flagged only
            </label>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-(--ui-danger-bg) border border-(--ui-danger-bg) text-(--ui-danger-fg) px-3 py-2 text-sm mb-3">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                <th className="py-2 pr-3 font-medium">Selfie</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Rep</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Outcome</th>
                <th className="py-2 pr-3 font-medium">Order</th>
                <th className="py-2 pr-3 font-medium text-right">Distance</th>
                <th className="py-2 pr-3 font-medium text-right">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-(--ui-text-muted)">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visits.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-(--ui-text-muted)">
                    No visits in range.
                  </td>
                </tr>
              )}
              {visits.map((v) => (
                <tr key={v.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="py-2 pr-3">
                    {v.selfie_url ? (
                      <a href={v.selfie_url} target="_blank" rel="noreferrer">
                        <img
                          src={v.selfie_url}
                          alt="Visit selfie"
                          className="w-12 h-12 rounded object-cover border border-(--ui-border)"
                        />
                      </a>
                    ) : (
                      <span className="text-(--ui-text-muted) text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-(--ui-text)">{fmtUtcDateTime(v.checked_in_at)}</td>
                  <td className="py-2 pr-3 text-(--ui-text)">{v.employee_name}</td>
                  <td className="py-2 pr-3 text-(--ui-text)">{v.customer_name}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1 text-(--ui-text)">
                      {OUTCOME_LABELS[v.status] || v.status}
                      {v.gps_flagged && (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-(--ui-warning-bg) text-(--ui-warning-fg) px-1.5 py-0.5 text-xs">
                          <AlertCircle className="h-3 w-3" /> flagged
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {v.sale_id ? (
                      <span className="inline-flex flex-col">
                        <span className="text-(--ui-text) font-medium tabular-nums">
                          {fmt(Number(v.sale_total || 0))}
                        </span>
                        {v.sale_invoice_number && (
                          <span className="text-xs text-(--ui-text-muted)">
                            {v.sale_invoice_number}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-(--ui-text-muted) text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-(--ui-text)">
                    {v.gps_distance_m == null ? (
                      <span className="text-(--ui-text-muted)">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {v.gps_distance_m}m
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-(--ui-text-muted)">
                    {v.gps_accuracy_m == null ? "—" : `±${v.gps_accuracy_m}m`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </PageShell>
  );
}

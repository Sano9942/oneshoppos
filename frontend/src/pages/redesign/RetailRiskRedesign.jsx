import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  PageShell,
  SectionCard,
  Button,
  Input,
  Select,
  Badge,
  TableToolbar,
  EmptyState,
} from "../../ui/primitives";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { fmtUtcDateTime, fmtUtcDate, todayLocalStr, daysAgoLocalStr } from "../../utils/dates";
import { Shield, AlertTriangle, CheckCircle2 } from "lucide-react";

const TABS = [
  { key: "no_sale", label: "No-Sale Events" },
  { key: "anomalies", label: "Anomaly Flags" },
  { key: "settings", label: "Settings" },
];

export default function RetailRiskRedesign() {
  const { hasPerm, authHeaders } = useAuth();
  const { fmt: money } = useCurrency();
  const toast = useToast();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [tab, setTab] = useState("no_sale");

  const [noSaleEvents, setNoSaleEvents] = useState([]);
  const [noSaleLoading, setNoSaleLoading] = useState(false);
  const [noSaleDate, setNoSaleDate] = useState({
    from: daysAgoLocalStr(7),
    to: todayLocalStr(),
  });

  const [anomalyFlags, setAnomalyFlags] = useState([]);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyReviewed, setAnomalyReviewed] = useState("false");

  const [config, setConfig] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);

  const loadNoSale = useCallback(async () => {
    setNoSaleLoading(true);
    try {
      const res = await api.get("/api/risk/no-sale-events", {
        date_from: noSaleDate.from,
        date_to: noSaleDate.to,
        limit: 200,
      });
      setNoSaleEvents(res.events || []);
    } catch (err) {
      toast.error(err.message || "Failed to load no-sale events");
    } finally {
      setNoSaleLoading(false);
    }
  }, [noSaleDate.from, noSaleDate.to, toast]);

  const loadAnomalies = useCallback(async () => {
    setAnomalyLoading(true);
    try {
      const res = await api.get("/api/risk/anomaly-flags", { reviewed: anomalyReviewed, limit: 200 });
      setAnomalyFlags(res.flags || []);
    } catch (err) {
      toast.error(err.message || "Failed to load anomaly flags");
    } finally {
      setAnomalyLoading(false);
    }
  }, [anomalyReviewed, toast]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get("/api/risk/config");
      setConfig(res);
      setConfigDraft(res);
    } catch (err) {
      toast.error(err.message || "Failed to load risk config");
    }
  }, [toast]);

  useEffect(() => {
    if (flagsLoading || !flags.phase2g_risk_controls) return;
    if (tab === "no_sale") loadNoSale();
    if (tab === "anomalies") loadAnomalies();
    if (tab === "settings") loadConfig();
  }, [flagsLoading, flags.phase2g_risk_controls, tab, loadNoSale, loadAnomalies, loadConfig]);

  const handleReviewFlag = async (id) => {
    const note = window.prompt("Review note (optional):");
    if (note === null) return; // cancelled
    try {
      await api.put(`/api/risk/anomaly-flags/${id}/review`, { review_note: note || null });
      toast.success("Flag marked reviewed");
      loadAnomalies();
    } catch (err) {
      toast.error(err.message || "Failed to review flag");
    }
  };

  const saveConfig = async () => {
    if (!configDraft) return;
    setConfigSaving(true);
    try {
      const res = await api.put("/api/risk/config", {
        refund_approval_threshold: Number(configDraft.refund_approval_threshold),
        variance_approval_threshold: Number(configDraft.variance_approval_threshold),
        anomaly_z_score_threshold: Number(configDraft.anomaly_z_score_threshold),
      });
      setConfig(res);
      setConfigDraft(res);
      toast.success("Thresholds updated");
    } catch (err) {
      toast.error(err.message || "Failed to save config");
    } finally {
      setConfigSaving(false);
    }
  };

  const metricLabel = useMemo(() => ({
    voids_pct: "Void rate",
    refunds_pct: "Refund rate",
    discounts_pct: "Discount rate",
  }), []);

  if (flagsLoading) return null;
  if (!flags.phase2g_risk_controls) return <Navigate to="/" replace />;
  if (!hasPerm("all_access") && !hasPerm("view_reports")) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Retail Risk"
      subtitle="Monitor cash-drawer opens, refund approvals, and employee anomaly flags."
    >
      <div className="mb-4 flex gap-1 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-(--ui-radius-sm) px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-(--ui-surface) text-(--ui-text) shadow-sm"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "no_sale" && (
        <SectionCard className="p-4">
          <TableToolbar
            left={
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-(--ui-text-muted)">From</span>
                <Input
                  type="date"
                  value={noSaleDate.from}
                  onChange={(e) => setNoSaleDate((d) => ({ ...d, from: e.target.value }))}
                />
                <span className="text-(--ui-text-muted)">To</span>
                <Input
                  type="date"
                  value={noSaleDate.to}
                  onChange={(e) => setNoSaleDate((d) => ({ ...d, to: e.target.value }))}
                />
                <Button onClick={loadNoSale}>Apply</Button>
              </div>
            }
            right={
              <span className="text-xs text-(--ui-text-muted)">
                {noSaleEvents.length} event{noSaleEvents.length === 1 ? "" : "s"}
              </span>
            }
          />
          {noSaleLoading ? (
            <p className="mt-3 text-sm text-(--ui-text-muted)">Loading…</p>
          ) : noSaleEvents.length === 0 ? (
            <EmptyState title="No events in range" body="Try widening the date range or check another outlet." />
          ) : (
            <div className="mt-3 overflow-x-auto rounded-(--ui-radius-sm) border border-(--ui-border)">
              <table className="w-full text-sm">
                <thead className="bg-(--ui-muted-surface)">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">When</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Employee</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Outlet</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Reason</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {noSaleEvents.map((e) => (
                    <tr key={e.id} className="border-t border-(--ui-border)">
                      <td className="px-3 py-2">{fmtUtcDateTime(e.created_at)}</td>
                      <td className="px-3 py-2">{e.employee_name || `#${e.employee_id}`}</td>
                      <td className="px-3 py-2">{e.outlet_name || "—"}</td>
                      <td className="px-3 py-2">{e.reason_label || e.reason_code}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{e.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "anomalies" && (
        <SectionCard className="p-4">
          <TableToolbar
            left={
              <div className="flex items-center gap-2 text-sm">
                <span className="text-(--ui-text-muted)">Show</span>
                <Select
                  value={anomalyReviewed}
                  onChange={(e) => setAnomalyReviewed(e.target.value)}
                >
                  <option value="false">Unreviewed</option>
                  <option value="true">Reviewed</option>
                  <option value="">All</option>
                </Select>
                <Button onClick={loadAnomalies}>Refresh</Button>
              </div>
            }
            right={
              <span className="text-xs text-(--ui-text-muted)">
                {anomalyFlags.length} flag{anomalyFlags.length === 1 ? "" : "s"}
              </span>
            }
          />
          {anomalyLoading ? (
            <p className="mt-3 text-sm text-(--ui-text-muted)">Loading…</p>
          ) : anomalyFlags.length === 0 ? (
            <EmptyState title="No anomaly flags" body="The nightly scan hasn't surfaced any employees worth a closer look." />
          ) : (
            <div className="mt-3 overflow-x-auto rounded-(--ui-radius-sm) border border-(--ui-border)">
              <table className="w-full text-sm">
                <thead className="bg-(--ui-muted-surface)">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Flagged</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Employee</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Outlet</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Metric</th>
                    <th className="px-3 py-2 text-right font-medium text-(--ui-text-muted)">Rate</th>
                    <th className="px-3 py-2 text-right font-medium text-(--ui-text-muted)">Peer μ</th>
                    <th className="px-3 py-2 text-right font-medium text-(--ui-text-muted)">z-score</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Period</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalyFlags.map((f) => (
                    <tr key={f.id} className="border-t border-(--ui-border)">
                      <td className="px-3 py-2">{fmtUtcDate(f.flagged_at)}</td>
                      <td className="px-3 py-2">{f.employee_name || `#${f.employee_id}`}</td>
                      <td className="px-3 py-2">{f.outlet_name || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone="warning">{metricLabel[f.metric] || f.metric}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{(Number(f.value) * 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right">{(Number(f.peer_mean) * 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-600">{Number(f.z_score).toFixed(2)}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">
                        {fmtUtcDate(f.period_start)} → {fmtUtcDate(f.period_end)}
                      </td>
                      <td className="px-3 py-2">
                        {f.reviewed_at ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle2 size={12} />
                            {fmtUtcDate(f.reviewed_at)}
                            {f.reviewed_by_name ? ` by ${f.reviewed_by_name}` : ""}
                          </span>
                        ) : (
                          <Button size="sm" onClick={() => handleReviewFlag(f.id)}>
                            Review
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "settings" && (
        <SectionCard className="p-5 max-w-2xl">
          {!configDraft ? (
            <p className="text-sm text-(--ui-text-muted)">Loading…</p>
          ) : !hasPerm("all_access") ? (
            <p className="text-sm text-(--ui-text-muted)">Only administrators can edit risk thresholds.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Shield size={16} className="text-[#8066FF]" />
                <h3 className="text-base font-semibold">Risk thresholds</h3>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="block text-xs font-medium text-(--ui-text-muted) mb-1">
                    Refund approval threshold
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={configDraft.refund_approval_threshold || ""}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, refund_approval_threshold: e.target.value }))
                    }
                  />
                  <span className="mt-1 block text-xs text-(--ui-text-muted)">
                    Refunds above {money(configDraft.refund_approval_threshold)} require a manager PIN.
                  </span>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-(--ui-text-muted) mb-1">
                    Shift variance threshold
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={configDraft.variance_approval_threshold || ""}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, variance_approval_threshold: e.target.value }))
                    }
                  />
                  <span className="mt-1 block text-xs text-(--ui-text-muted)">
                    Close-shift variance above {money(configDraft.variance_approval_threshold)} requires a reason + manager PIN.
                  </span>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-(--ui-text-muted) mb-1">
                    Anomaly z-score threshold
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={configDraft.anomaly_z_score_threshold || ""}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, anomaly_z_score_threshold: e.target.value }))
                    }
                  />
                  <span className="mt-1 block text-xs text-(--ui-text-muted)">
                    Employees whose void/refund/discount rate sits this many standard deviations above their outlet peers are flagged nightly.
                  </span>
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <Button tone="primary" disabled={configSaving} onClick={saveConfig}>
                  {configSaving ? "Saving…" : "Save thresholds"}
                </Button>
                <Button onClick={() => setConfigDraft(config)}>Reset</Button>
              </div>
              {config?.updated_at && (
                <p className="mt-3 text-xs text-(--ui-text-muted)">
                  Last updated {fmtUtcDateTime(config.updated_at)}
                </p>
              )}
            </>
          )}
        </SectionCard>
      )}
    </PageShell>
  );
}

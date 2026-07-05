import { useEffect, useState } from "react";
import { Play, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";

function GovernanceCard({ title, children, actions = null }) {
  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-(--ui-text)">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="rounded-xl bg-(--ui-muted-surface) p-3 text-sm text-(--ui-text-muted)">{text}</p>;
}

function ScheduleForm({ draft, setDraft, onSubmit, busy }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <input
        value={draft.name}
        onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
        placeholder="Schedule name"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <input
        value={draft.recipient}
        onChange={(e) => setDraft((p) => ({ ...p, recipient: e.target.value }))}
        placeholder="Recipient (optional)"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <select
        value={draft.report_key}
        onChange={(e) => setDraft((p) => ({ ...p, report_key: e.target.value }))}
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      >
        <option value="profit-by-product">Profit by Product</option>
        <option value="stock-aging">Stock Aging</option>
        <option value="stockout-risk">Stockout Risk</option>
        <option value="exceptions-high-discount">Exceptions High Discount</option>
      </select>
      <select
        value={draft.frequency}
        onChange={(e) => setDraft((p) => ({ ...p, frequency: e.target.value }))}
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
      <input
        type="number"
        min="0"
        max="23"
        value={draft.run_hour}
        onChange={(e) => setDraft((p) => ({ ...p, run_hour: e.target.value }))}
        placeholder="Run hour"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <input
        type="number"
        min="0"
        max="59"
        value={draft.run_minute}
        onChange={(e) => setDraft((p) => ({ ...p, run_minute: e.target.value }))}
        placeholder="Run minute"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <div className="md:col-span-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-(--ui-primary) px-3 py-2 text-sm font-medium text-(--ui-on-primary) disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={14} />
          Save Schedule
        </button>
      </div>
    </div>
  );
}

function SavedViewForm({ draft, setDraft, onSubmit, busy }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <input
        value={draft.name}
        onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
        placeholder="View name"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <select
        value={draft.scope}
        onChange={(e) => setDraft((p) => ({ ...p, scope: e.target.value }))}
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      >
        <option value="personal">Personal</option>
        <option value="global">Global</option>
      </select>
      <select
        value={draft.report_key}
        onChange={(e) => setDraft((p) => ({ ...p, report_key: e.target.value }))}
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm md:col-span-2"
      >
        <option value="overview">Overview</option>
        <option value="profit-layer">Profit Layer</option>
        <option value="inventory-health">Inventory Health</option>
        <option value="exceptions">Exceptions</option>
      </select>
      <div className="md:col-span-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-(--ui-primary) px-3 py-2 text-sm font-medium text-(--ui-on-primary) disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={14} />
          Save View
        </button>
      </div>
    </div>
  );
}

function DefinitionForm({ draft, setDraft, onSubmit, busy }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <input
        value={draft.report_key}
        onChange={(e) => setDraft((p) => ({ ...p, report_key: e.target.value }))}
        placeholder="Report key"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <input
        value={draft.version}
        onChange={(e) => setDraft((p) => ({ ...p, version: e.target.value }))}
        placeholder="Version"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm"
      />
      <input
        value={draft.query_signature}
        onChange={(e) =>
          setDraft((p) => ({ ...p, query_signature: e.target.value }))
        }
        placeholder="Query signature"
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm md:col-span-2"
      />
      <textarea
        value={draft.notes}
        onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
        placeholder="Notes"
        rows={3}
        className="rounded-xl border border-(--ui-border) px-3 py-2 text-sm md:col-span-2"
      />
      <div className="md:col-span-2">
        <button
          onClick={onSubmit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-(--ui-primary) px-3 py-2 text-sm font-medium text-(--ui-on-primary) disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={14} />
          Save Definition
        </button>
      </div>
    </div>
  );
}

export default function GovernanceTab({ filters }) {
  const { authHeaders, hasPerm } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [schedules, setSchedules] = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [deliveryLog, setDeliveryLog] = useState([]);
  const [scheduleDraft, setScheduleDraft] = useState({
    name: "",
    report_key: "profit-by-product",
    frequency: "daily",
    run_hour: 6,
    run_minute: 0,
    recipient: "",
  });
  const [viewDraft, setViewDraft] = useState({
    report_key: "overview",
    name: "",
    scope: "personal",
  });
  const [defDraft, setDefDraft] = useState({
    report_key: "forecast-demand",
    version: "",
    query_signature: "",
    notes: "",
  });

  const canManageGovernance = hasPerm("manage_employees");

  const load = async () => {
    if (!flags.reports_scheduled_exports) return;
    setLoading(true);
    setError("");
    try {
      const calls = [
        api.get("/api/reports/saved-views"),
      ];
      if (canManageGovernance) {
        calls.push(api.get("/api/reports/schedules"));
        calls.push(api.get("/api/reports/governance/definitions"));
        calls.push(api.get("/api/reports/delivery-log"));
      }

      const [viewsRes, schedulesRes, defsRes, logRes] = await Promise.all(calls);
      setSavedViews(viewsRes.views || []);
      setSchedules(schedulesRes?.schedules || []);
      setDefinitions(defsRes?.definitions || []);
      setDeliveryLog(logRes?.log || []);
    } catch (e) {
      setError(e.message || "Failed to load governance reporting.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [flags.reports_scheduled_exports, canManageGovernance]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSchedule = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/reports/schedules", {
          ...scheduleDraft,
          run_hour: Number(scheduleDraft.run_hour || 6),
          run_minute: Number(scheduleDraft.run_minute || 0),
          filters,
        });
      setScheduleDraft((p) => ({ ...p, name: "", recipient: "" }));
      await load();
    } catch (e) {
      setError(e.message || "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  };

  const createSavedView = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/reports/saved-views", {
          ...viewDraft,
          filters,
        });
      setViewDraft((p) => ({ ...p, name: "" }));
      await load();
    } catch (e) {
      setError(e.message || "Failed to save view");
    } finally {
      setBusy(false);
    }
  };

  const createDefinition = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/reports/governance/definitions", defDraft);
      setDefDraft((p) => ({ ...p, version: "", query_signature: "", notes: "" }));
      await load();
    } catch (e) {
      setError(e.message || "Failed to save definition");
    } finally {
      setBusy(false);
    }
  };

  const runScheduleNow = async (id) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/reports/schedules/${id}/run-now`);
      await load();
    } catch (e) {
      setError(e.message || "Failed to run schedule");
    } finally {
      setBusy(false);
    }
  };

  if (!flags.reports_scheduled_exports) {
    return (
      <div className="rounded-2xl border border-dashed border-(--ui-border-strong) bg-(--ui-muted-surface) p-6 text-sm text-(--ui-text-muted)">
        Governance reporting is disabled by the `reports_scheduled_exports` feature flag.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-(--ui-border) bg-linear-to-r from-(--ui-primary) to-(--ui-primary-strong) p-5 text-(--ui-on-primary)">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-(--ui-surface)/10 px-3 py-1 text-xs font-medium">
              <ShieldCheck size={14} />
              Governance and Audit
            </div>
            <h2 className="text-xl font-semibold">Reporting operations and control layer</h2>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              Manage scheduled exports, saved views, definition versions, and the delivery audit trail from the main reports workspace.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading || busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-(--ui-surface)/10 px-3 py-2 text-sm font-medium text-(--ui-on-primary) disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-(--ui-danger-fg)">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GovernanceCard title={`Saved Views (${savedViews.length})`}>
          <SavedViewForm
            draft={viewDraft}
            setDraft={setViewDraft}
            onSubmit={createSavedView}
            busy={busy}
          />
          <div className="mt-4 space-y-2">
            {savedViews.length ? (
              savedViews.slice(0, 20).map((view) => (
                <div
                  key={view.id}
                  className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm"
                >
                  <div className="font-medium text-(--ui-text)">{view.name}</div>
                  <div className="text-(--ui-text-muted)">
                    {view.report_key} | {view.scope}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState text="No saved views recorded yet." />
            )}
          </div>
        </GovernanceCard>

        <GovernanceCard
          title={`Schedules (${schedules.length})`}
          actions={
            canManageGovernance ? null : (
              <span className="rounded-full bg-(--ui-warning-bg) px-2 py-1 text-xs font-medium text-(--ui-warning-fg)">
                Manager/Admin only
              </span>
            )
          }
        >
          {canManageGovernance ? (
            <>
              <ScheduleForm
                draft={scheduleDraft}
                setDraft={setScheduleDraft}
                onSubmit={createSchedule}
                busy={busy}
              />
              <div className="mt-4 space-y-2">
                {schedules.length ? (
                  schedules.slice(0, 20).map((schedule) => (
                    <div
                      key={schedule.id}
                      className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-(--ui-text)">{schedule.name}</div>
                          <div className="text-(--ui-text-muted)">
                            {schedule.report_key} | {schedule.frequency} | next:{" "}
                            {schedule.next_run_at || "-"}
                          </div>
                        </div>
                        <button
                          onClick={() => runScheduleNow(schedule.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-(--ui-border) bg-(--ui-surface) px-2 py-1 text-xs font-medium text-(--ui-text) disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Play size={12} />
                          Run now
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState text="No report schedules configured yet." />
                )}
              </div>
            </>
          ) : (
            <EmptyState text="You can view saved views here, but schedules require manager or administrator access." />
          )}
        </GovernanceCard>

        <GovernanceCard title={`Definition Versions (${definitions.length})`}>
          {canManageGovernance ? (
            <>
              <DefinitionForm
                draft={defDraft}
                setDraft={setDefDraft}
                onSubmit={createDefinition}
                busy={busy}
              />
              <div className="mt-4 space-y-2">
                {definitions.length ? (
                  definitions.slice(0, 20).map((definition) => (
                    <div
                      key={definition.id}
                      className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm"
                    >
                      <div className="font-medium text-(--ui-text)">
                        {definition.report_key} {definition.version}
                      </div>
                      <div className="text-(--ui-text-muted)">
                        {definition.query_signature || "-"}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState text="No definition versions registered yet." />
                )}
              </div>
            </>
          ) : (
            <EmptyState text="Definition history is restricted to manager or administrator users." />
          )}
        </GovernanceCard>

        <GovernanceCard title={`Delivery Log (${deliveryLog.length})`}>
          {canManageGovernance ? (
            <div className="space-y-2">
              {deliveryLog.length ? (
                deliveryLog.slice(0, 20).map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm"
                  >
                    <div className="font-medium text-(--ui-text)">
                      {row.status} | {row.channel}
                    </div>
                    <div className="text-(--ui-text-muted)">{row.message || "-"}</div>
                  </div>
                ))
              ) : (
                <EmptyState text="No delivery log entries yet." />
              )}
            </div>
          ) : (
            <EmptyState text="Delivery log visibility is restricted to manager or administrator users." />
          )}
        </GovernanceCard>
      </div>
    </div>
  );
}

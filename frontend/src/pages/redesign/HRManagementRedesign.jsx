import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const LEAVE_TYPES = ["annual", "sick", "casual", "unpaid", "other"];
const LEAVE_STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger" };
const PERIOD_STATUS_TONE = { open: "info", generated: "warning", finalized: "success" };
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const money = (v) => `PKRs ${Number(v || 0).toFixed(2)}`;

const EMPTY_LEAVE = { employee_id: "", type: "annual", start_date: "", end_date: "", days: 1, reason: "" };
const EMPTY_PERIOD = { period_name: "", start_date: "", end_date: "" };

export default function HRManagementRedesign() {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState("leave");
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [lines, setLines] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [leaveForm, setLeaveForm] = useState(EMPTY_LEAVE);
  const [periodForm, setPeriodForm] = useState(EMPTY_PERIOD);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [empRes, leaveRes, periodRes] = await Promise.all([
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/hr/leave`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/hr/payroll/periods`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setEmployees(empRes.employees || []);
      setLeaves(leaveRes.leave_requests || []);
      setPeriods(periodRes.periods || []);
    } catch (e) {
      setError(e.message || "Failed to load HR data");
    }
  }, [authHeaders]);

  const loadLines = useCallback(async (periodId) => {
    if (!periodId) return setLines([]);
    try {
      const res = await fetch(`${API}/api/hr/payroll/periods/${periodId}/lines`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setLines(data.lines || []);
    } catch {
      setLines([]);
    }
  }, [authHeaders]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadLines(selectedPeriod); }, [selectedPeriod, loadLines]);

  const submitLeave = async (e) => {
    e.preventDefault();
    setSubmittingLeave(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/hr/leave`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(leaveForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit leave");
      setLeaveForm(EMPTY_LEAVE);
      await loadAll();
    } catch (e2) {
      setError(e2.message || "Failed to submit leave");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const updateLeaveStatus = async (id, status) => {
    try {
      await fetch(`${API}/api/hr/leave/${id}/status`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch { /* silent */ }
  };

  const createPeriod = async (e) => {
    e.preventDefault();
    setCreatingPeriod(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/hr/payroll/periods`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(periodForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create period");
      setPeriodForm(EMPTY_PERIOD);
      await loadAll();
    } catch (e2) {
      setError(e2.message || "Failed to create period");
    } finally {
      setCreatingPeriod(false);
    }
  };

  const generatePayroll = async (periodId) => {
    try {
      await fetch(`${API}/api/hr/payroll/periods/${periodId}/generate`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      await loadAll();
      setSelectedPeriod(String(periodId));
    } catch { /* silent */ }
  };

  const TABS = [
    { id: "leave", label: "Leave Requests" },
    { id: "payroll", label: "Payroll" },
  ];

  return (
    <PageShell title="HR Management" subtitle="Leave requests and payroll period management.">
      {error && (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      )}

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 border-b border-[var(--ui-border)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-[var(--ui-accent)] text-[var(--ui-accent)]"
                : "border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Leave tab ─────────────────────────────────────────────── */}
      {tab === "leave" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Create leave form */}
          <SectionCard className="p-4">
            <p className="mb-3 font-semibold text-[var(--ui-text)]">Submit Leave Request</p>
            <form className="space-y-2" onSubmit={submitLeave}>
              <Select
                required
                value={leaveForm.employee_id}
                onChange={(e) => setLeaveForm((f) => ({ ...f, employee_id: e.target.value }))}
              >
                <option value="">Select employee</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </Select>
              <Select
                value={leaveForm.type}
                onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))}
              >
                {LEAVE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  required
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))}
                />
                <Input
                  type="date"
                  required
                  value={leaveForm.end_date}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={leaveForm.days}
                onChange={(e) => setLeaveForm((f) => ({ ...f, days: e.target.value }))}
                placeholder="Number of days"
              />
              <textarea
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3}
                placeholder="Reason"
                className="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-sm text-[var(--ui-text)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]/20"
              />
              <Button tone="primary" type="submit" disabled={submittingLeave}>
                {submittingLeave ? "Submitting..." : "Submit Leave"}
              </Button>
            </form>
          </SectionCard>

          {/* Leave requests table */}
          <SectionCard className="p-4">
            <p className="mb-3 font-semibold text-[var(--ui-text)]">Requests ({leaves.length})</p>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                  <tr>
                    <th className="px-2 py-2 text-left">Employee</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-left">Dates</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--ui-border)]">
                      <td className="px-2 py-2 font-medium text-[var(--ui-text)]">{r.employee_name}</td>
                      <td className="px-2 py-2 capitalize text-[var(--ui-text-muted)]">{r.type}</td>
                      <td className="px-2 py-2 text-xs text-[var(--ui-text-muted)]">
                        {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={LEAVE_STATUS_TONE[r.status] || "default"} className="capitalize">
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.status === "pending" && (
                          <div className="inline-flex gap-1">
                            <Button size="sm" tone="primary" onClick={() => updateLeaveStatus(r.id, "approved")}>
                              Approve
                            </Button>
                            <Button size="sm" tone="danger" onClick={() => updateLeaveStatus(r.id, "rejected")}>
                              Reject
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leaves.length === 0 && (
                <EmptyState title="No leave requests" body="Leave requests will appear here." />
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Payroll tab ───────────────────────────────────────────── */}
      {tab === "payroll" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Create period */}
            <SectionCard className="p-4">
              <p className="mb-3 font-semibold text-[var(--ui-text)]">Create Payroll Period</p>
              <form className="space-y-2" onSubmit={createPeriod}>
                <Input
                  required
                  placeholder="Period name (e.g. Feb 2026)"
                  value={periodForm.period_name}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, period_name: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    required
                    value={periodForm.start_date}
                    onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                  <Input
                    type="date"
                    required
                    value={periodForm.end_date}
                    onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                <Button tone="primary" type="submit" disabled={creatingPeriod}>
                  {creatingPeriod ? "Creating..." : "Create Period"}
                </Button>
              </form>
            </SectionCard>

            {/* Periods list */}
            <SectionCard className="p-4">
              <p className="mb-3 font-semibold text-[var(--ui-text)]">Periods ({periods.length})</p>
              <div className="max-h-64 space-y-2 overflow-auto">
                {periods.length === 0 && (
                  <p className="text-sm text-[var(--ui-text-muted)]">No payroll periods yet.</p>
                )}
                {periods.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      selectedPeriod === String(p.id)
                        ? "border-[var(--ui-accent)] bg-[var(--ui-accent)]/5"
                        : "border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)]"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--ui-text)]">{p.period_name}</p>
                      <p className="text-xs text-[var(--ui-text-muted)]">
                        {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
                      </p>
                      <Badge tone={PERIOD_STATUS_TONE[p.status] || "default"} className="mt-1 capitalize">
                        {p.status || "open"}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => setSelectedPeriod(String(p.id))}
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        tone="primary"
                        onClick={() => generatePayroll(p.id)}
                      >
                        Generate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Payroll lines */}
          <SectionCard>
            <div className="border-b border-[var(--ui-border)] px-4 py-3">
              <p className="font-semibold text-[var(--ui-text)]">
                Payroll Lines
                {selectedPeriod && periods.find((p) => String(p.id) === selectedPeriod) && (
                  <span className="ml-2 text-sm font-normal text-[var(--ui-text-muted)]">
                    — {periods.find((p) => String(p.id) === selectedPeriod)?.period_name}
                  </span>
                )}
              </p>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Base Rate</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-right">Days</th>
                    <th className="px-3 py-2 text-right">Leave</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Deductions</th>
                    <th className="px-3 py-2 text-right">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)]">
                      <td className="px-3 py-2 font-medium text-[var(--ui-text)]">{l.employee_name}</td>
                      <td className="px-3 py-2 capitalize text-[var(--ui-text-muted)]">{l.salary_type}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">{money(l.base_rate)}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">{l.total_hours ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">{l.total_days ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">{l.leave_days ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text)]">{money(l.gross_pay)}</td>
                      <td className="px-3 py-2 text-right text-rose-600">{money(l.deductions)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600">{money(l.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selectedPeriod && (
                <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">
                  Select a period above to view its payroll lines.
                </div>
              )}
              {selectedPeriod && lines.length === 0 && (
                <EmptyState
                  title="No payroll lines"
                  body="Click Generate on a period to calculate payroll lines."
                />
              )}
            </div>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}

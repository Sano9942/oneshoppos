import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { downloadCsv } from "../../utils/csvExport";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const LEAVE_TYPES = ["annual", "sick", "casual", "unpaid", "other"];
const LEAVE_STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger" };
const PERIOD_STATUS_TONE = { open: "info", draft: "info", generated: "warning", finalized: "success" };
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const EMPTY_LEAVE = { employee_id: "", type: "annual", start_date: "", end_date: "", days: 1, reason: "" };
const EMPTY_PERIOD = { period_name: "", start_date: "", end_date: "" };

const TABS = [
  { id: "leave", label: "Leave Requests" },
  { id: "balance", label: "Leave Balance" },
  { id: "payroll", label: "Payroll" },
  { id: "attendance", label: "Attendance Summary" },
];

export default function HRManagementRedesign() {
  const { fmt: money } = useCurrency();
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

  // Rejection note modal
  const [rejectModal, setRejectModal] = useState(null); // { id, note }

  // Leave balance from backend
  const [leaveBalances, setLeaveBalances] = useState([]);

  // Add payroll line form
  const [lineForm, setLineForm] = useState({ employee_id: "", type: "Basic", amount: "" });
  const [savingLine, setSavingLine] = useState(false);

  // Payroll export
  const [exportingPayroll, setExportingPayroll] = useState(false);

  // Attendance summary state
  const [attMonth, setAttMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [attSummary, setAttSummary] = useState([]);
  const [attLoading, setAttLoading] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [empRes, leaveRes, periodRes, balanceRes] = await Promise.all([
        api.get("/api/employees"),
        api.get("/api/hr/leave"),
        api.get("/api/hr/payroll/periods"),
        api.get("/api/hr/leave/balance"),
      ]);
      setEmployees(empRes.employees || []);
      setLeaves(leaveRes.leave_requests || []);
      setPeriods(periodRes.periods || []);
      setLeaveBalances(balanceRes.balances || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load HR data");
    }
  }, []);

  const loadLines = useCallback(async (periodId) => {
    if (!periodId) return setLines([]);
    try {
      const data = await api.get(`/api/hr/payroll/periods/${periodId}/lines`);
      setLines(data.lines || []);
    } catch {
      setLines([]);
    }
  }, []);

  const loadAttSummary = useCallback(async (month) => {
    setAttLoading(true);
    try {
      const [year, mon] = month.split("-");
      const start = `${year}-${mon}-01`;
      const lastDay = new Date(Number(year), Number(mon), 0).getDate();
      const end = `${year}-${mon}-${String(lastDay).padStart(2, "0")}`;
      const data = await api.get(`/api/attendance?date_from=${start}&date_to=${end}`);
      const records = data.records || data.attendance || [];

      // Aggregate per employee
      const map = {};
      for (const r of records) {
        const id = r.employee_id;
        if (!map[id]) map[id] = { employee_id: id, name: r.employee_name || `Emp #${id}`, days: 0, total_hours: 0, late: 0, absent: 0 };
        map[id].days += 1;
        map[id].total_hours += Number(r.duration_hours || 0);
      }
      setAttSummary(Object.values(map));
    } catch {
      setAttSummary([]);
    } finally {
      setAttLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadLines(selectedPeriod); }, [selectedPeriod, loadLines]);
  useEffect(() => { if (tab === "attendance") loadAttSummary(attMonth); }, [tab, attMonth, loadAttSummary]);

  const submitLeave = async (e) => {
    e.preventDefault();
    setSubmittingLeave(true);
    setError("");
    try {
      await api.post("/api/hr/leave", leaveForm);
      setLeaveForm(EMPTY_LEAVE);
      await loadAll();
    } catch (e2) {
      setError(e2.message || "Failed to submit leave");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const updateLeaveStatus = async (id, status, note) => {
    try {
      await api.put(`/api/hr/leave/${id}/status`, { status, rejection_note: note || null });
      await loadAll();
    } catch { /* silent */ }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    await updateLeaveStatus(rejectModal.id, "rejected", rejectModal.note);
    setRejectModal(null);
  };

  const createPeriod = async (e) => {
    e.preventDefault();
    setCreatingPeriod(true);
    setError("");
    try {
      await api.post("/api/hr/payroll/periods", periodForm);
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
      await api.post(`/api/hr/payroll/periods/${periodId}/generate`);
      await loadAll();
      setSelectedPeriod(String(periodId));
    } catch { /* silent */ }
  };

  const savePayrollLine = async (e) => {
    e.preventDefault();
    if (!selectedPeriod) return;
    setSavingLine(true);
    try {
      await api.post(`/api/hr/payroll/periods/${selectedPeriod}/lines`, lineForm);
      setLineForm({ employee_id: "", type: "Basic", amount: "" });
      await loadLines(selectedPeriod);
    } catch (e2) {
      setError(e2.message || "Failed to save line");
    } finally {
      setSavingLine(false);
    }
  };

  const exportPayroll = async () => {
    if (!selectedPeriod) return;
    setExportingPayroll(true);
    try {
      const data = await api.get(`/api/hr/payroll-export?period_id=${selectedPeriod}`);
      const rows = (data.rows || []).map((r) => [
        r.employee_name,
        r.department,
        r.days_worked ?? "",
        r.hours_total ?? "",
        r.overtime_hours ?? "",
        r.leave_days_taken ?? "",
        r.gross_pay,
        r.deductions,
        r.net_pay,
      ]);
      const periodName = data.period?.period_name || `period-${selectedPeriod}`;
      downloadCsv(
        ["Employee", "Department", "Days Worked", "Hours Total", "Overtime Hours", "Leave Days Taken", "Gross Pay", "Deductions", "Net Pay"],
        rows,
        `payroll-export-${periodName.replace(/\s+/g, "-")}`
      );
    } catch (e2) {
      setError(e2.message || "Payroll export failed");
    } finally {
      setExportingPayroll(false);
    }
  };

  // Leave balance: compute from leaves data (fallback if API unavailable)
  const leaveBalance = employees.map((emp) => {
    const empLeaves = leaves.filter((l) => l.employee_id === emp.id && l.status === "approved");
    const used = {};
    for (const t of LEAVE_TYPES) used[t] = 0;
    for (const l of empLeaves) used[l.type] = (used[l.type] || 0) + Number(l.days || 0);
    const annualAllowance = emp.work_hours_per_day ? 2 : 2; // default 2/month
    return { id: emp.id, name: emp.name, used, annualAllowance };
  });

  return (
    <PageShell title="HR Management" subtitle="Leave requests, payroll, balances and attendance summary.">
      {error && (
        <SectionCard className="mb-3 border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">{error}</SectionCard>
      )}

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 border-b border-(--ui-border) overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-(--ui-accent) text-(--ui-accent)"
                : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Leave Requests tab ─────────────────────────────────────── */}
      {tab === "leave" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard className="p-4">
            <p className="mb-3 font-semibold text-(--ui-text)">Submit Leave Request</p>
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
                <Input type="date" required value={leaveForm.start_date} onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))} />
                <Input type="date" required value={leaveForm.end_date} onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
              <Input
                type="number" min={0.5} step={0.5}
                value={leaveForm.days}
                onChange={(e) => setLeaveForm((f) => ({ ...f, days: e.target.value }))}
                placeholder="Number of days"
              />
              <textarea
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3} placeholder="Reason"
                className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) placeholder-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-accent)/20"
              />
              <Button tone="primary" type="submit" disabled={submittingLeave}>
                {submittingLeave ? "Submitting..." : "Submit Leave"}
              </Button>
            </form>
          </SectionCard>

          <SectionCard className="p-4">
            <p className="mb-3 font-semibold text-(--ui-text)">Requests ({leaves.length})</p>
            <div className="overflow-auto max-h-125">
              <table className="min-w-full text-sm">
                <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted) sticky top-0">
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
                    <tr key={r.id} className="border-t border-(--ui-border)">
                      <td className="px-2 py-2 font-medium text-(--ui-text)">{r.employee_name}</td>
                      <td className="px-2 py-2 capitalize text-(--ui-text-muted)">{r.type}</td>
                      <td className="px-2 py-2 text-xs text-(--ui-text-muted)">
                        {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                        <span className="ml-1 text-(--ui-text)">({r.days}d)</span>
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={LEAVE_STATUS_TONE[r.status] || "default"} className="capitalize">{r.status}</Badge>
                        {r.rejection_note && (
                          <p className="mt-0.5 text-xs text-(--ui-danger-fg) italic">{r.rejection_note}</p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.status === "pending" && (
                          <div className="inline-flex gap-1">
                            <Button size="sm" tone="primary" onClick={() => updateLeaveStatus(r.id, "approved")}>Approve</Button>
                            <Button size="sm" tone="danger" onClick={() => setRejectModal({ id: r.id, note: "" })}>Reject</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leaves.length === 0 && <EmptyState title="No leave requests" body="Leave requests will appear here." />}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Leave Balance tab ──────────────────────────────────────── */}
      {tab === "balance" && (
        <SectionCard>
          <div className="border-b border-(--ui-border) px-4 py-3">
            <p className="font-semibold text-(--ui-text)">Leave Balance by Employee</p>
            <p className="text-xs text-(--ui-text-muted) mt-0.5">Annual allowance vs used leave days from the backend.</p>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-right">Allowance (days)</th>
                  <th className="px-3 py-2 text-right">Used</th>
                  <th className="px-3 py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {leaveBalances.map((emp) => {
                  const remaining = Number(emp.remaining || 0);
                  const remainingColor = remaining === 0
                    ? "text-(--ui-danger-fg)"
                    : remaining <= 2
                    ? "text-(--ui-warning-fg)"
                    : "text-(--ui-success-fg)";
                  return (
                    <tr key={emp.employee_id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                      <td className="px-3 py-2 font-medium text-(--ui-text)">{emp.name}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">{emp.allowance}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{emp.used}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${remainingColor}`}>{remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {leaveBalances.length === 0 && <EmptyState title="No leave balance data" body="Leave balances will appear here once employees and leave allowances are configured." />}
          </div>
        </SectionCard>
      )}

      {/* ── Payroll tab ───────────────────────────────────────────── */}
      {tab === "payroll" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard className="p-4">
              <p className="mb-3 font-semibold text-(--ui-text)">Create Payroll Period</p>
              <form className="space-y-2" onSubmit={createPeriod}>
                <Input
                  required placeholder="Period name (e.g. Feb 2026)"
                  value={periodForm.period_name}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, period_name: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" required value={periodForm.start_date} onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))} />
                  <Input type="date" required value={periodForm.end_date} onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))} />
                </div>
                <Button tone="primary" type="submit" disabled={creatingPeriod}>
                  {creatingPeriod ? "Creating..." : "Create Period"}
                </Button>
              </form>
            </SectionCard>

            <SectionCard className="p-4">
              <p className="mb-3 font-semibold text-(--ui-text)">Periods ({periods.length})</p>
              <div className="max-h-64 space-y-2 overflow-auto">
                {periods.length === 0 && <p className="text-sm text-(--ui-text-muted)">No payroll periods yet.</p>}
                {periods.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      selectedPeriod === String(p.id) ? "border-(--ui-accent) bg-(--ui-accent)/5" : "border-(--ui-border) hover:bg-(--ui-muted-surface)"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-(--ui-text)">{p.period_name}</p>
                      <p className="text-xs text-(--ui-text-muted)">{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</p>
                      <Badge tone={PERIOD_STATUS_TONE[p.status] || "default"} className="mt-1 capitalize">{p.status || "draft"}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setSelectedPeriod(String(p.id))}>View</Button>
                      <Button size="sm" tone="primary" onClick={() => generatePayroll(p.id)}>Generate</Button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard>
            <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
              <p className="font-semibold text-(--ui-text)">
                Payroll Lines
                {selectedPeriod && periods.find((p) => String(p.id) === selectedPeriod) && (
                  <span className="ml-2 text-sm font-normal text-(--ui-text-muted)">
                    — {periods.find((p) => String(p.id) === selectedPeriod)?.period_name}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                {selectedPeriod && (
                  <Button size="sm" disabled={exportingPayroll} onClick={exportPayroll}>
                    <Download className="mr-1 inline-block h-3.5 w-3.5" />
                    {exportingPayroll ? "Exporting..." : "Export Payroll"}
                  </Button>
                )}
                {lines.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() =>
                      downloadCsv(
                        ["Employee", "Type", "Base Rate", "Hours", "Days", "Leave Days", "Gross Pay", "Deductions", "Net Pay", "Notes"],
                        lines.map((l) => [
                          l.employee_name,
                          l.salary_type,
                          l.base_rate,
                          l.total_hours ?? "",
                          l.total_days ?? "",
                          l.leave_days ?? "",
                          l.gross_pay,
                          l.deductions,
                          l.net_pay,
                          l.notes ?? "",
                        ]),
                        `payroll-${selectedPeriod}`
                      )
                    }
                  >
                    Export CSV
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
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
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                      <td className="px-3 py-2 font-medium text-(--ui-text)">{l.employee_name}</td>
                      <td className="px-3 py-2 capitalize text-(--ui-text-muted)">{l.salary_type}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">{money(l.base_rate)}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">{l.total_hours ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">{l.total_days ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">{l.leave_days ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{money(l.gross_pay)}</td>
                      <td className="px-3 py-2 text-right text-(--ui-danger-fg)">{money(l.deductions)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-(--ui-success-fg)">{money(l.net_pay)}</td>
                      <td className="px-3 py-2 text-xs text-(--ui-text-muted) max-w-48">{l.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selectedPeriod && (
                <div className="p-8 text-center text-sm text-(--ui-text-muted)">Select a period above to view its payroll lines.</div>
              )}
              {selectedPeriod && lines.length === 0 && (
                <EmptyState title="No payroll lines" body="Click Generate on a period to calculate payroll lines." />
              )}
            </div>
          </SectionCard>

          {selectedPeriod && (
            <SectionCard className="p-4">
              <p className="mb-3 font-semibold text-(--ui-text)">Add Payroll Line</p>
              <form className="flex flex-wrap gap-2 items-end" onSubmit={savePayrollLine}>
                <div className="flex-1 min-w-36">
                  <label className="block text-xs text-(--ui-text-muted) mb-1">Employee</label>
                  <Select
                    required
                    value={lineForm.employee_id}
                    onChange={(e) => setLineForm((f) => ({ ...f, employee_id: e.target.value }))}
                  >
                    <option value="">Select employee</option>
                    {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-(--ui-text-muted) mb-1">Type</label>
                  <Select
                    value={lineForm.type}
                    onChange={(e) => setLineForm((f) => ({ ...f, type: e.target.value }))}
                  >
                    <option value="Basic">Basic</option>
                    <option value="Bonus">Bonus</option>
                    <option value="Deduction">Deduction</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs text-(--ui-text-muted) mb-1">Amount</label>
                  <Input
                    required
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Amount"
                    value={lineForm.amount}
                    onChange={(e) => setLineForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-36"
                  />
                </div>
                <Button tone="primary" type="submit" disabled={savingLine}>
                  {savingLine ? "Saving..." : "Save Line"}
                </Button>
              </form>
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Attendance Summary tab ─────────────────────────────────── */}
      {tab === "attendance" && (
        <div className="space-y-4">
          <SectionCard className="p-4">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-(--ui-text-muted) mb-1">Month</label>
                <Input
                  type="month"
                  value={attMonth}
                  onChange={(e) => setAttMonth(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="mt-4">
                <Button onClick={() => loadAttSummary(attMonth)} disabled={attLoading}>
                  {attLoading ? "Loading..." : "Refresh"}
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard>
            <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
              <p className="font-semibold text-(--ui-text)">Monthly Attendance — {attMonth}</p>
              {attSummary.length > 0 && (
                <Button
                  size="sm"
                  onClick={() =>
                    downloadCsv(
                      ["Employee", "Days Worked", "Total Hours", "Avg Hours/Day"],
                      attSummary.map((r) => [
                        r.name,
                        r.days,
                        r.total_hours.toFixed(1),
                        r.days > 0 ? (r.total_hours / r.days).toFixed(1) : "0",
                      ]),
                      `attendance-${attMonth}`
                    )
                  }
                >
                  Export CSV
                </Button>
              )}
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-right">Days Worked</th>
                    <th className="px-3 py-2 text-right">Total Hours</th>
                    <th className="px-3 py-2 text-right">Avg Hours/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {attSummary.map((r) => (
                    <tr key={r.employee_id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                      <td className="px-3 py-2 font-medium text-(--ui-text)">{r.name}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{r.days}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{r.total_hours.toFixed(1)}h</td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">
                        {r.days > 0 ? (r.total_hours / r.days).toFixed(1) : "0"}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attLoading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading attendance data...</div>}
              {!attLoading && attSummary.length === 0 && (
                <EmptyState title="No attendance data" body="No records found for this month." />
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Rejection note modal ──────────────────────────────────── */}
      <Modal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        title="Reject Leave Request"
        size="sm"
      >
        {rejectModal ? (
          <>
            <p className="mb-3 text-sm text-(--ui-text-muted)">Optionally provide a reason for rejection.</p>
            <textarea
              value={rejectModal.note}
              onChange={(e) => setRejectModal((m) => ({ ...m, note: e.target.value }))}
              rows={3}
              placeholder="Rejection reason (optional)"
              className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) placeholder-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-accent)/20"
            />
            <ModalFooter>
              <Button onClick={() => setRejectModal(null)}>Cancel</Button>
              <Button tone="danger" onClick={handleReject}>Confirm Rejection</Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}

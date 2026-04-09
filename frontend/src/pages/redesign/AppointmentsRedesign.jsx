import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Search, Filter, X } from "lucide-react";
import api from "../../api";

const STATUS_TONES = { pending: "warning", confirmed: "default", in_progress: "warning", completed: "success", no_show: "danger", cancelled: "danger" };
const STATUSES = ["pending", "confirmed", "in_progress", "completed", "no_show", "cancelled"];

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

export default function AppointmentsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);

  // Filters
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDaysStr(30));
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  // Detail/action modal
  const [selected, setSelected] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");

  if (!flagsLoading && !flags.phase4_appointments) return <Navigate to="/dashboard" replace />;

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/appointments?from=${from}&to=${to}`;
      if (statusFilter) url += `&status=${statusFilter}`;
      if (employeeFilter) url += `&employee_id=${employeeFilter}`;
      const data = await api.get(url);
      setAppointments(data.appointments || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [from, to, statusFilter, employeeFilter]);

  const loadEmployees = useCallback(async () => {
    try {
      const data = await api.get("/employees");
      setEmployees(data.employees || data || []);
    } catch {}
  }, []);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/appointments/${id}`, { status });
      toast.success(`Appointment ${status}`);
      setSelected(null);
      loadAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const doCancel = async (id) => {
    try {
      await api.post(`/appointments/${id}/cancel`, { reason: cancelReason || undefined });
      toast.success("Appointment cancelled");
      setCancelReason("");
      setSelected(null);
      loadAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const doReschedule = async (id) => {
    if (!rescheduleDate) { toast.error("Select new date/time"); return; }
    try {
      const svc = selected;
      const startAt = new Date(rescheduleDate);
      // Estimate end from current duration
      const origDuration = svc.end_at && svc.start_at ? (new Date(svc.end_at) - new Date(svc.start_at)) : 3600000;
      const endAt = new Date(startAt.getTime() + origDuration);
      await api.post(`/appointments/${id}/reschedule`, {
        new_start_at: startAt.toISOString(),
        new_end_at: endAt.toISOString(),
      });
      toast.success("Appointment rescheduled");
      setRescheduleDate("");
      setSelected(null);
      loadAppointments();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Appointments" subtitle="Manage and track all bookings">
      {/* Filters */}
      <SectionCard>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Status</label>
            <select className="rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)"
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Staff</label>
            <select className="rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)"
              value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
              <option value="">All</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={loadAppointments}><Search className="w-4 h-4 mr-1" /> Search</Button>
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard className="mt-4">
        {loading ? (
          <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
        ) : appointments.length === 0 ? (
          <EmptyState title="No appointments found" body="Adjust your filters or create a new appointment from the calendar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="pb-2 pr-4 font-medium">Date/Time</th>
                  <th className="pb-2 pr-4 font-medium">Service</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Staff</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(appt => (
                  <tr key={appt.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover) cursor-pointer" onClick={() => { setSelected(appt); setCancelReason(""); setRescheduleDate(""); }}>
                    <td className="py-2.5 pr-4 text-(--ui-text) whitespace-nowrap">{fmtDateTime(appt.start_at)}</td>
                    <td className="py-2.5 pr-4 text-(--ui-text)">{appt.service_name}</td>
                    <td className="py-2.5 pr-4 text-(--ui-text)">{appt.customer_display_name || appt.customer_name || "-"}</td>
                    <td className="py-2.5 pr-4 text-(--ui-text)">{appt.employee_name || "-"}</td>
                    <td className="py-2.5 pr-4"><Badge tone={STATUS_TONES[appt.status] || "default"}>{appt.status?.replace(/_/g, " ")}</Badge></td>
                    <td className="py-2.5">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {appt.status === "pending" && <Button size="xs" onClick={() => updateStatus(appt.id, "confirmed")}>Confirm</Button>}
                        {appt.status === "confirmed" && <Button size="xs" onClick={() => updateStatus(appt.id, "in_progress")}>Start</Button>}
                        {appt.status === "in_progress" && <Button size="xs" onClick={() => updateStatus(appt.id, "completed")}>Complete</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Appointment Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">{selected.service_name}</h2>
              <button onClick={() => setSelected(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-2 text-sm text-(--ui-text-muted) mb-4">
              <p><span className="font-medium text-(--ui-text)">Time:</span> {fmtDateTime(selected.start_at)} - {fmtDateTime(selected.end_at)}</p>
              <p><span className="font-medium text-(--ui-text)">Customer:</span> {selected.customer_display_name || selected.customer_name || "-"}</p>
              <p><span className="font-medium text-(--ui-text)">Staff:</span> {selected.employee_name || "Unassigned"}</p>
              <p><span className="font-medium text-(--ui-text)">Status:</span> <Badge tone={STATUS_TONES[selected.status] || "default"}>{selected.status?.replace(/_/g, " ")}</Badge></p>
              {selected.notes && <p><span className="font-medium text-(--ui-text)">Notes:</span> {selected.notes}</p>}
            </div>

            {/* Quick status actions */}
            {!["completed", "cancelled"].includes(selected.status) && (
              <div className="space-y-3 border-t border-(--ui-border) pt-4">
                <div className="flex flex-wrap gap-2">
                  {selected.status === "pending" && <Button size="sm" onClick={() => updateStatus(selected.id, "confirmed")}>Confirm</Button>}
                  {selected.status === "confirmed" && <Button size="sm" onClick={() => updateStatus(selected.id, "in_progress")}>Start</Button>}
                  {selected.status === "in_progress" && <Button size="sm" onClick={() => updateStatus(selected.id, "completed")}>Complete</Button>}
                  <Button size="sm" variant="ghost" onClick={() => updateStatus(selected.id, "no_show")}>No-Show</Button>
                </div>

                {/* Reschedule */}
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Reschedule to</label>
                  <div className="flex gap-2">
                    <Input type="datetime-local" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => doReschedule(selected.id)} disabled={!rescheduleDate}>Reschedule</Button>
                  </div>
                </div>

                {/* Cancel */}
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Cancel appointment</label>
                  <div className="flex gap-2">
                    <Input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason (optional)" className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => doCancel(selected.id)}>Cancel Appt</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

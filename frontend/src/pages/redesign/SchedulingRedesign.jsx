import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, EmptyState } from "../../ui/primitives";
import { Calendar, Plus, Send, AlertTriangle, Clock, X } from "lucide-react";
import api from "../../api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekDates(baseDate) {
  const d = new Date(baseDate + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return date.toISOString().slice(0, 10);
  });
}

function fmtTime(t) {
  if (!t) return "";
  return t.slice(0, 5);
}

export default function SchedulingRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [weekBase, setWeekBase] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editShift, setEditShift] = useState(null);
  const [overtimeAlerts, setOvertimeAlerts] = useState([]);

  const weekDates = getWeekDates(weekBase);
  const weekFrom = weekDates[0];
  const weekTo = weekDates[6];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: weekFrom, to: weekTo });
      if (selectedOutlet) params.set("outlet_id", selectedOutlet);
      const [shiftsRes, empRes, outRes] = await Promise.all([
        api.get(`/schedules?${params}`),
        api.get("/employees"),
        api.get("/outlets"),
      ]);
      setShifts(shiftsRes.shifts || []);
      setEmployees(empRes.employees || []);
      setOutlets(outRes.outlets || outRes || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [weekFrom, weekTo, selectedOutlet]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch overtime alerts
  useEffect(() => {
    api.get(`/hr/overtime-alerts?week=${weekFrom}${selectedOutlet ? `&outlet_id=${selectedOutlet}` : ""}`)
      .then(r => setOvertimeAlerts(r.alerts || []))
      .catch(() => {});
  }, [weekFrom, selectedOutlet]);

  const handlePublish = async () => {
    const draftIds = shifts.filter(s => s.status === "draft").map(s => s.id);
    if (draftIds.length === 0) return toast.warning("No draft shifts to publish");
    try {
      const res = await api.post("/schedules/publish", { shift_ids: draftIds, notify: "affected" });
      toast.success(`Published ${res.published} shift(s)`);
      if (res.leave_conflicts?.length) {
        toast.warning(`${res.leave_conflicts.length} shift(s) conflict with approved leave`);
      }
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSave = async (data) => {
    try {
      if (editShift) {
        await api.put(`/schedules/${editShift.id}`, data);
        toast.success("Shift updated");
      } else {
        await api.post("/schedules", data);
        toast.success("Shift created");
      }
      setShowModal(false);
      setEditShift(null);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.del(`/schedules/${id}`);
      toast.success("Shift cancelled");
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (flagsLoading) return null;
  if (!flags.phase2_scheduling) return <Navigate to="/" replace />;

  const draftCount = shifts.filter(s => s.status === "draft").length;
  const empMap = new Map(employees.map(e => [e.id, e]));
  const overtimeSet = new Set(overtimeAlerts.filter(a => a.exceeded).map(a => a.employee_id));

  // Group shifts by employee
  const employeeIds = [...new Set(shifts.map(s => s.employee_id))];

  return (
    <PageShell
      title="Staff Scheduling"
      subtitle="Create and publish weekly shift schedules"
      right={
        <div className="flex items-center gap-2">
          <select
            value={selectedOutlet}
            onChange={e => setSelectedOutlet(e.target.value)}
            className="rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-1.5 text-sm"
          >
            <option value="">All Outlets</option>
            {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input
            type="date"
            value={weekBase}
            onChange={e => setWeekBase(e.target.value)}
            className="rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-1.5 text-sm"
          />
          {draftCount > 0 && (
            <Button tone="primary" size="sm" onClick={handlePublish}>
              <Send className="h-4 w-4 mr-1" /> Publish {draftCount}
            </Button>
          )}
          <Button size="sm" onClick={() => { setEditShift(null); setShowModal(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Shift
          </Button>
        </div>
      }
    >
      {/* Overtime alerts */}
      {overtimeAlerts.length > 0 && (
        <SectionCard className="mb-4">
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {overtimeAlerts.filter(a => a.exceeded).length} employee(s) exceed {overtimeAlerts[0]?.threshold}h/week,{" "}
              {overtimeAlerts.filter(a => !a.exceeded).length} approaching
            </span>
          </div>
        </SectionCard>
      )}

      {/* Calendar grid */}
      <SectionCard>
        {loading ? (
          <div className="flex justify-center py-12 text-sm text-(--ui-text-muted)">Loading schedule…</div>
        ) : employeeIds.length === 0 ? (
          <EmptyState title="No shifts scheduled" body="Create shifts for your team this week" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border)">
                  <th className="text-left py-2 px-3 font-medium w-40">Employee</th>
                  {weekDates.map((d, i) => (
                    <th key={d} className="text-center py-2 px-2 font-medium">
                      <div>{DAYS[i]}</div>
                      <div className="text-xs text-(--ui-text-muted)">{d.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employeeIds.map(empId => {
                  const emp = empMap.get(empId);
                  const empShifts = shifts.filter(s => s.employee_id === empId);
                  return (
                    <tr key={empId} className="border-b border-(--ui-border)">
                      <td className="py-2 px-3 font-medium">
                        <div className="flex items-center gap-1">
                          {emp?.name || `#${empId}`}
                          {overtimeSet.has(empId) && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" title="Overtime exceeded" />
                          )}
                        </div>
                      </td>
                      {weekDates.map(date => {
                        const dayShifts = empShifts.filter(s => s.shift_date?.slice(0, 10) === date && s.status !== "cancelled");
                        return (
                          <td key={date} className="py-1 px-1 text-center align-top">
                            {dayShifts.map(s => (
                              <div
                                key={s.id}
                                onClick={() => { if (s.status === "draft") { setEditShift(s); setShowModal(true); } }}
                                className={`mb-1 rounded px-1.5 py-1 text-xs cursor-pointer transition-colors ${
                                  s.status === "draft"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 opacity-70"
                                    : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                }`}
                              >
                                <div className="font-medium">{fmtTime(s.start_time)}-{fmtTime(s.end_time)}</div>
                                {s.status === "draft" && <div className="text-[10px]">Draft</div>}
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Shift modal */}
      {showModal && (
        <ShiftModal
          shift={editShift}
          employees={employees}
          outlets={outlets}
          selectedOutlet={selectedOutlet}
          onSave={handleSave}
          onCancel={() => { setShowModal(false); setEditShift(null); }}
          onDelete={editShift ? () => { handleCancel(editShift.id); setShowModal(false); setEditShift(null); } : null}
        />
      )}
    </PageShell>
  );
}

function ShiftModal({ shift, employees, outlets, selectedOutlet, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState({
    employee_id: shift?.employee_id || "",
    outlet_id: shift?.outlet_id || selectedOutlet || "",
    shift_date: shift?.shift_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    start_time: shift?.start_time?.slice(0, 5) || "09:00",
    end_time: shift?.end_time?.slice(0, 5) || "17:00",
    break_minutes: shift?.break_minutes || 0,
    notes: shift?.notes || "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-(--ui-bg) rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{shift ? "Edit Shift" : "New Shift"}</h3>
          <button onClick={onCancel}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Employee
            <select value={form.employee_id} onChange={e => set("employee_id", e.target.value)}
              className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm">
              <option value="">Select…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Outlet
            <select value={form.outlet_id} onChange={e => set("outlet_id", e.target.value)}
              className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm">
              <option value="">Select…</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Date
            <input type="date" value={form.shift_date} onChange={e => set("shift_date", e.target.value)}
              className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Start
              <input type="time" value={form.start_time} onChange={e => set("start_time", e.target.value)}
                className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">
              End
              <input type="time" value={form.end_time} onChange={e => set("end_time", e.target.value)}
                className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Break (minutes)
            <input type="number" value={form.break_minutes} onChange={e => set("break_minutes", Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium">
            Notes
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
              className="mt-1 block w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-between mt-5">
          <div>
            {onDelete && (
              <Button tone="danger" size="sm" onClick={onDelete}>Cancel Shift</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onCancel}>Close</Button>
            <Button tone="primary" size="sm" onClick={() => onSave(form)}>
              {shift ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

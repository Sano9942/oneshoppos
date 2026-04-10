import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input } from "../../ui/primitives";
import { ChevronLeft, ChevronRight, Calendar, Plus, X } from "lucide-react";
import { api } from "../../api";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8 AM to 9 PM
const EMPLOYEE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getWeekStart(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay() + 1); // Monday
  return r;
}

export default function AppointmentsCalendarRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [view, setView] = useState("week"); // "week" | "day"
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Create appointment modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSlot, setCreateSlot] = useState(null);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [createForm, setCreateForm] = useState({ service_id: "", employee_id: "", customer_name: "", start_at: "", notes: "" });

  if (!flagsLoading && !flags.phase4_appointments) return <Navigate to="/dashboard" replace />;

  const dateRange = useMemo(() => {
    if (view === "day") {
      return { from: fmtDate(currentDate), to: fmtDate(addDays(currentDate, 1)) };
    }
    const ws = getWeekStart(currentDate);
    return { from: fmtDate(ws), to: fmtDate(addDays(ws, 7)) };
  }, [view, currentDate]);

  const days = useMemo(() => {
    if (view === "day") return [new Date(currentDate)];
    const ws = getWeekStart(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [view, currentDate]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/appointments/calendar?from=${dateRange.from}&to=${dateRange.to}`);
      setEvents(data.events || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [dateRange.from, dateRange.to]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const iv = setInterval(loadEvents, 30000);
    return () => clearInterval(iv);
  }, [loadEvents]);

  const loadFormData = useCallback(async () => {
    try {
      const [svcData, empData] = await Promise.all([
        api.get("/api/booking-services"),
        api.get("/api/employees"),
      ]);
      setServices(svcData.services || []);
      setEmployees(empData.employees || empData || []);
    } catch {}
  }, []);

  // Build color map for employees
  const colorMap = useMemo(() => {
    const map = {};
    const uniqueEmpIds = [...new Set(events.map(e => e.employee_id).filter(Boolean))];
    uniqueEmpIds.forEach((id, i) => { map[id] = EMPLOYEE_COLORS[i % EMPLOYEE_COLORS.length]; });
    return map;
  }, [events]);

  const navigate = (dir) => {
    const n = view === "day" ? 1 : 7;
    setCurrentDate(prev => addDays(prev, dir * n));
  };

  const openCreate = (day, hour) => {
    const dt = new Date(day);
    dt.setHours(hour, 0, 0, 0);
    const isoStr = dt.toISOString().slice(0, 16);
    setCreateSlot({ day, hour });
    setCreateForm({ service_id: "", employee_id: "", customer_name: "", start_at: isoStr, notes: "" });
    loadFormData();
    setShowCreateModal(true);
  };

  const submitCreate = async () => {
    try {
      const svc = services.find(s => s.id === Number(createForm.service_id));
      if (!svc) { toast.error("Select a service"); return; }
      const startAt = new Date(createForm.start_at);
      const endAt = new Date(startAt.getTime() + svc.duration_minutes * 60000);
      await api.post("/api/appointments", {
        service_id: Number(createForm.service_id),
        employee_id: createForm.employee_id ? Number(createForm.employee_id) : undefined,
        customer_name: createForm.customer_name || undefined,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        notes: createForm.notes || undefined,
        source: "admin",
      });
      toast.success("Appointment created");
      setShowCreateModal(false);
      loadEvents();
    } catch (err) { toast.error(err.message); }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/appointments/${id}`, { status });
      toast.success(`Appointment ${status}`);
      setSelectedEvent(null);
      loadEvents();
    } catch (err) { toast.error(err.message); }
  };

  const headerLabel = view === "day"
    ? currentDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : `${days[0]?.toLocaleDateString([], { month: "short", day: "numeric" })} - ${days[6]?.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  const STATUS_TONES = { pending: "warning", confirmed: "default", in_progress: "warning", completed: "success", no_show: "danger", cancelled: "danger" };

  return (
    <PageShell title="Appointments Calendar" subtitle="Visual scheduling view" right={
      <div className="flex gap-2">
        <Button size="sm" variant={view === "week" ? "primary" : "ghost"} onClick={() => setView("week")}>Week</Button>
        <Button size="sm" variant={view === "day" ? "primary" : "ghost"} onClick={() => setView("day")}>Day</Button>
      </div>
    }>
      {/* Navigation bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setCurrentDate(new Date())}>Today</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <span className="text-sm font-medium text-(--ui-text)">{headerLabel}</span>
      </div>

      <SectionCard>
        {loading && events.length === 0 ? (
          <div className="text-center py-12 text-(--ui-text-muted)">Loading calendar...</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Day headers */}
              <div className="grid border-b border-(--ui-border)" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}>
                <div className="p-2 text-xs text-(--ui-text-muted)"></div>
                {days.map(d => {
                  const isToday = fmtDate(d) === fmtDate(new Date());
                  return (
                    <div key={fmtDate(d)} className={`p-2 text-center text-xs font-medium border-l border-(--ui-border) ${isToday ? "bg-(--ui-accent)/10 text-(--ui-accent)" : "text-(--ui-text-muted)"}`}>
                      <div>{d.toLocaleDateString([], { weekday: "short" })}</div>
                      <div className="text-lg">{d.getDate()}</div>
                    </div>
                  );
                })}
              </div>

              {/* Time grid */}
              {HOURS.map(hour => (
                <div key={hour} className="grid border-b border-(--ui-border)" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)`, minHeight: "48px" }}>
                  <div className="p-1 text-[11px] text-(--ui-text-muted) text-right pr-2 pt-0.5">
                    {hour > 12 ? `${hour - 12} PM` : hour === 12 ? "12 PM" : `${hour} AM`}
                  </div>
                  {days.map(d => {
                    const dayStr = fmtDate(d);
                    const cellEvents = events.filter(e => {
                      const eDate = new Date(e.start_at);
                      return fmtDate(eDate) === dayStr && eDate.getHours() === hour;
                    });
                    return (
                      <div key={dayStr} className="border-l border-(--ui-border) relative cursor-pointer hover:bg-(--ui-bg-hover) min-h-[48px] p-0.5"
                        onClick={() => openCreate(d, hour)}>
                        {cellEvents.map(ev => (
                          <div key={ev.id}
                            className="rounded px-1.5 py-0.5 text-[11px] text-white mb-0.5 cursor-pointer truncate"
                            style={{ backgroundColor: colorMap[ev.employee_id] || "#6b7280" }}
                            onClick={e => { e.stopPropagation(); setSelectedEvent(ev); }}>
                            {fmtTime(ev.start_at)} {ev.service_name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">{selectedEvent.service_name}</h2>
              <button onClick={() => setSelectedEvent(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2 text-sm text-(--ui-text-muted) mb-4">
              <p><span className="font-medium text-(--ui-text)">Time:</span> {fmtTime(selectedEvent.start_at)} - {fmtTime(selectedEvent.end_at)}</p>
              {selectedEvent.employee_name && <p><span className="font-medium text-(--ui-text)">Staff:</span> {selectedEvent.employee_name}</p>}
              {selectedEvent.customer_name && <p><span className="font-medium text-(--ui-text)">Customer:</span> {selectedEvent.customer_name}</p>}
              <p><span className="font-medium text-(--ui-text)">Status:</span> <Badge tone={STATUS_TONES[selectedEvent.status] || "default"}>{selectedEvent.status}</Badge></p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedEvent.status === "pending" && <Button size="xs" onClick={() => updateStatus(selectedEvent.id, "confirmed")}>Confirm</Button>}
              {(selectedEvent.status === "confirmed" || selectedEvent.status === "pending") && <Button size="xs" onClick={() => updateStatus(selectedEvent.id, "in_progress")}>Start</Button>}
              {selectedEvent.status === "in_progress" && <Button size="xs" onClick={() => updateStatus(selectedEvent.id, "completed")}>Complete</Button>}
              {selectedEvent.status !== "completed" && selectedEvent.status !== "cancelled" && (
                <Button size="xs" variant="ghost" onClick={() => updateStatus(selectedEvent.id, "no_show")}>No-Show</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Appointment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
          <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">New Appointment</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Service *</label>
                <select className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)"
                  value={createForm.service_id} onChange={e => setCreateForm(p => ({ ...p, service_id: e.target.value }))}>
                  <option value="">Select service</option>
                  {services.filter(s => s.is_active !== false).map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes}min)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Staff</label>
                <select className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)"
                  value={createForm.employee_id} onChange={e => setCreateForm(p => ({ ...p, employee_id: e.target.value }))}>
                  <option value="">Any available</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Start Time *</label>
                <Input type="datetime-local" value={createForm.start_at} onChange={e => setCreateForm(p => ({ ...p, start_at: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Customer Name</label>
                <Input value={createForm.customer_name} onChange={e => setCreateForm(p => ({ ...p, customer_name: e.target.value }))} placeholder="Walk-in or name" />
              </div>
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Notes</label>
                <Input value={createForm.notes} onChange={e => setCreateForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button onClick={submitCreate} disabled={!createForm.service_id || !createForm.start_at}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

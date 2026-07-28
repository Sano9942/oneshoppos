import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { usePreset } from "../../contexts/PresetContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select } from "../../ui/primitives";
import { ChevronLeft, ChevronRight, Plus, X, Users, Clock, UserX, UserCheck, ListPlus, Send } from "lucide-react";
import { api } from "../../api";
import { localDateStr } from "../../utils/dates";

/**
 * F06 — class timetable (group scheduling). Week grid of class_sessions with
 * fill counts + a roster drawer (book / cancel / no-show / waitlist).
 * Built minimally off main — re-check against redesign/square post-reskin.
 */

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d) { return localDateStr(d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function getWeekStart(d) { const r = new Date(d); r.setDate(r.getDate() - r.getDay() + 1); return r; }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ClassTimetableRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { labels } = usePreset();
  const { fmt } = useCurrency();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Roster drawer
  const [rosterSessionId, setRosterSessionId] = useState(null);
  const [roster, setRoster] = useState(null); // { session, bookings, waitlist }
  const [bookSearch, setBookSearch] = useState("");
  const [customers, setCustomers] = useState([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    service_id: "", employee_id: "", start_at: "", duration_min: 60,
    max_capacity: 10, price: "", notes: "", recurring: false, days: [], weeks: 4,
  });

  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/classes/sessions", {
        from: new Date(fmtDate(weekStart) + "T00:00:00").toISOString(),
        to: new Date(fmtDate(addDays(weekStart, 7)) + "T00:00:00").toISOString(),
      });
      setSessions(data.sessions || []);
    } catch (e) {
      toast.error(e.message || "Failed to load timetable");
    } finally {
      setLoading(false);
    }
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/api/booking-services").then(d => setServices((d.services || []).filter(s => s.is_active !== false))).catch(() => {});
    api.get("/api/employees").then(d => setEmployees(d.employees || d || [])).catch(() => {});
    api.get("/api/customers").then(d => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  const openRoster = useCallback(async (sessionId) => {
    setRosterSessionId(sessionId);
    setRoster(null);
    try {
      setRoster(await api.get(`/api/classes/sessions/${sessionId}/roster`));
    } catch (e) {
      toast.error(e.message);
      setRosterSessionId(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRoster = useCallback(async () => {
    if (!rosterSessionId) return;
    try { setRoster(await api.get(`/api/classes/sessions/${rosterSessionId}/roster`)); } catch { /* keep old */ }
    load();
  }, [rosterSessionId, load]);

  const act = useCallback(async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await refreshRoster();
    } catch (e) {
      toast.error(e.body?.hint ? `${e.message} — ${e.body.hint}` : (e.message || "Action failed"));
    }
  }, [refreshRoster, toast]);

  const submitCreate = useCallback(async () => {
    try {
      const startAt = new Date(form.start_at);
      const payload = {
        service_id: Number(form.service_id),
        employee_id: form.employee_id ? Number(form.employee_id) : null,
        start_at: startAt.toISOString(),
        end_at: new Date(startAt.getTime() + Number(form.duration_min) * 60000).toISOString(),
        max_capacity: Number(form.max_capacity) || 10,
        price: form.price !== "" ? Number(form.price) : null,
        notes: form.notes || null,
      };
      if (form.recurring && form.days.length) {
        payload.recurrence_rule = `weekly:${[...form.days].sort().join(",")}`;
        payload.recurrence_weeks = Number(form.weeks) || 4;
      }
      const res = await api.post("/api/classes/sessions", payload);
      toast.success(`Class created${res.occurrences?.length ? ` (+${res.occurrences.length} occurrences)` : ""}`);
      setShowCreate(false);
      setForm({ service_id: "", employee_id: "", start_at: "", duration_min: 60, max_capacity: 10, price: "", notes: "", recurring: false, days: [], weeks: 4 });
      load();
    } catch (e) {
      toast.error(e.message || "Failed to create class");
    }
  }, [form, load, toast]);

  const cancelSession = useCallback(async (session, cascade) => {
    const reason = window.prompt(cascade ? "Cancel this and all future occurrences — reason?" : "Cancel this class — reason?");
    if (reason === null) return;
    try {
      const res = await api.post(`/api/classes/sessions/${session.id}/cancel`, { reason: reason || undefined, cascade_series: cascade });
      toast.success(`Cancelled ${res.cancelled_session_ids.length} session(s); ${res.notified_bookings} member(s) notified`);
      setRosterSessionId(null);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }, [load, toast]);

  if (flagsLoading) return null;
  if (!flags.phase4_appointments_classes) return <Navigate to="/" replace />;

  const waitlistOn = !!flags.phase4_appointments_waitlists;
  const title = labels?.timetable || "Class Timetable";
  const classWord = labels?.class_singular || "Class";
  const weekLabel = `${days[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  const bookMatches = bookSearch.trim().length >= 2
    ? customers.filter(c =>
        (c.name || "").toLowerCase().includes(bookSearch.toLowerCase()) ||
        (c.mobile || "").includes(bookSearch)).slice(0, 6)
    : [];

  return (
    <PageShell
      title={title}
      subtitle="Group sessions, capacity and rosters"
      right={
        <Button tone="primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New {classWord}
        </Button>
      }
    >
      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <Button tone="plain" iconOnly onClick={() => setCurrentDate(addDays(currentDate, -7))}><ChevronLeft size={16} /></Button>
            <Button tone="plain" onClick={() => setCurrentDate(new Date())}>Today</Button>
            <Button tone="plain" iconOnly onClick={() => setCurrentDate(addDays(currentDate, 7))}><ChevronRight size={16} /></Button>
          </div>
          <div className="text-sm font-semibold text-(--ui-text)">{weekLabel}</div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-(--ui-border) rounded-lg overflow-hidden border border-(--ui-border)">
          {days.map((d) => {
            const dayStr = fmtDate(d);
            const isToday = dayStr === fmtDate(new Date());
            const daySessions = sessions.filter((s) => fmtDate(new Date(s.start_at)) === dayStr);
            return (
              <div key={dayStr} className="bg-(--ui-surface) min-h-40 flex flex-col">
                <div className={`px-2 py-1.5 text-center text-xs font-semibold border-b border-(--ui-border) ${isToday ? "text-(--ui-accent)" : "text-(--ui-text-muted)"}`}>
                  {d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}
                </div>
                <div className="p-1 space-y-1 flex-1">
                  {daySessions.map((s) => {
                    const full = s.confirmed_count >= s.max_capacity;
                    const cancelled = s.status === "cancelled";
                    return (
                      <button
                        key={s.id}
                        onClick={() => !cancelled && openRoster(s.id)}
                        className={`w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight border transition ${
                          cancelled
                            ? "opacity-40 line-through border-(--ui-border) cursor-default"
                            : full
                              ? "border-(--ui-warning-fg)/30 bg-(--ui-warning-bg) hover:border-(--ui-warning-fg)"
                              : "border-(--ui-border) hover:border-(--ui-accent) bg-(--ui-surface-2)"
                        }`}
                      >
                        <div className="font-bold text-(--ui-text) truncate">{fmtTime(s.start_at)} {s.service_name}</div>
                        <div className="flex items-center justify-between text-(--ui-text-muted)">
                          <span className="truncate">{s.employee_name || "—"}</span>
                          <span className={`font-semibold ${full ? "text-(--ui-warning-fg)" : ""}`}>
                            {s.confirmed_count}/{s.max_capacity}
                            {waitlistOn && s.waitlist_count > 0 ? ` +${s.waitlist_count}w` : ""}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {loading && <div className="text-center text-sm text-(--ui-text-muted) py-3">Loading…</div>}
        {!loading && sessions.length === 0 && (
          <div className="text-center py-10 text-(--ui-text-muted) text-sm">
            No classes scheduled this week. Create one to start filling the timetable.
          </div>
        )}
      </SectionCard>

      {/* Roster drawer */}
      {rosterSessionId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setRosterSessionId(null)}>
          <div className="bg-(--ui-surface) w-full max-w-md h-full overflow-y-auto shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            {!roster ? (
              <div className="text-sm text-(--ui-text-muted)">Loading roster…</div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="font-bold text-lg text-(--ui-text)">{roster.session.service_name}</h3>
                    <div className="text-sm text-(--ui-text-muted) flex items-center gap-2">
                      <Clock size={13} /> {new Date(roster.session.start_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {roster.session.employee_name ? ` · ${roster.session.employee_name}` : ""}
                    </div>
                    {roster.session.price != null && <div className="text-sm text-(--ui-text-muted)">{fmt(Number(roster.session.price))}</div>}
                  </div>
                  <button onClick={() => setRosterSessionId(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X size={18} /></button>
                </div>
                <div className="flex items-center gap-2 my-3">
                  <Badge>{roster.bookings.filter(b => b.status === "confirmed").length}/{roster.session.max_capacity} booked</Badge>
                  {waitlistOn && <Badge>{roster.waitlist.length} waitlisted</Badge>}
                  <div className="grow" />
                  <Button tone="danger" size="sm" onClick={() => cancelSession(roster.session, false)}>Cancel class</Button>
                  {(roster.session.recurrence_rule || roster.session.recurrence_parent_id) && (
                    <Button tone="danger" size="sm" onClick={() => cancelSession(roster.session, true)}>+ future</Button>
                  )}
                </div>

                {/* Book someone in */}
                <div className="mb-4">
                  <Input placeholder="Search member by name or phone to book…" value={bookSearch} onChange={(e) => setBookSearch(e.target.value)} />
                  {bookMatches.length > 0 && (
                    <div className="border border-(--ui-border) rounded-lg mt-1 divide-y divide-(--ui-border)">
                      {bookMatches.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-(--ui-surface-2) flex justify-between"
                          onClick={() => act(async () => {
                            await api.post(`/api/classes/sessions/${roster.session.id}/book`, { customer_id: c.id });
                            setBookSearch("");
                          }, `${c.name} booked`)}
                        >
                          <span>{c.name}</span>
                          <span className="text-(--ui-text-muted)">{c.mobile}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Roster */}
                <div className="space-y-1.5 mb-5">
                  {roster.bookings.length === 0 && (
                    <div className="text-sm text-(--ui-text-muted) text-center py-4">Nobody booked yet.</div>
                  )}
                  {roster.bookings.map((b) => (
                    <div key={b.id} className={`flex items-center justify-between rounded-lg border border-(--ui-border) px-3 py-2 text-sm ${b.status === "cancelled" ? "opacity-45" : ""}`}>
                      <div className="min-w-0">
                        <div className="font-medium text-(--ui-text) truncate">{b.customer_display_name || b.customer_name || `Customer #${b.customer_id}`}</div>
                        <div className="text-xs text-(--ui-text-muted)">{b.status}{b.booked_via !== "admin" ? ` · via ${b.booked_via}` : ""}</div>
                      </div>
                      {b.status !== "cancelled" && (
                        <div className="flex gap-1 shrink-0">
                          {b.status === "confirmed" ? (
                            <Button tone="plain" size="sm" iconOnly title="Mark no-show"
                              onClick={() => act(() => api.post(`/api/classes/bookings/${b.id}/no-show`), "Marked no-show")}>
                              <UserX size={14} />
                            </Button>
                          ) : (
                            <Button tone="plain" size="sm" iconOnly title="Mark attended/confirmed"
                              onClick={() => act(() => api.post(`/api/classes/bookings/${b.id}/confirm`), "Confirmed")}>
                              <UserCheck size={14} />
                            </Button>
                          )}
                          <Button tone="plain" size="sm" iconOnly title="Cancel booking"
                            onClick={() => act(() => api.post(`/api/classes/bookings/${b.id}/cancel`), "Booking cancelled")}>
                            <X size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Waitlist */}
                {waitlistOn && (
                  <>
                    <h4 className="font-semibold text-sm text-(--ui-text) mb-1.5 flex items-center gap-1.5"><Users size={14} /> Waitlist</h4>
                    <div className="space-y-1.5 mb-3">
                      {roster.waitlist.length === 0 && <div className="text-xs text-(--ui-text-muted)">Empty — members can join when the class is full.</div>}
                      {roster.waitlist.map((w) => (
                        <div key={w.id} className="flex items-center justify-between rounded-lg border border-(--ui-border) px-3 py-2 text-sm">
                          <div>
                            <div className="font-medium text-(--ui-text)">{w.customer_display_name || w.customer_name || `Customer #${w.customer_id}`}</div>
                            <div className="text-xs text-(--ui-text-muted)">
                              {w.status}{w.status === "offered" && w.offer_expires_at ? ` · expires ${fmtTime(w.offer_expires_at)}` : ""}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {w.status === "waiting" && (
                              <Button tone="plain" size="sm" iconOnly title="Offer the spot now"
                                onClick={() => act(() => api.post(`/api/classes/waitlist/${w.id}/offer`), "Offer sent")}>
                                <Send size={14} />
                              </Button>
                            )}
                            <Button tone="plain" size="sm" iconOnly title="Remove from waitlist"
                              onClick={() => act(() => api.post(`/api/classes/waitlist/${w.id}/remove`), "Removed")}>
                              <X size={14} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {bookSearch.trim().length >= 2 && bookMatches.length > 0 && (
                      <div className="text-xs text-(--ui-text-muted) mb-2 flex items-center gap-1">
                        <ListPlus size={12} /> Tip: booking a member into a full class returns an error — add them to the waitlist instead:
                        {bookMatches.slice(0, 3).map((c) => (
                          <button key={c.id} className="underline text-(--ui-accent)"
                            onClick={() => act(async () => {
                              await api.post(`/api/classes/sessions/${roster.session.id}/waitlist`, { customer_id: c.id });
                              setBookSearch("");
                            }, `${c.name} waitlisted`)}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-(--ui-surface) rounded-xl shadow-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-(--ui-text)">New {classWord}</h3>
              <button onClick={() => setShowCreate(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-(--ui-text-muted)">Service</label>
                <Select value={form.service_id} onChange={(e) => setForm(p => ({ ...p, service_id: e.target.value }))}>
                  <option value="">Select a service…</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-(--ui-text-muted)">Trainer / staff</label>
                <Select value={form.employee_id} onChange={(e) => setForm(p => ({ ...p, employee_id: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Starts</label>
                  <Input type="datetime-local" value={form.start_at} onChange={(e) => setForm(p => ({ ...p, start_at: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Duration (min)</label>
                  <Input type="number" min="5" value={form.duration_min} onChange={(e) => setForm(p => ({ ...p, duration_min: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Capacity</label>
                  <Input type="number" min="1" value={form.max_capacity} onChange={(e) => setForm(p => ({ ...p, max_capacity: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Price (optional)</label>
                  <Input type="number" min="0" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-(--ui-text)">
                  <input type="checkbox" checked={form.recurring} onChange={(e) => setForm(p => ({ ...p, recurring: e.target.checked }))} />
                  Repeats weekly
                </label>
                {form.recurring && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      {WEEKDAYS.map((w, i) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setForm(p => ({ ...p, days: p.days.includes(i) ? p.days.filter(x => x !== i) : [...p.days, i] }))}
                          className={`px-2 py-1 rounded text-xs font-semibold border ${form.days.includes(i) ? "bg-(--ui-accent) text-white border-(--ui-accent)" : "border-(--ui-border) text-(--ui-text-muted)"}`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
                      for <Input type="number" min="1" max="12" className="w-16" value={form.weeks} onChange={(e) => setForm(p => ({ ...p, weeks: e.target.value }))} /> weeks
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-(--ui-text-muted)">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button tone="plain" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button tone="primary" onClick={submitCreate} disabled={!form.service_id || !form.start_at || (form.recurring && !form.days.length)}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

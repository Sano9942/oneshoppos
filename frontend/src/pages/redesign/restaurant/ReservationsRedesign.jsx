import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CalendarDays, Plus, Send, Check, X, UserCheck, Clock } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../../ui/primitives";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { api } from "../../../api";
import { localDateStr } from "../../../utils/dates";

// Phase 2-R.4 — Reservations admin.
// List by day, create / update / cancel, send templated SMS. Tables on
// the right show confirmed + seated; pending + waitlisted appear with a
// dotted border so the host can triage at a glance.

const STATUS_STYLES = {
  pending: { color: "text-amber-700 bg-amber-100", label: "Pending" },
  confirmed: { color: "text-emerald-700 bg-emerald-100", label: "Confirmed" },
  seated: { color: "text-violet-700 bg-violet-100", label: "Seated" },
  completed: { color: "text-slate-600 bg-slate-100", label: "Done" },
  no_show: { color: "text-rose-700 bg-rose-100", label: "No show" },
  cancelled: { color: "text-slate-400 bg-slate-100", label: "Cancelled" },
  waitlisted: { color: "text-sky-700 bg-sky-100", label: "Waitlisted" },
};

function formatDateIso(d) {
  return localDateStr(d);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ReservationsRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();

  const [date, setDate] = useState(() => formatDateIso(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm(new Date()));
  const [busyId, setBusyId] = useState(null);
  // W25 — table picker for the Seat action.
  const [seatPickerFor, setSeatPickerFor] = useState(null); // reservation row
  const [seatPlans, setSeatPlans] = useState([]);
  const [seatActivePlanId, setSeatActivePlanId] = useState(null);
  const [seatTables, setSeatTables] = useState([]);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatSubmitting, setSeatSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = `${date}T00:00:00.000Z`;
      const to = `${date}T23:59:59.999Z`;
      const data = await api.get(
        `/api/restaurant/reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      setRows(data.reservations || []);
    } catch (e) {
      error(e?.message || "Failed to load reservations");
    } finally {
      setLoading(false);
    }
  }, [date, error]);

  useEffect(() => { load(); }, [load]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_reservations) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;

  const transition = async (r, status) => {
    setBusyId(r.id);
    try {
      await api.put(`/api/restaurant/reservations/${r.id}`, { status });
      success(`Marked ${status.replace(/_/g, " ")}`);
      await load();
    } catch (e) {
      error(e?.message || "Failed");
    } finally { setBusyId(null); }
  };

  const sendSms = async (r, template) => {
    setBusyId(r.id);
    try {
      const data = await api.post(`/api/restaurant/reservations/${r.id}/send-sms`, { template });
      if (data.sent) success("SMS sent");
      else error(data.error || "SMS not sent");
      await load();
    } catch (e) {
      error(e?.message || "Failed to send SMS");
    } finally { setBusyId(null); }
  };

  const submitCreate = async () => {
    if (!form.customer_name || !form.party_size || !form.reservation_start) {
      error("Name, party size, date/time required");
      return;
    }
    try {
      await api.post("/api/restaurant/reservations", {
        customer_name: form.customer_name,
        phone: form.phone || null,
        email: form.email || null,
        party_size: Number(form.party_size),
        reservation_start: new Date(form.reservation_start).toISOString(),
        notes: form.notes || null,
      });
      success("Reservation created");
      setCreating(false);
      setForm(emptyForm(new Date()));
      await load();
    } catch (e) {
      error(e?.message || "Failed to create");
    }
  };

  // W25 — Seat-picker flow. Click Seat on a row -> fetch floor plans for the
  // current outlet -> auto-select the first -> fetch its tables (each row
  // includes session_id when occupied). Operator picks an available table;
  // we POST /api/restaurant/reservations/:id/seat which opens a session and
  // stamps the reservation. The fetch interceptor adds x-outlet-id from the
  // user's selected outlet, so we don't pass outlet_id explicitly.
  const openSeatPicker = async (r) => {
    setSeatPickerFor(r);
    setSeatLoading(true);
    setSeatPlans([]);
    setSeatActivePlanId(null);
    setSeatTables([]);
    try {
      const data = await api.get("/api/restaurant/floor-plans");
      const plans = data.floor_plans || [];
      setSeatPlans(plans);
      if (plans.length === 0) {
        error("No floor plans configured. Create one in Floor Plan first.");
        setSeatPickerFor(null);
        return;
      }
      const firstId = plans[0].id;
      setSeatActivePlanId(firstId);
      await loadSeatPlanTables(firstId);
    } catch (e) {
      error(e?.message || "Failed to load floor plans");
      setSeatPickerFor(null);
    } finally {
      setSeatLoading(false);
    }
  };

  const loadSeatPlanTables = async (planId) => {
    setSeatLoading(true);
    try {
      const plan = await api.get(`/api/restaurant/floor-plans/${planId}`);
      setSeatTables(plan.tables || []);
    } catch (e) {
      error(e?.message || "Failed to load tables");
    } finally {
      setSeatLoading(false);
    }
  };

  const switchSeatPlan = async (planId) => {
    setSeatActivePlanId(planId);
    await loadSeatPlanTables(planId);
  };

  const submitSeat = async (tableId) => {
    if (!seatPickerFor) return;
    setSeatSubmitting(true);
    try {
      await api.post(`/api/restaurant/reservations/${seatPickerFor.id}/seat`, {
        table_id: tableId,
        guest_count: seatPickerFor.party_size,
      });
      success(`Seated ${seatPickerFor.customer_name}`);
      setSeatPickerFor(null);
      await load();
    } catch (e) {
      error(e?.message || "Failed to seat reservation");
    } finally {
      setSeatSubmitting(false);
    }
  };

  return (
    <PageShell
      title="Reservations"
      subtitle="Manage today's bookings and send SMS confirmations / reminders"
    >
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-[#8066FF]" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#8066FF]/40"
            />
          </div>
          <div className="flex-1" />
          <Button tone="default" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Button tone="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-(--ui-text-muted)">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-(--ui-text-muted) italic py-8 text-center">
            No reservations on this date. Click New to add one, or direct guests to <span className="font-mono">/reserve/&lt;tenant&gt;</span>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-(--ui-border)">
                  <th className="py-2 pr-4 font-semibold">Time</th>
                  <th className="py-2 pr-4 font-semibold">Guest</th>
                  <th className="py-2 pr-4 font-semibold">Party</th>
                  <th className="py-2 pr-4 font-semibold">Phone</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const style = STATUS_STYLES[r.status] || STATUS_STYLES.pending;
                  return (
                    <tr key={r.id} className="border-b border-(--ui-border)">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-700">{formatTime(r.reservation_start)}</td>
                      <td className="py-2 pr-4 font-medium">{r.customer_name}</td>
                      <td className="py-2 pr-4 text-(--ui-text-muted)">{r.party_size}</td>
                      <td className="py-2 pr-4 text-(--ui-text-muted)">{r.phone || "—"}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style.color}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1 justify-end flex-wrap">
                          {r.status === "pending" && (
                            <RowButton onClick={() => transition(r, "confirmed")} disabled={busyId === r.id}>
                              <Check size={12} /> Confirm
                            </RowButton>
                          )}
                          {(r.status === "pending" || r.status === "confirmed") && (
                            <RowButton onClick={() => openSeatPicker(r)} disabled={busyId === r.id}>
                              <UserCheck size={12} /> Seat
                            </RowButton>
                          )}
                          {r.status === "confirmed" && (
                            <RowButton onClick={() => transition(r, "no_show")} disabled={busyId === r.id}>
                              <Clock size={12} /> No-show
                            </RowButton>
                          )}
                          {r.phone && !["cancelled","completed"].includes(r.status) && (
                            <RowButton onClick={() => sendSms(r, r.status === "confirmed" ? "reminder" : "confirmation")} disabled={busyId === r.id}>
                              <Send size={12} /> SMS
                            </RowButton>
                          )}
                          {!["cancelled","completed"].includes(r.status) && (
                            <RowButton onClick={() => transition(r, "cancelled")} disabled={busyId === r.id}>
                              <X size={12} /> Cancel
                            </RowButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCreating(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">New reservation</h3>
            <div className="space-y-3">
              <Field label="Guest name">
                <input
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                  />
                </Field>
                <Field label="Party size">
                  <input
                    type="number"
                    min="1"
                    value={form.party_size}
                    onChange={(e) => setForm({ ...form, party_size: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                  />
                </Field>
              </div>
              <Field label="Email (optional)">
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                />
              </Field>
              <Field label="Date/time">
                <input
                  type="datetime-local"
                  value={form.reservation_start}
                  onChange={(e) => setForm({ ...form, reservation_start: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  rows="2"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button tone="default" onClick={() => setCreating(false)}>Cancel</Button>
              <Button tone="primary" onClick={submitCreate}>Create</Button>
            </div>
          </div>
        </div>
      )}

      {seatPickerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !seatSubmitting && setSeatPickerFor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold">Seat {seatPickerFor.customer_name}</h3>
              <button
                onClick={() => !seatSubmitting && setSeatPickerFor(null)}
                className="text-slate-400 hover:text-slate-700"
                disabled={seatSubmitting}
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Party of {seatPickerFor.party_size} · {formatTime(seatPickerFor.reservation_start)} · pick a table
            </p>

            {seatPlans.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {seatPlans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => switchSeatPlan(p.id)}
                    className={`h-8 px-3 rounded-md text-xs font-semibold ${
                      seatActivePlanId === p.id
                        ? "bg-[#8066FF] text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                    disabled={seatSubmitting || seatLoading}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            {seatLoading ? (
              <div className="text-sm text-slate-500 py-12 text-center">Loading tables…</div>
            ) : seatTables.length === 0 ? (
              <div className="text-sm text-slate-500 py-12 text-center italic">
                No tables in this plan. Add tables in Floor Plan first.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {seatTables.map((t) => {
                  const occupied = t.session_id != null;
                  const undersized = (t.capacity || 0) < (seatPickerFor.party_size || 1);
                  return (
                    <button
                      key={t.id}
                      onClick={() => !occupied && submitSeat(t.id)}
                      disabled={occupied || seatSubmitting}
                      title={
                        occupied
                          ? `Occupied — ${t.server_name || "session " + t.session_id}`
                          : undersized
                            ? `Capacity ${t.capacity} < party ${seatPickerFor.party_size}`
                            : `Seat at ${t.label}`
                      }
                      className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center transition ${
                        occupied
                          ? "border-rose-200 bg-rose-50 text-rose-700 cursor-not-allowed"
                          : undersized
                            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      }`}
                    >
                      <div className="text-base font-bold">{t.label}</div>
                      <div className="text-[10px] uppercase tracking-wide opacity-75">Cap {t.capacity}</div>
                      <div className="text-[10px] mt-1 font-semibold">
                        {occupied ? "Occupied" : undersized ? "Small" : "Available"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <Button tone="default" onClick={() => setSeatPickerFor(null)} disabled={seatSubmitting}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function RowButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function emptyForm(base) {
  const d = new Date(base.getTime() + 60 * 60 * 1000);
  const iso = d.toISOString().slice(0, 16);
  return { customer_name: "", phone: "", email: "", party_size: 2, reservation_start: iso, notes: "" };
}

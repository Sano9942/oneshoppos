import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import { API_BASE } from "../../config";

function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PortalAppointments() {
  const { tenantSlug } = useParams();
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [up, pa] = await Promise.all([
        portalApi.get(tenantSlug, "/api/portal/me/appointments?scope=upcoming"),
        portalApi.get(tenantSlug, "/api/portal/me/appointments?scope=past"),
      ]);
      setUpcoming(up || []);
      setPast(pa || []);
    } catch (err) {
      setError(err.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  async function cancel(id) {
    if (!window.confirm("Cancel this appointment?")) return;
    try {
      await portalApi.put(tenantSlug, `/api/portal/me/appointments/${id}/cancel`, {
        reason: "Cancelled by customer",
      });
      load();
    } catch (err) {
      alert(err.message || "Cancel failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <button
          type="button"
          onClick={() => setBookingOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-medium"
        >
          Book appointment
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <section>
        <h2 className="font-semibold mb-3">Upcoming</h2>
        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : upcoming.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500">
            No upcoming appointments.
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((a) => (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex justify-between items-center">
                <div>
                  <div className="font-medium">{a.service_name || "Service"}</div>
                  <div className="text-sm text-slate-600">
                    {fmtDateTime(a.start_at)}
                    {a.employee_name ? ` • ${a.employee_name}` : ""}
                  </div>
                  <div className="text-xs mt-1">
                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                      {a.status}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRescheduleId(a.id)}
                    className="text-sm text-slate-700 hover:text-slate-900 border border-slate-300 rounded px-3 py-1"
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => cancel(a.id)}
                    className="text-sm text-red-700 hover:text-red-900 border border-red-200 rounded px-3 py-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">Past</h2>
        {past.length === 0 ? (
          <div className="text-slate-500 text-sm">No past appointments.</div>
        ) : (
          <div className="space-y-2">
            {past.slice(0, 10).map((a) => (
              <div key={a.id} className="bg-white rounded border border-slate-200 p-3 text-sm flex justify-between">
                <span>{a.service_name || "Service"}</span>
                <span className="text-slate-500">{fmtDateTime(a.start_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {bookingOpen && (
        <BookingModal tenantSlug={tenantSlug} onClose={() => { setBookingOpen(false); load(); }} />
      )}
      {rescheduleId && (
        <RescheduleModal
          tenantSlug={tenantSlug}
          appointmentId={rescheduleId}
          onClose={() => { setRescheduleId(null); load(); }}
        />
      )}
    </div>
  );
}

// Thin booking modal — reuses the existing public booking config/availability endpoints.
function BookingModal({ tenantSlug, onClose }) {
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/bookings/config?tenant=${encodeURIComponent(tenantSlug)}`)
      .then((r) => r.json())
      .then((c) => setServices(c?.services || []))
      .catch(() => {});
  }, [tenantSlug]);

  useEffect(() => {
    setSlot(null);
    if (!selected) return;
    fetch(
      `${API_BASE}/api/public/bookings/availability?tenant=${encodeURIComponent(tenantSlug)}&service_id=${selected.id}&date=${date}`
    )
      .then((r) => r.json())
      .then((d) => setSlots(d?.slots || []))
      .catch(() => setSlots([]));
  }, [selected, date, tenantSlug]);

  async function submit() {
    if (!selected || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/me/appointments", {
        service_id: selected.id,
        start_at: slot.start_at,
        employee_id: slot.employee_id || null,
        notes: notes || null,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Booking failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold">Book an appointment</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Service</label>
          <select
            value={selected?.id || ""}
            onChange={(e) => setSelected(services.find((s) => s.id === Number(e.target.value)))}
            className="w-full border border-slate-300 rounded px-3 py-2"
          >
            <option value="">Choose a service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.duration_minutes} min)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input
            type="date"
            value={date}
            min={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Time</label>
          {!selected ? (
            <div className="text-sm text-slate-500">Pick a service first.</div>
          ) : slots.length === 0 ? (
            <div className="text-sm text-slate-500">No slots available on this date.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-40 overflow-auto">
              {slots.map((s, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setSlot(s)}
                  className={`px-2 py-1 rounded border text-sm ${
                    slot === s
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-slate-300 hover:border-slate-500"
                  }`}
                >
                  {new Date(s.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
            rows={2}
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected || !slot || submitting}
            onClick={submit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded font-medium disabled:opacity-50"
          >
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RescheduleModal({ tenantSlug, appointmentId, onClose }) {
  const [datetime, setDatetime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await portalApi.put(tenantSlug, `/api/portal/me/appointments/${appointmentId}/reschedule`, {
        start_at: new Date(datetime).toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err.message || "Reschedule failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold">Reschedule</h2>
        <div>
          <label className="block text-sm font-medium mb-1">New date & time</label>
          <input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
          />
          <p className="text-xs text-slate-500 mt-1">Must be at least 15 minutes from now.</p>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="button"
            disabled={!datetime || submitting}
            onClick={submit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded font-medium disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save change"}
          </button>
        </div>
      </div>
    </div>
  );
}

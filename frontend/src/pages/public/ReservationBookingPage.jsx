import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../../config";

// Phase 2-R.4 — Guest-facing reservation booking page.
// Mounted at /reserve/:tenantSlug. Picks a date → fetches /availability
// → shows available 30-min slots → collects guest info → POSTs to
// /api/public/restaurant/reservations/:tenantSlug. Guests see a
// confirmation screen with their token; admin side picks up as 'pending'.

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReservationBookingPage() {
  const { tenantSlug } = useParams();

  const [date, setDate] = useState(todayStr());
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [form, setForm] = useState({ customer_name: "", phone: "", email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSelectedSlot(null);
    setSlotsLoading(true);
    const url = `${API_BASE}/api/public/restaurant/reservations/${encodeURIComponent(tenantSlug)}/availability?date=${encodeURIComponent(date)}`;
    fetch(url)
      .then(async (r) => (r.ok ? r.json() : { slots: [] }))
      .then((data) => {
        if (cancelled) return;
        setSlots(Array.isArray(data.slots) ? data.slots : []);
      })
      .catch(() => { if (!cancelled) setSlots([]); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [tenantSlug, date]);

  const submit = async () => {
    if (!selectedSlot || !form.customer_name) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/public/restaurant/reservations/${encodeURIComponent(tenantSlug)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_name: form.customer_name,
            phone: form.phone || null,
            email: form.email || null,
            party_size: Number(partySize),
            reservation_start: selectedSlot.start,
            notes: form.notes || null,
          })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit");
      setConfirmation(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-(--ui-primary) to-(--ui-primary-strong) flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-(--ui-surface) rounded-2xl shadow-lg p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-(--ui-primary) flex items-center justify-center mb-4 text-(--ui-on-primary) text-3xl">✓</div>
          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Reservation requested</h1>
          <p className="text-(--ui-text-muted) mb-4">We'll confirm shortly by text or email.</p>
          <div className="bg-(--ui-muted-surface) rounded-lg p-4 text-left text-sm">
            <Row label="Date" value={new Date(confirmation.reservation_start).toLocaleString()} />
            <Row label="Party" value={`${confirmation.party_size}`} />
            <Row label="Status" value={confirmation.status} />
            <Row label="Confirmation" value={(confirmation.token || "").slice(0, 8)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-muted-surface)">
      <header className="bg-(--ui-surface) border-b border-(--ui-border) sticky top-0 z-30">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center">
          <h1 className="text-lg font-bold text-(--ui-text)">Book a table</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 pb-32">
        <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={todayStr()}
                className="w-full h-10 px-3 rounded-lg border border-(--ui-border) text-sm"
              />
            </Field>
            <Field label="Party size">
              <select
                value={partySize}
                onChange={(e) => setPartySize(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-lg border border-(--ui-border) text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) p-4 mb-4">
          <div className="text-sm font-semibold text-(--ui-text) mb-3">Available times</div>
          {slotsLoading ? (
            <div className="text-sm text-(--ui-text-muted)">Checking availability…</div>
          ) : slots.length === 0 ? (
            <div className="text-sm text-(--ui-text-muted) italic">No times to show.</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => {
                const active = selectedSlot?.start === s.start;
                return (
                  <button
                    key={s.start}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setSelectedSlot(s)}
                    className={`h-10 rounded-lg text-xs font-semibold transition ${
                      active
                        ? "bg-(--ui-primary) text-(--ui-on-primary)"
                        : s.available
                          ? "bg-(--ui-muted-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                          : "bg-(--ui-muted-surface) text-(--ui-text-muted) cursor-not-allowed"
                    }`}
                  >
                    {s.time}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedSlot && (
          <div className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) p-4 space-y-3">
            <Field label="Your name">
              <input
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-(--ui-border) text-sm"
                required
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="03001234567"
                className="w-full h-10 px-3 rounded-lg border border-(--ui-border) text-sm"
              />
            </Field>
            <Field label="Email (optional)">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-(--ui-border) text-sm"
              />
            </Field>
            <Field label="Notes (optional)">
              <textarea
                rows="2"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Allergies, special occasions, etc."
                className="w-full px-3 py-2 rounded-lg border border-(--ui-border) text-sm"
              />
            </Field>
            {error && <p className="text-sm text-(--ui-danger-fg)">{error}</p>}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-(--ui-surface) border-t border-(--ui-border) px-4 py-3">
        <div className="max-w-xl mx-auto">
          <button
            onClick={submit}
            disabled={submitting || !selectedSlot || !form.customer_name}
            className="w-full h-12 rounded-xl bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) font-bold text-base shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? "Submitting…" : selectedSlot
              ? `Request ${selectedSlot.time}`
              : "Pick a time"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-(--ui-text-muted) mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-(--ui-text-muted)">{label}</span>
      <span className="font-semibold text-(--ui-text)">{value}</span>
    </div>
  );
}

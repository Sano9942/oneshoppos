import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../../config";

/**
 * V10 — Public direct booking engine (/book-room/:tenantSlug).
 * Search dates → pick a room type → guest details → 'reserved' hold with a
 * pay/confirm TTL. Unauthenticated; raw fetch() by design (public/ pages).
 */

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PublicRoomBookingPage() {
  const { tenantSlug } = useParams();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [dates, setDates] = useState({ from: todayStr(1), to: todayStr(2) });
  const [types, setTypes] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  const [form, setForm] = useState({ guest_name: "", guest_phone: "", guest_email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [formError, setFormError] = useState(null);

  const cur = config?.currency_symbol || "Rs";

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/rooms/config?tenant=${tenantSlug}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || "Online booking is not available for this property");
        }
        return r.json();
      })
      .then((data) => { if (!cancelled) { setConfig(data); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const search = async () => {
    setSearching(true);
    setSelected(null);
    setTypes(null);
    setFormError(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/public/rooms/availability?tenant=${tenantSlug}&from=${dates.from}&to=${dates.to}`
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not load availability");
      setTypes(data.room_types || []);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const book = async () => {
    setFormError(null);
    if (!form.guest_name.trim()) { setFormError("Please enter your name"); return; }
    if (!form.guest_phone.trim() && !form.guest_email.trim()) {
      setFormError("Enter a phone number or email so we can confirm your booking");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/rooms/book?tenant=${tenantSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_type_id: selected.id,
          check_in_date: dates.from,
          check_out_date: dates.to,
          guest_name: form.guest_name.trim(),
          guest_phone: form.guest_phone.trim() || null,
          guest_email: form.guest_email.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Booking failed");
      setConfirmation(data);
      if (data.deposit_checkout_url) {
        window.location.href = data.deposit_checkout_url;
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-(--ui-muted-surface) flex items-center justify-center text-(--ui-text-muted)">Loading…</div>;
  }
  if (error) {
    return (
      <div className="min-h-screen bg-(--ui-muted-surface) flex items-center justify-center p-6">
        <div className="bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-md) p-8 max-w-md text-center">
          <p className="text-(--ui-text) font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const bookCta = config?.booking_labels?.booking_cta || "Book a stay";

  return (
    <div className="min-h-screen bg-(--ui-muted-surface) py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="text-center">
          {config?.logo_url && (
            <img src={config.logo_url} alt="" className="h-14 mx-auto mb-3 object-contain" />
          )}
          <h1 className="text-2xl font-semibold text-(--ui-text)">{config?.company_name}</h1>
          <p className="text-sm text-(--ui-text-muted) mt-1">{bookCta} — pick your dates to see availability</p>
        </header>

        {confirmation ? (
          <div className="bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-md) p-8 text-center space-y-3">
            <div className="text-4xl">✓</div>
            <h2 className="text-lg font-semibold text-(--ui-text)">Reservation received</h2>
            <p className="text-sm text-(--ui-text-muted)">
              Booking <span className="font-mono font-medium">{confirmation.booking_number}</span> —{" "}
              {dates.from} → {dates.to} ({confirmation.nights} night{confirmation.nights === 1 ? "" : "s"})
            </p>
            <p className="text-sm text-(--ui-text-muted)">{confirmation.message}</p>
            {confirmation.hold_expires_at && !confirmation.deposit_checkout_url && (
              <p className="text-xs text-(--ui-text-muted)">
                Your room is held until {new Date(confirmation.hold_expires_at).toLocaleString()}.
              </p>
            )}
            {confirmation.deposit_checkout_url && (
              <a
                href={confirmation.deposit_checkout_url}
                className="inline-block mt-2 px-5 py-2.5 rounded-(--ui-radius-pill) bg-(--ui-primary) text-(--ui-on-primary) text-sm font-medium"
              >
                Pay deposit to confirm
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Date search */}
            <div className="bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-md) p-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <label className="block">
                  <span className="text-xs font-medium text-(--ui-text-muted)">Check-in</span>
                  <input
                    type="date" min={todayStr()} value={dates.from}
                    onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))}
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-(--ui-text-muted)">Check-out</span>
                  <input
                    type="date" min={dates.from} value={dates.to}
                    onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))}
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                  />
                </label>
                <button
                  onClick={search}
                  disabled={searching || !dates.from || !dates.to || dates.to <= dates.from}
                  className="ui-focus-ring px-5 py-2.5 rounded-(--ui-radius-pill) bg-(--ui-primary) text-(--ui-on-primary) text-sm font-medium disabled:opacity-40"
                >
                  {searching ? "Searching…" : "Check availability"}
                </button>
              </div>
            </div>

            {/* Room types */}
            {types && (
              types.length === 0 || types.every((t) => t.rooms_available === 0) ? (
                <div className="bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-md) p-8 text-center text-sm text-(--ui-text-muted)">
                  No rooms available for those dates — try different dates.
                </div>
              ) : (
                <div className="space-y-3">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      disabled={t.rooms_available === 0}
                      onClick={() => setSelected(t)}
                      className={`ui-focus-ring w-full text-left bg-(--ui-surface) border rounded-(--ui-radius-md) p-5 transition ${
                        selected?.id === t.id
                          ? "border-(--ui-primary) ring-1 ring-(--ui-primary)"
                          : "border-(--ui-border) hover:border-(--ui-border-strong)"
                      } ${t.rooms_available === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-(--ui-text)">{t.name}</h3>
                          {t.description && <p className="text-xs text-(--ui-text-muted) mt-0.5">{t.description}</p>}
                          <p className="text-xs text-(--ui-text-muted) mt-1">
                            Sleeps {t.capacity}
                            {Array.isArray(t.amenities) && t.amenities.length > 0 && ` · ${t.amenities.join(" · ")}`}
                          </p>
                          <p className={`text-xs mt-1 ${t.rooms_available === 0 ? "text-(--ui-danger)" : "text-(--ui-success-fg)"}`}>
                            {t.rooms_available === 0 ? "Sold out" : `${t.rooms_available} available`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-semibold text-(--ui-text)">{cur} {Number(t.stay_total).toLocaleString()}</p>
                          <p className="text-xs text-(--ui-text-muted)">{t.nights} night{t.nights === 1 ? "" : "s"}</p>
                          {Number(t.deposit_required) > 0 && (
                            <p className="text-xs text-(--ui-text-muted)">Deposit {cur} {Number(t.deposit_required).toLocaleString()}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}

            {/* Guest details */}
            {selected && (
              <div className="bg-(--ui-surface) border border-(--ui-border) rounded-(--ui-radius-md) p-5 space-y-3">
                <h3 className="font-semibold text-(--ui-text)">Your details</h3>
                <input
                  placeholder="Full name" value={form.guest_name}
                  onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Phone (03xx…)" value={form.guest_phone}
                    onChange={(e) => setForm((f) => ({ ...f, guest_phone: e.target.value }))}
                    className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Email" type="email" value={form.guest_email}
                    onChange={(e) => setForm((f) => ({ ...f, guest_email: e.target.value }))}
                    className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                  />
                </div>
                <textarea
                  placeholder="Notes (arrival time, requests…)" rows={2} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-3 py-2 text-sm"
                />
                {formError && <p className="text-sm text-(--ui-danger)">{formError}</p>}
                <button
                  onClick={book} disabled={submitting}
                  className="ui-focus-ring w-full py-3 rounded-(--ui-radius-pill) bg-(--ui-primary) text-(--ui-on-primary) text-sm font-medium disabled:opacity-40"
                >
                  {submitting ? "Reserving…" : `Reserve ${selected.name} — ${cur} ${Number(selected.stay_total).toLocaleString()}`}
                </button>
              </div>
            )}
            {formError && !selected && <p className="text-sm text-(--ui-danger) text-center">{formError}</p>}
          </>
        )}
      </div>
    </div>
  );
}

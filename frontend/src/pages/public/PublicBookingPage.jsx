import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../../config";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatSlotTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function PublicBookingPage() {
  const { tenantSlug } = useParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedService, setSelectedService] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [form, setForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [formError, setFormError] = useState(null);

  // Load config + services
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/bookings/config?tenant=${tenantSlug}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || "Store not found");
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // Load availability whenever service/employee/date changes
  const loadSlots = useCallback(() => {
    if (!selectedService || !selectedDate) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    setSelectedSlot(null);
    const params = new URLSearchParams({
      tenant: tenantSlug,
      service_id: String(selectedService.id),
      date: selectedDate,
    });
    if (selectedEmployeeId) params.set("employee_id", selectedEmployeeId);
    fetch(`${API_BASE}/api/public/bookings/availability?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((data) => setSlots(Array.isArray(data.slots) ? data.slots : []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [tenantSlug, selectedService, selectedEmployeeId, selectedDate]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedService || !selectedSlot) {
      setFormError("Please select a service and time slot");
      return;
    }
    if (!form.customer_name.trim() || !form.customer_phone.trim()) {
      setFormError("Name and phone are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/bookings?tenant=${tenantSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: selectedService.id,
          employee_id: selectedEmployeeId ? Number(selectedEmployeeId) : null,
          start_at: selectedSlot.start_at || selectedSlot,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim(),
          customer_email: form.customer_email.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      setConfirmation(data);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="animate-spin h-8 w-8 border-4 border-(--ui-focus) border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Store Not Found</h1>
          <p className="text-(--ui-text-muted)">{error}</p>
        </div>
      </div>
    );
  }

  const storeName = config?.company_name || tenantSlug;
  const logoUrl = config?.logo_url;
  const currencySymbol = config?.currency_symbol || "Rs";
  const services = config?.services || [];
  const labels = config?.labels || {};
  const bookingCta = labels.booking_cta || "Book an appointment";
  const serviceSingular = labels.service_singular || "service";
  const staffSingular = labels.staff_singular || "Staff";

  if (confirmation) {
    return (
      <div className="min-h-screen bg-(--ui-muted-surface)">
        <header className="bg-(--ui-surface) border-b border-(--ui-border)">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-8 w-8 rounded object-cover" />
            ) : (
              <div className="h-8 w-8 rounded bg-(--ui-primary) flex items-center justify-center text-(--ui-on-primary) font-bold text-sm">
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-lg font-semibold text-(--ui-text)">{storeName}</span>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-(--ui-success-bg) flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-(--ui-success-fg)" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-(--ui-text) mb-2">
              {confirmation.status === "pending" ? "Booking Received" : "Booking Confirmed"}
            </h1>
            <p className="text-(--ui-text-muted) mb-6">{confirmation.message}</p>
            <div className="text-left bg-(--ui-muted-surface) rounded-lg p-4 text-sm space-y-1">
              <div><span className="text-(--ui-text-muted)">Booking ID:</span> <span className="font-medium text-(--ui-text)">#{confirmation.id}</span></div>
              <div><span className="text-(--ui-text-muted)">Start:</span> <span className="font-medium text-(--ui-text)">{new Date(confirmation.start_at).toLocaleString()}</span></div>
              {confirmation.end_at && (
                <div><span className="text-(--ui-text-muted)">End:</span> <span className="font-medium text-(--ui-text)">{new Date(confirmation.end_at).toLocaleString()}</span></div>
              )}
            </div>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={`${API_BASE}/api/public/bookings/${confirmation.id}/ics?tenant=${encodeURIComponent(tenantSlug)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-(--ui-focus) bg-(--ui-muted-surface) px-4 py-2 text-sm font-medium text-(--ui-link) hover:bg-(--ui-muted-surface)"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Add to calendar
              </a>
              <button
                onClick={() => {
                  setConfirmation(null);
                  setSelectedService(null);
                  setSelectedEmployeeId("");
                  setSelectedSlot(null);
                  setForm({ customer_name: "", customer_phone: "", customer_email: "", notes: "" });
                }}
                className="text-sm font-medium text-(--ui-link) hover:text-(--ui-link)"
              >
                Book another
              </button>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-(--ui-text-muted)">Powered by SanoPOS</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-muted-surface)">
      <header className="bg-(--ui-surface) border-b border-(--ui-border) sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={storeName} className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="h-8 w-8 rounded bg-(--ui-primary) flex items-center justify-center text-(--ui-on-primary) font-bold text-sm">
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-lg font-semibold text-(--ui-text)">{storeName}</span>
          <span className="ml-auto text-sm text-(--ui-text-muted)">{bookingCta}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Step 1: Service selection */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-(--ui-text) uppercase tracking-wide mb-3">1. Choose a {serviceSingular.toLowerCase()}</h2>
          {services.length === 0 ? (
            <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-6 text-center text-sm text-(--ui-text-muted)">
              No services are currently available for booking.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {services.map((svc) => {
                const isSelected = selectedService?.id === svc.id;
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => { setSelectedService(svc); setSelectedEmployeeId(""); }}
                    className={`text-left bg-(--ui-surface) border rounded-xl p-4 transition-colors ${
                      isSelected ? "border-(--ui-focus) ring-2 ring-(--ui-focus)" : "border-(--ui-border) hover:border-(--ui-focus)"
                    }`}
                  >
                    <div className="font-medium text-(--ui-text)">{svc.name}</div>
                    {svc.description && (
                      <p className="mt-1 text-xs text-(--ui-text-muted) line-clamp-2">{svc.description}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-(--ui-text-muted)">{svc.duration_minutes} min</span>
                      <span className="font-semibold text-(--ui-text)">{currencySymbol} {Number(svc.price || 0).toFixed(2)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Step 2: Staff + date */}
        {selectedService && (
          <section className="mb-6 bg-(--ui-surface) border border-(--ui-border) rounded-xl p-5">
            <h2 className="text-sm font-semibold text-(--ui-text) uppercase tracking-wide mb-3">2. Pick date & {staffSingular.toLowerCase()}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-(--ui-text) mb-1">Date</label>
                <input
                  type="date"
                  value={selectedDate}
                  min={todayStr()}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                />
              </div>
              {selectedService.staff && selectedService.staff.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-(--ui-text) mb-1">{staffSingular} (optional)</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                  >
                    <option value="">Any available</option>
                    {selectedService.staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Step 3: Time slots */}
        {selectedService && (
          <section className="mb-6 bg-(--ui-surface) border border-(--ui-border) rounded-xl p-5">
            <h2 className="text-sm font-semibold text-(--ui-text) uppercase tracking-wide mb-3">3. Select a time</h2>
            {slotsLoading ? (
              <div className="py-6 text-center text-sm text-(--ui-text-muted)">Loading available times...</div>
            ) : slots.length === 0 ? (
              <div className="py-6 text-center text-sm text-(--ui-text-muted)">No slots available for this date. Try another date.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {slots.map((slot, idx) => {
                  const startAt = slot.start_at || slot;
                  const isSelected = (selectedSlot?.start_at || selectedSlot) === startAt;
                  return (
                    <button
                      key={`${startAt}-${idx}`}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-(--ui-focus) bg-(--ui-primary) text-(--ui-on-primary)"
                          : "border-(--ui-border) bg-(--ui-surface) text-(--ui-text) hover:border-(--ui-focus)"
                      }`}
                    >
                      {formatSlotTime(startAt)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Step 4: Customer details + submit */}
        {selectedService && selectedSlot && (
          <section className="mb-6 bg-(--ui-surface) border border-(--ui-border) rounded-xl p-5">
            <h2 className="text-sm font-semibold text-(--ui-text) uppercase tracking-wide mb-3">4. Your details</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-(--ui-text) mb-1">Full name *</label>
                  <input
                    type="text"
                    required
                    value={form.customer_name}
                    onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                    className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-(--ui-text) mb-1">Phone *</label>
                  <input
                    type="tel"
                    required
                    value={form.customer_phone}
                    onChange={(e) => setForm((f) => ({ ...f, customer_phone: e.target.value }))}
                    className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-(--ui-text) mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))}
                  className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--ui-text) mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                />
              </div>

              {formError && (
                <div className="rounded-lg bg-(--ui-danger-bg) border border-(--ui-danger-bg) px-3 py-2 text-sm text-(--ui-danger-fg)">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-(--ui-text-muted)">
                  <span className="font-medium">{selectedService.name}</span> · {formatSlotTime(selectedSlot.start_at || selectedSlot)} · {currencySymbol} {Number(selectedService.price || 0).toFixed(2)}
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-(--ui-primary) px-5 py-2 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
                >
                  {submitting ? "Booking..." : "Confirm booking"}
                </button>
              </div>
            </form>
          </section>
        )}

        <p className="text-center text-xs text-(--ui-text-muted) mt-6">Powered by SanoPOS</p>
      </main>
    </div>
  );
}

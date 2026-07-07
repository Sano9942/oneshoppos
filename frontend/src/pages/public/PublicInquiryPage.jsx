import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, TURNSTILE_SITE_KEY } from "../../config";

/**
 * V08 — Public inquiry page (/inquire/:tenantSlug).
 *
 * Top of the photography funnel: a prospect submits name/contact/event details
 * → POST /api/public/inquiries → a CRM lead + staff notification. Self-contained
 * (raw fetch, no auth), reusing the public booking config endpoint for branding.
 * Turnstile widget renders only when a site key is configured.
 */
export default function PublicInquiryPage() {
  const { tenantSlug } = useParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", event_type: "", event_date: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/bookings/config?tenant=${tenantSlug}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setConfig(data || {});
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setConfig({});
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // Load the Turnstile widget script once, when a site key is present.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (document.getElementById("cf-turnstile-script")) return;
    const s = document.createElement("script");
    s.id = "cf-turnstile-script";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    document.body.appendChild(s);
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) return setFormError("Please enter your name.");
    setSubmitting(true);
    try {
      const turnstile_token = window.turnstile?.getResponse?.() || undefined;
      const res = await fetch(`${API_BASE}/api/public/inquiries?tenant=${tenantSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstile_token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send your inquiry.");
      setDone(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>;
  if (error) return <div className="min-h-screen grid place-items-center text-red-600">{error}</div>;

  const studioName = config?.company_name || "the studio";

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-lg mx-auto rounded-2xl bg-white border border-slate-200 p-6 sm:p-8">
        {config?.logo_url && <img src={config.logo_url} alt={studioName} className="h-12 mb-4" />}
        <h1 className="text-2xl font-bold text-slate-900">Get in touch</h1>
        <p className="text-slate-500 mt-1 mb-6">Tell {studioName} about your event and we'll be in touch shortly.</p>

        {done ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-5 text-emerald-700">
            Thanks — your inquiry has been sent. We'll reach out soon.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Your name" required value={form.name} onChange={(v) => set("name", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
              <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Event type" placeholder="Wedding, portrait…" value={form.event_type} onChange={(v) => set("event_type", v)} />
              <Field label="Event date" type="date" value={form.event_date} onChange={(v) => set("event_date", v)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
              <textarea
                rows={4}
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="Tell us what you're looking for…"
              />
            </div>
            {TURNSTILE_SITE_KEY && <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} />}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-slate-900 text-white py-3 font-semibold disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send inquiry"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
    </div>
  );
}

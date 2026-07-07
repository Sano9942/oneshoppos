import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, TURNSTILE_SITE_KEY } from "../../config";

/**
 * V08 — Public inquiry page (/inquire/:tenantSlug).
 *
 * Top of the photography funnel: a prospect submits name/contact/event details
 * → POST /api/public/inquiries → a CRM lead + staff notification. Self-contained
 * (raw fetch, no auth), reusing the public booking config endpoint for branding.
 * Styled with the Square --ui-* tokens to match the other reskinned public pages
 * (see PublicBookingPage). Turnstile renders only when a site key is configured.
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

  if (loading) return <div className="min-h-screen grid place-items-center bg-(--ui-muted-surface) text-(--ui-text-muted)">Loading…</div>;
  if (error) return <div className="min-h-screen grid place-items-center bg-(--ui-muted-surface) text-(--ui-danger-fg)">{error}</div>;

  const studioName = config?.company_name || "the studio";

  return (
    <div className="min-h-screen bg-(--ui-muted-surface) py-10 px-4">
      <div className="max-w-lg mx-auto rounded-xl bg-(--ui-surface) border border-(--ui-border) p-6 sm:p-8">
        {config?.logo_url && <img src={config.logo_url} alt={studioName} className="h-12 mb-4" />}
        <h1 className="text-2xl font-bold text-(--ui-text)">Get in touch</h1>
        <p className="text-(--ui-text-muted) mt-1 mb-6">Tell {studioName} about your event and we'll be in touch shortly.</p>

        {done ? (
          <div className="rounded-lg bg-(--ui-success-bg) border border-(--ui-success-bg) p-5 text-(--ui-success-fg)">
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
              <label className="block text-xs font-medium text-(--ui-text) mb-1">Message</label>
              <textarea
                rows={4}
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
                className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
                placeholder="Tell us what you're looking for…"
              />
            </div>
            {TURNSTILE_SITE_KEY && <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} />}
            {formError && <p className="text-sm text-(--ui-danger-fg)">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-(--ui-primary) text-(--ui-on-primary) py-3 font-semibold hover:bg-(--ui-primary-strong) disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send inquiry"}
            </button>
          </form>
        )}
      </div>
      <p className="text-center text-xs text-(--ui-text-muted) mt-4">Powered by SanoPOS</p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-(--ui-text) mb-1">
        {label}{required && <span className="text-(--ui-danger)"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
      />
    </div>
  );
}

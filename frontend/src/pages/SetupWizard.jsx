import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../config";

// Country → { currency_symbol, currency_code, timezones[] }
const COUNTRY_DATA = {
  Pakistan: { currency_symbol: "Rs", currency_code: "PKR", timezones: ["Asia/Karachi"] },
  "United States": { currency_symbol: "$", currency_code: "USD", timezones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu"] },
  "United Kingdom": { currency_symbol: "£", currency_code: "GBP", timezones: ["Europe/London"] },
  Canada: { currency_symbol: "CA$", currency_code: "CAD", timezones: ["America/Toronto", "America/Vancouver", "America/Winnipeg", "America/Halifax"] },
  Australia: { currency_symbol: "A$", currency_code: "AUD", timezones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide"] },
  India: { currency_symbol: "₹", currency_code: "INR", timezones: ["Asia/Kolkata"] },
  "United Arab Emirates": { currency_symbol: "AED", currency_code: "AED", timezones: ["Asia/Dubai"] },
  "Saudi Arabia": { currency_symbol: "SAR", currency_code: "SAR", timezones: ["Asia/Riyadh"] },
  Bangladesh: { currency_symbol: "৳", currency_code: "BDT", timezones: ["Asia/Dhaka"] },
  Nigeria: { currency_symbol: "₦", currency_code: "NGN", timezones: ["Africa/Lagos"] },
  Kenya: { currency_symbol: "KSh", currency_code: "KES", timezones: ["Africa/Nairobi"] },
  Ghana: { currency_symbol: "₵", currency_code: "GHS", timezones: ["Africa/Accra"] },
  "South Africa": { currency_symbol: "R", currency_code: "ZAR", timezones: ["Africa/Johannesburg"] },
  Egypt: { currency_symbol: "E£", currency_code: "EGP", timezones: ["Africa/Cairo"] },
  Germany: { currency_symbol: "€", currency_code: "EUR", timezones: ["Europe/Berlin"] },
  France: { currency_symbol: "€", currency_code: "EUR", timezones: ["Europe/Paris"] },
  Netherlands: { currency_symbol: "€", currency_code: "EUR", timezones: ["Europe/Amsterdam"] },
  Singapore: { currency_symbol: "S$", currency_code: "SGD", timezones: ["Asia/Singapore"] },
  Malaysia: { currency_symbol: "RM", currency_code: "MYR", timezones: ["Asia/Kuala_Lumpur"] },
  Indonesia: { currency_symbol: "Rp", currency_code: "IDR", timezones: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] },
  Philippines: { currency_symbol: "₱", currency_code: "PHP", timezones: ["Asia/Manila"] },
  "New Zealand": { currency_symbol: "NZ$", currency_code: "NZD", timezones: ["Pacific/Auckland", "Pacific/Chatham"] },
  Other: { currency_symbol: "$", currency_code: "USD", timezones: ["UTC"] },
};

const COUNTRIES = Object.keys(COUNTRY_DATA).sort((a, b) =>
  a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)
);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function LiveClock({ timezone }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    function tick() {
      try {
        setTime(
          new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
            weekday: "short",
            day: "numeric",
            month: "short",
          }).format(new Date())
        );
      } catch {
        setTime("");
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);
  if (!time) return null;
  return (
    <p className="mt-1 text-xs text-slate-500">
      Current time: <span className="font-mono font-semibold text-slate-700">{time}</span>
    </p>
  );
}

function Field({ label, children, required }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition";
const selectCls = inputCls;

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Read token from URL
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [form, setForm] = useState({
    company_name: "",
    country: "Pakistan",
    city: "",
    phone: "",
    email: "",
    timezone: "Asia/Karachi",
    currency_symbol: "Rs",
    currency_code: "PKR",
    fiscal_year_start: "01-01",
    tax_name: "",
    tax_rate: "",
    outlet_name: "Main Store",
    outlet_address: "",
    admin_name: "",
    admin_pin: "",
    confirm_pin: "",
  });

  // On mount: check setup status
  useEffect(() => {
    fetch(`${API}/setup/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.setup_complete) navigate("/login", { replace: true });
      })
      .catch(() => {});
  }, [navigate]);

  function set(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-fill currency + first timezone when country changes
      if (field === "country") {
        const d = COUNTRY_DATA[value] || COUNTRY_DATA.Other;
        next.currency_symbol = d.currency_symbol;
        next.currency_code = d.currency_code;
        next.timezone = d.timezones[0];
      }
      return next;
    });
  }

  function validateStep() {
    if (step === 1) {
      if (!form.company_name.trim()) return "Store name is required.";
    }
    if (step === 4) {
      if (!form.admin_name.trim()) return "Admin name is required.";
      if (!form.admin_pin) return "PIN is required.";
      if (!/^\d{4,6}$/.test(form.admin_pin)) return "PIN must be 4–6 digits.";
      if (form.admin_pin !== form.confirm_pin) return "PINs do not match.";
    }
    return "";
  }

  function next() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => s + 1);
  }

  function back() {
    setError("");
    setStep((s) => s - 1);
  }

  async function submit() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/setup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          company_name: form.company_name,
          country: form.country,
          city: form.city,
          phone: form.phone,
          email: form.email,
          timezone: form.timezone,
          currency_symbol: form.currency_symbol,
          currency_code: form.currency_code,
          fiscal_year_start: form.fiscal_year_start,
          tax_name: form.tax_name,
          tax_rate: form.tax_rate,
          outlet_name: form.outlet_name,
          outlet_address: form.outlet_address,
          admin_name: form.admin_name,
          admin_pin: form.admin_pin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setError("This setup link has expired or has already been used.");
        } else {
          setError(data.error || "Setup failed. Please try again.");
        }
        return;
      }
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  const timezones = (COUNTRY_DATA[form.country] || COUNTRY_DATA.Other).timezones;
  const fiscalMonth = form.fiscal_year_start ? parseInt(form.fiscal_year_start.split("-")[0], 10) : 1;

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-indigo-50 via-white to-slate-50 px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to SanoPOS</h1>
          <p className="mt-1 text-sm text-slate-500">Let's get your store set up in a few steps.</p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Step {step} of 4</span>
            <span>{["Store Identity", "Time & Currency", "First Outlet", "Admin Account"][step - 1]}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Setup complete!</h2>
              <p className="text-sm text-slate-500">Redirecting you to login…</p>
            </div>
          ) : (
            <>
              {/* Step 1 — Store Identity */}
              {step === 1 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">Store Identity</h2>
                  <Field label="Store Name" required>
                    <input className={inputCls} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="e.g. Sunrise Mart" />
                  </Field>
                  <Field label="Country">
                    <select className={selectCls} value={form.country} onChange={(e) => set("country", e.target.value)}>
                      {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="City">
                    <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Lahore" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone">
                      <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+92 300 0000000" />
                    </Field>
                    <Field label="Email">
                      <input className={inputCls} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="store@example.com" />
                    </Field>
                  </div>
                </div>
              )}

              {/* Step 2 — Time & Currency */}
              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">Time & Currency</h2>
                  <Field label="Timezone">
                    <select className={selectCls} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                      {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <LiveClock timezone={form.timezone} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Currency Symbol">
                      <input className={inputCls} value={form.currency_symbol} onChange={(e) => set("currency_symbol", e.target.value)} placeholder="$" />
                    </Field>
                    <Field label="Currency Code">
                      <input className={inputCls} value={form.currency_code} onChange={(e) => set("currency_code", e.target.value)} placeholder="USD" maxLength={5} />
                    </Field>
                  </div>
                  <Field label="Fiscal Year Start">
                    <select
                      className={selectCls}
                      value={fiscalMonth}
                      onChange={(e) => {
                        const m = String(e.target.value).padStart(2, "0");
                        set("fiscal_year_start", `${m}-01`);
                      }}
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Optional: Add a Default Tax</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Tax Name">
                        <input className={inputCls} value={form.tax_name} onChange={(e) => set("tax_name", e.target.value)} placeholder="e.g. GST" />
                      </Field>
                      <Field label="Rate (%)">
                        <input className={inputCls} type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} placeholder="0" />
                      </Field>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3 — First Outlet */}
              {step === 3 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">First Outlet</h2>
                  <p className="text-sm text-slate-500">This will be your main store location. You can add more outlets later.</p>
                  <Field label="Outlet Name">
                    <input className={inputCls} value={form.outlet_name} onChange={(e) => set("outlet_name", e.target.value)} placeholder="Main Store" />
                  </Field>
                  <Field label="Address">
                    <textarea
                      className={`${inputCls} resize-none`}
                      rows={3}
                      value={form.outlet_address}
                      onChange={(e) => set("outlet_address", e.target.value)}
                      placeholder="123 Main Street, City"
                    />
                  </Field>
                </div>
              )}

              {/* Step 4 — Admin Account */}
              {step === 4 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">Admin Account</h2>
                  <p className="text-sm text-slate-500">This account will have full Administrator access.</p>
                  <Field label="Full Name" required>
                    <input className={inputCls} value={form.admin_name} onChange={(e) => set("admin_name", e.target.value)} placeholder="e.g. Hassan Ali" />
                  </Field>
                  <Field label="PIN (4–6 digits)" required>
                    <input
                      className={inputCls}
                      type="password"
                      inputMode="numeric"
                      pattern="\d{4,6}"
                      maxLength={6}
                      value={form.admin_pin}
                      onChange={(e) => set("admin_pin", e.target.value.replace(/\D/g, ""))}
                      placeholder="••••"
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm PIN" required>
                    <input
                      className={inputCls}
                      type="password"
                      inputMode="numeric"
                      pattern="\d{4,6}"
                      maxLength={6}
                      value={form.confirm_pin}
                      onChange={(e) => set("confirm_pin", e.target.value.replace(/\D/g, ""))}
                      placeholder="••••"
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Navigation */}
              <div className="mt-6 flex items-center justify-between">
                <button
                  onClick={back}
                  disabled={step === 1}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  Back
                </button>
                {step < 4 ? (
                  <button
                    onClick={next}
                    className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={submitting}
                    className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60"
                  >
                    {submitting ? "Setting up…" : "Complete Setup"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

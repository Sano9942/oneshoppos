import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, ChefHat, Scissors, ShoppingCart, Coffee, Stethoscope, Wrench, Dumbbell, Warehouse, Camera, Beef, Candy, Shirt, Car, HardHat, Sofa, Sparkles, BedDouble, Home, Building, PawPrint, Activity } from "lucide-react";
import { api } from "../api";
import { writeSession } from "../auth/authStore";

// Tiles flagged `comingSoon: true` render disabled with a grayscale icon and
// a badge — keeps them visible so prospects see the roadmap. Currently
// selectable: general_retail, restaurant, cafe.
const BUSINESS_TYPE_CATEGORIES = [
  {
    label: "Retail",
    types: [
      { value: "general_retail", label: "Retail Store", description: "Sell products, manage inventory & stock", icon: Package, iconBg: "bg-blue-100", iconColor: "text-blue-600" },
      { value: "grocery", label: "Grocery / Supermarket", description: "Barcode scanning, perishables, stock alerts", icon: ShoppingCart, iconBg: "bg-green-100", iconColor: "text-green-600", comingSoon: true },
      { value: "wholesale", label: "Wholesale / Distribution", description: "B2B bulk sales, price lists, buyer accounts", icon: Warehouse, iconBg: "bg-slate-100", iconColor: "text-slate-600", comingSoon: true },
    ],
  },
  {
    label: "Weight / Length Based",
    types: [
      { value: "butcher", label: "Butcher / Meat Shop", description: "Sell cuts by kg or lb with gross/tare tracking", icon: Beef, iconBg: "bg-red-100", iconColor: "text-red-600", comingSoon: true },
      { value: "sweet_shop", label: "Sweet Shop / Mithai", description: "Sell by weight, pieces, or dozen", icon: Candy, iconBg: "bg-pink-100", iconColor: "text-pink-600", comingSoon: true },
      { value: "textile", label: "Textile / Fabric", description: "Sell fabric by metre or centimetre", icon: Shirt, iconBg: "bg-sky-100", iconColor: "text-sky-600", comingSoon: true },
    ],
  },
  {
    label: "Food & Beverage",
    types: [
      { value: "restaurant", label: "Restaurant", description: "Sit-down dining with tables. For full-service restaurants, BBQ houses, dhabas — guests order at the table. Floor plan, seat-by-seat checks, course timing, KDS.", icon: ChefHat, iconBg: "bg-amber-100", iconColor: "text-amber-600" },
      { value: "cafe", label: "Cafe / Fast Food / Counter", description: "Counter or kiosk service. For cafes, fast-food shops, takeaway joints, juice bars, bakeries — customers order at the counter. Menu tile grid, takeaway/delivery, no tables.", icon: Coffee, iconBg: "bg-orange-100", iconColor: "text-orange-600" },
    ],
  },
  {
    label: "Services",
    types: [
      { value: "salon", label: "Salon / Services", description: "Appointments, commissions, client bookings", icon: Scissors, iconBg: "bg-purple-100", iconColor: "text-purple-600", comingSoon: true },
      { value: "clinic", label: "Clinic / Practice", description: "Patient appointments, services, calendar", icon: Stethoscope, iconBg: "bg-rose-100", iconColor: "text-rose-600", comingSoon: true },
      { value: "repair_shop", label: "Repair / Service Shop", description: "Job tickets, deposits, repair tracking", icon: Wrench, iconBg: "bg-zinc-100", iconColor: "text-zinc-600", comingSoon: true },
      { value: "gym", label: "Gym / Fitness Studio", description: "Memberships, class bookings, member tracking", icon: Dumbbell, iconBg: "bg-indigo-100", iconColor: "text-indigo-600", comingSoon: true },
      { value: "photography_studio", label: "Photography / Creative Studio", description: "Projects, session bookings, packages", icon: Camera, iconBg: "bg-teal-100", iconColor: "text-teal-600", comingSoon: true },
    ],
  },
  {
    label: "Rentals",
    types: [
      { value: "car_rental", label: "Car Rental / Vehicle Hire", description: "Fleet bookings, deposits, overdue alerts", icon: Car, iconBg: "bg-blue-100", iconColor: "text-blue-600", comingSoon: true },
      { value: "equipment_hire", label: "Equipment Hire / Tool Rental", description: "Track assets, hourly/daily/weekly rates", icon: HardHat, iconBg: "bg-yellow-100", iconColor: "text-yellow-700", comingSoon: true },
      { value: "furniture_rental", label: "Furniture / Events Rental", description: "Event rentals with deposit & late-fee tracking", icon: Sofa, iconBg: "bg-emerald-100", iconColor: "text-emerald-700", comingSoon: true },
      { value: "party_supplies", label: "Party Supplies / Event Rental", description: "Checkout, return, and return-condition flows", icon: Sparkles, iconBg: "bg-fuchsia-100", iconColor: "text-fuchsia-600", comingSoon: true },
    ],
  },
  {
    label: "Hospitality",
    types: [
      { value: "hotel", label: "Hotel", description: "Rooms, folios, housekeeping, overnight stays", icon: BedDouble, iconBg: "bg-violet-100", iconColor: "text-violet-600", comingSoon: true },
      { value: "guesthouse", label: "Guesthouse / B&B", description: "Small-property bookings with per-date rates", icon: Home, iconBg: "bg-cyan-100", iconColor: "text-cyan-600", comingSoon: true },
      { value: "hostel", label: "Hostel", description: "Bed inventory, open folios, group stays", icon: Building, iconBg: "bg-teal-100", iconColor: "text-teal-700", comingSoon: true },
    ],
  },
  {
    label: "Clinical / Medical",
    types: [
      { value: "dental_clinic", label: "Dental Clinic", description: "Multi-visit treatment plans, charting, prescriptions", icon: Stethoscope, iconBg: "bg-sky-100", iconColor: "text-sky-700", comingSoon: true },
      { value: "veterinary", label: "Veterinary Practice", description: "Pet records, owners, lab orders, consent", icon: PawPrint, iconBg: "bg-rose-100", iconColor: "text-rose-600", comingSoon: true },
      { value: "physiotherapy", label: "Physiotherapy Clinic", description: "Session plans, body-chart notes, progress tracking", icon: Activity, iconBg: "bg-emerald-100", iconColor: "text-emerald-700", comingSoon: true },
    ],
  },
];

const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");

// Minimal fallback data if country-packs API fails
const FALLBACK_COUNTRIES = [
  { code: "PK", name: "Pakistan", currency_symbol: "Rs", currency_code: "PKR", timezone_default: "Asia/Karachi" },
  { code: "US", name: "United States", currency_symbol: "$", currency_code: "USD", timezone_default: "America/New_York" },
  { code: "GB", name: "United Kingdom", currency_symbol: "£", currency_code: "GBP", timezone_default: "Europe/London" },
  { code: "AE", name: "United Arab Emirates", currency_symbol: "AED", currency_code: "AED", timezone_default: "Asia/Dubai" },
  { code: "IN", name: "India", currency_symbol: "₹", currency_code: "INR", timezone_default: "Asia/Kolkata" },
  { code: "OTHER", name: "Other", currency_symbol: "$", currency_code: "USD", timezone_default: "UTC" },
];

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
  // PR 9 — when the setup token has expired (HTTP 403 from setup-complete),
  // we surface a "Resend setup link" inline form so the merchant doesn't
  // have to email support to restart.
  const [linkExpired, setLinkExpired] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [resendError, setResendError] = useState("");
  const [tzSearch, setTzSearch] = useState("");
  const [denomInput, setDenomInput] = useState("");

  // Country packs from API
  const [countries, setCountries] = useState(FALLBACK_COUNTRIES);
  const [selectedPack, setSelectedPack] = useState(null);

  // Read token and tenant slug from URL
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token") || "";
  const tenantSlug = searchParams.get("tenant") || "";

  const [form, setForm] = useState({
    // Empty by default so step 1 forces an explicit click instead of silently
    // advancing with the implicit retail default. Validation gates Next.
    industry_type: "",
    company_name: "",
    country_code: "PK",
    country: "Pakistan",
    city: "",
    phone: "",
    email: "",
    timezone: "Asia/Karachi",
    currency_symbol: "Rs",
    currency_code: "PKR",
    // Pakistan fiscal year is July–June; pulled from country pack on mount.
    fiscal_year_start: "07-01",
    // P8 (3.14): tax stance — "Are you a GST-registered business?"
    // null = unanswered (forces an explicit choice). 'inclusive' default
    // matches Pakistani retail convention when the merchant answers Yes.
    is_gst_registered: null,
    tax_mode: "none",
    ntn: "",
    strn: "",
    tax_name: "",
    tax_rate: "",
    denominations: [5000, 1000, 500, 100, 50, 20, 10],
    outlet_name: "Main Store",
    outlet_address: "",
    admin_name: "",
    admin_pin: "",
    confirm_pin: "",
  });

  const addDenom = () => {
    const v = parseInt(denomInput, 10);
    if (v > 0 && !form.denominations.includes(v)) {
      set("denominations", [...form.denominations, v].sort((a, b) => b - a));
    }
    setDenomInput("");
  };

  // On mount: check setup status (also pre-fills store/admin captured at signup)
  // + fetch country packs + fetch the PK pack so fiscal_year_start hydrates
  // before the merchant lands on step 3.
  useEffect(() => {
    api.raw(`/api/setup/status${tenantSlug ? `?tenant=${tenantSlug}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.setup_complete) {
          navigate("/login", { replace: true });
          return;
        }
        // Carry signup data into the wizard so the merchant doesn't re-type
        // store name (step 2) or full name (step 5).
        setForm((f) => ({
          ...f,
          company_name: f.company_name || data.store_name || "",
          admin_name: f.admin_name || data.admin_name || "",
          email: f.email || data.admin_email || "",
        }));
      })
      .catch(() => {});
    api.raw("/api/country-packs")
      .then((r) => r.json())
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setCountries(list);
      })
      .catch(() => {});
    // Hydrate the default country (PK) pack so fiscal year + denominations
    // + tax line up before the merchant scrolls to step 3.
    api.raw("/api/country-packs/PK")
      .then((r) => r.json())
      .then((pack) => {
        if (!pack || pack.error) return;
        setSelectedPack(pack);
        setForm((f) => ({
          ...f,
          fiscal_year_start: pack.fiscal_year_start || f.fiscal_year_start,
          denominations: pack.cash_denominations || f.denominations,
          // Tax fields stay empty — merchant opts in to a country-specific
          // tax (GST 17% for PK, etc.) by typing it themselves on Step 3.
          // Provisioner already seeded "Default Tax" 0% as is_default=true.
        }));
      })
      .catch(() => {});
  }, [navigate, tenantSlug]);

  function set(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-fill currency + first timezone + denominations when country changes
      if (field === "country_code") {
        const summary = countries.find((c) => c.code === value);
        if (summary) {
          next.country = summary.name;
          next.currency_symbol = summary.currency_symbol;
          next.currency_code = summary.currency_code;
          next.timezone = summary.timezone_default;
        }
        // Fetch full pack for denominations, tax, fiscal year, etc.
        api.raw(`/api/country-packs/${value}`)
          .then((r) => r.json())
          .then((pack) => {
            setSelectedPack(pack);
            setForm((f) => ({
              ...f,
              denominations: pack.cash_denominations || [100, 50, 20, 10, 5, 1],
              // Tax stays empty regardless of country pack — merchant opts in.
              fiscal_year_start: pack.fiscal_year_start || "01-01",
            }));
          })
          .catch(() => {});
      }
      return next;
    });
  }

  function validateStep() {
    if (step === 1) {
      if (!form.industry_type) return "Pick a business type to continue.";
    }
    if (step === 2) {
      if (!form.company_name.trim()) return "Store name is required.";
    }
    if (step === 3) {
      // P8 (3.14): force an explicit Yes/No on GST registration so we never
      // silently default to 'none' for a registered merchant.
      if (form.is_gst_registered !== true && form.is_gst_registered !== false) {
        return "Tell us whether you are GST-registered.";
      }
    }
    if (step === 5) {
      if (!form.admin_name.trim()) return "Admin name is required.";
      if (!form.admin_pin) return "PIN is required.";
      if (!/^\d{4,6}$/.test(form.admin_pin)) return "PIN must be 4–6 digits.";
      if (form.admin_pin !== form.confirm_pin) return "PINs do not match.";
    }
    return "";
  }

  // Drives the disabled state of the Next/Complete button so the user gets
  // a visual cue before they click — better than relying on the inline error.
  const stepInvalid = Boolean(validateStep());

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
      const res = await api.raw(`/api/setup/complete${tenantSlug ? `?tenant=${tenantSlug}` : ""}`, {
        method: "POST",
        body: JSON.stringify({
          token,
          tenant: tenantSlug || undefined,
          industry_type: form.industry_type,
          company_name: form.company_name,
          country: form.country,
          country_code: form.country_code,
          city: form.city,
          phone: form.phone,
          email: form.email,
          timezone: form.timezone,
          currency_symbol: form.currency_symbol,
          currency_code: form.currency_code,
          fiscal_year_start: form.fiscal_year_start,
          // P8 (3.14): tax stance fields. Backend writes tax_mode/ntn/strn
          // onto company_profile so the POS toggle defaults correctly post-
          // signup and FBR enqueueing only fires for registered tenants.
          is_gst_registered: form.is_gst_registered === true,
          tax_mode: form.tax_mode || "none",
          ntn: form.ntn,
          strn: form.strn,
          tax_name: form.tax_name,
          tax_rate: form.tax_rate,
          cash_denominations: JSON.stringify(form.denominations),
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
          setLinkExpired(true);
        } else {
          setError(data.error || "Setup failed. Please try again.");
        }
        return;
      }
      setDone(true);
      // PR 6 auto-login: if the backend issued a session, write it directly
      // and land on /dashboard. Use window.location (not router navigate) so
      // AuthProvider re-bootstraps and picks up the freshly-written session.
      // Otherwise fall back to the legacy /login flow so we never strand the
      // merchant on the wizard.
      if (data.token && data.employee && data.tenant) {
        writeSession({
          employee: data.employee,
          permissions: data.permissions || [],
          token: data.token,
          tenant_slug: data.tenant.slug,
          tenant: data.tenant,
          loadedAt: Date.now(),
        });
        setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
      } else {
        setTimeout(() => navigate("/login", { replace: true }), 2500);
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

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
            <span>Step {step} of 5</span>
            <span>{["Business Type", "Store Identity", "Time & Currency", "First Outlet", "Admin Account"][step - 1]}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${(step / 5) * 100}%` }}
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
              {/* Step 1 — Business Type */}
              {step === 1 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">What kind of business do you run?</h2>
                  <p className="text-sm text-slate-500">This customizes your experience. You can change it later in settings.</p>
                  <div className="space-y-4">
                    {BUSINESS_TYPE_CATEGORIES.map((cat) => (
                      <div key={cat.label}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{cat.label}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {cat.types.map((bt) => {
                            const disabled = Boolean(bt.comingSoon);
                            const selected = form.industry_type === bt.value;
                            return (
                              <button
                                key={bt.value}
                                type="button"
                                disabled={disabled}
                                onClick={() => { if (!disabled) set("industry_type", bt.value); }}
                                title={disabled ? "Coming soon — not yet available" : undefined}
                                className={`relative flex flex-col items-start gap-2 rounded-xl border-2 p-3 text-left transition ${
                                  disabled
                                    ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                                    : selected
                                    ? "cursor-pointer border-indigo-500 bg-indigo-50"
                                    : "cursor-pointer border-slate-200 hover:border-slate-300"
                                }`}
                              >
                                {disabled && (
                                  <span className="absolute right-2 top-2 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                    Coming soon
                                  </span>
                                )}
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bt.iconBg} ${disabled ? "grayscale" : ""}`}>
                                  <bt.icon size={16} className={bt.iconColor} />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-slate-800">{bt.label}</p>
                                  <p className="text-xs leading-tight text-slate-500">{bt.description}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2 — Store Identity */}
              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">Store Identity</h2>
                  <Field label="Store Name" required>
                    <input className={inputCls} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="e.g. Sunrise Mart" />
                  </Field>
                  <Field label="Country">
                    <select className={selectCls} value={form.country_code} onChange={(e) => set("country_code", e.target.value)}>
                      {countries
                        .slice()
                        .sort((a, b) => a.code === "OTHER" ? 1 : b.code === "OTHER" ? -1 : a.name.localeCompare(b.name))
                        .map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
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

              {/* Step 3 — Time & Currency */}
              {step === 3 && (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-800">Time & Currency</h2>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">Timezone</label>
                    <input
                      type="text"
                      placeholder="Search timezones..."
                      value={tzSearch}
                      onChange={(e) => setTzSearch(e.target.value)}
                      className={inputCls}
                    />
                    <select
                      className={inputCls}
                      value={form.timezone || ""}
                      onChange={(e) => set("timezone", e.target.value)}
                    >
                      <option value="">Select timezone</option>
                      {ALL_TIMEZONES
                        .filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase()))
                        .map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
                    </select>
                    <LiveClock timezone={form.timezone} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Currency Symbol">
                      <input className={inputCls} value={form.currency_symbol} onChange={(e) => set("currency_symbol", e.target.value)} placeholder="$" />
                    </Field>
                    <Field label="Currency Code">
                      <input className={inputCls} value={form.currency_code} onChange={(e) => set("currency_code", e.target.value)} placeholder="USD" maxLength={5} />
                    </Field>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">Cash Denominations</label>
                    <div className="flex flex-wrap gap-2">
                      {(form.denominations || [])
                        .sort((a, b) => b - a)
                        .map((d) => (
                          <span key={d} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                            {d}
                            <button type="button" onClick={() => set("denominations", form.denominations.filter(x => x !== d))} className="text-blue-400 hover:text-red-500">&times;</button>
                          </span>
                        ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input
                        type="number"
                        className={inputCls}
                        placeholder="Add denomination"
                        value={denomInput}
                        onChange={(e) => setDenomInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDenom(); } }}
                      />
                      <button type="button" onClick={addDenom} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Add</button>
                    </div>
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
                  {/* P8 (3.14): GST registration sub-flow. Many Pakistani
                      merchants are NOT registered and cannot legally charge
                      GST — picking "No" sets tax_mode='none' so the POS
                      hides the tax toggle and never enqueues to FBR. */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Tax & Compliance
                    </p>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">
                        Are you a GST-registered business?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setForm((p) => ({
                              ...p,
                              is_gst_registered: false,
                              tax_mode: "none",
                              ntn: "",
                              strn: "",
                              tax_name: "",
                              tax_rate: "",
                            }))
                          }
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                            form.is_gst_registered === false
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          No, not registered
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((p) => ({
                              ...p,
                              is_gst_registered: true,
                              tax_mode: p.tax_mode === "none" ? "inclusive" : p.tax_mode,
                            }))
                          }
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                            form.is_gst_registered === true
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          Yes, registered
                        </button>
                      </div>
                      {form.is_gst_registered === false && (
                        <p className="text-xs text-slate-500">
                          You won&apos;t be charged tax at checkout, and FBR Digital Invoicing will be off. You can switch later under Settings.
                        </p>
                      )}
                    </div>

                    {form.is_gst_registered === true && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="NTN (optional)">
                            <input className={inputCls} value={form.ntn} onChange={(e) => set("ntn", e.target.value)} placeholder="e.g. 1234567" />
                          </Field>
                          <Field label="STRN (optional)">
                            <input className={inputCls} value={form.strn} onChange={(e) => set("strn", e.target.value)} placeholder="e.g. 17-12-3456-789-12" />
                          </Field>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-slate-700">How are your prices listed?</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => set("tax_mode", "inclusive")}
                              className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition ${
                                form.tax_mode === "inclusive"
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-600"
                              }`}
                            >
                              Inclusive (sticker price includes GST)
                            </button>
                            <button
                              type="button"
                              onClick={() => set("tax_mode", "exclusive")}
                              className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition ${
                                form.tax_mode === "exclusive"
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-600"
                              }`}
                            >
                              Exclusive (GST added at checkout)
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Default GST rate (optional)
                          </p>
                          <p className="text-xs text-slate-500">
                            e.g. GST 17% — you can add more rules later under Settings &rarr; Taxes.
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Tax Name">
                              <input className={inputCls} value={form.tax_name} onChange={(e) => set("tax_name", e.target.value)} placeholder="e.g. GST" />
                            </Field>
                            <Field label="Rate (%)">
                              <input className={inputCls} type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} placeholder="17" />
                            </Field>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4 — First Outlet */}
              {step === 4 && (
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

              {/* Step 5 — Admin Account */}
              {step === 5 && (
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

              {/* Resend setup link — only shown after a 403 expired-link error.
                  Inline so the merchant can recover without emailing support. */}
              {linkExpired && !resendSent && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
                  <p className="mb-2 font-medium text-amber-900">Need a fresh link?</p>
                  <p className="mb-3 text-xs text-amber-800">
                    Enter the email you signed up with — we&apos;ll send a new setup link valid for 48 hours.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                    <button
                      type="button"
                      disabled={resendSubmitting || !resendEmail.trim()}
                      onClick={async () => {
                        setResendSubmitting(true);
                        setResendError("");
                        try {
                          await api.post("/api/auth/resend-setup-link", { email: resendEmail.trim() });
                          setResendSent(true);
                        } catch (err) {
                          setResendError(err.body?.error || err.message || "Could not send link.");
                        } finally {
                          setResendSubmitting(false);
                        }
                      }}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                    >
                      {resendSubmitting ? "Sending…" : "Resend link"}
                    </button>
                  </div>
                  {resendError && (
                    <p className="mt-2 text-xs text-red-600">{resendError}</p>
                  )}
                </div>
              )}
              {linkExpired && resendSent && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm">
                  <p className="font-medium text-emerald-900">Check your email</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    If an unfinished signup exists for that email, a fresh setup link is on its way.
                  </p>
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
                {step < 5 ? (
                  <button
                    onClick={next}
                    disabled={stepInvalid}
                    className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-600"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={submitting || stepInvalid}
                    className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
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

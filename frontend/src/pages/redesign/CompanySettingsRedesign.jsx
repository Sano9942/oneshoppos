import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle, Globe, Target, Upload, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import {
  Button,
  Input,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");

const DEFAULT_FORM = {
  company_name: "", trading_name: "", ntn: "", strn: "", address: "",
  city: "", country: "Pakistan", phone: "", email: "", website: "",
  currency_symbol: "$", currency_code: "USD",
  fiscal_year_start: "01-01", timezone: "Asia/Karachi", logo_url: "",
  monthly_sales_target: 0, margin_threshold_pct: 20,
  refund_threshold_pct: 5, void_threshold_pct: 3,
};

function FormField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-(--ui-text-muted)">{label}</label>
      {children}
    </div>
  );
}

export default function CompanySettingsRedesign() {
  const { authHeaders } = useAuth();
  const { refresh } = useCurrency();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }
  const [logoFile, setLogoFile] = useState(null);
  const [tzSearch, setTzSearch] = useState("");
  const [denomInput, setDenomInput] = useState("");

  const denoms = useMemo(() => {
    try {
      const raw = form.cash_denominations;
      return Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    } catch { return []; }
  }, [form.cash_denominations]);

  const addDenomination = () => {
    const v = parseInt(denomInput, 10);
    if (v > 0 && !denoms.includes(v)) {
      upd("cash_denominations", JSON.stringify([...denoms, v].sort((a, b) => b - a)));
    }
    setDenomInput("");
  };
  const removeDenom = (d) => {
    upd("cash_denominations", JSON.stringify(denoms.filter(x => x !== d)));
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/company-profile`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.profile) setForm({ ...DEFAULT_FORM, ...data.profile });
    } catch { /* silent */ }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/company-profile`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      showMsg("success", "Company profile saved.");
      load();
      refresh();
    } catch (err) {
      showMsg("error", err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    const fd = new FormData();
    fd.append("logo", logoFile);
    try {
      const res = await fetch(`${API}/api/company-profile/logo`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Logo upload failed");
      showMsg("success", "Logo updated.");
      setLogoFile(null);
      load();
    } catch (err) {
      showMsg("error", err.message || "Logo upload failed");
    }
  };

  const upd = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <PageShell
      title="Company Settings"
      subtitle="Branding, tax, regional and financial settings."
      right={
        <Button tone="primary" form="company-settings-form" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Profile"}
        </Button>
      }
    >
      {msg && (
        <SectionCard
          className={`mb-4 flex items-center gap-2 p-3 text-sm ${
            msg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {msg.type === "success" ? <CheckCircle size={14} /> : <X size={14} />}
          {msg.text}
        </SectionCard>
      )}

      <form id="company-settings-form" onSubmit={save} className="space-y-4">
        {/* Business Identity */}
        <SectionCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Building2 size={15} className="text-(--ui-accent)" />
            <h2 className="font-semibold text-(--ui-text)">Business Identity</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Company Name">
              <Input
                placeholder="Acme Corp"
                value={form.company_name || ""}
                onChange={(e) => upd("company_name", e.target.value)}
              />
            </FormField>
            <FormField label="Trading Name">
              <Input
                placeholder="Acme"
                value={form.trading_name || ""}
                onChange={(e) => upd("trading_name", e.target.value)}
              />
            </FormField>
            <FormField label="Phone">
              <Input
                placeholder="+92 300 0000000"
                value={form.phone || ""}
                onChange={(e) => upd("phone", e.target.value)}
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                placeholder="info@acme.com"
                value={form.email || ""}
                onChange={(e) => upd("email", e.target.value)}
              />
            </FormField>
            <FormField label="Website">
              <Input
                placeholder="https://acme.com"
                value={form.website || ""}
                onChange={(e) => upd("website", e.target.value)}
                className="md:col-span-2"
              />
            </FormField>
            <FormField label="Address">
              <Input
                placeholder="123 Main Street"
                value={form.address || ""}
                onChange={(e) => upd("address", e.target.value)}
                className="md:col-span-2"
              />
            </FormField>
            <FormField label="City">
              <Input
                placeholder="Karachi"
                value={form.city || ""}
                onChange={(e) => upd("city", e.target.value)}
              />
            </FormField>
            <FormField label="Country">
              <Input
                placeholder="Pakistan"
                value={form.country || ""}
                onChange={(e) => upd("country", e.target.value)}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Tax & Legal */}
        <SectionCard className="p-5">
          <h2 className="mb-3 font-semibold text-(--ui-text)">Tax &amp; Legal</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="NTN (National Tax Number)">
              <Input
                placeholder="1234567-8"
                value={form.ntn || ""}
                onChange={(e) => upd("ntn", e.target.value)}
              />
            </FormField>
            <FormField label="STRN (Sales Tax Registration)">
              <Input
                placeholder="12-34-5678-001-90"
                value={form.strn || ""}
                onChange={(e) => upd("strn", e.target.value)}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Branding & Currency */}
        <SectionCard className="p-5">
          <h2 className="mb-3 font-semibold text-(--ui-text)">Branding &amp; Currency</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Currency Symbol">
              <Input
                placeholder="$"
                value={form.currency_symbol || ""}
                onChange={(e) => upd("currency_symbol", e.target.value)}
              />
            </FormField>
            <FormField label="Currency Code">
              <Input
                placeholder="USD"
                value={form.currency_code || ""}
                onChange={(e) => upd("currency_code", e.target.value)}
              />
            </FormField>
          </div>

          {/* Cash Denominations */}
          <div className="mt-3 space-y-1">
            <label className="text-xs font-medium text-(--ui-text-muted)">Cash Denominations</label>
            <div className="flex flex-wrap gap-2">
              {denoms
                .sort((a, b) => b - a)
                .map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                    {d}
                    <button type="button" onClick={() => removeDenom(d)} className="text-blue-400 hover:text-red-500">&times;</button>
                  </span>
                ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="number"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                placeholder="Add denomination"
                value={denomInput}
                onChange={(e) => setDenomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDenomination(); } }}
              />
              <button type="button" onClick={addDenomination} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Add</button>
            </div>
          </div>

          {/* Logo upload */}
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-(--ui-border) p-3">
            {form.logo_url && (
              <img
                src={`${API}${form.logo_url}`}
                alt="Company logo"
                className="h-12 w-auto rounded-md border border-(--ui-border) object-contain p-1"
              />
            )}
            <div className="flex flex-1 items-center gap-2">
              <input
                type="file"
                accept="image/*"
                className="flex-1 text-sm text-(--ui-text-muted) file:mr-2 file:rounded-lg file:border-0 file:bg-(--ui-muted-surface) file:px-3 file:py-1.5 file:text-xs file:font-medium"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
              <Button
                type="button"
                tone="primary"
                onClick={uploadLogo}
                disabled={!logoFile}
              >
                <Upload size={13} className="mr-1 inline" /> Upload Logo
              </Button>
            </div>
          </div>
        </SectionCard>

        {/* Regional */}
        <SectionCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Globe size={15} className="text-(--ui-accent)" />
            <h2 className="font-semibold text-(--ui-text)">Regional Settings</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Fiscal Year Start (MM-DD)">
              <Input
                placeholder="01-01"
                value={form.fiscal_year_start || ""}
                onChange={(e) => upd("fiscal_year_start", e.target.value)}
              />
            </FormField>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Timezone</label>
              <input
                placeholder="Search timezones..."
                value={tzSearch}
                onChange={(e) => setTzSearch(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
              <select
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                value={form.timezone || ""}
                onChange={(e) => upd("timezone", e.target.value)}
              >
                <option value="">Select timezone</option>
                {ALL_TIMEZONES
                  .filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase()))
                  .map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
        </SectionCard>

        {/* Dashboard Targets */}
        <SectionCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Target size={15} className="text-(--ui-accent)" />
            <h2 className="font-semibold text-(--ui-text)">Dashboard Targets</h2>
          </div>
          <p className="mb-3 text-xs text-(--ui-text-muted)">
            Set targets and thresholds to drive the attention queue and exception color coding on the dashboard.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Monthly Sales Target">
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={form.monthly_sales_target ?? 0}
                onChange={(e) => upd("monthly_sales_target", e.target.value)}
              />
            </FormField>
            <FormField label="Margin Threshold (%)">
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="20"
                value={form.margin_threshold_pct ?? 20}
                onChange={(e) => upd("margin_threshold_pct", e.target.value)}
              />
            </FormField>
            <FormField label="Refund Alert Threshold (%)">
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="5"
                value={form.refund_threshold_pct ?? 5}
                onChange={(e) => upd("refund_threshold_pct", e.target.value)}
              />
            </FormField>
            <FormField label="Void Alert Threshold (%)">
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="3"
                value={form.void_threshold_pct ?? 3}
                onChange={(e) => upd("void_threshold_pct", e.target.value)}
              />
            </FormField>
          </div>
        </SectionCard>
      </form>
    </PageShell>
  );
}

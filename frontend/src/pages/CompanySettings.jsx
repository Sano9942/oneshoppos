import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

const DEFAULT_FORM = {
  company_name: "",
  trading_name: "",
  ntn: "",
  strn: "",
  address: "",
  city: "",
  country: "Pakistan",
  phone: "",
  email: "",
  website: "",
  currency_symbol: "PKRs",
  currency_code: "PKR",
  fiscal_year_start: "01-01",
  timezone: "Asia/Karachi",
  logo_url: "",
};

export default function CompanySettings() {
  const { authHeaders } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [logoFile, setLogoFile] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/company-profile`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.profile) setForm({ ...DEFAULT_FORM, ...data.profile });
    } catch {
      // ignore
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`${API}/api/company-profile`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      setMsg("Saved");
      load();
    } catch (err) {
      setMsg(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    const fd = new FormData();
    fd.append("logo", logoFile);
    setMsg("");
    try {
      const res = await fetch(`${API}/api/company-profile/logo`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Logo upload failed");
      setMsg("Logo updated");
      load();
      setLogoFile(null);
    } catch (err) {
      setMsg(err.message || "Logo upload failed");
    }
  };

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Company Profile</h1>
        <p className="text-sm text-slate-500 mt-1">Branding, tax and regional settings</p>
      </div>

      {msg && <p className="text-sm text-slate-600 bg-slate-100 px-3 py-2 rounded-lg">{msg}</p>}

      <form onSubmit={save} className="space-y-6">
        <section className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-slate-700">Business Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Company Name" value={form.company_name || ""} onChange={(e) => update("company_name", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Trading Name" value={form.trading_name || ""} onChange={(e) => update("trading_name", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="Website" value={form.website || ""} onChange={(e) => update("website", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="Address" value={form.address || ""} onChange={(e) => update("address", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="City" value={form.city || ""} onChange={(e) => update("city", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Country" value={form.country || ""} onChange={(e) => update("country", e.target.value)} />
          </div>
        </section>

        <section className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-slate-700">Tax and Legal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="NTN" value={form.ntn || ""} onChange={(e) => update("ntn", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="STRN" value={form.strn || ""} onChange={(e) => update("strn", e.target.value)} />
          </div>
        </section>

        <section className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-slate-700">Branding and Currency</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Currency Symbol" value={form.currency_symbol || ""} onChange={(e) => update("currency_symbol", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Currency Code" value={form.currency_code || ""} onChange={(e) => update("currency_code", e.target.value)} />
            <div className="md:col-span-2 flex items-center gap-3">
              <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} className="text-sm" />
              <button type="button" onClick={uploadLogo} className="px-3 py-2 text-sm bg-slate-800 text-white rounded-lg">Upload Logo</button>
            </div>
            {form.logo_url && <img src={`${API}${form.logo_url}`} alt="Company logo" className="h-14 object-contain border rounded-md p-1" />}
          </div>
        </section>

        <section className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-slate-700">Regional</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Fiscal Year Start (MM-DD)" value={form.fiscal_year_start || ""} onChange={(e) => update("fiscal_year_start", e.target.value)} />
            <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Timezone" value={form.timezone || ""} onChange={(e) => update("timezone", e.target.value)} />
          </div>
        </section>

        <button disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
